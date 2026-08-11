import { Staff } from '@prisma/client';

/**
 * ONE definition of "this staff member is a credentialed clinician".
 *
 * This exists because the same defect shipped twice. `seed-role-fixtures` and
 * `seed-staging-uat` each wrote SIX of the eight fields `isCredentialedClinician`
 * requires, each printed the word "credentialed", and each produced a doctor
 * who could not sign a note. Both were found the same way — by using the
 * fixture rather than reading it — and the second one was found while building
 * the CI guardrail, which is exactly the sort of thing a guardrail is supposed
 * to stop happening a third time.
 *
 * The root cause was never a typo. It was that "credentialed" had no single
 * definition: every seed re-derived it from memory, and memory is missing two
 * fields more often than it is missing none.
 *
 * So: nothing anywhere may hand-write these fields. Seeds, fixtures and any
 * future admin path all call this, and `credentialing.spec.ts` asserts that
 * what it writes is precisely what the predicate demands — including that
 * EVERY field it writes is load-bearing, so the two cannot drift apart in
 * either direction.
 */

/** What granting signing authority actually requires somebody to state. */
export interface ClinicianCredential {
  /** The practitioner's own registration. Never shared between two people. */
  registrationNo: string;
  /**
   * WHO granted it. A credential with no named granter is not a credential —
   * it is an assertion with nobody behind it, and the schema has carried the
   * two attribution columns since C0 for exactly that reason.
   */
  grantedByStaffId: string;
  /** Defaults to now. Injectable so a test does not depend on the clock. */
  at?: Date;
}

/**
 * The complete set of staff fields that make somebody able to sign.
 *
 * Returned as a plain object so it can be spread into a Prisma `create` or
 * `update` — the caller decides where the row goes; this decides what
 * "credentialed" means.
 */
export function credentialedClinicianFields(credential: ClinicianCredential) {
  const at = credential.at ?? new Date();
  const registrationNo = credential.registrationNo.trim();
  if (!registrationNo) {
    throw new Error('A credentialed clinician needs a medical registration number.');
  }
  if (!credential.grantedByStaffId) {
    throw new Error('A credentialed clinician needs the staff member who granted signing authority.');
  }

  return {
    professionalType: 'MEDICAL_DOCTOR' as const,
    professionalActive: true,
    medicalRegistrationNo: registrationNo,
    professionalVerifiedAt: at,
    professionalVerifiedByStaffId: credential.grantedByStaffId,
    canSignClinicalNotes: true,
    clinicalSigningEnabledAt: at,
    clinicalSigningEnabledByStaffId: credential.grantedByStaffId,
  };
}

/**
 * The explicit NOT-a-clinician shape.
 *
 * Written out rather than left to the column defaults, because a fixture that
 * REUSES a staff row has to clear what a previous run may have set. "It
 * defaults to false" is only true of a row that has just been created.
 */
export function nonClinicalFields() {
  return {
    professionalType: 'NON_CLINICAL' as const,
    professionalActive: false,
    medicalRegistrationNo: null,
    professionalVerifiedAt: null,
    professionalVerifiedByStaffId: null,
    canSignClinicalNotes: false,
    clinicalSigningEnabledAt: null,
    clinicalSigningEnabledByStaffId: null,
  };
}

/** The field names this module owns — the list the spec mutates against. */
export const CREDENTIAL_FIELDS = Object.keys(
  credentialedClinicianFields({ registrationNo: 'X', grantedByStaffId: 'y' }),
) as (keyof Staff)[];
