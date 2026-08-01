import { describe, expect, it } from 'vitest';
import {
  buildMcTemplate,
  buildReferralTemplate,
  formatVitals,
  htmlToPlainText,
} from './documentTemplates';

describe('htmlToPlainText', () => {
  it('converts paragraph breaks to newlines and strips tags', () => {
    const html = '<p>Patient complains of fever.</p><p>No cough.</p>';
    expect(htmlToPlainText(html)).toBe('Patient complains of fever.\nNo cough.');
  });

  it('returns an empty string for null/undefined', () => {
    expect(htmlToPlainText(null)).toBe('');
    expect(htmlToPlainText(undefined)).toBe('');
  });
});

describe('formatVitals', () => {
  it('formats a full set of vitals into a single line', () => {
    // C0 (D-051) — formatVitals now takes the structural VitalsSource shared
    // by VisitObservation and a legacy note's frozen vitals columns.
    const result = formatVitals({
      bpSystolic: 120,
      bpDiastolic: 80,
      pulse: 72,
      temperature: '37.0',
      spo2: 98,
      respRate: 18,
      weight: null,
      height: null,
      glucose: null,
    });
    expect(result).toBe('BP: 120/80 mmHg, Pulse: 72 bpm, Temp: 37.0°C, SpO2: 98%, Resp: 18/min');
  });

  it('falls back to "Not recorded" when there is no note', () => {
    expect(formatVitals(null)).toBe('Not recorded');
  });
});

describe('buildMcTemplate', () => {
  it('computes the inclusive day count from the date range and includes the patient NRIC', () => {
    const text = buildMcTemplate({
      patientName: 'Ali bin Abu',
      patientIdentifier: '900101015001',
      doctorName: 'Dr. Amira Rahman',
      clinicName: 'Klinik Test',
      issuedDate: '2026-07-31',
      startDate: '2026-07-31',
      endDate: '2026-08-01',
      diagnosisText: 'Upper respiratory tract infection',
    });
    expect(text).toContain('unfit for duty for 2 days');
    expect(text).toContain('Ali bin Abu (NRIC: 900101015001)');
    expect(text).toContain('Diagnosis: Upper respiratory tract infection');
    expect(text).toContain('Dr. Amira Rahman');
    expect(text).toContain('not valid for absence from court proceedings');
  });
});

describe('buildReferralTemplate', () => {
  it('includes the clinic header and the structured letter sections', () => {
    const text = buildReferralTemplate({
      clinic: { id: 'c1', tenantId: 't1', name: 'Klinik Test', address: '1 Jalan Test', phone: '03-1111', email: 'a@b.com', timezone: 'Asia/Kuala_Lumpur' },
      referredTo: 'Hospital Kuala Lumpur, ENT Department',
      patientName: 'Ali bin Abu',
      presentingComplaint: 'Sore throat for 3 days',
      examinationNotes: 'Throat erythematous',
      vitalsSummary: 'BP: 120/80 mmHg',
      diagnosisText: 'Tonsillitis',
      doctorName: 'Dr. Amira Rahman',
      issuedDate: '2026-07-31',
    });
    expect(text).toContain('Klinik Test');
    expect(text).toContain('To: Hospital Kuala Lumpur, ENT Department');
    expect(text).toContain('Presented with: Sore throat for 3 days');
    expect(text).toContain('Diagnosis: Tonsillitis');
    expect(text).toContain('Dr. Amira Rahman');
  });
});
