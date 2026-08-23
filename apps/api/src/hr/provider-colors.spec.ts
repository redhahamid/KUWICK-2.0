import {
  PROVIDER_COLORS,
  PROVIDER_COLOR_VALUES as SHARED_VALUES,
  nextProviderColor as sharedNextProviderColor,
} from '@kuwick/shared';
import { PROVIDER_COLOR_VALUES, nextProviderColor } from './provider-colors';

// ===========================================================================
// THE PIN ON A DELIBERATE DUPLICATION.
//
// apps/api cannot import @kuwick/shared at RUNTIME (see provider-colors.ts),
// so the curated palette exists twice. A spec can import it — ts-jest
// resolves the workspace package and nothing here reaches dist — so the two
// copies are compared here instead of being trusted to stay in step.
//
// If this fails, do not "fix" it by editing one side to match: decide which
// palette is correct, change BOTH, and remember the server copy is the one
// that decides what may be written to the database.
// ===========================================================================
describe('curated provider palette — API/shared parity', () => {
  it('holds exactly the shared palette, in the same order', () => {
    expect(PROVIDER_COLOR_VALUES).toEqual(SHARED_VALUES);
  });

  it('is the accent of every shared colour, and nothing else', () => {
    expect(PROVIDER_COLOR_VALUES).toEqual(PROVIDER_COLORS.map((color) => color.accent));
  });

  it('contains exactly one blue, so a single-doctor clinic cannot become a wall of blue', () => {
    // Sky is the only blue-family accent; Teal reads green-cyan and Indigo
    // reads violet at a 3px edge. This is the assertion that stops a future
    // "just add another blue" from quietly undoing the fix.
    expect(PROVIDER_COLOR_VALUES.filter((value) => value === '#2E7BC4')).toHaveLength(1);
    expect(PROVIDER_COLOR_VALUES).toHaveLength(8);
    expect(new Set(PROVIDER_COLOR_VALUES).size).toBe(8);
  });

  it('assigns the next unused colour the same way on both sides', () => {
    const cases: (string | null)[][] = [
      [],
      ['#0F6B78'],
      ['#0F6B78', '#2F8B57', '#2E7BC4'],
      ['#0f6b78', null, '#2F8B57'],
      PROVIDER_COLOR_VALUES.filter((value) => value !== '#55627A'),
      PROVIDER_COLOR_VALUES,
    ];
    for (const taken of cases) {
      expect(nextProviderColor(taken)).toBe(sharedNextProviderColor(taken));
    }
  });

  it('skips the neutral slot while any identity colour is free', () => {
    expect(nextProviderColor([])).toBe('#0F6B78');
    const allButNeutral = PROVIDER_COLOR_VALUES.filter((value) => value !== '#55627A');
    expect(nextProviderColor(allButNeutral)).toBe('#55627A');
  });

  it('is case-insensitive about what is already taken', () => {
    expect(nextProviderColor(['#0f6b78'])).toBe('#2F8B57');
  });
});
