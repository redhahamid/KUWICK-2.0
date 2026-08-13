import { describe, expect, it } from 'vitest';
import {
  DAYS_PER_DURATION_UNIT,
  computeQuantity,
  durationInDays,
  hasStandardPrescription,
  indicationLabel,
  indicationMatches,
  matchCatalogueByText,
  prefillFromStandard,
} from './prescriptionForm';
import { Item } from '../../inventory/types';
import { DosageUnitRow, IndicationRow, PrescriptionFrequencyRow } from '../hooks/useReferenceCatalogs';

// ===========================================================================
// b1 PHASE A — WHAT THE PRESCRIBING FORM OPENS WITH, AND WHAT IT REFUSES TO
// GUESS.
//
// Two failures here are silent and clinical: a quantity computed for a
// frequency that has no daily count, and a free-text unit quietly "matched" to
// a catalogue entry it does not mean. Both are tested from the restraint side.
// ===========================================================================

const base = { tenantId: 't', origin: 'SYSTEM' as const, active: true, sortOrder: 0 };
const TABLET: DosageUnitRow = { ...base, id: 'unit-tablet', systemNameEn: 'Tablet', patientLabelBm: 'BIJI', useCase: null };
const TDS: PrescriptionFrequencyRow = { ...base, id: 'freq-tds', code: 'TDS', doctorDisplay: 'Three times a day', patientLabelBm: 'Tiga kali sehari', timesPerDay: 3 };
const PRN: PrescriptionFrequencyRow = { ...base, id: 'freq-prn', code: 'PRN', doctorDisplay: 'When required', patientLabelBm: 'Bila perlu', timesPerDay: null };
const FEVER: IndicationRow = { ...base, id: 'ind-1', labelEn: 'Fever', labelBm: 'Demam' };

const CATALOGUES = { units: [TABLET], frequencies: [TDS, PRN] };

const medicine = (overrides: Partial<Item>): Item =>
  ({ id: 'item-1', name: 'T. PCM 500MG', sellPrice: '0.20', ...overrides }) as unknown as Item;

describe('a course is converted the same way the server converts it', () => {
  it.each([
    [2, 'DAY' as const, 2],
    [2, 'WEEK' as const, 14],
    [1, 'MONTH' as const, 30],
  ])('%s %s is %s days', (value, unit, days) => {
    expect(durationInDays(value, unit)).toBe(days);
  });

  it('agrees with the server that a month is 30 days', () => {
    // Written down on both sides. Two opinions about this would be two
    // different courses for one prescription — the browser would show the
    // quantity for one and the record would hold the other.
    expect(DAYS_PER_DURATION_UNIT).toEqual({ DAY: 1, WEEK: 7, MONTH: 30 });
  });
});

describe('quantity auto-compute', () => {
  it('2 tablets TDS for 5 days is 30', () => {
    expect(
      computeQuantity({ amount: 2, timesPerDay: 3, durationValue: 5, durationUnit: 'DAY' }),
    ).toBe(30);
  });

  it('counts a week as seven days and a month as thirty', () => {
    expect(computeQuantity({ amount: 1, timesPerDay: 2, durationValue: 1, durationUnit: 'WEEK' })).toBe(14);
    expect(computeQuantity({ amount: 1, timesPerDay: 1, durationValue: 1, durationUnit: 'MONTH' })).toBe(30);
  });

  it('SKIPS a frequency that cannot be counted', () => {
    // PRN and STAT. Returning 1 here would put a quantity nobody decided on a
    // when-required painkiller, and the dispensary would hand it over.
    expect(
      computeQuantity({ amount: 2, timesPerDay: PRN.timesPerDay, durationValue: 5, durationUnit: 'DAY' }),
    ).toBeNull();
  });

  it('rounds a half-tablet course UP', () => {
    expect(
      computeQuantity({ amount: 0.5, timesPerDay: 1, durationValue: 5, durationUnit: 'DAY' }),
    ).toBe(3);
  });

  it('declines while the form is still incomplete', () => {
    expect(computeQuantity({ amount: undefined, timesPerDay: 3, durationValue: 5, durationUnit: 'DAY' })).toBeNull();
    expect(computeQuantity({ amount: 2, timesPerDay: 3, durationValue: 0, durationUnit: 'DAY' })).toBeNull();
  });
});

describe('the form opens from the medicine\'s own standard prescription', () => {
  it('carries every field the medicine states', () => {
    const prefill = prefillFromStandard(
      medicine({
        defaultDoseAmount: '2.00',
        defaultDoseUnitId: TABLET.id,
        defaultFrequencyId: TDS.id,
        defaultDurationValue: 5,
        defaultDurationUnit: 'DAY',
        defaultQuantity: 30,
        defaultConsumptionMethodId: 'method-oral',
      }),
      CATALOGUES,
    );
    expect(prefill).toEqual({
      amount: 2,
      doseUnitId: TABLET.id,
      unit: 'Tablet',
      frequencyId: TDS.id,
      frequency: 'TDS',
      durationValue: 5,
      durationUnit: 'DAY',
      quantity: 30,
      consumptionMethodId: 'method-oral',
    });
  });

  it('a medicine with no defaults opens EMPTY', () => {
    // The rule the whole 1F seed was built around. Ten of the clinic's 236
    // medicines are arm slings and soaps and carry nothing; filling something
    // in for them would be a dosing claim about a wrist splint.
    const prefill = prefillFromStandard(medicine({}), CATALOGUES);
    expect(prefill).toEqual({});
    expect(hasStandardPrescription(prefill)).toBe(false);
  });

  it('a paediatric syrup gets its unit and route but NO dose', () => {
    // Weight-based dosing belongs to the calculator. A fixed adult dose on a
    // child's syrup is the error this whole restraint exists to prevent.
    const prefill = prefillFromStandard(
      medicine({ defaultDoseAmount: null, defaultDoseUnitId: TABLET.id, defaultConsumptionMethodId: 'm' }),
      CATALOGUES,
    );
    expect(prefill.amount).toBeUndefined();
    expect(prefill.doseUnitId).toBe(TABLET.id);
    expect(hasStandardPrescription(prefill)).toBe(true);
  });

  it('ignores a zero dose rather than opening with "0"', () => {
    // A form that opens showing a dose of zero is stating a dose nobody chose.
    expect(prefillFromStandard(medicine({ defaultDoseAmount: '0' }), CATALOGUES).amount).toBeUndefined();
  });

  it('needs BOTH halves of a duration before it uses either', () => {
    // A value with no unit is not a course. "5" alone could be days or weeks.
    expect(prefillFromStandard(medicine({ defaultDurationValue: 5 }), CATALOGUES).durationValue).toBeUndefined();
  });
});

describe('free text is matched exactly, or not at all', () => {
  it('matches a name that is the same word', () => {
    expect(matchCatalogueByText('tablet', [TABLET], (row) => row.systemNameEn)).toBe(TABLET.id);
    expect(matchCatalogueByText(' Tablet ', [TABLET], (row) => row.systemNameEn)).toBe(TABLET.id);
  });

  it('refuses to guess that "tab" means "Tablet"', () => {
    // A looser match would be this form deciding a doctor's shorthand — the
    // same guess the standard-prescription seed refused to make for a dose.
    // No match means the text stands alone and the prescription honestly
    // carries no Malay label for it.
    expect(matchCatalogueByText('tab', [TABLET], (row) => row.systemNameEn)).toBeUndefined();
    expect(matchCatalogueByText('tablets', [TABLET], (row) => row.systemNameEn)).toBeUndefined();
  });

  it('returns nothing while the catalogue has not loaded', () => {
    expect(matchCatalogueByText('Tablet', undefined, (row: DosageUnitRow) => row.systemNameEn)).toBeUndefined();
  });
});

describe('an indication is found in either language', () => {
  it.each(['fever', 'FEVER', 'demam', 'Dem'])('%s finds it', (term) => {
    // A Malaysian clinic types "demam" as readily as "fever". An
    // English-only search would send half the staff to the free-text box for
    // entries that are already on the list.
    expect(indicationMatches(FEVER, term)).toBe(true);
  });

  it('does not match something else', () => {
    expect(indicationMatches(FEVER, 'cough')).toBe(false);
  });

  it('shows both languages, because either is what somebody looks for', () => {
    expect(indicationLabel(FEVER)).toBe('Fever / Demam');
  });
});
