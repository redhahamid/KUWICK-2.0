import { createHash } from 'node:crypto';

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

export interface SnapshotEmployeeLine {
  staffId: string;
  name: string;
  salaryRowId: string | null;
  salaryBasis: string | null;
  salaryAmountCents: number;
  inputs: {
    componentCode: string;
    amountCents: number;
    source: string;
    sourceRecordId: string | null;
    kind: string;
  }[];
  componentVersions: { code: string; version: number }[];
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
    pcbCents: number | null;
  };
  netCents: number;
  employerCostCents: number;
}

export interface SnapshotPayload {
  legalEmployerId: string | null;
  legalEmployerName: string | null;
  period: string;
  runType: string;
  sequence: number;
  paymentDate: string | null;
  statutoryRuleSetId: string | null;
  statutoryVerificationStatus: string | null;
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
