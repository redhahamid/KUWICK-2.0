// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegalEmployerRow } from '../types';

/*
 * SETTINGS (UAT, 10 October 2026; docs/hr-mockup/SetupWizard.html and
 * SettingsHome.html): only the setup steps while setup is incomplete; four
 * cards and a collapsed Advanced once it is done. Demo employer and item
 * names only.
 */
/** What the server reports missing, worked out from the row as legal-employer.service does. */
const readinessOf = (row: LegalEmployerRow) => {
  const missing = [
    !row.registrationNo && 'Company registration number',
    !row.epfEmployerNo && 'EPF employer number',
    !row.socsoEmployerNo && 'SOCSO employer code',
    !row.lhdnEmployerNo && 'LHDN employer number (E)',
    !row.bankAccountOnFile && 'Bank account for payment',
    !row.hrdRegistration && 'HRD Corp registration class',
  ].filter(Boolean) as string[];
  return { complete: missing.length === 0, missing, note: '' };
};
const employer = (over: Partial<LegalEmployerRow> = {}): LegalEmployerRow => {
  const row = {
    id: 'le-1',
    name: 'Demo Clinic Sdn Bhd',
    employeeCount: 3,
    registrationNo: '202001000001',
    epfEmployerNo: '000000001',
    socsoEmployerNo: null,
    lhdnEmployerNo: 'E 0000000001',
    hrdRegistrationNo: 'HRD-DEMO-1',
    hrdRegistration: 'MANDATORY_SECTION_14',
    hrdLevyBase: 'BASIC_PLUS_FIXED_ALLOWANCES',
    zakatThroughPayroll: false,
    addressLine1: '1 Jalan Demo',
    addressLine2: 'Taman Demo',
    postcode: '43000',
    city: 'Bangi',
    state: 'Selangor',
    bankName: 'Demo Bank',
    bankAccountOnFile: true,
    bankAccountLastFour: '1234',
    bankAccountName: 'Demo Clinic Sdn Bhd',
    active: true,
    ...over,
  } as LegalEmployerRow;
  return { ...row, statutoryReadiness: readinessOf(row) };
};

let employers: LegalEmployerRow[] = [];
let check: { checkedAt: string; checkedBy: string | null; current: boolean } | null = null;
const upsert = vi.fn(async () => ({}));
const ok = (data: unknown) => ({ data, isLoading: false, error: null });

vi.mock('../hooks/useAdmin', () => ({
  useLegalEmployers: () => ok(employers),
  usePayComponents: () =>
    ok({
      components: [
        { name: 'Basic salary', active: true, payDay: 30, paidInArrears: false, paidFollowingMonth: false },
        { name: 'Overtime', active: true, payDay: 15, paidInArrears: true, paidFollowingMonth: false },
        { name: "Director's fee", active: true, payDay: 1, paidInArrears: false, paidFollowingMonth: false },
      ],
    }),
  usePayrollApprovalPolicy: () => ok({ mode: 'STANDARD' }),
  usePayrollPolicies: () => ok({ policies: [{ isDefault: true, partMonthBasis: 'CALENDAR_DAYS', overtime: { days: 26, hoursPerDay: 8 } }] }),
  usePayrollRuns: () => ok([]),
  useStatutoryRates: () => ok({ check }),
  useAttendancePolicy: () => ok({ source: 'KUWICK_DEFAULT' }),
  useLeavePolicies: () => ok([{ active: true, carryForwardDays: 3, payUntakenLeaveOnExit: true }]),
  useEmployees: () => ok([{ active: true, hasProfile: true }, { active: true, hasProfile: true }, { active: true, hasProfile: false }]),
  useUpsertLegalEmployer: () => ({ mutateAsync: upsert, isPending: false }),
  useRecordEmployerHrd: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetEmployerLogo: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveEmployerLogo: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMarkStatutoryChecked: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
let holidays: { date: string }[] = [];
let opening: unknown = null;
vi.mock('../../hr/hooks/usePublicHolidays', () => ({
  usePublicHolidays: () => ok(holidays),
  useHolidayPresets: () => ok({ year: 2026, state: 'Selangor', available: true, holidays: [] }),
  useLoadHolidayPresets: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../core/hooks/useGlobalSetting', () => ({
  useGlobalSetting: () => ok(opening),
  useSetGlobalSetting: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../core/hooks/useClinicFilter', () => ({ useClinicFilter: () => ({ clinicId: undefined }) }));
vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true }));

const { HrSettingsPage } = await import('./HrSettingsPage');
const { employerSaveBody } = await import('./SettingsSetupWizard');

const mount = (path = '/admin/hr/settings') =>
  render(
    <App>
      <MemoryRouter initialEntries={[path]}>
        <HrSettingsPage />
      </MemoryRouter>
    </App>,
  );

beforeEach(() => {
  upsert.mockClear();
  employers = [employer()];
  check = null;
  holidays = [];
  opening = null;
});

describe('Settings while setup is incomplete', () => {
  it('is the setup steps and nothing else, with the first one still to do open', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Set up payroll' })).toBeInTheDocument();
    const steps = within(screen.getByRole('navigation', { name: 'Setup steps' }));
    expect(steps.getAllByRole('button').map((button) => button.querySelector('.hr-wizStep__title')?.textContent)).toEqual([
      'Company & statutory numbers',
      'Company bank account',
      'Pay rules',
      'Payroll items',
      'Public holidays',
      'Opening balances',
      'Employees',
      'Statutory rates',
    ]);
    expect(steps.getByText('1 missing')).toBeInTheDocument();
    // A login with no HR record (the owner's own account) is not counted (new-clinic UAT, 15 October 2026).
    expect(steps.getByText('2 employees')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 8')).toBeInTheDocument();
    expect(screen.queryByText('Advanced')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save & next' })).toBeInTheDocument();
  });

  it('agrees with Company & statutory: a clinic with no staff yet is not "complete" while numbers are missing', () => {
    employers = [employer({ employeeCount: 0, socsoEmployerNo: 'A0000000001X', hrdRegistration: null, bankAccountOnFile: false })];
    mount();
    const steps = within(screen.getByRole('navigation', { name: 'Setup steps' }));
    expect(steps.getByText('1 missing')).toBeInTheDocument();
    expect(steps.getByText('Not on file')).toBeInTheDocument();
  });

  it('saves the numbers with everything else on file, and never the bank number', async () => {
    mount();
    fireEvent.change(screen.getByPlaceholderText('e.g. A3100012345X'), { target: { value: 'A0000000001X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & next' }));
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    const body = (upsert.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(body).toMatchObject({
      id: 'le-1',
      socsoEmployerNo: 'A0000000001X',
      hrdRegistrationNo: 'HRD-DEMO-1',
      addressLine2: 'Taman Demo',
      postcode: '43000',
      bankName: 'Demo Bank',
      hrdLevyBase: 'BASIC_PLUS_FIXED_ALLOWANCES',
      zakatThroughPayroll: false,
    });
    expect(body).not.toHaveProperty('bankAccountNo');
  });

  it('asks only employers with staff for their numbers, and every card stays reachable (UAT, 15 October 2026)', () => {
    employers = [employer({ socsoEmployerNo: 'A0000000001X' }), employer({ id: 'le-2', name: 'Contoh Wellness', employeeCount: 0, epfEmployerNo: null })];
    mount();
    expect(within(screen.getByRole('navigation', { name: 'Setup steps' })).queryByText(/\d missing/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open all settings now' })).toHaveAttribute('href', '/admin/hr/settings?all=1');
  });

  it('sends the Employees step to the Employees page', () => {
    mount('/admin/hr/settings?step=employees');
    expect(screen.getByRole('link', { name: 'Open the Employees page' })).toHaveAttribute('href', '/admin/hr/employees');
  });
});

describe('Settings when setup is done', () => {
  beforeEach(() => {
    employers = [employer({ socsoEmployerNo: 'A0000000001X' })];
    check = { checkedAt: '2026-10-05T00:00:00.000Z', checkedBy: 'Demo Owner', current: true };
    holidays = [{ date: `${new Date().getFullYear()}-05-01` }];
    opening = { answer: 'NONE', year: new Date().getFullYear() };
  });

  it('is one line, four cards with three facts each, and Advanced folded away', () => {
    mount();
    expect(screen.getByRole('link', { name: /Setup complete.*Review setup/ })).toHaveAttribute('href', '/admin/hr/settings?setup=1');
    const cards = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(cards).toEqual(['Company & statutory', 'Pay rules', 'Payroll items', 'Attendance & leave']);
    for (const card of document.querySelectorAll('.hr-area')) {
      expect(card.querySelectorAll('.hr-facts__row').length).toBeGreaterThan(0);
      expect(card.querySelectorAll('.hr-facts__row').length).toBeLessThanOrEqual(3);
    }
    expect(screen.getByText('Paid on the 15th · a month in arrears')).toBeInTheDocument();
    // Every pay date, the 1st included (UAT, 10 October 2026).
    expect(screen.getByText('Paid on the 1st')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Opening balances/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByRole('link', { name: /Opening balances/ })).toHaveAttribute('href', '/admin/hr/settings/opening-balances');
    expect(screen.getByRole('link', { name: /Statutory rates/ })).toHaveAttribute('href', '/admin/hr/settings/statutory');
  });

  it('reopens the steps on Review setup', () => {
    mount('/admin/hr/settings?setup=1');
    expect(screen.getByRole('heading', { name: 'Set up payroll' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Settings' })).toBeInTheDocument();
  });
});

describe('employerSaveBody', () => {
  it('leaves a blank box out rather than sending an empty string', () => {
    const body = employerSaveBody(employer({ registrationNo: null }), { registrationNo: '  ' }, {
      hrdLevyBase: 'BASIC_ONLY',
      zakatThroughPayroll: true,
    });
    expect(body).not.toHaveProperty('registrationNo');
    expect(body).toMatchObject({ hrdLevyBase: 'BASIC_ONLY', zakatThroughPayroll: true });
  });
});
