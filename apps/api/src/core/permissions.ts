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
  // Patient alerts (A2). Two permissions because one cannot express "all
  // types except MEDICAL": `patient.alert.write` covers ACCESSIBILITY,
  // COMMUNICATION and ADMINISTRATIVE; the MEDICAL type — the one that joins
  // the allergy strip and bears on prescribing — needs
  // `patient.alert.medical.write`, which front counter does not hold.
  | 'patient.alert.write'
  | 'patient.alert.medical.write'
  // Administrative
  | 'patient.demographics.write'
  // Correcting the IC / passport number or the date of birth.
  //
  // HELD BY EVERY STAFF ROLE THAT SEES PATIENTS (owner's decision, 2026-08-16).
  // It shipped restricted to owner and front counter, and that was the wrong
  // trade: in a single-doctor clinic the person holding the IC card is whoever
  // is at the counter, and sending them to find an account with the permission
  // is how the SECOND patient record gets created — the exact failure this
  // capability exists to prevent.
  //
  // It stays a named permission rather than being folded into demographics,
  // because the safeguards hang off it and because narrowing it later should be
  // a one-line change somebody can review. What makes it safe was never the
  // grant list: a server-side check that no other patient holds the identifier,
  // a confirmation naming what is attached, and an append-only record of old
  // value → new value with the author's name and role snapshotted.
  | 'patient.identity.write'
  | 'patient.lhdn.write'
  | 'queue.manage'
  // Owner decision: queue actions split in two. The consultation FLOW —
  // calling the next patient, starting, sending on — is shared with doctors,
  // who do it for their own patients all day. Completing and cancelling a
  // ticket are counter administration.
  | 'queue.consultationFlow'
  // Owner decision: "financial corrections" is a power, not a job, so billing
  // splits by ACTION rather than by role. Counter work belongs to the counter;
  // moving money the clinic has already earned does not.
  | 'billing.counter'
  | 'billing.corrections'
  | 'document.print'
  // ---------------------------------------------------------------------
  // APPOINTMENTS & SCHEDULING
  //
  // These endpoints were gated by authentication alone. Any signed-in staff
  // member could book, move, cancel or no-show an appointment — including
  // stock and finance accounts, in a system granular enough elsewhere to name
  // who may sign a clinical note. The diary is the clinic's front door and it
  // needs the same treatment as the rest.
  //
  // Split by ACT, as everything here is: reading the diary, adding to it,
  // editing what is there, moving it, cancelling it, receiving the patient,
  // marking them absent, setting the rules aside, and configuring the module.
  // ---------------------------------------------------------------------
  | 'appointment.view'
  | 'appointment.create'
  | 'appointment.edit'
  | 'appointment.reschedule'
  | 'appointment.cancel'
  | 'appointment.check_in'
  | 'appointment.no_show'
  // Booking against the clinic's own scheduling rules — a full diary, notice
  // it would normally insist on. Never against approved leave or a closed
  // branch; see OVERRIDABLE_REASONS.
  | 'appointment.override'
  // Services, booking page, reminders, closed dates, branch booking rules.
  | 'appointment.configure'
  // The provider roster: shifts, OFF, blocks, locums.
  | 'appointment.manage_roster'
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
    'queue.consultationFlow',
    // Un-doing a saved clinical record, and putting a doctor's authority on a
    // certificate or referral. Both carry medicolegal weight and neither is
    // available to an administrator on the strength of ownership.
    'clinical.void',
    'document.authoriseClinical',
    'document.issueAdministrative',
    // A doctor authorises dispensing of what they prescribed.
    'dispense.perform',
    // Standing facts about the patient, every type including MEDICAL.
    'patient.alert.write',
    'patient.alert.medical.write',
    // A doctor who spots a transposed digit fixes it. In a small clinic they
    // are frequently the only person on shift, and the alternative is a second
    // patient record for the same human being.
    'patient.identity.write',
    // Printing what they issued — an MC, a referral — is part of the act.
    'document.print',
    // Owner decision: a 24-hour clinic runs night shifts with a skeleton
    // counter, and the doctor on duty raises the invoice and takes the money.
    // Refusing that does not make the clinic safer; it makes the doctor use
    // somebody else's login, which is worse. Corrections stay out of reach —
    // a doctor may bill for what they did, not discount or void it.
    'billing.counter',
    // A doctor books the follow-up from the canvas at the end of a
    // consultation — that IS the workflow, and it is the reason the "Book
    // follow-up" card exists. They may also move and cancel one, because a
    // doctor who is running late is the person who knows it first.
    'appointment.view',
    'appointment.create',
    'appointment.edit',
    'appointment.reschedule',
    'appointment.cancel',
    'appointment.no_show',
    // NOT check_in: receiving a patient is counter work, and the doctor is in
    // a room. NOT override, configure or manage_roster — a doctor arranging
    // their own roster around their own diary is exactly the conflict the
    // roster is meant to resolve.
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
    // Standing facts about the patient, every type including MEDICAL —
    // a nurse recording "Pregnant" or "On Warfarin" is exactly the workflow.
    'patient.alert.write',
    'patient.alert.medical.write',
    // Same reasoning as the doctor's: whoever is looking at the IC card when
    // the typo is spotted is who should be able to correct it.
    'patient.identity.write',
    // Nurses and front-desk-clinical run the diary alongside the counter, and
    // in a small clinic they ARE the counter. The full operational set, minus
    // the three that decide policy.
    'appointment.view',
    'appointment.create',
    'appointment.edit',
    'appointment.reschedule',
    'appointment.cancel',
    'appointment.check_in',
    'appointment.no_show',
  ],

  ADMINISTRATOR: [
    'patient.demographics.write',
    // Registration took the IC, so registration corrects it. Sending the
    // counter to find an owner for a transposed digit is how the duplicate
    // patient gets created instead.
    'patient.identity.write',
    // Front counter records wheelchair access, language, VIP handling — the
    // things they need BEFORE calling a patient. NOT the MEDICAL type: a
    // clinical standing fact is recorded by clinical staff.
    'patient.alert.write',
    'patient.lhdn.write',
    'queue.manage',
    'queue.consultationFlow',
    // Invoices, payments, receipts, visit classification, cancelling a line.
    // NOT discounts or invoice cancellation — those are `billing.corrections`,
    // which OWNER holds and which can be granted to an individual.
    'billing.counter',
    'document.print',
    // Front desk calls patients through, so resuming a held one is theirs.
    'consultation.resume',
    // THE DIARY IS THE FRONT COUNTER'S JOB. Everything operational, and
    // nothing that changes the clinic's rules: an override, the service
    // configuration and the roster belong to whoever runs the clinic.
    'appointment.view',
    'appointment.create',
    'appointment.edit',
    'appointment.reschedule',
    'appointment.cancel',
    'appointment.check_in',
    'appointment.no_show',
  ],

  // OWNER ALONE IS NOT CLINICAL. Not one permission here touches a patient's
  // record. A doctor-owner gets clinical ability from the DOCTOR role they
  // also hold — never from this one.
  // `patient.identity.write` is the one patient-facing entry, and it does not
  // breach the rule above: correcting a transposed digit in an IC is records
  // administration, not a clinical act — it asserts nothing about the patient's
  // health and appears in no clinical record. Every staff role that sees
  // patients now holds it; the owner is listed explicitly so an owner-only
  // account is not the one exception that has to go and find somebody.
  OWNER: [
    'settings.manage',
    'discount.approve',
    'users.manage',
    'billing.corrections',
    'patient.identity.write',
    // The diary is administration, not a clinical record, so the whole module
    // sits comfortably here without breaching "owner alone is not clinical" —
    // an appointment asserts nothing about anybody's health. The three
    // policy-shaped permissions are OWNER'S ALONE: setting a booking rule
    // aside, configuring services and the public page, and writing the roster.
    'appointment.view',
    'appointment.create',
    'appointment.edit',
    'appointment.reschedule',
    'appointment.cancel',
    'appointment.check_in',
    'appointment.no_show',
    'appointment.override',
    'appointment.configure',
    'appointment.manage_roster',
  ],
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
//
// OWNER DECISION (option 1): the four BACK-OFFICE legacy roles do NOT map to
// a system role at all. Mapping them to ADMINISTRATOR was the convenient
// answer and the wrong one: ADMINISTRATOR now officially means FRONT COUNTER
// — queue, counter billing, demographics — and a finance clerk, an HR clerk
// and a stock clerk would each have silently acquired the ability to move
// patients through the queue. They map to permission SUBSETS instead, below.
// No fifth role was invented, because the people it would describe do not
// exist: zero accounts hold HR_STAFF, STOCK_STAFF or PANEL_STAFF today.
// ---------------------------------------------------------------------------
export const LEGACY_ROLE_FALLBACK: Record<Role, SystemRole[]> = {
  // Owner + administrator, and NOT doctor: clinical ability comes from a
  // credential, and an owner who is also the GP is given DOCTOR explicitly.
  OWNER_ADMIN: ['OWNER', 'ADMINISTRATOR'],
  DOCTOR_RESIDENT: ['DOCTOR'],
  DOCTOR_LOCUM: ['DOCTOR'],
  // Records vitals AND registers patients. Both, or half their job vanishes.
  FRONT_DESK_CLINICAL_STAFF: ['CLINICAL_STAFF', 'ADMINISTRATOR'],
  // The four back-office roles hold no system role — see LEGACY_ROLE_PERMISSIONS.
  FINANCE_STAFF: [],
  HR_STAFF: [],
  STOCK_STAFF: [],
  PANEL_STAFF: [],
  // Not staff. No capability of any kind.
  PATIENT_PORTAL: [],
};

/**
 * The back-office fallback: legacy roles that resolve to PERMISSIONS directly.
 *
 * This table is code, not role assignment — nothing here is selectable in
 * Settings, and a real back-office hire is composed explicitly out of roles
 * and individual grants instead. It exists only so accounts created before
 * roles shipped keep working.
 *
 * WHAT EACH ONE GETS, AND WHAT IT LOSES:
 *
 *  FINANCE_STAFF  billing.counter + billing.corrections. Keeps all seven
 *                 billing actions it holds today. LOSES completing a queue
 *                 ticket / a visit, which it held under D-079 and D-087 —
 *                 an intentional narrowing: closing a visit asserts that
 *                 dispensing and payment are done, which is a counter fact,
 *                 not a finance one.
 *  HR_STAFF       nothing. It holds nothing in the queue or billing matrices
 *                 today. Patient demographics were never role-gated at all in
 *                 1.0, so there is no HR right to preserve there either.
 *  STOCK_STAFF    dispense.perform only. A widening (it is refused dispensing
 *                 today) and the reason the permission was carved out.
 *  PANEL_STAFF    billing.counter — panel claims are billing work. Also a
 *                 widening; it holds no billing action today.
 */
export const LEGACY_ROLE_PERMISSIONS: Partial<Record<Role, Permission[]>> = {
  FINANCE_STAFF: ['billing.counter', 'billing.corrections'],
  HR_STAFF: [],
  STOCK_STAFF: ['dispense.perform'],
  PANEL_STAFF: ['billing.counter'],
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

/**
 * The capability roles the actor loader attached to this Staff row, if any.
 *
 * `requireActor` widens Staff to ActingStaff and hangs the explicit
 * assignments off it. A plain Staff row — from a test, or a code path that
 * predates the loader — has none, and falls through to the legacy mapping,
 * which is what the old scattered role lists used to say. One reader, so the
 * two call sites that need it cannot drift apart.
 */
export function attachedRoles(staff: Staff): SystemRole[] | undefined {
  const attached = (staff as { assignedRoles?: SystemRole[] }).assignedRoles;
  return attached && attached.length > 0 ? attached : undefined;
}

/**
 * The permissions granted to THIS PERSON by name, if the actor loader attached
 * any. Same shape and same reason as `attachedRoles`: a plain Staff row from a
 * test or an older code path has none, and none is exactly what every caller
 * got before individual grants were wired up.
 */
export function attachedGrants(staff: Staff): Permission[] | undefined {
  const attached = (staff as { directGrants?: Permission[] }).directGrants;
  return attached && attached.length > 0 ? attached : undefined;
}

export function effectivePermissions(
  staff: Staff,
  assigned?: SystemRole[],
  /**
   * Permissions granted to THIS PERSON, outside any role.
   *
   * Additive only. There is deliberately no per-person revoke: a grant that
   * could subtract from a role would make "what can this person do"
   * answerable only by replaying two tables in the right order.
   */
  directGrants?: Permission[],
): Set<Permission> {
  // An inactive account holds nothing. Checked here rather than at each call
  // site, because "deactivated" that only removes the menu item is not
  // deactivated.
  if (!staff.active) return new Set();

  const granted = new Set<Permission>();
  for (const role of rolesOf(staff, assigned)) {
    for (const permission of ROLE_PERMISSIONS[role]) granted.add(permission);
  }
  for (const permission of directGrants ?? []) granted.add(permission);

  // The back-office fallback, for anybody with no explicit role assignment
  // yet. Same rule as the role fallback, and the same reason: an explicit
  // assignment always wins outright, so a staff member deliberately composed
  // in Settings never has their old job title added back underneath.
  if (!assigned || assigned.length === 0) {
    for (const permission of LEGACY_ROLE_PERMISSIONS[staff.role] ?? []) granted.add(permission);
  }

  // The credential gate. Holding DOCTOR opens the door to the clinical
  // record; SIGNING it asserts a professional identity, and that needs the
  // registration to exist and to have been verified by somebody.
  if (granted.has('note.sign') && !isCredentialedClinician(staff)) {
    granted.delete('note.sign');
  }

  return granted;
}

export function can(
  staff: Staff,
  permission: Permission,
  assigned?: SystemRole[],
  directGrants?: Permission[],
): boolean {
  return effectivePermissions(staff, assigned, directGrants).has(permission);
}

/**
 * The permissions that may be handed to ONE person without a role.
 *
 * A closed list on purpose. "Grant anything to anyone" is how a role model
 * becomes decorative — and note.sign is absent because a signing capability
 * without the medical registration behind it is not a permission anybody can
 * give.
 */
export const INDIVIDUALLY_GRANTABLE: Permission[] = [
  'billing.corrections',
  'dispense.perform',
  // A senior receptionist or a practice manager who is not an owner is
  // exactly who squeezes the extra patient in. Granting it to one person by
  // name is safer than widening ADMINISTRATOR for everybody, and every use of
  // it is recorded on the appointment with a reason.
  'appointment.override',
  // A clinic manager who writes the roster without owning the clinic.
  'appointment.manage_roster',
];

export function isIndividuallyGrantable(permission: string): permission is Permission {
  return (INDIVIDUALLY_GRANTABLE as string[]).includes(permission);
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
  'patient.identity.write':
    'Your account is not permitted to change a patient’s IC or date of birth. Ask any clinical or counter staff member to correct it — please do not create a second record for the same person.',
  'patient.alert.write': 'Your account is not permitted to manage patient alerts.',
  'patient.alert.medical.write':
    'Your account is not permitted to record a MEDICAL alert. Ask a doctor or clinical staff member to record it.',
  'billing.corrections':
    'Applying a discount or cancelling an invoice needs the billing-corrections permission.',
  'settings.manage': 'Only an owner may change clinic settings.',
  'appointment.view': 'Your account is not permitted to view the appointment diary.',
  'appointment.create': 'Your account is not permitted to book appointments.',
  'appointment.edit': 'Your account is not permitted to change appointments.',
  'appointment.reschedule': 'Your account is not permitted to move appointments.',
  'appointment.cancel': 'Your account is not permitted to cancel appointments.',
  'appointment.check_in': 'Your account is not permitted to check patients in.',
  'appointment.no_show': 'Your account is not permitted to mark an appointment as a no-show.',
  'appointment.override':
    'Booking against the clinic’s scheduling rules needs the appointment-override permission.',
  'appointment.configure': 'Only an owner may change how appointments and services are configured.',
  'appointment.manage_roster': 'Your account is not permitted to change the provider roster.',
  'users.manage': 'Only an owner may manage users and roles.',
};

export function assertCan(
  staff: Staff,
  permission: Permission,
  assigned?: SystemRole[],
  directGrants?: Permission[],
): void {
  if (!can(staff, permission, assigned, directGrants)) {
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
export function permissionPayload(
  staff: Staff,
  assigned?: SystemRole[],
  directGrants?: Permission[],
): Permission[] {
  return [...effectivePermissions(staff, assigned, directGrants)].sort();
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
