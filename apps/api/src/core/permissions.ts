import { ForbiddenException } from '@nestjs/common';
import { Role, Staff, SystemRole } from '@prisma/client';

/**
 * TASK 1 — THE PERMISSION POLICY. One module, one answer.
 *
 * Every clinical and administrative capability in Kuwick is named here and
 * granted here. Scattered `if (staff.role === 'DOCTOR_RESIDENT')` checks are
 * what produced D1: the Canvas and the server each decided who could author a
 * clinical note, they disagreed, and a credentialed owner-doctor was handed a
 * read-only editor that silently ate his keystrokes. A permission implemented
 * twice is a permission that will eventually be implemented differently.
 *
 * THREE PROPERTIES:
 *
 *  1. ROLES UNION. A staff member holds one or more roles and gets the union
 *     of their permissions. The doctor who owns the clinic holds DOCTOR and
 *     OWNER; neither role has to be widened to accommodate the other, which
 *     is exactly the widening that makes an "owner" role quietly clinical.
 *
 *  2. OWNER IS NOT CLINICAL. On its own it grants settings, pricing and
 *     approval — and nothing that touches a patient's record. This is the
 *     rule most likely to be eroded by convenience, so it has its own test.
 *
 *  3. DOCTOR NEEDS A DOCTOR. Holding the role is not enough to SIGN: signing
 *     asserts a professional identity, so it additionally requires the
 *     credential fields. The role opens the door; the credential is what puts
 *     a name on the record.
 */

// ---------------------------------------------------------------------------
// The vocabulary
//
// Named for the ACT, not the screen. "May write a clinical note" survives a
// redesign; "may use the notes tab" does not.
// ---------------------------------------------------------------------------
export type Permission =
  // Clinical record
  | 'note.write'
  | 'note.sign'
  | 'note.staffRemark'
  | 'diagnosis.write'
  | 'prescription.write'
  | 'order.write'
  | 'observation.write'
  | 'allergy.write'
  // Clinical workflow
  | 'consultation.hold'
  | 'consultation.resume'
  | 'consultation.complete'
  | 'order.fulfil'
  | 'dispense.perform'
  // Administrative
  | 'patient.demographics.write'
  | 'patient.lhdn.write'
  | 'queue.manage'
  | 'billing.manage'
  | 'document.print'
  // Ownership
  | 'clinical.void'
  | 'document.issueAdministrative'
  | 'document.authoriseClinical'
  | 'settings.manage'
  | 'discount.approve'
  | 'users.manage';

/**
 * What each role grants. The single table this whole module exists to hold.
 *
 * Read it as a specification, because it is one: anything not listed is not
 * granted, and adding a capability to a role is a visible one-line change
 * somebody can review.
 */
export const ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  DOCTOR: [
    'note.write',
    'note.sign',
    'note.staffRemark',
    'diagnosis.write',
    'prescription.write',
    'order.write',
    'observation.write',
    'allergy.write',
    'consultation.hold',
    'consultation.resume',
    'consultation.complete',
    // Un-doing a saved clinical record, and putting a doctor's authority on a
    // certificate or referral. Both carry medicolegal weight and neither is
    // available to an administrator on the strength of ownership.
    'clinical.void',
    'document.authoriseClinical',
    'document.issueAdministrative',
    // A doctor authorises dispensing of what they prescribed.
    'dispense.perform',
    // Printing what they issued — an MC, a referral — is part of the act.
    'document.print',
  ],

  CLINICAL_STAFF: [
    // Vitals and allergies: the two things front desk and nurses record all
    // day, and the reason "clinical staff" is a role rather than a footnote.
    'observation.write',
    'allergy.write',
    // Their own voice in the record. NEVER note.write — a staff remark and a
    // doctor's narrative are different claims and the schema keeps them apart.
    'note.staffRemark',
    // Running task orders and putting the results in.
    'order.fulfil',
    'dispense.perform',
    // Front desk issuing a time slip is an existing, legitimate workflow.
    // What such a document can no longer do is describe itself as clinically
    // authorised — that needs a doctor.
    'document.issueAdministrative',
    // They can take a held patient back; they cannot put one on hold, which
    // is a clinical judgement made in a room they cannot see into.
    'consultation.resume',
    'document.print',
  ],

  ADMINISTRATOR: [
    'patient.demographics.write',
    'patient.lhdn.write',
    'queue.manage',
    'billing.manage',
    'document.print',
    // Front desk calls patients through, so resuming a held one is theirs.
    'consultation.resume',
  ],

  // OWNER ALONE IS NOT CLINICAL. Not one permission here touches a patient's
  // record. A doctor-owner gets clinical ability from the DOCTOR role they
  // also hold — never from this one.
  OWNER: ['settings.manage', 'discount.approve', 'users.manage'],
};

// ---------------------------------------------------------------------------
// Migrating what already exists
//
// The legacy `Role` stays on the staff row and keeps working. This table is
// the FALLBACK used for a staff member with no explicit assignment yet, so
// nothing breaks on the day the new roles ship and the migration is additive
// rather than a one-way door.
//
// Every entry preserves what that role can do TODAY. Where the new split
// separates duties one legacy role held together — front desk records vitals
// AND edits demographics — the fallback grants both new roles rather than
// silently removing half of somebody's job.
// ---------------------------------------------------------------------------
export const LEGACY_ROLE_FALLBACK: Record<Role, SystemRole[]> = {
  // Owner + administrator, and NOT doctor: clinical ability comes from a
  // credential, and an owner who is also the GP is given DOCTOR explicitly.
  OWNER_ADMIN: ['OWNER', 'ADMINISTRATOR'],
  DOCTOR_RESIDENT: ['DOCTOR'],
  DOCTOR_LOCUM: ['DOCTOR'],
  // Records vitals AND registers patients. Both, or half their job vanishes.
  FRONT_DESK_CLINICAL_STAFF: ['CLINICAL_STAFF', 'ADMINISTRATOR'],
  FINANCE_STAFF: ['ADMINISTRATOR'],
  HR_STAFF: ['ADMINISTRATOR'],
  // Owner decision: NOT clinical staff. That role carries observation.write
  // and allergy.write, and an inventory clerk has no business recording a
  // blood pressure — the mapping would have granted patient-record writes to
  // stock control, which is exactly the quiet widening this table exists to
  // make visible.
  //
  // FOLLOW-UP, deliberately not built now: dispensing is already its own
  // permission (`dispense.perform`), but granting it to one person WITHOUT a
  // role would need per-staff permission grants — a second axis in the model,
  // a second thing for the Users screen to edit, and a second source of truth
  // for "what can this person do". Zero accounts hold STOCK_STAFF today, so
  // nothing is lost by waiting until there is a real one to design against.
  STOCK_STAFF: ['ADMINISTRATOR'],
  PANEL_STAFF: ['ADMINISTRATOR'],
  // Not staff. No capability of any kind.
  PATIENT_PORTAL: [],
};

// ---------------------------------------------------------------------------
// Resolving one person's permissions
// ---------------------------------------------------------------------------

/** What this staff member's credential lets them assert, regardless of role. */
/**
 * A practising doctor by PROFESSIONAL identity, which is a weaker statement
 * than being cleared to sign.
 *
 * Kept distinct on purpose. Signing a note asserts authorship of a
 * medicolegal document and needs the full six-field verification; altering a
 * diagnosis or authorising a certificate has always required only that the
 * person IS a doctor. Collapsing the two would quietly remove access somebody
 * has today, which a migration must not do.
 */
export function hasDoctorIdentity(staff: Staff): boolean {
  return staff.active && staff.professionalType === 'MEDICAL_DOCTOR' && staff.professionalActive;
}

export function isCredentialedClinician(staff: Staff): boolean {
  return Boolean(
    staff.active &&
      // These two were MISSING in the first draft of this function, which made
      // it weaker than `canSignClinicalNotes` — the rule C0 has enforced all
      // along. A staff member with the six signing fields but no active
      // MEDICAL_DOCTOR identity would have been granted note.sign here and
      // refused it there: the same two-implementations divergence this module
      // exists to end, reintroduced inside the module itself.
      staff.professionalType === 'MEDICAL_DOCTOR' &&
      staff.professionalActive &&
      staff.medicalRegistrationNo?.trim() &&
      staff.professionalVerifiedAt &&
      staff.professionalVerifiedByStaffId &&
      staff.canSignClinicalNotes &&
      staff.clinicalSigningEnabledAt &&
      staff.clinicalSigningEnabledByStaffId,
  );
}

/**
 * The roles this person actually holds.
 *
 * Explicit assignments win outright. The legacy fallback applies ONLY to
 * somebody who has none — a staff member deliberately reduced to one role
 * must not have the old one silently added back.
 */
export function rolesOf(staff: Staff, assigned: SystemRole[] | undefined): SystemRole[] {
  if (assigned && assigned.length > 0) return [...new Set(assigned)];

  const fallback = [...(LEGACY_ROLE_FALLBACK[staff.role] ?? [])];

  // "+ DOCTOR only when credentialed" — the one clause a static table cannot
  // express, and the one the clinic depends on. A legacy OWNER_ADMIN who is
  // also a verified practitioner has been authoring notes all along; the
  // migration must not take that away on the day roles ship. An owner who is
  // NOT a clinician gains nothing here, which is the whole point of the rule.
  if (
    staff.role === 'OWNER_ADMIN' &&
    (isCredentialedClinician(staff) || hasDoctorIdentity(staff)) &&
    !fallback.includes('DOCTOR')
  ) {
    fallback.push('DOCTOR');
  }

  return fallback;
}

export function effectivePermissions(
  staff: Staff,
  assigned?: SystemRole[],
): Set<Permission> {
  // An inactive account holds nothing. Checked here rather than at each call
  // site, because "deactivated" that only removes the menu item is not
  // deactivated.
  if (!staff.active) return new Set();

  const granted = new Set<Permission>();
  for (const role of rolesOf(staff, assigned)) {
    for (const permission of ROLE_PERMISSIONS[role]) granted.add(permission);
  }

  // The credential gate. Holding DOCTOR opens the door to the clinical
  // record; SIGNING it asserts a professional identity, and that needs the
  // registration to exist and to have been verified by somebody.
  if (granted.has('note.sign') && !isCredentialedClinician(staff)) {
    granted.delete('note.sign');
  }

  return granted;
}

export function can(staff: Staff, permission: Permission, assigned?: SystemRole[]): boolean {
  return effectivePermissions(staff, assigned).has(permission);
}

/**
 * Staff-facing refusals. They say what was refused and what to do instead —
 * never which other role holds it, because an error message is not a place to
 * enumerate the clinic's permission model.
 */
const REFUSAL: Partial<Record<Permission, string>> = {
  'note.write':
    'Your account is not permitted to write a doctor’s clinical note. Use “Add Staff Remark” to record what you observed.',
  'note.sign':
    'Signing a clinical note requires a verified medical registration on your staff record.',
  'diagnosis.write': 'Only a doctor may record or change a diagnosis.',
  'clinical.void': 'Only a doctor may void a clinical record.',
  'document.authoriseClinical':
    'Only a doctor may clinically authorise this document. It can still be prepared and previewed.',
  'prescription.write': 'Only a doctor may prescribe.',
  'consultation.hold':
    'Only the attending clinician may put a consultation on hold.',
  'consultation.complete': 'Only a doctor may complete a consultation.',
  'patient.demographics.write': 'Your account is not permitted to change patient details.',
  'settings.manage': 'Only an owner may change clinic settings.',
  'users.manage': 'Only an owner may manage users and roles.',
};

export function assertCan(
  staff: Staff,
  permission: Permission,
  assigned?: SystemRole[],
): void {
  if (!can(staff, permission, assigned)) {
    throw new ForbiddenException(REFUSAL[permission] ?? 'Your account is not permitted to do this.');
  }
}

/**
 * The permission list the SESSION publishes, so the browser renders what the
 * server decided instead of deriving a second answer from the role.
 *
 * This is D1's lesson made structural: there is exactly one implementation,
 * and the client is a reader of it.
 */
export function permissionPayload(staff: Staff, assigned?: SystemRole[]): Permission[] {
  return [...effectivePermissions(staff, assigned)].sort();
}

/**
 * Guard: a tenant must never be left without an owner.
 *
 * Removing the last OWNER locks everybody out of Settings — including out of
 * the screen that would put an owner back. Checked before the write, and
 * again by the caller inside the transaction.
 */
export function wouldRemoveLastOwner(params: {
  currentOwnerStaffIds: string[];
  staffId: string;
  rolesAfter: SystemRole[];
}): boolean {
  const stillOwner = params.rolesAfter.includes('OWNER');
  if (stillOwner) return false;
  return params.currentOwnerStaffIds.length === 1 && params.currentOwnerStaffIds[0] === params.staffId;
}

/** DOCTOR may not be assigned to somebody with no professional identity. */
export function canHoldDoctorRole(staff: Staff): boolean {
  return Boolean(staff.medicalRegistrationNo?.trim());
}
