import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentCancellationReason, AppointmentStatus, Prisma } from '@prisma/client';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentStaffId } from '../core/tenant-context';
import { clinicDateKey, parseDateOnly, zonedWallClockToInstant } from './time.util';
import { SlotAvailabilityService } from './slot-availability.service';

/**
 * The tabs, and what each one actually means in stored terms.
 *
 * A cancellation whose reason is RESCHEDULED appears in NONE of them,
 * deliberately: that row marks the OLD half of a move and the booking still
 * exists, at its new time, as a different row. Filing it under Cancelled would
 * tell a clinic it lost a booking it still has and would make the cancellation
 * count wrong. It stays reachable as history through `rescheduledFrom`.
 *
 * WAITLIST is absent because it is not a status set at all — a waitlist entry
 * is its own record with a date RANGE rather than a time, and the tab reads
 * `WaitlistEntry`. See `waitlist()`.
 */
export const TAB_STATUSES = {
  // REQUESTED is NOT here. A request is awaiting a decision, not a booking the
  // clinic is expecting; counting it in both tabs would double it on the stats
  // bar, and telling a clinic it has ten upcoming appointments when three of
  // them might be declined is a worse answer than telling it seven and three.
  //
  // ARRIVED and CHECKED_IN moved OUT to their own tab: "who is in the building
  // right now" is the counter's most-asked question and it was previously
  // mixed in with next Thursday.
  UPCOMING: [AppointmentStatus.CONFIRMED, AppointmentStatus.REMINDED],
  ARRIVED: [
    AppointmentStatus.ARRIVED,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.IN_QUEUE,
  ],
  COMPLETED: [AppointmentStatus.COMPLETED],
  NO_SHOW: [AppointmentStatus.NO_SHOW],
  CANCELLED: [AppointmentStatus.CANCELLED],
  REQUESTS: [AppointmentStatus.REQUESTED],
  // See `TO_BE_SCHEDULED` below — it is a time comparison, not a status set.
  TO_BE_SCHEDULED: [AppointmentStatus.CONFIRMED, AppointmentStatus.REMINDED],
} as const;

/** Everything that still occupies a slot — the union the stats bar counts. */
const LIVE_STATUSES = [
  ...TAB_STATUSES.UPCOMING,
  ...TAB_STATUSES.ARRIVED,
] as const;

export type DashboardTab = keyof typeof TAB_STATUSES;

export interface DashboardQuery {
  clinicId: string;
  /** Clinic-local calendar dates, YYYY-MM-DD. Inclusive both ends. */
  from: string;
  to: string;
  tab: DashboardTab;
  staffId?: string;
  serviceId?: string;
  search?: string;
  now?: Date;
}

/**
 * THE CLINIC DASHBOARD — one query source, two consumers.
 *
 * The stats bar and the reports module compute the SAME five numbers. Built
 * twice they will disagree the first time either definition moves — and the
 * disagreement will be discovered by an owner comparing a screen to a report
 * and trusting neither. So the definitions live here, once, and the bar is
 * simply the first thing to ask.
 *
 * Everything is scoped to a CLINIC-LOCAL date range. A Malaysian 20 August
 * runs 19 Aug 16:00Z to 20 Aug 16:00Z; asking between UTC midnights would put
 * the evening clinic on the wrong day and quietly mis-state every count.
 */
@Injectable()
export class AppointmentDashboardService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly availability: SlotAvailabilityService,
  ) {}

  async dashboard(query: DashboardQuery) {
    const timeZone = await this.availability.clinicTimeZone(query.clinicId);
    const range = this.rangeOf(query.from, query.to, timeZone);
    const now = query.now ?? new Date();

    const [stats, rows] = await Promise.all([
      this.stats(query, range, timeZone),
      this.rows(query, range, now),
    ]);

    return { range: { from: query.from, to: query.to, timeZone }, stats, rows };
  }

  /**
   * The five figures on the bar, over the SELECTED PERIOD — not "now".
   *
   * "Upcoming" over a period in the past is not a contradiction: it means
   * "appointments in that period that are still live", which is what an owner
   * reviewing last week wants to know about. Reading it as "in the future"
   * would make the bar say zero for every period but this one.
   */
  async stats(
    query: Pick<DashboardQuery, 'clinicId' | 'staffId' | 'serviceId'>,
    range: { start: Date; end: Date },
    timeZone: string,
  ) {
    const base = this.scope(query, range);

    const grouped = await this.prisma.appointment.groupBy({
      by: ['status'],
      where: base,
      _count: { _all: true },
      _sum: { bookingFeeAmount: true },
    });

    const countOf = (statuses: readonly AppointmentStatus[]) =>
      grouped
        .filter((row) => statuses.includes(row.status))
        .reduce((total, row) => total + row._count._all, 0);

    // BOOKED VALUE — what this period is worth if every live appointment
    // happens. NOT "potential sales", which reads as a forecast of takings and
    // is not what this is: it is the value of what is in the diary, and a
    // consultation frequently ends in a bill several times larger once
    // medicines and procedures are added. Booking fees are read from the
    // SNAPSHOT on each row (what the patient was actually committed to);
    // service prices are read LIVE from the catalogue, because nobody has
    // agreed to pay them yet and an estimate should use today's price list.
    //
    // Only live appointments count. A cancellation is not potential revenue,
    // and counting one would make the figure grow every time a clinic lost
    // business. Pending REQUESTS are excluded for the same reason in reverse:
    // nobody has agreed to them yet, and a figure that counts requests would
    // fall when one was declined without any business being lost.
    const live = await this.prisma.appointment.findMany({
      where: { ...base, status: { in: [...LIVE_STATUSES] } },
      select: { bookingFeeAmount: true, service: { select: { price: true } } },
    });
    const bookedValue = live.reduce(
      (total, row) => total + Number(row.bookingFeeAmount) + Number(row.service?.price ?? 0),
      0,
    );

    // REALISED REVENUE — what was actually invoiced, read from the INVOICES on
    // the visits those appointments became. Not the service price again: a
    // completed consultation that also dispensed three medicines earned more
    // than its catalogue price, and a consultation waived for a follow-up
    // earned less. Reading the catalogue twice and calling the second reading
    // "realised" would be a forecast wearing an actual's name.
    //
    // Appointments completed without a linked visit contribute nothing, which
    // is honest: there is no invoice to read.
    const completed = await this.prisma.appointment.findMany({
      where: { ...base, status: AppointmentStatus.COMPLETED, visitId: { not: null } },
      select: { visitId: true },
    });
    const visitIds = completed.map((row) => row.visitId!).filter(Boolean);
    const invoices = visitIds.length
      ? await this.prisma.invoice.findMany({
          where: { visitId: { in: visitIds }, status: { not: 'CANCELLED' } },
          select: { totalAmount: true },
        })
      : [];
    const realisedRevenue = invoices.reduce((total, row) => total + Number(row.totalAmount), 0);

    const noShow = countOf(TAB_STATUSES.NO_SHOW);
    const completedCount = countOf(TAB_STATUSES.COMPLETED);
    // The denominator is appointments the patient could have turned up to.
    // Cancelled ones are excluded: a clinic that cancels a clinic day has not
    // improved its no-show rate, and dividing by them says it has.
    const attendable = completedCount + noShow;

    return {
      upcoming: countOf(TAB_STATUSES.UPCOMING),
      completed: completedCount,
      cancelled: countOf(TAB_STATUSES.CANCELLED),
      noShow,
      noShowRate: attendable === 0 ? null : noShow / attendable,
      arrived: countOf(TAB_STATUSES.ARRIVED),
      requests: countOf(TAB_STATUSES.REQUESTS),
      bookedValue: round2(bookedValue),
      realisedRevenue: round2(realisedRevenue),
      timeZone,
    };
  }

  private async rows(query: DashboardQuery, range: { start: Date; end: Date }, now: Date) {
    const where: Prisma.AppointmentWhereInput = {
      ...this.scope(query, range),
      status: { in: [...TAB_STATUSES[query.tab]] },
      // TO BE SCHEDULED — a live appointment whose time has PASSED and which
      // nobody marked arrived, completed or no-show. Somebody has to decide
      // what happened: re-book it, or record that they never came.
      //
      // ⚠ THIS IS AN INTERPRETATION. Kuwick has no "booking with no slot yet"
      // state — `scheduledStart` is NOT NULL — so the Yezza tab this mirrors
      // cannot be reproduced literally. This is the closest thing that is
      // both real and useful today. Piece 4's call-back requests may replace
      // it; see HANDOFF.
      ...(query.tab === 'TO_BE_SCHEDULED' ? { scheduledEnd: { lt: now } } : {}),
      ...(query.search?.trim()
        ? {
            patient: {
              OR: [
                { name: { contains: query.search.trim(), mode: 'insensitive' } },
                { phone: { contains: query.search.trim(), mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const rows = await this.prisma.appointment.findMany({
      where,
      orderBy: { scheduledStart: query.tab === 'UPCOMING' ? 'asc' : 'desc' },
      // Bounded. A year-wide range on a busy clinic is a page nobody can read
      // and a response nobody should send.
      take: 500,
      include: {
        patient: { select: { id: true, name: true, phone: true } },
        staff: { select: { id: true, fullName: true } },
        service: { select: { id: true, name: true, price: true } },
        reminderSentBy: { select: { fullName: true } },
        communications: {
          where: { template: { startsWith: 'REMINDER' } },
          orderBy: { queuedAt: 'desc' },
          take: 1,
          select: { status: true, channel: true, sentAt: true },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      source: row.source,
      sourceDetail: row.sourceDetail,
      // The flat ids as well as the nested objects: the reschedule drawer
      // drives the availability engine and needs them, and re-fetching the
      // appointment to get ids the list already holds is a round trip for
      // nothing.
      clinicId: row.clinicId,
      staffId: row.staffId,
      serviceId: row.serviceId,
      patientId: row.patientId,
      scheduledStart: row.scheduledStart,
      scheduledEnd: row.scheduledEnd,
      notes: row.notes,
      patient: row.patient,
      provider: row.staff,
      service: { id: row.service.id, name: row.service.name, price: String(row.service.price) },
      payment: paymentStateOf(row),
      reminder: {
        sentAt: row.reminderSentAt,
        sentBy: row.reminderSentBy?.fullName ?? null,
        lastChannel: row.communications[0]?.channel ?? null,
        lastStatus: row.communications[0]?.status ?? null,
      },
    }));
  }

  /**
   * §44/§45 — the WAITLIST tab, which reads its own table.
   *
   * A waitlist entry has no time. It has a service, a date RANGE and possibly
   * a daypart, so it cannot be an appointment row with `scheduledStart`
   * invented for it — and inventing one is how a waitlist entry ends up
   * occupying a slot nobody agreed to.
   */
  async waitlist(query: Pick<DashboardQuery, 'clinicId' | 'staffId' | 'serviceId' | 'search'>) {
    const rows = await this.prisma.waitlistEntry.findMany({
      where: {
        clinicId: query.clinicId,
        status: { in: ['ACTIVE', 'OFFERED'] },
        ...(query.serviceId ? { serviceId: query.serviceId } : {}),
        ...(query.staffId ? { preferredStaffId: query.staffId } : {}),
        ...(query.search?.trim()
          ? {
              patient: {
                OR: [
                  { name: { contains: query.search.trim(), mode: 'insensitive' } },
                  { phone: { contains: query.search.trim(), mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      // Priority first, then who asked first. A clinic that raises somebody's
      // priority expects to see them move; a clinic that does not expects the
      // queue to be a queue.
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 500,
      include: {
        patient: { select: { id: true, name: true, phone: true } },
        service: { select: { id: true, name: true } },
        preferredStaff: { select: { id: true, fullName: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      patient: row.patient,
      service: row.service,
      preferredProvider: row.preferredStaff,
      earliestDate: row.earliestDate,
      latestDate: row.latestDate,
      preferredDaypart: row.preferredDaypart,
      priority: row.priority,
      note: row.note,
      status: row.status,
      offeredAt: row.offeredAt,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Record that somebody sent the reminder.
   *
   * Deliberately NOT `status = REMINDED`. That status is mutually exclusive
   * with CONFIRMED and ARRIVED, so using it would lose the appointment's real
   * state to record a phone call — and it still could not say who called or
   * when. The message itself goes through WhatsApp on the staff member's own
   * phone; this records only that it was sent, which is the only part the
   * clinic can honestly assert.
   */
  async markReminderSent(id: string) {
    const existing = await this.prisma.appointment.findUnique({
      where: { id },
      select: { id: true, reminderSentAt: true },
    });
    if (!existing) throw new NotFoundException('Appointment not found');

    // Re-sending is normal — a patient who did not reply gets another message
    // — and the LAST reminder is the one worth showing.
    return this.prisma.appointment.update({
      where: { id },
      data: { reminderSentAt: new Date(), reminderSentByStaffId: currentStaffId() ?? null },
      select: { id: true, reminderSentAt: true, reminderSentByStaffId: true },
    });
  }

  /** Clinic-local dates → the UTC instants bounding them. */
  private rangeOf(from: string, to: string, timeZone: string) {
    const start = parseDateOnly(from);
    const end = parseDateOnly(to);
    return {
      start: zonedWallClockToInstant(
        {
          year: start.getUTCFullYear(),
          month: start.getUTCMonth() + 1,
          day: start.getUTCDate(),
          hour: 0,
          minute: 0,
        },
        timeZone,
      ),
      // Inclusive of the last day: midnight at the START of the day after.
      end: zonedWallClockToInstant(
        {
          year: end.getUTCFullYear(),
          month: end.getUTCMonth() + 1,
          day: end.getUTCDate() + 1,
          hour: 0,
          minute: 0,
        },
        timeZone,
      ),
    };
  }

  private scope(
    query: Pick<DashboardQuery, 'clinicId' | 'staffId' | 'serviceId'>,
    range: { start: Date; end: Date },
  ): Prisma.AppointmentWhereInput {
    return {
      clinicId: query.clinicId,
      scheduledStart: { gte: range.start, lt: range.end },
      ...(query.staffId ? { staffId: query.staffId } : {}),
      ...(query.serviceId ? { serviceId: query.serviceId } : {}),
      // The old half of a move is not a booking anybody has — see TAB_STATUSES.
      // Two clauses because the fact moved: historical rows carry the
      // deprecated RESCHEDULED status, and new ones are CANCELLED with a
      // cancellation reason that says so.
      //
      // ⚠ THE NULL BRANCH IS NOT OPTIONAL, and leaving it out emptied the
      // whole dashboard. `NOT (cancellation_reason = 'RESCHEDULED')` is SQL
      // three-valued logic: for a row where the column is NULL — which is
      // every live appointment — the comparison is NULL, `NOT NULL` is NULL,
      // and NULL is not TRUE, so the row is filtered out. The clinic's diary
      // read zero upcoming appointments with a full week booked, and nothing
      // errored. Found by the end-to-end guardrail, invisible to every unit
      // test in this file, because a fake `where` object is not a database.
      status: { not: AppointmentStatus.RESCHEDULED },
      OR: [
        { cancellationReason: null },
        { cancellationReason: { not: AppointmentCancellationReason.RESCHEDULED } },
      ],
    };
  }
}

export type PaymentState = 'NO_FEE' | 'UNPAID' | 'PAID';

/**
 * Three answers, and none of them is a guess.
 *
 * NOTHING COLLECTS A BOOKING FEE YET — piece 4 does. Until then every row with
 * a fee reads UNPAID, which is true. The alternative, showing "Paid" or a dash
 * because no payments exist, would be a column that means nothing the day one
 * does.
 */
export function paymentStateOf(row: {
  bookingFeeAmount: Prisma.Decimal | number | string;
  bookingFeePaidAt: Date | null;
}): { state: PaymentState; amount: number; paidAt: Date | null } {
  const amount = Number(row.bookingFeeAmount);
  if (!(amount > 0)) return { state: 'NO_FEE', amount: 0, paidAt: null };
  return {
    state: row.bookingFeePaidAt ? 'PAID' : 'UNPAID',
    amount,
    paidAt: row.bookingFeePaidAt,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export { clinicDateKey };
