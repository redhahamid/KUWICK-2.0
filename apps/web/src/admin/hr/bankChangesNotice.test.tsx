// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { describe, expect, it, vi } from 'vitest';

const decide = vi.fn();
vi.mock('../hooks/useAdmin', () => ({
  useBankChanges: () => ({
    data: [
      {
        id: 'b1',
        staffId: 's1',
        name: 'Demo Staf Satu',
        requestedAt: '2026-10-14T08:00:00.000Z',
        next: { bankName: 'Demo Bank', bankAccountNo: '1234567890', bankAccountName: 'Demo Staf Satu' },
        current: null,
        proofPath: null,
      },
    ],
  }),
  useDecideBankChange: () => ({ mutate: decide, isPending: false }),
}));

const { BankChangesNotice } = await import('./BankChangesNotice');

describe('new bank accounts from My Kuwick (testing, 15 October 2026)', () => {
  it('says how many wait, shows the new account and approves it', () => {
    render(
      <AntApp>
        <BankChangesNotice />
      </AntApp>,
    );
    expect(screen.getByTestId('bank-changes-notice').textContent).toContain('1 new bank account is waiting');
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(screen.getByText(/Demo Bank 1234567890/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(decide.mock.calls[0][0]).toMatchObject({ id: 'b1', approve: true });
  });
});
