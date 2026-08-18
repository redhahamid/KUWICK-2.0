import { Inject, Injectable } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { TERMINAL_APPOINTMENT_STATUSES } from './appointment-status.constants';
import {
  clinicDateKey,
  clinicDayBounds,
  combineInClinicZone,
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
 */
export type UnavailableReason =
  | 'CLINIC_CLOSED'
  | 'NOT_ROSTERED'
  | 'NOT_QUALIFIED'
  | 'SERVICE_NOT_BOOKABLE'
  | 'OUTSIDE_BOOKING_WINDOW'
  | 'FULLY_BOOKED'
  | 'TOO_LATE_TO_BOOK';

export interface AvailabilityResult {
  slots: AvailableSlot[];
  /** Null when slots were found. Never null when the list is empty. */
  reason: UnavailableReason | null;
}

interface RosterWindow {
  start: Date;
  end: Date;
}

const MINUTE_MS = 60 * 1000;

/**
 * THE SLOT & CAPACITY ENGINE — the one path every booking goes through.
 *
 * Front desk, calendar drag-and-drop, the canvas follow-up card and the public
 * patient page all ask this and nothing else. A second store of "what's free"
 * is how a clinic ends up double-booked by two screens that each believed
 * themselves.
 *
 * Six constraints, all server-side, in the order a person would apply them:
 *
 *   1. Is the CLINIC open that day?            `ClinicClosedDate`
 *   2. Is the service bookable at all?          `ServiceCatalog.bookable`
 *   3. May this doctor perform it?              `DoctorServiceQualification`
 *   4. Is the doctor rostered?                  `ScheduleException` > `DoctorSchedule`
 *   5. Is it inside the clinic's booking window and past its notice period?
 *                                               `ClinicBookingSettings`
 *   6. Is there room — for the doctor, for the service, for the day?
 *                                               overlap + concurrent + daily
 *
 * EVERY comparison happens in the clinic's wall clock, converted through
 * `Clinic.timezone`. See the block comment in `time.util.ts` for why that is
 * not optional and why UTC test runners hid it.
 */
@Injectable()
export class SlotAvailabilityService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
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

  async findAvailability(query: AvailabilityQuery): Promise<AvailabilityResult> {
    const timeZone = await this.clinicTimeZone(query.clinicId);

    // --- 1. The building ----------------------------------------------------
    const closed = await this.prisma.clinicClosedDate.findFirst({
      where: { clinicId: query.clinicId, date: query.date },
      select: { id: true },
    });
    if (closed) {
      return { slots: [], reason: 'CLINIC_CLOSED' };
    }

    // --- 2. The service -----------------------------------------------------
    const service = await this.prisma.serviceCatalog.findUnique({
      where: { id: query.serviceId },
      select: {
        bookable: true,
        active: true,
        durationMinutesDefault: true,
        slotIntervalMinutes: true,
        concurrentLimit: true,
      },
    });
    if (!service || !service.active || !service.bookable) {
      return { slots: [], reason: 'SERVICE_NOT_BOOKABLE' };
    }

    // --- 3. The doctor's qualification --------------------------------------
    // The mapping is the source of who can be booked for what (piece 1's
    // rule), so an unmapped pair produces nothing here rather than being
    // caught later by the booking validator. A slot that cannot be booked must
    // never be offered.
    const qualified = await this.prisma.doctorServiceQualification.findFirst({
      where: { staffId: query.staffId, serviceId: query.serviceId },
      select: { id: true },
    });
    if (!qualified) {
      return { slots: [], reason: 'NOT_QUALIFIED' };
    }

    // --- 4. The roster ------------------------------------------------------
    const windows = await this.resolveRosterWindows(query, timeZone);
    if (windows.length === 0) {
      return { slots: [], reason: 'NOT_ROSTERED' };
    }

    // --- 5. The clinic's own window and notice ------------------------------
    const settings = await this.prisma.clinicBookingSettings.findFirst({
      where: { clinicId: query.clinicId },
      select: { firstSessionTime: true, lastSessionTime: true, minimumNoticeMinutes: true },
    });

    const clamped = settings
      ? this.clampToBookingWindow(windows, query.date, settings, timeZone)
      : windows;
    if (clamped.length === 0) {
      return { slots: [], reason: 'OUTSIDE_BOOKING_WINDOW' };
    }

    const notBefore = new Date(
      (query.now?.getTime() ?? Date.now()) + (settings?.minimumNoticeMinutes ?? 0) * MINUTE_MS,
    );

    // --- 6. Room ------------------------------------------------------------
    // The slice: how OFTEN a slot starts. The duration: how LONG it runs. A
    // 30-minute service on a 15-minute interval offers 09:00, 09:15, 09:30 —
    // they overlap, and whether that is allowed is the concurrent limit's
    // answer, not this loop's.
    const perDoctor = await this.prisma.slotCapacityConfig.findFirst({
      where: { staffId: query.staffId, clinicId: query.clinicId, serviceId: query.serviceId },
      select: { slotLengthMinutes: true, dailyCapacity: true },
    });
    const durationMs =
      (perDoctor?.slotLengthMinutes ?? service.durationMinutesDefault) * MINUTE_MS;
    const strideMs =
      (service.slotIntervalMinutes ?? perDoctor?.slotLengthMinutes ?? service.durationMinutesDefault) *
      MINUTE_MS;

    const { start: dayStart, end: dayEnd } = clinicDayBounds(query.date, timeZone);
    const notThisOne = query.excludeAppointmentId
      ? { id: { not: query.excludeAppointmentId } }
      : {};

    // A day's worth of this doctor's time for this service. A GATE, not a
    // truncation: with a cap of 5 and 4 already booked, exactly one more
    // booking may be made and the patient may pick ANY free slot for it.
    // Slicing the list to its first entry — what this used to do — let them
    // pick only the earliest, and made "is this slot bookable" unanswerable
    // from the offered list, which is what the booking validator now asks.
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
      if (booked >= perDoctor.dailyCapacity) {
        return { slots: [], reason: 'FULLY_BOOKED' };
      }
    }

    // The DOCTOR's day: any appointment at all, whatever the service. One
    // doctor, one patient.
    const doctorBusy = await this.prisma.appointment.findMany({
      where: {
        staffId: query.staffId,
        status: { notIn: TERMINAL_APPOINTMENT_STATUSES },
        scheduledStart: { gte: dayStart, lt: dayEnd },
        ...notThisOne,
      },
      select: { scheduledStart: true, scheduledEnd: true },
    });

    // The SERVICE's day, across every doctor: the room or the machine.
    const serviceBusy =
      service.concurrentLimit == null
        ? []
        : await this.prisma.appointment.findMany({
            where: {
              clinicId: query.clinicId,
              serviceId: query.serviceId,
              status: { notIn: TERMINAL_APPOINTMENT_STATUSES },
              scheduledStart: { gte: dayStart, lt: dayEnd },
              ...notThisOne,
            },
            select: { scheduledStart: true, scheduledEnd: true },
          });

    const overlaps = (
      rows: { scheduledStart: Date; scheduledEnd: Date }[],
      start: Date,
      end: Date,
    ) => rows.filter((row) => start < row.scheduledEnd && end > row.scheduledStart).length;

    let sawSlot = false;
    let everyCandidateWasTooSoon = true;
    const slots: AvailableSlot[] = [];

    for (const window of clamped) {
      for (
        let cursor = window.start.getTime();
        cursor + durationMs <= window.end.getTime();
        cursor += strideMs
      ) {
        sawSlot = true;
        const start = new Date(cursor);
        const end = new Date(cursor + durationMs);

        if (start < notBefore) continue;
        everyCandidateWasTooSoon = false;

        if (overlaps(doctorBusy, start, end) > 0) continue;
        if (service.concurrentLimit != null && overlaps(serviceBusy, start, end) >= service.concurrentLimit) {
          continue;
        }
        slots.push({ start, end });
      }
    }

    if (slots.length > 0) return { slots, reason: null };
    if (!sawSlot) return { slots, reason: 'OUTSIDE_BOOKING_WINDOW' };
    if (everyCandidateWasTooSoon) return { slots, reason: 'TOO_LATE_TO_BOOK' };
    return { slots, reason: 'FULLY_BOOKED' };
  }

  /**
   * The clinic's window narrows the doctor's, it never widens it. A doctor
   * rostered 08:00-20:00 at a clinic that books 09:00-17:00 is offered
   * 09:00-17:00; a doctor rostered 10:00-15:00 at the same clinic is still
   * offered 10:00-15:00.
   */
  private clampToBookingWindow(
    windows: RosterWindow[],
    date: Date,
    settings: { firstSessionTime: Date; lastSessionTime: Date },
    timeZone: string,
  ): RosterWindow[] {
    const open = combineInClinicZone(date, settings.firstSessionTime, timeZone).getTime();
    // The LAST SESSION is the last time a slot may START, so the bookable band
    // runs to that time plus nothing — a slot beginning exactly at the last
    // session is offered, one beginning a minute later is not. The duration
    // check in the loop is what stops a 17:00 slot running past a 17:00 close;
    // the clinic decides which it means by where it sets the number.
    const close = combineInClinicZone(date, settings.lastSessionTime, timeZone).getTime();

    return windows
      .map((window) => ({
        start: new Date(Math.max(window.start.getTime(), open)),
        end: new Date(Math.min(window.end.getTime(), close)),
      }))
      .filter((window) => window.end > window.start);
  }

  private async resolveRosterWindows(
    query: AvailabilityQuery,
    timeZone: string,
  ): Promise<RosterWindow[]> {
    // A per-date override wins outright: a doctor who wrote "24 Dec, unavailable"
    // is not rostered that day whatever the weekly pattern says.
    const exception = await this.prisma.scheduleException.findFirst({
      where: { staffId: query.staffId, clinicId: query.clinicId, date: query.date },
    });
    if (exception) {
      if (!exception.startTime || !exception.endTime) {
        return [];
      }
      return [
        {
          start: combineInClinicZone(query.date, exception.startTime, timeZone),
          end: combineInClinicZone(query.date, exception.endTime, timeZone),
        },
      ];
    }

    // The weekday is the CLINIC's, read off the date column itself — a
    // date-only column carries no zone and 20 August is a Thursday everywhere.
    const dayOfWeek = query.date.getUTCDay();
    const schedules = await this.prisma.doctorSchedule.findMany({
      where: {
        staffId: query.staffId,
        clinicId: query.clinicId,
        dayOfWeek,
        effectiveFrom: { lte: query.date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: query.date } }],
      },
    });
    return schedules.map((schedule) => ({
      start: combineInClinicZone(query.date, schedule.startTime, timeZone),
      end: combineInClinicZone(query.date, schedule.endTime, timeZone),
    }));
  }
}

/** Re-exported so callers building a slot instant use the one conversion. */
export { zonedWallClockToInstant, clinicDateKey, timeToMinutesOfDay };
