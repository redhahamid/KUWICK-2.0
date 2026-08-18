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
 * What to tell the person, per reason the engine gave. Written for a front
 * desk and a patient, not for a developer: every one of these ends up in a
 * toast, a drag-and-drop refusal, or a public booking page.
 */
const REFUSALS: Record<UnavailableReason, string> = {
  CLINIC_CLOSED: 'The clinic is closed on that date.',
  NOT_ROSTERED: "That time is outside the doctor's roster, or they are away that day.",
  NOT_QUALIFIED: 'This doctor is not set up to perform that service.',
  SERVICE_NOT_BOOKABLE: 'That service cannot be booked.',
  OUTSIDE_BOOKING_WINDOW: "That time is outside the clinic's booking hours.",
  FULLY_BOOKED: 'There is no room left for that service on that date.',
  TOO_LATE_TO_BOOK: 'That is too soon — the clinic needs more notice than that.',
};

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
// learns — closed dates, the clinic's window, minimum notice, concurrent
// room limits — is enforced here the moment it is written there, because
// there is nothing here to keep in step.
//
// The consequence is deliberate and wanted: a booking must land ON the grid.
// A drag-and-drop that drops an appointment at 09:07 is refused with a reason
// rather than quietly creating a slot nobody can ever book beside.
//
// The `appointments_no_overlap` EXCLUDE constraint stays the database-level
// backstop for the racing case (see the add_appointment_module migration);
// this produces the friendly message for the common one.
// ===========================================================================
@Injectable()
export class AppointmentBookingValidator {
  constructor(
    private readonly staffService: StaffService,
    private readonly availability: SlotAvailabilityService,
  ) {}

  async validate(request: BookingRequest): Promise<void> {
    await this.staffService.assertActiveDoctor(request.staffId);

    const clinic = await this.availability.clinicTimeZone(request.clinicId);
    // The date is the CLINIC's calendar date for that instant. A 23:30 booking
    // in Kuala Lumpur is 15:30Z — reading the UTC date off it would ask the
    // engine about the wrong day.
    const date = parseDateOnly(clinicDateKey(request.scheduledStart, clinic));

    const { slots, reason } = await this.availability.findAvailability({
      staffId: request.staffId,
      clinicId: request.clinicId,
      serviceId: request.serviceId,
      date,
      now: request.now,
      excludeAppointmentId: request.excludeAppointmentId,
    });

    if (reason) {
      // FULLY_BOOKED is a race with another booking, not a malformed request:
      // 409, so a caller can retry a different slot. The rest are the request
      // itself being wrong for the clinic's configuration: 422.
      throw reason === 'FULLY_BOOKED'
        ? new ConflictException(REFUSALS[reason])
        : new UnprocessableEntityException(REFUSALS[reason]);
    }

    const requestedStart = request.scheduledStart.getTime();
    const requestedEnd = request.scheduledEnd.getTime();
    const exact = slots.find(
      (slot) => slot.start.getTime() === requestedStart && slot.end.getTime() === requestedEnd,
    );
    if (exact) return;

    // The slot exists but is taken, versus the time is not a slot at all.
    // Different problems, different words, and one of them is a 409.
    const startsOnTheGrid = slots.some((slot) => slot.start.getTime() === requestedStart);
    if (startsOnTheGrid) {
      throw new UnprocessableEntityException(
        'That start time is available, but not for that length of appointment.',
      );
    }
    throw new ConflictException(
      'That time is no longer available — it is taken, or it is not one of the clinic’s slots.',
    );
  }
}
