// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { TimesheetReport } from '../types';

/*
 * FINDING 1 OF THE SEPTEMBER UAT: on the Monthly summary the owner pressed
 * `88.0 h` against Dr Meera Kaur and NOTHING HAPPENED.
 *
 * Piece 1 had turned every figure on that tab into a link to
 * `/admin/hr/attendance?staffId=…&month=…` and stopped there. That route is
 * the attendance page itself: the URL changed, the component stayed mounted
 * with its tab and month in local state, and the screen did not move. A link
 * that goes nowhere is worse than the dead end it replaced — it looks like it
 * works.
 *
 * This is the guard for the other half: arriving with a person in the URL
 * shows that person's month.
 */
const day = (over: Partial<TimesheetReport['staff'][number]['days'][number]> = {}) => ({
  id: 'd1',
  workDate: '2026-09-13',
  clockInAt: '2026-09-13T11:45:00.000Z',
  clockOutAt: '2026-09-13T11:48:00.000Z',
  scheduledStart: null,
  scheduledEnd: null,
  status: 'PRESENT',
  lateMinutes: 0,
  earlyOutMinutes: 0,
  workedMinutes: 2,
  overtimeMinutes: 0,
  overtimeApproved: false,
  corrected: false,
  correctionReason: null,
  source: 'PORTAL' as const,
  proofUrl: null,
  clockOutProofUrl: null,
  outsideClinic: false,
  distanceMetres: null,
  punches: [],
  ...over,
});

const report: TimesheetReport = {
  from: '2026-09-01',
  to: '2026-09-30',
  staff: [
    {
      staffId: 'staff-meera',
      name: 'Dr Meera Kaur',
      daysPresent: 2,
      daysAbsent: 0,
      daysOnLeave: 0,
      daysMissingPunch: 0,
      workedMinutes: 5282,
      lateMinutes: 0,
      lateOccasions: 0,
      approvedOvertimeMinutes: 0,
      unapprovedOvertimeMinutes: 90,
      workedHours: 88.03,
      approvedOvertimeHours: 0,
      unapprovedOvertimeHours: 1.5,
      days: [
        day({ id: 'd-late', workDate: '2026-09-14', workedMinutes: 5280, overtimeMinutes: 90 }),
        day(),
      ],
    },
    {
      staffId: 'staff-hafiz',
      name: 'Hafiz Osman',
      daysPresent: 1,
      daysAbsent: 0,
      daysOnLeave: 0,
      daysMissingPunch: 0,
      workedMinutes: 468,
      lateMinutes: 0,
      lateOccasions: 0,
      approvedOvertimeMinutes: 0,
      unapprovedOvertimeMinutes: 0,
      workedHours: 7.8,
      approvedOvertimeHours: 0,
      unapprovedOvertimeHours: 0,
      days: [day({ id: 'd-h', workDate: '2026-09-13', workedMinutes: 468 })],
    },
  ],
};

const approveMutate = vi.fn();

vi.mock('../hooks/useAdmin', () => ({
  useTimesheet: () => ({ data: report, isLoading: false, isError: false }),
  useCorrectionRequests: () => ({ data: [], isLoading: false }),
  useDecideCorrection: () => ({ mutate: vi.fn(), isPending: false }),
  useApproveOvertime: () => ({ mutate: approveMutate, isPending: false }),
  useCorrectAttendance: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useClockStaff: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAttendancePolicy: () => ({ data: undefined }),
  useEmployees: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../core/hooks/useClinicFilter', () => ({
  useClinicFilter: () => ({ clinicId: 'c1', setClinicId: vi.fn(), clinics: [], showSelector: false }),
}));
vi.mock('../../appointment/hooks/useRoster', () => ({ useRosterRange: () => ({ data: [] }) }));
vi.mock('../../hr/hooks/useLeaveRequests', () => ({ useLeaveRequests: () => ({ data: [] }) }));
vi.mock('../../core/api-client', () => ({ fetchBlobUrl: vi.fn().mockResolvedValue('blob:selfie') }));

const { TimesheetPage } = await import('./TimesheetPage');

const at = (url: string) =>
  render(
    <AntApp>
      <MemoryRouter initialEntries={[url]}>
        <TimesheetPage />
      </MemoryRouter>
    </AntApp>,
  );

describe('a figure on the Monthly summary opens the month behind it', () => {
  it('arrives on ONE person, not on everybody', async () => {
    at('/admin/hr/attendance?staffId=staff-meera&month=2026-09');

    // The person asked for, named on the screen so the reader knows whose
    // month they are looking at.
    await waitFor(() => expect(screen.getByText(/Dr Meera Kaur · September 2026/)).toBeTruthy());
    // And NOT the other people in the same month's report.
    expect(screen.queryByText('Hafiz Osman')).toBeNull();
  });

  it('lists the days the figure is made of', async () => {
    at('/admin/hr/attendance?staffId=staff-meera&month=2026-09');
    await waitFor(() => expect(screen.getByText(/Dr Meera Kaur ·/)).toBeTruthy());

    expect(screen.getByText('Sun 13 Sep')).toBeTruthy();
    expect(screen.getByText('Mon 14 Sep')).toBeTruthy();
  });

  it('carries the overtime decision to where the days are, not back to the day sheet', async () => {
    at('/admin/hr/attendance?staffId=staff-meera&month=2026-09');
    await waitFor(() => expect(screen.getByText(/Dr Meera Kaur ·/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(approveMutate).toHaveBeenCalledWith({ id: 'd-late' }, expect.anything());
  });

  it('offers the way back out', async () => {
    at('/admin/hr/attendance?staffId=staff-meera&month=2026-09');
    await waitFor(() => expect(screen.getByText(/Dr Meera Kaur ·/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Back to everybody' }));
    await waitFor(() => expect(screen.getByText('Hafiz Osman')).toBeTruthy());
  });

  it('leaves the person behind when a tab is pressed', async () => {
    at('/admin/hr/attendance?staffId=staff-meera&month=2026-09');
    await waitFor(() => expect(screen.getByText(/Dr Meera Kaur ·/)).toBeTruthy());

    // Pressing the tab you are already on must still mean "show me everybody",
    // or the tab looks broken in exactly the way this piece is fixing.
    fireEvent.click(screen.getByRole('tab', { name: /Monthly summary/ }));
    await waitFor(() => expect(screen.getByText('Hafiz Osman')).toBeTruthy());
    expect(screen.queryByText(/Back to everybody/)).toBeNull();
  });

  it('shows the whole clinic when no one person is asked for', async () => {
    at('/admin/hr/attendance');
    // The day sheet is the landing tab, so the summary is not on screen and
    // nobody's month is focused.
    expect(screen.queryByText(/Back to everybody/)).toBeNull();
  });
});

/*
 * FINDING 2: the same two-minute day read 0.03 h in the portal and 0.0 h here.
 * The figure the owner sees on a person's month is now the shared one.
 */
describe('the hours are the same figure everywhere', () => {
  it('never reports a worked day as 0.0 h', async () => {
    at('/admin/hr/attendance?staffId=staff-meera&month=2026-09');
    await waitFor(() => expect(screen.getByText(/Dr Meera Kaur ·/)).toBeTruthy());

    // Two one-minute pairs. One decimal cannot carry it, so it is not asked to.
    expect(screen.getByText('2 min')).toBeTruthy();
    expect(screen.getByText('88.0 h')).toBeTruthy();
  });
});
