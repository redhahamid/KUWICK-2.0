// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { accountLabel, filingNumbersCheck, taxCategoryLabel } from './recordLabels';

/* New-clinic UAT #2, 1 November 2026. Demo names only. */
describe('the employee record and Approve wordings', () => {
  it('says "No login" when the person was added without one (item 71)', () => {
    expect(accountLabel({ hasLogin: false, accountActive: true })).toBe('No login');
    expect(accountLabel({ hasLogin: true, accountActive: true })).toBe('Active');
    expect(accountLabel({ accountActive: false })).toBe('Inactive');
  });

  it('shows the MTD category in force, as the form below does (item 72)', () => {
    expect(taxCategoryLabel({ pcbCategory: 'CATEGORY_1', taxCategory: null })).toBe('Category 1 — single');
    expect(taxCategoryLabel({ pcbCategory: null, taxCategory: 'K' })).toBe('K');
    expect(taxCategoryLabel({ pcbCategory: null, taxCategory: null })).toBeNull();
  });

  it('warns before Approve, naming who is missing which number (item 77)', () => {
    expect(filingNumbersCheck([])).toEqual({ ok: true, detail: 'Everyone’s numbers are on file.' });
    expect(filingNumbersCheck([{ name: 'Demo Nurse', missing: ['EPF number', 'income tax number'] }])).toEqual({
      ok: false,
      detail: 'Demo Nurse: no EPF number or income tax number. The EPF and PCB filings will be missing their number.',
    });
  });
});
