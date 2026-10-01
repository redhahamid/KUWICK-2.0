// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PayrollJourney } from '../types';

vi.mock('../hooks/useAdmin', () => ({}));

const { cellValue, covers, GRID_COLUMNS, gridColumnsFor, PayrollGrid } = await import('./PayrollGrid');

type PayRow = PayrollJourney['pay']['rows'][number];
type ColumnCell = PayRow['columns'][string];

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
    lindungEmployee: '0.00',
    epfEmployee: '390.00',
    epfEmployer: '461.00',
    socsoEmployee: '17.75',
    socsoEmployer: '62.15',
    eisEmployee: '7.10',
    eisEmployer: '7.10',
    hrdLevy: '32.00',
    hrdNote: null,
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
    columns: {},
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

type Totals = PayrollJourney['pay']['totals'];

/** The server's sums for the month, in the shape the foot reads them. */
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
    epfNotCalculated: 0,
    socsoNotCalculated: 0,
    eisNotCalculated: 0,
    epfEmployer: '461.00',
    socsoEmployer: '62.15',
    eisEmployer: '7.10',
    hrdLevy: '32.00',
    hrdLevyNotDetermined: 0,
    claims: '0.00',
    otherIncome: '250.00',
    overtimeHours: 4,
    unpaidDays: 0,
    addsUp: true,
    discrepancy: null,
    ...over,
  } as Totals;
}

const noop = () => {};

function grid(props: Partial<Parameters<typeof PayrollGrid>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PayrollGrid
        rows={[row()]}
        totals={totals()}
        counted={1}
        runId="run-1"
        onOpenItems={noop}
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

/** The group headers above them — which band each stretch of columns belongs to. */
function groups() {
  const cells = [...document.querySelectorAll('thead tr.hr-grid__grp th')];
  return cells.filter((cell) => cell.textContent?.trim()).map((cell) => [cell.textContent?.trim(), Number(cell.getAttribute('colspan') ?? 1)]);
}

/**
 * The foot, column by column, in GRID_COLUMNS order — the FIGURE only. The
 * count of people a column leaves out is its own element beside it, and has
 * its own case below.
 */
function foot() {
  const cells = [...document.querySelectorAll('tfoot td')];
  return GRID_COLUMNS.map((_column, index) => (cells[index + 1].firstChild?.textContent ?? '').trim());
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
      'OT RM',
      'Unpaid d',
      'Unpaid RM',
      'Claims',
      'Gross',
      'EPF',
      'SOCSO',
      'EIS',
      'SKBBK',
      'PCB',
      'Other',
      'Net pay',
      // Under EMPLOYER PAYS. Same scheme names, the other side of them — the
      // group header above says which, and the export carries both in full.
      'EPF',
      'SOCSO',
      'EIS',
      'HRD levy',
      '',
    ]);
    // Keyed, not titled: EPF, SOCSO and EIS each name two columns now.
    const at = (key: string) => GRID_COLUMNS.findIndex((column) => column.key === key);
    for (const key of ['basic', 'otherIncome', 'overtimeHours', 'overtimePay', 'unpaidDays', 'unpaidLeaveDeduction', 'claims']) {
      expect(at(key), `${key} must come before gross`).toBeLessThan(at('gross'));
    }
    expect(at('epf')).toBeGreaterThan(at('gross'));
    // Net pay is the last of the EMPLOYEE's money — what the clinic pays on
    // top comes after it, because it never comes off anybody's pay.
    const employee = GRID_COLUMNS.filter((column) => column.band !== 'employer');
    expect(at('net')).toBe(employee.length - 1);
    expect(GRID_COLUMNS[GRID_COLUMNS.length - 1].band).toBe('employer');
  });

  /*
   * WHOSE MONEY, WITHOUT DOUBLING THE COLUMNS. A column headed "EPF" beside a
   * column headed "EPF" is how a clinic remits the employee's share twice; a
   * group header over the deductions says whose they are, and what the clinic
   * pays on top gets its own group at the end — one column, not three.
   */
  /*
   * THE MONEY BESIDE THE HOURS AND THE DAYS. "OT h 4.0" told a reader how
   * long, not how much; the overtime pay and the unpaid-leave deduction were
   * on the payslip and nowhere on the register. Both come from the line
   * itself — never re-multiplied here — and foot on the server's own totals.
   */
  it('puts the overtime pay beside the hours and the unpaid-leave money beside the days, from the line itself', () => {
    viewport(1440);
    grid({ rows: [row({ overtimePay: '98.48', unpaidLeaveDeduction: '120.00' })] });
    expect(headers().slice(4, 8)).toEqual(['OT h', 'OT RM', 'Unpaid d', 'Unpaid RM']);
    const first = document.querySelector('tbody tr') as HTMLElement;
    expect(within(first).getByText('98.48')).toBeInTheDocument();
    expect(within(first).getByText('120.00')).toBeInTheDocument();
    // Read from the record like the hours: grey, not typed here.
    for (const key of ['overtimePay', 'unpaidLeaveDeduction']) expect(GRID_COLUMNS.find((column) => column.key === key)!.kind).toBe('record');
  });

  it('says why the HRD levy is a dash, from the line itself', () => {
    viewport(1440);
    const why = 'Whether this employer is registered with HRD Corp is not recorded, so the levy is not included in employer cost.';
    grid({ rows: [row({ hrdLevy: null, hrdNote: why })] });
    expect(screen.getByTitle(why)).toHaveTextContent('—');
  });

  it('says in the group headers whether a deduction is the employee’s or the employer’s', () => {
    viewport(1440);
    grid();
    expect(groups()).toEqual([
      ['Record', 1],
      ['Earnings', 7],
      ['Deductions — employee', 6],
      ['Employer pays', 4],
    ]);
    // Every column is spanned: the group row and the leaf row are the same width.
    const grp = [...document.querySelectorAll('thead tr.hr-grid__grp th')];
    const span = grp.reduce((total, cell) => total + Number(cell.getAttribute('colspan') ?? 1), 0);
    expect(span).toBe(headers().length);
    // The export has no group header row, so it carries the fuller name.
    const named = GRID_COLUMNS.filter((column) => column.band === 'deductions' || column.band === 'employer');
    expect(named.map((column) => column.exportTitle ?? column.title)).toEqual([
      'EPF (employee)',
      'SOCSO (employee)',
      'EIS (employee)',
      'SKBBK / Lindung 24 Jam (employee)',
      'PCB',
      'Other deductions',
      'EPF (employer)',
      'SOCSO (employer)',
      'EIS (employer)',
      'HRD levy (employer)',
    ]);
  });

  /*
   * WHAT THE CLINIC FILES WITH. KWSP's form asks for the EPF employer share
   * alone and PERKESO's asks for SOCSO and EIS apart, so a single column
   * holding their sum is a column nothing can be done with. The levy is the
   * fourth thing in that sum: without it the group would be headed "Employer
   * pays" over three figures that are not what the employer pays.
   */
  it('itemises what the employer pays, scheme by scheme, instead of one figure nothing can be filed with', () => {
    viewport(1440);
    grid();
    const employer = GRID_COLUMNS.filter((column) => column.band === 'employer');
    expect(employer.map((column) => [column.key, column.field, column.total])).toEqual([
      ['epfEmployer', 'epfEmployer', 'epfEmployer'],
      ['socsoEmployer', 'socsoEmployer', 'socsoEmployer'],
      ['eisEmployer', 'eisEmployer', 'eisEmployer'],
      ['hrdLevy', 'hrdLevy', 'hrdLevy'],
    ]);
    // Nothing is summed here: the four foot on four separate server totals.
    expect(new Set(employer.map((column) => column.total)).size).toBe(4);
    const first = document.querySelector('tbody tr') as HTMLElement;
    for (const amount of ['461.00', '62.15', '32.00']) {
      expect(within(first).getByText(amount)).toBeVisible();
    }
  });

  /*
   * SKBBK IS THE EMPLOYEE'S. Act 4's schedule prints Lindung 24 Jam as a
   * column beside SOCSO and EIS, the engine takes it off gross with them, and
   * the payslip gives it its own line — so the register carries it under
   * DEDUCTIONS — EMPLOYEE and not among what the employer pays.
   */
  it('carries SKBBK as an employee deduction, beside SOCSO and EIS', () => {
    viewport(1440);
    grid({ rows: [row({ lindungEmployee: '26.60' })], totals: totals({ lindung: '26.60' }) });
    const skbbk = GRID_COLUMNS.find((column) => column.key === 'lindung');
    expect({ band: skbbk?.band, field: skbbk?.field, total: skbbk?.total }).toEqual({
      band: 'deductions',
      field: 'lindungEmployee',
      total: 'lindung',
    });
    // Between EIS and PCB, which is where the schedule prints it.
    const keys = GRID_COLUMNS.map((column) => column.key);
    expect(keys.slice(keys.indexOf('eis'), keys.indexOf('pcb') + 1)).toEqual(['eis', 'lindung', 'pcb']);
    expect(screen.getAllByText('26.60')).toHaveLength(2); // the row and the foot
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
    const kind = (key: string) => {
      const index = 2 + GRID_COLUMNS.findIndex((column) => column.key === key);
      const cell = cells[index];
      return cell.classList.contains('is-editable') ? 'editable' : cell.classList.contains('is-record') ? 'record' : cell.classList.contains('is-auto') ? 'auto' : '?';
    };
    expect(kind('basic')).toBe('record');
    expect(kind('overtimeHours')).toBe('record');
    expect(kind('unpaidDays')).toBe('record');
    expect(kind('otherIncome')).toBe('editable');
    expect(kind('otherDeductions')).toBe('editable');
    expect(kind('claims')).toBe('auto');
    expect(kind('gross')).toBe('auto');
    expect(kind('epf')).toBe('auto');
    expect(kind('lindung')).toBe('auto');
    expect(kind('epfEmployer')).toBe('auto');
    expect(kind('net')).toBe('auto');
  });

  it('prints the server’s figures grouped, and a dash for a statutory figure never worked out', () => {
    // NULL means "not worked out". Rendering it as 0.00 tells a clinic it
    // owes nothing, which is the one wrong answer that gets acted on.
    viewport(1440);
    // A scheme's employee and employer shares are worked out together, so
    // they go unknown together — the fixture says so rather than inventing an
    // employer figure for an EPF that could not be worked out.
    grid({ rows: [row({ basicSalary: '4200.00', epfEmployee: null, epfEmployer: null, pcb: null })] });
    const first = document.querySelector('tbody tr') as HTMLElement;
    expect(within(first).getByText('4,200.00')).toBeVisible();
    expect(within(first).getByText('3,548.48')).toBeVisible();
    expect(within(first).getAllByTitle('Not worked out')).toHaveLength(3);
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
    expect(screen.getByText('Needs attention')).toBeVisible();
    expect(screen.getByText('Ready')).toBeVisible();
  });

  /*
   * A STATUS SAYS HOW SERIOUS, NEVER WHAT. "Check" told a reader nothing they
   * could act on, and the reason was reachable only by hovering — which a
   * phone cannot do. The server already sends the reason for the most serious
   * thing wrong, so the row prints it.
   */
  it('prints why a row is blocked or needs attention, on the row, not only in a hover', () => {
    viewport(1440);
    grid({
      rows: [
        row({ staffId: 'staff-9', name: 'Wan Azman', blockers: 1, reason: 'Bank account missing' }),
        row({ staffId: 'staff-2', name: 'Siti Zaleha', warnings: 1, reason: 'EPF basis differs from the assessment' }),
        row(),
      ],
      leftOut: [{ staffId: 'staff-7', name: 'Nur Aisyah', position: 'Panel clerk', reason: 'No salary on record' }],
    });
    expect(screen.getByText('Bank account missing')).toBeVisible();
    expect(screen.getByText('EPF basis differs from the assessment')).toBeVisible();
    expect(screen.getByText('No salary on record')).toBeVisible();
    // The full text stays on `title` for the reason too long for the column.
    expect(screen.getByTitle('Bank account missing')).toBeVisible();
    // A ready row has no reason and prints none.
    const ready = [...document.querySelectorAll('tbody tr')][2] as HTMLElement;
    expect(within(ready).getByText('Ready')).toBeVisible();
    expect(ready.querySelector('.hr-standing__why')).toBeNull();
  });

  /*
   * THE MONTH FOOTS, from the SERVER'S sums. Not one of these figures is
   * added up here: a column the browser totals is a column that can disagree
   * with the payslip by a sen.
   */
  it('foots every column on the server’s totals, and names what the foot covers', () => {
    viewport(1440);
    grid({ rows: [row(), row({ staffId: 'staff-2', name: 'Siti Zaleha' })], counted: 2 });
    expect(foot()).toEqual([
      '3,200.00',
      '250.00',
      '4.0',
      '98.48',
      '0',
      '0.00',
      '0.00',
      '3,548.48',
      '390.00',
      '17.75',
      '7.10',
      '0.00',
      '24.65',
      '0.00',
      '3,108.98',
      '461.00',
      '62.15',
      '7.10',
      '32.00',
    ]);
    expect(screen.getByText('Total')).toBeVisible();
    expect(screen.getByText('All 2 employees')).toBeVisible();
  });

  /*
   * A FILTERED VIEW AND THE MONTH ARE DIFFERENT NUMBERS, and somebody the run
   * left out has no line, so no figure of theirs is in the total either. The
   * foot says both rather than leaving them to be discovered.
   */
  it('says so when the foot is not the total of the rows above it', () => {
    expect(covers(1, 1, 0)).toBe('All 1 employee');
    expect(covers(16, 16, 0)).toBe('All 16 employees');
    expect(covers(3, 16, 0)).toBe('All 16 employees, not the 3 shown');
    expect(covers(16, 16, 1)).toBe('All 16 employees · 1 left out has no figures');
    expect(covers(3, 16, 2)).toBe('All 16 employees, not the 3 shown · 2 left out have no figures');
    viewport(1440);
    grid({ rows: [row()], counted: 16 });
    expect(screen.getByText('All 16 employees, not the 1 shown')).toBeVisible();
  });

  /*
   * A SHORT SUM IS NOT THE ANSWER. A statutory total runs over the rows where
   * the scheme was worked out; when one row is unknown the figure is smaller
   * than what the clinic owes, so the foot prints the count beside it.
   */
  it('names the people a statutory total leaves out instead of passing a short sum off as the whole', () => {
    viewport(1440);
    grid({
      rows: [row({ epfEmployee: null, epfEmployer: null, pcb: null })],
      totals: totals({ epfNotCalculated: 1, pcbMissing: 2 }),
    });
    // One unknown EPF leaves BOTH of its columns short — the employee's and
    // the employer's — because the two shares are worked out together.
    expect(screen.getAllByText('1 not worked out')).toHaveLength(2);
    expect(screen.getAllByTitle('1 person is not in this total: EPF was not worked out for them.')).toHaveLength(2);
    expect(screen.getByText('2 not worked out')).toBeVisible();
    expect(screen.getByTitle('2 people are not in this total: PCB was not worked out for them.')).toBeVisible();
    // Nothing is claimed about the columns that are always worked out.
    expect(document.querySelectorAll('.hr-grid__short')).toHaveLength(3);
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
    // Straight to the employment tab, where the salary is recorded — not the top of the record.
    expect(within(last).getByRole('link', { name: 'Fix' })).toHaveAttribute('href', '/admin/hr/employees/staff-7?tab=employment');
    expect(within(last).getAllByText('—').length).toBe(GRID_COLUMNS.length);
  });

  /*
   * WHOSE ROW IS THIS. Seventeen money columns do not fit on any screen and
   * none of them may be merged away, so the grid scrolls — and a figure read
   * against the wrong person is worse than a figure you had to scroll to.
   * The name and the status are pinned to the left edge in EVERY band the
   * table has, header and foot included, or they scroll away exactly when
   * they are needed.
   */
  it('pins the name and the status to the left, in the header, the rows and the foot', () => {
    viewport(1440);
    grid({ leftOut: [{ staffId: 'staff-7', name: 'Wan Azman', position: 'Panel clerk', reason: 'No salary on record' }] });
    const frozen = (scope: string) =>
      [...document.querySelectorAll(`${scope} .hr-grid__freeze`)].map((cell) =>
        cell.classList.contains('hr-grid__freeze--who') ? 'who' : cell.classList.contains('hr-grid__freeze--status') ? 'status' : '?',
      );
    // Two header rows, two body rows (one paid, one left out) and the foot.
    expect(frozen('thead')).toEqual(['who', 'status', 'who', 'status']);
    expect(frozen('tbody')).toEqual(['who', 'status', 'who', 'status']);
    expect(frozen('tfoot')).toEqual(['who', 'status']);
    // And they are the FIRST two cells of every one of those rows, not just
    // present somewhere in it.
    for (const tr of document.querySelectorAll('thead tr, tbody tr, tfoot tr')) {
      const cells = [...tr.children];
      expect(cells[0].className).toContain('hr-grid__freeze--who');
      expect(cells[1].className).toContain('hr-grid__freeze--status');
    }
  });

  it('links the name to the person’s own payroll page for the run', () => {
    viewport(1440);
    grid();
    expect(screen.getByRole('link', { name: /Nurul Hidayah/ })).toHaveAttribute('href', '/admin/hr/payroll/run-1/employees/staff-1');
  });

  /*
   * THE TWO WHITE CELLS OPEN THE MONTH'S ITEMS. A text box here made one
   * hand-keyed Allowance line out of everything typed; the drawer the cell
   * opens keeps each item its own line. The figure stays the server's total.
   */
  it('makes the two white cells buttons that open the person’s items, and types nothing into the grid', () => {
    viewport(1440);
    const opened: [string, string][] = [];
    grid({ onOpenItems: (chosen, cell) => opened.push([chosen.name, cell]) });
    const income = screen.getByRole('button', { name: "Other income for Nurul Hidayah: open the month's items" });
    expect(income).toHaveTextContent('250.00');
    fireEvent.click(income);
    fireEvent.click(screen.getByRole('button', { name: "Other for Nurul Hidayah: open the month's items" }));
    expect(opened).toEqual([
      ['Nurul Hidayah', 'income'],
      ['Nurul Hidayah', 'deductions'],
    ]);
    // Nothing on the grid takes typing: statutory cells, hours and days included.
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
    // A person with nothing extra still has the cell to open.
    expect(screen.getAllByRole('button', { name: /open the month's items/ })).toHaveLength(2);
  });

  it('becomes one card per person on a phone, with the month as the last card', () => {
    viewport(390);
    grid({ rows: [row(), row({ staffId: 'staff-2', name: 'Siti Zaleha' })], counted: 2 });
    expect(document.querySelector('table')).toBeNull();
    expect(document.querySelectorAll('.kw-payCard')).toHaveLength(3);
    expect(screen.getByText('Siti Zaleha')).toBeVisible();
    const total = document.querySelector('.kw-payCard--total') as HTMLElement;
    expect(within(total).getByText('Total')).toBeVisible();
    expect(within(total).getByText('All 2 employees')).toBeVisible();
    expect(within(total).getByText('3,548.48')).toBeVisible();
    expect(within(total).getByText('3,108.98')).toBeVisible();
    // The same way in: a card's Other income opens the person's items.
    const opened: string[] = [];
    grid({ rows: [row()], onOpenItems: (chosen) => opened.push(chosen.name) });
    // The last such button on the page belongs to the render above, not to the first one in this test.
    const buttons = screen.getAllByRole('button', { name: "Other income for Nurul Hidayah: open the month's items" });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(opened).toEqual(['Nurul Hidayah']);
  });
});

/*
 * THE CLINIC'S OWN COLUMNS. Switched on under Payroll items, an item gets a
 * column between Basic and Other income that is typed into like a
 * spreadsheet: the drafts go amber, one Save changes sends every changed
 * cell, and a column nobody in the list has an amount in is folded away.
 */
describe('the clinic’s own columns', () => {
  const OWN = [
    { code: 'DIRECTOR_FEE', name: "Director's fee", carryForward: true },
    { code: 'LOCUM_FEE', name: 'Locum fee', carryForward: true },
  ];
  const cell = (amount: string, over: Partial<ColumnCell> = {}): ColumnCell => ({
    amount,
    entered: amount === '0.00' ? null : amount,
    editable: true,
    carried: false,
    inputId: amount === '0.00' ? null : `in-${amount}`,
    ...over,
  });
  const withColumns = (over: Partial<PayRow> = {}) =>
    row({
      columns: { DIRECTOR_FEE: cell('2000.00', { inputId: 'in-df' }), LOCUM_FEE: cell('900.00', { inputId: 'in-lf' }) },
      ...over,
    });
  const ownTotals = () => totals({ columns: { DIRECTOR_FEE: '2500.00', LOCUM_FEE: '1350.00' } });
  const box = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;

  it('sit between Basic and Other income, in the order given, and foot on the server’s own total', () => {
    viewport(1280);
    grid({ columns: OWN, rows: [withColumns()], totals: ownTotals() });
    expect(headers().slice(2, 6)).toEqual(['Basic', "Director's fee", 'Locum fee', 'Other income']);
    // Earnings grew by the two columns: basic sits under "Record" as before.
    expect(groups()).toContainEqual(['Earnings', 9]);
    const foot = [...document.querySelectorAll('tfoot td')].map((cell) => cell.textContent?.trim() ?? '');
    expect(foot[2]).toBe('2,500.00');
    expect(foot[3]).toBe('1,350.00');
    // Read-only without a save path: the figure opens the items, like the other white cells.
    expect(screen.getByRole('button', { name: "Director's fee for Nurul Hidayah: open the month's items" })).toHaveTextContent('2,000.00');
  });

  it('give a dash, not a box, to a person the item is not for', () => {
    viewport(1280);
    const onSaveCells = vi.fn().mockResolvedValue({ failed: [] });
    const forDoctorsOnly = [{ code: 'DIRECTOR_FEE', name: "Director's fee", carryForward: true, appliesTo: 'SELECTED' as const }];
    grid({ columns: forDoctorsOnly, rows: [row({ columns: {} })], totals: totals({ columns: { DIRECTOR_FEE: '0.00' } }), canEdit: true, onSaveCells });
    fireEvent.click(screen.getByRole('button', { name: 'Show all columns' }));
    expect(screen.queryByRole('textbox', { name: "Director's fee for Nurul Hidayah" })).toBeNull();
    const dash = [...document.querySelectorAll('tbody td')].find((cell) => cell.getAttribute('title')?.includes('is for selected employees'));
    expect(dash).toBeTruthy();
    expect(dash).toHaveTextContent('—');
  });

  it('fold a column nobody in this list has an amount in, and Show all columns brings it back', () => {
    viewport(1280);
    grid({ columns: OWN, rows: [withColumns({ columns: { DIRECTOR_FEE: cell('2000.00'), LOCUM_FEE: cell('0.00') } })], totals: ownTotals() });
    expect(headers()).not.toContain('Locum fee');
    expect(screen.getByRole('status')).toHaveTextContent('1 column hidden (Locum fee): nobody in this list has an amount in it.');
    fireEvent.click(screen.getByRole('button', { name: 'Show all columns' }));
    expect(headers()).toContain('Locum fee');
    expect(screen.getByRole('button', { name: 'Hide empty columns' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('are typed into on an open run, and one Save changes sends every changed cell together', async () => {
    viewport(1280);
    const onSaveCells = vi.fn().mockResolvedValue({ failed: [] });
    grid({ columns: OWN, rows: [withColumns()], totals: ownTotals(), canEdit: true, onSaveCells });
    const fee = box("Director's fee for Nurul Hidayah");
    expect(fee.value).toBe('2000.00');
    fireEvent.change(fee, { target: { value: '2100' } });
    expect(screen.getByText('1 change not saved.')).toBeInTheDocument();
    // A blank clears the line.
    fireEvent.change(box('Locum fee for Nurul Hidayah'), { target: { value: '' } });
    expect(screen.getByText('2 changes not saved.')).toBeInTheDocument();
    // Back to what is saved is not a change.
    fireEvent.change(box('Locum fee for Nurul Hidayah'), { target: { value: '900' } });
    expect(screen.getByText('1 change not saved.')).toBeInTheDocument();
    fireEvent.change(box('Locum fee for Nurul Hidayah'), { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSaveCells).toHaveBeenCalledTimes(1));
    expect(onSaveCells.mock.calls[0][0]).toEqual([
      { key: 'staff-1:DIRECTOR_FEE', staffId: 'staff-1', name: 'Nurul Hidayah', code: 'DIRECTOR_FEE', title: "Director's fee", inputId: 'in-df', amount: '2100.00' },
      { key: 'staff-1:LOCUM_FEE', staffId: 'staff-1', name: 'Nurul Hidayah', code: 'LOCUM_FEE', title: 'Locum fee', inputId: 'in-lf', amount: null },
    ]);
    await waitFor(() => expect(screen.queryByText(/not saved/)).toBeNull());
  });

  it('refuse to send a cell that is not a number, and say which', () => {
    viewport(1280);
    const onSaveCells = vi.fn().mockResolvedValue({ failed: [] });
    grid({ columns: OWN, rows: [withColumns()], totals: ownTotals(), canEdit: true, onSaveCells });
    fireEvent.change(box("Director's fee for Nurul Hidayah"), { target: { value: 'two thousand' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByText(/Director's fee for Nurul Hidayah: enter a number with at most two decimals/)).toBeInTheDocument();
    expect(onSaveCells).not.toHaveBeenCalled();
  });

  it('keep a cell the server refused, with its reason, and let the rest go', async () => {
    viewport(1280);
    const onSaveCells = vi.fn().mockResolvedValue({ failed: [{ key: 'staff-1:DIRECTOR_FEE', message: "Director's fee for Nurul Hidayah: The payroll for 2026-01 is already approved." }] });
    grid({ columns: OWN, rows: [withColumns()], totals: ownTotals(), canEdit: true, onSaveCells });
    fireEvent.change(box("Director's fee for Nurul Hidayah"), { target: { value: '2100' } });
    fireEvent.change(box('Locum fee for Nurul Hidayah'), { target: { value: '950' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByText('1 change not saved.')).toBeInTheDocument());
    expect(screen.getByText(/already approved/)).toBeInTheDocument();
    expect(box("Director's fee for Nurul Hidayah").value).toBe('2100');
    expect(box('Locum fee for Nurul Hidayah').value).toBe('900.00');
  });

  it('mark a cell still carrying last month’s amount until it is typed into', () => {
    viewport(1280);
    grid({
      columns: OWN,
      rows: [withColumns({ columns: { DIRECTOR_FEE: cell('2000.00', { carried: true, inputId: 'in-df' }), LOCUM_FEE: cell('900.00') } })],
      totals: ownTotals(),
      canEdit: true,
      previousMonth: 'January 2026',
      onSaveCells: vi.fn(),
    });
    const marker = screen.getByText('Carried');
    expect(marker).toHaveAttribute('title', 'Carried from January 2026. Edit or clear it if it should not repeat.');
    expect(screen.queryByText('Carried', { selector: '.hr-grid__carried' })).not.toBeNull();
    fireEvent.change(box("Director's fee for Nurul Hidayah"), { target: { value: '2100' } });
    expect(screen.queryByText('Carried')).toBeNull();
  });

  it('keep a line a record holds as a figure that opens the items, never a box', () => {
    viewport(1280);
    const onOpenItems = vi.fn();
    grid({
      columns: OWN,
      rows: [withColumns({ columns: { DIRECTOR_FEE: cell('250.00', { editable: false, inputId: 'in-rec' }), LOCUM_FEE: cell('900.00') } })],
      totals: ownTotals(),
      canEdit: true,
      onSaveCells: vi.fn(),
      onOpenItems,
    });
    expect(screen.queryByRole('textbox', { name: "Director's fee for Nurul Hidayah" })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "Director's fee for Nurul Hidayah: open the month's items" }));
    expect(onOpenItems).toHaveBeenCalledWith(expect.objectContaining({ staffId: 'staff-1' }), 'income');
  });

  it('show on a phone card as figures, not boxes', () => {
    viewport(390);
    grid({ columns: OWN, rows: [withColumns()], totals: ownTotals(), canEdit: true, onSaveCells: vi.fn() });
    expect(screen.getByText("Director's fee")).toBeInTheDocument();
    expect(screen.getByText('2,000.00')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('are in the export whether folded or not, with the row’s own figure', () => {
    const columns = gridColumnsFor(OWN);
    expect(columns.map((column) => column.key).slice(0, 4)).toEqual(['basic', 'item:DIRECTOR_FEE', 'item:LOCUM_FEE', 'otherIncome']);
    expect(cellValue(columns[1], withColumns())).toBe('2000.00');
    expect(cellValue(columns[1], row())).toBe('0.00');
    expect(cellValue(columns[0], row())).toBe('3200.00');
  });
});
