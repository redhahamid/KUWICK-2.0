import dayjs from 'dayjs';
import { AppointmentStatus } from '@kuwick/shared';
import {
  Appointment,
  AvailableSlot,
  DoctorServiceQualification,
  SlotCapacityConfig,
} from '../../appointment/types';
import { Staff } from '../../hr/types';
import { Service } from '../types';
import { isDoctorRole } from '../attendingClinician';
import { clinicDayjs } from '../clinicTime';

/**
 * b4 PIECE C — the rules behind the canvas appointment card, as functions.
 *
 * Nothing here talks to the network or renders anything. The card and the
 * booking modal are thin over these, because the two questions that decide
 * what a doctor sees — "is this booking still standing?" and "may this doctor
 * be booked for this service?" — are answered by the SAME rules the server
 * enforces, and a screen that re-invents either one drifts away from the
 * appointment it is describing.
 */

/**
 * An appointment in one of these no longer stands.
 *
 * The first three mirror `TERMINAL_APPOINTMENT_STATUSES` in
 * `apps/api/src/appointment/appointment-status.constants.ts` — the statuses
 * that release the slot, so they do not block an overlap check or count
 * against capacity. COMPLETED is added HERE and not there for a different
 * reason: a completed appointment still held its slot, but it is not
 * something a doctor needs to be told is coming.
 */
export const SETTLED_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CANCELLED,
  AppointmentStatus.RESCHEDULED,
  AppointmentStatus.NO_SHOW,
  AppointmentStatus.COMPLETED,
];

export function isStanding(appointment: Appointment): boolean {
  return !SETTLED_APPOINTMENT_STATUSES.includes(appointment.status);
}

/**
 * The patient's standing future bookings, soonest first.
 *
 * `now` is a parameter rather than read from the clock inside, so the boundary
 * case — an appointment that starts in four minutes — is testable rather than
 * a matter of when the suite happens to run.
 */
export function upcomingAppointments(
  appointments: Appointment[] | undefined,
  now: Date,
): Appointment[] {
  return (appointments ?? [])
    .filter(isStanding)
    .filter((appointment) => new Date(appointment.scheduledStart).getTime() >= now.getTime())
    .sort(
      (a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime(),
    );
}

/**
 * b4 PIECE C (3) — the patient's most recent appointment BEFORE now.
 *
 * Cancelled and rescheduled ones are dropped: neither happened, and a "Last:
 * 12 Aug" that names an appointment nobody attended-or-not is worse than
 * saying there was none. A NO_SHOW is kept deliberately — "they did not come
 * last time" is exactly the context a doctor wants before booking another.
 */
export function previousAppointment(
  appointments: Appointment[] | undefined,
  now: Date,
): Appointment | null {
  const past = (appointments ?? [])
    .filter(
      (appointment) =>
        appointment.status !== AppointmentStatus.CANCELLED &&
        appointment.status !== AppointmentStatus.RESCHEDULED,
    )
    .filter((appointment) => new Date(appointment.scheduledStart).getTime() < now.getTime())
    .sort(
      (a, b) => new Date(b.scheduledStart).getTime() - new Date(a.scheduledStart).getTime(),
    );
  return past[0] ?? null;
}

/**
 * Every appointment on a given calendar day, in the reader's own timezone —
 * the same timezone the day cell is drawn in, so a booking never lands on the
 * cell beside the one it was made from.
 */
export function appointmentsOn(
  appointments: Appointment[] | undefined,
  day: Date,
): Appointment[] {
  // `day` is a CALENDAR CELL from antd's picker: its printed label is its
  // local date, and antd builds it carrying the panel value's time-of-day.
  // Keying it through clinicDayjs meant that after 16:00 UTC (midnight in
  // Kuala Lumpur) every cell's instant crossed the clinic's midnight and the
  // patient's dot landed one day off its own label — a time-of-day-dependent
  // defect that also made this file's test flake by hour of run (D-103).
  // The cell means the date PRINTED ON IT; the appointment belongs to its
  // CLINIC date. Compare those two directly.
  const key = dayjs(day).format('YYYY-MM-DD');
  return (appointments ?? []).filter(
    (appointment) => clinicDayjs(appointment.scheduledStart).format('YYYY-MM-DD') === key,
  );
}

/** "Mon 24 Aug · 09:30–10:00". The year only when it is not this one. */
export function describeWhen(appointment: Appointment, now: Date = new Date()): string {
  const start = clinicDayjs(appointment.scheduledStart);
  const end = clinicDayjs(appointment.scheduledEnd);
  const day = start.isSame(clinicDayjs(now), 'year')
    ? start.format('ddd D MMM')
    : start.format('ddd D MMM YYYY');
  return `${day} · ${start.format('HH:mm')}–${end.format('HH:mm')}`;
}

/**
 * DOCTOR-SERVICE MAPPING, as the picker sees it.
 *
 * Settings → Appointments & Scheduling → Doctor-Service Mapping is the one
 * place a clinic says which doctor may perform which service, and
 * `AppointmentBookingValidator` refuses a booking that contradicts it
 * ("Doctor is not qualified to perform this service"). Offering the full
 * catalogue and letting the server refuse afterwards would be a picker that
 * invites a doctor to choose something that cannot be booked, so the list is
 * narrowed to the mapping BEFORE it is shown. The refusal is still the
 * server's — this only stops the round trip that always ends in one.
 *
 * An unknown doctor returns nothing rather than everything: an empty mapping
 * means "not configured", and rendering the whole catalogue for it would be
 * the failure mode this exists to prevent.
 */
export function servicesForDoctor(
  services: Service[] | undefined,
  qualifications: DoctorServiceQualification[] | undefined,
  staffId: string | undefined,
): Service[] {
  if (!staffId) return [];
  const allowed = new Set(
    (qualifications ?? [])
      .filter((qualification) => qualification.staffId === staffId)
      .map((qualification) => qualification.serviceId),
  );
  return (services ?? []).filter((service) => service.active && allowed.has(service.id));
}

/**
 * The clinic's slot rule for this exact pairing, or null when it has none.
 *
 * SLOT CAPACITY is per doctor, per branch, per service — the same three keys
 * `SlotAvailabilityService` looks the config up by. Read here so the modal can
 * say the slot length before a date is chosen, and can tell "nothing is
 * configured" apart from "the day is full" when the list comes back empty.
 */
export function capacityFor(
  configs: SlotCapacityConfig[] | undefined,
  keys: { clinicId?: string; staffId?: string; serviceId?: string },
): SlotCapacityConfig | null {
  if (!keys.clinicId || !keys.staffId || !keys.serviceId) return null;
  return (
    (configs ?? []).find(
      (config) =>
        config.clinicId === keys.clinicId &&
        config.staffId === keys.staffId &&
        config.serviceId === keys.serviceId,
    ) ?? null
  );
}

/** Active doctors, in name order — who a follow-up can be booked with. */
export function bookableDoctors(staff: Staff[] | undefined): Staff[] {
  return (staff ?? [])
    .filter((member) => member.active && isDoctorRole(member.role))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** "09:30" — the slot as the doctor picks it. */
export function slotLabel(slot: AvailableSlot): string {
  return clinicDayjs(slot.start).format('HH:mm');
}

/**
 * WHY THERE ARE NO SLOTS, in the words that say where to go.
 *
 * `/availability` returns an empty list for three different reasons and says
 * which for none of them: no `SlotCapacityConfig` for this doctor/service/
 * branch, no roster window on that day (or an approved leave), and a day whose
 * slots are all taken or whose daily capacity is spent. "No open slots" alone
 * sends a doctor to the front desk to find out which; naming the setting is
 * what makes it fixable by the person reading it.
 *
 * The distinction this CAN make honestly is the first one — a clinic that has
 * never configured capacity for a pairing gets no slots on any date, which is
 * a settings gap rather than a full diary. It is not derived from the empty
 * list (that would be a guess); it is derived from the configuration itself.
 */
export function noSlotsReason(hasCapacityConfig: boolean): string {
  return hasCapacityConfig
    ? 'No open slots on this date — the roster is full, the daily capacity is spent, or the doctor is not rostered. Try another date.'
    : 'This doctor and service have no slot length or capacity set for this branch yet — Settings → Appointments & Scheduling → Slot Capacity.';
}
