import { Inject, Injectable } from '@nestjs/common';
import { LeaveStatus, ProviderScheduleMode, ProviderShiftType } from '@prisma/client';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { ProviderScheduleModeService } from './provider-schedule-mode.service';
import { TERMINAL_APPOINTMENT_STATUSES } from './appointment-status.constants';
import {
  clinicDateKey,
  clinicDayBounds,
  combineInClinicZone,
  parseDateOnly,
  timeToMinutesOfDay,
  zonedWallClockToInstant,
} from './time.util';

export interface AvailabilityQuery {
  staffId: string;
  clinicId: string;
  serviceId: string;
  /** The clinic's calendar date, carried as UTC midnight (`parseDateOnly`). */
  date: Date;
  /**
   * "Now", for the minimum-notice cut. Injectable so a test can state the
   * moment instead of racing the wall clock, and so the public page and the
   * front desk cut against the same instant.
   */
  now?: Date;
  /**
   * The appointment being RESCHEDULED, which must not count against itself.
   * Without it, moving a 09:00 booking to 09:30 is refused by the 09:00
   * booking — the appointment blocking the move is the one being moved.
   */
  excludeAppointmentId?: string;
}

export interface AvailableSlot {
  start: Date;
  end: Date;
}

/**
 * Why a date offers nothing. The front desk asking "why can't I book Tuesday"
 * deserves an answer, and the public page cannot invent one.
 *
 * The ORDER of this union is the order of §27's precedence, and the engine
 * returns the FIRST reason that applies — "the clinic is shut" beats "the
 * doctor is on leave" beats "they are not rostered", because that is the order
 * a person would say them in and the first one is the one that matters.
 */
export type UnavailableReason =
  | 'CLINIC_CLOSED'
  | 'PUBLIC_HOLIDAY'
  | 'SERVICE_NOT_BOOKABLE'
  | 'ON_LEAVE'
  | 'PROVIDER_BLOCKED'
  | 'NOT_ROSTERED'
  | 'NOT_QUALIFIED'
  | 'OUTSIDE_SERVICE_HOURS'
  | 'OUTSIDE_BOOKING_WINDOW'
  | 'TOO_LATE_TO_BOOK'
  | 'TOO_FAR_AHEAD'
  | 'FULLY_BOOKED';

export interface AvailabilityResult {
  slots: AvailableSlot[];
  /** Null when slots were found. Never null when the list is empty. */
  reason: UnavailableReason | null;
}

/** One provider's answer, when the question was "anybody who can do this". */
export interface ProviderAvailability extends AvailabilityResult {
  staffId: string;
}

interface Window {
  start: Date;
  end: Date;
}

/** An appointment occupying time, WITH the turnover its service needs. */
interface OccupiedInterval {
  /** The appointment itself. */
  start: number;
  end: number;
  /** The appointment plus its own buffers — what nothing else may sit inside. */
  paddedStart: number;
  paddedEnd: number;
  serviceId: string;
}

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Shift types that OFFER time. Everything else records why nobody is there. */
const WORKING_SHIFT_TYPES: ProviderShiftType[] = [
  ProviderShiftType.WORKING,
  ProviderShiftType.LOCUM,
];

/**
 * THE SLOT & CAPACITY ENGINE — the one path every booking goes through.
 *
 * Front desk, the calendar, the canvas follow-up card, the public patient page
 * and patient self-reschedule all ask this and nothing else. A second store of
 * "what's free" is how a clinic ends up double-booked by two screens that each
 * believed themselves.
 *
 * THE PRECEDENCE (§27), applied in this order, first refusal wins:
 *
 *   1.  Is the BUILDING shut?                   `ClinicClosedDate`
 *   2.  Is it a public holiday this branch observes?  `PublicHoliday`
 *   3.  Is the service bookable at all?          `ServiceCatalog.bookable`
 *   4.  Is the provider on APPROVED LEAVE?       `LeaveRequest`
 *   5.  Is the provider OFF / BLOCKED that day?  `ProviderShift`, `ScheduleException`
 *   6.  Is the provider rostered?                `ProviderShift` | `DoctorSchedule`
 *   7.  May this provider perform it?            `DoctorServiceQualification`
 *   8.  Inside the SERVICE's own bookable hours? `ServiceBookableHour`
 *   9.  Inside the CLINIC's booking band?        `ClinicBookingSettings`
 *   10. Duration + interval + buffers            service config
 *   11. Notice and horizon                       service overrides clinic
 *   12. Existing bookings, provider conflicts, capacity
 *
 * EVERY comparison happens in the clinic's wall clock, converted through
 * `Clinic.timezone`. See the block comment in `time.util.ts` for why that is
 * not optional and why UTC test runners hid it.
 *
 * TWO SCHEDULING MODES, ONE ENGINE (§2). A provider is either ROSTER_LINKED —
 * their `ProviderShift` rows are the truth — or FIXED_WEEKLY, where a standing
 * `DoctorSchedule` pattern is. A clinic maintains one of the two, never both,
 * and which one governs A GIVEN DATE is answered by `ProviderScheduleModeService`
 * (§18b) — an effective-dated decision, not a flag — so the engine never guesses.
 */
@Injectable()
export class SlotAvailabilityService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly scheduleMode: ProviderScheduleModeService,
  ) {}

  /**
   * The clinic's zone, for callers that must ask the engine about the right
   * calendar day. Exposed rather than re-read, so there is one answer.
   */
  async clinicTimeZone(clinicId: string): Promise<string> {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { timezone: true },
    });
    return clinic?.timezone ?? 'Asia/Kuala_Lumpur';
  }

  /** The list-only form every existing caller uses. */
  async findAvailableSlots(query: AvailabilityQuery): Promise<AvailableSlot[]> {
    const { slots } = await this.findAvailability(query);
    return slots;
  }

  /**
   * §32 — "any available provider". Asks the SAME engine once per qualified,
   * active provider rather than inventing a second rule set, and returns each
   * one's answer so the caller can show the earliest and still say why the
   * others offered nothing.
   *
   * The result deliberately keeps a real `staffId` on every slot: a confirmed
   * appointment is never attached to a fictional "Any Provider" resource.
   */
  async findAvailabilityAcrossProviders(
    query: Omit<AvailabilityQuery, 'staffId'>,
  ): Promise<ProviderAvailability[]> {
    const qualified = await this.prisma.doctorServiceQualification.findMany({
      where: { serviceId: query.serviceId },
      select: { staffId: true },
    });
    if (qualified.length === 0) return [];

    const providers = await this.prisma.staff.findMany({
      where: {
        id: { in: qualified.map((row) => row.staffId) },
        active: true,
        OR: [{ clinicId: query.clinicId }, { clinicId: null }],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    const answers: ProviderAvailability[] = [];
    for (const provider of providers) {
      const result = await this.findAvailability({ ...query, staffId: provider.id });
      answers.push({ staffId: provider.id, ...result });
    }
    return answers;
  }

  async findAvailability(query: AvailabilityQuery): Promise<AvailabilityResult> {
    const timeZone = await this.clinicTimeZone(query.clinicId);
    const { start: dayStart, end: dayEnd } = clinicDayBounds(query.date, timeZone);

    // --- 1. The building ----------------------------------------------------
    const closed = await this.prisma.clinicClosedDate.findFirst({
      where: { clinicId: query.clinicId, date: query.date },
      select: { id: true },
    });
    if (closed) return { slots: [], reason: 'CLINIC_CLOSED' };

    const settings = await this.prisma.clinicBookingSettings.findFirst({
      where: { clinicId: query.clinicId },
      select: {
        firstSessionTime: true,
        lastSessionTime: true,
        minimumNoticeMinutes: true,
        maxAdvanceDays: true,
        observePublicHolidays: true,
      },
    });

    // --- 2. The national calendar, IF this branch observes it ---------------
    // Tenant-wide by design (a Malaysian public holiday is national or state,
    // not per-branch), and opt-in per branch because plenty of clinics open on
    // one. This is why `PublicHoliday` and `ClinicClosedDate` are not
    // duplicates: one is the calendar, the other is this building's decision.
    if (settings?.observePublicHolidays) {
      const holiday = await this.prisma.publicHoliday.findFirst({
        where: { date: query.date },
        select: { id: true },
      });
      if (holiday) return { slots: [], reason: 'PUBLIC_HOLIDAY' };
    }

    // --- 3. The service -----------------------------------------------------
    const service = await this.prisma.serviceCatalog.findUnique({
      where: { id: query.serviceId },
      select: {
        bookable: true,
        active: true,
        durationMinutesDefault: true,
        slotIntervalMinutes: true,
        concurrentLimit: true,
        bufferBeforeMinutes: true,
        bufferAfterMinutes: true,
        maxAdvanceDays: true,
        minimumNoticeMinutes: true,
      },
    });
    if (!service || !service.active || !service.bookable) {
      return { slots: [], reason: 'SERVICE_NOT_BOOKABLE' };
    }

    // --- 4. Approved leave --------------------------------------------------
    // THE BUG THIS CLOSES: `LeaveRequest` has been live in HR since phase 1c
    // with statuses, approvers and date ranges, and the availability engine had
    // never heard of it. A doctor on approved annual leave was still offered
    // for booking, and the only way to stop it was for somebody to type the
    // same absence a second time as a schedule exception. Leave is entered
    // once, by the person who takes it, and it blocks the diary from there.
    const onLeave = await this.prisma.leaveRequest.findFirst({
      where: {
        staffId: query.staffId,
        status: LeaveStatus.APPROVED,
        startDate: { lte: query.date },
        endDate: { gte: query.date },
      },
      select: { id: true },
    });
    if (onLeave) return { slots: [], reason: 'ON_LEAVE' };

    // --- 5 & 6. The roster --------------------------------------------------
    const roster = await this.resolveRosterWindows(query, timeZone, dayStart, dayEnd);
    if (roster.refusal) return { slots: [], reason: roster.refusal };
    if (roster.windows.length === 0) return { slots: [], reason: 'NOT_ROSTERED' };

    // --- 7. The provider's qualification ------------------------------------
    // The mapping is the source of who can be booked for what, so an unmapped
    // pair produces nothing here rather than being caught later by the booking
    // validator. A slot that cannot be booked must never be offered.
    const qualified = await this.prisma.doctorServiceQualification.findFirst({
      where: { staffId: query.staffId, serviceId: query.serviceId },
      select: { id: true },
    });
    if (!qualified) return { slots: [], reason: 'NOT_QUALIFIED' };

    // --- 8. The service's own bookable hours --------------------------------
    // A doctor works 09:00-17:00; ear microsuction is only offered in the
    // mornings. Absence of rows means "whenever the provider is free", which is
    // the normal case and why this is a table and not two columns.
    const serviceHours = await this.prisma.serviceBookableHour.findMany({
      where: { serviceId: query.serviceId, dayOfWeek: query.date.getUTCDay() },
      select: { startTime: true, endTime: true },
    });
    let windows = roster.windows;
    if (serviceHours.length > 0) {
      const allowed = serviceHours.map((row) => ({
        start: combineInClinicZone(query.date, row.startTime, timeZone),
        end: combineInClinicZone(query.date, row.endTime, timeZone),
      }));
      windows = intersectAll(windows, allowed);
      if (windows.length === 0) return { slots: [], reason: 'OUTSIDE_SERVICE_HOURS' };
    }

    // --- 9. The clinic's booking band ---------------------------------------
    // NARROWS the provider's roster, never widens it. Both ends are nullable:
    // a 24-hour clinic has no first or last session, and the hard 09:00-17:00
    // default this column used to carry silently amputated a night roster.
    if (settings && (settings.firstSessionTime || settings.lastSessionTime)) {
      const open = settings.firstSessionTime
        ? combineInClinicZone(query.date, settings.firstSessionTime, timeZone).getTime()
        : dayStart.getTime();
      const close = settings.lastSessionTime
        ? combineInClinicZone(query.date, settings.lastSessionTime, timeZone).getTime()
        : dayEnd.getTime();
      windows = intersectAll(windows, [{ start: new Date(open), end: new Date(close) }]);
      if (windows.length === 0) return { slots: [], reason: 'OUTSIDE_BOOKING_WINDOW' };
    }

    // --- 10 & 11. Slicing, buffers, notice and horizon ----------------------
    const perDoctor = await this.prisma.slotCapacityConfig.findFirst({
      where: { staffId: query.staffId, clinicId: query.clinicId, serviceId: query.serviceId },
      select: { slotLengthMinutes: true, dailyCapacity: true },
    });

    // The DURATION is how long the appointment runs. The INTERVAL is how often
    // one may start. They are not the same number: a 45-minute service on a
    // 30-minute interval offers 09:00, 09:30, 10:00 — and every candidate must
    // still have 45 free minutes plus its buffers behind it.
    const durationMs = (perDoctor?.slotLengthMinutes ?? service.durationMinutesDefault) * MINUTE_MS;
    const strideMs =
      (service.slotIntervalMinutes ??
        perDoctor?.slotLengthMinutes ??
        service.durationMinutesDefault) * MINUTE_MS;
    const bufferBeforeMs = service.bufferBeforeMinutes * MINUTE_MS;
    const bufferAfterMs = service.bufferAfterMinutes * MINUTE_MS;

    const now = query.now ?? new Date();
    const noticeMinutes = service.minimumNoticeMinutes ?? settings?.minimumNoticeMinutes ?? 0;
    const notBefore = new Date(now.getTime() + noticeMinutes * MINUTE_MS);

    // THE HORIZON. A service's own limit wins over the clinic's, and neither
    // existing means no limit — a clinic that has not thought about this should
    // not find its diary silently truncated. Compared as CLINIC DATES: "30 days
    // ahead" is a date somebody can point at on a calendar, not an instant.
    const maxAdvanceDays = service.maxAdvanceDays ?? settings?.maxAdvanceDays ?? null;
    if (maxAdvanceDays != null) {
      const todayKey = clinicDateKey(now, timeZone);
      const horizon = new Date(parseDateOnly(todayKey).getTime() + maxAdvanceDays * DAY_MS);
      if (query.date.getTime() > horizon.getTime()) {
        return { slots: [], reason: 'TOO_FAR_AHEAD' };
      }
    }

    // --- 12. Room -----------------------------------------------------------
    const notThisOne = query.excludeAppointmentId
      ? { id: { not: query.excludeAppointmentId } }
      : {};

    // A day's worth of this provider's time for this service. A GATE, not a
    // truncation: with a cap of 5 and 4 already booked, exactly one more
    // booking may be made and the patient may pick ANY free slot for it.
    if (perDoctor?.dailyCapacity != null) {
      const booked = await this.prisma.appointment.count({
        where: {
          staffId: query.staffId,
          clinicId: query.clinicId,
          serviceId: query.serviceId,
          status: { notIn: TERMINAL_APPOINTMENT_STATUSES },
          scheduledStart: { gte: dayStart, lt: dayEnd },
          ...notThisOne,
        },
      });
      if (booked >= perDoctor.dailyCapacity) return { slots: [], reason: 'FULLY_BOOKED' };
    }

    // Everything already in the diary that could collide, in ONE query rather
    // than one per concern. Widened by a day either side because a buffer, or
    // an appointment that started yesterday evening, can reach into today.
    const busy = await this.loadOccupied({
      clinicId: query.clinicId,
      staffId: query.staffId,
      serviceId: query.serviceId,
      from: new Date(dayStart.getTime() - DAY_MS),
      to: new Date(dayEnd.getTime() + DAY_MS),
      excludeAppointmentId: query.excludeAppointmentId,
    });

    let sawSlot = false;
    let everyCandidateWasTooSoon = true;
    const slots: AvailableSlot[] = [];

    for (const window of windows) {
      for (
        let cursor = window.start.getTime();
        cursor + durationMs <= window.end.getTime();
        cursor += strideMs
      ) {
        sawSlot = true;
        const start = cursor;
        const end = cursor + durationMs;
        // The provider needs the buffers too. The APPOINTMENT is start..end —
        // a 09:00 slot with a ten-minute lead-in still starts at 09:00 — but
        // nothing else may occupy the padded band around it.
        const paddedStart = start - bufferBeforeMs;
        const paddedEnd = end + bufferAfterMs;

        if (start < notBefore.getTime()) continue;
        everyCandidateWasTooSoon = false;

        // One provider, one patient — compared on the PADDED bands, so a
        // service needing fifteen minutes of turnover does not get booked
        // back-to-back with itself.
        if (busy.doctor.some((row) => paddedStart < row.paddedEnd && paddedEnd > row.paddedStart)) {
          continue;
        }

        // The room or the machine: how many of this service may run at once,
        // across every provider. Compared UNPADDED — capacity is about the
        // resource being in use, not about turnover.
        if (service.concurrentLimit != null) {
          const concurrent = busy.service.filter(
            (row) => start < row.end && end > row.start,
          ).length;
          if (concurrent >= service.concurrentLimit) continue;
        }

        slots.push({ start: new Date(start), end: new Date(end) });
      }
    }

    if (slots.length > 0) return { slots, reason: null };
    if (!sawSlot) return { slots, reason: 'OUTSIDE_BOOKING_WINDOW' };
    if (everyCandidateWasTooSoon) return { slots, reason: 'TOO_LATE_TO_BOOK' };
    return { slots, reason: 'FULLY_BOOKED' };
  }

  /**
   * What is already in the diary around this day, with each appointment's own
   * service buffers applied so the padding is the booked service's, not the
   * one being booked.
   */
  private async loadOccupied(params: {
    clinicId: string;
    staffId: string;
    serviceId: string;
    from: Date;
    to: Date;
    excludeAppointmentId?: string;
  }): Promise<{ doctor: OccupiedInterval[]; service: OccupiedInterval[] }> {
    const rows = await this.prisma.appointment.findMany({
      where: {
        clinicId: params.clinicId,
        status: { notIn: TERMINAL_APPOINTMENT_STATUSES },
        scheduledStart: { gte: params.from, lt: params.to },
        OR: [{ staffId: params.staffId }, { serviceId: params.serviceId }],
        ...(params.excludeAppointmentId ? { id: { not: params.excludeAppointmentId } } : {}),
      },
      select: {
        staffId: true,
        serviceId: true,
        scheduledStart: true,
        scheduledEnd: true,
        service: { select: { bufferBeforeMinutes: true, bufferAfterMinutes: true } },
      },
    });

    const doctor: OccupiedInterval[] = [];
    const service: OccupiedInterval[] = [];
    for (const row of rows) {
      const interval: OccupiedInterval = {
        start: row.scheduledStart.getTime(),
        end: row.scheduledEnd.getTime(),
        paddedStart:
          row.scheduledStart.getTime() - (row.service?.bufferBeforeMinutes ?? 0) * MINUTE_MS,
        paddedEnd: row.scheduledEnd.getTime() + (row.service?.bufferAfterMinutes ?? 0) * MINUTE_MS,
        serviceId: row.serviceId,
      };
      if (row.staffId === params.staffId) doctor.push(interval);
      if (row.serviceId === params.serviceId) service.push(interval);
    }
    return { doctor, service };
  }

  /**
   * WHEN THE PROVIDER IS THERE, in whichever model this provider uses.
   *
   * Returns windows already clipped to the clinic day, so an overnight shift
   * contributes its evening half to one date and its morning half to the next
   * — which is what a calendar draws and what a patient books into.
   */
  private async resolveRosterWindows(
    query: AvailabilityQuery,
    timeZone: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<{ windows: Window[]; refusal: UnavailableReason | null }> {
    // §18b — the mode is resolved FOR THE DATE BEING QUERIED, through the
    // one canonical resolver. "Weekly from 1 September" therefore answers a
    // 5 Sep search with the weekly pattern while a 25 Aug search still reads
    // the monthly roster — today's date plays no part.
    const mode = await this.scheduleMode.resolveMode(query.staffId, query.date);
    if (mode === ProviderScheduleMode.ROSTER_LINKED) {
      return this.rosterLinkedWindows(query, dayStart, dayEnd);
    }
    return this.fixedWeeklyWindows(query, timeZone, dayStart, dayEnd);
  }

  /**
   * ROSTER_LINKED — the monthly roster is the truth.
   *
   * Shifts are two INSTANTS, so a 23:00→09:00 shift needs no special case: it
   * simply intersects two clinic days. This is the model the old weekday +
   * start-time + end-time representation could not express, and the reason a
   * night doctor was silently unbookable.
   */
  private async rosterLinkedWindows(
    query: AvailabilityQuery,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<{ windows: Window[]; refusal: UnavailableReason | null }> {
    const shifts = await this.prisma.providerShift.findMany({
      where: {
        staffId: query.staffId,
        clinicId: query.clinicId,
        startsAt: { lt: dayEnd },
        endsAt: { gt: dayStart },
      },
      orderBy: { startsAt: 'asc' },
    });
    if (shifts.length === 0) return { windows: [], refusal: 'NOT_ROSTERED' };

    // A BLOCKED or LEAVE shift removes time from the day even where a WORKING
    // shift also covers it — "in the building, not bookable" is exactly what a
    // block means, and a doctor with a 14:00-15:00 block inside a 09:00-17:00
    // shift must be offered the two halves and not the middle.
    const blocks: Window[] = [];
    const working: Window[] = [];
    for (const shift of shifts) {
      const clipped = clip(
        {
          start: shift.bookableStartsAt ?? shift.startsAt,
          end: shift.bookableEndsAt ?? shift.endsAt,
        },
        dayStart,
        dayEnd,
      );
      if (!clipped) continue;
      if (WORKING_SHIFT_TYPES.includes(shift.shiftType)) working.push(clipped);
      else blocks.push(clip({ start: shift.startsAt, end: shift.endsAt }, dayStart, dayEnd)!);
    }

    if (working.length === 0) {
      // Nothing bookable, and the roster says why. OFF is not rostered; LEAVE
      // and BLOCKED are a provider who is unavailable for a stated reason.
      const stated = shifts.some(
        (shift) =>
          shift.shiftType === ProviderShiftType.LEAVE ||
          shift.shiftType === ProviderShiftType.BLOCKED,
      );
      return { windows: [], refusal: stated ? 'PROVIDER_BLOCKED' : 'NOT_ROSTERED' };
    }

    const windows = subtractAll(mergeWindows(working), mergeWindows(blocks));
    if (windows.length === 0) return { windows: [], refusal: 'PROVIDER_BLOCKED' };
    return { windows, refusal: null };
  }

  /**
   * FIXED_WEEKLY — a standing weekly pattern, kept because it is what most
   * single-doctor clinics actually have and forcing them onto a monthly matrix
   * would be work with no benefit.
   *
   * Handles overnight here too: a row whose end time is at or before its start
   * time means the shift runs into the following day, so it is read as
   * `start → end + 24h`. The PREVIOUS weekday is consulted for the same reason
   * — last night's shift can still be running this morning.
   *
   * `ScheduleException` keeps its meaning in this mode: a per-date override
   * wins outright, and a null window means unavailable that whole date.
   */
  private async fixedWeeklyWindows(
    query: AvailabilityQuery,
    timeZone: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<{ windows: Window[]; refusal: UnavailableReason | null }> {
    const exception = await this.prisma.scheduleException.findFirst({
      where: { staffId: query.staffId, clinicId: query.clinicId, date: query.date },
    });
    if (exception) {
      if (!exception.startTime || !exception.endTime) {
        return { windows: [], refusal: 'PROVIDER_BLOCKED' };
      }
      const window = clip(
        overnightAware(query.date, exception.startTime, exception.endTime, timeZone),
        dayStart,
        dayEnd,
      );
      return window ? { windows: [window], refusal: null } : { windows: [], refusal: 'NOT_ROSTERED' };
    }

    const previous = new Date(query.date.getTime() - DAY_MS);
    const rows = await this.prisma.doctorSchedule.findMany({
      where: {
        staffId: query.staffId,
        clinicId: query.clinicId,
        dayOfWeek: { in: [query.date.getUTCDay(), previous.getUTCDay()] },
        effectiveFrom: { lte: query.date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: previous } }],
      },
    });

    const windows: Window[] = [];
    for (const row of rows) {
      // The weekday is the CLINIC's, read off the date column itself — a
      // date-only column carries no zone and 20 August is a Thursday
      // everywhere. A row for yesterday's weekday is anchored to yesterday.
      const anchor = row.dayOfWeek === query.date.getUTCDay() ? query.date : previous;
      const clipped = clip(
        overnightAware(anchor, row.startTime, row.endTime, timeZone),
        dayStart,
        dayEnd,
      );
      if (clipped) windows.push(clipped);
    }

    return { windows: mergeWindows(windows), refusal: null };
  }
}

/**
 * A weekly row read as a real interval. `end <= start` is not a malformed row:
 * it is a shift that crosses midnight, which is what a night clinic runs, and
 * treating it as invalid is what made those doctors unbookable.
 */
function overnightAware(date: Date, startTime: Date, endTime: Date, timeZone: string): Window {
  const start = combineInClinicZone(date, startTime, timeZone);
  let end = combineInClinicZone(date, endTime, timeZone);
  if (end.getTime() <= start.getTime()) {
    end = combineInClinicZone(new Date(date.getTime() + DAY_MS), endTime, timeZone);
  }
  return { start, end };
}

function clip(window: Window, from: Date, to: Date): Window | null {
  const start = Math.max(window.start.getTime(), from.getTime());
  const end = Math.min(window.end.getTime(), to.getTime());
  return end > start ? { start: new Date(start), end: new Date(end) } : null;
}

/** Overlapping or touching windows become one, so a slot never starts twice. */
function mergeWindows(windows: Window[]): Window[] {
  if (windows.length <= 1) return windows;
  const sorted = [...windows].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Window[] = [sorted[0]];
  for (const window of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (window.start.getTime() <= last.end.getTime()) {
      if (window.end.getTime() > last.end.getTime()) last.end = window.end;
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

/** Every part of `windows` that is also inside one of `allowed`. */
function intersectAll(windows: Window[], allowed: Window[]): Window[] {
  const result: Window[] = [];
  for (const window of windows) {
    for (const band of allowed) {
      const clipped = clip(window, band.start, band.end);
      if (clipped) result.push(clipped);
    }
  }
  return mergeWindows(result);
}

/** Every part of `windows` that is NOT inside any of `blocks`. */
function subtractAll(windows: Window[], blocks: Window[]): Window[] {
  let result = windows;
  for (const block of blocks) {
    const next: Window[] = [];
    for (const window of result) {
      if (block.end <= window.start || block.start >= window.end) {
        next.push(window);
        continue;
      }
      if (block.start > window.start) next.push({ start: window.start, end: block.start });
      if (block.end < window.end) next.push({ start: block.end, end: window.end });
    }
    result = next;
  }
  return result;
}

/** Re-exported so callers building a slot instant use the one conversion. */
export { zonedWallClockToInstant, clinicDateKey, timeToMinutesOfDay };
