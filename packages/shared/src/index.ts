// Types shared by apps/web and apps/api. Defined once here so the two
// sides can never drift out of sync — see docs/CODING_STANDARDS.md §3.

export enum Role {
  OWNER_ADMIN = 'OWNER_ADMIN',
  DOCTOR_RESIDENT = 'DOCTOR_RESIDENT',
  DOCTOR_LOCUM = 'DOCTOR_LOCUM',
  FRONT_DESK_CLINICAL_STAFF = 'FRONT_DESK_CLINICAL_STAFF',
  FINANCE_STAFF = 'FINANCE_STAFF',
  HR_STAFF = 'HR_STAFF',
  STOCK_STAFF = 'STOCK_STAFF',
  PANEL_STAFF = 'PANEL_STAFF',
  PATIENT_PORTAL = 'PATIENT_PORTAL',
}

// Semantic status color families — see docs/UI_DESIGN_SYSTEM.md §2.
// Every lifecycle status below must map to exactly one of these.
export type StatusTone = 'success' | 'active' | 'attention' | 'warning' | 'error' | 'neutral';

export enum AppointmentStatus {
  REQUESTED = 'REQUESTED',
  CONFIRMED = 'CONFIRMED',
  REMINDED = 'REMINDED',
  ARRIVED = 'ARRIVED',
  IN_QUEUE = 'IN_QUEUE',
  COMPLETED = 'COMPLETED',
  RESCHEDULED = 'RESCHEDULED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

export const APPOINTMENT_STATUS_TONE: Record<AppointmentStatus, StatusTone> = {
  [AppointmentStatus.REQUESTED]: 'attention',
  [AppointmentStatus.CONFIRMED]: 'active',
  [AppointmentStatus.REMINDED]: 'active',
  [AppointmentStatus.ARRIVED]: 'active',
  [AppointmentStatus.IN_QUEUE]: 'attention',
  [AppointmentStatus.COMPLETED]: 'success',
  [AppointmentStatus.RESCHEDULED]: 'neutral',
  [AppointmentStatus.CANCELLED]: 'error',
  [AppointmentStatus.NO_SHOW]: 'error',
};
