// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PayrollJourney } from '../types';

vi.mock('../hooks/useAdmin', () => ({
  usePayrollInputs: () => ({ data: [], isLoading: false }),
  usePayComponents: () => ({ data: { components: [] }, isLoading: false }),
  useUpsertPayrollInput: () => ({ mutate: () => {}, isPending: false }),
}));

const { PayrollGrid } = await import('./PayrollGrid');

type PayRow = PayrollJourney['pay']['rows'][number];
type Totals = PayrollJourney['pay']['totals'];

/**
 * THE VIEWPORT, UNDER TEST'S CONTROL.
 *
 * The shared setup's `matchMedia` answers `false` to everything, which makes
 * antd's breakpoint hook report a phone — so without this every case below
 * would silently assert against the CARD layout while claiming to test the
 * register. Explicit width, explicit layout.
 */
function viewport(width: number) {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches =
      (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

afterEach(() => {
  // Leave the shared all-false stub in place for whatever runs next.
  // @ts-expect-error — deliberately clearing the per-test override.
  delete window.matchMedia;
});

function row(over: Partial<PayRow> = {}): PayRow {
  return {
    staffId: 'staff-1',
    name: 'Nurul Hidayah',
    position: 'Clinic assistant',
    state: 'READY',
    reason: null,
    blockers: 0,
    warnings: 0,
    fixLink: null,
    basicSalary: '3200.00',
    allowances: '250.00',
    overtimePay: '98.48',
    incentives: '0.00',
    bonus: '0.00',
    grossPay: '3548.48',
    unpaidLeaveDeduction: '0.00',
    otherDeductions: '0.00',
    netPay: '3108.98',
    employerCost: '4078.73',
    statutoryEmployee: '414.85',
    pcb: '24.65',
    lindungEmployee: null,
    epfEmployee: '390.00',
    epfEmployer: '461.00',
    socsoEmployee: '17.75',
    socsoEmployer: '62.15',
    eisEmployee: '7.10',
    eisEmployer: '7.10',
    hrdLevy: null,
    employerContributions: '530.25',
    additionalEarnings: '250.00',
    socsoEis: '24.85',
    epfBasis: null,
    salaryEarned: '3200.00',
    incentive: '0.00',
    otherEarnings: '0.00',
    deductionTotal: '439.50',
    items: [],
    ...over,
  } as PayRow;
}

function totals(over: Partial<Totals> = {}): Totals {
  return {
    basic: '3200.00',
    unpaidLeave: '0.00',
    salaryEarned: '3200.00',
    allowances: '250.00',
    overtime: '98.48',
    incentive: '0.00',
    otherEarnings: '0.00',
    additions: '348.48',
    gross: '3548.48',
    statutoryEmployee: '414.85',
    statutoryNotCalculated: 0,
    pcb: '24.65',
    pcbMissing: 0,
    lindung: '0.00',
    lindungNotDetermined: 0,
    otherDeductions: '0.00',
    deductions: '439.50',
    net: '3108.98',
    employerContributions: '530.25',
    employerCost: '4078.73',
    additionalEarnings: '250.00',
    socsoEis: '24.85',
    socsoEisNotCalculated: 0,
    epfEmployee: '390.00',
    socsoEmployee: '17.75',
    eisEmployee: '7.10',
    addsUp: true,
    discrepancy: null,
    ...over,
  } as Totals;
}

function grid(props: Partial<Parameters<typeof PayrollGrid>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PayrollGrid rows={[row()]} totals={totals()} onOpenEmployee={() => {}} {...props} />
    </MemoryRouter>,
  );
}

/**
 * THE COLUMNS AS THE SUMMARY ROW SEES THEM.
 *
 * The header is two rows: the band (Earnings / Deductions / Result) over its
 * leaves, plus Employee spanning both. The summary emits one cell per LEAF
 * plus one for Employee, so the comparison list has to be assembled the same
 * way — reading only the second row drops Employee and every index is out by
 * one, which is the exact failure mode this file exists to catch.
 */
function leafHeaders() {
  const rows = [...document.querySelectorAll('thead tr')];
  if (rows.length < 2) {
    return [...rows[0].querySelectorAll('th')].map((cell) => cell.textContent?.trim() ?? '');
  }
  const spanning = [...rows[0].querySelectorAll('th')].filter((cell) => cell.getAttribute('rowspan'));
  const leaves = [...rows[1].querySelectorAll('th')];
  return [...spanning, ...leaves].map((cell) => cell.textContent?.trim() ?? '');
}

function totalCells() {
  const totalsRow = document.querySelector('.kw-payrollGrid__totals');
  return [...(totalsRow?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent?.trim() ?? '');
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
   */
  it('puts each total under its own column, net pay included', () => {
    viewport(1440);
    grid({
      rows: [row(), row({ staffId: 'staff-2', name: 'Siti Zaleha' })],
      totals: totals({ net: '5491.53' }),
    });

    const header = leafHeaders();
    const cells = totalCells();
    expect(cells).toHaveLength(header.length);

    const netColumn = header.indexOf('Net pay');
    expect(netColumn).toBeGreaterThan(-1);
    expect(cells[netColumn]).toBe('5491.53');
  });

  /*
   * AND IT STILL LINES UP WHEN THE OPTIONAL COLUMNS ARE ON.
   *
   * This is the case that used to be impossible to keep right: the columns
   * were built from one list and the totals from a second, hand-kept one, so
   * the first optional column to appear slid every total after it. The two are
   * now derived from ONE definition — a column names the total it foots on —
   * which is what this asserts, at every combination of the switches.
   */
  it('keeps every total under its column when columns are split apart', () => {
    viewport(1440);
    grid();

    for (const label of ['Allowances and claims separately', 'SOCSO and EIS separately', 'Cost to clinic']) {
      fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
      fireEvent.click(screen.getByText(label));

      const header = leafHeaders();
      const cells = totalCells();
      expect(cells, `after "${label}"`).toHaveLength(header.length);
      expect(cells[header.indexOf('Net pay')], `after "${label}"`).toBe('3108.98');
    }

    // And the split columns really did replace the grouped one rather than
    // appearing beside it, which would double-count the row.
    const header = leafHeaders();
    expect(header).toContain('Allowances');
    expect(header).toContain('Claims & other');
    expect(header).not.toContain('Additional');
    expect(header).toContain('SOCSO');
    expect(header).toContain('EIS');
    expect(header).not.toContain('SOCSO/EIS');
  });

  /*
   * THE TOTALS ARE THE SERVER'S, NOT A SUM OF WHAT IS ON SCREEN.
   *
   * The register this replaced summed its own columns in a `useMemo`, which is
   * a second payroll implementation — and one that silently disagrees with the
   * payslip the moment a row is filtered, paginated or rounded differently.
   * The footer must print what the API said, even when that is not what the
   * visible rows add to.
   */
  it('prints the server total rather than adding the rows up itself', () => {
    viewport(1440);
    grid({
      rows: [row({ netPay: '1.00' }), row({ staffId: 'staff-2', name: 'Siti Zaleha', netPay: '2.00' })],
      totals: totals({ net: '9999.99' }),
    });
    const header = leafHeaders();
    expect(totalCells()[header.indexOf('Net pay')]).toBe('9999.99');
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
    viewport(1440);
    grid({
      rows: [
        row({
          basicSalary: '4200.00',
          unpaidLeaveDeduction: '135.48',
          allowances: '0.00',
          overtimePay: '0.00',
          incentive: '0.00',
          additionalEarnings: '0.00',
          grossPay: '4064.52',
        }),
      ],
      totals: totals({
        basic: '4200.00',
        unpaidLeave: '135.48',
        additionalEarnings: '0.00',
        overtime: '0.00',
        incentive: '0.00',
        gross: '4064.52',
      }),
    });

    const header = leafHeaders();
    const at = (label: string) => header.indexOf(label);
    for (const label of ['Basic', 'Unpaid leave', 'Additional', 'Overtime', 'Incentive']) {
      expect(at(label), `${label} must exist`).toBeGreaterThan(-1);
      expect(at(label), `${label} must come before Gross`).toBeLessThan(at('Gross'));
    }
    // And what genuinely does come off AFTER gross stays after it.
    expect(at('EPF')).toBeGreaterThan(at('Gross'));
    expect(at('PCB')).toBeGreaterThan(at('Gross'));

    // The arithmetic the order promises: 4200 − 135.48 = 4064.52.
    const cells = totalCells();
    const money = (label: string) => Number(cells[at(label)]?.replace('−', '').replace('-', '') || '0');
    expect(
      money('Basic') - money('Unpaid leave') + money('Additional') + money('Overtime') + money('Incentive'),
    ).toBeCloseTo(money('Gross'), 2);
  });

  /*
   * A ROW OPENS A DRAWER, NOT AN EXPANSION.
   *
   * The detail used to open UNDER the row, which pushed every other row down
   * the screen — so the moment you opened one person you lost the register you
   * were reading them against.
   */
  it('opens the chosen employee instead of expanding the table', () => {
    viewport(1440);
    const opened: string[] = [];
    grid({
      rows: [row(), row({ staffId: 'staff-2', name: 'Siti Zaleha' })],
      onOpenEmployee: (chosen) => opened.push(chosen.name),
    });

    const before = document.querySelectorAll('tbody .ant-table-row').length;
    fireEvent.click(screen.getByText('Siti Zaleha'));

    expect(opened).toEqual(['Siti Zaleha']);
    expect(document.querySelectorAll('tbody .ant-table-row')).toHaveLength(before);
    expect(document.querySelectorAll('.ant-table-row-expand-icon')).toHaveLength(0);
  });

  it('renders a statutory figure that was never worked out as a dash, never as 0.00', () => {
    // NULL means "not worked out" — no rates configured, or a fact missing.
    // Rendering it as 0.00 tells a clinic it owes nothing, which is the one
    // wrong answer that gets acted on.
    viewport(1440);
    grid({ rows: [row({ epfEmployee: null, pcb: null, socsoEis: null })] });
    const tableRow = document.querySelector('tbody .ant-table-row');
    expect(within(tableRow as HTMLElement).getAllByText('—').length).toBeGreaterThan(0);
  });

  /*
   * A PROBLEM BELONGS BESIDE THE PERSON IT IS A PROBLEM WITH.
   *
   * Readiness used to be a separate PAGE: leave the register, read a list of
   * names, come back, find the row again. The status and its remedy are now on
   * the row, and the remedy goes to where the fix is made — never to Settings
   * for somebody to hunt through.
   */
  it('shows a blocker on the row it blocks, with a fix that goes to the remedy', () => {
    viewport(1440);
    grid({
      rows: [
        row({
          staffId: 'staff-9',
          name: 'Wan Azman',
          state: 'NEEDS_ATTENTION',
          blockers: 1,
          reason: 'Bank account missing',
          fixLink: '/admin/hr/employees/staff-9',
        }),
      ],
    });
    expect(screen.getByText('Blocked')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Fix' })).toHaveAttribute('href', '/admin/hr/employees/staff-9');
  });

  it('separates a warning from a blocker, because they are different decisions', () => {
    viewport(1440);
    grid({ rows: [row({ warnings: 1, reason: 'EPF basis differs from Kuwick assessment' })] });
    expect(screen.getByText('Check')).toBeVisible();
    expect(screen.queryByText('Blocked')).toBeNull();
  });

  /*
   * A PHONE GETS CARDS, NOT A SQUEEZED SPREADSHEET.
   *
   * Sixteen columns inside 390px can only be done by shrinking the type until
   * nobody can read it, which is not a responsive design — it is a smaller
   * unreadable one.
   */
  it('becomes one card per person on a phone, and still shows the month total', () => {
    viewport(390);
    grid({ rows: [row(), row({ staffId: 'staff-2', name: 'Siti Zaleha' })] });

    expect(document.querySelector('table')).toBeNull();
    expect(document.querySelectorAll('.kw-payCard:not(.kw-payCard--total)')).toHaveLength(2);
    expect(screen.getByText('Nurul Hidayah')).toBeVisible();
    expect(screen.getByText('2 employees')).toBeVisible();
    expect(within(document.querySelector('.kw-payCard--total') as HTMLElement).getByText('3108.98')).toBeVisible();
  });
});
