import { describe, expect, it } from 'vitest';
import {
  SUBMIT_REFUSAL_MESSAGE,
  VITAL_FIELDS,
  decideSubmit,
  isVitalsFormEmpty,
  liveBmi,
  vitalsSignature,
} from './vitalsEntry';

// ===========================================================================
// G4.5d3c-3c — VITALS ENTRY
//
// The owner reported the same set of observations appearing twice on a visit
// and asked for the ACTUAL root cause, not a rendering workaround. There are
// two, and this file covers the client one: the form submits on Enter, which
// bypasses the Save button's loading state entirely, so a second keypress
// while the first request is in flight sends the whole set again.
//
// The server carries its own, independent protection (see
// visit-observation.service.spec.ts). Neither is sufficient alone.
// ===========================================================================

const READING = { bpSystolic: 120, bpDiastolic: 80, pulse: 72, temperature: 36.8 };

describe('an empty form is not a saveable reading', () => {
  it('1. nothing entered is empty', () => {
    expect(isVitalsFormEmpty({})).toBe(true);
    expect(isVitalsFormEmpty(undefined)).toBe(true);
  });

  it('2. a single value makes it saveable', () => {
    expect(isVitalsFormEmpty({ pulse: 72 })).toBe(false);
  });

  it('3. cleared fields count as empty', () => {
    expect(isVitalsFormEmpty({ pulse: null, weight: undefined, height: '' })).toBe(true);
  });

  it('4. whitespace is not a measurement', () => {
    expect(isVitalsFormEmpty({ temperature: '   ' })).toBe(true);
  });

  it('5. a pain score of zero IS a measurement', () => {
    // "No pain / 0" is a recorded clinical finding, not an absent one.
    expect(isVitalsFormEmpty({ painScore: 0 })).toBe(false);
  });

  it('6. every schema field is considered', () => {
    for (const field of VITAL_FIELDS) {
      expect(isVitalsFormEmpty({ [field]: 1 })).toBe(false);
    }
  });
});

describe('live BMI from the form', () => {
  it('7. reads the same shared calculator every other surface uses', () => {
    expect(liveBmi({ weight: 70, height: 170 })).toBe(24.2);
  });

  it('8. is null until both fields are usable', () => {
    expect(liveBmi({ weight: 70 })).toBeNull();
    expect(liveBmi({ height: 170 })).toBeNull();
    expect(liveBmi({})).toBeNull();
  });

  it('9. never yields NaN or Infinity from a half-typed field', () => {
    expect(liveBmi({ weight: 70, height: 0 })).toBeNull();
    expect(liveBmi({ weight: 'x', height: '170' })).toBeNull();
  });
});

describe('the signature identifies a reading', () => {
  it('10. the same numbers produce the same signature however they were typed', () => {
    expect(vitalsSignature({ temperature: 37 })).toBe(vitalsSignature({ temperature: '37.0' }));
    expect(vitalsSignature({ pulse: 72 })).toBe(vitalsSignature({ pulse: '72' }));
  });

  it('11. a different value produces a different signature', () => {
    expect(vitalsSignature({ pulse: 72 })).not.toBe(vitalsSignature({ pulse: 73 }));
  });

  it('12. two sets differing only in WHICH field is blank are different', () => {
    expect(vitalsSignature({ pulse: 72 })).not.toBe(vitalsSignature({ respRate: 72 }));
  });

  it('13. absent and cleared are the same — neither was recorded', () => {
    expect(vitalsSignature({ pulse: 72 })).toBe(vitalsSignature({ pulse: 72, weight: null }));
  });
});

describe('the double-submit guard', () => {
  const clean = { inFlight: null, lastAccepted: null };

  it('14. a first submission is allowed', () => {
    expect(decideSubmit(clean, READING)).toEqual({ allow: true });
  });

  it('15. the SAME reading while one is in flight is refused', () => {
    // This is the reported defect: Enter, nothing visible happens, Enter.
    const state = { inFlight: vitalsSignature(READING), lastAccepted: null };
    const decision = decideSubmit(state, READING);
    expect(decision.allow).toBe(false);
    expect(decision).toMatchObject({ reason: 'IN_FLIGHT' });
  });

  it('16. a DIFFERENT reading while one is in flight is also refused', () => {
    const state = { inFlight: vitalsSignature(READING), lastAccepted: null };
    expect(decideSubmit(state, { ...READING, pulse: 99 }).allow).toBe(false);
  });

  it('17. re-submitting exactly what was just accepted is refused', () => {
    const state = { inFlight: null, lastAccepted: vitalsSignature(READING) };
    expect(decideSubmit(state, READING)).toMatchObject({ allow: false, reason: 'DUPLICATE' });
  });

  it('18. a genuine repeat reading — any value changed — is allowed', () => {
    // A repeat BP after treatment is a real clinical act and must never be
    // swallowed by a guard aimed at stuck keypresses.
    const state = { inFlight: null, lastAccepted: vitalsSignature(READING) };
    expect(decideSubmit(state, { ...READING, bpSystolic: 118 })).toEqual({ allow: true });
  });

  it('19. a refusal SAYS so — a save that vanishes teaches people to press twice', () => {
    const state = { inFlight: vitalsSignature(READING), lastAccepted: null };
    const decision = decideSubmit(state, READING);
    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.message).toBe(SUBMIT_REFUSAL_MESSAGE.IN_FLIGHT);
      expect(decision.message.length).toBeGreaterThan(10);
    }
  });

  it('20. the duplicate message explains BOTH ways forward', () => {
    expect(SUBMIT_REFUSAL_MESSAGE.DUPLICATE).toMatch(/change a value/i);
    expect(SUBMIT_REFUSAL_MESSAGE.DUPLICATE).toMatch(/correct/i);
  });

  it('21. no refusal message leaks an enum, a column or a table name', () => {
    for (const message of Object.values(SUBMIT_REFUSAL_MESSAGE)) {
      expect(message).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
      expect(message).not.toMatch(/visit_observation|prisma|postgres/i);
    }
  });

  it('22. after a FAILED save the same values can be retried', () => {
    // The component clears inFlight without setting lastAccepted on failure;
    // this asserts the resulting state is submittable.
    const afterFailure = { inFlight: null, lastAccepted: null };
    expect(decideSubmit(afterFailure, READING)).toEqual({ allow: true });
  });

  it('23. a second, genuinely new reading after a success is allowed', () => {
    const state = { inFlight: null, lastAccepted: vitalsSignature(READING) };
    expect(decideSubmit(state, { pulse: 88 })).toEqual({ allow: true });
  });
});
