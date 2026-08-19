import { AppointmentStatus } from '@kuwick/shared';

// Mirrors the lifecycle guards in AppointmentService (apps/api/src/appointment)
// — shared between every surface that offers a row action, so two screens
// cannot disagree about whether a booking may be cancelled.

/** May be greeted at the desk, or checked straight in. */
export const ARRIVABLE_FROM_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.REMINDED,
];

/** May be checked in — ARRIVED included, because greeting is not checking in. */
export const CHECK_IN_FROM_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.REMINDED,
  AppointmentStatus.ARRIVED,
];

export const NON_CANCELLABLE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CANCELLED,
  AppointmentStatus.RESCHEDULED,
  AppointmentStatus.NO_SHOW,
  AppointmentStatus.WAITLIST,
  AppointmentStatus.COMPLETED,
];

/**
 * No longer occupying a slot. The calendar draws these faded rather than
 * hiding them: a cancellation somebody is looking for is worse to lose than a
 * cancellation somebody has to scroll past.
 */
export const RELEASED_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CANCELLED,
  AppointmentStatus.RESCHEDULED,
  AppointmentStatus.NO_SHOW,
  AppointmentStatus.WAITLIST,
];
