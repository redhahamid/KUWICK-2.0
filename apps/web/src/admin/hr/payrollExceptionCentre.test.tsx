// @vitest-environment jsdom
import { App } from 'antd';
import { fireEvent, render as renderBare, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PayrollExceptionList, PayrollExceptionRow } from '../types';

/*
 * THE REVIEW, IN THREE PARTS (UAT, 6 October 2026: "cluttered"): one card per
 * kind with the people it applies to, a single "Acknowledge for 2026" for a
 * policy, Needs action / For information / Done, one count, and the long
 * explanation behind Details.
 */
const acknowledgeAll = vi.fn().mockResolvedValue({ acknowledged: 3 });
const override = vi.fn().mockResolvedValue({});
let list: PayrollExceptionList;

vi.mock('../hooks/useAdmin', () => ({
  usePayrollExceptions: () => ({ data: list }),
  useOverrideException: () => ({ mutateAsync: override, isPending: false }),
  useAcknowledgeExceptions: () => ({ mutateAsync: acknowledgeAll, isPending: false }),
}));

const { PayrollExceptionCentre, groupReview } = await import('./PayrollExceptionCentre');

let n = 0;
function row(over: Partial<PayrollExceptionRow>): PayrollExceptionRow {
  n += 1;
  return {
    id: `x-${n}`,
    severity: 'WARNING',
    code: 'MISSING_PUNCH',
    title: 'Missing clock-in or clock-out',
    policy: false,
    staffId: `s-${n}`,
    staffName: `Demo Staff ${n}`,
    cause: 'A long cause sentence that belongs behind Details.',
    consequence: 'A long consequence that belongs behind Details.',
    remediation: 'A long remedy that belongs behind Details.',
    deepLink: '/admin/hr/attendance',
    overridable: true,
    overriddenBy: null,
    overrideReason: null,
    overriddenAt: null,
    ...over,
  };
}
const epf = (name: string, over: Partial<PayrollExceptionRow> = {}) =>
  row({ code: 'EPF_BASIS_DISCREPANCY', title: 'EPF on the employer-selected basis', policy: true, staffName: name, cause: `EPF for ${name} on basic salary only.`, ...over });

const render = (node: React.ReactElement) => renderBare(<App><MemoryRouter>{node}</MemoryRouter></App>);

beforeEach(() => {
  acknowledgeAll.mockClear();
  override.mockClear();
  list = {
    period: '2026-10',
    gate: { canApprove: false, total: 6, blocking: 1, warnings: 4, info: 1, overridden: 0, reason: '' },
    exceptions: [
      row({ severity: 'BLOCKING', code: 'PCB_MISSING', title: 'Monthly tax (PCB) missing', staffName: 'Wan Azman', overridable: false }),
      epf('Puteri Balqis'),
      epf('Hafiz Osman'),
      epf('Nurul Hidayah'),
      row({ severity: 'INFO', code: 'PART_MONTH', title: 'Part of the month only', staffName: 'Chandra Devi', overridable: false }),
      row({ code: 'UNAPPROVED_OVERTIME', title: 'Overtime not approved', staffName: 'Rohana Yusof', overriddenBy: 'Dr Aisyah Rahman', overrideReason: 'Approved verbally', overriddenAt: '2026-10-05T03:00:00.000Z' }),
    ],
  };
});

describe('one card per kind', () => {
  it('groups three staff on the same EPF policy into ONE card with one "Acknowledge for 2026"', () => {
    render(<PayrollExceptionCentre runId="run-1" canOverride />);
    const card = screen.getByTestId('review-card-EPF_BASIS_DISCREPANCY');
    expect(card).toHaveTextContent('EPF on the employer-selected basis · 3 staff: Puteri Balqis, Hafiz Osman, Nurul Hidayah');
    expect(within(card).getAllByRole('button', { name: 'Acknowledge for 2026' })).toHaveLength(1);
    // The per-person explanation is collapsed until asked for.
    expect(within(card).queryByText(/EPF for Puteri Balqis on basic salary only/)).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Details' }));
    expect(within(card).getByText(/EPF for Puteri Balqis on basic salary only/)).toBeInTheDocument();
  });

  it('acknowledges the whole policy with one reason', async () => {
    render(<PayrollExceptionCentre runId="run-1" canOverride />);
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge for 2026' }));
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'Basic-only EPF agreed for 2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(acknowledgeAll).toHaveBeenCalledWith({ runId: 'run-1', code: 'EPF_BASIS_DISCREPANCY', reason: 'Basic-only EPF agreed for 2026' }));
    expect(override).not.toHaveBeenCalled();
  });
});

describe('three parts and one count', () => {
  it('splits Needs action, For information and Done, with Done collapsed', () => {
    render(<PayrollExceptionCentre runId="run-1" canOverride />);
    expect(screen.getByText('4 need action')).toBeInTheDocument();
    expect(screen.getByText('For information · 1')).toBeInTheDocument();
    expect(screen.getByText('Done · 1')).toBeInTheDocument();
    expect(screen.queryByTestId('review-card-UNAPPROVED_OVERTIME')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByTestId('review-card-UNAPPROVED_OVERTIME')).toHaveTextContent(
      'Acknowledged by Dr Aisyah Rahman on 5 Oct 2026: “Approved verbally”',
    );
  });

  it('states the same count in the header and the footer', () => {
    render(<PayrollExceptionCentre runId="run-1" canOverride />);
    expect(screen.getByText('4 need action')).toBeInTheDocument();
    expect(screen.getByTestId('review-count')).toHaveTextContent('4 need action. 1 of them blocks approval.');
  });

  it('counts the same rows the server groups', () => {
    const review = groupReview(list.exceptions);
    expect({ needAction: review.needAction, blocking: review.blocking }).toEqual({ needAction: 4, blocking: 1 });
    expect(review.action.map((g) => [g.title, g.rows.length])).toEqual([
      ['Monthly tax (PCB) missing', 1],
      ['EPF on the employer-selected basis', 3],
    ]);
  });
});

describe('an acknowledged policy looks the same however it was acknowledged', () => {
  it('reads "Acknowledged for 2026 by …" from the row, before or after a recalculation', () => {
    list = {
      ...list,
      exceptions: [epf('Puteri Balqis', { overriddenBy: 'Dr Aisyah Rahman', overrideReason: 'Agreed', overriddenAt: '2026-10-05T03:00:00.000Z' })],
    };
    render(<PayrollExceptionCentre runId="run-1" canOverride />);
    expect(screen.getByTestId('review-count')).toHaveTextContent('Nothing needs action.');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByTestId('review-card-EPF_BASIS_DISCREPANCY')).toHaveTextContent('Acknowledged for 2026 by Dr Aisyah Rahman on 5 Oct 2026: “Agreed”');
    expect(screen.queryByRole('button', { name: 'Acknowledge for 2026' })).toBeNull();
  });
});

describe('lines carried from last month', () => {
  it('are one For information card from the month’s own items, not a row per person', () => {
    list = { ...list, exceptions: [row({ severity: 'INFO', code: 'CARRIED_FORWARD_UNCHECKED', title: 'Lines carried from last month', overridable: false })] };
    render(
      <PayrollExceptionCentre
        runId="run-1"
        canOverride
        carried={{ from: 'September 2026', lines: [{ name: 'Puteri Balqis', label: 'Allowance', amount: 'RM100.00' }] }}
      />,
    );
    expect(screen.getByTestId('carried-unchecked')).toHaveTextContent('1 line carried from September 2026 has not been edited or cleared.');
    expect(screen.queryByTestId('review-card-CARRIED_FORWARD_UNCHECKED')).toBeNull();
    expect(screen.getByText('For information · 1')).toBeInTheDocument();
  });
});
