import { describe, expect, it } from 'vitest';
import {
  bracketForAgeMonths,
  defaultsFromItem,
  stockAdvice,
  supportsWeightBasedDosing,
  weightBasedDose,
} from './prescribing';
import { Item, ItemAgeDosage, StockLevel } from '../../inventory/types';

// ===========================================================================
// G4.5d6 — THE PRESCRIBING RULES
//
// Every function here decides part of a DOSE or tells a doctor what stock
// exists. The tests are written around the ways each could be wrong in a way
// that reaches a patient: a guessed unit, a calculation completed from
// missing data, a silence that reads as "in stock".
// ===========================================================================

const item = (over: Partial<Item> = {}): Item => ({
  id: 'item-1',
  tenantId: 't',
  code: 'AMX500',
  name: 'Amoxicillin 500mg',
  category: null,
  unitOfMeasure: null,
  doseDefault: null,
  doseUnitDefault: null,
  frequencyDefault: null,
  durationDefault: null,
  instruction: null,
  indication: null,
  concVolMl: null,
  strengthMg: null,
  consumptionMethod: null,
  defaultDispenseQuantity: null,
  prescriptionReference: null,
  remark: null,
  sellPrice: '5.00',
  cost: null,
  active: true,
  ...over,
});

const level = (over: Partial<StockLevel> = {}): StockLevel =>
  ({ itemId: 'item-1', quantityOnHand: 100, minThreshold: 0, ...over }) as StockLevel;

describe('what the medication master already knows', () => {
  it('1. fills dose, unit, frequency, duration, quantity, indication and instruction', () => {
    const defaults = defaultsFromItem(
      item({
        doseDefault: '2',
        doseUnitDefault: 'tablet',
        frequencyDefault: 'TDS',
        durationDefault: '5 days',
        defaultDispenseQuantity: 15,
        indication: 'Bacterial infection',
        instruction: 'Take after food',
      }),
    );
    expect(defaults).toEqual({
      amount: 2,
      unit: 'tablet',
      frequency: 'TDS',
      durationDays: 5,
      quantity: 15,
      indication: 'Bacterial infection',
      remark: 'Take after food',
    });
  });

  it('2. invents NOTHING — an item carrying no defaults contributes none', () => {
    // A guessed unit on a prescription is a dosing error, not a cosmetic one.
    expect(defaultsFromItem(item())).toEqual({});
  });

  it('3. ignores free text that is not a number', () => {
    expect(defaultsFromItem(item({ doseDefault: 'as directed' })).amount).toBeUndefined();
    expect(defaultsFromItem(item({ durationDefault: 'until finished' })).durationDays).toBeUndefined();
  });

  it('4. reads a number out of ordinary wording', () => {
    expect(defaultsFromItem(item({ durationDefault: '7 days' })).durationDays).toBe(7);
    expect(defaultsFromItem(item({ doseDefault: '2.5' })).amount).toBe(2.5);
  });

  it('5. refuses a zero or negative duration and a zero quantity', () => {
    expect(defaultsFromItem(item({ durationDefault: '0' })).durationDays).toBeUndefined();
    expect(defaultsFromItem(item({ defaultDispenseQuantity: 0 })).quantity).toBeUndefined();
  });

  it('6. treats whitespace-only text as absent', () => {
    expect(defaultsFromItem(item({ frequencyDefault: '   ', indication: '  ' }))).toEqual({});
  });
});

describe('the weight-based syrup calculation', () => {
  it('7. dose x concentration volume / strength', () => {
    // 12kg at 25mg/kg = 300mg; at 250mg per 5ml that is 6ml.
    const result = weightBasedDose(item({ concVolMl: '5', strengthMg: '250' }), 12, 25);
    expect(result).toEqual({ targetDoseMg: 300, volumeMl: 6 });
  });

  it('8. rounds the volume to two places, because a syringe has no more', () => {
    const result = weightBasedDose(item({ concVolMl: '5', strengthMg: '125' }), 9.4, 15);
    expect(result?.volumeMl).toBe(5.64);
  });

  it('9. returns NOTHING when any input is missing, rather than guessing', () => {
    // A calculator that completes from missing data is more dangerous than
    // no calculator, which is why this one exists at all.
    expect(weightBasedDose(item({ concVolMl: '5' }), 12, 25)).toBeNull();
    expect(weightBasedDose(item({ strengthMg: '250' }), 12, 25)).toBeNull();
    expect(weightBasedDose(item({ concVolMl: '5', strengthMg: '250' }), undefined, 25)).toBeNull();
    expect(weightBasedDose(item({ concVolMl: '5', strengthMg: '250' }), 12, undefined)).toBeNull();
    expect(weightBasedDose(undefined, 12, 25)).toBeNull();
  });

  it('10. refuses a zero or negative weight, rate or strength', () => {
    expect(weightBasedDose(item({ concVolMl: '5', strengthMg: '250' }), 0, 25)).toBeNull();
    expect(weightBasedDose(item({ concVolMl: '5', strengthMg: '250' }), 12, -1)).toBeNull();
    expect(weightBasedDose(item({ concVolMl: '5', strengthMg: '0' }), 12, 25)).toBeNull();
  });

  it('11. says up front whether a medicine can be dosed by weight', () => {
    expect(supportsWeightBasedDosing(item({ concVolMl: '5', strengthMg: '250' }))).toBe(true);
    expect(supportsWeightBasedDosing(item())).toBe(false);
    expect(supportsWeightBasedDosing(undefined)).toBe(false);
  });
});

describe('age brackets', () => {
  const brackets: ItemAgeDosage[] = [
    { id: '1', tenantId: 't', itemId: 'item-1', ageFromMonths: 0, ageToMonths: 11, amount: '2.5', unit: 'ml', frequency: 'BD' },
    { id: '2', tenantId: 't', itemId: 'item-1', ageFromMonths: 12, ageToMonths: 59, amount: '5', unit: 'ml', frequency: 'TDS' },
  ];

  it('12. picks the bracket the patient falls in, at both edges', () => {
    expect(bracketForAgeMonths(brackets, 0)?.id).toBe('1');
    expect(bracketForAgeMonths(brackets, 11)?.id).toBe('1');
    expect(bracketForAgeMonths(brackets, 12)?.id).toBe('2');
    expect(bracketForAgeMonths(brackets, 59)?.id).toBe('2');
  });

  it('13. returns nothing for an age no bracket covers', () => {
    // An adult must not silently inherit a paediatric dose.
    expect(bracketForAgeMonths(brackets, 600)).toBeNull();
  });

  it('14. copes with an unknown age and an item with no brackets', () => {
    expect(bracketForAgeMonths(brackets, null)).toBeNull();
    expect(bracketForAgeMonths(brackets, undefined)).toBeNull();
    expect(bracketForAgeMonths([], 12)).toBeNull();
    expect(bracketForAgeMonths(undefined, 12)).toBeNull();
  });
});

describe('what the doctor is told about stock', () => {
  it('15. says how much is on hand when there is enough', () => {
    expect(stockAdvice('item-1', 10, [level({ quantityOnHand: 100 })])).toMatchObject({
      position: 'SUFFICIENT',
      onHand: 100,
    });
  });

  it('16. names the shortfall in numbers, not adjectives', () => {
    const advice = stockAdvice('item-1', 30, [level({ quantityOnHand: 12 })]);
    expect(advice.position).toBe('INSUFFICIENT');
    expect(advice.message).toBe('Only 12 in stock — 30 prescribed.');
  });

  it('17. out of stock says where the patient stands', () => {
    const advice = stockAdvice('item-1', 5, [level({ quantityOnHand: 0 })]);
    expect(advice.position).toBe('NONE');
    expect(advice.message).toMatch(/supplied elsewhere/);
  });

  it('18. warns when the prescription would breach the clinic’s own minimum', () => {
    const advice = stockAdvice('item-1', 8, [level({ quantityOnHand: 20, minThreshold: 15 })]);
    expect(advice.position).toBe('LOW');
    expect(advice.message).toMatch(/minimum of 15/);
  });

  it('19. UNKNOWN is stated, never left as silence', () => {
    // Silence would read as "in stock", which is the one thing it must never
    // imply.
    const advice = stockAdvice('item-1', 5, []);
    expect(advice.position).toBe('UNKNOWN');
    expect(advice.message).toMatch(/unknown/i);
  });

  it('20. adds up every batch location for the item, and ignores other items', () => {
    const advice = stockAdvice('item-1', 5, [
      level({ quantityOnHand: 4 }),
      level({ quantityOnHand: 6 }),
      level({ itemId: 'item-2', quantityOnHand: 999 }),
    ]);
    expect(advice.onHand).toBe(10);
    expect(advice.position).toBe('SUFFICIENT');
  });

  it('21. says nothing at all before a medicine is chosen', () => {
    expect(stockAdvice(undefined, 5, [level()]).message).toBeNull();
    expect(stockAdvice('item-1', 5, undefined).message).toBeNull();
  });
});
