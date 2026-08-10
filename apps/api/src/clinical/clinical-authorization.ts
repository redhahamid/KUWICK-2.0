import { ForbiddenException } from '@nestjs/common';
import { SystemRole } from '@prisma/client';
import { can } from '../core/permissions';
import { ClinicalNoteType, Role, Staff } from '@prisma/client';

// C0 (D-051) — narrowly-scoped, server-side authorisation for clinical
// records only. This is NOT a general RBAC system: the rest of the API still
// has no role enforcement at all (documented as a separate future phase).
// Everything here is enforced in the service layer; hiding a control in the
// frontend is presentation, never the access control.

// Identity snapshot written at the moment of an event. Stored as plain
// strings (not the Role enum) so a later enum rename can't rewrite history,
// and never refreshed if the staff profile changes afterwards.
export interface IdentitySnapshot {
  staffId: string;
  nameSnapshot: string;
  roleSnapshot: string;
  designationSnapshot: string | null;
}

export function snapshotOf(staff: Staff): IdentitySnapshot {
  return {
    staffId: staff.id,
    nameSnapshot: staff.fullName,
    roleSnapshot: staff.role,
    designationSnapshot: describeDesignation(staff),
  };
}

// A human-readable professional designation, derived only from data the
// clinic actually recorded. Never claims verification Kuwick didn't perform.
function describeDesignation(staff: Staff): string | null {
  if (staff.professionalType !== 'MEDICAL_DOCTOR') {
    return null;
  }
  return staff.medicalRegistrationNo ? `Medical Doctor (${staff.medicalRegistrationNo})` : 'Medical Doctor';
}

const DOCTOR_ROLES: Role[] = ['DOCTOR_RESIDENT', 'DOCTOR_LOCUM'];

// Roles permitted to touch clinical records at all. Finance/HR/Stock/Panel/
// Patient-portal accounts have no clinical access of any kind.
const CLINICAL_ROLES: Role[] = [...DOCTOR_ROLES, 'FRONT_DESK_CLINICAL_STAFF', 'OWNER_ADMIN'];

// Signing eligibility is derived from PROFESSIONAL identity, never from the
// administrative role (owner: "An OWNER_ADMIN may sign clinical notes only
// when the linked Staff record represents an authorised medical practitioner
// with clinical-note signing permission"). Every clause must hold, and each
// defaults to the non-signing state, so a fresh deployment has zero eligible
// signers until a Clinic Group explicitly records verification and enables
// signing.
export function canSignClinicalNotes(staff: Staff): boolean {
  return (
    staff.active &&
    staff.professionalType === 'MEDICAL_DOCTOR' &&
    staff.professionalActive &&
    staff.medicalRegistrationNo != null &&
    staff.medicalRegistrationNo.trim().length > 0 &&
    staff.professionalVerifiedAt != null &&
    staff.professionalVerifiedByStaffId != null &&
    staff.canSignClinicalNotes &&
    staff.clinicalSigningEnabledAt != null &&
    staff.clinicalSigningEnabledByStaffId != null
  );
}

// TASK 1 — these three now DELEGATE to the central policy module.
//
// They used to hold their own role lists, which is how a permission comes to
// be implemented twice and then differently: D1 was precisely that, and cost
// a doctor the ability to type. The functions keep their names and signatures
// so no call site changes; what they no longer keep is an opinion.
//
// `rolesOn` reads the capability roles the actor loader attached. Absent —
// a plain Staff row from a test or an older code path — falls through to the
// legacy mapping, which is what these lists used to say.
function rolesOn(staff: Staff): SystemRole[] | undefined {
  const attached = (staff as { assignedRoles?: SystemRole[] }).assignedRoles;
  return attached && attached.length > 0 ? attached : undefined;
}

// Authoring a DOCTOR_NARRATIVE is restricted to doctors. Front-desk staff
// record observations and STAFF_REMARKs instead; a scribe/countersign
// workflow for dictated narrative is a separately approved future feature.
export function canAuthorNarrative(staff: Staff): boolean {
  return can(staff, 'note.write', rolesOn(staff));
}

// Staff remarks ("patient refused medication", "called 3x, no answer") are
// how non-doctors document. They can never be signed (enforced by a DB CHECK
// as well as here) and never render as a doctor's clinical note.
export function canAuthorStaffRemark(staff: Staff): boolean {
  return can(staff, 'note.staffRemark', rolesOn(staff));
}

export function canRecordObservations(staff: Staff): boolean {
  return can(staff, 'observation.write', rolesOn(staff));
}

// G2 closure (D-061) — who may change a visit's diagnoses.
//
// A diagnosis is a clinical judgement, so recording, re-prioritising and
// removing one are doctor actions. FRONT_DESK_CLINICAL_STAFF may record
// observations and staff remarks but must not alter a diagnosis.
//
// OWNER_ADMIN does NOT qualify on the strength of the administrative role
// alone — the same rule C0 applies to signing. A practice owner who is not a
// clinician has every administrative right and no clinical one; conflating
// the two is how a non-clinical account ends up silently altering a
// medicolegal record. An owner who IS a doctor qualifies through their
// professional identity, not their job title.
export function canModifyDiagnosis(staff: Staff): boolean {
  // TASK 1 — delegated. The professional-identity path this used to spell out
  // lives in the policy module's fallback, so an owner who IS a doctor still
  // qualifies through their identity rather than their job title.
  return can(staff, 'diagnosis.write', rolesOn(staff));
}

// G3a (D-062) — voiding a clinical document, or removing a clinical image or
// investigation result, is a clinical act with medicolegal weight. Same rule
// as diagnosis modification: doctors, or a staff member whose PROFESSIONAL
// identity is an active medical doctor. Administrative ownership alone does
// not qualify.
//
// Deliberately NOT widened to whoever may CREATE these records: front-desk
// staff legitimately upload a scanned report or issue a time slip under the
// existing workflow, and G3 does not broaden or narrow who may create. What
// it does establish is that un-doing a saved clinical record needs clinical
// authority.
export function canVoidClinicalRecord(staff: Staff): boolean {
  // TASK 1 — delegated. The professional-identity path this used to spell out
  // lives in the policy module's fallback, so an owner who IS a doctor still
  // qualifies through their identity rather than their job title.
  return can(staff, 'clinical.void', rolesOn(staff));
}

/**
 * G3b closure (D-064) — who may CLINICALLY AUTHORISE a document.
 *
 * A medical certificate, referral or clinical memo carries a doctor's opinion
 * and their professional responsibility for it. Only a doctor may accept
 * that. Same rule as diagnosis modification and clinical-record voiding: a
 * doctor role, or a staff member whose PROFESSIONAL identity is an active
 * medical doctor.
 *
 * OWNER_ADMIN does not qualify on ownership alone, and FRONT_DESK_CLINICAL_
 * STAFF does not qualify at all — which is precisely the defect this closure
 * fixes. Front desk may still prepare and preview such a document; they may
 * not put a doctor's authority on it.
 */
export function canClinicallyAuthoriseDocument(staff: Staff): boolean {
  // TASK 1 — delegated. The professional-identity path this used to spell out
  // lives in the policy module's fallback, so an owner who IS a doctor still
  // qualifies through their identity rather than their job title.
  return can(staff, 'document.authoriseClinical', rolesOn(staff));
}

/**
 * Who may ISSUE an administrative document (a time slip and the like).
 *
 * Deliberately unchanged from the pre-closure rule: front desk issuing a time
 * slip is an existing, legitimate workflow, and the closure says to preserve
 * explicitly approved existing staff permissions. What changed is that such a
 * document can no longer describe itself as clinically authorised.
 */
export function canIssueAdministrativeDocument(staff: Staff): boolean {
  // Its OWN permission, not borrowed from document.print. Borrowing that one
  // would have handed a finance account the ability to issue patient
  // documents — a widening the old CLINICAL_ROLES list specifically excluded,
  // and one a test caught before it shipped.
  return can(staff, 'document.issueAdministrative', rolesOn(staff));
}

export function assertCanAuthoriseDocument(staff: Staff, requiresClinical: boolean): void {
  if (requiresClinical) {
    if (!canClinicallyAuthoriseDocument(staff)) {
      throw new ForbiddenException(
        'Only a doctor may clinically authorise this document. ' +
          'You can prepare and preview it, but a doctor must authorise it before it can be issued.',
      );
    }
    return;
  }
  if (!canIssueAdministrativeDocument(staff)) {
    throw new ForbiddenException('This account may not issue clinic documents.');
  }
}

// ---------------------------------------------------------------------------
// G3c closure (D-066) — BILLING authorisation.
//
// Deliberately decided on the administrative ROLE alone, and deliberately NOT
// on professional identity. That is the mirror image of clinical signing: a
// non-clinical owner may legitimately run the clinic's finances, whereas
// ownership alone never confers clinical authority; and being a doctor is a
// clinical fact, not a licence to move money. `professionalType` is not
// consulted anywhere below.
//
// Actions are separated because they are different jobs. Raising a bill and
// adding what was done to it is part of running the consultation, so a doctor
// may do it. Taking payment is counter work. Cancelling an issued invoice is a
// financial correction, and is the narrowest of the four.
// ---------------------------------------------------------------------------
export type BillingAction =
  | 'CREATE_INVOICE'
  | 'EDIT_LINES'
  | 'MARK_PAID'
  | 'CANCEL_INVOICE'
  | 'APPLY_DISCOUNT'
  | 'CANCEL_LINE'
  | 'CLASSIFY_VISIT';

const BILLING_MATRIX: Record<BillingAction, Role[]> = {
  // Raising the bill and itemising it: counter staff, finance, the owner, and
  // the doctor who ordered the work.
  CREATE_INVOICE: ['OWNER_ADMIN', 'FINANCE_STAFF', 'FRONT_DESK_CLINICAL_STAFF', 'DOCTOR_RESIDENT', 'DOCTOR_LOCUM'],
  EDIT_LINES: ['OWNER_ADMIN', 'FINANCE_STAFF', 'FRONT_DESK_CLINICAL_STAFF', 'DOCTOR_RESIDENT', 'DOCTOR_LOCUM'],
  // Collecting money is counter work. A doctor gets no cash-handling right
  // just by being a doctor — "should not automatically receive unrestricted
  // finance powers".
  MARK_PAID: ['OWNER_ADMIN', 'FINANCE_STAFF', 'FRONT_DESK_CLINICAL_STAFF'],
  // Voiding a bill that has already been issued is a financial correction and
  // stays with finance and the owner.
  CANCEL_INVOICE: ['OWNER_ADMIN', 'FINANCE_STAFF'],
  // G4.5d3c-3b1 (D-093, owner decision 5) — discounts move money the clinic
  // has earned, so they sit at the financial-correction tier. Front desk and
  // doctors are refused.
  APPLY_DISCOUNT: ['OWNER_ADMIN', 'FINANCE_STAFF'],
  // G4.5d3c-3b2 (D-094, owner decision 8/11) — cancelling a line (including
  // waiving an auto-added consultation) is COUNTER work with a mandatory
  // reason: front desk may do it, doctors do not manage billing corrections
  // from the clinical surface.
  CANCEL_LINE: ['OWNER_ADMIN', 'FINANCE_STAFF', 'FRONT_DESK_CLINICAL_STAFF'],
  // Recording what KIND of visit this was for consultation billing (OTC-only,
  // dressing-only, ...) is operational counter work, never a clinical entry.
  CLASSIFY_VISIT: ['OWNER_ADMIN', 'FINANCE_STAFF', 'FRONT_DESK_CLINICAL_STAFF'],
};

// Anyone who may perform ANY billing action — the gate for reaching the
// billing page at all. Read access to the clinical Invoice Summary is a
// SEPARATE permission and is not affected by this.
export function canAccessBilling(staff: Staff): boolean {
  return (
    staff.active &&
    (Object.keys(BILLING_MATRIX) as BillingAction[]).some((action) => BILLING_MATRIX[action].includes(staff.role))
  );
}

export function canPerformBilling(staff: Staff, action: BillingAction): boolean {
  return staff.active && BILLING_MATRIX[action].includes(staff.role);
}

const BILLING_ACTION_WORDS: Record<BillingAction, string> = {
  CREATE_INVOICE: 'raise an invoice',
  EDIT_LINES: 'change the items on an invoice',
  MARK_PAID: 'record a payment',
  CANCEL_INVOICE: 'cancel an invoice',
  APPLY_DISCOUNT: 'apply a billing discount',
  CANCEL_LINE: 'cancel an invoice line',
  CLASSIFY_VISIT: 'change the visit billing classification',
};

export function assertCanPerformBilling(staff: Staff, action: BillingAction): void {
  if (!canPerformBilling(staff, action)) {
    throw new ForbiddenException(`Your role is not permitted to ${BILLING_ACTION_WORDS[action]}.`);
  }
}

export function assertCanVoidClinicalRecord(staff: Staff, what: string): void {
  if (!canVoidClinicalRecord(staff)) {
    throw new ForbiddenException(
      `Only a doctor may ${what}. An administrative account does not carry clinical modification rights.`,
    );
  }
}

export function assertCanModifyDiagnosis(staff: Staff): void {
  if (!canModifyDiagnosis(staff)) {
    throw new ForbiddenException(
      'Only a doctor may add, re-prioritise or remove a diagnosis. ' +
        'An administrative account does not carry clinical modification rights.',
    );
  }
}

export function assertCanAuthor(staff: Staff, noteType: ClinicalNoteType): void {
  const allowed = noteType === 'DOCTOR_NARRATIVE' ? canAuthorNarrative(staff) : canAuthorStaffRemark(staff);
  if (!allowed) {
    throw new ForbiddenException(
      noteType === 'DOCTOR_NARRATIVE'
        ? 'Only a doctor may write a clinical narrative. Record a staff remark or observations instead.'
        : 'This account may not record clinical entries.',
    );
  }
}

// Editing an unsigned draft: the original author may edit their own, and an
// eligible doctor may review and edit any unsigned draft before signing
// (owner: "An authorised doctor may review and edit an unsigned draft before
// signing"). The author on the record never changes — the editor is recorded
// on the revision, and the signer accepts responsibility for the final text.
export function canEditDraft(staff: Staff, note: { authorStaffId: string | null; noteType: ClinicalNoteType }): boolean {
  if (!staff.active) {
    return false;
  }
  if (note.authorStaffId && note.authorStaffId === staff.id) {
    return note.noteType === 'DOCTOR_NARRATIVE' ? canAuthorNarrative(staff) : canAuthorStaffRemark(staff);
  }
  // Someone else's draft — only an eligible doctor may review/correct it,
  // and never a purely administrative account.
  return note.noteType === 'DOCTOR_NARRATIVE' ? canSignClinicalNotes(staff) : canSignClinicalNotes(staff);
}

// ---------------------------------------------------------------------------
// Branch (clinic) access — FAIL CLOSED.
//
// A null home branch does NOT grant access to every branch: a doctor
// authorised only for Branch A must never write a Branch B clinical record
// just because both belong to the same tenant. Tenant RLS is not sufficient
// for branch-level access.
//
// C0 supports exactly three ways to be authorised, in order:
//   1. the tenant genuinely has ONE branch (nothing to disambiguate)
//   2. Staff.clinicId matches the record's branch
//   3. an explicit UserClinicAccess row covers the branch
// Anything else — notably a null home branch in a multi-branch tenant — is
// denied. Broader multi-branch access waits for the phase that properly
// wires UserClinicAccess.
// ---------------------------------------------------------------------------
export interface BranchAccessContext {
  tenantBranchCount: number;
  authorisedClinicIds: string[];
}

export function hasBranchAccess(staff: Staff, clinicId: string, context: BranchAccessContext): boolean {
  if (!staff.active) {
    return false;
  }
  if (context.tenantBranchCount <= 1) {
    return true;
  }
  if (staff.clinicId && staff.clinicId === clinicId) {
    return true;
  }
  return context.authorisedClinicIds.includes(clinicId);
}

export function assertBranchAccess(staff: Staff, clinicId: string, context: BranchAccessContext): void {
  if (!hasBranchAccess(staff, clinicId, context)) {
    throw new ForbiddenException(
      'You are not authorised for this branch. Ask an administrator to assign your branch or grant explicit access.',
    );
  }
}

// Normalised form used for duplicate detection of professional registration
// numbers. NOT backed by a unique index in C0 — a tenant may currently be
// using duplicate Staff rows as a multi-branch workaround, and that could not
// be preflighted against production from here.
export function normaliseRegistrationNo(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalised = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return normalised.length > 0 ? normalised : null;
}
