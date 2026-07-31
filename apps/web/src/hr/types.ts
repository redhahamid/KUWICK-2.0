import { Role } from '@kuwick/shared';

export interface Staff {
  id: string;
  tenantId: string;
  role: Role;
  fullName: string;
  staffNumber: string | null;
  active: boolean;
}

export interface CreateStaffDto {
  role: Role;
  fullName: string;
  staffNumber?: string;
}

// HR, Phase 1c. Leave request/approval workflow — no accrual balances or
// leave-type quotas yet, matching PRODUCT_REQUIREMENTS.md §14's MVP
// wording. Doctor Incentive Engine stays unbuilt (parked on OQ#2).
export type LeaveType = 'ANNUAL' | 'MEDICAL' | 'EMERGENCY' | 'UNPAID' | 'OTHER';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface LeaveRequest {
  id: string;
  staffId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: LeaveStatus;
  approvedByStaffId: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
  staff?: Staff;
  approvedBy?: Staff;
  createdAt: string;
}

export interface CreateLeaveRequestDto {
  staffId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  reason?: string;
}

export interface DecideLeaveRequestDto {
  approvedByStaffId: string;
  rejectReason?: string;
}

export interface PublicHoliday {
  id: string;
  date: string;
  name: string;
}

export interface CreatePublicHolidayDto {
  date: string;
  name: string;
}

// Attendance is a read-only derived report over Visit.checkInAt/checkOutAt
// — no create/edit DTOs, since it's never written directly.
export interface AttendanceRecord {
  staffId: string;
  staffName: string;
  date: string;
  firstCheckIn: string;
  lastCheckOut: string | null;
  visitCount: number;
}
