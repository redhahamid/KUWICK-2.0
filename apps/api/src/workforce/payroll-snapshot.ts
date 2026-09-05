import { createHash } from 'node:crypto';
import { EmployeeFigures, InvariantViolation, RunTotals, checkPayrollInvariants } from './payroll-invariants';

/**
 * THE APPROVED SNAPSHOT, AND ITS HASH.
 *
 * The audited competitor recalculates live until approval, freezes on approval,
 * and on reopen re-derives from CURRENT master data — holding no snapshot
 * anyone can inspect. Its own reopen dialog admits the consequence: figures
 * "could result in different amounts". That makes "what exactly did we approve
 * in January?" a question with no answer, which for a payroll system is not a
 * missing feature but a missing product.
 *
 * Kuwick freezes what the calculation consumed and hashes it. Two snapshots
 * with the same hash approved the same payroll, and a snapshot recomputed from
 * its own frozen inputs must reproduce its own totals — spec §52 invariant 5.
 */

/**
 * THE PAYLOAD SHAPE, VERSIONED.
 *
 * Version 1 froze the figures but not what produced them: no statutory
 * schedules, no employee classification, no component treatment, no approvals,
 * no overridden exceptions. The hash therefore did not cover which EPF Third
 * Schedule the contributions came out of — the one thing an auditor asks.
 *
 * A stored version-1 payload is still readable and still hashes to what it
 * hashed to. It is reported as UNVERIFIABLE by `verifySnapshot` rather than
 * quietly passing a check it was never built to satisfy.
 *
 * Version 3 adds the PAYSLIP DETAIL: the itemised lines, hours and identity a
 * printed payslip needs, so a payslip can be issued from the snapshot alone.
 * Version 2 froze every FIGURE but not the itemisation — a version-2 payslip
 * can state gross, each statutory deduction and net, and says its earnings
 * cannot be itemised, rather than borrowing rows from the mutable run.
 * Version 2 remains fully verifiable: the fields the arithmetic check reads
 * are unchanged.
 */
export const SNAPSHOT_SCHEMA_VERSION = 3;

/** The statutory standing the payslip was computed on, frozen. */
export interface SnapshotClassification {
  id: string | null;
  effectiveFrom: string | null;
  epfApplicable: boolean | null;
  epfMembership: string | null;
  epfEmployeeRate: number | null;
  socsoApplicable: boolean | null;
  eisApplicable: boolean | null;
  lindungParticipation: string | null;
  pcbApplicable: boolean | null;
  taxResidence: string | null;
  pcbCategory: string | null;
  qualifyingChildren: number | null;
  disabledSelf: boolean | null;
  disabledSpouse: boolean | null;
  restDayOfWeek: number | null;
  overtimeContractPolicy: string | null;
}

/**
 * A pay component AS APPLIED — the version, its window, and every liability
 * flag that decided which bases the money entered.
 *
 * Was `componentVersions: {code, version}[]`, repeated on every employee line,
 * read from `active: true` TODAY rather than resolved for the period. A
 * component deactivated after approval vanished from a rebuilt snapshot and one
 * added later appeared in it, and the flags — which are the treatment — were
 * never captured at all.
 */
export interface SnapshotComponent {
  code: string;
  label: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  kind: string;
  liability: {
    epfLiable: boolean;
    socsoLiable: boolean;
    eisLiable: boolean;
    pcbLiable: boolean;
    /** Whether it enters the s.60I(1A) ordinary-rate base, which prices overtime. */
    includeInOrpBase: boolean;
    /** Bonus and once-yearly incentive: taxed by a different part of the MTD method. */
    additionalRemuneration: boolean;
  };
  verification: string;
  sourceRef: string | null;
}

/** One schedule the run was calculated against. Mirrors `ScheduleStamp`. */
export interface SnapshotSchedule {
  scheme: string;
  scheduleId: string | null;
  effectiveFrom: string | null;
  verification: string | null;
  /** The document it was transcribed from, so the hash can be traced to paper. */
  document: string | null;
  contentHash: string | null;
  missing: boolean;
  notYetInForce: boolean;
}

export interface SnapshotStatutory {
  /** The date the schedules were resolved against — the period end, not today. */
  resolvedAt: string;
  approvable: boolean;
  blockers: string[];
  schedules: SnapshotSchedule[];
}

/** Who signed, in what order, under which policy. */
export interface SnapshotApproval {
  staffId: string;
  name: string;
  sequence: number;
  mode: string;
  usedOwnerSelfApproval: boolean;
  statutoryGapAcknowledged: boolean;
  at: string;
}

/**
 * What was outstanding at approval, and what somebody waved through.
 *
 * An approval is only meaningful beside the exceptions it was given over. A
 * snapshot that froze the figures and dropped the overrides answers "what did
 * we pay" and not "what did we know when we agreed to pay it".
 */
export interface SnapshotException {
  code: string;
  severity: string;
  staffId: string | null;
  cause: string;
  overridden: boolean;
  overriddenByStaffId: string | null;
  overrideReason: string | null;
}

/**
 * VERSION 3 — what a printed payslip needs beyond the figures.
 *
 * The itemised component lines are the calculation's own rows (code, label,
 * kind, amount), so an earnings section can be reproduced from the snapshot
 * without touching the run's mutable lines — which a reopen rewrites while
 * the approved snapshot stands.
 */
export interface SnapshotPayslipDetail {
  employeeNo: string | null;
  position: string | null;
  department: string | null;
  employmentType: string | null;
  /** The bank the pay goes to. The account NUMBER is deliberately not frozen. */
  bankName: string | null;
  workedDays: number | null;
  unpaidDays: number | null;
  overtimeHours: number | null;
  /** The line's own column splits, as paid. */
  figures: {
    basicCents: number;
    allowancesCents: number;
    overtimeCents: number;
    incentivesCents: number;
    bonusCents: number;
    unpaidLeaveCents: number;
    otherDeductionsCents: number;
  };
  /** Every calculation line: earnings, wage reductions and deductions. */
  componentLines: { code: string; label: string; kind: string; amountCents: number }[];
  /** Why a statutory figure is what it is — or why it is absent. Verbatim. */
  statutoryNotes: {
    epf: string | null;
    socso: string | null;
    eis: string | null;
    lindung: string | null;
    pcb: string | null;
  };
  /**
   * The overtime working, tier by tier, as the run priced it. A day priced in
   * DAYS (s.60(3), s.60D) carries `ordinaryRateDays`; without it the frozen
   * row read "0 h @ RM33.00 … 200.00" — a statement of wages nobody could
   * multiply out. Absent on rows frozen before the field existed.
   */
  overtime: {
    label: string;
    hours: number;
    hourlyRate: number;
    total: number;
    ordinaryRateDays?: number;
    provision?: string;
  }[];
}

export interface SnapshotEmployeeLine {
  staffId: string;
  name: string;
  salaryRowId: string | null;
  salaryBasis: string | null;
  salaryAmountCents: number;
  /** Version 3+. Absent on older snapshots, whose payslips say so. */
  payslip?: SnapshotPayslipDetail;
  /** The month's TP1 as applied — LP1 and self-paid zakat. Version 3+. */
  tp1?: { deductionsCents: number; zakatSelfPaidCents: number } | null;
  /** The statutory standing in force for the period, frozen. */
  classification: SnapshotClassification | null;
  inputs: {
    id: string | null;
    componentCode: string;
    amountCents: number;
    source: string;
    sourceRecordId: string | null;
    kind: string;
  }[];
  bases: {
    grossCents: number;
    epfCents: number;
    socsoCents: number;
    eisCents: number;
    ordinaryRateBaseCents: number;
  };
  statutory: {
    epfEmployeeCents: number | null;
    epfEmployerCents: number | null;
    socsoEmployeeCents: number | null;
    socsoEmployerCents: number | null;
    eisEmployeeCents: number | null;
    eisEmployerCents: number | null;
    /** Employee-borne; there is no employer share to freeze. */
    lindungEmployeeCents: number | null;
    /** Employer-borne HRD Corp levy. Version 3+; null = not workable-out. */
    hrdLevyCents?: number | null;
    pcbCents: number | null;
  };
  /** Everything withheld from the employee, so the snapshot can check itself. */
  deductionCents: number;
  /** Everything the employer paid on top, likewise. */
  employerContributionCents: number;
  netCents: number;
  employerCostCents: number;
}

export interface SnapshotPayload {
  schemaVersion?: number;
  legalEmployerId: string | null;
  legalEmployerName: string | null;
  period: string;
  runType: string;
  sequence: number;
  paymentDate: string | null;
  /**
   * LEGACY. `StatutoryRuleSet` was a tenant-configurable rate table the engine
   * no longer reads; kept so a version-1 snapshot still parses. The real
   * provenance is `statutory` below.
   */
  statutoryRuleSetId: string | null;
  statutoryVerificationStatus: string | null;
  /** The schedules, their editions and their content hashes, AS APPLIED. */
  statutory?: SnapshotStatutory | null;
  /** The component catalogue resolved for the period, with its treatment. */
  components?: SnapshotComponent[];
  approvals?: SnapshotApproval[];
  exceptions?: SnapshotException[];
  orp: { overtimeDays: number; unpaidLeaveDays: number; hoursPerDay: number };
  employees: SnapshotEmployeeLine[];
  totals: {
    grossCents: number;
    deductionCents: number;
    netCents: number;
    employerCostCents: number;
    employeeCount: number;
  };
}

/**
 * Canonical JSON: keys sorted at every level, so two structurally identical
 * payloads hash the same regardless of how they were assembled.
 */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(',')}}`;
}

export function snapshotHash(payload: SnapshotPayload): string {
  return createHash('sha256').update(canonicalise(payload)).digest('hex');
}

export interface SnapshotDiffRow {
  staffId: string;
  name: string;
  field: string;
  before: number | null;
  after: number | null;
  deltaCents: number | null;
}

export interface SnapshotDiff {
  changed: SnapshotDiffRow[];
  added: { staffId: string; name: string }[];
  removed: { staffId: string; name: string }[];
  totals: { field: string; before: number; after: number; deltaCents: number }[];
  identical: boolean;
}

const COMPARED_FIELDS: (keyof SnapshotEmployeeLine['statutory'] | 'netCents' | 'employerCostCents')[] = [
  'netCents',
  'employerCostCents',
  'epfEmployeeCents',
  'epfEmployerCents',
  'socsoEmployeeCents',
  'socsoEmployerCents',
  'eisEmployeeCents',
  'eisEmployerCents',
  // Employee-borne, and a real deduction: a reopen that changed it and said
  // nothing would be a payslip moving with no diff row to show for it.
  'lindungEmployeeCents',
  // Employer-borne, and inside employer cost — same reasoning from the
  // employer's side of the sheet.
  'hrdLevyCents',
  'pcbCents',
];

function fieldValue(line: SnapshotEmployeeLine, field: string): number | null {
  if (field === 'netCents') return line.netCents;
  if (field === 'employerCostCents') return line.employerCostCents;
  return (line.statutory as unknown as Record<string, number | null>)[field] ?? null;
}

/**
 * What changed between the approved snapshot and a recalculated candidate.
 *
 * A reopen shows this BEFORE the user commits. The audited competitor reopens
 * with a warning that figures may change and then shows nobody what did.
 */
export function diffSnapshots(before: SnapshotPayload, after: SnapshotPayload): SnapshotDiff {
  const beforeByStaff = new Map(before.employees.map((e) => [e.staffId, e]));
  const afterByStaff = new Map(after.employees.map((e) => [e.staffId, e]));

  const changed: SnapshotDiffRow[] = [];
  for (const [staffId, afterLine] of afterByStaff) {
    const beforeLine = beforeByStaff.get(staffId);
    if (!beforeLine) continue;
    for (const field of COMPARED_FIELDS) {
      const b = fieldValue(beforeLine, field);
      const a = fieldValue(afterLine, field);
      if (b === a) continue;
      changed.push({
        staffId,
        name: afterLine.name,
        field,
        before: b,
        after: a,
        deltaCents: b === null || a === null ? null : a - b,
      });
    }
  }

  const added = [...afterByStaff.values()]
    .filter((e) => !beforeByStaff.has(e.staffId))
    .map((e) => ({ staffId: e.staffId, name: e.name }));
  const removed = [...beforeByStaff.values()]
    .filter((e) => !afterByStaff.has(e.staffId))
    .map((e) => ({ staffId: e.staffId, name: e.name }));

  const totals = (
    ['grossCents', 'deductionCents', 'netCents', 'employerCostCents', 'employeeCount'] as const
  )
    .map((field) => ({
      field,
      before: before.totals[field],
      after: after.totals[field],
      deltaCents: after.totals[field] - before.totals[field],
    }))
    .filter((row) => row.deltaCents !== 0);

  return {
    changed,
    added,
    removed,
    totals,
    identical: changed.length === 0 && added.length === 0 && removed.length === 0 && totals.length === 0,
  };
}


// ---------------------------------------------------------------------------
// Does the snapshot still say what it said, and does it add up?
// ---------------------------------------------------------------------------

export type SnapshotVerdict = 'VERIFIED' | 'TAMPERED' | 'INCONSISTENT' | 'UNVERIFIABLE_SCHEMA';

export interface SnapshotVerification {
  verdict: SnapshotVerdict;
  /** True only when the stored hash matches a fresh hash of the stored payload. */
  hashMatches: boolean;
  storedHash: string;
  computedHash: string;
  /** Relationships the frozen figures must satisfy among themselves. */
  violations: InvariantViolation[];
  schemaVersion: number;
  reason: string;
}

/**
 * VERIFY A SNAPSHOT AGAINST ITSELF.
 *
 * Two independent questions, and conflating them would hide one behind the
 * other:
 *
 *  - IS IT THE PAYLOAD THAT WAS APPROVED? Re-hash the stored payload and
 *    compare with the stored hash. The database refuses UPDATE and DELETE on
 *    `payroll_snapshots`, so a mismatch means the row was changed by something
 *    that bypassed the trigger — a restore, a migration, a direct superuser
 *    write. That is worth saying out loud rather than assuming it cannot
 *    happen.
 *
 *  - DOES IT ADD UP? Recompute the run's relationships from the FROZEN
 *    per-employee figures with the same `checkPayrollInvariants` the run uses,
 *    so there is no second implementation to drift. A snapshot whose totals do
 *    not follow from its own rows cannot be reconciled to anything, however
 *    faithfully it was stored.
 *
 * A version-1 payload carries no per-employee deduction or employer
 * contribution, so the arithmetic cannot be checked. It is reported
 * UNVERIFIABLE_SCHEMA — never VERIFIED on the strength of a hash alone.
 */
export function verifySnapshot(payload: SnapshotPayload, storedHash: string): SnapshotVerification {
  const computedHash = snapshotHash(payload);
  const hashMatches = computedHash === storedHash;
  const schemaVersion = payload.schemaVersion ?? 1;

  if (!hashMatches) {
    return {
      verdict: 'TAMPERED',
      hashMatches,
      storedHash,
      computedHash,
      violations: [],
      schemaVersion,
      reason:
        'The stored payload does not hash to the hash recorded with it, so this is not the payload that was ' +
        'approved. The database refuses updates to this table, so something bypassed it.',
    };
  }

  // Version 2 added the per-employee deduction and employer-contribution
  // figures the arithmetic check reads; version 3 added payslip itemisation,
  // which the check does not read. So 2 and 3 verify identically, and only a
  // version-1 payload is beyond re-checking.
  if (schemaVersion < 2) {
    return {
      verdict: 'UNVERIFIABLE_SCHEMA',
      hashMatches,
      storedHash,
      computedHash,
      violations: [],
      schemaVersion,
      reason:
        `This snapshot was written in format ${schemaVersion}, which did not record per-employee deductions or ` +
        'employer contributions. Its hash is intact, but its arithmetic cannot be re-checked from what it holds.',
    };
  }

  const employees: EmployeeFigures[] = payload.employees.map((line) => ({
    staffId: line.staffId,
    name: line.name,
    grossCents: line.bases.grossCents,
    employeeDeductionCents: line.deductionCents,
    netCents: line.netCents,
    employerContributionCents: line.employerContributionCents,
    employerCostCents: line.employerCostCents,
  }));
  const totals: RunTotals = {
    grossCents: payload.totals.grossCents,
    deductionCents: payload.totals.deductionCents,
    netCents: payload.totals.netCents,
    employerCostCents: payload.totals.employerCostCents,
    employeeCount: payload.totals.employeeCount,
  };
  const violations = checkPayrollInvariants(employees, totals);

  /*
   * THE INDEPENDENT PER-ROW IDENTITY. `deductionCents` and
   * `employerContributionCents` above are DERIVED at freeze time by
   * subtraction, so `gross − deduction = net` holds for any payload by
   * construction and proves nothing about a single row. What CAN fail is the
   * identity across columns frozen from different sources: the statutory
   * figures, the itemised other-deductions, net and employer cost. A row a
   * bug wrote inconsistently — a withholding recorded but not taken, a levy
   * in employer cost but not on the row — fails here and nowhere else.
   *
   * Rows carrying a null statutory figure (an acknowledged-gap month) or no
   * v3 payslip detail are skipped for the side the null sits on: an unknown
   * is not a zero, and pretending so is the exact laundering this check
   * exists to catch.
   */
  for (const line of payload.employees) {
    const s = line.statutory;
    const other = line.payslip?.figures?.otherDeductionsCents;
    if (
      other !== undefined &&
      s.epfEmployeeCents !== null &&
      s.socsoEmployeeCents !== null &&
      s.eisEmployeeCents !== null &&
      s.lindungEmployeeCents !== null &&
      s.pcbCents !== null
    ) {
      const expectedNet =
        line.bases.grossCents -
        (s.epfEmployeeCents + s.socsoEmployeeCents + s.eisEmployeeCents + s.lindungEmployeeCents + s.pcbCents + other);
      if (expectedNet !== line.netCents) {
        violations.push({
          code: 'SNAPSHOT_NET_VS_STATUTORY_COLUMNS',
          staffId: line.staffId,
          message:
            `${line.name}: gross less the frozen statutory withholdings and other deductions is ` +
            `${(expectedNet / 100).toFixed(2)}, but the frozen net is ${(line.netCents / 100).toFixed(2)}.`,
          expectedCents: expectedNet,
          actualCents: line.netCents,
        });
      }
    }
    const hrd = s.hrdLevyCents;
    if (
      s.epfEmployerCents !== null &&
      s.socsoEmployerCents !== null &&
      s.eisEmployerCents !== null &&
      hrd !== undefined &&
      hrd !== null
    ) {
      const expectedCost =
        line.bases.grossCents + s.epfEmployerCents + s.socsoEmployerCents + s.eisEmployerCents + hrd;
      if (expectedCost !== line.employerCostCents) {
        violations.push({
          code: 'SNAPSHOT_EMPLOYER_COST_VS_COLUMNS',
          staffId: line.staffId,
          message:
            `${line.name}: gross plus the frozen employer contributions is ${(expectedCost / 100).toFixed(2)}, ` +
            `but the frozen employer cost is ${(line.employerCostCents / 100).toFixed(2)}.`,
          expectedCents: expectedCost,
          actualCents: line.employerCostCents,
        });
      }
    }
  }

  if (violations.length > 0) {
    return {
      verdict: 'INCONSISTENT',
      hashMatches,
      storedHash,
      computedHash,
      violations,
      schemaVersion,
      reason: `The payload is intact but does not add up: ${violations.length} relationship(s) fail.`,
    };
  }

  return {
    verdict: 'VERIFIED',
    hashMatches,
    storedHash,
    computedHash,
    violations: [],
    schemaVersion,
    reason:
      'The payload hashes to the hash recorded with it, and its totals follow from its own employee rows.',
  };
}
