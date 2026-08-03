/**
 * G4.5d3 (D-077) — who was actually attending, said accurately.
 *
 * The source is not in question and never was: both the context band and the
 * history summary read the VISIT's own stored attending relationship
 * (`Visit.staffId` → `staff.fullName` / `staff.role`). Nothing here consults
 * the record creator, the registrar, the check-in clerk or "the first staff
 * member the tenant returned".
 *
 * What was wrong was the WORDING and a fixture. A visit whose stored attending
 * staff member is a nurse was printed under a heading that said "DR", so the
 * screen asserted a qualification the database never claimed. That is a
 * clinical-safety statement, not a cosmetic one.
 *
 * So the label follows the stored ROLE:
 *   - a doctor        → "Dr Amira Rahman"      (no doubled title, see below)
 *   - anyone else     → "Attending clinician: Nurse Amy Tan"
 *   - nobody stored   → "Attending clinician not recorded"
 *
 * Kuwick stores full names that often already begin with "Dr." or "Dr", which
 * is why the band read "DR Dr. Amira Rahman". The title is stripped from the
 * stored name and re-applied once, so the result is "Dr Amira Rahman" whether
 * or not the clinic typed one in.
 */

/** Roles that may be described with a doctor's title. */
const DOCTOR_ROLES = ['DOCTOR_RESIDENT', 'DOCTOR_LOCUM', 'DOCTOR_VISITING', 'DOCTOR'];

export function isDoctorRole(role: string | null | undefined): boolean {
  return Boolean(role && DOCTOR_ROLES.includes(role));
}

/** Removes any stored "Dr"/"Dr."/"DR" prefix so a title is never doubled. */
export function stripDoctorTitle(name: string): string {
  return name.replace(/^\s*(dr\.?|doctor)\s+/i, '').trim();
}

export interface AttendingLabel {
  /** "Dr Amira Rahman", "Nurse Amy Tan", or null when nobody is stored. */
  name: string | null;
  /** The prefix a reader needs: "" for a doctor, "Attending clinician" else. */
  prefix: string;
  /** Ready-to-render single string, honest in every case. */
  text: string;
}

export function attendingClinician(
  fullName: string | null | undefined,
  role: string | null | undefined,
): AttendingLabel {
  if (!fullName) {
    // Never inferred, never "Not assigned" — the record simply does not say.
    return { name: null, prefix: '', text: 'Attending clinician not recorded' };
  }
  if (isDoctorRole(role)) {
    const name = `Dr ${stripDoctorTitle(fullName)}`;
    return { name, prefix: '', text: name };
  }
  // A non-doctor is named plainly and NOT given a doctor's title.
  return { name: fullName, prefix: 'Attending clinician', text: `Attending clinician: ${fullName}` };
}
