// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SalaryHistoryRow } from '../types';

/**
 * THE SHAPE THE SERVER VALIDATES.
 *
 * `RecordSalaryDto.amount` is a STRING checked against
 * /^\d{1,10}(\.\d{1,2})?$/. The first version of this panel sent
 * `Number(amount)`, so class-validator rejected every save with "amount must
 * be a positive number with at most two decimal places" — the form could not
 * succeed once. It was found by looking at a screenshot of it failing, which
 * is what a visual UAT is for; this is so it cannot come back silently.
 */
const HISTORY: SalaryHistoryRow[] = [
  {
    id: 's1',
    basis: 'MONTHLY',
    amount: '3200.00',
    effectiveFrom: '2026-03-05',
    effectiveTo: null,
    reason: 'Annual review',
    note: null,
    recordedBy: 'Dr Aisyah Rahman',
    recordedAt: '2026-03-05T00:00:00.000Z',
    current: true,
  },
];

const mutateAsync = vi.fn().mockResolvedValue({});

vi.mock('../hooks/useAdmin', () => ({
  useSalaryHistory: () => ({ data: HISTORY, isLoading: false }),
  useRecordSalary: () => ({ mutateAsync, isPending: false }),
  useCorrectSalary: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSalary: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true }));

import { EmployeeSalaryPanel } from './EmployeeSalaryPanel';

function open() {
  render(<EmployeeSalaryPanel staffId="staff-1" canSeePay />);
  fireEvent.click(screen.getByRole('button', { name: /Change salary/ }));
}

/** The modal holds the amount input and the date picker; the amount is first. */
function amountField() {
  return screen.getAllByRole('textbox')[0];
}

describe('recording a salary change', () => {
  it('sends the amount as a string in the shape the DTO matches', async () => {
    mutateAsync.mockClear();
    open();
    fireEvent.change(amountField(), { target: { value: '3600.50' } });
    fireEvent.click(screen.getByRole('button', { name: /^Record$/ }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const sent = mutateAsync.mock.calls[0][0];
    expect(typeof sent.amount).toBe('string');
    expect(sent.amount).toBe('3600.50');
    expect(sent.amount).toMatch(/^\d{1,10}(\.\d{1,2})?$/);
  });

  it('strips the currency prefix and thousands separators a person will type', async () => {
    mutateAsync.mockClear();
    open();
    fireEvent.change(amountField(), { target: { value: 'RM 12,000' } });
    fireEvent.click(screen.getByRole('button', { name: /^Record$/ }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0][0].amount).toBe('12000');
  });

  it('refuses three decimal places on the page, rather than sending them to be rejected', async () => {
    mutateAsync.mockClear();
    open();
    fireEvent.change(amountField(), { target: { value: '3600.505' } });
    fireEvent.click(screen.getByRole('button', { name: /^Record$/ }));

    expect(await screen.findByText(/at most two decimal places/i)).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('names the row in force rather than leaving the reader to compare dates', () => {
    render(<EmployeeSalaryPanel staffId="staff-1" canSeePay />);
    // The row in force carries the word, as a chip beside its date; the
    // figure sits under a "Basic (RM)" header, so the prefix is the column's.
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.getAllByText('3,200.00').length).toBeGreaterThanOrEqual(1);
  });

  it('says the salary is not shown rather than showing a blank, when pay is not visible', () => {
    render(<EmployeeSalaryPanel staffId="staff-1" canSeePay={false} />);
    // "There is nothing on file" and "you may not see this" are different
    // sentences, and this screen must never render them the same way.
    expect(screen.getByText(/which this account does not have/i)).toBeTruthy();
  });
});
