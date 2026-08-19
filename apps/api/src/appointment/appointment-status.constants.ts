import { AppointmentStatus } from '@prisma/client';

/**
 * An appointment in one of these statuses no longer occupies its slot: it
 * doesn't block overlap checks, count toward daily capacity, or show up as
 * "occupied" in the availability engine.
 *
 * WAITLIST is here because a waitlist appointment has no agreed time at all —
 * it is a patient who wants this service, not a patient who has this slot. The
 * `appointments_no_overlap` EXCLUDE constraint carries the same list, and the
 * two must not drift.
 *
 * REQUESTED is deliberately ABSENT. A booking awaiting clinic approval holds
 * its slot: two people cannot both request the last 10:00 and each be told
 * they might get it (§30). The clinic rejecting one releases it.
 *
 * RESCHEDULED is retained for historical rows only — nothing writes it.
 */
export const TERMINAL_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CANCELLED,
  AppointmentStatus.RESCHEDULED,
  AppointmentStatus.NO_SHOW,
  AppointmentStatus.WAITLIST,
];

/**
 * The statuses a LIVE appointment can be in — the complement of the list
 * above, and what every "is this diary slot taken" query means.
 */
export const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.REQUESTED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.REMINDED,
  AppointmentStatus.ARRIVED,
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.IN_QUEUE,
  AppointmentStatus.COMPLETED,
];

/**
 * Statuses no longer written by any code path, kept in the enum so that no
 * historical row becomes unreadable. Pinned by a test: adding one of these
 * back to a write path should be a deliberate, visible act.
 */
export const DEPRECATED_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.REMINDED,
  AppointmentStatus.RESCHEDULED,
  AppointmentStatus.IN_QUEUE,
];
