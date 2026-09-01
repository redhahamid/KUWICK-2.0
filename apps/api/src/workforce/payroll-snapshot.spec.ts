import { canonicalise, diffSnapshots, snapshotHash, SnapshotPayload, SnapshotEmployeeLine } from './payroll-snapshot';

const line = (over: Partial<SnapshotEmployeeLine> = {}): SnapshotEmployeeLine => ({
  staffId: 's1',
  name: 'Synthetic Employee',
  salaryRowId: 'sal1',
  salaryBasis: 'MONTHLY',
  salaryAmountCents: 300000,
  inputs: [],
  componentVersions: [{ code: 'BASIC', version: 1 }],
  bases: { grossCents: 300000, epfCents: 300000, socsoCents: 300000, eisCents: 300000, ordinaryRateBaseCents: 300000 },
  statutory: {
    epfEmployeeCents: 33000, epfEmployerCents: 39000,
    socsoEmployeeCents: 1475, socsoEmployerCents: 5165,
    eisEmployeeCents: 590, eisEmployerCents: 590,
    pcbCents: null,
  },
  netCents: 264935,
  employerCostCents: 344755,
  ...over,
});

const payload = (over: Partial<SnapshotPayload> = {}): SnapshotPayload => ({
  legalEmployerId: 'emp1',
  legalEmployerName: 'Synthetic Clinic Sdn Bhd',
  period: '2026-07-01',
  runType: 'REGULAR',
  sequence: 1,
  paymentDate: '2026-07-31',
  statutoryRuleSetId: 'rs1',
  statutoryVerificationStatus: 'CORROBORATED',
  orp: { overtimeDays: 26, unpaidLeaveDays: 31, hoursPerDay: 7.5 },
  employees: [line()],
  totals: { grossCents: 300000, deductionCents: 35065, netCents: 264935, employerCostCents: 344755, employeeCount: 1 },
  ...over,
});

describe('payroll snapshot', () => {
  it('hashes the same payload identically', () => {
    expect(snapshotHash(payload())).toBe(snapshotHash(payload()));
  });

  it('hashes the same content identically regardless of key order', () => {
    const a = canonicalise({ b: 1, a: 2, c: { z: 1, y: 2 } });
    const b = canonicalise({ c: { y: 2, z: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('changes the hash when one cent changes', () => {
    const before = snapshotHash(payload());
    const after = snapshotHash(payload({ employees: [line({ netCents: 264936 })] }));
    expect(after).not.toBe(before);
  });

  it('changes the hash when the statutory rule set changes, even at identical amounts', () => {
    expect(snapshotHash(payload({ statutoryRuleSetId: 'rs2' }))).not.toBe(snapshotHash(payload()));
  });

  it('changes the hash when the ORP divisors change', () => {
    const other = payload({ orp: { overtimeDays: 30, unpaidLeaveDays: 31, hoursPerDay: 7.5 } });
    expect(snapshotHash(other)).not.toBe(snapshotHash(payload()));
  });

  it('produces a stable 64-character sha256', () => {
    expect(snapshotHash(payload())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports no diff between a snapshot and itself', () => {
    expect(diffSnapshots(payload(), payload()).identical).toBe(true);
  });

  it('names the field, the before, the after and the delta when a figure moves', () => {
    const after = payload({
      employees: [line({ netCents: 280000 })],
      totals: { grossCents: 300000, deductionCents: 20000, netCents: 280000, employerCostCents: 344755, employeeCount: 1 },
    });
    const d = diffSnapshots(payload(), after);
    expect(d.identical).toBe(false);
    const net = d.changed.find((r) => r.field === 'netCents');
    expect(net).toMatchObject({ before: 264935, after: 280000, deltaCents: 15065 });
    expect(d.totals.find((t) => t.field === 'netCents')?.deltaCents).toBe(15065);
  });

  it('reports an employee who appears only in the candidate as added', () => {
    const after = payload({ employees: [line(), line({ staffId: 's2', name: 'Second Employee' })] });
    const d = diffSnapshots(payload(), after);
    expect(d.added).toEqual([{ staffId: 's2', name: 'Second Employee' }]);
    expect(d.removed).toHaveLength(0);
  });

  it('reports an employee who disappears as removed rather than silently dropping them', () => {
    const d = diffSnapshots(payload(), payload({ employees: [] }));
    expect(d.removed).toEqual([{ staffId: 's1', name: 'Synthetic Employee' }]);
  });

  it('treats a statutory figure going from null to a number as a change', () => {
    const after = payload({ employees: [line({ statutory: { ...line().statutory, pcbCents: 5000 } })] });
    const d = diffSnapshots(payload(), after);
    const pcb = d.changed.find((r) => r.field === 'pcbCents');
    expect(pcb).toMatchObject({ before: null, after: 5000, deltaCents: null });
  });

  it('does not invent a delta when either side is unknown', () => {
    const before = payload({ employees: [line({ statutory: { ...line().statutory, pcbCents: null } })] });
    const after = payload({ employees: [line({ statutory: { ...line().statutory, pcbCents: null } })] });
    expect(diffSnapshots(before, after).changed).toHaveLength(0);
  });
});
