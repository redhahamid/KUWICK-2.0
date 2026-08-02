import dayjs from 'dayjs';
import { ClinicalDocument, DocumentType } from '../types';

/**
 * G3b — how a clinical document describes itself.
 *
 * Kept out of the components so the workspace, the preview, the void
 * confirmation, the printed page and the download filename all name a
 * document the same way. Everything here reads only stored fields: where the
 * schema has nothing (a referral with no recorded recipient, a time slip with
 * no stored time range) the line is OMITTED rather than rendered as an empty
 * label, which would read as missing data rather than data we never collect.
 */

export const BUILT_IN_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'MC', label: 'Medical Certificate' },
  { value: 'REFERRAL', label: 'Referral Letter' },
  { value: 'MEMO', label: 'Clinical Memo' },
  { value: 'QUARANTINE', label: 'Quarantine Letter' },
];

// Short forms for the collapsed summary — "1 MC · 1 Referral · 1 Memo".
export const SHORT_TYPE_LABEL: Record<DocumentType, string> = {
  MC: 'MC',
  REFERRAL: 'Referral',
  MEMO: 'Memo',
  QUARANTINE: 'Quarantine',
  CUSTOM: 'Other',
};

export const TYPE_COLOR: Record<DocumentType, string> = {
  MC: 'red',
  REFERRAL: 'blue',
  MEMO: 'default',
  QUARANTINE: 'orange',
  CUSTOM: 'purple',
};

export function documentLabel(document: ClinicalDocument): string {
  if (document.type === 'CUSTOM') return document.title ?? 'Clinical Document';
  return BUILT_IN_TYPES.find((t) => t.value === document.type)?.label ?? document.type;
}

// A CUSTOM document is summarised by its own template name, so a clinic that
// configures "Time Slip" sees "Time Slip", not "Other".
export function shortLabel(document: ClinicalDocument): string {
  if (document.type === 'CUSTOM') return document.title ?? SHORT_TYPE_LABEL.CUSTOM;
  return SHORT_TYPE_LABEL[document.type];
}

export function staffName(staff?: { fullName: string } | null): string | null {
  return staff?.fullName ?? null;
}

/**
 * G3b closure (D-064) — what this document's status actually is.
 *
 * One generic "Signed" tag was the defect: it read as a doctor's signature
 * on documents a front-desk user had signed off, and on legacy rows whose
 * authority was never recorded at all. Every label below is derived from
 * stored data — `requiresClinicalAuthorisation` and `authorisationKind` —
 * and none of them claims more than the record can support.
 */
export type AuthorisationTone = 'draft' | 'authorised' | 'issued' | 'legacy';

export interface AuthorisationState {
  tone: AuthorisationTone;
  /** The short badge. */
  label: string;
  /** The full sentence, where the record supports one. */
  detail: string | null;
  /** A clinical document a doctor has not yet authorised. */
  isDraft: boolean;
}

function roleWords(role?: string | null): string {
  return role ? role.replace(/_/g, ' ').toLowerCase() : '';
}

export function authorisationState(document: ClinicalDocument): AuthorisationState {
  const when = document.signedAt ? dayjs(document.signedAt).format('D MMM YYYY, HH:mm') : null;
  const who = document.authorisedByNameSnapshot ?? staffName(document.signedBy);

  // Not signed off at all.
  if (!document.signedAt) {
    return document.requiresClinicalAuthorisation
      ? {
          tone: 'draft',
          label: 'Draft — not clinically authorised',
          detail: 'A doctor must authorise this document before it can be issued.',
          isDraft: true,
        }
      : { tone: 'draft', label: 'Not issued', detail: null, isDraft: false };
  }

  // Signed off, but by the pre-closure route: we know it happened and who
  // clicked, and nothing more. Say exactly that.
  if (document.authorisationKind === 'LEGACY_SIGN_OFF' || document.authorisationKind === null) {
    return {
      tone: 'legacy',
      label: 'Legacy sign-off',
      detail: `Authorisation type not recorded${when ? ` · signed off ${when}` : ''}${
        who ? ` by ${who}` : ''
      }`,
      // Deliberately NOT a draft: it is a historical record, not something a
      // doctor is being asked to finish. It simply never claims to be a
      // clinical authorisation.
      isDraft: false,
    };
  }

  if (document.authorisationKind === 'ADMINISTRATIVE') {
    return {
      tone: 'issued',
      label: 'Issued',
      detail: `Issued by ${who ?? 'not recorded'}${when ? ` on ${when}` : ''}`,
      isDraft: false,
    };
  }

  // CLINICAL — the only state that may name a doctor as responsible.
  const designation = document.authorisedByDesignationSnapshot;
  const role = designation ?? roleWords(document.authorisedByRoleSnapshot);
  return {
    tone: 'authorised',
    label: 'Clinically authorised',
    detail: `Clinically authorised by ${who ?? 'not recorded'}${role ? ` (${role})` : ''}${
      when ? ` on ${when}` : ''
    }`,
    isDraft: false,
  };
}

/**
 * May this document leave the clinic?
 *
 * A clinical document that no doctor has authorised must not be printed or
 * downloaded — the closure's preferred behaviour, and the only one that
 * stops an unauthorised "MC" circulating as a real one. Preview stays open
 * so front desk can still check the wording before a doctor sees it.
 */
export function canProduceFinalCopy(document: ClinicalDocument): boolean {
  return !authorisationState(document).isDraft;
}

export function inclusiveDays(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  return dayjs(end).diff(dayjs(start), 'day') + 1;
}

export interface DocumentDetail {
  label: string;
  value: string;
}

/**
 * The clinically meaningful fields for this document type, in reading order.
 * Only fields the schema actually stores; anything absent is dropped.
 */
export function documentDetails(document: ClinicalDocument): DocumentDetail[] {
  const details: DocumentDetail[] = [];
  const date = (value?: string | null) => (value ? dayjs(value).format('D MMM YYYY') : null);

  if (document.type === 'MC' || document.type === 'QUARANTINE') {
    const from = date(document.startDate);
    const to = date(document.endDate);
    const days = inclusiveDays(document.startDate, document.endDate);
    const periodLabel = document.type === 'MC' ? 'Unfit from' : 'Quarantine from';
    if (from) details.push({ label: periodLabel, value: to ? `${from} – ${to}` : from });
    if (days !== null) details.push({ label: 'Days', value: `${days} day${days === 1 ? '' : 's'}` });
    if (document.diagnosisText) {
      details.push({
        label: document.type === 'MC' ? 'Diagnosis' : 'Reason',
        value: document.diagnosisText,
      });
    }
  }

  if (document.type === 'REFERRAL') {
    if (document.referredTo) details.push({ label: 'Referred to', value: document.referredTo });
    if (document.diagnosisText) details.push({ label: 'Diagnosis', value: document.diagnosisText });
  }

  if (document.type === 'MEMO' || document.type === 'CUSTOM') {
    if (document.title) details.push({ label: 'Title', value: document.title });
    if (document.referredTo) details.push({ label: 'Addressed to', value: document.referredTo });
    // A configured template may legitimately carry a validity period.
    const from = date(document.startDate);
    const to = date(document.endDate);
    if (from) details.push({ label: 'Covering', value: to ? `${from} – ${to}` : from });
  }

  return details;
}

// "MC — Aminah Binti Yusof — 2026-08-02.txt". Predictable enough to sort in a
// downloads folder, specific enough to tell two MCs apart.
export function documentFileName(document: ClinicalDocument, patientName?: string): string {
  const safe = (value: string) => value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
  const parts = [
    shortLabel(document),
    patientName ? safe(patientName) : null,
    dayjs(document.issuedDate).format('YYYY-MM-DD'),
    document.recordStatus === 'VOIDED' ? 'VOIDED' : null,
  ].filter(Boolean);
  return `${safe(parts.join(' - '))}.txt`;
}

/**
 * Downloads the document text the clinic actually issued.
 *
 * Deliberately built from the STORED content rather than re-running the
 * template: a document downloaded a year later must read exactly as it did
 * when it was handed over, even if the template has since been edited. A
 * voided document carries its void notice in the file, so the text cannot
 * circulate looking valid.
 */
export function downloadDocument(document: ClinicalDocument, patientName?: string): void {
  // G3b closure (D-064) — an unauthorised clinical document is not a
  // document yet. Callers disable the control; this is the backstop, because
  // a disabled button is presentation and not a rule.
  if (!canProduceFinalCopy(document)) {
    throw new Error('This document has not been clinically authorised and cannot be downloaded.');
  }

  const header =
    document.recordStatus === 'VOIDED'
      ? [
          '*** VOIDED — THIS DOCUMENT IS NO LONGER VALID ***',
          document.voidedAt ? `Voided: ${dayjs(document.voidedAt).format('D MMM YYYY, HH:mm')}` : null,
          document.voidedByNameSnapshot ? `Voided by: ${document.voidedByNameSnapshot}` : null,
          document.voidReason ? `Reason: ${document.voidReason}` : null,
          '',
          '',
        ]
          .filter((line) => line !== null)
          .join('\n')
      : '';

  // The responsible party, stated in the file itself rather than left to the
  // template's own signature block — which is free text and may name anyone.
  const state = authorisationState(document);
  const footer = state.detail ? `\n\n----------------------------------------\n${state.detail}\n` : '';

  const blob = new Blob([header + document.content + footer], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = documentFileName(document, patientName);
  link.click();
  URL.revokeObjectURL(url);
}
