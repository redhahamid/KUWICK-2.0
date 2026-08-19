import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveStatus, ProviderShiftType, Role } from '@prisma/client';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { PrismaService } from '../core/prisma.service';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import { assertCanPerformAppointmentAction } from './appointment-authorization';
import {
  CopyRosterDto,
  CreateProviderShiftDto,
  SetScheduleModeDto,
  UpdateProviderShiftDto,
} from './dto/provider-shift.dto';
import { clinicDateKey, parseDateOnly, parseTimeToDate, zonedWallClockToInstant } from './time.util';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RosterCell {
  date: string;
  shifts: {
    id: string;
    shiftType: ProviderShiftType;
    startTime: string;
    endTime: string;
    crossesMidnight: boolean;
    bookableStartTime: string | null;
    bookableEndTime: string | null;
    note: string | null;
  }[];
  /** Approved HR leave covering this date. NOT copied into a shift row. */
  leave: { leaveType: string } | null;
}

export interface RosterRow {
  staffId: string;
  fullName: string;
  scheduleMode: string;
  calendarColor: string | null;
  cells: Record<string, RosterCell>;
}

export interface RosterMatrix {
  clinicId: string;
  month: string;
  timeZone: string;
  dates: string[];
  /** Dates the BUILDING is shut, which no roster cell can override. */
  closedDates: Record<string, string | null>;
  providers: RosterRow[];
}

/**
 * THE ROSTER — one canonical provider scheduling domain.
 *
 * The audit found two screens writing `doctor_schedules` with opposite mental
 * models, one of which deleted the other's effective-dated rows on every save.
 * The resolution is not "pick a winner": it is one DOMAIN with two modes, and
 * a provider is in exactly one of them.
 *
 *   ROSTER_LINKED — `ProviderShift` rows are the truth. A monthly matrix, one
 *       row per provider, one column per date, cells holding as many shifts as
 *       the day really has. This is what a rotating clinic runs on.
 *
 *   FIXED_WEEKLY — a standing `DoctorSchedule` pattern is the truth, edited on
 *       the weekly form, and now end-dated rather than deleted when it changes.
 *       This is what most single-doctor clinics have, and moving them to a
 *       monthly matrix would be work with no benefit.
 *
 * NOTHING HERE DUPLICATES HR. Approved leave is READ from `LeaveRequest` and
 * shown in the cell; it is never copied into a shift row, because two records
 * of the same absence is how they come to disagree. The `LEAVE` shift type
 * exists for the different case: an absence the roster knows about that HR has
 * no request for.
 */
@Injectable()
export class ProviderShiftService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * THE MONTHLY MATRIX, in one pass. Four queries for the whole month rather
   * than one per provider per day — a 12-provider clinic over 31 days is 372
   * cells, and 372 queries is a screen that takes a minute to open.
   */
  async month(clinicId: string, month: string): Promise<RosterMatrix> {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('Month must be written as YYYY-MM.');
    }
    const timeZone = await this.timeZoneOf(clinicId);
    const dates = datesInMonth(month);
    const first = parseDateOnly(dates[0]);
    const last = parseDateOnly(dates[dates.length - 1]);

    const [providers, shifts, leave, closed] = await Promise.all([
      this.prisma.staff.findMany({
        // BOOKABLE providers only — the same DOCTOR_ROLES gate the engine's
        // assertActiveDoctor applies. Before this, every active staff row
        // (finance, front desk) rendered as a weekly-availability entry
        // reading "No working days configured", which is noise pretending
        // to be a roster (found in the §36 visual review).
        where: { clinicId, active: true, role: { in: [Role.DOCTOR_RESIDENT, Role.DOCTOR_LOCUM] } },
        select: {
          id: true,
          fullName: true,
          appointmentScheduleMode: true,
          calendarColor: true,
          professionalType: true,
        },
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.providerShift.findMany({
        where: { clinicId, shiftDate: { gte: first, lte: last } },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          status: LeaveStatus.APPROVED,
          startDate: { lte: last },
          endDate: { gte: first },
        },
        select: { staffId: true, startDate: true, endDate: true, leaveType: true },
      }),
      this.prisma.clinicClosedDate.findMany({
        where: { clinicId, date: { gte: first, lte: last } },
        select: { date: true, reason: true },
      }),
    ]);

    const byStaff = new Map<string, RosterRow>();
    for (const provider of providers) {
      byStaff.set(provider.id, {
        staffId: provider.id,
        fullName: provider.fullName,
        scheduleMode: provider.appointmentScheduleMode,
        calendarColor: provider.calendarColor,
        cells: Object.fromEntries(
          dates.map((date) => [date, { date, shifts: [], leave: null } as RosterCell]),
        ),
      });
    }

    for (const shift of shifts) {
      const row = byStaff.get(shift.staffId);
      if (!row) continue;
      const date = shift.shiftDate.toISOString().slice(0, 10);
      const cell = row.cells[date];
      if (!cell) continue;
      const startKey = clinicDateKey(shift.startsAt, timeZone);
      const endKey = clinicDateKey(shift.endsAt, timeZone);
      cell.shifts.push({
        id: shift.id,
        shiftType: shift.shiftType,
        startTime: wallClock(shift.startsAt, timeZone),
        endTime: wallClock(shift.endsAt, timeZone),
        // The roster screen has to be able to draw "11PM–9AM" as one cell with
        // a marker, not as two rows on two dates.
        crossesMidnight: startKey !== endKey,
        bookableStartTime: shift.bookableStartsAt ? wallClock(shift.bookableStartsAt, timeZone) : null,
        bookableEndTime: shift.bookableEndsAt ? wallClock(shift.bookableEndsAt, timeZone) : null,
        note: shift.note,
      });
    }

    for (const request of leave) {
      const row = byStaff.get(request.staffId);
      if (!row) continue;
      for (
        let cursor = request.startDate.getTime();
        cursor <= request.endDate.getTime();
        cursor += DAY_MS
      ) {
        const date = new Date(cursor).toISOString().slice(0, 10);
        const cell = row.cells[date];
        if (cell) cell.leave = { leaveType: request.leaveType };
      }
    }

    return {
      clinicId,
      month,
      timeZone,
      dates,
      closedDates: Object.fromEntries(
        closed.map((row) => [row.date.toISOString().slice(0, 10), row.reason]),
      ),
      providers: [...byStaff.values()],
    };
  }

  /** The shifts overlapping a date range, for the calendar's working-hours shading. */
  async range(clinicId: string, from: string, to: string) {
    const timeZone = await this.timeZoneOf(clinicId);
    const rows = await this.prisma.providerShift.findMany({
      where: {
        clinicId,
        shiftDate: { gte: parseDateOnly(from), lte: parseDateOnly(to) },
      },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map((shift) => ({
      id: shift.id,
      staffId: shift.staffId,
      shiftType: shift.shiftType,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      bookableStartsAt: shift.bookableStartsAt,
      bookableEndsAt: shift.bookableEndsAt,
      note: shift.note,
      timeZone,
    }));
  }

  async create(dto: CreateProviderShiftDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'MANAGE_ROSTER');

      const timeZone = await this.timeZoneOf(dto.clinicId);
      assertBookableBandIsWhole(dto.bookableStartTime, dto.bookableEndTime);

      const rows = dto.dates.map((date) => {
        const span = wallClockSpan(date, dto.startTime, dto.endTime, timeZone);
        const bookable =
          dto.bookableStartTime && dto.bookableEndTime
            ? wallClockSpan(date, dto.bookableStartTime, dto.bookableEndTime, timeZone)
            : null;
        if (bookable && (bookable.start < span.start || bookable.end > span.end)) {
          throw new BadRequestException(
            'Bookable hours have to sit inside the shift — a provider cannot take bookings when they are not there.',
          );
        }
        return {
          tenantId: currentTenantId(),
          clinicId: dto.clinicId,
          staffId: dto.staffId,
          shiftDate: parseDateOnly(date),
          startsAt: span.start,
          endsAt: span.end,
          shiftType: dto.shiftType ?? ProviderShiftType.WORKING,
          bookableStartsAt: bookable?.start ?? null,
          bookableEndsAt: bookable?.end ?? null,
          note: dto.note?.trim() || null,
          createdByStaffId: currentStaffId() ?? null,
        };
      });

      if (dto.replaceExisting) {
        await tx.providerShift.deleteMany({
          where: {
            clinicId: dto.clinicId,
            staffId: dto.staffId,
            shiftDate: { in: dto.dates.map(parseDateOnly) },
          },
        });
      }

      await tx.providerShift.createMany({ data: rows });
      return { created: rows.length };
    });
  }

  async update(id: string, dto: UpdateProviderShiftDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'MANAGE_ROSTER');

      const shift = await tx.providerShift.findUnique({ where: { id } });
      if (!shift) throw new NotFoundException('Shift not found');

      const timeZone = await this.timeZoneOf(shift.clinicId);
      const date = shift.shiftDate.toISOString().slice(0, 10);
      const startTime = dto.startTime ?? wallClock(shift.startsAt, timeZone);
      const endTime = dto.endTime ?? wallClock(shift.endsAt, timeZone);
      const span = wallClockSpan(date, startTime, endTime, timeZone);

      assertBookableBandIsWhole(dto.bookableStartTime, dto.bookableEndTime);
      const bookable =
        dto.bookableStartTime && dto.bookableEndTime
          ? wallClockSpan(date, dto.bookableStartTime, dto.bookableEndTime, timeZone)
          : null;

      return tx.providerShift.update({
        where: { id },
        data: {
          startsAt: span.start,
          endsAt: span.end,
          shiftType: dto.shiftType ?? shift.shiftType,
          bookableStartsAt: bookable?.start ?? null,
          bookableEndsAt: bookable?.end ?? null,
          note: dto.note === undefined ? shift.note : dto.note.trim() || null,
        },
      });
    });
  }

  /**
   * Removing a shift does NOT cancel the appointments booked into it.
   *
   * An appointment is an agreement with a patient; a roster row is a statement
   * about who was expected to be there. Deleting the second must never
   * silently discard the first — the clinic is told what is now orphaned and
   * decides what to do about it.
   */
  async remove(id: string) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'MANAGE_ROSTER');

      const shift = await tx.providerShift.findUnique({ where: { id } });
      if (!shift) throw new NotFoundException('Shift not found');

      const orphaned = await tx.appointment.count({
        where: {
          staffId: shift.staffId,
          clinicId: shift.clinicId,
          status: { in: ['REQUESTED', 'CONFIRMED', 'REMINDED'] },
          scheduledStart: { gte: shift.startsAt, lt: shift.endsAt },
        },
      });

      await tx.providerShift.delete({ where: { id } });
      return { removed: true, orphanedAppointments: orphaned };
    });
  }

  /**
   * COPY A MONTH. The single most common roster act, and the reason a clinic
   * either keeps a roster up to date or gives up on it.
   *
   * Aligned by WEEKDAY, not by day-of-month: a roster is a weekly rhythm, and
   * copying the 1st to the 1st turns a Monday pattern into a Thursday one. The
   * source month's first matching weekday maps to the target month's first,
   * and so on.
   */
  async copyMonth(dto: CopyRosterDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'MANAGE_ROSTER');

      const timeZone = await this.timeZoneOf(dto.clinicId);
      const source = datesInMonth(dto.fromMonth);
      const target = datesInMonth(dto.toMonth);

      const shifts = await tx.providerShift.findMany({
        where: {
          clinicId: dto.clinicId,
          shiftDate: {
            gte: parseDateOnly(source[0]),
            lte: parseDateOnly(source[source.length - 1]),
          },
          ...(dto.staffIds?.length ? { staffId: { in: dto.staffIds } } : {}),
        },
      });
      if (shifts.length === 0) return { created: 0, skipped: 0 };

      // Weekday buckets for the target month, consumed in order.
      const targetByWeekday = new Map<number, string[]>();
      for (const date of target) {
        const day = parseDateOnly(date).getUTCDay();
        targetByWeekday.set(day, [...(targetByWeekday.get(day) ?? []), date]);
      }
      const sourceByWeekday = new Map<number, string[]>();
      for (const date of source) {
        const day = parseDateOnly(date).getUTCDay();
        sourceByWeekday.set(day, [...(sourceByWeekday.get(day) ?? []), date]);
      }

      const mapped = new Map<string, string>();
      for (const [day, sourceDates] of sourceByWeekday) {
        const targetDates = targetByWeekday.get(day) ?? [];
        sourceDates.forEach((date, index) => {
          // A fifth Monday with no counterpart is dropped rather than folded
          // onto the fourth — a doubled shift is worse than a missing one,
          // because nobody looks for it.
          if (targetDates[index]) mapped.set(date, targetDates[index]);
        });
      }

      const rows: Record<string, unknown>[] = [];
      let skipped = 0;
      for (const shift of shifts) {
        const from = shift.shiftDate.toISOString().slice(0, 10);
        const to = mapped.get(from);
        if (!to) {
          skipped += 1;
          continue;
        }
        const span = wallClockSpan(
          to,
          wallClock(shift.startsAt, timeZone),
          wallClock(shift.endsAt, timeZone),
          timeZone,
        );
        const bookable =
          shift.bookableStartsAt && shift.bookableEndsAt
            ? wallClockSpan(
                to,
                wallClock(shift.bookableStartsAt, timeZone),
                wallClock(shift.bookableEndsAt, timeZone),
                timeZone,
              )
            : null;
        rows.push({
          tenantId: currentTenantId(),
          clinicId: shift.clinicId,
          staffId: shift.staffId,
          shiftDate: parseDateOnly(to),
          startsAt: span.start,
          endsAt: span.end,
          shiftType: shift.shiftType,
          bookableStartsAt: bookable?.start ?? null,
          bookableEndsAt: bookable?.end ?? null,
          note: shift.note,
          sourceScheduleId: shift.id,
          createdByStaffId: currentStaffId() ?? null,
        });
      }

      // The target month is REPLACED for the providers being copied. A copy
      // that merged would double every shift the second time somebody pressed
      // the button, and pressing it twice is what people do when a page is
      // slow.
      const staffIds = [...new Set(rows.map((row) => row.staffId as string))];
      if (staffIds.length > 0) {
        await tx.providerShift.deleteMany({
          where: {
            clinicId: dto.clinicId,
            staffId: { in: staffIds },
            shiftDate: {
              gte: parseDateOnly(target[0]),
              lte: parseDateOnly(target[target.length - 1]),
            },
          },
        });
      }
      await tx.providerShift.createMany({ data: rows as never });
      return { created: rows.length, skipped };
    });
  }

  /**
   * Which model this provider's availability comes from.
   *
   * Switching is deliberately NOT destructive: the other model's rows stay
   * where they are and simply stop being read. A clinic that tries the monthly
   * roster for a month and goes back finds its weekly pattern intact.
   */
  async setScheduleMode(dto: SetScheduleModeDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'MANAGE_ROSTER');
      return tx.staff.update({
        where: { id: dto.staffId },
        data: { appointmentScheduleMode: dto.mode },
        select: { id: true, fullName: true, appointmentScheduleMode: true },
      });
    });
  }

  private async timeZoneOf(clinicId: string): Promise<string> {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { timezone: true },
    });
    return clinic?.timezone ?? 'Asia/Kuala_Lumpur';
  }
}

/**
 * A wall-clock span on one clinic date, as two instants.
 *
 * An end at or BEFORE the start is an overnight shift and rolls to the next
 * day. This is the single place that decision is made, and it is why nothing
 * downstream needs a `crossesMidnight` flag to compute with.
 */
function wallClockSpan(
  date: string,
  startTime: string,
  endTime: string,
  timeZone: string,
): { start: Date; end: Date } {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const [year, month, day] = date.split('-').map(Number);

  const start = zonedWallClockToInstant(
    { year, month, day, hour: startHour, minute: startMinute },
    timeZone,
  );
  const endsNextDay = endHour * 60 + endMinute <= startHour * 60 + startMinute;
  const endDate = endsNextDay
    ? new Date(parseDateOnly(date).getTime() + DAY_MS).toISOString().slice(0, 10)
    : date;
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
  const end = zonedWallClockToInstant(
    { year: endYear, month: endMonth, day: endDay, hour: endHour, minute: endMinute },
    timeZone,
  );
  return { start, end };
}

function wallClock(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

function assertBookableBandIsWhole(start: string | undefined, end: string | undefined): void {
  if (Boolean(start) !== Boolean(end)) {
    throw new BadRequestException(
      'Bookable hours need both a start and an end. One on its own would read as "bookable until whenever" and quietly widen the roster.',
    );
  }
}

/** Every clinic-local date in a YYYY-MM month, as YYYY-MM-DD. */
export function datesInMonth(month: string): string[] {
  const [year, monthNumber] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from(
    { length: days },
    (_unused, index) => `${month}-${String(index + 1).padStart(2, '0')}`,
  );
}

/** Re-exported so a caller building a time uses the one parser. */
export { parseTimeToDate };
