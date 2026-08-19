import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { StaffService } from '../hr/staff.service';
import { SlotAvailabilityService, UnavailableReason } from './slot-availability.service';
import { clinicDateKey, parseDateOnly } from './time.util';

export interface BookingRequest {
  clinicId: string;
  staffId: string;
  serviceId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  // Set when re-validating a reschedule, so the appointment being replaced
  // doesn't count against its own overlap/capacity check.
  excludeAppointmentId?: string;
  /** Injectable so the minimum-notice cut is testable and not a race. */
  now?: Date;
}

/**
 * The outcome of asking. `ok: false` carries BOTH the machine reason — so an
 * override can name precisely which rule it set aside — and the sentence a
 * person reads.
 */
export type BookingCheck =
  | { ok: true }
  | { ok: false; reason: UnavailableReason | 'OFF_GRID' | 'WRONG_LENGTH'; message: string };

/**
 * What to tell the person, per reason the engine gave. Written for a front
 * desk and a patient, not for a developer: every one of these ends up in a
 * toast, a reschedule refusal, or a public booking page.
 */
const REFUSALS: Record<UnavailableReason, string> = {
  CLINIC_CLOSED: 'The clinic is closed on that date.',
  PUBLIC_HOLIDAY: 'That is a public holiday and this branch is closed.',
  SERVICE_NOT_BOOKABLE: 'That service cannot be booked.',
  ON_LEAVE: 'That doctor is on approved leave that day.',
  PROVIDER_BLOCKED: 'That doctor is not available at that time.',
  NOT_ROSTERED: "That time is outside the doctor's roster.",
  NOT_QUALIFIED: 'This doctor is not set up to perform that service.',
  OUTSIDE_SERVICE_HOURS: 'That service is not offered at that time of day.',
  OUTSIDE_BOOKING_WINDOW: "That time is outside the clinic's booking hours.",
  TOO_LATE_TO_BOOK: 'That is too soon — the clinic needs more notice than that.',
  TOO_FAR_AHEAD: 'That is further ahead than this clinic takes bookings.',
  FULLY_BOOKED: 'There is no room left for that service on that date.',
};

const OFF_GRID_MESSAGE =
  'That time is no longer available — it is taken, or it is not one of the clinic’s slots.';
const WRONG_LENGTH_MESSAGE =
  'That start time is available, but not for that length of appointment.';

/**
 * REASONS THAT MAY BE OVERRIDDEN by somebody holding `appointment.override`.
 *
 * A deliberately SHORT list. An override exists so a clinic can squeeze a
 * patient in against its own scheduling conventions — a full diary, a slot
 * off the grid, notice it would normally insist on. It does not exist to book
 * a doctor who is on approved leave, into a branch that is shut, or for a
 * service they are not qualified to perform: those are not conventions, they
 * are facts about the world, and a system that lets a manager click past them
 * is a system that will eventually put a patient in front of nobody.
 */
export const OVERRIDABLE_REASONS: ReadonlySet<string> = new Set([
  'FULLY_BOOKED',
  'TOO_LATE_TO_BOOK',
  'TOO_FAR_AHEAD',
  'OUTSIDE_BOOKING_WINDOW',
  'OUTSIDE_SERVICE_HOURS',
  'OFF_GRID',
  'WRONG_LENGTH',
]);

// ===========================================================================
// ONE PATH, AND THIS IS HOW IT STAYS ONE.
//
// This validator used to re-derive the roster, the exception, the overlap and
// the daily cap from the same tables the availability engine reads — the same
// rules, written twice, with `isWithinWindow` comparing time-of-day through
// UTC getters while the engine sliced the day its own way. Two implementations
// of "is this bookable" is how a screen offers a slot the server then refuses,
// and how a clinic gets double-booked by two surfaces that each believed
// themselves.
//
// So it does not re-derive anything. It ASKS THE ENGINE for the day's slots
// and checks the requested time is one of them. Every constraint the engine
// learns — closed dates, approved leave, buffers, horizons, room limits — is
// enforced here the moment it is written there, because there is nothing here
// to keep in step.
//
// The consequence is deliberate and wanted: a booking must land ON the grid.
// A reschedule that drops an appointment at 09:07 is refused with a reason
// rather than quietly creating a slot nobody can ever book beside.
//
// The `appointments_no_overlap` EXCLUDE constraint stays the database-level
// backstop for the racing case; this produces the friendly message for the
// common one, and `AppointmentService` takes an advisory lock so the two
// racers are serialised rather than one of them meeting a raw constraint
// violation.
// ===========================================================================
@Injectable()
export class AppointmentBookingValidator {
  constructor(
    private readonly staffService: StaffService,
    private readonly availability: SlotAvailabilityService,
  ) {}

  /**
   * Throws on refusal. The form every existing caller uses.
   */
  async validate(request: BookingRequest): Promise<void> {
    const result = await this.check(request);
    if (result.ok) return;
    // FULLY_BOOKED and a taken slot are races with another booking, not
    // malformed requests: 409, so a caller can retry a different slot. The
    // rest are the request itself being wrong for the clinic's configuration:
    // 422.
    throw result.reason === 'FULLY_BOOKED' || result.reason === 'OFF_GRID'
      ? new ConflictException(result.message)
      : new UnprocessableEntityException(result.message);
  }

  /**
   * Answers instead of throwing, so an override can name what it set aside.
   * `validate` is this plus the exception, and there is no second rule set.
   */
  async check(request: BookingRequest): Promise<BookingCheck> {
    await this.staffService.assertActiveDoctor(request.staffId);

    const timeZone = await this.availability.clinicTimeZone(request.clinicId);
    // The date is the CLINIC's calendar date for that instant. A 23:30 booking
    // in Kuala Lumpur is 15:30Z — reading the UTC date off it would ask the
    // engine about the wrong day, which is exactly how an overnight booking
    // gets refused for being on a day the doctor does not work.
    const date = parseDateOnly(clinicDateKey(request.scheduledStart, timeZone));

    const { slots, reason } = await this.availability.findAvailability({
      staffId: request.staffId,
      clinicId: request.clinicId,
      serviceId: request.serviceId,
      date,
      now: request.now,
      excludeAppointmentId: request.excludeAppointmentId,
    });

    if (reason) return { ok: false, reason, message: REFUSALS[reason] };

    const requestedStart = request.scheduledStart.getTime();
    const requestedEnd = request.scheduledEnd.getTime();
    const exact = slots.find(
      (slot) => slot.start.getTime() === requestedStart && slot.end.getTime() === requestedEnd,
    );
    if (exact) return { ok: true };

    // The slot exists but is the wrong length, versus the time is not a slot
    // at all. Different problems, different words, and different statuses.
    const startsOnTheGrid = slots.some((slot) => slot.start.getTime() === requestedStart);
    return startsOnTheGrid
      ? { ok: false, reason: 'WRONG_LENGTH', message: WRONG_LENGTH_MESSAGE }
      : { ok: false, reason: 'OFF_GRID', message: OFF_GRID_MESSAGE };
  }
}
