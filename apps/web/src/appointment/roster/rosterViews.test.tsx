// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { RosterMatrix, RosterRow } from '../hooks/useRoster';

/*
 * ROSTER VIEWS (UAT, 14 October 2026): a monthly doctor view, a weekly staff
 * view from the branch's own week start, and on duty today. Demo people only.
 */
const row = (staffId: string, fullName: string, category: RosterRow['category'], dates: string[]): RosterRow =>
  ({
    staffId,
    fullName,
    category,
    role: category === 'DOCTOR' ? 'DOCTOR_RESIDENT' : 'FRONT_DESK_CLINICAL_STAFF',
    bookable: category === 'DOCTOR',
    scheduleMode: 'ROSTER_LINKED',
    modeChange: null,
    modeToday: 'ROSTER_LINKED',
    upcomingChanges: [],
    calendarColor: null,
    cells: Object.fromEntries(dates.map((date) => [date, { date, shifts: [], leave: null }])),
  }) as RosterRow;
const WEEK = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
const matrix = (dates: string[]): RosterMatrix => ({
  clinicId: 'c1',
  month: '2026-11',
  timeZone: 'Asia/Kuala_Lumpur',
  dates,
  closedDates: {},
  categoryCounts: { DOCTOR: 1, CLINICAL: 1, ADMIN: 0, MANAGEMENT: 0, OTHER: 0 },
  providers: [row('d1', 'Dr Demo Bulan', 'DOCTOR', dates), row('s1', 'Demo Staf Minggu', 'CLINICAL', dates)],
  weekStartDay: 0,
  openingHours: { open24Hours: true, openTime: null, closeTime: null },
});
const { calls } = vi.hoisted(() => ({ calls: { month: [] as unknown[][], week: [] as unknown[][] } }));

vi.mock('../hooks/useRoster', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useRoster')>()),
  useRosterMonth: (...args: unknown[]) => {
    calls.month.push(args);
    return { data: args[3] === false ? undefined : matrix(WEEK), isFetching: false };
  },
  useRosterWeek: (...args: unknown[]) => {
    calls.week.push(args);
    return { data: args[2] ? matrix(WEEK) : undefined, isFetching: false };
  },
  useShiftTemplates: () => ({ data: [] }),
}));
vi.mock('../../admin/hooks/useAdmin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../admin/hooks/useAdmin')>()),
  useWorkforceToday: () => ({
    data: {
      date: '2026-11-04',
      scheduled: [
        { staffId: 'd1', name: 'Dr Demo Malam', startAt: '2026-11-03T15:00:00.000Z', endAt: '2026-11-04T01:00:00.000Z', group: 'DOCTOR', fromYesterday: true, clockedIn: true, template: { name: 'Night', colour: '#123456' } },
        { staffId: 's1', name: 'Demo Staf Pagi', startAt: '2099-11-04T00:00:00.000Z', endAt: '2099-11-04T07:00:00.000Z', group: 'STAFF', clockedIn: false },
      ],
    },
    isError: false,
  }),
}));
vi.mock('../../core/hooks/useCan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/hooks/useCan')>()),
  useCan: () => true,
}));

const { RosterPage } = await import('./RosterPage');
const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <App>
          <RosterPage clinicId="c1" />
        </App>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('roster views', () => {
  it('marks the branch week start, not a fixed weekend, and shows the opening hours', () => {
    mount();
    const heads = screen.getAllByRole('columnheader').filter((cell) => cell.hasAttribute('data-week-start'));
    expect(heads.map((cell) => cell.textContent)).toEqual(['1Su']);
    expect(document.querySelector('[data-weekend]')).toBeNull();
    expect(screen.getByText('Open 24 hours')).toBeTruthy();
  });

  it('the staff week leaves the doctors out; the doctor month asks for doctors only', () => {
    mount();
    fireEvent.click(screen.getByText('Staff · week'));
    expect(calls.week[calls.week.length - 1]?.[2]).toBe(true);
    expect(screen.queryByText('Dr Demo Bulan')).toBeNull();
    expect(screen.getByText('Demo Staf Minggu')).toBeTruthy();
    expect(screen.getByText('1 Nov – 7 Nov 2026')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Copy last month/ })).toBeNull();

    fireEvent.click(screen.getByText('Doctors · month'));
    expect(calls.month[calls.month.length - 1]?.[2]).toBe('DOCTOR');
  });

  it('on duty today lists doctors and staff with where they are', () => {
    mount();
    fireEvent.click(screen.getByText('On duty today'));
    const doctors = screen.getByRole('region', { name: 'Doctors' });
    expect(within(doctors).getByText('Dr Demo Malam')).toBeTruthy();
    expect(within(doctors).getByText(/Night ·.*\(from yesterday\)/)).toBeTruthy();
    expect(within(doctors).getByText('In')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Staff' })).getByText(/^Due/)).toBeTruthy();
  });
});
