import { describe, expect, it } from 'vitest';
import { payrollExportTable } from './payrollExport';
import type { PayrollJourney } from '../types';

/*
 * THE PAYROLL EXPORT, ONE COLUMN PER ITEM (UAT, 10 October 2026): Employee
 * No. first, and each item with an amount in its own column where Other
 * income and Other deductions stood. Demo rows only.
 */
const row = (over: Record<string, unknown>) =>
  ({
    staffId: 's-1',
    name: 'Demo Nurse',
    position: 'Nurse',
    employeeNo: 'EM-001',
    blockers: 0,
    warnings: 0,
    basicSalary: '3000.00',
    otherIncome: '450.00',
    claims: '80.00',
    otherDeductions: '50.00',
    overtimePay: '120.00',
    overtimeHours: 6,
    unpaidDays: 0,
    unpaidLeaveDeduction: '0.00',
    grossPay: '3650.00',
    epfEmployee: '330.00',
    socsoEmployee: '14.75',
    eisEmployee: '5.90',
    lindungEmployee: null,
    pcb: '20.00',
    netPay: '3229.35',
    epfEmployer: '390.00',
    socsoEmployer: '51.65',
    eisEmployer: '5.90',
    hrdLevy: '30.00',
    columns: {},
    items: [
      { componentCode: 'NIGHT_INCENTIVE', label: 'Night incentive', amount: '300.00', direction: 'ADDS' },
      { componentCode: 'ALLOWANCE', label: 'Allowance', amount: '150.00', direction: 'ADDS' },
      { componentCode: 'CLAIM_REIMBURSEMENT', label: 'Claim reimbursement', amount: '80.00', direction: 'ADDS' },
      { componentCode: 'OVERTIME', label: 'Overtime', amount: '120.00', direction: 'ADDS' },
      { componentCode: 'UNIFORM', label: 'Uniform deduction', amount: '50.00', direction: 'DEDUCTS' },
    ],
    ...over,
  }) as unknown as PayrollJourney['pay']['rows'][number];

const pay = (rows: PayrollJourney['pay']['rows']) => ({ rows, columns: [] }) as unknown as PayrollJourney['pay'];

describe('the payroll export', () => {
  it('leads with Employee No. and gives each item with an amount its own column', () => {
    const table = payrollExportTable(pay([row({})]));
    expect(table.header.slice(0, 4)).toEqual(['Employee No.', 'Employee', 'Position', 'Status']);
    expect(table.header).not.toContain('Other income');
    expect(table.header).not.toContain('Claims');
    expect(table.header).not.toContain('Other deductions');
    for (const title of ['Night incentive', 'Allowance', 'Claim reimbursement', 'Uniform deduction']) expect(table.header).toContain(title);
    // Overtime keeps the column it already had.
    expect(table.header.filter((title) => title === 'Overtime')).toEqual([]);
    expect(table.header).toContain('Overtime pay');
    const cell = (title: string) => table.rows[0][table.header.indexOf(title)];
    expect(cell('Employee No.')).toBe('EM-001');
    expect(cell('Night incentive')).toBe('300.00');
    expect(cell('Uniform deduction')).toBe('50.00');
    // Earnings sit before Gross, deductions after it.
    expect(table.header.indexOf('Night incentive')).toBeLessThan(table.header.indexOf('Gross'));
    expect(table.header.indexOf('Uniform deduction')).toBeGreaterThan(table.header.indexOf('Gross'));
    expect(table.header).not.toContain('Other income (not itemised)');
  });

  it('shows whatever the items do not account for, rather than losing it', () => {
    const table = payrollExportTable(pay([row({ otherIncome: '500.00' })]));
    expect(table.rows[0][table.header.indexOf('Other income (not itemised)')]).toBe('50.00');
  });

  it('leaves an item nobody has an amount for out', () => {
    const table = payrollExportTable(pay([row({ items: [{ componentCode: 'BONUS', label: 'Bonus', amount: '0.00', direction: 'ADDS' }], otherIncome: '0.00', claims: '0.00', otherDeductions: '0.00' })]));
    expect(table.header).not.toContain('Bonus');
  });
});
