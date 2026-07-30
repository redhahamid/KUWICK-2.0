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
