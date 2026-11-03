// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

/*
 * RECORDING A CLOCK-IN FOR A DAY WITH NO PUNCH (Payroll A–Z walk-through,
 * 3 November 2026). The drawer for such a day has a time and no reason box,
 * yet saving demanded a reason, so HR could never record the punch.
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
  useEmployees: () => ({ data: [{ staffId: 'nurse', fullName: 'Demo Nurse' }], isLoading: false }),
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

describe('recording a punch for a rostered day with none', () => {
  it('records the clock-in without asking for a reason it never showed', async () => {
    render(
      <AntApp>
        <MemoryRouter initialEntries={['/admin/hr/attendance']}>
          <TimesheetPage />
        </MemoryRouter>
      </AntApp>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Fix/ }));
    expect(screen.queryByLabelText('Why')).toBeNull();
    fireEvent.change(screen.getByLabelText('Clock in'), { target: { value: '08:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record the clock-in' }));
    await waitFor(() => expect(clockStaff).toHaveBeenCalledWith(expect.objectContaining({ staffId: 'nurse', clinicId: 'c1', at: expect.any(String) })));
  });
});
