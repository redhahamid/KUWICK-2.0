import { AppointmentStatus } from '@prisma/client';

// An appointment in one of these statuses no longer occupies its slot: it
// doesn't block overlap checks, count toward daily capacity, or show up as
// "occupied" in the availability engine.
export const TERMINAL_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CANCELLED,
  AppointmentStatus.RESCHEDULED,
  AppointmentStatus.NO_SHOW,
];
