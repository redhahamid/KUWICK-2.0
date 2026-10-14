import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveStatus, ProviderScheduleMode, ProviderShiftType, Role } from '@prisma/client';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { PrismaService } from '../core/prisma.service';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import { requireScopeAny } from '../finance/admin-actor';
import { assertCanPerformAppointmentAction } from './appointment-authorization';
import {
  CopyRosterDto,
  CreateProviderShiftDto,
  SetScheduleModeDto,
  UpdateProviderShiftDto,
} from './dto/provider-shift.dto';
import { ProviderScheduleModeService } from './provider-schedule-mode.service';
import {
  WorkforceCategory,
  isBookableProvider,
  workforceCategoryOf,
} from '../workforce/workforce-category';
import { clinicDateKey, parseDateOnly, parseTimeToDate, zonedWallClockToInstant } from './time.util';
import { OpeningHours, resolveAttendancePolicy } from '../workforce/attendance-policy';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The template a shift is rostered from: this tenant's, active, and for every
 * branch or this one (UAT, 14 October 2026).
 */
async function templateFor(tx: Parameters<Parameters<typeof withTenantTx>[1]>[0], id: string, clinicId: string) {
  const template = await tx.shiftTemplate.findFirst({ where: { id, active: true, OR: [{ clinicId: null }, { clinicId }] } });
  if (!template) throw new BadRequestException('That shift template is retired or belongs to another branch. Choose another.');
  return template;
}

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
    /** The template it was rostered from, with the copy of its break and night flag. */
    template: { id: string; name: string; colour: string } | null;
    breakMinutes: number;
    night: boolean;
  }[];
  /** Approved HR leave covering this date. NOT copied into a shift row. */
  leave: { leaveType: string } | null;
}

export interface RosterRow {
  staffId: string;
  fullName: string;
  /** The mode governing the FIRST day of the requested month — not a column read. */
  scheduleMode: string;
  /** The next scheduled mode change on or after that day, so the board can say "Weekly from 01 Sep". */
  modeChange: { mode: string; effectiveFrom: string } | null;
  /** The mode governing TODAY (clinic calendar), whatever month is on screen. */
  modeToday: string;
  /** Every change scheduled after today, in order — the plan the scheduling dialog edits. */
  upcomingChanges: { mode: string; effectiveFrom: string }[];
  calendarColor: string | null;
  /** Which part of the workforce this person is, for the board's filter. */
  category: WorkforceCategory;
  role: Role;
  /**
   * Whether appointments can be booked into this person's shifts.
   *
   * FALSE for most of the roster now that it holds the whole workforce, and
   * the board uses it to decide whether to show the availability apparatus at
   * all: a receptionist has a real shift and no bookable window, and offering
   * them a "bookable hours" field would be offering a setting that does
   * nothing.
   */
  bookable: boolean;
  cells: Record<string, RosterCell>;
}

export interface RosterMatrix {
  clinicId: string;
  month: string;
  timeZone: string;
  dates: string[];
  /** Dates the BUILDING is shut, which no roster cell can override. */
  closedDates: Record<string, string | null>;
  /** How many of each category exist, BEFORE the filter — the chips' numbers. */
  categoryCounts: Record<WorkforceCategory, number>;
  /** The branch's week start (0 Sunday … 6 Saturday) and opening hours, from its attendance settings. */
  weekStartDay: number;
  openingHours: OpeningHours | null;
  providers: RosterRow[];
}

function countBy(rows: RosterRow[]): Record<WorkforceCategory, number> {
  const counts: Record<WorkforceCategory, number> = {
    DOCTOR: 0,
    CLINICAL: 0,
    ADMIN: 0,
    MANAGEMENT: 0,
    OTHER: 0,
  };
  for (const row of rows) counts[row.category] += 1;
  return counts;
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
    private readonly scheduleMode: ProviderScheduleModeService,
  ) {}

  /**
   * THE MONTHLY MATRIX, in one pass. Four queries for the whole month rather
   * than one per provider per day — a 12-provider clinic over 31 days is 372
   * cells, and 372 queries is a screen that takes a minute to open.
   */
  async month(clinicId: string, month: string, category?: WorkforceCategory): Promise<RosterMatrix> {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('Month must be written as YYYY-MM.');
    }
    return this.matrix(clinicId, datesInMonth(month), month, category);
  }

  /**
   * ONE WEEK OF THE ROSTER (UAT, 14 October 2026): "weekly staff roster
   * view". Seven days from the branch's own week start: a date that is not
   * one moves back to the start of its week, so the board and a bookmark
   * agree whichever day was asked for.
   */
  async week(clinicId: string, start: string, category?: WorkforceCategory): Promise<RosterMatrix> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(parseDateOnly(start).getTime())) {
      throw new BadRequestException('The week is given by a date, YYYY-MM-DD.');
    }
    const policies = await this.prisma.attendancePolicy.findMany({ where: { OR: [{ clinicId }, { clinicId: null }] } });
    const { weekStartDay } = resolveAttendancePolicy(policies, clinicId);
    const asked = parseDateOnly(start);
    const back = (asked.getUTCDay() - weekStartDay + 7) % 7;
    const first = new Date(asked.getTime() - back * DAY_MS);
    const dates = Array.from({ length: 7 }, (_, index) => new Date(first.getTime() + index * DAY_MS).toISOString().slice(0, 10));
    return this.matrix(clinicId, dates, dates[0].slice(0, 7), category);
  }

  /** The board for any run of dates: a month or a week. */
  private async matrix(clinicId: string, dates: string[], month: string, category?: WorkforceCategory): Promise<RosterMatrix> {
    // WHO MAY READ THIS BOARD, AND FOR WHICH BRANCH. The board ran on the
    // JWT alone: any account in the tenant could name any branch and read its
    // whole workforce, shifts and leave. Now the branch is one the account
    // holds — resolved the way every HR read resolves it — under either the
    // Appointments module's permission or HR's.
    const { scope } = await requireScopeAny(this.rawPrisma, ['appointment.view', 'hr.view']);
    const branch = scope.require(clinicId);
    const timeZone = await this.timeZoneOf(branch);
    const first = parseDateOnly(dates[0]);
    const last = parseDateOnly(dates[dates.length - 1]);

    const [providers, shifts, leave, closed, policies] = await Promise.all([
      // THE WHOLE WORKFORCE, not only the doctors.
      //
      // This read was `role: { in: [DOCTOR_RESIDENT, DOCTOR_LOCUM] }`, and the
      // reason was sound at the time: every other active staff row rendered as
      // a weekly-availability entry reading "No working days configured",
      // which is noise pretending to be a roster. But hiding them meant a
      // receptionist could not be scheduled at all, and a clinic runs on more
      // than its doctors. The answer is to give a non-provider a row that
      // MEANS something — shifts, no bookable window, no scheduling mode —
      // rather than to leave them off the board.
      //
      // `ProviderShift` always accepted any staffId and `create()` never had a
      // doctor guard, so nothing below this line changes: the same table, the
      // same rows, more of the people who are in it.
      this.prisma.staff.findMany({
        where: {
          clinicId: branch,
          active: true,
          role: { not: Role.PATIENT_PORTAL },
        },
        select: {
          id: true,
          fullName: true,
          role: true,
          appointmentScheduleMode: true,
          calendarColor: true,
          professionalType: true,
        },
        orderBy: { fullName: 'asc' },
      }),
      this.prisma.providerShift.findMany({
        where: { clinicId: branch, shiftDate: { gte: first, lte: last } },
        orderBy: { startsAt: 'asc' },
        include: { template: { select: { id: true, name: true, colour: true } } },
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
        where: { clinicId: branch, date: { gte: first, lte: last } },
        select: { date: true, reason: true },
      }),
      this.prisma.attendancePolicy.findMany({ where: { OR: [{ clinicId: branch }, { clinicId: null }] } }),
    ]);
    const policy = resolveAttendancePolicy(policies, branch);

    // The board asks THE resolver, exactly as the availability engine does —
    // a mode is a fact about a date. Twice, for two different questions: the
    // month's first day decides which section of the board a provider renders
    // in (a September view after a 1 Sep switch shows the new world), while
    // TODAY anchors the planning data — the scheduling dialog always plans
    // from now, whatever month is on screen. The legacy staff column is only
    // the resolver's no-periods fallback.
    const providerIds = providers.map((provider) => provider.id);
    const today = parseDateOnly(clinicDateKey(new Date(), timeZone));
    const [modes, modesToday] = await Promise.all([
      this.scheduleMode.resolveModesFor(providerIds, first),
      this.scheduleMode.resolveModesFor(providerIds, today),
    ]);

    const serialize = (change: { mode: string; effectiveFrom: Date }) => ({
      mode: change.mode,
      effectiveFrom: change.effectiveFrom.toISOString().slice(0, 10),
    });
    const byStaff = new Map<string, RosterRow>();
    for (const provider of providers) {
      const resolved = modes.get(provider.id);
      const planning = modesToday.get(provider.id);
      const bookable = isBookableProvider(provider);
      byStaff.set(provider.id, {
        staffId: provider.id,
        fullName: provider.fullName,
        role: provider.role,
        category: workforceCategoryOf(provider),
        bookable,
        // SCHEDULING MODE IS A BOOKING CONCEPT. FIXED_WEEKLY means "a standing
        // pattern decides this provider's availability", which is a sentence
        // about appointments. A receptionist has no availability to decide, so
        // they are always their shifts and nothing else — reporting a mode for
        // them would put a control on screen that governs nothing.
        scheduleMode: bookable ? resolved?.mode ?? provider.appointmentScheduleMode : 'ROSTER_LINKED',
        modeChange: bookable && resolved?.upcoming[0] ? serialize(resolved.upcoming[0]) : null,
        modeToday: bookable ? planning?.mode ?? provider.appointmentScheduleMode : 'ROSTER_LINKED',
        upcomingChanges: bookable ? (planning?.upcoming ?? []).map(serialize) : [],
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
        template: shift.template,
        breakMinutes: shift.breakMinutes,
        night: shift.night,
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
      // FILTERED LAST, not in the query. The counts below are what the board's
      // filter chips show, and they have to be counts of the WHOLE workforce —
      // a chip reading "Doctors 3" that disappears the moment you click it is
      // a filter that has forgotten what it is filtering.
      categoryCounts: countBy([...byStaff.values()]),
      weekStartDay: policy.weekStartDay,
      openingHours: policy.openingHours,
      providers: [...byStaff.values()].filter((row) => !category || row.category === category),
    };
  }

  /** The shifts overlapping a date range, for the calendar's working-hours shading. */
  async range(clinicId: string, from: string, to: string) {
    const { scope } = await requireScopeAny(this.rawPrisma, ['appointment.view', 'hr.view']);
    const branch = scope.require(clinicId);
    const timeZone = await this.timeZoneOf(branch);
    const rows = await this.prisma.providerShift.findMany({
      where: {
        clinicId: branch,
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
      const template = dto.templateId ? await templateFor(tx, dto.templateId, dto.clinicId) : null;
      const startTime = template?.kind === 'WORKING' ? template.startTime! : dto.startTime;
      const endTime = template?.kind === 'WORKING' ? template.endTime! : dto.endTime;
      const shiftType = template ? (template.kind === 'OFF' ? ProviderShiftType.OFF : dto.shiftType === ProviderShiftType.LOCUM ? ProviderShiftType.LOCUM : ProviderShiftType.WORKING) : (dto.shiftType ?? ProviderShiftType.WORKING);

      const rows = dto.dates.map((date) => {
        const span = wallClockSpan(date, startTime, endTime, timeZone);
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
          shiftType,
          bookableStartsAt: bookable?.start ?? null,
          bookableEndsAt: bookable?.end ?? null,
          note: dto.note?.trim() || null,
          createdByStaffId: currentStaffId() ?? null,
          templateId: template?.id ?? null,
          breakMinutes: template?.breakMinutes ?? 0,
          night: template?.night ?? false,
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
      const template = dto.templateId ? await templateFor(tx, dto.templateId, shift.clinicId) : null;
      const fromTemplate = template?.kind === 'WORKING';
      const startTime = fromTemplate ? template.startTime! : (dto.startTime ?? wallClock(shift.startsAt, timeZone));
      const endTime = fromTemplate ? template.endTime! : (dto.endTime ?? wallClock(shift.endsAt, timeZone));
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
          shiftType: template?.kind === 'OFF' ? ProviderShiftType.OFF : template && shift.shiftType === ProviderShiftType.OFF ? ProviderShiftType.WORKING : (dto.shiftType ?? shift.shiftType),
          bookableStartsAt: bookable?.start ?? null,
          bookableEndsAt: bookable?.end ?? null,
          note: dto.note === undefined ? shift.note : dto.note.trim() || null,
          // A template given: its id, break and night flag. Null: none of them.
          ...(dto.templateId !== undefined
            ? { templateId: template?.id ?? null, breakMinutes: template?.breakMinutes ?? 0, night: template?.night ?? false }
            : {}),
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
          templateId: shift.templateId,
          breakMinutes: shift.breakMinutes,
          night: shift.night,
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
   * Which model this provider's availability comes from — recorded as a
   * DECISION WITH A DATE, not a flag flip.
   *
   * This writes one `ProviderScheduleModePeriod` row and NEVER touches
   * `Staff.appointmentScheduleMode` again: two independently editable mode
   * values is how they come to disagree, and nothing needs a background job
   * on the effective day because the resolver simply starts matching the new
   * period. Re-deciding a date that has not arrived yet (including today) is
   * an upsert on the same effective date — a correction, not history. The
   * past is refused here AND by a database trigger, because a retroactive
   * mode change would silently re-mean every availability answer already
   * given for those days.
   *
   * Switching is deliberately NOT destructive: the other model's rows stay
   * where they are and simply stop being read from the effective date. A
   * clinic that tries the monthly roster for a month and goes back finds its
   * weekly pattern intact — and the decisions themselves stay on record
   * (Monthly → Weekly → Monthly is three rows, not an edit war).
   */
  async setScheduleMode(dto: SetScheduleModeDto) {
    const written = await withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'MANAGE_ROSTER');

      const staff = await tx.staff.findUnique({
        where: { id: dto.staffId },
        select: { id: true, fullName: true, clinicId: true, appointmentScheduleMode: true },
      });
      if (!staff) throw new NotFoundException('Provider not found');
      if (!staff.clinicId) {
        throw new BadRequestException(
          'This provider is not attached to a clinic, so no scheduling model can govern them yet.',
        );
      }

      const clinic = await tx.clinic.findUnique({
        where: { id: staff.clinicId },
        select: { timezone: true },
      });
      const timeZone = clinic?.timezone ?? 'Asia/Kuala_Lumpur';
      const today = clinicDateKey(new Date(), timeZone);
      if (dto.effectiveFrom < today) {
        throw new BadRequestException(
          `The effective date has already passed at the clinic (today there is ${today}). ` +
            'A scheduling model applies from a date forward — it cannot be changed for days that already happened.',
        );
      }

      const uniqueKey = {
        tenantId: currentTenantId(),
        staffId: staff.id,
        effectiveFrom: parseDateOnly(dto.effectiveFrom),
      };
      // Whether this call REPLACES a decision already scheduled for the same
      // date — needed below to tell "withdrawn" apart from "nothing to do".
      const priorSameDate = await tx.providerScheduleModePeriod.findUnique({
        where: { tenantId_staffId_effectiveFrom: uniqueKey },
        select: { mode: true },
      });

      const period = await tx.providerScheduleModePeriod.upsert({
        where: { tenantId_staffId_effectiveFrom: uniqueKey },
        create: {
          ...uniqueKey,
          clinicId: staff.clinicId,
          mode: dto.mode,
          createdByStaffId: currentStaffId() ?? null,
        },
        update: { mode: dto.mode, createdByStaffId: currentStaffId() ?? null },
        select: { mode: true, effectiveFrom: true },
      });

      // CONSOLIDATION — a decision that decides nothing is not kept. Walk the
      // timeline oldest-first carrying the mode in force (starting from the
      // legacy fallback, exactly as the resolver does); any TODAY-OR-FUTURE
      // period that repeats the mode already in force is removed — including,
      // possibly, the row just written ("Weekly from 1 Oct" when Weekly
      // already runs from 1 Sep decides nothing; re-deciding 1 Sep back to
      // the current mode withdraws that change entirely). Past rows are never
      // touched: they governed real days, and the trigger refuses anyway.
      const timeline = await tx.providerScheduleModePeriod.findMany({
        where: { staffId: staff.id },
        orderBy: { effectiveFrom: 'asc' },
        select: { id: true, mode: true, effectiveFrom: true },
      });
      let modeInForce: ProviderScheduleMode =
        staff.appointmentScheduleMode ?? ProviderScheduleMode.FIXED_WEEKLY;
      const removedRedundant: { mode: ProviderScheduleMode; effectiveFrom: string }[] = [];
      for (const row of timeline) {
        const key = row.effectiveFrom.toISOString().slice(0, 10);
        if (row.mode === modeInForce && key >= today) {
          await tx.providerScheduleModePeriod.delete({ where: { id: row.id } });
          removedRedundant.push({ mode: row.mode, effectiveFrom: key });
        } else {
          modeInForce = row.mode;
        }
      }

      const applied = !removedRedundant.some((row) => row.effectiveFrom === dto.effectiveFrom);
      return {
        staff,
        today,
        period,
        applied,
        // The write landed on a date that held a DIFFERENT scheduled decision
        // and the result consolidated away: that change is now withdrawn.
        withdrew: !applied && priorSameDate !== null && priorSameDate.mode !== dto.mode,
        removedRedundant: removedRedundant.filter((row) => row.effectiveFrom !== dto.effectiveFrom),
      };
    });

    // Answered OUTSIDE the transaction through the one resolver, so the
    // response reports what the engine will actually do — not what this
    // method believes it just arranged.
    const [modeToday, upcoming] = await Promise.all([
      this.scheduleMode.resolveMode(written.staff.id, parseDateOnly(written.today)),
      this.prisma.providerScheduleModePeriod.findMany({
        where: { staffId: written.staff.id, effectiveFrom: { gt: parseDateOnly(written.today) } },
        orderBy: { effectiveFrom: 'asc' },
        select: { mode: true, effectiveFrom: true },
      }),
    ]);
    return {
      staffId: written.staff.id,
      fullName: written.staff.fullName,
      mode: written.period.mode,
      effectiveFrom: written.period.effectiveFrom.toISOString().slice(0, 10),
      applied: written.applied,
      withdrew: written.withdrew,
      removedRedundant: written.removedRedundant,
      modeToday,
      upcoming: upcoming.map((row) => ({
        mode: row.mode,
        effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      })),
    };
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
