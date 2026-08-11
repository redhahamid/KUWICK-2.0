import { describe, expect, it } from 'vitest';
import {
  ALL_VITAL_FIELDS,
  INLINE_VITALS,
  INLINE_VITAL_FIELDS,
  bmiBadge,
  inlineVitalsPayload,
  seedFromObservation,
  shouldSaveVitals,
  vitalsKey,
} from './inlineVitals';

// ===========================================================================
// KW2-C3 — vitals entered where they are read.
//
// The two things that can go wrong here are both silent: a BMI computed from
// half a measurement, and an autosave that records a reading nobody took.
// ===========================================================================

describe('which vitals go inline', () => {
  it('the six from the mockup, and blood pressure as one reading', () => {
    expect(INLINE_VITALS.map((v) => v.label)).toEqual(['BP', 'PR', 'Temp', 'SpO₂', 'Wt', 'Ht']);
    expect(INLINE_VITAL_FIELDS).toContain('bpSystolic');
    expect(INLINE_VITAL_FIELDS).toContain('bpDiastolic');
  });

  it('the four the strip does NOT own keep their home in the full panel', () => {
    // A row of eleven inputs across the middle column is a form, not a strip,
    // and these four are recorded on a small minority of visits.
    for (const field of ['respRate', 'painScore', 'headCircumference', 'glucose']) {
      expect(INLINE_VITAL_FIELDS).not.toContain(field);
      expect(ALL_VITAL_FIELDS).toContain(field as never);
    }
  });
});

describe('the BMI badge', () => {
  it('is a muted dash with a hint when nothing is entered', () => {
    const badge = bmiBadge({});
    expect(badge.computed).toBe(false);
    expect(badge.value).toBe('—');
    expect(badge.hint).toMatch(/fills when Wt \+ Ht/i);
  });

  it('names WHICH measurement is missing rather than sitting blank', () => {
    expect(bmiBadge({ weight: 70 }).hint).toBe('enter height');
    expect(bmiBadge({ height: 170 }).hint).toBe('enter weight');
  });

  it('computes only when BOTH are present', () => {
    const badge = bmiBadge({ weight: 70, height: 170 });
    expect(badge.computed).toBe(true);
    expect(badge.value).toBe('24.2');
  });

  it('refuses impossible values instead of printing NaN', () => {
    // A height of zero used to produce Infinity and render it.
    expect(bmiBadge({ weight: 70, height: 0 }).computed).toBe(false);
    expect(bmiBadge({ weight: 0, height: 170 }).computed).toBe(false);
    expect(bmiBadge({ weight: 70, height: 0 }).value).toBe('—');
  });

  it('NEVER carries a category', () => {
    // "Overweight" is wrong against a child, a pregnant patient and an
    // amputee alike, and this strip knows about none of them.
    const words = JSON.stringify(bmiBadge({ weight: 95, height: 170 }));
    for (const forbidden of [/overweight/i, /obese/i, /underweight/i, /normal/i, /healthy/i]) {
      expect(words).not.toMatch(forbidden);
    }
  });
});

describe('when an inline edit is worth sending', () => {
  it('an empty strip is never saved', () => {
    // The server refuses a set with no values, and a doctor should not learn
    // that by way of a failed request.
    expect(shouldSaveVitals({}, null)).toBe(false);
    expect(shouldSaveVitals({ pulse: undefined }, null)).toBe(false);
  });

  it('a first reading is saved', () => {
    expect(shouldSaveVitals({ pulse: 82 }, null)).toBe(true);
  });

  it('re-typing the SAME numbers records nothing', () => {
    // A re-save would create a second observation row — attributed,
    // timestamped, and describing a reading nobody took.
    const values = { bpSystolic: 120, bpDiastolic: 80 };
    expect(shouldSaveVitals(values, vitalsKey(values))).toBe(false);
  });

  it('"37" and "37.0" are the same reading', () => {
    expect(shouldSaveVitals({ temperature: 37.0 }, vitalsKey({ temperature: '37' }))).toBe(false);
  });

  it('changing one value saves', () => {
    const before = vitalsKey({ bpSystolic: 120, bpDiastolic: 80 });
    expect(shouldSaveVitals({ bpSystolic: 130, bpDiastolic: 80 }, before)).toBe(true);
  });

  it('clearing a value is a change', () => {
    const before = vitalsKey({ pulse: 82, temperature: 37 });
    expect(shouldSaveVitals({ pulse: 82 }, before)).toBe(true);
  });

  it('the key ignores fields the strip does not own', () => {
    // Otherwise recording a glucose in the full panel would make the strip
    // believe its own values had changed and re-save them.
    expect(vitalsKey({ pulse: 82, glucose: 5.4 })).toBe(vitalsKey({ pulse: 82 }));
  });
});

describe('what gets sent', () => {
  it('only the fields that have values', () => {
    expect(inlineVitalsPayload({ pulse: 82, temperature: undefined })).toEqual({ pulse: 82 });
  });

  it('fields the strip does not own are OMITTED, never nulled', () => {
    // Sending null would blank a respiratory rate somebody recorded in the
    // full panel.
    const payload = inlineVitalsPayload({ pulse: 82, respRate: 18 } as never);
    expect(payload).toEqual({ pulse: 82 });
    expect('respRate' in payload).toBe(false);
  });

  it('strings from the inputs become numbers', () => {
    expect(inlineVitalsPayload({ temperature: '37.4' })).toEqual({ temperature: 37.4 });
  });
});

describe('seeding from what was already recorded', () => {
  it('carries the inline fields across', () => {
    expect(seedFromObservation({ bpSystolic: 120, bpDiastolic: 80, pulse: 82 })).toEqual({
      bpSystolic: 120,
      bpDiastolic: 80,
      pulse: 82,
    });
  });

  it('ignores the fields the strip does not own', () => {
    expect(seedFromObservation({ pulse: 82, glucose: 5.4 } as never)).toEqual({ pulse: 82 });
  });

  it('a visit with no observation seeds nothing', () => {
    expect(seedFromObservation(null)).toEqual({});
    expect(seedFromObservation(undefined)).toEqual({});
  });
});
