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

/**
 * Mirrors the Prisma enum exactly (apps/api/prisma/schema.prisma) — Prisma
 * cannot import a TS enum from another package, so the two are kept in step by
 * hand rather than redefining the wording.
 *
 * The last three are DEPRECATED: nothing writes them any more, and they remain
 * only so that rows written before the scheduling redesign stay readable. See
 * `DEPRECATED_APPOINTMENT_STATUSES`.
 */
export enum AppointmentStatus {
  REQUESTED = 'REQUESTED',
  CONFIRMED = 'CONFIRMED',
  ARRIVED = 'ARRIVED',
  CHECKED_IN = 'CHECKED_IN',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
  WAITLIST = 'WAITLIST',
  REMINDED = 'REMINDED',
  RESCHEDULED = 'RESCHEDULED',
  IN_QUEUE = 'IN_QUEUE',
}

export const APPOINTMENT_STATUS_TONE: Record<AppointmentStatus, StatusTone> = {
  [AppointmentStatus.REQUESTED]: 'attention',
  [AppointmentStatus.CONFIRMED]: 'active',
  [AppointmentStatus.ARRIVED]: 'active',
  [AppointmentStatus.CHECKED_IN]: 'success',
  [AppointmentStatus.COMPLETED]: 'success',
  [AppointmentStatus.CANCELLED]: 'error',
  [AppointmentStatus.NO_SHOW]: 'error',
  [AppointmentStatus.WAITLIST]: 'neutral',
  [AppointmentStatus.REMINDED]: 'active',
  [AppointmentStatus.RESCHEDULED]: 'neutral',
  [AppointmentStatus.IN_QUEUE]: 'success',
};

/**
 * WHAT A PERSON READS. The enum value is a stored fact; this is the word on
 * the chip, and the two are allowed to differ — "Checked in" reads better than
 * CHECKED_IN and survives the enum being renamed.
 */
export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  [AppointmentStatus.REQUESTED]: 'Requested',
  [AppointmentStatus.CONFIRMED]: 'Confirmed',
  [AppointmentStatus.ARRIVED]: 'Arrived',
  [AppointmentStatus.CHECKED_IN]: 'Checked in',
  [AppointmentStatus.COMPLETED]: 'Completed',
  [AppointmentStatus.CANCELLED]: 'Cancelled',
  [AppointmentStatus.NO_SHOW]: 'No-show',
  [AppointmentStatus.WAITLIST]: 'Waitlist',
  [AppointmentStatus.REMINDED]: 'Confirmed',
  [AppointmentStatus.RESCHEDULED]: 'Rescheduled',
  [AppointmentStatus.IN_QUEUE]: 'Checked in',
};

/**
 * Statuses no code path writes any more, kept so no historical row becomes
 * unreadable. A screen must still render them; nothing must produce them.
 */
export const DEPRECATED_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.REMINDED,
  AppointmentStatus.RESCHEDULED,
  AppointmentStatus.IN_QUEUE,
];

export enum ProcurementRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CONVERTED = 'CONVERTED',
}

export const PROCUREMENT_REQUEST_STATUS_TONE: Record<ProcurementRequestStatus, StatusTone> = {
  [ProcurementRequestStatus.PENDING]: 'attention',
  [ProcurementRequestStatus.APPROVED]: 'active',
  [ProcurementRequestStatus.REJECTED]: 'error',
  [ProcurementRequestStatus.CONVERTED]: 'success',
};

export enum PurchaseOrderStatus {
  ORDERED = 'ORDERED',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  FULLY_RECEIVED = 'FULLY_RECEIVED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export const PURCHASE_ORDER_STATUS_TONE: Record<PurchaseOrderStatus, StatusTone> = {
  [PurchaseOrderStatus.ORDERED]: 'attention',
  [PurchaseOrderStatus.PARTIALLY_RECEIVED]: 'active',
  [PurchaseOrderStatus.FULLY_RECEIVED]: 'success',
  [PurchaseOrderStatus.CLOSED]: 'neutral',
  [PurchaseOrderStatus.CANCELLED]: 'error',
};
