// @vitest-environment jsdom
import { App as AntApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PayrollHome } from '../types';

/**
 * THE MONTH UNDER "ALL BRANCHES". A payroll run is a branch's, so with the
 * picker on All branches the page used to show whichever branch's run the
 * server found first, as if it were the month. It now lists every branch
 * with its own run, and starting a month means picking the branch first.
 */
const setClinicId = vi.fn();
let clinicId: string | undefined;
vi.mock('../../core/hooks/useClinicFilter', () => ({
  useClinicFilter: () => ({
    clinicId,
    setClinicId,
    clinics: [
      { id: 'c-a', name: 'Branch A' },
      { id: 'c-b', name: 'Branch B' },
    ],
    showSelector: true,
    mayViewAllBranches: true,
  }),
}));
vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true }));

let home: PayrollHome;
/** The query still reading the month: no data yet. */
let loading = false;
vi.mock('../hooks/useAdmin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useAdmin')>()),
  usePayrollHome: () => (loading ? { data: undefined, error: null, isLoading: true } : { data: home, error: null, isLoading: false }),
  usePayrollReadiness: () => ({ data: undefined, isLoading: false }),
  useCreatePayrollRun: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCalculatePayroll: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { PayrollMonthPage } = await import('./PayrollMonthPage');

const gate = { canApprove: true, total: 0, blocking: 0, warnings: 0, info: 0, overridden: 0, reason: 'No exceptions.' };

function fixture(over: Partial<PayrollHome> = {}): PayrollHome {
  return {
    period: '2026-09',
    periodLabel: 'September 2026',
    periodStatutoryStatus: 'CONFIGURED',
    run: null,
    runs: [
      {
        id: 'run-a',
        clinicId: 'c-a',
        clinicName: 'Branch A',
        status: 'CALCULATED',
        state: 'READY_TO_REVIEW',
        employeeCount: 3,
        netTotal: '9000.00',
        employerCostTotal: '10500.00',
        gate,
      },
    ],
    state: 'BY_BRANCH',
    gate: null,
    employeesExpected: 5,
    setup: { total: 5, ready: 4, salaryOnRecord: 5, bankAccount: 4, dateOfBirth: 5, pcbMissing: 0 },
    feeding: { attendanceDays: 0, overtimeHours: 0, unapprovedOvertimeHours: 0, unpaidLeaveRequests: 0, claims: 0, claimTotal: '0.00', incentives: 0, incentiveTotal: '0.00' },
    contractorsExcluded: 0,
    recent: [],
    ...over,
  };
}

function show() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AntApp>
        <MemoryRouter initialEntries={['/admin/hr/payroll?period=2026-09']}>
          <PayrollMonthPage />
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setClinicId.mockReset();
  clinicId = undefined;
  loading = false;
  home = fixture();
});

/*
 * LOADING IS NOT "NOT STARTED". Every month, a started one included, used to
 * flash "Not started" and the not-production-ready banner while it was read.
 */
describe('while the month is being read', () => {
  it('says it is loading, and neither that the month has not been started nor that setup is unsafe', () => {
    loading = true;
    show();
    expect(screen.getByTestId('payroll-month-loading')).toHaveTextContent('Loading September 2026');
    expect(screen.queryByText('Not started')).toBeNull();
    expect(screen.queryByText(/not yet production-ready/)).toBeNull();
  });
});

describe('the payroll month under All branches', () => {
  it('lists every branch with its own run, rather than passing one branch off as the month', () => {
    show();
    expect(screen.getByText('September 2026 by branch')).toBeVisible();
    const a = screen.getByText('Branch A').closest('tr') as HTMLElement;
    expect(within(a).getByText('Ready to review')).toBeVisible();
    expect(within(a).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/admin/hr/payroll/run-a');
    const b = screen.getByText('Branch B').closest('tr') as HTMLElement;
    expect(within(b).getByText('Not started')).toBeVisible();
    // No single "Start September 2026 payroll" for the whole group: a run is a branch's.
    expect(screen.queryByRole('button', { name: /Start September 2026 payroll/ })).toBeNull();
    fireEvent.click(within(b).getByRole('button', { name: 'Start' }));
    expect(setClinicId).toHaveBeenCalledWith('c-b');
  });

  it('is the one branch’s month once a branch is picked', () => {
    clinicId = 'c-b';
    home = fixture({ runs: [], state: 'NOT_STARTED' });
    show();
    expect(screen.queryByText('September 2026 by branch')).toBeNull();
    expect(screen.getByText('September 2026 has not been started')).toBeVisible();
  });
});
