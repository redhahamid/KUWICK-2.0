import { describe, expect, it } from 'vitest';
import {
  COUNTING_KEYS,
  STANDARD_PRESCRIPTION_KEYS,
  computeQuantity,
  standardPrescriptionValues,
  withClearedDefaults,
} from './standardPrescriptionForm';
import { CreateItemDto, Item } from './types';

// ===========================================================================
// PHASE 1G (1F) — CLEARING A DEFAULT HAS TO ACTUALLY CLEAR IT.
//
// The defect this file exists for is invisible in a browser: antd's
// `allowClear` returns `undefined`, `JSON.stringify` drops `undefined` keys,
// and the API reads a missing key as "leave it alone". A doctor deletes a
// wrong dose, the form says saved, and the wrong dose is still there next
// time — with no error anywhere to explain it.
// ===========================================================================

const ITEM = {
  id: 'item-1',
  name: 'T. PCM 500MG (AXCEL)',
  sellPrice: '0.20',
} as unknown as Item;

describe('an emptied field is sent as an explicit null', () => {
  it.each(STANDARD_PRESCRIPTION_KEYS)('%s survives JSON.stringify when cleared', (key) => {
    // The assertion is on the SERIALISED body, because that is where the key
    // disappears. Checking the object would pass while the request is wrong.
    const payload = withClearedDefaults({ name: 'x', sellPrice: 1, [key]: undefined } as CreateItemDto);
    expect(JSON.parse(JSON.stringify(payload))).toHaveProperty(key, null);
  });

  it('treats an empty string the same as cleared', () => {
    const payload = withClearedDefaults({
      name: 'x',
      sellPrice: 1,
      defaultDurationValue: '' as unknown as number,
    });
    expect(payload.defaultDurationValue).toBeNull();
  });

  it('sends every one of the seven, so a partial save cannot half-clear a medicine', () => {
    const payload = JSON.parse(JSON.stringify(withClearedDefaults({ name: 'x', sellPrice: 1 })));
    for (const key of STANDARD_PRESCRIPTION_KEYS) {
      expect(payload).toHaveProperty(key, null);
    }
  });

  // PIECE 2 — the same trap one section down, and it costs money rather than
  // a dose. A clinic withdrawing a divisor they are no longer sure of must not
  // be told "saved" while the old number keeps dividing their quantities.
  it.each(COUNTING_KEYS)('%s survives JSON.stringify when cleared', (key) => {
    const payload = withClearedDefaults({ name: 'x', sellPrice: 1, [key]: undefined } as CreateItemDto);
    expect(JSON.parse(JSON.stringify(payload))).toHaveProperty(key, null);
  });

  it('leaves `dispensedWhole` out of it — false IS the withdrawal', () => {
    // A boolean the form always sends. Nulling it would post `null` for a
    // field the API reads as a decision, which is neither true nor false.
    const payload = withClearedDefaults({ name: 'x', sellPrice: 1, dispensedWhole: false });
    expect(payload.dispensedWhole).toBe(false);
  });

  it('leaves the REST of the medicine form alone', () => {
    // Everything outside the seven has always used `undefined` to mean "don't
    // change this". Nulling those too would turn editing a price into wiping
    // the category, the remark and the dosage instructions.
    const payload = withClearedDefaults({
      name: 'x',
      sellPrice: 1,
      category: undefined,
      remark: undefined,
    });
    expect(payload.category).toBeUndefined();
    expect(payload.remark).toBeUndefined();
    expect(Object.keys(JSON.parse(JSON.stringify(payload)))).not.toContain('category');
  });

  it('does not touch values that were actually set', () => {
    const payload = withClearedDefaults({
      name: 'x',
      sellPrice: 1,
      defaultDoseAmount: 2,
      defaultFrequencyId: 'freq-1',
    });
    expect(payload.defaultDoseAmount).toBe(2);
    expect(payload.defaultFrequencyId).toBe('freq-1');
  });
});

describe('opening the form on an existing medicine', () => {
  it('turns the database decimal into a number the stepper can use', () => {
    // `2.50` as a string renders, but an InputNumber will not increment it.
    const values = standardPrescriptionValues({ ...ITEM, defaultDoseAmount: '2.50' });
    expect(values.defaultDoseAmount).toBe(2.5);
  });

  it('shows an unset dose as empty, not as zero', () => {
    // `Number(null)` is 0, and a form that opens showing "0 tablets" for a
    // medicine with no default is stating a dose nobody chose.
    const values = standardPrescriptionValues({ ...ITEM, defaultDoseAmount: null });
    expect(values.defaultDoseAmount).toBeNull();
  });

  it('carries every field through', () => {
    const values = standardPrescriptionValues({
      ...ITEM,
      defaultDoseAmount: '1',
      defaultDoseUnitId: 'unit-1',
      defaultFrequencyId: 'freq-1',
      defaultDurationValue: 7,
      defaultDurationUnit: 'DAY',
      defaultQuantity: 21,
      defaultConsumptionMethodId: 'method-1',
    });
    expect(values).toEqual({
      defaultDoseAmount: 1,
      defaultDoseUnitId: 'unit-1',
      defaultFrequencyId: 'freq-1',
      defaultDurationValue: 7,
      defaultDurationUnit: 'DAY',
      defaultQuantity: 21,
      defaultConsumptionMethodId: 'method-1',
    });
  });
});

describe('quantity is computed, or honestly declined', () => {
  it('2 tablets TDS for 5 days is 30', () => {
    expect(
      computeQuantity({ doseAmount: 2, timesPerDay: 3, durationValue: 5, durationUnit: 'DAY' }),
    ).toBe(30);
  });

  it('a week is seven days and a month is thirty', () => {
    expect(
      computeQuantity({ doseAmount: 1, timesPerDay: 2, durationValue: 1, durationUnit: 'WEEK' }),
    ).toBe(14);
    expect(
      computeQuantity({ doseAmount: 1, timesPerDay: 1, durationValue: 1, durationUnit: 'MONTH' }),
    ).toBe(30);
  });

  it('rounds a half-tablet course UP', () => {
    // 0.5 × 1 × 5 = 2.5 tablets. Rounding down hands the patient four days of
    // a five-day course.
    expect(
      computeQuantity({ doseAmount: 0.5, timesPerDay: 1, durationValue: 5, durationUnit: 'DAY' }),
    ).toBe(3);
  });

  it('declines when the frequency cannot be counted', () => {
    // PRN and STAT carry a null timesPerDay. The answer is "I don't know",
    // and it must not collapse into 1.
    expect(
      computeQuantity({ doseAmount: 2, timesPerDay: null, durationValue: 5, durationUnit: 'DAY' }),
    ).toBeNull();
  });

  it.each([
    ['no dose', { doseAmount: null, timesPerDay: 3, durationValue: 5, durationUnit: 'DAY' as const }],
    ['no duration', { doseAmount: 2, timesPerDay: 3, durationValue: null, durationUnit: 'DAY' as const }],
    ['no duration unit', { doseAmount: 2, timesPerDay: 3, durationValue: 5, durationUnit: null }],
  ])('declines with %s', (_label, input) => {
    expect(computeQuantity(input)).toBeNull();
  });
});
