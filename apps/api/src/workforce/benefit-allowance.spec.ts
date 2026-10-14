import { benefitAlert, proratedAllowanceCents } from './benefit-allowance';

// RM1,200 a year: easy to read in months. Demo figures.
const LIMIT = 120_000;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('proratedAllowanceCents', () => {
  it('gives the full limit to somebody employed before the year', () => {
    expect(proratedAllowanceCents(LIMIT, 2026, day('2024-03-01'), 15)).toBe(LIMIT);
  });

  it('counts the joining month when they joined on or before the cut-off day', () => {
    // Joined 10 April: April to December, 9 months.
    expect(proratedAllowanceCents(LIMIT, 2026, day('2026-04-10'), 15)).toBe(90_000);
    // Joined 20 April: May to December, 8 months.
    expect(proratedAllowanceCents(LIMIT, 2026, day('2026-04-20'), 15)).toBe(80_000);
    // No cut-off set: the joining month never counts.
    expect(proratedAllowanceCents(LIMIT, 2026, day('2026-04-01'), null)).toBe(80_000);
  });

  it('rounds to the sen', () => {
    expect(proratedAllowanceCents(100_000, 2026, day('2026-02-20'), 15)).toBe(83_333);
  });
});

describe('benefitAlert', () => {
  it('warns at the clinic level, and when overdrawn', () => {
    expect(benefitAlert(LIMIT, 90_000, 20)).toBeNull();
    expect(benefitAlert(LIMIT, 96_000, 20)).toBe('LOW');
    expect(benefitAlert(LIMIT, 130_000, 20)).toBe('OVERDRAWN');
  });
});
