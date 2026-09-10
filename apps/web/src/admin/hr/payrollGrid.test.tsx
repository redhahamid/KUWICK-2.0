// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
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
   * It did not. The summary's cells are POSITIONAL, and when the register
   * still had an expand control that control was a column: the summary emitted
   * one cell fewer than the table had and every total slid one place to the
   * left. The figure sitting under NET PAY was the PCB total, and the month's
   * net — the number the entire screen exists to show — was pushed off the end
   * of the row. Nothing looked broken. RM110.25 under "Net pay" for six people
   * is simply a number, and an owner reading it has no way to know it is the
   * wrong column's.
   *
   * The expander has since gone (a row opens a drawer now), which changes the
   * count by one and is exactly why this test asserts the count rather than a
   * remembered offset.
   */
  it('puts each total under its own column, net pay included', () => {
    render(<PayrollGrid run={run([line(), line({ id: 'l2', name: 'Siti Zaleha', netPay: 2382.55, basicSalary: 2600, grossPay: 2686.4 })])} onOpenEmployee={() => {}} />);

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

  /*
   * A ROW OPENS A DRAWER, NOT AN EXPANSION.
   *
   * The detail used to open UNDER the row, which pushed every other row down
   * the screen — so the moment you opened one person you lost the register you
   * were reading them against. This pins the register as the thing that stays
   * put: clicking a row reports which line was chosen and adds no row to the
   * table.
   */
  it('opens the chosen employee instead of expanding the table', () => {
    const opened: string[] = [];
    render(
      <PayrollGrid
        run={run([line(), line({ id: 'l2', staffId: 'staff-2', name: 'Siti Zaleha' })])}
        onOpenEmployee={(chosen) => opened.push(chosen.name)}
      />,
    );

    const before = document.querySelectorAll('tbody .ant-table-row').length;
    fireEvent.click(screen.getByText('Siti Zaleha'));

    expect(opened).toEqual(['Siti Zaleha']);
    expect(document.querySelectorAll('tbody .ant-table-row')).toHaveLength(before);
    // And no expand control survives to reintroduce the old behaviour.
    expect(document.querySelectorAll('.ant-table-row-expand-icon')).toHaveLength(0);
  });

  /*
   * THE ROW HAS TO ADD UP LEFT TO RIGHT.
   *
   * `grossPay` is basic LESS unpaid leave plus the additions — s.18A makes an
   * incomplete month's wages smaller, it does not take a deduction from them.
   * The Unpaid leave column sat AFTER Gross, between it and Other deductions,
   * which is where a deduction goes: basic plus the four additions came to
   * RM41,094.88 against a printed gross of RM40,959.40, and the RM135.48 that
   * explains the gap was on the wrong side of it. Nothing looked broken; a
   * register that does not add up is simply a register somebody stops trusting.
   */
  it('puts every column that makes up gross to the LEFT of it, so a row adds up', () => {
    render(
      <PayrollGrid
        run={run([line({ basicSalary: 4200, unpaidLeaveDeduction: 135.48, allowances: 0, overtimePay: 0, incentives: 0, bonus: 0, grossPay: 4064.52 })])}
        onOpenEmployee={() => {}}
        otherEarnings={new Map([['staff-1', '0.00']])}
      />,
    );

    const header = screen.getAllByRole('columnheader').map((cell) => cell.textContent?.trim());
    const at = (label: string) => header.indexOf(label);
    for (const label of ['Basic', 'Unpaid leave', 'Allowances', 'Overtime', 'Incentives', 'Bonus', 'Claims & other']) {
      expect(at(label), `${label} must come before Gross`).toBeGreaterThan(-1);
      expect(at(label)).toBeLessThan(at('Gross'));
    }
    // And what genuinely does come off AFTER gross stays after it.
    expect(at('Other deductions')).toBeGreaterThan(at('Gross'));

    // The arithmetic the order promises: 4200 − 135.48 = 4064.52.
    const cells = [...(document.querySelector('.kw-payrollGrid__totals')?.querySelectorAll('td') ?? [])]
      .map((cell) => cell.textContent?.trim());
    expect(cells).toHaveLength(header.length);
    const money = (label: string) => Number(cells[at(label)]?.replace('-', '') ?? '0');
    expect(
      money('Basic') - money('Unpaid leave') + money('Allowances') + money('Overtime') +
        money('Incentives') + money('Bonus') + money('Claims & other'),
    ).toBeCloseTo(money('Gross'), 2);
  });

  it('renders a statutory figure that was never worked out as a dash, never as 0.00', () => {
    // NULL means "not worked out" — no rates configured, or a fact missing.
    // Rendering it as 0.00 tells a clinic it owes nothing, which is the one
    // wrong answer that gets acted on.
    render(<PayrollGrid run={run([line({ epfEmployee: null, pcb: null })])} onOpenEmployee={() => {}} />);
    const row = document.querySelector('tbody .ant-table-row');
    expect(within(row as HTMLElement).getAllByTitle(/not worked out/i).length).toBeGreaterThan(0);
  });
});
