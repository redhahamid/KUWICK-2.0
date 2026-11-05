// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { accountLabel, annualLeaveLabel, filingNumbersCheck, monthNotEndedCheck, taxCategoryLabel } from './recordLabels';

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

  it('says "acknowledged", never "on file", when a missing number was acknowledged (Payroll A–Z guide, issue 5)', () => {
    const missing = { name: 'Demo Nurse', what: 'No income tax number is on file for this employee.' };
    const check = filingNumbersCheck([], [missing]);
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/^Missing, acknowledged: Demo Nurse/);
    expect(check.detail).not.toMatch(/Everyone/);
  });

  it('warns, never blocks, when the month has not ended (Payroll A–Z guide, issue 8)', () => {
    expect(monthNotEndedCheck('2026-11', '2026-11-03')).toMatchObject({ ok: false });
    expect(monthNotEndedCheck('2026-11', '2026-11-03').detail).toMatch(/^28 days of this month are still to come/);
    expect(monthNotEndedCheck('2026-11', '2026-11-30').detail).toMatch(/^1 day of this month is still to come/);
    expect(monthNotEndedCheck('2026-11', '2026-12-01')).toEqual({ ok: true, detail: 'The month is over.' });
    expect(monthNotEndedCheck('2026-02', '2026-03-01').ok).toBe(true);
  });
});

