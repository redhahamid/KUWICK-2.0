export interface Clinic {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  /**
   * What a PATIENT should read as this clinic's name: the booking page's
   * displayName when one exists, the clinic name otherwise. Resolved by the
   * server (clinic.service.ts) so every patient-facing message uses one
   * answer. Optional only because a cached list from an older API build may
   * not carry it — fall back to `name`.
   */
  patientFacingName?: string;
  /**
   * PHASE 8 — what a patient MESSAGE may reference: the public booking slug
   * (null when the page is off or absent — a manage link into a dead page is
   * a dead link) and the page's language, which templates default to.
   */
  bookingSlug?: string | null;
  bookingLanguage?: string;
}

export interface CreateClinicDto {
  name: string;
  address?: string;
  timezone?: string;
  phone?: string;
  email?: string;
}

export type UpdateClinicDto = Partial<CreateClinicDto>;

export type PatientIdentifierType = 'NRIC' | 'PASSPORT';

export interface Patient {
  id: string;
  tenantId: string;
  identifierType: PatientIdentifierType;
  identifierValue: string;
  name: string;
  dob: string | null;
  gender: string | null;
  race: string | null;
  phone: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  // `allergies` was here. It is gone: an allergy is recorded as an ALLERGY
  // alert, with an author and a timestamp, and "no known allergy" as a
  // NO_KNOWN_ALLERGY alert. One clinical fact, one store.
}

export interface CreatePatientDto {
  identifierType: PatientIdentifierType;
  identifierValue: string;
  name: string;
  dob?: string;
  gender?: string;
  race?: string;
  phone?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

export type UpdatePatientDto = Partial<CreatePatientDto>;
