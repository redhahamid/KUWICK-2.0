// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PayrollJourney } from '../types';

/*
 * REOPEN THIS MONTH (UAT, 14 October 2026): on an approved month, for the
 * owner or a payroll approver, with a reason; the server's refusal is shown
 * as it is. Demo data only.
 */
const { mutate, can } = vi.hoisted(() => ({ mutate: vi.fn(), can: { reopen: true, approve: false } }));
vi.mock('../hooks/useAdmin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useAdmin')>()),
  useReopenPayroll: () => ({ mutate, isPending: false }),
}));
vi.mock('../../core/hooks/useCan', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/hooks/useCan')>()),
  useCan: (permission: string) => (permission === 'hr.payroll.reopen' ? can.reopen : permission === 'hr.payroll.approve' ? can.approve : false),
}));

const { ReopenMonth } = await import('./PayrollRunPage');

const journey = (status: string) => ({ run: { status, periodLabel: 'June 2026' } }) as unknown as PayrollJourney;
const mount = (status = 'APPROVED') =>
  render(
    <MemoryRouter>
      <App>
        <ReopenMonth data={journey(status)} runId="run-6" />
      </App>
    </MemoryRouter>,
  );

describe('reopen this month', () => {
  it('asks why, sends the reason, and shows the server’s refusal', async () => {
    can.reopen = true;
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen this month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(await screen.findByText(/Say why this month is being reopened/)).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Opt two doctors out of LINDUNG from 1 Jun 2026' } });
    mutate.mockImplementationOnce((_body: unknown, handlers: { onError: (error: Error) => void }) =>
      handlers.onError(new Error('June 2026 cannot be reopened. July 2026 is already approved')),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith({ id: 'run-6', reason: 'Opt two doctors out of LINDUNG from 1 Jun 2026' }, expect.anything()));
    expect(await screen.findByText(/July 2026 is already approved/)).toBeTruthy();
  });

  it('is offered to a payroll approver too, and not on a draft or to anybody else', () => {
    can.reopen = false;
    can.approve = true;
    const { unmount } = mount();
    expect(screen.getByRole('button', { name: 'Reopen this month' })).toBeTruthy();
    unmount();
    mount('CALCULATED');
    expect(screen.queryByRole('button', { name: 'Reopen this month' })).toBeNull();
    can.approve = false;
    mount();
    expect(screen.queryAllByRole('button', { name: 'Reopen this month' })).toHaveLength(0);
  });
});
