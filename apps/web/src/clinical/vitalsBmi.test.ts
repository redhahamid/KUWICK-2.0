import { describe, expect, it } from 'vitest';
import { BMI_BAND_LABEL, bmiBand, calculateBmi, displayBmi, formatBmi, parseVital } from './vitalsBmi';

// ===========================================================================
// G4.5d3c-3c — BMI
//
// The owner's requirement was specific: the number appears WHILE height and
// weight are being typed, with no Save, no Calculate button and no request,
// and it must never render NaN or Infinity. The tests below are mostly about
// that second half — the formula is one line, the safety around it is not.
// ===========================================================================

/**
 * The parity fixtures.
 *
 * This exact table is asserted, value for value, by the API's
 * `vitals-bmi.spec.ts`. The API does not depend on `@kuwick/shared` (no
 * dependency, no path mapping, no jest module mapper), so wiring a genuinely
 * shared module across both processes would be a build-system change out of
 * proportion to one formula. Instead each process has exactly ONE
 * implementation, and this shared table is what stops them drifting: a change
 * to either rounding rule fails on the other side.
 */
export const BMI_FIXTURES: Array<[weightKg: number, heightCm: number, expected: number]> = [
  [70, 170, 24.2],
  [50, 160, 19.5],
  [95, 180, 29.3],
  [12.5, 92, 14.8],
  [100, 200, 25],
  [45.5, 155.5, 18.8],
  [3.2, 50, 12.8],
];

describe('the formula', () => {
  it.each(BMI_FIXTURES)('1. %skg at %scm is BMI %s', (kg, cm, expected) => {
    expect(calculateBmi(kg, cm)).toBe(expected);
  });

  it('2. height is treated as centimetres and converted to metres', () => {
    // 70 / 1.70^2 = 24.22. If cm were used directly the answer would be
    // 0.0024, which is the failure this test exists to catch.
    expect(calculateBmi(70, 170)).toBeCloseTo(24.2, 1);
    expect(calculateBmi(70, 1.7)).not.toBe(24.2);
  });

  it('3. the result carries one decimal place', () => {
    expect(formatBmi(70, 170)).toBe('24.2');
    expect(formatBmi(100, 200)).toBe('25.0');
  });
});

describe('never NaN, never Infinity', () => {
  it.each([
    ['4. zero height', 70, 0],
    ['5. zero weight', 0, 170],
    ['6. negative height', 70, -170],
    ['7. negative weight', -70, 170],
    ['8. non-numeric height', 70, 'abc'],
    ['9. non-numeric weight', 'abc', 170],
    ['10. empty height', 70, ''],
    ['11. empty weight', '', 170],
    ['12. whitespace only', 70, '   '],
    ['13. null height', 70, null],
    ['14. undefined weight', undefined, 170],
    ['15. both missing', null, null],
  ])('%s returns null rather than a number nobody should read', (_name, kg, cm) => {
    const result = calculateBmi(kg as never, cm as never);
    expect(result).toBeNull();
    expect(formatBmi(kg as never, cm as never)).toBeNull();
  });

  it('16. no input produces NaN or Infinity anywhere in the range', () => {
    const inputs = [0, -1, 1, 0.0001, 1e12, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const kg of inputs) {
      for (const cm of inputs) {
        const value = calculateBmi(kg, cm);
        if (value !== null) {
          expect(Number.isFinite(value)).toBe(true);
          expect(Number.isNaN(value)).toBe(false);
        }
      }
    }
  });

  it('17. a partially typed pair is null, not zero', () => {
    // "the patient has a BMI of 0" is a clinical statement, and a false one.
    expect(calculateBmi(70, undefined)).toBeNull();
    expect(calculateBmi(70, undefined)).not.toBe(0);
  });
});

describe('typing behaviour', () => {
  it('18. strings from a form field are accepted', () => {
    expect(calculateBmi('70', '170')).toBe(24.2);
    expect(calculateBmi('70.0', '170.00')).toBe(24.2);
  });

  it('19. the number appears as soon as BOTH fields are usable', () => {
    // Simulating the keystrokes of "170" in the height field.
    expect(calculateBmi(70, '')).toBeNull();
    expect(calculateBmi(70, '1')).not.toBeNull();
    expect(calculateBmi(70, '17')).not.toBeNull();
    expect(calculateBmi(70, '170')).toBe(24.2);
  });

  it('20. the calculation is pure — same inputs, same answer, no side effect', () => {
    const first = calculateBmi(70, 170);
    const second = calculateBmi(70, 170);
    expect(first).toBe(second);
  });
});

describe('parseVital', () => {
  it('21. rejects zero as a measurement', () => {
    expect(parseVital(0)).toBeNull();
    expect(parseVital('0')).toBeNull();
  });

  it('22. accepts small positive measurements', () => {
    expect(parseVital(0.5)).toBe(0.5);
    expect(parseVital('0.5')).toBe(0.5);
  });
});

describe('displaying a saved reading', () => {
  it('23. prefers the server value so a saved row never disagrees with the record', () => {
    expect(displayBmi({ serverBmi: 24.2, weight: '999', height: '100' })).toBe('24.2');
  });

  it('24. falls back to the calculation when the server has none', () => {
    expect(displayBmi({ serverBmi: null, weight: '70', height: '170' })).toBe('24.2');
  });

  it('25. returns null when neither source can answer', () => {
    expect(displayBmi({ serverBmi: null, weight: '70', height: null })).toBeNull();
    expect(displayBmi({ serverBmi: null, weight: null, height: null })).toBeNull();
  });

  it('26. a server value arriving as a string is still rendered to one decimal', () => {
    expect(displayBmi({ serverBmi: '24.24', weight: null, height: null })).toBe('24.2');
  });
});

describe('the advisory band', () => {
  it.each([
    [17, 'UNDERWEIGHT'],
    [18.5, 'NORMAL'],
    [24.9, 'NORMAL'],
    [25, 'OVERWEIGHT'],
    [29.9, 'OVERWEIGHT'],
    [30, 'OBESE'],
  ])('27. BMI %s is %s', (bmi, band) => {
    expect(bmiBand(bmi)).toBe(band);
  });

  it('28. no band without a number', () => {
    expect(bmiBand(null)).toBeNull();
    expect(bmiBand(0)).toBeNull();
  });

  it('29. every band has readable words, with no enum leaking', () => {
    for (const label of Object.values(BMI_BAND_LABEL)) {
      expect(label).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
    }
  });
});
