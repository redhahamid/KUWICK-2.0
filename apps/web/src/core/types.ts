export interface Clinic {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  timezone: string;
}

export interface CreateClinicDto {
  name: string;
  address?: string;
  timezone?: string;
}

export type PatientIdentifierType = 'NRIC' | 'PASSPORT';

export interface Patient {
  id: string;
  tenantId: string;
  identifierType: PatientIdentifierType;
  identifierValue: string;
  name: string;
  dob: string | null;
  gender: string | null;
}

export interface CreatePatientDto {
  identifierType: PatientIdentifierType;
  identifierValue: string;
  name: string;
  dob?: string;
  gender?: string;
}
