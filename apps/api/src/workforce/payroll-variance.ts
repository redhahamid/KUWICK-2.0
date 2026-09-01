/**
 * VARIANCE AGAINST THE PREVIOUS PERIOD.
 *
 * The single highest-value payroll control, and neither the audited competitor
 * nor Kuwick had it. Payroll errors are rarely subtle in size — a salary typed
 * with an extra zero, a bonus keyed twice, an employee whose unpaid leave was
 * entered as days worked. They are simply invisible in a grid of forty rows
 * that all look plausible.
 *
 * This says which rows MOVED, and by how much, before anybody approves.
 */

export interface VarianceLine {
  staffId: string;
  name: string;
  previousNetCents: number | null;
  currentNetCents: number | null;
}

export interface VarianceRow extends VarianceLine {
  deltaCents: number | null;
  /** Signed percentage against the previous period; null when there is no base. */
  percent: number | null;
  status: 'NEW' | 'LEFT' | 'UNCHANGED' | 'MOVED' | 'MATERIAL';
}

export interface VarianceTotals {
  field: string;
  previous: number;
  current: number;
  deltaCents: number;
  percent: number | null;
}

export interface VarianceReport {
  rows: VarianceRow[];
  totals: VarianceTotals[];
  headcountPrevious: number;
  headcountCurrent: number;
  joiners: number;
  leavers: number;
  material: VarianceRow[];
  thresholdPercent: number;
}

function pct(previous: number, current: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/**
 * `thresholdPercent` is how far a person's net pay may move before it is worth
 * a second look. It is a product default, not a rule — a clinic with variable
 * locum hours will want it wider than one paying fixed salaries.
 */
export function computeVariance(
  lines: VarianceLine[],
  totals: { field: string; previous: number; current: number }[],
  thresholdPercent = 20,
): VarianceReport {
  const rows: VarianceRow[] = lines.map((line) => {
    const { previousNetCents: prev, currentNetCents: cur } = line;

    if (prev === null && cur !== null) {
      return { ...line, deltaCents: cur, percent: null, status: 'NEW' };
    }
    if (prev !== null && cur === null) {
      return { ...line, deltaCents: -prev, percent: null, status: 'LEFT' };
    }
    if (prev === null || cur === null) {
      return { ...line, deltaCents: null, percent: null, status: 'UNCHANGED' };
    }

    const delta = cur - prev;
    if (delta === 0) return { ...line, deltaCents: 0, percent: 0, status: 'UNCHANGED' };

    const percent = pct(prev, cur);
    const material = percent !== null && Math.abs(percent) >= thresholdPercent;
    return { ...line, deltaCents: delta, percent, status: material ? 'MATERIAL' : 'MOVED' };
  });

  return {
    rows,
    totals: totals.map((t) => ({
      field: t.field,
      previous: t.previous,
      current: t.current,
      deltaCents: t.current - t.previous,
      percent: pct(t.previous, t.current),
    })),
    headcountPrevious: lines.filter((l) => l.previousNetCents !== null).length,
    headcountCurrent: lines.filter((l) => l.currentNetCents !== null).length,
    joiners: rows.filter((r) => r.status === 'NEW').length,
    leavers: rows.filter((r) => r.status === 'LEFT').length,
    material: rows.filter((r) => r.status === 'MATERIAL'),
    thresholdPercent,
  };
}
