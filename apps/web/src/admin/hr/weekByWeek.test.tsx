// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PayrollWeek } from '../types';

/*
 * WEEK BY WEEK ON THE PAYROLL PAGE (Section C, 14 October 2026): one row per
 * week that ended last month, the hours counted against the normal, the
 * overtime and the pay, with the week's notes underneath. Demo figures.
 */
const week = (weekStart: string, weekEnd: string, overtimeMinutes: number, notes: string[] = []): PayrollWeek => ({
  id: weekStart,
  weekStart,
  weekEnd,
  amount: '0',
  working: {
    group: 'STAFF',
    basis: 'ACT',
    normalMinutes: 2700,
    countedMinutes: 2880,
    dailyOvertimeMinutes: overtimeMinutes,
    weeklyOvertimeMinutes: 0,
    overtimeMinutes,
    locumMinutes: 0,
    holidayLocum: [],
    nights: [],
    notes,
    pay: { overtimeCents: overtimeMinutes * 33, locumCents: 0, holidayCents: 0, nightCents: 0 },
  },
});

const WEEKS = [week('2026-09-07', '2026-09-13', 180, ['Test Holiday (2026-09-16) takes one normal day off the week.']), week('2026-09-14', '2026-09-20', 0)];
vi.mock('../hooks/useAdmin', () => ({ usePayrollWeeks: () => ({ data: WEEKS }) }));

import { WeekByWeek } from './WeekByWeek';

describe('WeekByWeek', () => {
  it('shows each week, its overtime and pay, and the notes', () => {
    render(<WeekByWeek runId="run-1" staffId="staff-1" />);
    const panel = screen.getByTestId('week-by-week');
    expect(within(panel).getByText(/Employment Act basis/)).toBeTruthy();
    const first = within(panel).getByText('7 Sep – 13 Sep').closest('tr') as HTMLElement;
    expect(within(first).getByText('3 h (3 h past the day)')).toBeTruthy();
    expect(within(first).getByText('RM 59.40')).toBeTruthy();
    expect(within(panel).getByText(/takes one normal day off the week/)).toBeTruthy();
  });
});
