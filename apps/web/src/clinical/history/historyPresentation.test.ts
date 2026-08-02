import { describe, expect, it } from 'vitest';
import {
  additionalDiagnosisCount,
  additionalMedicationCount,
  contextChips,
  diagnosisLabel,
  hasNoClinicalSummary,
  mcDayCount,
  mcLabel,
  medicationLabels,
  referralLabel,
} from './historyPresentation';
import { VisitHistorySummary } from '../types';

// Sources read as text so the read-only guarantee is checked against what the
// files actually import, not against what the comments claim.
import cardSource from './VisitHistoryCard.tsx?raw';
import panelSource from './VisitHistoryPanel.tsx?raw';
import detailSource from './ReadOnlyVisitDetail.tsx?raw';
import pageSource from './HistoricalVisitPage.tsx?raw';
import hooksSource from './useVisitHistory.ts?raw';

const base: VisitHistorySummary = {
  id: 'v1',
  visitNumber: 'V-000012',
  checkInAt: '2026-05-01T09:30:00.000Z',
  checkOutAt: null,
  clinicId: 'clinic-1',
  clinicName: 'Main Branch',
  doctorName: 'Dr Amira Rahman',
  doctorRole: 'DOCTOR_RESIDENT',
  billingType: 'Cash',
  presentingComplaint: 'Fever for 3 days',
  queueNumber: 12,
  queueType: 'WALK_IN',
  primaryDiagnosis: { name: 'Dengue fever', icd10Code: 'A90', isPrimary: true },
  diagnosisCount: 3,
  medications: [
    { name: 'Paracetamol', strength: '500', status: 'DISPENSED' },
    { name: 'Oral rehydration salts', strength: null, status: 'DISPENSED' },
  ],
  medicationCount: 4,
  mc: { startDate: '2026-05-01', endDate: '2026-05-03' },
  referral: { referredTo: 'HKL Medical', title: null },
  documentCount: 2,
  voidedDocumentCount: 0,
};

describe('previous-visit summary', () => {
  it('names the diagnosis with its ICD-10 code when one is stored', () => {
    expect(diagnosisLabel(base)).toBe('Dengue fever (A90)');
  });

  it('omits the code when the diagnosis was recorded without one', () => {
    expect(diagnosisLabel({ ...base, primaryDiagnosis: { name: 'Acute gastritis', icd10Code: null, isPrimary: false } }))
      .toBe('Acute gastritis');
  });

  it('says nothing at all when no diagnosis was recorded', () => {
    expect(diagnosisLabel({ ...base, primaryDiagnosis: null, diagnosisCount: 0 })).toBeNull();
  });

  it('counts the diagnoses beyond the one on the card', () => {
    expect(additionalDiagnosisCount(base)).toBe(2);
    expect(additionalDiagnosisCount({ ...base, primaryDiagnosis: null, diagnosisCount: 0 })).toBe(0);
  });

  it('shows a medication strength only where the item stores one', () => {
    expect(medicationLabels(base)).toEqual(['Paracetamol 500', 'Oral rehydration salts']);
  });

  it('reports how many further medications were prescribed', () => {
    expect(additionalMedicationCount(base)).toBe(2);
  });

  it('counts an MC the way a clinic does — inclusive of both days', () => {
    expect(mcDayCount({ startDate: '2026-05-01', endDate: '2026-05-03' })).toBe(3);
    expect(mcDayCount({ startDate: '2026-05-01', endDate: '2026-05-01' })).toBe(1);
  });

  it('refuses to count a one-sided MC range', () => {
    expect(mcDayCount({ startDate: '2026-05-01', endDate: null })).toBeNull();
    expect(mcDayCount({ startDate: null, endDate: null })).toBeNull();
  });

  it('describes an MC with its length and dates', () => {
    expect(mcLabel(base)).toBe('MC · 3 days · 1–3 May 2026');
  });

  it('degrades an MC label to whatever was actually stored', () => {
    expect(mcLabel({ ...base, mc: { startDate: '2026-05-01', endDate: null } })).toBe('MC · from 1 May 2026');
    expect(mcLabel({ ...base, mc: { startDate: null, endDate: null } })).toBe('MC');
  });

  it('shows no MC line when no MC was issued', () => {
    expect(mcLabel({ ...base, mc: null })).toBeNull();
  });

  it('names the referral recipient where one is stored', () => {
    expect(referralLabel(base)).toBe('Referral · HKL Medical');
    expect(referralLabel({ ...base, referral: { referredTo: null, title: null } })).toBe('Referral');
    expect(referralLabel({ ...base, referral: null })).toBeNull();
  });

  it('only offers context chips whose data exists', () => {
    const chips = contextChips({ ...base, clinicName: null, queueNumber: null, queueType: null });
    expect(chips.map((chip) => chip.label)).toEqual(['Billing']);
  });

  it('translates the queue source into words', () => {
    expect(contextChips(base).find((chip) => chip.label === 'Source')?.value).toBe('Walk-in');
  });

  it('recognises a visit where nothing clinical was recorded', () => {
    expect(hasNoClinicalSummary(base)).toBe(false);
    expect(
      hasNoClinicalSummary({
        ...base,
        diagnosisCount: 0,
        medicationCount: 0,
        documentCount: 0,
        presentingComplaint: null,
      }),
    ).toBe(true);
  });
});

// =============================================================================
// G4 (D-067) §6 — the history container must not be able to write. This is
// asserted against the real source: hiding a button is not read-only, and a
// future edit that imports a mutation hook has to fail here.
// =============================================================================
const HISTORY_SOURCES: [string, string][] = [
  ['VisitHistoryCard', cardSource],
  ['VisitHistoryPanel', panelSource],
  ['ReadOnlyVisitDetail', detailSource],
  ['HistoricalVisitPage', pageSource],
  ['useVisitHistory', hooksSource],
];

// Comments in these files name the very hooks they avoid, to explain why. A
// naive scan would pass or fail for the wrong reason, so prose is removed
// first — same approach as the G3c invoice check.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const MUTATION_HOOKS = [
  'useMutation',
  'useCreate',
  'useUpdate',
  'useDelete',
  'useRemove',
  'useSign',
  'useAmend',
  'useVoid',
  'useAdd',
  'usePay',
  'useCancel',
  'useDispense',
  'useUpload',
];

describe('read-only enforcement', () => {
  for (const [name, source] of HISTORY_SOURCES) {
    const code = stripComments(source);

    it(`${name} imports no mutation hook`, () => {
      for (const hook of MUTATION_HOOKS) {
        expect(code).not.toContain(hook);
      }
    });

    it(`${name} mounts no editable clinical tab`, () => {
      for (const tab of ['ClinicalNotesTab', 'DiagnosisTab', 'MedicationsTab', 'DocumentsTab', 'OrdersServicesTab', 'InvoiceTab', 'CreateDocumentDrawer']) {
        expect(code).not.toContain(tab);
      }
    });

    it(`${name} does not touch the current visit's draft store`, () => {
      expect(code).not.toContain('clinical-draft-store');
      expect(code).not.toContain('useClinicalDraftStore');
    });

    it(`${name} issues no write verb over HTTP`, () => {
      for (const verb of ['apiClient.post', 'apiClient.patch', 'apiClient.put', 'apiClient.delete']) {
        expect(code).not.toContain(verb);
      }
    });
  }

  it('history caches are keyed apart from the current visit', () => {
    const code = stripComments(hooksSource);
    // Every queryKey in the history hooks starts with 'visit-history', so a
    // historical read can neither populate nor invalidate the caches the open
    // consultation is reading from ('visits', 'clinical-notes', …).
    const keys = code.match(/queryKey: \[[^\]]*/g) ?? [];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toContain("'visit-history'");
    }
  });

  it('Open Full Visit targets a new tab on the read-only route', () => {
    const code = stripComments(cardSource);
    expect(code).toContain('/history/patients/');
    expect(code).toContain("target=\"_blank\"");
  });

  it('the full historical route labels itself read only', () => {
    expect(pageSource).toContain('Historical Visit — Read Only');
  });
});
