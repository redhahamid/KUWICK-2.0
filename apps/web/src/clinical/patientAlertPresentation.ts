/**
 * b1.5 PHASE D — who the profile OFFERS an alert control to.
 *
 * Mirrors the server's `canWritePatientAlert`, and mirrors it in the safe
 * direction: this only ever hides or disables a control. The API refuses
 * regardless of what the browser believes, so a drift here costs somebody a
 * button, never an unauthorised write.
 *
 * A MEDICAL alert joins the allergy banner and bears on prescribing, which is
 * why it takes its own permission — the front counter can record the
 * wheelchair and the outstanding balance, not the penicillin.
 */

/** Anyone who may record a non-medical standing fact. */
export const ALERT_ROLES = [
  'OWNER_ADMIN',
  'DOCTOR_RESIDENT',
  'DOCTOR_LOCUM',
  'FRONT_DESK_CLINICAL_STAFF',
  'FRONT_DESK',
];

/** The narrower list, for facts that change what may safely be prescribed. */
export const MEDICAL_ALERT_ROLES = [
  'OWNER_ADMIN',
  'DOCTOR_RESIDENT',
  'DOCTOR_LOCUM',
  'FRONT_DESK_CLINICAL_STAFF',
];

export function mayManagePatientAlerts(role: string | null | undefined): boolean {
  return role != null && ALERT_ROLES.includes(role);
}

export function mayRecordMedicalAlert(role: string | null | undefined): boolean {
  return role != null && MEDICAL_ALERT_ROLES.includes(role);
}
