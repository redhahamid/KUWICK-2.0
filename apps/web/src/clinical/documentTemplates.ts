import dayjs from 'dayjs';
import { VitalsSource } from './hooks/useVisitObservations';
import { ClinicalNote, Diagnosis, DocumentType, Visit } from './types';
import { Clinic } from '../core/types';
import { Staff } from '../hr/types';

const DOCTOR_ROLE_LABEL: Partial<Record<string, string>> = {
  DOCTOR_RESIDENT: 'Medical Officer',
  DOCTOR_LOCUM: 'Locum Medical Officer',
};

export function doctorRoleLabel(staff?: Staff | null): string {
  if (!staff) return 'Medical Officer';
  return DOCTOR_ROLE_LABEL[staff.role] ?? staff.role.replace(/_/g, ' ');
}

// Tiptap stores rich HTML — letters need plain prose, so paragraph/line
// breaks become newlines before the remaining tags are stripped.
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// C0 (D-051) — accepts either a VisitObservation (the live source) or a
// legacy ClinicalNote's frozen vitals columns; the field names are identical
// on both, so one structural type serves the transition.
export function formatVitals(source?: VitalsSource | null): string {
  if (!source) return 'Not recorded';
  const parts: string[] = [];
  if (source.bpSystolic && source.bpDiastolic) parts.push(`BP: ${source.bpSystolic}/${source.bpDiastolic} mmHg`);
  if (source.pulse) parts.push(`Pulse: ${source.pulse} bpm`);
  if (source.temperature) parts.push(`Temp: ${source.temperature}°C`);
  if (source.spo2) parts.push(`SpO2: ${source.spo2}%`);
  if (source.respRate) parts.push(`Resp: ${source.respRate}/min`);
  return parts.length > 0 ? parts.join(', ') : 'Not recorded';
}

export function formatDiagnosisList(diagnoses?: Diagnosis[]): string {
  if (!diagnoses || diagnoses.length === 0) return '';
  return diagnoses.map((d) => (d.icd10Code ? `${d.name} (${d.icd10Code})` : d.name)).join(', ');
}

function fmtDate(value?: string | dayjs.Dayjs | null): string {
  if (!value) return '____________';
  return dayjs(value).format('DD/MM/YYYY');
}

// Matches the letterhead block real clinic systems print (clinic name,
// address, phone, email) — same fields as buildReferralTemplate's header,
// shared here so every document type gets one, not just referrals.
function buildHeader(clinic?: Clinic): string {
  return [clinic?.name, clinic?.address, clinic?.phone ? `Tel: ${clinic.phone}` : undefined, clinic?.email ? `Email: ${clinic.email}` : undefined]
    .filter(Boolean)
    .join('\n');
}

function buildSignatureBlock(doctorName?: string, doctorRole?: string, clinicName?: string): string {
  return [
    '..........................................',
    `${doctorName ?? '____________'}`,
    `${doctorRole ?? 'Medical Officer'}`,
    `${clinicName ?? ''}`,
  ].join('\n');
}

interface LeaveDocumentParams {
  /** TIME_SLIP only — hours attended on `startDate`. */
  hours?: number;
  clinic?: Clinic;
  clinicName?: string;
  patientName?: string;
  patientIdentifier?: string;
  doctorName?: string;
  doctorRole?: string;
  issuedDate?: string | dayjs.Dayjs | null;
  startDate?: string | dayjs.Dayjs | null;
  endDate?: string | dayjs.Dayjs | null;
  diagnosisText?: string;
}

export function buildMcTemplate(params: LeaveDocumentParams): string {
  const days =
    params.startDate && params.endDate
      ? dayjs(params.endDate).diff(dayjs(params.startDate), 'day') + 1
      : undefined;
  return [
    buildHeader(params.clinic),
    '',
    'MEDICAL CERTIFICATE',
    '',
    `Date: ${fmtDate(params.issuedDate)}`,
    '',
    `This is to certify that I have examined ${params.patientName ?? '____________'}${
      params.patientIdentifier ? ` (NRIC: ${params.patientIdentifier})` : ''
    } and found him/her to be unfit for duty for ${days ? `${days} day${days === 1 ? '' : 's'}` : '____'} from ${fmtDate(
      params.startDate,
    )} to ${fmtDate(params.endDate)}.`,
    '',
    `Diagnosis: ${params.diagnosisText || '-'}`,
    '',
    '',
    buildSignatureBlock(params.doctorName, params.doctorRole, params.clinic?.name ?? params.clinicName),
    '',
    'This certificate is not valid for absence from court proceedings.',
  ].join('\n');
}

export function buildQuarantineTemplate(params: LeaveDocumentParams): string {
  const days =
    params.startDate && params.endDate
      ? dayjs(params.endDate).diff(dayjs(params.startDate), 'day') + 1
      : undefined;
  return [
    buildHeader(params.clinic),
    '',
    'QUARANTINE LETTER',
    '',
    `Date: ${fmtDate(params.issuedDate)}`,
    '',
    `This is to certify that I have examined ${params.patientName ?? '____________'}${
      params.patientIdentifier ? ` (NRIC: ${params.patientIdentifier})` : ''
    } and advise quarantine/self-isolation for ${days ? `${days} day${days === 1 ? '' : 's'}` : '____'} from ${fmtDate(
      params.startDate,
    )} to ${fmtDate(params.endDate)}.`,
    '',
    `Reason: ${params.diagnosisText || '-'}`,
    '',
    '',
    buildSignatureBlock(params.doctorName, params.doctorRole, params.clinic?.name ?? params.clinicName),
  ].join('\n');
}

export function buildMemoTemplate(params: LeaveDocumentParams): string {
  return [
    buildHeader(params.clinic),
    '',
    'MEMO',
    '',
    `Date: ${fmtDate(params.issuedDate)}`,
    `Re: ${params.patientName ?? '____________'}`,
    '',
    '____________',
    '',
    '',
    buildSignatureBlock(params.doctorName, params.doctorRole, params.clinic?.name ?? params.clinicName),
  ].join('\n');
}

interface ReferralTemplateParams {
  clinic?: Clinic;
  referredTo?: string;
  patientName?: string;
  patientIdentifier?: string;
  presentingComplaint?: string;
  examinationNotes?: string;
  vitalsSummary?: string;
  diagnosisText?: string;
  doctorName?: string;
  doctorRole?: string;
  issuedDate?: string | dayjs.Dayjs | null;
}

export function buildReferralTemplate(params: ReferralTemplateParams): string {
  return [
    buildHeader(params.clinic),
    '',
    fmtDate(params.issuedDate),
    '',
    `To: ${params.referredTo ?? '____________'}`,
    '',
    'Dear Doctor,',
    '',
    `Thank you for seeing ${params.patientName ?? 'this patient'}${
      params.patientIdentifier ? ` (NRIC: ${params.patientIdentifier})` : ''
    }.`,
    '',
    `Presented with: ${params.presentingComplaint || '____________'}`,
    '',
    `On examination: ${params.examinationNotes || 'Not recorded'}`,
    '',
    `Vital signs: ${params.vitalsSummary || 'Not recorded'}`,
    '',
    `Diagnosis: ${params.diagnosisText || '____________'}`,
    '',
    `Referring for: ____________`,
    '',
    'Thank you for your time and services.',
    '',
    'Best regards,',
    '',
    buildSignatureBlock(params.doctorName, params.doctorRole, params.clinic?.name),
  ].join('\n');
}

/**
 * b3 PHASE F — the time slip.
 *
 * An attendance fact, and it is written as one. It certifies nothing about the
 * patient's health and says nothing about fitness for duty, because the person
 * who can attest that somebody was in the building is the person at the
 * counter, not a doctor — which is also why this type does not require
 * clinical authorisation.
 *
 * ONE DATE and a DURATION, never a range: a slip covering two days is an MC,
 * and offering a range here would invite somebody to issue the wrong document.
 */
export function buildTimeSlipTemplate(params: LeaveDocumentParams): string {
  const hours = params.hours;
  return [
    buildHeader(params.clinic),
    '',
    'TIME SLIP',
    '',
    `Date: ${fmtDate(params.issuedDate)}`,
    '',
    `This is to confirm that ${params.patientName ?? '____________'}${
      params.patientIdentifier ? ` (NRIC: ${params.patientIdentifier})` : ''
    } attended this clinic on ${fmtDate(params.startDate ?? params.issuedDate)} for ${
      hours ? `${hours} hour${hours === 1 ? '' : 's'}` : '____'
    }.`,
    '',
    'Issued at the patient’s request for their employer’s records.',
    '',
    '',
    buildSignatureBlock(params.doctorName, params.doctorRole, params.clinic?.name ?? params.clinicName),
  ].join('\n');
}

/**
 * b3 PHASE F — consent.
 *
 * A FORM TO BE SIGNED, not a statement Kuwick makes on anybody's behalf. The
 * procedure line is left for the clinician to complete and the signature block
 * belongs to the PATIENT: pre-filling a consent with a doctor's signature would
 * produce a document asserting an agreement nobody has given yet.
 */
export function buildConsentTemplate(params: LeaveDocumentParams & { procedure?: string }): string {
  return [
    buildHeader(params.clinic),
    '',
    'CONSENT FORM',
    '',
    `Date: ${fmtDate(params.issuedDate)}`,
    '',
    `Patient: ${params.patientName ?? '____________'}${
      params.patientIdentifier ? ` (NRIC: ${params.patientIdentifier})` : ''
    }`,
    '',
    `Procedure / treatment: ${params.procedure || '____________________'}`,
    '',
    'The nature, purpose and risks of the above have been explained to me. I have had',
    'the opportunity to ask questions, and I consent to it being carried out.',
    '',
    '',
    'Patient signature: ____________________     Date: ______________',
    '',
    `Explained by: ${params.doctorName ?? '____________________'}`,
  ].join('\n');
}

export function buildTemplate(
  type: DocumentType,
  params: LeaveDocumentParams & ReferralTemplateParams & { visit?: Visit; procedure?: string },
): string {
  switch (type) {
    case 'MC':
      return buildMcTemplate(params);
    case 'QUARANTINE':
      return buildQuarantineTemplate(params);
    case 'REFERRAL':
      return buildReferralTemplate(params);
    case 'TIME_SLIP':
      return buildTimeSlipTemplate(params);
    case 'CONSENT':
      return buildConsentTemplate(params);
    case 'MEMO':
    default:
      return buildMemoTemplate(params);
  }
}
