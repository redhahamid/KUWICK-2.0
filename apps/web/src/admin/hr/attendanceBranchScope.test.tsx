// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE BRANCH FILTER REACHES EVERY QUERY ON THE SCREEN, NOT MOST OF THEM.
 *
 * Attendance asked for its punches by branch and then for EVERYBODY'S leave
 * and everybody's names. So with an empty branch selected the Timesheet still
 * showed a doctor from another branch, and the "On time today" card counted
 * her as "1 on leave" — the same hole `branchFilterScope.test.tsx` closed on
 * Leave and Claims, one screen along. The HR landing page's "leave this week"
 * list, the Locum screen, the opening year-to-date import and two of the
 * reports (claims, year to date) had no branch on their queries either.
 *
 * These cases pin the branch onto the QUERY, the only place it settles the
 * table, the cards and the counts at once. A branch applied after the fetch
 * would still have the server sending other branches' people down the wire.
 */
const calls: Record<string, unknown[]> = {};
const rec = (name: string, value: unknown) => {
  (calls[name] ??= []).push(value);
};
const each = (name: string) => {
  const made = calls[name] ?? [];
  expect(made.length).toBeGreaterThan(0);
  return made;
};

const idle = { data: undefined, isLoading: false, isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() };
const nothing = () => ({ data: undefined, isLoading: false, isError: false });

vi.mock('../hooks/useAdmin', () => ({
  // Attendance
  useTimesheet: (params: unknown) => {
    rec('useTimesheet', params);
    return { data: { from: '', to: '', staff: [] }, isLoading: false, isError: false };
  },
  useCorrectionRequests: (clinicId: unknown) => {
    rec('useCorrectionRequests', clinicId);
    return { data: [], isLoading: false };
  },
  useDecideCorrection: () => idle,
  useApproveOvertime: () => idle,
  useCorrectAttendance: () => idle,
  useClockStaff: () => idle,
  useAttendancePolicy: (clinicId: unknown) => {
    rec('useAttendancePolicy', clinicId);
    return nothing();
  },
  useEmployees: (params: unknown) => {
    rec('useEmployees', params);
    return { data: [], isLoading: false };
  },
  // The landing page
  useWorkforceToday: (clinicId: unknown) => {
    rec('useWorkforceToday', clinicId);
    return nothing();
  },
  usePayrollReadiness: (params: unknown) => {
    rec('usePayrollReadiness', params);
    // Set up, so the first-time journey (its own hooks) stays off the page.
    return { data: { summary: { total: 3, ready: 3, withBlockers: 0 }, employers: [] }, isLoading: false, isError: false };
  },
  usePayrollHome: (params: unknown) => {
    rec('usePayrollHome', params);
    return nothing();
  },
  // Locum
  useLocumSessions: (params: unknown) => {
    rec('useLocumSessions', params);
    return { data: [], isLoading: false, isError: false };
  },
  useLocumPayable: (params: unknown) => {
    rec('useLocumPayable', params);
    return nothing();
  },
  useApproveLocumSession: () => idle,
  useSettleLocumSession: () => idle,
  useUpdateLocumSession: () => idle,
  // Opening year to date
  useLegalEmployers: () => ({ data: [], isLoading: false, isError: false }),
  useImportYtdOpening: () => idle,
  // Reports
  usePayrollReportCatalogue: () => ({
    data: {
      available: [
        { key: 'CLAIMS', label: 'Claims and reimbursements', description: '', scope: 'DATE_RANGE' },
        { key: 'YTD', label: 'Year to date', description: '', scope: 'YEAR' },
      ],
      notAvailableYet: [],
    },
    isLoading: false,
    isError: false,
  }),
  usePayrollRuns: (params: unknown) => {
    rec('usePayrollRuns', params);
    return { data: [], isLoading: false, isError: false };
  },
  usePayslips: nothing,
  usePayrollClaimsReport: (params: unknown) => {
    rec('usePayrollClaimsReport', params);
    return nothing();
  },
  usePayrollYtdReport: (params: unknown) => {
    rec('usePayrollYtdReport', params);
    return nothing();
  },
  usePayrollRegisterReport: nothing,
  usePayrollEmployerCostReport: nothing,
  usePayrollStatutoryReport: nothing,
  usePayrollMonthComparisonReport: nothing,
  usePayrollHistoryReport: nothing,
  usePayrollPcbSummaryReport: nothing,
  usePayrollOvertimeReport: nothing,
  usePayrollUnpaidLeaveReport: nothing,
  usePayrollIncentivesReport: nothing,
  usePayrollExceptionsReport: nothing,
  usePayrollPaymentStatusReport: nothing,
  payslipPdfPath: () => '',
}));

vi.mock('../../hr/hooks/useLeaveRequests', () => ({
  useLeaveRequests: (params: unknown) => {
    rec('useLeaveRequests', params);
    return { data: [], isLoading: false };
  },
}));
vi.mock('../../appointment/hooks/useRoster', () => ({
  useRosterRange: (clinicId: unknown) => {
    rec('useRosterRange', clinicId);
    return { data: [] };
  },
}));
vi.mock('../../core/hooks/useClinicFilter', () => ({
  useClinicFilter: () => ({
    clinicId: 'branch-baharu',
    setClinicId: vi.fn(),
    clinics: [],
    showSelector: true,
    mayViewAllBranches: true,
  }),
}));
vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true, useCanCheck: () => () => true, permissionHint: () => '' }));
vi.mock('../../core/api-client', () => ({
  fetchBlobUrl: vi.fn().mockResolvedValue('blob:selfie'),
  downloadFile: vi.fn(),
}));
vi.mock('./StatutoryOutputsPanel', () => ({ useStatutoryOutputs: () => ({ data: undefined }) }));
vi.mock('./HrSetupJourney', () => ({ HrSetupJourney: () => null }));

const { TimesheetPage } = await import('./TimesheetPage');
const { HrOverviewPage } = await import('./HrOverviewPage');
const { LocumPage } = await import('./LocumPage');
const { YtdOpeningImportPage } = await import('./YtdOpeningImportPage');
const { PayrollReportsPage } = await import('./PayrollReportsPage');

function show(Page: () => ReactElement, url = '/admin/hr') {
  render(
    <AntApp>
      <MemoryRouter initialEntries={[url]}>
        <Page />
      </MemoryRouter>
    </AntApp>,
  );
}

beforeEach(() => {
  for (const key of Object.keys(calls)) delete calls[key];
});

describe('the branch filter, on Attendance', () => {
  it('asks for the selected branch’s leave, so nobody from another branch is "on leave" here', () => {
    show(TimesheetPage);
    for (const call of each('useLeaveRequests')) expect(call).toMatchObject({ clinicId: 'branch-baharu' });
  });

  it('asks for the selected branch’s names, not the whole tenant’s, to label its rows', () => {
    show(TimesheetPage);
    for (const call of each('useEmployees')) expect(call).toMatchObject({ clinicId: 'branch-baharu' });
  });

  /*
   * Already right, and asserted so a later change cannot quietly widen one of
   * them while the two above stay green: the punches for the day and the
   * month, the corrections queue, the roster and the branch's clock rules.
   */
  it('keeps the punches, the corrections, the roster and the rules on the same branch', () => {
    show(TimesheetPage);
    for (const call of each('useTimesheet')) expect(call).toMatchObject({ clinicId: 'branch-baharu' });
    for (const call of each('useCorrectionRequests')) expect(call).toBe('branch-baharu');
    for (const call of each('useRosterRange')) expect(call).toBe('branch-baharu');
    for (const call of each('useAttendancePolicy')) expect(call).toBe('branch-baharu');
  });
});

describe('the branch filter, on the pages beside it', () => {
  it('the HR landing page reads its "leave this week" for the selected branch', () => {
    show(HrOverviewPage);
    for (const call of each('useLeaveRequests')) expect(call).toMatchObject({ clinicId: 'branch-baharu' });
    for (const call of each('useWorkforceToday')) expect(call).toBe('branch-baharu');
    for (const call of each('useEmployees')) expect(call).toMatchObject({ clinicId: 'branch-baharu' });
  });

  it('Locum sessions and the payable summary are the selected branch’s', () => {
    show(LocumPage);
    for (const call of each('useLocumSessions')) expect(call).toMatchObject({ clinicId: 'branch-baharu' });
    for (const call of each('useLocumPayable')) expect(call).toMatchObject({ clinicId: 'branch-baharu' });
  });

  it('the opening year-to-date import lists the selected branch’s employees', () => {
    show(YtdOpeningImportPage);
    for (const call of each('useEmployees')) expect(call).toMatchObject({ clinicId: 'branch-baharu' });
  });

  it('the claims report is asked for the selected branch', () => {
    show(PayrollReportsPage, '/admin/hr/reports?report=CLAIMS');
    for (const call of each('usePayrollClaimsReport')) expect(call).toMatchObject({ clinicId: 'branch-baharu' });
  });

  it('the year-to-date report is asked for the selected branch', () => {
    show(PayrollReportsPage, '/admin/hr/reports?report=YTD');
    for (const call of each('usePayrollYtdReport')) expect(call).toMatchObject({ clinicId: 'branch-baharu' });
  });
});
