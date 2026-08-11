import { PrescriptionSupplyMode } from '@prisma/client';
import { DEFAULT_SUPPLY_MODE, describeCopyOutcome, supplyModeForCopy } from './medication-supply-rules';

// ===========================================================================
// G4.5d3c-3c — COPY PREVIOUS, and the supply mode it writes
//
// The owner's report: medication entry required the supply mode too often.
// Copy Previous was the worst of it — it wrote no supply mode at all, so
// copying five repeat medications produced five NULLs and five doctor-phase
// blockers to clear by hand.
// ===========================================================================

describe('the clinic default', () => {
  it('1. is clinic dispensing', () => {
    expect(DEFAULT_SUPPLY_MODE).toBe(PrescriptionSupplyMode.ONSITE_DISPENSE);
  });
});

describe('what a copied prescription is given', () => {
  it.each([
    ['2. clinic dispensing', PrescriptionSupplyMode.ONSITE_DISPENSE],
    ['3. external prescription', PrescriptionSupplyMode.EXTERNAL_PRESCRIPTION],
    ['4. the patient already has it', PrescriptionSupplyMode.PATIENT_OWN_SUPPLY],
    ['5. no supply required', PrescriptionSupplyMode.NO_SUPPLY_REQUIRED],
  ])('%s is carried over unchanged', (_n, mode) => {
    // Silently converting an external prescription into clinic dispensing
    // would assert the clinic is supplying medicine it is not.
    expect(supplyModeForCopy(mode)).toEqual({ supplyMode: mode, origin: 'CARRIED_OVER' });
  });

  it('6. a source that recorded nothing takes the clinic default', () => {
    // A copy is a NEW prescribing decision made today, so it gets the same
    // visible default a freshly typed line gets — not a fresh "nobody said".
    expect(supplyModeForCopy(null)).toEqual({
      supplyMode: PrescriptionSupplyMode.ONSITE_DISPENSE,
      origin: 'DEFAULTED',
    });
    expect(supplyModeForCopy(undefined).origin).toBe('DEFAULTED');
  });

  it('7. a DEFERRED source is treated as unrecorded, not carried forward', () => {
    // "Decide later" was about a visit that has ended. Carrying it forward
    // would manufacture a new blocker out of an old hesitation.
    expect(supplyModeForCopy(PrescriptionSupplyMode.DEFERRED)).toEqual({
      supplyMode: PrescriptionSupplyMode.ONSITE_DISPENSE,
      origin: 'DEFAULTED',
    });
  });

  it('8. a copy never produces a NULL supply mode', () => {
    const inputs = [...Object.values(PrescriptionSupplyMode), null, undefined];
    for (const input of inputs) {
      expect(supplyModeForCopy(input as never).supplyMode).not.toBeNull();
    }
  });

  it('9. a copy never produces DEFERRED', () => {
    const inputs = [...Object.values(PrescriptionSupplyMode), null, undefined];
    for (const input of inputs) {
      expect(supplyModeForCopy(input as never).supplyMode).not.toBe(PrescriptionSupplyMode.DEFERRED);
    }
  });

  it('10. the rule is pure — it returns a decision and mutates nothing', () => {
    const source = PrescriptionSupplyMode.EXTERNAL_PRESCRIPTION;
    supplyModeForCopy(source);
    expect(source).toBe(PrescriptionSupplyMode.EXTERNAL_PRESCRIPTION);
  });
});

describe('what the clinic is told', () => {
  const carried = { supplyMode: PrescriptionSupplyMode.EXTERNAL_PRESCRIPTION, origin: 'CARRIED_OVER' as const };
  const defaulted = { supplyMode: PrescriptionSupplyMode.ONSITE_DISPENSE, origin: 'DEFAULTED' as const };

  it('11. an all-carried copy says the previous mode was kept', () => {
    expect(describeCopyOutcome([carried, carried])).toMatch(/carried over from the previous visit/i);
  });

  it('12. an all-defaulted copy names the default and how to change it', () => {
    const message = describeCopyOutcome([defaulted, defaulted]);
    expect(message).toMatch(/dispense from clinic/i);
    expect(message).toMatch(/change the supply mode/i);
  });

  it('13. a mixed copy reports both counts', () => {
    const message = describeCopyOutcome([carried, defaulted, defaulted]);
    expect(message).toMatch(/3 medications copied/);
    expect(message).toMatch(/1 kept the previous supply mode/);
    expect(message).toMatch(/2 had none recorded/);
  });

  it('14. copying nothing says nothing was copied', () => {
    expect(describeCopyOutcome([])).toBe('Nothing was copied.');
  });

  it('15. one medication is described in the singular', () => {
    expect(describeCopyOutcome([carried])).toMatch(/^1 medication copied/);
  });

  it('16. no wording leaks an enum value or a column name', () => {
    for (const decisions of [[carried], [defaulted], [carried, defaulted], []]) {
      const message = describeCopyOutcome(decisions);
      expect(message).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
      expect(message).not.toMatch(/supply_mode|prescription\.|prisma/i);
    }
  });
});
