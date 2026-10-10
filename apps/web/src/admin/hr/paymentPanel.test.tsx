// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import type { PayDateChoiceRow, PaymentBatch, PaymentStatus } from '../types';

/*
 * PAYING A MONTH ON THREE DATES (UAT, 10 October 2026): one listing and one
 * recorded transfer per pay date, the salary's marked, and a month paid on one
 * date looking exactly as it did.
 */
const recordMutate = vi.fn();
const chooseMutate = vi.fn();
let served: PaymentStatus;

vi.mock('../hooks/useAdmin', () => ({
  usePaymentStatus: () => ({ data: served, refetch: vi.fn() }),
  usePreparePayment: () => ({ mutate: vi.fn(), isPending: false }),
  useRecordPaymentPaid: () => ({ mutate: recordMutate, isPending: false }),
  useChoosePayDate: () => ({ mutate: chooseMutate, isPending: false }),
}));

const { PaymentPanel } = await import('./PaymentPanel');

const batch = (payDate: string | null, over: Partial<PaymentBatch> = {}): PaymentBatch => ({
  id: `b-${payDate ?? 'month'}`,
  payDate,
  carriesSalary: payDate === '2026-10-30' || payDate === null,
  version: 1,
  status: 'GENERATED',
  snapshotVersion: 1,
  totalCents: 100_000,
  includedCount: 1,
  excludedCount: 0,
  createdBy: 'Dr Demo Owner',
  createdAt: '2026-10-29T00:00:00.000Z',
  downloadedAt: null,
  paidRecordedAt: null,
  paymentDate: null,
  paymentReference: null,
  lines: [{ staffId: 's1', name: 'Demo Resident', bankName: 'Maybank', accountEnding: '8901', amountCents: 100_000, included: true, exclusionReason: null }],
  ...over,
});

const mount = (status: PaymentStatus) => {
  served = status;
  return render(
    <AntApp>
      <PaymentPanel runId="run-1" />
    </AntApp>,
  );
};

describe('paying a month on its pay dates', () => {
  it('shows one listing per date, says which carries the salary, and records the date it was asked to', () => {
    recordMutate.mockReset();
    const batches = [
      batch('2026-10-30', { status: 'RECORDED_PAID', paymentDate: '2026-10-30', paymentReference: 'IBG-1030' }),
      batch('2026-11-01', { totalCents: 50_000 }),
      batch('2026-11-15', { totalCents: 42_000 }),
    ];
    mount({
      runStatus: 'APPROVED',
      runPaidAt: null,
      mayPrepare: true,
      schedule: batches.map((entry) => ({ payDate: entry.payDate, totalCents: entry.totalCents, people: 1 })),
      salaryDate: '2026-10-30',
      batches,
      batch: batches[0],
    });

    expect(screen.getByTestId('pay-schedule')).toHaveTextContent('This month is paid on 3 dates');
    expect(within(screen.getByTestId('pay-date-2026-10-30')).getByRole('heading')).toHaveTextContent('Paid on 30 Oct 2026 · the salary');
    expect(within(screen.getByTestId('pay-date-2026-10-30')).getByText(/Transfer recorded on 30 Oct 2026 — IBG-1030/)).toBeTruthy();
    expect(within(screen.getByTestId('pay-date-2026-10-30')).queryByRole('button', { name: 'Record the transfer' })).toBeNull();

    const fifteenth = screen.getByTestId('pay-date-2026-11-15');
    expect(within(fifteenth).getByRole('heading')).toHaveTextContent('Paid on 15 Nov 2026');
    fireEvent.click(within(fifteenth).getByRole('button', { name: 'Record the transfer' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Record the transfer for 15 Nov 2026');
    fireEvent.change(within(dialog).getByPlaceholderText(/IBG-/), { target: { value: 'IBG-1115' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record it' }));
    expect(recordMutate).toHaveBeenCalledTimes(1);
    expect(recordMutate.mock.calls[0][0]).toMatchObject({ runId: 'run-1', payDate: '2026-11-15', reference: 'IBG-1115' });
  });

  it('looks as it always did for a month paid on one date', () => {
    const only = batch(null);
    mount({ runStatus: 'APPROVED', runPaidAt: null, mayPrepare: true, schedule: [{ payDate: null, totalCents: 100_000, people: 1 }], salaryDate: null, batches: [only], batch: only });
    expect(screen.queryByTestId('pay-schedule')).toBeNull();
    expect(screen.queryByRole('heading', { name: /Paid on/ })).toBeNull();
    expect(screen.getByText(/Batch total/)).toBeTruthy();
  });
});

/*
 * THE OWNER'S DATES FOR ONE RUN (UAT, 10 October 2026): an item's "Paid on"
 * is only the default; the owner changes it here, for this run, until its
 * listing is prepared.
 */
describe('choosing the pay dates for one run', () => {
  const row = (defaultDate: string, over: Partial<PayDateChoiceRow> = {}): PayDateChoiceRow => ({
    defaultDate,
    payDate: defaultDate,
    items: ['Basic salary'],
    totalCents: 100_000,
    locked: false,
    ...over,
  });
  const choosing = (payDates: PayDateChoiceRow[], over: Partial<PaymentStatus> = {}): PaymentStatus => ({
    runStatus: 'APPROVED',
    runPaidAt: null,
    mayPrepare: true,
    mayChooseDates: true,
    payDateRange: { from: '2026-10-01', to: '2026-11-30' },
    payDates,
    schedule: [],
    salaryDate: '2026-10-30',
    batches: [],
    batch: null,
    ...over,
  });

  it('offers a date for each of the record’s dates, sends the one picked, and goes back to the default in one click', async () => {
    chooseMutate.mockReset();
    mount(
      choosing([
        row('2026-10-01', { items: ["Director's fee (September 2026)"], totalCents: 300_000 }),
        row('2026-10-15', { payDate: '2026-10-16', items: ['Overtime (September 2026)', 'Claim reimbursement'], totalCents: 42_000 }),
        row('2026-10-30'),
      ]),
    );
    const block = screen.getByTestId('run-pay-dates');
    expect(within(block).getByRole('heading')).toHaveTextContent('Pay dates for this run');
    expect(block).toHaveTextContent("Director's fee (September 2026)");
    expect(block).toHaveTextContent('Overtime (September 2026) · Claim reimbursement');

    const first = screen.getByLabelText('Pay on, for what is due 1 Oct 2026');
    fireEvent.mouseDown(first);
    fireEvent.change(first, { target: { value: '3 Oct 2026' } });
    fireEvent.keyDown(first, { key: 'Enter', keyCode: 13 });
    await waitFor(() => expect(chooseMutate).toHaveBeenCalled());
    expect(chooseMutate.mock.calls[0][0]).toEqual({ runId: 'run-1', defaultDate: '2026-10-01', payDate: '2026-10-03' });

    const fifteenth = screen.getByTestId('run-pay-date-2026-10-15');
    expect(fifteenth).toHaveTextContent('Changed for this run.');
    fireEvent.click(within(fifteenth).getByRole('button', { name: 'Back to 15 Oct 2026' }));
    expect(chooseMutate.mock.calls[1][0]).toEqual({ runId: 'run-1', defaultDate: '2026-10-15', payDate: '2026-10-15' });
  });

  it('keeps a date whose listing is prepared, asks whether a date that has passed was already paid, and offers nothing once every date stands', () => {
    const some = mount(choosing([row('2020-01-01'), row('2026-10-30', { locked: true })], { payDateRange: { from: '2020-01-01', to: '2020-02-29' } }));
    expect(screen.getByTestId('run-pay-date-2026-10-30')).toHaveTextContent('30 Oct 2026 · listing prepared');
    expect(screen.queryByLabelText('Pay on, for what is due 30 Oct 2026')).toBeNull();
    expect(screen.getByTestId('run-pay-date-2020-01-01')).toHaveTextContent('Already paid on 1 Jan? Record the transfer with that date.');
    // A hint only: the date can still be changed.
    expect(screen.getByLabelText('Pay on, for what is due 1 Jan 2020')).toBeEnabled();
    some.unmount();

    const every = mount(choosing([row('2026-10-30', { locked: true })]));
    expect(screen.queryByTestId('run-pay-dates')).toBeNull();
    every.unmount();
    mount(choosing([row('2026-10-30')], { mayChooseDates: false }));
    expect(screen.queryByTestId('run-pay-dates')).toBeNull();
  });
});
