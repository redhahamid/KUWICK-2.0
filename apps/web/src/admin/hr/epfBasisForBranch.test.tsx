// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import type { EpfBasisForBranchResult } from '../types';

/*
 * SET EPF BASIS FOR ALL STAFF IN THIS BRANCH (UAT, 10 October 2026): check
 * who changes first; a date that reaches approved months sets nobody. Demo
 * names only.
 */
let served: EpfBasisForBranchResult;
const mutateAsync = vi.fn(async (body: { commit?: boolean }) => ({ ...served, committed: Boolean(body.commit) }));
vi.mock('../hooks/useAdmin', () => ({ useEpfBasisForBranch: () => ({ mutateAsync, isPending: false }) }));

const { EpfBasisForBranchDrawer } = await import('./EpfBasisForBranchDrawer');

const result = (over: Partial<EpfBasisForBranchResult>): EpfBasisForBranchResult => ({
  clinicId: 'c-1',
  branch: 'Demo Branch',
  mode: 'BASIC_ONLY',
  effectiveFrom: '2026-01-01',
  people: 2,
  changing: 2,
  unchanged: 0,
  blocked: 0,
  committed: false,
  rows: [
    { staffId: 's-1', name: 'Demo Nurse', employeeNo: 'EM-1', current: 'ALL_APPLICABLE', action: 'CHANGE' },
    { staffId: 's-2', name: 'Demo Clerk', employeeNo: 'EM-2', current: 'ALL_APPLICABLE', action: 'CHANGE' },
  ],
  ...over,
});

const mount = () =>
  render(
    <App>
      <EpfBasisForBranchDrawer open clinicId="c-1" branchName="Demo Branch" onClose={() => {}} />
    </App>,
  );

describe('Set EPF basis for all staff in this branch', () => {
  it('asks why, checks who changes, then sets them all', async () => {
    served = result({});
    mutateAsync.mockClear();
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Check who changes' }));
    expect(await screen.findByText(/Say why/)).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Clinic pays EPF on basic salary only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check who changes' }));
    expect(await screen.findByTestId('branch-epf-preview')).toHaveTextContent('2 of 2 staff change');
    expect((mutateAsync.mock.calls[0] as unknown as [{ commit?: boolean; mode: string }])[0]).toMatchObject({ mode: 'BASIC_ONLY', clinicId: 'c-1' });

    fireEvent.click(screen.getByRole('button', { name: 'Set for 2 staff' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect((mutateAsync.mock.calls[1] as unknown as [{ commit?: boolean }])[0].commit).toBe(true);
  });

  it('offers no set when the date reaches approved months', async () => {
    served = result({ blocked: 1, changing: 1, rows: [{ staffId: 's-1', name: 'Demo Nurse', employeeNo: 'EM-1', current: 'ALL_APPLICABLE', action: 'BLOCKED' }] });
    mount();
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Clinic pays EPF on basic salary only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check who changes' }));
    expect(await screen.findByTestId('branch-epf-preview')).toHaveTextContent('approved payroll from this date');
    expect(screen.queryByRole('button', { name: /Set for/ })).toBeNull();
  });
});
