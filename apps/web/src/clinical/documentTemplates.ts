import dayjs from 'dayjs';
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

export function formatVitals(note?: ClinicalNote | null): string {
  if (!note) return 'Not recorded';
  const parts: string[] = [];
  if (note.bpSystolic && note.bpDiastolic) parts.push(`BP: ${note.bpSystolic}/${note.bpDiastolic} mmHg`);
  if (note.pulse) parts.push(`Pulse: ${note.pulse} bpm`);
  if (note.temperature) parts.push(`Temp: ${note.temperature}°C`);
  if (note.spo2) parts.push(`SpO2: ${note.spo2}%`);
  if (note.respRate) parts.push(`Resp: ${note.respRate}/min`);
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

export function buildTemplate(
  type: DocumentType,
  params: LeaveDocumentParams & ReferralTemplateParams & { visit?: Visit },
): string {
  switch (type) {
    case 'MC':
      return buildMcTemplate(params);
    case 'QUARANTINE':
      return buildQuarantineTemplate(params);
    case 'REFERRAL':
      return buildReferralTemplate(params);
    case 'MEMO':
    default:
      return buildMemoTemplate(params);
  }
}
