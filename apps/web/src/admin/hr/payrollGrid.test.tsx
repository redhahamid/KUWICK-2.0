// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PayrollRunDetail } from '../types';

vi.mock('../hooks/useAdmin', () => ({
  usePayrollInputs: () => ({ data: [], isLoading: false }),
}));

const { PayrollGrid } = await import('./PayrollGrid');

function line(over: Partial<PayrollRunDetail['lines'][number]> = {}): PayrollRunDetail['lines'][number] {
  return {
    id: `line-${Math.random()}`,
    staffId: 'staff-1',
    name: 'Nurul Hidayah',
    basicSalary: 3200,
    allowances: 250,
    overtimePay: 98.48,
    incentives: 0,
    bonus: 0,
    grossPay: 3548.48,
    unpaidLeaveDeduction: 0,
    otherDeductions: 0,
    snapshot: null,
    epfEmployee: 390,
    epfEmployer: 461,
    socsoEmployee: 17.75,
    socsoEmployer: 62.15,
    eisEmployee: 7.1,
    eisEmployer: 7.1,
    lindungEmployee: null,
    hrdLevy: null,
    pcb: 24.65,
    netPay: 3108.98,
    employerCost: 4078.73,
    workedDays: 21,
    unpaidDays: null,
    overtimeHours: 2,
    breakdown: null,
    ...over,
  };
}

function run(lines: PayrollRunDetail['lines']): PayrollRunDetail {
  return {
    id: 'run-1',
    period: '2026-08',
    clinicName: 'Contoh Central',
    status: 'CALCULATED',
    statutoryStatus: 'CONFIGURED',
    statutoryNotice: null,
    grossTotal: 0,
    deductionTotal: 0,
    netTotal: 0,
    employerCostTotal: 0,
    employeeCount: lines.length,
    calculatedAt: null,
    approvedAt: null,
    approvedBy: null,
    createdBy: 'Dr Aisyah Rahman',
    paidAt: null,
    lines,
    adjustments: [],
  };
}

describe('the payroll register', () => {
  /*
   * THE TOTALS ROW HAS TO LINE UP WITH ITS COLUMNS.
   *
   * It did not. The expand control is a COLUMN, and the summary emitted one
   * cell fewer than the table had, so every total slid one place to the left:
   * the figure sitting under NET PAY was the PCB total, and the month's net —
   * the number the entire screen exists to show — was pushed off the end of
   * the row. Nothing looked broken. RM110.25 under "Net pay" for six people is
   * simply a number, and an owner reading it has no way to know it is the
   * wrong column's.
   */
  it('puts each total under its own column, net pay included', () => {
    render(<PayrollGrid run={run([line(), line({ id: 'l2', name: 'Siti Zaleha', netPay: 2382.55, basicSalary: 2600, grossPay: 2686.4 })])} period="2026-08-01" />);

    const header = screen.getAllByRole('columnheader').map((cell) => cell.textContent?.trim());
    const totals = document.querySelector('.kw-payrollGrid__totals');
    expect(totals).toBeTruthy();
    const cells = [...(totals?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent?.trim());

    // One cell per column — the guard that was missing.
    expect(cells).toHaveLength(header.length);

    // And the net total lands under NET PAY, not one column to its left.
    const netColumn = header.findIndex((label) => label === 'Net pay');
    expect(netColumn).toBeGreaterThan(-1);
    expect(cells[netColumn]).toBe((3108.98 + 2382.55).toFixed(2));
  });

  it('renders a statutory figure that was never worked out as a dash, never as 0.00', () => {
    // NULL means "not worked out" — no rates configured, or a fact missing.
    // Rendering it as 0.00 tells a clinic it owes nothing, which is the one
    // wrong answer that gets acted on.
    render(<PayrollGrid run={run([line({ epfEmployee: null, pcb: null })])} period="2026-08-01" />);
    const row = document.querySelector('tbody .ant-table-row');
    expect(within(row as HTMLElement).getAllByTitle(/not worked out/i).length).toBeGreaterThan(0);
  });
});
