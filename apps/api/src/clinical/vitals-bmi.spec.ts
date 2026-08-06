import { computeBmi } from './vitals-bmi';

// ===========================================================================
// G4.5d3c-3c — the SERVER's BMI, and its parity with the browser's.
//
// The fixture table below is character-for-character the one asserted in the
// web app's `vitalsBmi.test.ts`. It is duplicated rather than imported
// because apps/api does not depend on @kuwick/shared — there is no
// dependency, no tsconfig path and no jest module mapper — and wiring that
// package into the Nest build for one formula would be a build-system change
// out of proportion to the problem.
//
// Duplication is therefore deliberate and load-bearing: if either side's
// formula or rounding changes, the other side's copy of this table fails.
// That is the property that matters. A number a clinician acts on must not be
// able to differ between the screen it was typed on and the record it was
// saved to.
// ===========================================================================
const BMI_FIXTURES: Array<[weightKg: number, heightCm: number, expected: number]> = [
  [70, 170, 24.2],
  [50, 160, 19.5],
  [95, 180, 29.3],
  [12.5, 92, 14.8],
  [100, 200, 25],
  [45.5, 155.5, 18.8],
  [3.2, 50, 12.8],
];

describe('server BMI', () => {
  it.each(BMI_FIXTURES)(
    '1. %skg at %scm is BMI %s — identical to the browser calculator',
    (kg, cm, expected) => {
      expect(computeBmi(kg, cm)).toBe(expected);
    },
  );

  it('2. height is centimetres, converted to metres here so no caller can forget', () => {
    expect(computeBmi(70, 170)).toBe(24.2);
    expect(computeBmi(70, 1.7)).not.toBe(24.2);
  });

  it.each([
    ['3. zero height', 70, 0],
    ['4. zero weight', 0, 170],
    ['5. negative height', 70, -170],
    ['6. null height', 70, null],
    ['7. undefined weight', undefined, 170],
    ['8. non-numeric', 'abc', 'def'],
    ['9. empty strings', '', ''],
    ['10. both absent', null, null],
  ])('%s stores null rather than a number nobody should read', (_name, kg, cm) => {
    expect(computeBmi(kg, cm)).toBeNull();
  });

  it('11. a stored Infinity can never escape to a screen, export or merge field', () => {
    // The previous implementation divided by (height/100) with only a
    // falsy check, so a height of 0 returned null but a height that parsed to
    // NaN produced NaN — which would have been written to the row.
    for (const cm of [0, -0, Number.NaN, Number.POSITIVE_INFINITY, '', ' ', 'x']) {
      const value = computeBmi(70, cm);
      expect(value === null || Number.isFinite(value)).toBe(true);
    }
  });

  it('12. Prisma Decimal-shaped input is handled', () => {
    // Decimal columns arrive as objects with toString on some code paths.
    const decimalLike = { toString: () => '170.00' };
    expect(computeBmi({ toString: () => '70.00' }, decimalLike)).toBe(24.2);
  });

  it('13. string input from a DTO is handled', () => {
    expect(computeBmi('70', '170')).toBe(24.2);
  });

  it('14. one decimal place, always', () => {
    expect(computeBmi(100, 200)).toBe(25);
    expect(computeBmi(70.456, 170.123)).toBe(24.3);
  });
});
