import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, Prisma } from '@prisma/client';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentStaffId } from '../core/tenant-context';
import { clinicDateKey, parseDateOnly, zonedWallClockToInstant } from './time.util';
import { SlotAvailabilityService } from './slot-availability.service';

/**
 * The six tabs, and what each one actually means in stored terms.
 *
 * `RESCHEDULED` appears in NONE of them, deliberately. That status marks the
 * OLD row of a move — the booking still exists, at its new time, as a
 * different row. Filing it under Cancelled would tell a clinic it lost a
 * booking it still has, and would make the cancellation count wrong. It stays
 * reachable as history through `rescheduledFrom`.
 */
export const TAB_STATUSES = {
  // REQUESTED is NOT here. A request is awaiting a decision, not a booking the
  // clinic is expecting; counting it in both tabs would double it on the stats
  // bar, and telling a clinic it has ten upcoming appointments when three of
  // them might be declined is a worse answer than telling it seven and three.
  UPCOMING: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.REMINDED,
    AppointmentStatus.ARRIVED,
    AppointmentStatus.IN_QUEUE,
  ],
  COMPLETED: [AppointmentStatus.COMPLETED],
  NO_SHOW: [AppointmentStatus.NO_SHOW],
  CANCELLED: [AppointmentStatus.CANCELLED],
  REQUESTS: [AppointmentStatus.REQUESTED],
  // See `TO_BE_SCHEDULED` below — it is a time comparison, not a status set.
  TO_BE_SCHEDULED: [AppointmentStatus.CONFIRMED, AppointmentStatus.REMINDED],
} as const;

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

    // POTENTIAL SALES — what this period is worth if every live appointment
    // happens. Booking fees are read from the SNAPSHOT on each row (what the
    // patient was actually committed to); service prices are read LIVE from
    // the catalogue, because nobody has agreed to pay them yet and an estimate
    // of future revenue should use today's price list.
    //
    // Only live appointments count. A cancellation is not potential revenue,
    // and counting one would make the figure grow every time a clinic lost
    // business. Pending REQUESTS are excluded for the same reason in reverse:
    // nobody has agreed to them yet, and a figure that counts requests would
    // fall when one was declined without any business being lost.
    const live = await this.prisma.appointment.findMany({
      where: { ...base, status: { in: [...TAB_STATUSES.UPCOMING] } },
      select: { bookingFeeAmount: true, service: { select: { price: true } } },
    });
    const potentialSales = live.reduce(
      (total, row) => total + Number(row.bookingFeeAmount) + Number(row.service?.price ?? 0),
      0,
    );

    // REALISED is not asked for on the bar, but it is half of "potential vs
    // realised" in the reports brief and costs one more reduce. Kept here so
    // the report does not invent a second definition of the same subtraction.
    const completed = await this.prisma.appointment.findMany({
      where: { ...base, status: AppointmentStatus.COMPLETED },
      select: { bookingFeeAmount: true, service: { select: { price: true } } },
    });
    const realisedSales = completed.reduce(
      (total, row) => total + Number(row.bookingFeeAmount) + Number(row.service?.price ?? 0),
      0,
    );

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
      potentialSales: round2(potentialSales),
      realisedSales: round2(realisedSales),
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
      },
    });

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      source: row.source,
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
      },
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
      // The old row of a move is not a booking anybody has — see TAB_STATUSES.
      status: { not: AppointmentStatus.RESCHEDULED },
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
