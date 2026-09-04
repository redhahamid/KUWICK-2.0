// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PayrollSnapshotRow } from '../types';

vi.mock('../hooks/useAdmin', () => ({
  usePayrollSnapshots: () => ({ data: rows, isLoading: false }),
  useCandidateDiff: () => ({ data: undefined }),
}));

let rows: PayrollSnapshotRow[] = [];

const { PayrollSnapshotPanel } = await import('./PayrollSnapshotPanel');

function snapshot(over: Partial<PayrollSnapshotRow> = {}): PayrollSnapshotRow {
  return {
    id: 'snap1',
    version: 1,
    hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    reason: null,
    createdBy: 'Dr Aisyah Rahman',
    createdAt: '2026-09-01T02:00:00.000Z',
    verdict: 'VERIFIED',
    verificationNote: 'The payload hashes to the hash recorded with it, and its totals follow from its own rows.',
    schemaVersion: 2,
    totals: {
      grossCents: 300000,
      deductionCents: 35065,
      netCents: 264935,
      employerCostCents: 344755,
      employeeCount: 1,
    },
    ...over,
  };
}

/**
 * A HASH SHOWN BESIDE NOTHING INVITES THE READER TO ASSUME IT STILL MATCHES.
 *
 * The panel displayed a stored hash and left it there. The verdict is computed
 * on every read now — the payload is re-hashed and its frozen figures re-run
 * through the run's own invariants — so this column reports a check that
 * happened rather than a property somebody asserted once.
 */
describe('the approved-snapshot verdict', () => {
  it('says a sound snapshot is verified', () => {
    rows = [snapshot()];
    render(<PayrollSnapshotPanel runId="run1" />);
    expect(screen.getByText('Verified')).toBeTruthy();
  });

  it('says so plainly when the stored payload no longer hashes to its hash', () => {
    rows = [snapshot({ verdict: 'TAMPERED', verificationNote: 'This is not the payload that was approved.' })];
    render(<PayrollSnapshotPanel runId="run1" />);
    expect(screen.getByText('Does not match')).toBeTruthy();
    expect(screen.queryByText('Verified')).toBeNull();
  });

  it('distinguishes an intact payload that does not add up from one that was altered', () => {
    rows = [snapshot({ verdict: 'INCONSISTENT', verificationNote: 'Intact, but 2 relationships fail.' })];
    render(<PayrollSnapshotPanel runId="run1" />);
    expect(screen.getByText('Does not add up')).toBeTruthy();
  });

  /*
   * An older payload carried no per-employee deduction, so its arithmetic
   * cannot be re-derived. Showing it as verified on the strength of an intact
   * hash would claim a check that never ran.
   */
  it('does not certify a snapshot written before the format could be re-checked', () => {
    rows = [snapshot({ verdict: 'UNVERIFIABLE_SCHEMA', schemaVersion: 1 })];
    render(<PayrollSnapshotPanel runId="run1" />);
    expect(screen.getByText('Older format')).toBeTruthy();
    expect(screen.queryByText('Verified')).toBeNull();
  });

  it('still shows the hash, short, so two versions can be told apart by eye', () => {
    rows = [snapshot()];
    render(<PayrollSnapshotPanel runId="run1" />);
    expect(screen.getByText('a1b2c3d4e5f6')).toBeTruthy();
  });
});
