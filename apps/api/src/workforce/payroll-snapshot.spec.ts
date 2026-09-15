import {
  SNAPSHOT_SCHEMA_VERSION,
  SnapshotEmployeeLine,
  SnapshotPayload,
  canonicalise,
  diffSnapshots,
  snapshotHash,
  verifySnapshot,
} from './payroll-snapshot';

const line = (over: Partial<SnapshotEmployeeLine> = {}): SnapshotEmployeeLine => ({
  staffId: 's1',
  name: 'Synthetic Employee',
  salaryRowId: 'sal1',
  salaryBasis: 'MONTHLY',
  salaryAmountCents: 300000,
  inputs: [],
  classification: null,
  bases: { grossCents: 300000, epfCents: 300000, socsoCents: 300000, eisCents: 300000, ordinaryRateBaseCents: 300000 },
  statutory: {
    epfEmployeeCents: 33000, epfEmployerCents: 39000,
    socsoEmployeeCents: 1475, socsoEmployerCents: 5165,
    eisEmployeeCents: 590, eisEmployerCents: 590,
    lindungEmployeeCents: null,
    pcbCents: null,
  },
  deductionCents: 35065,
  employerContributionCents: 44755,
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
  orp: { overtimeDays: 26, hoursPerDay: 7.5 },
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
    const other = payload({ orp: { overtimeDays: 30, hoursPerDay: 7.5 } });
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


describe('verifySnapshot', () => {
  /*
   * A snapshot is a claim about the past. It is worth nothing unless it can be
   * checked, and checking is TWO questions that must not be run together: is
   * this the payload that was approved, and does that payload add up?
   */
  const sound = (): SnapshotPayload =>
    payload({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      employees: [line()],
      totals: {
        grossCents: 300000,
        deductionCents: 35065,
        netCents: 264935,
        employerCostCents: 344755,
        employeeCount: 1,
      },
    });

  it('passes a payload that hashes to its own hash and adds up', () => {
    const p = sound();
    const result = verifySnapshot(p, snapshotHash(p));
    expect(result.verdict).toBe('VERIFIED');
    expect(result.hashMatches).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('calls a payload TAMPERED when it no longer hashes to the hash stored with it', () => {
    const p = sound();
    const storedHash = snapshotHash(p);
    // What a direct database write would look like: a figure moved, the hash
    // left behind. The table refuses UPDATE, so this should be impossible —
    // which is exactly why it is worth being able to detect.
    p.totals.netCents = 999999;
    const result = verifySnapshot(p, storedHash);
    expect(result.verdict).toBe('TAMPERED');
    expect(result.hashMatches).toBe(false);
    expect(result.reason).toMatch(/not the payload that was approved/);
  });

  it('calls a payload INCONSISTENT when it is intact but does not add up', () => {
    // Stored faithfully, hashed correctly, and the totals do not follow from
    // the rows. A hash proves storage, never arithmetic.
    const p = payload({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      employees: [line()],
      totals: {
        grossCents: 300000,
        deductionCents: 35065,
        netCents: 111111,
        employerCostCents: 344755,
        employeeCount: 1,
      },
    });
    const result = verifySnapshot(p, snapshotHash(p));
    expect(result.verdict).toBe('INCONSISTENT');
    expect(result.hashMatches).toBe(true);
    expect(result.violations.map((v) => v.code)).toContain('RUN_NET_MISMATCH');
  });

  it('catches a headcount that drifted from the rows', () => {
    const p = sound();
    p.totals.employeeCount = 4;
    const result = verifySnapshot(p, snapshotHash(p));
    expect(result.verdict).toBe('INCONSISTENT');
    expect(result.violations.map((v) => v.code)).toContain('RUN_HEADCOUNT_MISMATCH');
  });

  it('catches an employee whose own gross, deductions and net disagree', () => {
    const p = payload({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      employees: [line({ deductionCents: 1 })],
      totals: {
        grossCents: 300000,
        deductionCents: 1,
        netCents: 264935,
        employerCostCents: 344755,
        employeeCount: 1,
      },
    });
    const result = verifySnapshot(p, snapshotHash(p));
    expect(result.verdict).toBe('INCONSISTENT');
    expect(result.violations.map((v) => v.code)).toContain('EMPLOYEE_NET_MISMATCH');
  });

  /*
   * A version-1 payload recorded no per-employee deduction or employer
   * contribution, so its arithmetic cannot be re-derived. Reporting it VERIFIED
   * on the strength of an intact hash would claim a check that never ran.
   */
  it('refuses to certify a version-1 payload it cannot re-check', () => {
    const p = sound();
    delete p.schemaVersion;
    const result = verifySnapshot(p, snapshotHash(p));
    expect(result.verdict).toBe('UNVERIFIABLE_SCHEMA');
    expect(result.hashMatches).toBe(true);
    expect(result.schemaVersion).toBe(1);
    expect(result.reason).toMatch(/cannot be re-checked/);
  });

  it('reports TAMPERED ahead of the schema, because a broken hash settles it', () => {
    const p = sound();
    const storedHash = snapshotHash(p);
    delete p.schemaVersion;
    expect(verifySnapshot(p, storedHash).verdict).toBe('TAMPERED');
  });

  /*
   * VERSION 2 STAYS VERIFIABLE UNDER VERSION 3. Version 3 added payslip
   * itemisation, which the arithmetic check does not read — so bumping the
   * current format must not turn every existing approved record UNVERIFIABLE.
   * Only version 1, which lacks the per-employee figures, is beyond checking.
   */
  it('still certifies a version-2 payload written before the payslip detail existed', () => {
    const p = sound();
    p.schemaVersion = 2;
    for (const employee of p.employees) delete (employee as { payslip?: unknown }).payslip;
    const result = verifySnapshot(p, snapshotHash(p));
    expect(result.verdict).toBe('VERIFIED');
    expect(result.schemaVersion).toBe(2);
  });

  /*
   * THE HASH MUST COVER THE PROVENANCE.
   *
   * Version 1 hashed the figures and not the schedules that produced them, so
   * two runs computed against different EPF editions hashed identically. The
   * question an auditor asks first — which schedule was this? — was outside
   * the thing that proved the record had not moved.
   */
  it('hashes differently when the statutory schedules differ', () => {
    const a = sound();
    const b = sound();
    b.statutory = {
      resolvedAt: '2026-09-01',
      approvable: true,
      blockers: [],
      schedules: [
        {
          scheme: 'EPF',
          scheduleId: 'EPF_THIRD_SCHEDULE_2025_10',
          effectiveFrom: '2025-10-01',
          verification: 'OFFICIAL_SOURCE_VERIFIED',
          document: 'KWSP Third Schedule',
          contentHash: 'abc123',
          missing: false,
          notYetInForce: false,
        },
      ],
    };
    expect(snapshotHash(a)).not.toBe(snapshotHash(b));
  });

  it('hashes differently when a component treatment differs', () => {
    const a = sound();
    const b = sound();
    const treatment = {
      code: 'ALLOWANCE',
      label: 'Allowance',
      version: 1,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      kind: 'EARNING',
      liability: {
        epfLiable: true,
        socsoLiable: true,
        eisLiable: true,
        pcbLiable: true,
        includeInOrpBase: false,
        additionalRemuneration: false,
      },
      verification: 'UNVERIFIED',
      sourceRef: null,
    };
    a.components = [treatment];
    b.components = [{ ...treatment, liability: { ...treatment.liability, epfLiable: false } }];
    expect(snapshotHash(a)).not.toBe(snapshotHash(b));
  });

  it('hashes differently when the classification a payslip used differs', () => {
    const a = sound();
    const b = payload({
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      employees: [
        line({
          classification: {
            id: 'c1',
            effectiveFrom: '2024-01-01',
            epfApplicable: true,
            epfMembership: 'PERMANENT_RESIDENT',
            epfEmployeeRate: 11,
            socsoApplicable: true,
            eisApplicable: true,
            lindungParticipation: 'NOT_PARTICIPATING',
            pcbApplicable: true,
            taxResidence: 'RESIDENT',
            pcbCategory: 'CATEGORY_1',
            qualifyingChildren: 0,
            disabledSelf: false,
            disabledSpouse: false,
            restDayOfWeek: 0,
            overtimeContractPolicy: null,
          },
        }),
      ],
      totals: a.totals,
    });
    expect(snapshotHash(a)).not.toBe(snapshotHash(b));
  });

  it('hashes differently when the approvals differ', () => {
    const a = sound();
    const b = sound();
    b.approvals = [
      {
        staffId: 's9',
        name: 'Somebody Else',
        sequence: 1,
        mode: 'STANDARD',
        usedOwnerSelfApproval: false,
        statutoryGapAcknowledged: false,
        at: '2026-09-01T00:00:00.000Z',
      },
    ];
    expect(snapshotHash(a)).not.toBe(snapshotHash(b));
  });

  it('hashes differently when an exception was overridden rather than resolved', () => {
    const a = sound();
    const b = sound();
    const exception = {
      code: 'MISSING_PUNCH',
      severity: 'WARNING',
      staffId: 's1',
      cause: '2 days have no clock-in or clock-out.',
      overridden: false,
      overriddenByStaffId: null,
      overrideReason: null,
    };
    a.exceptions = [exception];
    b.exceptions = [
      { ...exception, overridden: true, overriddenByStaffId: 's2', overrideReason: 'Confirmed with the employee' },
    ];
    expect(snapshotHash(a)).not.toBe(snapshotHash(b));
  });
});
