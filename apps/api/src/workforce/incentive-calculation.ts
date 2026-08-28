import { MoneyLike, percentOfCents, toCents } from '../finance/money';

/**
 * DOCTOR INCENTIVES — the calculation, kept pure and versioned.
 *
 * Parked since Phase 1c on Open Question #2 ("the exact formula semantics need
 * a worked numeric example before this can be built correctly, since it's a
 * compensation calculation"). The brief supplies the semantics:
 *
 *   SALES COMMISSION: threshold + flat amount + percentage above threshold
 *   PROCEDURE:        a rate per qualifying procedure, which may differ for a
 *                     resident and a locum
 *
 * THE PROPERTY THAT MATTERS MOST is not the formula, it is reproducibility. A
 * paid incentive must never be recalculated with today's rules — so a rule is
 * never edited, only superseded by a new version, and every result stores the
 * version and a snapshot of the rule it was computed under.
 */

export interface SalesCommissionRule {
  thresholdAmount?: MoneyLike | null;
  flatAmount?: MoneyLike | null;
  percentAbove?: MoneyLike | null;
}

export interface SalesCommissionResult {
  basisCents: number;
  thresholdCents: number;
  /** Whether the threshold was reached at all. Below it, nothing is earned. */
  qualified: boolean;
  flatCents: number;
  aboveThresholdCents: number;
  percentCents: number;
  totalCents: number;
  /** The workings, so a doctor asking "why this number" gets an answer. */
  explanation: string;
}

/**
 * Threshold + flat + percentage of the excess.
 *
 * TWO EDGE CASES, both decided explicitly rather than by accident:
 *
 *  - EXACTLY at the threshold QUALIFIES. "Sales above RM30,000" would be a
 *    different rule and would be written with a higher threshold; a doctor who
 *    lands on the number exactly should not lose the whole commission to a
 *    strict inequality.
 *  - The percentage applies ONLY to the excess, never to the whole. Applying
 *    it to the whole would produce a cliff at the threshold where one more
 *    ringgit of sales is worth hundreds.
 */
export function computeSalesCommission(salesAmount: MoneyLike, rule: SalesCommissionRule): SalesCommissionResult {
  const basisCents = toCents(salesAmount);
  const thresholdCents = toCents(rule.thresholdAmount ?? 0);
  const qualified = basisCents >= thresholdCents;

  if (!qualified) {
    return {
      basisCents,
      thresholdCents,
      qualified: false,
      flatCents: 0,
      aboveThresholdCents: 0,
      percentCents: 0,
      totalCents: 0,
      explanation: `Sales did not reach the threshold, so no commission is earned.`,
    };
  }

  const flatCents = toCents(rule.flatAmount ?? 0);
  const aboveThresholdCents = basisCents - thresholdCents;
  const percentCents = rule.percentAbove ? percentOfCents(aboveThresholdCents, rule.percentAbove) : 0;

  return {
    basisCents,
    thresholdCents,
    qualified: true,
    flatCents,
    aboveThresholdCents,
    percentCents,
    totalCents: flatCents + percentCents,
    explanation:
      `Threshold reached. Flat amount` +
      (rule.percentAbove ? `, plus ${String(rule.percentAbove)}% of the amount above the threshold.` : `.`),
  };
}

export interface ProcedureRule {
  perProcedureAmount?: MoneyLike | null;
  perProcedurePercent?: MoneyLike | null;
  serviceCatalogIds?: string[];
  excludedServiceCatalogIds?: string[];
}

export interface ProcedureLine {
  serviceCatalogId: string | null;
  /** What was billed for it, for a percentage-based rate. */
  amount: MoneyLike;
  quantity?: number;
}

export interface ProcedureIncentiveResult {
  qualifyingCount: number;
  qualifyingAmountCents: number;
  totalCents: number;
  excludedCount: number;
  explanation: string;
}

/**
 * A rate per qualifying procedure.
 *
 * QUALIFICATION IS AN ALLOW-LIST when `serviceCatalogIds` is non-empty, and
 * everything-minus-exclusions when it is empty. Both are useful — "these six
 * procedures pay a bonus" and "everything except consultations" are the two
 * ways clinics actually write it — and which one applies is decided by whether
 * the allow-list was filled in, not by a second flag somebody has to remember.
 *
 * The exclusion list always wins, so a service on both lists does not pay.
 */
export function computeProcedureIncentive(lines: ProcedureLine[], rule: ProcedureRule): ProcedureIncentiveResult {
  const allow = new Set(rule.serviceCatalogIds ?? []);
  const deny = new Set(rule.excludedServiceCatalogIds ?? []);
  const useAllowList = allow.size > 0;

  let qualifyingCount = 0;
  let qualifyingAmountCents = 0;
  let excludedCount = 0;

  for (const line of lines) {
    const quantity = line.quantity ?? 1;
    const id = line.serviceCatalogId;
    if (!id) continue;
    if (deny.has(id) || (useAllowList && !allow.has(id))) {
      excludedCount += quantity;
      continue;
    }
    qualifyingCount += quantity;
    qualifyingAmountCents += toCents(line.amount);
  }

  const perProcedureCents = toCents(rule.perProcedureAmount ?? 0) * qualifyingCount;
  const percentCents = rule.perProcedurePercent
    ? percentOfCents(qualifyingAmountCents, rule.perProcedurePercent)
    : 0;

  return {
    qualifyingCount,
    qualifyingAmountCents,
    totalCents: perProcedureCents + percentCents,
    excludedCount,
    explanation: useAllowList
      ? `Paid on ${qualifyingCount} procedure(s) from this rule's qualifying list.`
      : `Paid on ${qualifyingCount} procedure(s); ${excludedCount} excluded by this rule.`,
  };
}

export interface RuleWindow {
  effectiveFrom: Date | string;
  effectiveTo?: Date | string | null;
  version: number;
  active?: boolean;
}

/**
 * The rule version in force for a period.
 *
 * A period is matched by its FIRST DAY: an incentive run for August is
 * computed under whichever rule was in force on 1 August, and a rule that
 * starts mid-month applies from the following month. Prorating a compensation
 * rule inside a month is a policy nobody asked for and a source of disputes.
 */
export function ruleInForce<T extends RuleWindow>(rules: T[], periodStart: Date): T | null {
  const day = Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 1);
  let best: T | null = null;
  for (const rule of rules) {
    if (rule.active === false) continue;
    const from = new Date(rule.effectiveFrom);
    const fromDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    if (fromDay > day) continue;
    if (rule.effectiveTo) {
      const to = new Date(rule.effectiveTo);
      if (Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) < day) continue;
    }
    if (!best || rule.version > best.version) best = rule;
  }
  return best;
}
