// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { accountLabel, annualLeaveLabel, filingNumbersCheck, taxCategoryLabel } from './recordLabels';

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

  it('warns before Approve from the run’s own warnings, naming each person (items 77, 82)', () => {
    expect(filingNumbersCheck([])).toEqual({ ok: true, detail: 'Everyone’s numbers are on file.' });
    expect(filingNumbersCheck([{ name: 'Demo Nurse', what: 'No EPF number or income tax number is on file for this employee.' }])).toEqual({
      ok: false,
      detail: 'Demo Nurse: No EPF number or income tax number is on file for this employee. The EPF and PCB filings will be missing their number.',
    });
  });

  it('says annual leave the way the Leave page works it out (item 78)', () => {
    expect(annualLeaveLabel({ fullYear: 8, thisYear: 1.5, policyName: 'Standard leave' }, 'Standard leave')).toBe('8 days a year · 1.5 this year · Standard leave');
    expect(annualLeaveLabel({ fullYear: 8, thisYear: 8, policyName: 'Standard leave' }, null)).toBe('8 days a year · Standard leave');
    expect(annualLeaveLabel(null, null)).toBeNull();
  });
});
