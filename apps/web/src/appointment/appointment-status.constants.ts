import { AppointmentStatus } from '@kuwick/shared';

// Mirrors the lifecycle guards in AppointmentService (apps/api/src/appointment) —
// shared between AppointmentsPage's row actions and AppointmentDetailPopover's
// calendar-block actions, so the two surfaces can't drift out of sync.
export const ARRIVABLE_FROM_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.REMINDED,
];

export const NON_CANCELLABLE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CANCELLED,
  AppointmentStatus.RESCHEDULED,
  AppointmentStatus.NO_SHOW,
  AppointmentStatus.COMPLETED,
];
