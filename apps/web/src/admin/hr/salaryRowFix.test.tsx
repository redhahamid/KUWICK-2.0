// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalaryHistoryRow } from '../types';

/*
 * CORRECT AND DELETE ON A SALARY ROW (UAT, 14 October 2026), the real case
 * with demo people: 1 Jan 2026 RM1,900; 1 Jun 2026 RM2,000 keyed instead of
 * RM2,100; 1 Nov 2026 RM2,100 added by mistake. A reason is required, and the
 * server's refusal naming the approved month is shown as it is.
 */
const row = (id: string, amount: string, effectiveFrom: string, effectiveTo: string | null): SalaryHistoryRow => ({
  id,
  basis: 'MONTHLY',
  amount,
  effectiveFrom,
  effectiveTo,
  reason: 'Increment',
  note: null,
  recordedBy: 'Demo Owner',
  recordedAt: '2026-10-01T00:00:00.000Z',
  current: effectiveTo === null,
});
const HISTORY = [row('nov', '2100.00', '2026-11-01', null), row('jun', '2000.00', '2026-06-01', '2026-10-31'), row('jan', '1900.00', '2026-01-01', '2026-05-31')];

const { correct, remove, can } = vi.hoisted(() => ({ correct: vi.fn(), remove: vi.fn(), can: { pay: true } }));
vi.mock('../hooks/useAdmin', () => ({
  useSalaryHistory: () => ({ data: HISTORY, isLoading: false }),
  useRecordSalary: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCorrectSalary: () => ({ mutateAsync: correct, isPending: false }),
  useDeleteSalary: () => ({ mutateAsync: remove, isPending: false }),
}));
vi.mock('../../core/hooks/useCan', () => ({ useCan: (permission: string) => (permission === 'hr.payroll.view' ? can.pay : true) }));

import { EmployeeSalaryPanel } from './EmployeeSalaryPanel';

const rowOf = (day: string) => screen.getByText(day).closest('tr') as HTMLElement;
const last = (name: RegExp) => screen.getAllByRole('button', { name }).slice(-1)[0];
const mount = () => {
  render(<EmployeeSalaryPanel staffId="staff-42" canSeePay />);
  fireEvent.click(screen.getByRole('button', { name: /History/ }));
};

describe('correcting and deleting a salary row', () => {
  beforeEach(() => {
    correct.mockReset();
    remove.mockReset();
    can.pay = true;
    // The day of the report: June is in force, November is still to come.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T03:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('shows the row in force today without opening History, though a later row is recorded', () => {
    render(<EmployeeSalaryPanel staffId="staff-42" canSeePay />);
    expect(within(rowOf('1 Jun 2026')).getByText('Current')).toBeTruthy();
    expect(within(rowOf('1 Nov 2026')).getByText('Upcoming')).toBeTruthy();
    expect(screen.queryByText('1 Jan 2026')).toBeNull();
  });

  it('corrects the June row with a reason, and shows the refusal naming the approved month', async () => {
    mount();
    fireEvent.click(within(rowOf('1 Jun 2026')).getByRole('button', { name: 'Correct' }));
    expect(screen.getByText('Correct the salary from 1 Jun 2026')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Correct amount'), { target: { value: '2,100' } });
    // The modal's own button is the last "Correct" on the page.
    fireEvent.click(last(/^Correct$/));
    expect(await screen.findByText(/Say why/)).toBeTruthy();
    expect(correct).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Keying error: RM2,100 agreed' } });
    correct.mockRejectedValueOnce(new Error('Jun 2026 is approved for this employee and paid from this salary row. Nothing was changed. Reopen that month and then correct the row.'));
    fireEvent.click(last(/^Correct$/));
    await waitFor(() =>
      expect(correct).toHaveBeenCalledWith({ staffId: 'staff-42', id: 'jun', amount: '2100', basis: 'MONTHLY', reason: 'Keying error: RM2,100 agreed' }),
    );
    expect(await screen.findByText(/Jun 2026 is approved for this employee/)).toBeTruthy();
  });

  it('deletes the November row, saying the June figure runs on', async () => {
    mount();
    fireEvent.click(within(rowOf('1 Nov 2026')).getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/RM\s?2,000\.00 per month, from 1 Jun 2026, then runs on with no end date/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Added by mistake' } });
    remove.mockResolvedValueOnce({});
    fireEvent.click(last(/^Delete$/));
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ staffId: 'staff-42', id: 'nov', reason: 'Added by mistake' }));
  });

  it('offers neither to somebody without payroll access', () => {
    can.pay = false;
    mount();
    expect(screen.queryByRole('button', { name: 'Correct' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
