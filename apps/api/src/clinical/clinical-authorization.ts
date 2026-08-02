import { ForbiddenException } from '@nestjs/common';
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

// Authoring a DOCTOR_NARRATIVE is restricted to doctors. Front-desk staff
// record observations and STAFF_REMARKs instead; a scribe/countersign
// workflow for dictated narrative is a separately approved future feature.
export function canAuthorNarrative(staff: Staff): boolean {
  return staff.active && (DOCTOR_ROLES.includes(staff.role) || canSignClinicalNotes(staff));
}

// Staff remarks ("patient refused medication", "called 3x, no answer") are
// how non-doctors document. They can never be signed (enforced by a DB CHECK
// as well as here) and never render as a doctor's clinical note.
export function canAuthorStaffRemark(staff: Staff): boolean {
  return staff.active && CLINICAL_ROLES.includes(staff.role);
}

export function canRecordObservations(staff: Staff): boolean {
  return staff.active && (DOCTOR_ROLES.includes(staff.role) || staff.role === 'FRONT_DESK_CLINICAL_STAFF');
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
