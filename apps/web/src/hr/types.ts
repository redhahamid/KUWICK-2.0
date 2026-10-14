import { Role } from '@kuwick/shared';

// C0 (D-051) — professional (clinical) identity, deliberately separate from
// the administrative `role`. An OWNER_ADMIN may or may not be a practising
// doctor; clinical-note signing is never derived from role.
export type ProfessionalType = 'NON_CLINICAL' | 'MEDICAL_DOCTOR';

export interface Staff {
  id: string;
  tenantId: string;
  role: Role;
  fullName: string;
  staffNumber: string | null;
  active: boolean;
  // D-045 — home branch; null = works across every clinic in the tenant.
  clinicId: string | null;

  professionalType: ProfessionalType;
  medicalRegistrationNo: string | null;
  professionalActive: boolean;
  canSignClinicalNotes: boolean;
  professionalVerifiedAt: string | null;
  professionalVerifiedByStaffId: string | null;
  clinicalSigningEnabledAt: string | null;
  clinicalSigningEnabledByStaffId: string | null;

  // The provider's stored calendar identity colour — one of the curated
  // PROVIDER_COLORS accents, or null on records written before the column
  // was filled in (those fall back to a deterministic curated colour). The
  // API has always sent this on /staff; declaring it here is what let the
  // calendar stop overriding it with a hash.
  calendarColor: string | null;
}

export interface CreateStaffDto {
  role: Role;
  fullName: string;
  staffNumber?: string;
  clinicId?: string;
  // Login credentials (D-034) — optional; give both to let this staff
  // member sign in, omit both to leave them without a login.
  loginEmail?: string;
  loginPassword?: string;

  professionalType?: ProfessionalType;
  medicalRegistrationNo?: string;
  professionalActive?: boolean;
  canSignClinicalNotes?: boolean;
  /** One of the curated PROVIDER_COLORS accents; the server rejects any other. */
  calendarColor?: string;
}

export type UpdateStaffDto = Partial<CreateStaffDto> & { active?: boolean; clinicId?: string | null };

// HR, Phase 1c. Leave request/approval workflow — no accrual balances or
// leave-type quotas yet, matching PRODUCT_REQUIREMENTS.md §14's MVP
// wording. Doctor Incentive Engine stays unbuilt (parked on OQ#2).
/** A clinic leave type code (Section D): ANNUAL, MEDICAL, … or the clinic's own. */
export type LeaveType = string;
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
  /** The MC or other certificate sent with the request (Piece 3g). */
  attachments?: { id: string; fileName: string; mimeType: string; fileSize: number; filePath: string }[];
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
  /**
   * WHO DECIDED IT IS NOT SENT. The server takes the approver from the
   * session, like every other decision in this product; it used to be named in
   * the body, which let any caller record anybody as the approver.
   */
  rejectReason?: string;
}

export type PublicHolidayKind = 'ORDINARY' | 'FESTIVE';

export interface PublicHoliday {
  id: string;
  date: string;
  name: string;
  /** ORDINARY unless the clinic marked it festive; a rule set may price a festive day apart. */
  kind: PublicHolidayKind;
  /** The clinic's multiplier for hours on this day (Section C); null is the rule set's. */
  multiplier?: string | null;
}

export interface CreatePublicHolidayDto {
  date: string;
  name: string;
  kind?: PublicHolidayKind;
}

export interface UpdatePublicHolidayDto {
  name?: string;
  kind?: PublicHolidayKind;
  multiplier?: number | null;
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
