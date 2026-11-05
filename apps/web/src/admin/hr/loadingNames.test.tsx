// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

/*
 * WHILE THE STAFF LIST IS LOADING (Payroll A–Z guide, issue 12) a rostered
 * person's name is unknown, not missing.
 */
const clockStaff = vi.fn().mockResolvedValue({});

vi.mock('../hooks/useAdmin', () => ({
  useTimesheet: () => ({ data: { from: '', to: '', staff: [] }, isLoading: false, isError: false }),
  useCorrectionRequests: () => ({ data: [], isLoading: false }),
  useDecideCorrection: () => ({ mutate: vi.fn(), isPending: false }),
  useApproveOvertime: () => ({ mutate: vi.fn(), isPending: false }),
  useCorrectAttendance: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useClockStaff: () => ({ mutateAsync: clockStaff, isPending: false }),
  useAttendancePolicy: () => ({ data: undefined }),
  useEmployees: () => ({ data: undefined, isLoading: true }),
}));
vi.mock('../../core/hooks/useClinicFilter', () => ({
  useClinicFilter: () => ({ clinicId: 'c1', setClinicId: vi.fn(), clinics: [], showSelector: false }),
}));
vi.mock('../../appointment/hooks/useRoster', () => ({
  useRosterRange: () => ({ data: [{ staffId: 'nurse', startsAt: '2026-11-02T00:00:00.000Z', endsAt: '2026-11-02T09:00:00.000Z' }] }),
}));
vi.mock('../../hr/hooks/useLeaveRequests', () => ({ useLeaveRequests: () => ({ data: [] }) }));
vi.mock('../../core/api-client', () => ({ fetchBlobUrl: vi.fn() }));

const { TimesheetPage } = await import('./TimesheetPage');

describe('a rostered person while the staff list loads', () => {
  it('reads "Loading…", never "Not on the employee list"', async () => {
    render(
      <AntApp>
        <MemoryRouter initialEntries={['/admin/hr/attendance']}>
          <TimesheetPage />
        </MemoryRouter>
      </AntApp>,
    );
    expect((await screen.findAllByText('Loading…')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Not on the employee list')).toBeNull();
  });
});
