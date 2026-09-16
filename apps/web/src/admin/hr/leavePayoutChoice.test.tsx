// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeavePolicyRow } from '../hooks/useAdmin';

/*
 * THE CHOICE NOT TO PAY UNTAKEN LEAVE, MADE IN FRONT OF THE SECTION IT BREAKS.
 *
 * Section 60E(3) of the Employment Act owes the ordinary rate of pay for every
 * day of paid annual leave the employee was entitled to and had not taken when
 * the contract of service ended — ended by EITHER PARTY, so a resignation
 * counts. A clinic whose staff all resign is not outside it, and that is the
 * sentence this screen exists to put in front of somebody.
 *
 * The clinic may still decide not to pay it. What these tests pin is that the
 * decision cannot be taken quietly: the section is named before Save, the tick
 * and the reason are both required, and the policy carries the mark afterwards.
 * Exactly the shape the below-Act multipliers already use.
 */
const paying: LeavePolicyRow = {
  id: 'p1',
  name: 'Clinic staff',
  active: true,
  carryForwardDays: 3,
  proRateOnJoin: true,
  notes: null,
  employees: 8,
  payUntakenLeaveOnExit: true,
  notPaying: null,
  entitlements: [{ leaveType: 'ANNUAL', daysPerYear: 12, paid: true, requiresAttachment: false }],
};

const withholding: LeavePolicyRow = {
  ...paying,
  id: 'p2',
  name: 'Clinic staff (no payout)',
  payUntakenLeaveOnExit: false,
  notPaying: { reason: 'Clinic practice since 2019', at: '2026-01-05T00:00:00.000Z', by: 'Dr Hamid' },
};

const mutateAsync = vi.fn().mockResolvedValue({ id: 'p1' });
let rows: LeavePolicyRow[] = [paying];

vi.mock('../../core/hooks/useCan', () => ({ useCan: () => true, permissionHint: () => undefined }));
vi.mock('../hooks/useAdmin', () => ({
  useLeavePolicies: () => ({ data: rows, isLoading: false }),
  useSaveLeavePolicy: () => ({ mutateAsync, isPending: false }),
}));

const { LeavePolicyPanel } = await import('./LeavePolicyPanel');

const mount = () =>
  render(
    <MemoryRouter>
      <AntApp>
        <LeavePolicyPanel />
      </AntApp>
    </MemoryRouter>,
  );

beforeEach(() => {
  mutateAsync.mockClear();
  rows = [paying];
});

describe('whether untaken annual leave is paid out when somebody leaves', () => {
  it('shows the Act as the starting position, not the clinic’s current habit', () => {
    mount();
    expect(screen.getByText('Paid out on exit')).toBeTruthy();
    expect(screen.getByText(/Section 60E\(3\)/)).toBeTruthy();
  });

  it('names the section and the resignation point before anything is saved', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Do not pay it out' }));
    expect(screen.getByText(/choosing not to meet section 60E\(3\)/i)).toBeTruthy();
    // The half that catches a clinic whose staff all resign.
    expect(screen.getByText(/covered as much as a dismissal/i)).toBeTruthy();
    expect(screen.getByText(/statutory obligation, not a company benefit/i)).toBeTruthy();
    // Nothing has been sent: the warning comes BEFORE the save, not after it.
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('will not save on a tick alone, nor on a reason alone', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Do not pay it out' }));

    // Neither given.
    fireEvent.click(screen.getByRole('button', { name: 'Save this decision' }));
    expect(await screen.findByText('Confirm that this is deliberate before it is saved.')).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();

    // Tick without a reason.
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save this decision' }));
    expect(await screen.findByText(/Say why\./)).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('sends the tick and the reason together once both are given', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Do not pay it out' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Clinic practice since 2019' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save this decision' }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        id: 'p1',
        name: 'Clinic staff',
        payUntakenLeaveOnExit: false,
        notPayingAcknowledged: true,
        notPayingReason: 'Clinic practice since 2019',
      }),
    );
  });

  it('marks the policy permanently, with who decided and when', () => {
    rows = [withholding];
    mount();
    expect(screen.getByText('Below the Act: not paid out')).toBeTruthy();
    // A name and a date, so somebody opening this screen in a year learns it
    // here rather than from a leaver asking where their money is.
    expect(screen.getByText(/Chosen by Dr Hamid on 5 Jan 2026/)).toBeTruthy();
    expect(screen.getByText(/Clinic practice since 2019/)).toBeTruthy();
  });

  it('offers the way back without asking for a reason to obey the Act', async () => {
    rows = [withholding];
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Pay it out, as the Act requires' }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ id: 'p2', name: 'Clinic staff (no payout)', payUntakenLeaveOnExit: true }),
    );
  });
});
