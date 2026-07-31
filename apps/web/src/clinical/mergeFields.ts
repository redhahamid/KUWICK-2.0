import dayjs from 'dayjs';
import { Clinic, Patient } from '../core/types';
import { Staff } from '../hr/types';
import { ClinicalNote, Diagnosis, Visit } from './types';
import { doctorRoleLabel, formatDiagnosisList, formatVitals, htmlToPlainText } from './documentTemplates';

// Document builder (D-040) — the {{merge.field}} vocabulary a template can
// use. Resolved client-side at generate time, same convention as the Phase
// A4 hardcoded builders these templates replace. Unknown placeholders are
// left visible ("{{foo}}") rather than silently swallowed, so a typo in a
// template is obvious on the generated document instead of disappearing.
export interface MergeContext {
  clinic?: Clinic;
  patient?: Patient | null;
  doctor?: Staff | null;
  visit?: Visit;
  clinicalNote?: ClinicalNote | null;
  diagnoses?: Diagnosis[];
  issuedDate?: dayjs.Dayjs;
}

function patientAge(patient?: Patient | null): string {
  if (!patient?.dob) return '';
  return String(dayjs().diff(dayjs(patient.dob), 'year'));
}

export function buildMergeValues(ctx: MergeContext): Record<string, string> {
  return {
    'clinic.name': ctx.clinic?.name ?? '',
    'clinic.address': ctx.clinic?.address ?? '',
    'clinic.phone': ctx.clinic?.phone ?? '',
    'clinic.email': ctx.clinic?.email ?? '',
    'patient.name': ctx.patient?.name ?? ctx.visit?.patient?.name ?? '',
    'patient.nric': ctx.patient?.identifierValue ?? ctx.visit?.patient?.identifierValue ?? '',
    'patient.age': patientAge(ctx.patient ?? ctx.visit?.patient),
    'patient.gender': ctx.patient?.gender ?? ctx.visit?.patient?.gender ?? '',
    'patient.phone': ctx.patient?.phone ?? ctx.visit?.patient?.phone ?? '',
    'doctor.name': ctx.doctor?.fullName ?? '',
    'doctor.role': ctx.doctor ? doctorRoleLabel(ctx.doctor) : '',
    date: (ctx.issuedDate ?? dayjs()).format('DD/MM/YYYY'),
    'visit.date': ctx.visit ? dayjs(ctx.visit.checkInAt).format('DD/MM/YYYY') : '',
    'visit.complaint': ctx.visit?.presentingComplaint ?? '',
    diagnosis: formatDiagnosisList(ctx.diagnoses),
    vitals: formatVitals(ctx.clinicalNote),
    notes: htmlToPlainText(ctx.clinicalNote?.notes),
  };
}

export function resolveTemplate(content: string, ctx: MergeContext): string {
  const values = buildMergeValues(ctx);
  return content.replace(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  );
}

// Shown in the template editors' insert picker — label: placeholder.
export const MERGE_FIELD_OPTIONS: { label: string; field: string }[] = [
  { label: 'Clinic Name', field: 'clinic.name' },
  { label: 'Clinic Address', field: 'clinic.address' },
  { label: 'Clinic Phone', field: 'clinic.phone' },
  { label: 'Clinic Email', field: 'clinic.email' },
  { label: 'Patient Name', field: 'patient.name' },
  { label: 'Patient NRIC', field: 'patient.nric' },
  { label: 'Patient Age', field: 'patient.age' },
  { label: 'Patient Gender', field: 'patient.gender' },
  { label: 'Patient Phone', field: 'patient.phone' },
  { label: 'Doctor Name', field: 'doctor.name' },
  { label: 'Doctor Role', field: 'doctor.role' },
  { label: "Today's Date", field: 'date' },
  { label: 'Visit Date', field: 'visit.date' },
  { label: 'Presenting Complaint', field: 'visit.complaint' },
  { label: 'Diagnosis', field: 'diagnosis' },
  { label: 'Vital Signs', field: 'vitals' },
  { label: 'Clinical Notes', field: 'notes' },
];
