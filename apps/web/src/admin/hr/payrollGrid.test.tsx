// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PayrollJourney } from '../types';

vi.mock('../hooks/useAdmin', () => ({}));

const { GRID_COLUMNS, PayrollGrid, planGridEdit } = await import('./PayrollGrid');

type PayRow = PayrollJourney['pay']['rows'][number];

/**
 * THE VIEWPORT, UNDER TEST'S CONTROL.
 *
 * The shared setup's `matchMedia` answers `false` to everything, which makes
 * antd's breakpoint hook report a phone — so without this every case below
 * would silently assert against the CARD layout while claiming to test the
 * grid. Explicit width, explicit layout.
 */
function viewport(width: number) {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
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
    claims: '0.00',
    otherIncome: '250.00',
    overtimeHours: 4,
    unpaidDays: 0,
    items: [
      {
        id: 'in-1',
        componentCode: 'ALLOWANCE',
        label: 'Fixed monthly allowance',
        amount: '250.00',
        source: 'MANUAL',
        sourceRecordId: null,
        provenance: null,
        earnedPeriod: null,
        editable: true,
      },
    ],
    ...over,
  } as PayRow;
}

const noop = () => {};

function grid(props: Partial<Parameters<typeof PayrollGrid>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PayrollGrid
        rows={[row()]}
        runId="run-1"
        canEdit
        edit={null}
        onStartEdit={noop}
        onEditChange={noop}
        onSave={noop}
        onCancel={noop}
        saving={false}
        {...props}
      />
    </MemoryRouter>,
  );
}

/** The leaf headers, in order — Employee and Status first, then the money. */
function headers() {
  const rows = [...document.querySelectorAll('thead tr')];
  return [...rows[rows.length - 1].querySelectorAll('th')].map((cell) => cell.textContent?.trim() ?? '');
}

describe('the payroll grid', () => {
  /*
   * THE ROW ADDS UP LEFT TO RIGHT. Everything that makes up gross sits to the
   * left of it and everything that comes off sits to the right — the shape
   * payroll.html draws, and the property that lets a reader check a row.
   */
  it('lays the columns out as payroll.html does: earnings, gross, deductions, net', () => {
    viewport(1440);
    grid();
    expect(headers()).toEqual([
      'Employee',
      'Status',
      'Basic',
      'Other income',
      'OT h',
      'Unpaid d',
      'Claims',
      'Gross',
      'EPF',
      'SOCSO',
      'EIS',
      'PCB',
      'Other',
      'Net pay',
      '',
    ]);
    const at = (title: string) => GRID_COLUMNS.findIndex((column) => column.title === title);
    for (const title of ['Basic', 'Other income', 'OT h', 'Unpaid d', 'Claims']) {
      expect(at(title), `${title} must come before Gross`).toBeLessThan(at('Gross'));
    }
    expect(at('EPF')).toBeGreaterThan(at('Gross'));
    expect(at('Net pay')).toBe(GRID_COLUMNS.length - 1);
  });

  /*
   * THREE KINDS OF CELL, and the class says which. Grey comes from records or
   * is worked out; white can be edited. Overtime hours and unpaid days are
   * grey on purpose — §6: overtime reaches payroll only once approved in
   * Attendance, and nobody works it out by hand.
   */
  it('marks basic, hours and days as from-the-records and only the two "other" cells as editable', () => {
    viewport(1440);
    grid();
    const cells = [...document.querySelectorAll('tbody tr:first-child td')];
    const kind = (title: string) => {
      const index = 2 + GRID_COLUMNS.findIndex((column) => column.title === title);
      const cell = cells[index];
      return cell.classList.contains('is-editable') ? 'editable' : cell.classList.contains('is-record') ? 'record' : cell.classList.contains('is-auto') ? 'auto' : '?';
    };
    expect(kind('Basic')).toBe('record');
    expect(kind('OT h')).toBe('record');
    expect(kind('Unpaid d')).toBe('record');
    expect(kind('Other income')).toBe('editable');
    expect(kind('Other')).toBe('editable');
    expect(kind('Claims')).toBe('auto');
    expect(kind('Gross')).toBe('auto');
    expect(kind('EPF')).toBe('auto');
    expect(kind('Net pay')).toBe('auto');
  });

  it('prints the server’s figures grouped, and a dash for a statutory figure never worked out', () => {
    // NULL means "not worked out". Rendering it as 0.00 tells a clinic it
    // owes nothing, which is the one wrong answer that gets acted on.
    viewport(1440);
    grid({ rows: [row({ basicSalary: '4200.00', epfEmployee: null, pcb: null })] });
    const first = document.querySelector('tbody tr') as HTMLElement;
    expect(within(first).getByText('4,200.00')).toBeVisible();
    expect(within(first).getByText('3,548.48')).toBeVisible();
    expect(within(first).getAllByTitle('Not worked out')).toHaveLength(2);
    expect(within(first).getAllByText('0.00', { exact: true }).length).toBeGreaterThan(0); // claims really are nil
  });

  it('shows the person’s status beside the person, with Fix going to the remedy', () => {
    viewport(1440);
    grid({
      rows: [
        row({ staffId: 'staff-9', name: 'Wan Azman', blockers: 1, reason: 'Bank account missing', fixLink: '/admin/hr/employees/staff-9' }),
        row({ staffId: 'staff-2', name: 'Siti Zaleha', warnings: 1, reason: 'EPF basis differs' }),
        row(),
      ],
    });
    expect(screen.getByText('Blocked')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Fix' })).toHaveAttribute('href', '/admin/hr/employees/staff-9');
    expect(screen.getByText('Check')).toBeVisible();
    expect(screen.getByText('Ready')).toBeVisible();
  });

  it('still lists somebody the run left out — blocked, with dashes, and a Fix to their record', () => {
    // A person with no line is not a person with no problem; a grid that
    // omits them is a month that is quietly one person short.
    viewport(1440);
    grid({ leftOut: [{ staffId: 'staff-7', name: 'Wan Azman', position: 'Panel clerk', reason: 'No salary on record' }] });
    const rows = document.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    const last = rows[1] as HTMLElement;
    expect(within(last).getByText('Blocked')).toBeVisible();
    expect(within(last).getByRole('link', { name: 'Fix' })).toHaveAttribute('href', '/admin/hr/employees/staff-7');
    expect(within(last).getAllByText('—').length).toBe(GRID_COLUMNS.length);
  });

  it('links the name to the person’s own payroll page for the run', () => {
    viewport(1440);
    grid();
    expect(screen.getByRole('link', { name: /Nurul Hidayah/ })).toHaveAttribute('href', '/admin/hr/payroll/run-1/employees/staff-1');
  });

  it('turns the two white cells into inputs while a row is edited, and links the grey ones to where they are corrected', () => {
    viewport(1440);
    const started: string[] = [];
    const { rerender } = grid({ onStartEdit: (chosen) => started.push(chosen.name) });
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(started).toEqual(['Nurul Hidayah']);

    rerender(
      <MemoryRouter>
        <PayrollGrid
          rows={[row()]}
          runId="run-1"
          canEdit
          edit={{ staffId: 'staff-1', otherIncome: '250.00', otherDeduction: '0.00' }}
          onStartEdit={noop}
          onEditChange={noop}
          onSave={noop}
          onCancel={noop}
          saving={false}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('textbox', { name: 'Other income for Nurul Hidayah' })).toHaveValue('250.00');
    expect(screen.getByRole('textbox', { name: 'Other for Nurul Hidayah' })).toHaveValue('0.00');
    expect(screen.getByText('Editing')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
    // Statutory cells stay untouchable: no input for EPF, SOCSO, EIS or PCB.
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    const fixes = screen.getAllByRole('link', { name: 'Fix' }).map((link) => link.getAttribute('href'));
    expect(fixes).toEqual(['/admin/hr/attendance?staffId=staff-1', '/admin/hr/leave?staffId=staff-1']);
  });

  it('becomes one card per person on a phone', () => {
    viewport(390);
    grid({ rows: [row(), row({ staffId: 'staff-2', name: 'Siti Zaleha' })] });
    expect(document.querySelector('table')).toBeNull();
    expect(document.querySelectorAll('.kw-payCard')).toHaveLength(2);
    expect(screen.getByText('Siti Zaleha')).toBeVisible();
  });
});

/*
 * WHAT A TYPED FIGURE MEANS. "Other income" is a sum, and only the hand-keyed
 * part of it is the cell's to change. The plan is the one piece of arithmetic
 * the grid does, so it is pinned here to the sen.
 */
describe('planning a grid edit', () => {
  it('turns a higher figure into a larger hand-keyed allowance, keeping the recorded part', () => {
    // 250.00 shown = 250.00 typed by hand earlier; nothing recorded. 300 → 300.
    const plan = planGridEdit(row(), { staffId: 'staff-1', otherIncome: '300', otherDeduction: '0.00' });
    expect(plan.problem).toBeNull();
    expect(plan.changes).toEqual([{ componentCode: 'ALLOWANCE', amount: '300.00', existingId: 'in-1', label: 'Fixed monthly allowance' }]);
  });

  it('keeps the recorded part fixed: a recurring item is corrected on the record, not overwritten here', () => {
    // 1,050.00 shown = 800 recurring + 250 typed. Typing 900 leaves 100 by hand;
    // typing 700 would need a negative allowance, so it is refused with the floor named.
    const withRecurring = row({
      otherIncome: '1050.00',
      items: [
        ...row().items,
        { id: 'in-2', componentCode: 'ALLOWANCE', label: 'Housing', amount: '800.00', source: 'RECURRING', sourceRecordId: 'ri-1', provenance: 'Recurring allowance', earnedPeriod: null, editable: false },
      ],
    });
    const ok = planGridEdit(withRecurring, { staffId: 'staff-1', otherIncome: '900', otherDeduction: '0.00' });
    expect(ok.changes[0]).toMatchObject({ componentCode: 'ALLOWANCE', amount: '100.00' });
    const refused = planGridEdit(withRecurring, { staffId: 'staff-1', otherIncome: '700', otherDeduction: '0.00' });
    expect(refused.problem).toMatch(/cannot go below RM800\.00/);
    expect(refused.changes).toEqual([]);
  });

  it('removes the hand-keyed input when the cell is cleared to what the records give, and changes nothing when nothing moved', () => {
    const cleared = planGridEdit(row(), { staffId: 'staff-1', otherIncome: '0', otherDeduction: '0.00' });
    expect(cleared.changes).toEqual([{ componentCode: 'ALLOWANCE', amount: null, existingId: 'in-1', label: 'Fixed monthly allowance' }]);
    const same = planGridEdit(row(), { staffId: 'staff-1', otherIncome: 'RM 250.00', otherDeduction: '0.00' });
    expect(same.changes).toEqual([]);
    expect(same.problem).toBeNull();
  });

  it('writes a deduction typed into "Other" as a hand-keyed other deduction', () => {
    const plan = planGridEdit(row(), { staffId: 'staff-1', otherIncome: '250.00', otherDeduction: '120.50' });
    expect(plan.changes).toEqual([{ componentCode: 'OTHER_DEDUCTION', amount: '120.50', existingId: null, label: 'Other deduction (payroll grid)' }]);
  });

  it('refuses a figure that is not money', () => {
    expect(planGridEdit(row(), { staffId: 'staff-1', otherIncome: 'abc', otherDeduction: '0' }).problem).toMatch(/at most two decimal places/);
  });
});
