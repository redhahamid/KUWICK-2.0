// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE BRANCH FILTER REACHES THE QUERY, NOT JUST THE SCREEN.
 *
 * Leave and Claims both fetched the whole tenant and then rendered it: their
 * list hooks were called with no branch at all, so switching to a newly
 * created branch with nobody in it still listed other branches' staff, while
 * Employees, Attendance, Payroll and Reports all correctly showed nothing.
 *
 * The lists ARE the summary cards and the tab filters on both screens — every
 * count and every tab reads the same rows — so a branch applied after the
 * fetch would still have the server sending other branches' people down the
 * wire. These cases pin the branch onto the QUERY, which is the only place it
 * settles all three at once.
 */
const leaveCalls: unknown[] = [];
const claimCalls: unknown[] = [];
const employeeCalls: unknown[] = [];
const benefitCalls: unknown[] = [];
const balanceCalls: unknown[] = [];

const idle = { data: undefined, isLoading: false, isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() };

vi.mock('../hooks/useAdmin', () => ({
  useEmployees: (params: unknown) => {
    employeeCalls.push(params);
    return { data: [], isLoading: false };
  },
  useStaffClaims: (params: unknown) => {
    claimCalls.push(params);
    return { data: [], isLoading: false };
  },
  useLeaveBalances: (params: unknown) => {
    balanceCalls.push(params);
    return { data: [], isLoading: false };
  },
  useStaffBenefits: (params: unknown) => {
    benefitCalls.push(params);
    return { data: { accounts: [] }, isLoading: false };
  },
  useDecideStaffClaim: () => idle,
  useSettleStaffClaim: () => idle,
  useStaffClaimHistory: () => ({ data: [] }),
}));

vi.mock('../../hr/hooks/useLeaveRequests', () => ({
  useLeaveRequests: (params: unknown) => {
    leaveCalls.push(params);
    return { data: [], isLoading: false };
  },
  useCreateLeaveRequest: () => idle,
  useApproveLeaveRequest: () => idle,
  useRejectLeaveRequest: () => idle,
}));

vi.mock('../../hr/hooks/useStaff', () => ({ useStaff: () => ({ data: [] }) }));
vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true, permissionHint: () => '' }));
vi.mock('../../core/hooks/useClinicFilter', () => ({
  useClinicFilter: () => ({ clinicId: 'branch-baharu', setClinicId: vi.fn(), clinics: [], showSelector: true }),
}));

const { LeavePage } = await import('./LeavePage');
const { ClaimsPage } = await import('./ClaimsPage');

function show(Page: () => ReactElement) {
  render(
    <AntApp>
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    </AntApp>,
  );
}

beforeEach(() => {
  leaveCalls.length = 0;
  claimCalls.length = 0;
  employeeCalls.length = 0;
  benefitCalls.length = 0;
  balanceCalls.length = 0;
});

describe('the branch filter, on Leave and Claims', () => {
  it('asks the server for the selected branch’s leave, not the whole tenant', () => {
    show(LeavePage);
    expect(leaveCalls.length).toBeGreaterThan(0);
    for (const call of leaveCalls) {
      expect(call).toMatchObject({ clinicId: 'branch-baharu' });
    }
  });

  it('asks the server for the selected branch’s claims, not the whole tenant', () => {
    show(ClaimsPage);
    expect(claimCalls.length).toBeGreaterThan(0);
    for (const call of claimCalls) {
      expect(call).toMatchObject({ clinicId: 'branch-baharu' });
    }
  });

  /*
   * The job titles beside the rows come from the employee list. Left
   * unscoped it fetched every employee in the tenant to label a handful of
   * rows — and on a branch with nobody in it, to label none.
   */
  it('scopes the job-title lookup each page reads beside its rows', () => {
    show(LeavePage);
    show(ClaimsPage);
    expect(employeeCalls.length).toBeGreaterThan(0);
    for (const call of employeeCalls) {
      expect(call).toMatchObject({ clinicId: 'branch-baharu' });
    }
  });

  /*
   * These two were already right, and are asserted so a later change to the
   * pages cannot quietly widen them while the two above stay green.
   */
  it('keeps the balances and the benefit allowance on the same branch', () => {
    show(LeavePage);
    show(ClaimsPage);
    for (const call of [...balanceCalls, ...benefitCalls]) {
      expect(call).toMatchObject({ clinicId: 'branch-baharu' });
    }
    expect(balanceCalls.length + benefitCalls.length).toBeGreaterThan(0);
  });
});
