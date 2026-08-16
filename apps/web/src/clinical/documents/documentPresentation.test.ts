import { describe, expect, it } from 'vitest';
import { buildMergeValues, computeBmi, resolveTemplate } from '../mergeFields';
import { ClinicalDocument } from '../types';
import {
  authorisationState,
  canProduceFinalCopy,
  documentDetails,
  documentFileName,
  documentLabel,
  downloadDocument,
  shortLabel,
} from './documentPresentation';

const BASE: ClinicalDocument = {
  id: 'doc-1',
  visitId: 'visit-1',
  type: 'MC',
  title: null,
  content: 'MEDICAL CERTIFICATE',
  issuedByStaffId: 'staff-1',
  issuedDate: '2026-08-02',
  startDate: null,
  endDate: null,
  hours: null,
  diagnosisText: null,
  referredTo: null,
  signedAt: null,
  signedByStaffId: null,
  createdAt: '2026-08-02T09:00:00.000Z',
  updatedAt: '2026-08-02T09:00:00.000Z',
  requiresClinicalAuthorisation: true,
  authorisationKind: null,
  authorisedByNameSnapshot: null,
  authorisedByRoleSnapshot: null,
  authorisedByDesignationSnapshot: null,
  recordStatus: 'ACTIVE',
  voidedAt: null,
  voidedByStaffId: null,
  voidedByNameSnapshot: null,
  voidedByRoleSnapshot: null,
  voidReason: null,
  version: 1,
};

describe('documentDetails', () => {
  it('gives an MC its rest period and an inclusive day count', () => {
    const details = documentDetails({ ...BASE, startDate: '2026-08-02', endDate: '2026-08-04' });
    expect(details).toContainEqual({ label: 'Unfit from', value: '2 Aug 2026 – 4 Aug 2026' });
    expect(details).toContainEqual({ label: 'Days', value: '3 days' });
  });

  it('counts a single-day MC as 1 day, not 0', () => {
    const details = documentDetails({ ...BASE, startDate: '2026-08-02', endDate: '2026-08-02' });
    expect(details).toContainEqual({ label: 'Days', value: '1 day' });
  });

  // §3 — omit rather than render a misleading blank.
  it('omits fields the schema has no value for', () => {
    const details = documentDetails(BASE);
    expect(details.map((d) => d.label)).not.toContain('Unfit from');
    expect(details.map((d) => d.label)).not.toContain('Days');
    expect(details.map((d) => d.label)).not.toContain('Diagnosis');
  });

  it('shows a referral its recipient', () => {
    const details = documentDetails({ ...BASE, type: 'REFERRAL', referredTo: 'HKL, ENT Department' });
    expect(details).toContainEqual({ label: 'Referred to', value: 'HKL, ENT Department' });
  });

  it('labels a quarantine period as quarantine, not as unfitness', () => {
    const details = documentDetails({
      ...BASE,
      type: 'QUARANTINE',
      startDate: '2026-08-02',
      endDate: '2026-08-06',
      diagnosisText: 'Close contact',
    });
    expect(details[0].label).toBe('Quarantine from');
    expect(details).toContainEqual({ label: 'Reason', value: 'Close contact' });
  });
});

describe('document labels', () => {
  it('names a custom document by its template name', () => {
    const doc = { ...BASE, type: 'CUSTOM' as const, title: 'Time Slip' };
    expect(documentLabel(doc)).toBe('Time Slip');
    expect(shortLabel(doc)).toBe('Time Slip');
  });

  it('falls back to a neutral label when a custom document has no title', () => {
    expect(documentLabel({ ...BASE, type: 'CUSTOM', title: null })).toBe('Clinical Document');
  });
});

describe('documentFileName', () => {
  it('is specific enough to tell two documents apart', () => {
    expect(documentFileName(BASE, 'Aminah Binti Yusof')).toBe('MC - Aminah Binti Yusof - 2026-08-02.txt');
  });

  it('marks a voided download in the filename itself', () => {
    expect(documentFileName({ ...BASE, recordStatus: 'VOIDED' }, 'Aminah')).toBe(
      'MC - Aminah - 2026-08-02 - VOIDED.txt',
    );
  });

  it('strips characters a filesystem would reject', () => {
    expect(documentFileName(BASE, 'A/B:C*D?')).toBe('MC - A-B-C-D- - 2026-08-02.txt');
  });
});

// G3b closure (D-064) — the terminology must never claim more than the record
// supports. One generic "Signed" for all of these was the defect.
describe('authorisationState', () => {
  it('calls an unauthorised clinical document a draft, not "not signed"', () => {
    const state = authorisationState(BASE);
    expect(state.label).toBe('Draft — not clinically authorised');
    expect(state.isDraft).toBe(true);
  });

  it('names the responsible doctor only for a real clinical authorisation', () => {
    const state = authorisationState({
      ...BASE,
      signedAt: '2026-08-02T10:30:00.000Z',
      authorisationKind: 'CLINICAL',
      authorisedByNameSnapshot: 'Dr. Amira Rahman',
      authorisedByRoleSnapshot: 'DOCTOR_RESIDENT',
      authorisedByDesignationSnapshot: 'Medical Doctor (MMC 12345)',
    });
    expect(state.label).toBe('Clinically authorised');
    expect(state.detail).toContain('Clinically authorised by Dr. Amira Rahman');
    expect(state.detail).toContain('Medical Doctor (MMC 12345)');
    expect(state.isDraft).toBe(false);
  });

  it('says "Issued", never "Clinically authorised", for an administrative document', () => {
    const state = authorisationState({
      ...BASE,
      type: 'CUSTOM',
      title: 'Time Slip',
      requiresClinicalAuthorisation: false,
      signedAt: '2026-08-02T10:30:00.000Z',
      authorisationKind: 'ADMINISTRATIVE',
      authorisedByNameSnapshot: 'Nurse Test Amy',
    });
    expect(state.label).toBe('Issued');
    expect(state.detail).toContain('Issued by Nurse Test Amy');
    expect(state.detail).not.toContain('Clinically authorised');
  });

  // The whole point: a front-desk sign-off from before the closure must not
  // read as a doctor's authorisation.
  it('presents a legacy sign-off as exactly that', () => {
    const state = authorisationState({
      ...BASE,
      signedAt: '2026-07-01T09:00:00.000Z',
      authorisationKind: 'LEGACY_SIGN_OFF',
    });
    expect(state.label).toBe('Legacy sign-off');
    expect(state.detail).toContain('Authorisation type not recorded');
    expect(state.detail).not.toContain('Clinically authorised');
  });

  it('treats a signed row with no recorded kind as legacy, not as authorised', () => {
    const state = authorisationState({ ...BASE, signedAt: '2026-07-01T09:00:00.000Z', authorisationKind: null });
    expect(state.label).toBe('Legacy sign-off');
  });

  it('an administrative document awaiting issuance is not called a clinical draft', () => {
    const state = authorisationState({ ...BASE, requiresClinicalAuthorisation: false });
    expect(state.label).toBe('Not issued');
    expect(state.isDraft).toBe(false);
  });
});

describe('final copies', () => {
  it('an unauthorised clinical document cannot produce a final copy', () => {
    expect(canProduceFinalCopy(BASE)).toBe(false);
    expect(() => downloadDocument(BASE, 'Aminah')).toThrow(/not been clinically authorised/);
  });

  it('an authorised document can', () => {
    const authorised = {
      ...BASE,
      signedAt: '2026-08-02T10:30:00.000Z',
      authorisationKind: 'CLINICAL' as const,
      authorisedByNameSnapshot: 'Dr. Amira Rahman',
    };
    expect(canProduceFinalCopy(authorised)).toBe(true);
  });

  it('an administrative document awaiting issuance is not blocked from printing', () => {
    expect(canProduceFinalCopy({ ...BASE, requiresClinicalAuthorisation: false })).toBe(true);
  });

  it('a legacy signed-off document is not retro-blocked', () => {
    expect(
      canProduceFinalCopy({ ...BASE, signedAt: '2026-07-01T09:00:00.000Z', authorisationKind: 'LEGACY_SIGN_OFF' }),
    ).toBe(true);
  });
});

describe('observation merge fields', () => {
  const observation = {
    bpSystolic: 128,
    bpDiastolic: 82,
    pulse: 76,
    temperature: '37.1',
    spo2: 98,
    respRate: 16,
    weight: '18.4',
    height: '105',
    glucose: '5.4',
  };

  it('keeps the accepted standard vitals summary unchanged', () => {
    const values = buildMergeValues({ observation });
    expect(values.vitals).toBe('BP: 128/82 mmHg, Pulse: 76 bpm, Temp: 37.1°C, SpO2: 98%, Resp: 16/min');
  });

  it('reads vitals from the observation record, not the clinical note', () => {
    const values = buildMergeValues({
      observation,
      clinicalNote: { ...observation, pulse: 999, notes: '' } as never,
    });
    expect(values.vitals).toContain('Pulse: 76 bpm');
  });

  it('prints measurements with their units', () => {
    const values = buildMergeValues({ observation });
    expect(values['observation.weight']).toBe('18.4 kg');
    expect(values['observation.height']).toBe('105 cm');
    expect(values['observation.glucose']).toBe('5.4 mmol/L');
  });

  it('derives BMI as weight / height² with height in centimetres', () => {
    // 18.4 kg at 1.05 m -> 18.4 / 1.1025 = 16.69...
    expect(computeBmi('18.4', '105')).toBe('16.7');
    expect(computeBmi('70', '175')).toBe('22.9');
  });

  it('prints nothing rather than a fabricated BMI when a measurement is missing', () => {
    expect(computeBmi('70', null)).toBe('');
    expect(computeBmi(null, '175')).toBe('');
    expect(computeBmi('0', '175')).toBe('');
    expect(buildMergeValues({ observation: { ...observation, height: null } })['observation.bmi']).toBe('');
  });

  it('leaves an existing template that never asks for observations unchanged', () => {
    const template = 'Dear Doctor,\n\nRe: {{patient.name}} ({{patient.nric}})\nDiagnosis: {{diagnosis}}';
    const before = resolveTemplate(template, { patient: { name: 'Aminah', identifierValue: '900101-10-5566' } as never });
    const after = resolveTemplate(template, {
      patient: { name: 'Aminah', identifierValue: '900101-10-5566' } as never,
      observation,
    });
    expect(after).toBe(before);
  });

  it('resolves the optional observation placeholders when a template asks for them', () => {
    expect(resolveTemplate('Weight: {{observation.weight}}, BMI: {{observation.bmi}}', { observation })).toBe(
      'Weight: 18.4 kg, BMI: 16.7',
    );
  });
});
