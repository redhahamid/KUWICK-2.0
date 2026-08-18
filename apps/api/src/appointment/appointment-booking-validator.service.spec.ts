import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { AppointmentBookingValidator } from './appointment-booking-validator.service';
import { StaffService } from '../hr/staff.service';
import {
  AvailabilityQuery,
  AvailabilityResult,
  SlotAvailabilityService,
  UnavailableReason,
} from './slot-availability.service';

const CLINIC = 'clinic-1';
const STAFF = 'staff-1';
const SERVICE = 'service-1';

// 09:00 Kuala Lumpur on Wednesday 5 August 2026, as the instant it really is.
const NINE = new Date('2026-08-05T01:00:00.000Z');
const NINE_THIRTY = new Date('2026-08-05T01:30:00.000Z');
const TEN = new Date('2026-08-05T02:00:00.000Z');

// ===========================================================================
// THE VALIDATOR HAS NO RULES OF ITS OWN.
//
// It used to re-derive the roster, the exception, the overlap and the daily
// cap — the same rules the availability engine applies, written a second time
// and comparing time-of-day through UTC getters. These tests pin the property
// that replaced all of it: what the engine offers is what may be booked, and
// nothing else.
// ===========================================================================
function build(
  world: { slots?: { start: Date; end: Date }[]; reason?: UnavailableReason | null } = {},
) {
  const seen: AvailabilityQuery[] = [];
  const availability = {
    clinicTimeZone: jest.fn().mockResolvedValue('Asia/Kuala_Lumpur'),
    findAvailability: jest.fn(async (query: AvailabilityQuery): Promise<AvailabilityResult> => {
      seen.push(query);
      return {
        slots: world.slots ?? [{ start: NINE, end: NINE_THIRTY }],
        reason: world.reason ?? null,
      };
    }),
  } as unknown as SlotAvailabilityService;

  const staffService = { assertActiveDoctor: jest.fn() } as unknown as StaffService;
  const validator = new AppointmentBookingValidator(staffService, availability);

  return {
    validator,
    availability,
    staffService,
    seen,
    validate: (start = NINE, end = NINE_THIRTY, extra: Record<string, unknown> = {}) =>
      validator.validate({
        clinicId: CLINIC,
        staffId: STAFF,
        serviceId: SERVICE,
        scheduledStart: start,
        scheduledEnd: end,
        ...extra,
      }),
  };
}

describe('what the engine offers is what may be booked', () => {
  it('1. a slot the engine offers is accepted', async () => {
    const ctx = build();
    await expect(ctx.validate()).resolves.toBeUndefined();
  });

  it('2. an inactive doctor is refused before anything is computed', async () => {
    const ctx = build();
    (ctx.staffService.assertActiveDoctor as jest.Mock).mockRejectedValueOnce(new Error('not a doctor'));

    await expect(ctx.validate()).rejects.toThrow('not a doctor');
    expect(ctx.availability.findAvailability).not.toHaveBeenCalled();
  });

  it('3. a time that is not on the grid is refused', async () => {
    // 09:07, dragged. The engine never offered it, so it is not bookable —
    // this is the drag-and-drop refusal, not a special case for it.
    const ctx = build();
    const offGrid = new Date('2026-08-05T01:07:00.000Z');

    await expect(ctx.validate(offGrid, new Date('2026-08-05T01:37:00.000Z'))).rejects.toThrow(
      ConflictException,
    );
  });

  it('4. the right start with the wrong LENGTH is refused, and says so', async () => {
    const ctx = build();

    await expect(ctx.validate(NINE, TEN)).rejects.toThrow(
      /available, but not for that length/i,
    );
  });
});

describe('the engine names the reason, and the validator says it in words', () => {
  const cases: [UnavailableReason, RegExp, typeof ConflictException][] = [
    ['CLINIC_CLOSED', /clinic is closed/i, UnprocessableEntityException],
    ['NOT_ROSTERED', /outside the doctor's roster/i, UnprocessableEntityException],
    ['NOT_QUALIFIED', /not set up to perform/i, UnprocessableEntityException],
    ['SERVICE_NOT_BOOKABLE', /cannot be booked/i, UnprocessableEntityException],
    ['OUTSIDE_BOOKING_WINDOW', /booking hours/i, UnprocessableEntityException],
    ['TOO_LATE_TO_BOOK', /more notice/i, UnprocessableEntityException],
    // A race with another booking rather than a malformed request: 409, so the
    // caller knows a different slot is worth trying.
    ['FULLY_BOOKED', /no room left/i, ConflictException],
  ];

  it.each(cases)('5. %s is refused with a sentence a person can act on', async (reason, message, type) => {
    const ctx = build({ slots: [], reason });

    await expect(ctx.validate()).rejects.toThrow(type);
    await expect(ctx.validate()).rejects.toThrow(message);
  });

  it('6. no refusal message names a table, a column or an enum', async () => {
    // These end up in a toast at a front desk and on a public booking page.
    for (const [reason] of cases) {
      const ctx = build({ slots: [], reason });
      const error = await ctx.validate().catch((caught: Error) => caught);
      expect((error as Error).message).not.toMatch(
        /doctor_schedules|schedule_exceptions|slot_capacity|null|undefined|_id\b/i,
      );
    }
  });
});

describe('the day it asks about is the CLINIC’s day', () => {
  it('7. a late-evening booking asks about the local date, not the UTC one', async () => {
    // 23:30 in Kuala Lumpur is 15:30Z the SAME day; but 00:30 local is 16:30Z
    // the day BEFORE. Reading the UTC date off the instant asks the engine
    // about the wrong day and refuses a perfectly good booking.
    const ctx = build();
    const halfPastMidnightLocal = new Date('2026-08-05T16:30:00.000Z'); // 6 Aug, 00:30 KL

    await ctx.validate(halfPastMidnightLocal, halfPastMidnightLocal).catch(() => undefined);

    expect(ctx.seen[0].date.toISOString()).toBe('2026-08-06T00:00:00.000Z');
  });

  it('8. a reschedule tells the engine not to count the appointment being moved', async () => {
    const ctx = build();

    await ctx.validate(NINE, NINE_THIRTY, { excludeAppointmentId: 'appt-9' });

    expect(ctx.seen[0].excludeAppointmentId).toBe('appt-9');
  });
});
