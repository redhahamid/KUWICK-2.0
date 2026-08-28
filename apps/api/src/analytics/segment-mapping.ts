/**
 * SEGMENT MAPPING — which reporting segment a billed line belongs to.
 *
 * ONE LINE, AT MOST ONE SEGMENT (owner brief §2B). Rules are sorted by
 * `priority` and the FIRST match wins. Summing a line into two segments would
 * make the segment totals exceed the clinic's revenue, which is the single
 * most misleading thing a segmented P&L can do.
 *
 * Pure, so the precedence rules can be tested exhaustively without a database.
 */

export interface MappingRule {
  id: string;
  segmentId: string;
  priority: number;
  serviceCatalogId?: string | null;
  itemId?: string | null;
  itemCategory?: string | null;
  serviceCategory?: string | null;
  descriptionMatch?: string | null;
}

export interface MappableLine {
  description: string;
  serviceCatalogId?: string | null;
  itemId?: string | null;
  itemCategory?: string | null;
  serviceCategory?: string | null;
}

function matches(rule: MappingRule, line: MappableLine): boolean {
  if (rule.serviceCatalogId) return rule.serviceCatalogId === line.serviceCatalogId;
  if (rule.itemId) return rule.itemId === line.itemId;
  if (rule.itemCategory) return rule.itemCategory === line.itemCategory;
  if (rule.serviceCategory) return rule.serviceCategory === line.serviceCategory;
  if (rule.descriptionMatch) {
    return line.description.toLowerCase().includes(rule.descriptionMatch.toLowerCase());
  }
  // A rule with no criterion matches NOTHING, deliberately. The alternative —
  // matching everything — would silently swallow the clinic's whole revenue
  // into one segment.
  return false;
}

/**
 * The segment for a line, or null.
 *
 * NULL IS A REAL ANSWER and is reported as "unmapped" on every segment screen:
 * revenue nobody has classified is exactly the thing a clinic needs to see, and
 * bucketing it into "Outpatient" by default would hide it.
 */
export function segmentFor(rules: MappingRule[], line: MappableLine): string | null {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  for (const rule of ordered) {
    if (matches(rule, line)) return rule.segmentId;
  }
  return null;
}

export interface SegmentTotals {
  segmentId: string | null;
  revenueCents: number;
  costCents: number;
  lines: number;
  invoiceIds: Set<string>;
  patientIds: Set<string>;
}

/**
 * Groups lines into segments.
 *
 * Revenue is the DISCOUNTED line total plus its tax — what the payer was
 * actually asked for. Cost is the item's cost where the line has one; a service
 * with no mapped cost contributes nothing to cost, and the caller reports the
 * gap rather than treating it as zero-cost profit.
 */
export function accumulateSegments(
  rules: MappingRule[],
  lines: (MappableLine & {
    invoiceId: string;
    patientId?: string | null;
    revenueCents: number;
    costCents: number;
  })[],
): Map<string | null, SegmentTotals> {
  const totals = new Map<string | null, SegmentTotals>();
  for (const line of lines) {
    const segmentId = segmentFor(rules, line);
    const bucket =
      totals.get(segmentId) ??
      ({
        segmentId,
        revenueCents: 0,
        costCents: 0,
        lines: 0,
        invoiceIds: new Set<string>(),
        patientIds: new Set<string>(),
      } satisfies SegmentTotals);
    bucket.revenueCents += line.revenueCents;
    bucket.costCents += line.costCents;
    bucket.lines += 1;
    bucket.invoiceIds.add(line.invoiceId);
    if (line.patientId) bucket.patientIds.add(line.patientId);
    totals.set(segmentId, bucket);
  }
  return totals;
}

/**
 * GROSS PROFIT, never "net profit".
 *
 * Owner brief §6J: "Do not claim 'net profit' unless all overhead allocation
 * exists." It does not. Rent, salaries and utilities are not allocated to
 * segments anywhere in this system, so what this returns is revenue less
 * direct item cost — a contribution margin — and every field name says so.
 */
export function grossProfitCents(revenueCents: number, costCents: number): number {
  return revenueCents - costCents;
}

export function marginPercent(revenueCents: number, costCents: number): number | null {
  if (revenueCents === 0) return null;
  return Math.round(((revenueCents - costCents) / revenueCents) * 1000) / 10;
}
