import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import { AppointmentStatus, Role } from '@kuwick/shared';
import { Appointment, DoctorServiceQualification, SlotCapacityConfig } from '../../appointment/types';
import { Service } from '../types';
import { Staff } from '../../hr/types';
import {
  appointmentsOn,
  bookableDoctors,
  capacityFor,
  describeWhen,
  isStanding,
  previousAppointment,
  noSlotsReason,
  servicesForDoctor,
  upcomingAppointments,
} from './followUpPresentation';

// ===========================================================================
// b4 PIECE C — THE RULES BEHIND THE APPOINTMENT CARD.
//
// The two that carry weight: what counts as a booking still standing (a
// cancelled follow-up must never be shown to a doctor as one), and which
// services a doctor may be booked for (Settings → Appointments & Scheduling →
// Doctor-Service Mapping, which the server refuses bookings against).
// ===========================================================================

const appointment = (over: Partial<Appointment> = {}): Appointment =>
  ({
    id: 'appt-1',
    tenantId: 't1',
    clinicId: 'clinic-1',
    patientId: 'p1',
    staffId: 'dr-1',
    serviceId: 'svc-1',
    status: AppointmentStatus.CONFIRMED,
    source: 'FRONT_DESK',
    scheduledStart: '2026-08-24T01:30:00.000Z',
    scheduledEnd: '2026-08-24T02:00:00.000Z',
    notes: null,
    cancelReason: null,
    arrivedAt: null,
    rescheduledFromId: null,
    ...over,
  }) as Appointment;

const service = (over: Partial<Service> = {}): Service =>
  ({
    id: 'svc-1',
    tenantId: 't1',
    name: 'Wound dressing',
    code: null,
    category: null,
    orderType: 'STANDARD_SERVICE',
    durationMinutesDefault: 30,
    price: '25.00',
    active: true,
    ...over,
  }) as Service;

const qualification = (staffId: string, serviceId: string): DoctorServiceQualification => ({
  id: `${staffId}-${serviceId}`,
  tenantId: 't1',
  staffId,
  serviceId,
});

const staffMember = (over: Partial<Staff> = {}): Staff =>
  ({
    id: 'dr-1',
    tenantId: 't1',
    role: 'DOCTOR_RESIDENT',
    fullName: 'Dr Amira Rahman',
    staffNumber: null,
    active: true,
    clinicId: 'clinic-1',
    ...over,
  }) as unknown as Staff;

const NOW = new Date('2026-08-17T00:00:00.000Z');

describe('which bookings still stand', () => {
  it('a cancelled, rescheduled, no-showed or completed appointment does not', () => {
    for (const status of [
      AppointmentStatus.CANCELLED,
      AppointmentStatus.RESCHEDULED,
      AppointmentStatus.NO_SHOW,
      AppointmentStatus.COMPLETED,
    ]) {
      expect(isStanding(appointment({ status })), status).toBe(false);
    }
  });

  it('requested, confirmed and reminded do', () => {
    for (const status of [
      AppointmentStatus.REQUESTED,
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.REMINDED,
    ]) {
      expect(isStanding(appointment({ status })), status).toBe(true);
    }
  });

  it('a RESCHEDULED appointment is dropped and its successor kept — never both', () => {
    // The server writes reschedule as two rows: the original moves to
    // RESCHEDULED and a new CONFIRMED one carries `rescheduledFromId`. A card
    // that showed both would tell a doctor the patient is coming twice.
    const upcoming = upcomingAppointments(
      [
        appointment({ id: 'old', status: AppointmentStatus.RESCHEDULED }),
        appointment({
          id: 'new',
          rescheduledFromId: 'old',
          scheduledStart: '2026-08-25T01:30:00.000Z',
          scheduledEnd: '2026-08-25T02:00:00.000Z',
        }),
      ],
      NOW,
    );
    expect(upcoming.map((a) => a.id)).toEqual(['new']);
  });
});

describe('which booking is next', () => {
  it('the soonest still-standing one in the future, ordered', () => {
    const upcoming = upcomingAppointments(
      [
        appointment({ id: 'later', scheduledStart: '2026-09-01T01:00:00.000Z' }),
        appointment({ id: 'past', scheduledStart: '2026-08-01T01:00:00.000Z' }),
        appointment({ id: 'sooner', scheduledStart: '2026-08-20T01:00:00.000Z' }),
      ],
      NOW,
    );
    expect(upcoming.map((a) => a.id)).toEqual(['sooner', 'later']);
  });

  it('an appointment that has already started is past, not upcoming', () => {
    const started = appointment({ scheduledStart: '2026-08-16T23:59:00.000Z' });
    expect(upcomingAppointments([started], NOW)).toEqual([]);
  });

  it('nothing at all is an empty list, never a throw', () => {
    expect(upcomingAppointments(undefined, NOW)).toEqual([]);
  });

  it('says when, in the CLINIC’s clock', () => {
    // A LITERAL clock face now, deliberately. This used to assert against
    // `dayjs()` on the grounds that CI runs in UTC and a Malaysian clinic does
    // not, so only the shape could be pinned — which meant the assertion
    // agreed with whatever the reader's zone produced, including the wrong
    // thing. The zone is the clinic's now (`clinicTime.ts`), so 01:30Z is
    // 09:30 in Kuala Lumpur wherever this runs, and the number can be written
    // down. If this ever fails on a laptop, the zone is not being set.
    expect(describeWhen(appointment(), NOW)).toBe('Mon 24 Aug · 09:30–10:00');
  });

  it('a booking in another year says which year', () => {
    expect(
      describeWhen(
        appointment({
          scheduledStart: '2027-01-04T01:30:00.000Z',
          scheduledEnd: '2027-01-04T02:00:00.000Z',
        }),
        NOW,
      ),
    ).toContain('2027');
  });
});

describe('doctor-service mapping decides what may be booked', () => {
  const services = [service(), service({ id: 'svc-2', name: 'Nebulizer' })];

  it('offers only the services mapped to THIS doctor', () => {
    const offered = servicesForDoctor(
      services,
      [qualification('dr-1', 'svc-2'), qualification('dr-2', 'svc-1')],
      'dr-1',
    );
    expect(offered.map((s) => s.name)).toEqual(['Nebulizer']);
  });

  it('a doctor with no mapping is offered NOTHING, not everything', () => {
    // The failure that matters: an empty mapping treated as "no filter" would
    // offer the whole catalogue and every booking would be refused by the
    // server with a message about a qualification nobody was shown.
    expect(servicesForDoctor(services, [], 'dr-1')).toEqual([]);
    expect(servicesForDoctor(services, undefined, 'dr-1')).toEqual([]);
  });

  it('no doctor chosen offers nothing', () => {
    expect(servicesForDoctor(services, [qualification('dr-1', 'svc-1')], undefined)).toEqual([]);
  });

  it('a retired service stays out even when it is still mapped', () => {
    const offered = servicesForDoctor(
      [service({ id: 'svc-3', name: 'Old package', active: false })],
      [qualification('dr-1', 'svc-3')],
      'dr-1',
    );
    expect(offered).toEqual([]);
  });
});

describe('who a follow-up can be booked with', () => {
  it('active doctors only, by name', () => {
    const doctors = bookableDoctors([
      // A clinical staff member is not a doctor, and a follow-up is booked
      // with a doctor: the mapping, the roster and the capacity are all held
      // against one.
      staffMember({ id: 'n1', role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Amy Tan' }),
      staffMember({ id: 'd2', fullName: 'Dr Zainal' }),
      staffMember({ id: 'd3', fullName: 'Dr Aminah' }),
      staffMember({ id: 'd4', fullName: 'Dr Retired', active: false }),
    ]);
    expect(doctors.map((d) => d.fullName)).toEqual(['Dr Aminah', 'Dr Zainal']);
  });
});

describe('slot capacity', () => {
  const config: SlotCapacityConfig = {
    id: 'cfg-1',
    tenantId: 't1',
    clinicId: 'clinic-1',
    staffId: 'dr-1',
    serviceId: 'svc-1',
    slotLengthMinutes: 30,
    dailyCapacity: 8,
  };

  it('is found by the same three keys the availability engine looks it up by', () => {
    expect(
      capacityFor([config], { clinicId: 'clinic-1', staffId: 'dr-1', serviceId: 'svc-1' }),
    ).toBe(config);
    // A different branch is a different configuration, not a fallback.
    expect(
      capacityFor([config], { clinicId: 'clinic-2', staffId: 'dr-1', serviceId: 'svc-1' }),
    ).toBeNull();
    expect(capacityFor([config], { clinicId: 'clinic-1', staffId: 'dr-1' })).toBeNull();
  });

  it('an unconfigured pairing is told where to configure it', () => {
    // The three reasons /availability returns nothing are indistinguishable
    // from the empty list, so the one that IS knowable is named from the
    // configuration rather than guessed from the emptiness.
    expect(noSlotsReason(false)).toContain('Slot Capacity');
    expect(noSlotsReason(true)).not.toContain('Settings');
    expect(noSlotsReason(true)).toContain('another date');
  });
});


// ===========================================================================
// b4 PIECE C (3) — WHAT THE MONTH NEEDS THAT A CARD DID NOT.
// ===========================================================================
describe('the previous appointment', () => {
  it('is the most recent one before now', () => {
    const previous = previousAppointment(
      [
        appointment({ id: 'older', scheduledStart: '2026-07-01T01:00:00.000Z' }),
        appointment({ id: 'recent', scheduledStart: '2026-08-10T01:00:00.000Z' }),
        appointment({ id: 'future', scheduledStart: '2026-09-01T01:00:00.000Z' }),
      ],
      NOW,
    );
    expect(previous?.id).toBe('recent');
  });

  it('keeps a no-show — "they did not come last time" is the context that decides', () => {
    const previous = previousAppointment(
      [
        appointment({
          id: 'missed',
          status: AppointmentStatus.NO_SHOW,
          scheduledStart: '2026-08-10T01:00:00.000Z',
        }),
      ],
      NOW,
    );
    expect(previous?.id).toBe('missed');
  });

  it('drops a cancelled or rescheduled one — neither happened', () => {
    expect(
      previousAppointment(
        [
          appointment({
            id: 'gone',
            status: AppointmentStatus.CANCELLED,
            scheduledStart: '2026-08-10T01:00:00.000Z',
          }),
          appointment({
            id: 'moved',
            status: AppointmentStatus.RESCHEDULED,
            scheduledStart: '2026-08-11T01:00:00.000Z',
          }),
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it('is null when the patient has never had one', () => {
    expect(previousAppointment([], NOW)).toBeNull();
    expect(previousAppointment(undefined, NOW)).toBeNull();
  });
});

describe('marking a day on the month', () => {
  it('finds the appointments on that calendar day, in the reader’s own timezone', () => {
    const day = dayjs('2026-08-24T01:30:00.000Z');
    const on = appointmentsOn(
      [
        appointment({ id: 'same-day', scheduledStart: '2026-08-24T01:30:00.000Z' }),
        appointment({ id: 'next-day', scheduledStart: '2026-08-25T01:30:00.000Z' }),
      ],
      day.toDate(),
    );
    // The cell is drawn in the reader's timezone, so the match is made in it
    // too — otherwise a booking marks the day beside the one it was made from.
    expect(on.map((a) => a.id)).toEqual(['same-day']);
  });

  it('counts a cancelled one as being on the day — the dot is filtered, not this', () => {
    const day = dayjs('2026-08-24T01:30:00.000Z');
    const on = appointmentsOn(
      [appointment({ status: AppointmentStatus.CANCELLED, scheduledStart: '2026-08-24T01:30:00.000Z' })],
      day.toDate(),
    );
    expect(on).toHaveLength(1);
  });
});
