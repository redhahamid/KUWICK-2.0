import dayjs from 'dayjs';
import { Clinic, Patient } from '../core/types';
import { Staff } from '../hr/types';
import { VitalsSource } from './hooks/useVisitObservations';
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
  // G3b — the attributed observation record (C0/D-051), falling back to a
  // legacy note's frozen vitals. Previously {{vitals}} read the clinical
  // note directly here, which meant a custom template silently printed
  // "Not recorded" for every visit recorded after the observation split.
  observation?: VitalsSource | null;
}

function patientAge(patient?: Patient | null): string {
  if (!patient?.dob) return '';
  return String(dayjs().diff(dayjs(patient.dob), 'year'));
}

/**
 * G3b (§6) — BMI is DERIVED, never stored.
 *
 * Formula: weight (kg) / height (m)², rounded to one decimal — the standard
 * definition, spelled out here because a number on a clinical document must
 * be traceable to how it was produced. Height is recorded in centimetres.
 * Returns '' unless both values are present and sane, so a template that
 * asks for BMI on a visit without a height prints nothing rather than a
 * fabricated figure.
 *
 * This is the ONLY derived merge field. It is not the beginning of a
 * clinical-calculation engine.
 */
export function computeBmi(weightKg?: string | null, heightCm?: string | null): string {
  const weight = Number(weightKg);
  const height = Number(heightCm);
  if (!Number.isFinite(weight) || !Number.isFinite(height) || weight <= 0 || height <= 0) return '';
  const metres = height / 100;
  return (weight / (metres * metres)).toFixed(1);
}

// A measurement prints with its unit or not at all — "72" alone on a referral
// letter is not a weight.
function measurement(value: string | null | undefined, unit: string): string {
  if (value === null || value === undefined || value === '') return '';
  return `${value} ${unit}`;
}

export function buildMergeValues(ctx: MergeContext): Record<string, string> {
  const source = ctx.observation ?? ctx.clinicalNote ?? null;
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
    // The accepted standard general-vitals summary — BP, pulse, temperature,
    // SpO2, respiratory rate — unchanged in content and wording.
    vitals: formatVitals(ctx.observation ?? ctx.clinicalNote),
    notes: htmlToPlainText(ctx.clinicalNote?.notes),
    // G3b (§6) — structured optional observations. OPT-IN: a template only
    // gets these if its author wrote the placeholder, so no existing
    // template's output changes by adding them here. Weight is the one that
    // matters clinically (paediatric referrals quote a weight); height, BMI
    // and glucose stay template-specific.
    'observation.weight': measurement(source?.weight, 'kg'),
    'observation.height': measurement(source?.height, 'cm'),
    'observation.bmi': computeBmi(source?.weight, source?.height),
    'observation.glucose': measurement(source?.glucose, 'mmol/L'),
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
  // G3b (§6) — offered in the picker, never inserted automatically.
  { label: 'Latest Weight', field: 'observation.weight' },
  { label: 'Latest Height', field: 'observation.height' },
  { label: 'BMI (derived from weight & height)', field: 'observation.bmi' },
  { label: 'Latest Glucose', field: 'observation.glucose' },
];
