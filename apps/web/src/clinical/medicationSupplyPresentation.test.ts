import { describe, expect, it } from 'vitest';
import {
  SUPPLY_MODE_LABEL,
  SUPPLY_MODE_OPTIONS,
  SUPPLY_MODE_UNRESOLVED_LABEL,
  canOfferDispense,
  isUnresolvedSupply,
  supplyCounts,
  supplyModeLabel,
  toDispenseText,
  unresolvedText,
} from './medicationSupplyPresentation';
import { PrescriptionStatus, PrescriptionSupplyMode } from './types';

// ===========================================================================
// G4.5d3c-3a1 (D-091) — SUPPLY MODE PRESENTATION AND RAIL ACCURACY
// ===========================================================================

const RX = (status: PrescriptionStatus, supplyMode: PrescriptionSupplyMode | null) => ({ status, supplyMode });

describe('wording', () => {
  it('23. every approved value has its owner-approved label', () => {
    expect(SUPPLY_MODE_LABEL).toEqual({
      ONSITE_DISPENSE: 'Dispense from clinic',
      EXTERNAL_PRESCRIPTION: 'External prescription',
      PATIENT_OWN_SUPPLY: 'Patient already has medication',
      DEFERRED: 'Deferred supply',
      NO_SUPPLY_REQUIRED: 'No supply required',
    });
  });

  it('4. NULL has its own wording and is NOT clinic dispensing', () => {
    expect(supplyModeLabel(null)).toBe('Supply mode not confirmed');
    expect(supplyModeLabel(undefined)).toBe('Supply mode not confirmed');
    expect(supplyModeLabel(null)).not.toBe(SUPPLY_MODE_LABEL.ONSITE_DISPENSE);
  });

  it('24. no label or option contains a raw enum value', () => {
    const words = [
      ...Object.values(SUPPLY_MODE_LABEL),
      SUPPLY_MODE_UNRESOLVED_LABEL,
      ...SUPPLY_MODE_OPTIONS.map((o) => o.label),
    ].join(' ');
    expect(words).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
  });

  it('5. the select offers exactly the five approved values', () => {
    expect(SUPPLY_MODE_OPTIONS.map((o) => o.value)).toEqual([
      'ONSITE_DISPENSE',
      'EXTERNAL_PRESCRIPTION',
      'PATIENT_OWN_SUPPLY',
      'DEFERRED',
      'NO_SUPPLY_REQUIRED',
    ]);
  });
});

describe('rail counts', () => {
  it('14. ONSITE_DISPENSE + ORDERED counts as to dispense', () => {
    expect(supplyCounts([RX('ORDERED', 'ONSITE_DISPENSE')])).toEqual({ toDispense: 1, unresolved: 0 });
  });

  it.each([
    ['15. EXTERNAL_PRESCRIPTION', 'EXTERNAL_PRESCRIPTION'],
    ['16. PATIENT_OWN_SUPPLY', 'PATIENT_OWN_SUPPLY'],
    ['17. DEFERRED', 'DEFERRED'],
    ['18. NO_SUPPLY_REQUIRED', 'NO_SUPPLY_REQUIRED'],
  ])('%s never counts as to dispense', (_n, mode) => {
    expect(supplyCounts([RX('ORDERED', mode as PrescriptionSupplyMode)])).toEqual({
      toDispense: 0,
      unresolved: 0,
    });
  });

  it('19. NULL is the unresolved count, never the dispensing count', () => {
    expect(supplyCounts([RX('ORDERED', null)])).toEqual({ toDispense: 0, unresolved: 1 });
  });

  it('20. DISPENSED does not count — even with an onsite mode', () => {
    expect(supplyCounts([RX('DISPENSED', 'ONSITE_DISPENSE')])).toEqual({ toDispense: 0, unresolved: 0 });
  });

  it('21. CANCELLED does not count — even with a NULL mode', () => {
    expect(supplyCounts([RX('CANCELLED', null)])).toEqual({ toDispense: 0, unresolved: 0 });
  });

  it('the two counts never bleed into each other on a mixed list', () => {
    const counts = supplyCounts([
      RX('ORDERED', 'ONSITE_DISPENSE'),
      RX('ORDERED', 'ONSITE_DISPENSE'),
      RX('ORDERED', null),
      RX('ORDERED', 'EXTERNAL_PRESCRIPTION'),
      RX('DISPENSED', 'ONSITE_DISPENSE'),
      RX('CANCELLED', null),
    ]);
    expect(counts).toEqual({ toDispense: 2, unresolved: 1 });
  });

  it('22. singular and plural wording are both correct', () => {
    expect(toDispenseText(1)).toBe('1 to dispense');
    expect(toDispenseText(3)).toBe('3 to dispense');
    expect(unresolvedText(1)).toBe('1 supply mode unresolved');
    expect(unresolvedText(2)).toBe('2 supply modes unresolved');
  });
});

describe('dispense eligibility', () => {
  it('25. only ORDERED + ONSITE_DISPENSE may offer Dispense', () => {
    expect(canOfferDispense(RX('ORDERED', 'ONSITE_DISPENSE'))).toBe(true);
    for (const mode of ['EXTERNAL_PRESCRIPTION', 'PATIENT_OWN_SUPPLY', 'DEFERRED', 'NO_SUPPLY_REQUIRED'] as const) {
      expect(canOfferDispense(RX('ORDERED', mode))).toBe(false);
    }
    expect(canOfferDispense(RX('ORDERED', null))).toBe(false);
    expect(canOfferDispense(RX('DISPENSED', 'ONSITE_DISPENSE'))).toBe(false);
    expect(canOfferDispense(RX('CANCELLED', 'ONSITE_DISPENSE'))).toBe(false);
  });

  it('unresolved means ORDERED with nothing recorded — nothing else', () => {
    expect(isUnresolvedSupply(RX('ORDERED', null))).toBe(true);
    expect(isUnresolvedSupply(RX('ORDERED', 'DEFERRED'))).toBe(false);
    expect(isUnresolvedSupply(RX('DISPENSED', null))).toBe(false);
    expect(isUnresolvedSupply(RX('CANCELLED', null))).toBe(false);
  });
});
