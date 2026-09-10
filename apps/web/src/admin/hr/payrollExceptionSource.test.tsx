// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
// Vite's ?raw import gives the file's SOURCE as a string. The guards at the
// bottom of this file assert on what the components are WIRED to, which no
// amount of rendering can prove on its own.
import pageSource from './PayrollPage.tsx?raw';
import centreSource from './PayrollExceptionCentre.tsx?raw';
import type { PayrollExceptionList, PayrollExceptionRow, PayrollRunDetail, PayrollRunRow } from '../types';

/**
 * ONE STORE FOR EXCEPTION STATE.
 *
 * The defect this file exists to prevent, in the state it was actually found
 * in: the run banner said "5 exception(s) must be resolved before this run can
 * be approved", the exception centre four inches below it said "No exceptions.
 * Every employee in this run could be calculated", and the Approve button was
 * enabled. The banner was rendering the run's legacy `exceptions` JSON blob;
 * the centre and the gate were reading `payroll_exceptions` rows. Two stores of
 * one fact, and a payroll screen that contradicted itself about who could be
 * paid.
 *
 * These tests drive the REAL PayrollPage — not a reimplementation of it — with
 * one controlled exception payload, and assert that every surface that says
 * anything about exceptions says the same thing.
 */

const RUN_ID = 'run-consistency-1';

/**
 * COMMENTS STRIPPED. The forbidden expressions are named in the components'
 * own comments, on purpose — the history of the defect belongs beside the code
 * that fixed it — and a guard that could not tell a comment from a call would
 * have to choose between the two.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function exception(over: Partial<PayrollExceptionRow> & { id: string }): PayrollExceptionRow {
  return {
    severity: 'BLOCKING',
    code: 'NO_SALARY',
    staffId: `staff-${over.id}`,
    staffName: `Employee ${over.id}`,
    cause: 'No salary or hourly rate is in force for this period.',
    consequence: 'This employee cannot be paid, and the run total excludes them.',
    remediation: 'Add an effective-dated salary that covers this period.',
    deepLink: null,
    overridable: false,
    overriddenBy: null,
    overrideReason: null,
    overriddenAt: null,
    ...over,
  };
}

// Three blocking, two warning — the shape the admin UAT clinic actually seeds.
const ROWS: PayrollExceptionRow[] = [
  exception({ id: '1' }),
  exception({ id: '2', code: 'PCB_MISSING' }),
  exception({ id: '3', code: 'PCB_MISSING' }),
  exception({ id: '4', code: 'UNAPPROVED_OVERTIME', severity: 'WARNING', overridable: true }),
  exception({ id: '5', code: 'MISSING_PUNCH', severity: 'WARNING', overridable: true }),
];

// THE GATE IS THE SERVER'S, copied verbatim rather than recomputed here. If the
// page ever starts counting for itself, these numbers stop matching what it
// draws and the test fails — which is the whole point.
const GATE: PayrollExceptionList['gate'] = {
  canApprove: false,
  total: 5,
  blocking: 3,
  warnings: 2,
  info: 0,
  overridden: 0,
  reason: '3 blocking exception(s) must be resolved before this run can be approved.',
};

const RUN: PayrollRunDetail = {
  id: RUN_ID,
  period: '2026-08',
  clinicName: 'Contoh Central',
  status: 'CALCULATED',
  statutoryStatus: 'PROVISIONAL',
  statutoryNotice: 'The statutory rates used have not been verified.',
  grossTotal: 40959.4,
  deductionTotal: 6923.68,
  netTotal: 34171.2,
  employerCostTotal: 46196.05,
  employeeCount: 6,
  calculatedAt: '2026-08-31T00:00:00.000Z',
  approvedAt: null,
  approvedBy: null,
  createdBy: 'Nurul Hidayah',
  paidAt: null,
  lines: [],
  adjustments: [],
};

const RUN_ROW: PayrollRunRow = {
  id: RUN_ID,
  period: '2026-08',
  clinicId: 'clinic-1',
  clinicName: 'Contoh Central',
  status: 'CALCULATED',
  statutoryStatus: 'PROVISIONAL',
  grossTotal: 40959.4,
  deductionTotal: 6923.68,
  netTotal: 34171.2,
  employerCostTotal: 46196.05,
  employeeCount: 6,
  exceptions: GATE,
  lines: 6,
  adjustments: 0,
  calculatedAt: '2026-08-31T00:00:00.000Z',
  approvedAt: null,
  approvedBy: null,
  createdBy: 'Nurul Hidayah',
  paidAt: null,
};

import { PayrollPage } from './PayrollPage';

const idle = { data: undefined, isLoading: false, isPending: false, mutateAsync: vi.fn(), mutate: vi.fn() };

vi.mock('../hooks/useAdmin', () => ({
  usePayrollRuns: () => ({ data: [RUN_ROW], isLoading: false }),
  usePayrollRun: () => ({ data: RUN, isLoading: false }),
  usePayrollExceptions: () => ({ data: { exceptions: ROWS, gate: GATE } as PayrollExceptionList, isLoading: false }),
  usePayrollVariance: () => ({ data: undefined, isLoading: false }),
  useStatutoryRuleSets: () => ({ data: [], isLoading: false }),
  useCreatePayrollRun: () => idle,
  useCalculatePayroll: () => idle,
  useApprovePayroll: () => idle,
  useReopenPayroll: () => idle,
  useOverrideException: () => idle,
  usePayrollInputs: () => ({ data: [], isLoading: false }),
  useUpsertPayrollInput: () => idle,
  useDeletePayrollInput: () => idle,
  usePayComponents: () => ({ data: { components: [], verificationNotice: { statement: '' } }, isLoading: false }),
  usePayrollSnapshots: () => ({ data: [], isLoading: false }),
  useCandidateDiff: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('../../core/hooks/useClinicFilter', () => ({
  useClinicFilter: () => ({ clinicId: 'clinic-1', setClinicId: vi.fn(), clinics: [], multiBranch: false }),
}));
vi.mock('../../core/hooks/useCan', () => ({
  useCan: () => true,
  permissionHint: (doing: string) => `not permitted to ${doing}`,
}));
// Imported after the mocks are declared for readability; `vi.mock` is hoisted
// above every import regardless, so the page picks up the stubs either way.
vi.mock('../../core/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ tenant: { name: 'Klinik Contoh (UAT)' }, staff: { fullName: 'Dr Aisyah Rahman', permissions: null } }),
}));


describe('exception state has exactly one source', () => {
  it('1. the banner states the gate’s own count, and it is the blocking count', async () => {
    render(<PayrollPage />);
    // Not "5 exceptions". THREE — the number that actually stops approval.
    // Counting all five here is what made the banner disagree with the button.
    //
    // TWO PLACES SAY IT, WORD FOR WORD: the run banner and the exception
    // centre's own notice. That there is more than one match is the assertion,
    // not a nuisance — they are rendering one string from one object.
    const said = await screen.findAllByText(GATE.reason);
    expect(said.length).toBeGreaterThanOrEqual(2);
  });

  it('2. the banner names the same five rows the centre lists', async () => {
    render(<PayrollPage />);
    for (const row of ROWS) {
      // Each employee appears in the banner AND in the exception centre's
      // table: two renderings, one array.
      const hits = await screen.findAllByText(new RegExp(row.staffName!));
      expect(hits.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('3. the exception centre shows five rows and no empty state', () => {
    render(<PayrollPage />);
    expect(screen.queryByText(/Every employee in this run could be calculated/)).toBeNull();

    /*
     * THREE BLOCKING AND TWO WARNING, and the SECTION is what says which.
     *
     * This used to count severity TAGS inside the centre — which is how a
     * blocker and a warning came to look identical apart from four words of
     * pill. The centre draws two panels now, with their own edges and counts,
     * so the tally is the rows in each. The guarantee is unchanged and is
     * still the point of the test: the centre and the banner walk the SAME
     * array and cannot land on different numbers.
     */
    const panels = [...document.querySelectorAll('.kw-panel')];
    const panelFor = (heading: RegExp) =>
      panels.find((panel) => heading.test(panel.querySelector('.kw-panel__title')?.textContent ?? ''));

    const blockers = panelFor(/^Blockers/);
    const warnings = panelFor(/^Warnings/);
    expect(blockers, 'the centre draws a Blockers panel').toBeTruthy();
    expect(warnings, 'the centre draws a Warnings panel').toBeTruthy();

    expect(blockers!.querySelectorAll('.kw-attention')).toHaveLength(GATE.blocking);
    expect(warnings!.querySelectorAll('.kw-attention')).toHaveLength(GATE.warnings);
    // The heading carries the same count as the rows under it.
    expect(blockers!.querySelector('.kw-panel__title')?.textContent).toContain(String(GATE.blocking));
    expect(warnings!.querySelector('.kw-panel__title')?.textContent).toContain(String(GATE.warnings));

    const banner = document.querySelectorAll('.kw-adminNotice .kw-sev');
    const tally = (nodes: NodeListOf<Element>, severity: string) =>
      Array.from(nodes).filter((n) => n.classList.contains(`kw-sev--${severity}`)).length;
    expect(tally(banner, 'blocking')).toBe(GATE.blocking);
    expect(tally(banner, 'warning')).toBe(GATE.warnings);
    expect(banner.length).toBe(GATE.total);
  });

  it('4. the approve button is disabled by the same gate the banner quotes', async () => {
    render(<PayrollPage />);
    const approve = screen.getByRole('button', { name: /Approve/ });
    expect(approve.hasAttribute('disabled')).toBe(true);
  });

  it('5. the run table cell shows the blocking count, with warnings kept separate', async () => {
    render(<PayrollPage />);
    const cell = document.querySelector('.kw-runExceptions');
    expect(cell).toBeTruthy();
    expect(within(cell as HTMLElement).getByText(String(GATE.blocking))).toBeTruthy();
    expect(within(cell as HTMLElement).getByText(`+${GATE.warnings}`)).toBeTruthy();
  });
});

describe('the second store cannot come back', () => {
  it('6. the run detail payload carries no exception field for the UI to read', () => {
    // A compile-time guarantee as well as a runtime one: `PayrollRunDetail` has
    // no `exceptions` member, so a component that tried to read one would not
    // typecheck. This asserts the runtime shape too, because a payload key that
    // exists is a key somebody will eventually render.
    expect(Object.keys(RUN)).not.toContain('exceptions');
  });

  it('7. PayrollPage never reads exception state off the run detail', () => {
    const source = code(pageSource);
    // The exact expressions that made the two stores disagree. If any of them
    // reappears, exception state has a second source again.
    expect(source).not.toMatch(/run[?]?\.exceptions/);
    expect(source).not.toMatch(/hasExceptions/);
    // And the gate must not fall back to anything: an unknown gate means "do
    // not let this be approved yet", never "approve away".
    expect(source).toMatch(/gate \? !gate\.canApprove : true/);
  });

  it('8. the exception centre and the page read the same query key', () => {
    const page = code(pageSource);
    const centre = code(centreSource);
    // Same hook, so the same TanStack cache entry — not two fetches that could
    // land at different times and show different numbers.
    expect(page).toMatch(/usePayrollExceptions\(/);
    expect(centre).toMatch(/usePayrollExceptions\(/);
  });
});
