/**
 * PROCUREMENT PRICING AND SUPPLIER PERFORMANCE.
 *
 * Pure functions over plain inputs — no Prisma, no clock, no tenant. Every rule
 * here was read off the clinic's own order queue
 * (`docs/STOCK_LEGACY_WORKFLOW_AUDIT.md` §3), where it lives as a formula or a
 * column heading and nothing can measure it.
 */

import { MoneyLike, toCents } from '../finance/money';

/**
 * WHAT A LINE ACTUALLY COSTS.
 *
 * The clinic's order queue values every line at `MIN(unit price, bonus price)`.
 * Suppliers quote a list price and a promotion, and the clinic pays the lower
 * of the two — so the promotion is a real pricing rule, not a note.
 *
 * A NULL bonus means the supplier quoted no promotion, which is emphatically
 * not the same as a promotion of zero: treating an absent bonus as 0 would
 * value every line at nothing.
 */
export function effectiveUnitCostCents(unitCost: MoneyLike, bonusUnitCost?: MoneyLike | null): number {
  const unit = toCents(unitCost);
  if (bonusUnitCost === null || bonusUnitCost === undefined) return unit;
  const bonus = toCents(bonusUnitCost);
  return Math.min(unit, bonus);
}

/** `MIN(unit, bonus) × quantity`, in cents. */
export function lineCostCents(
  quantity: number,
  unitCost: MoneyLike,
  bonusUnitCost?: MoneyLike | null,
): number {
  return effectiveUnitCostCents(unitCost, bonusUnitCost) * quantity;
}

/** TRUE when a promotion exists AND is actually cheaper than the list price. */
export function promotionApplies(unitCost: MoneyLike, bonusUnitCost?: MoneyLike | null): boolean {
  if (bonusUnitCost === null || bonusUnitCost === undefined) return false;
  return toCents(bonusUnitCost) < toCents(unitCost);
}

/** What the promotion saved on a line, in cents. Zero when none applies. */
export function promotionSavingCents(
  quantity: number,
  unitCost: MoneyLike,
  bonusUnitCost?: MoneyLike | null,
): number {
  if (!promotionApplies(unitCost, bonusUnitCost)) return 0;
  return (toCents(unitCost) - toCents(bonusUnitCost as MoneyLike)) * quantity;
}

// ---------------------------------------------------------------------------
// SUPPLIER DELIVERY PERFORMANCE.
//
// "Received date (max 1 week)" is a supplier SLA living in a COLUMN HEADING in
// the clinic's order queue. Nothing measures it, so a supplier who is
// habitually late is a feeling rather than a fact.
// ---------------------------------------------------------------------------

export interface DeliveryPerformance {
  /** Calendar days from order to receipt. NULL if it has not arrived. */
  days: number | null;
  /** TRUE only when an SLA exists AND the delivery beat it. */
  withinSla: boolean;
  /** TRUE only when an SLA exists AND the delivery missed it. */
  breachedSla: boolean;
  /** FALSE when no SLA is configured — the delivery is neither on time nor late. */
  slaKnown: boolean;
  /** Days past the SLA. NULL when unknown or not yet received. */
  daysLate: number | null;
}

const DAY_MS = 86_400_000;

export function deliveryPerformance(
  orderedAt: Date,
  receivedAt: Date | null | undefined,
  slaDays: number | null | undefined,
): DeliveryPerformance {
  const slaKnown = slaDays !== null && slaDays !== undefined;
  if (!receivedAt) {
    return { days: null, withinSla: false, breachedSla: false, slaKnown, daysLate: null };
  }
  const days = Math.max(0, Math.floor((receivedAt.getTime() - orderedAt.getTime()) / DAY_MS));
  if (!slaKnown) {
    // Not knowing the SLA is not the same as meeting it. Both flags stay false.
    return { days, withinSla: false, breachedSla: false, slaKnown: false, daysLate: null };
  }
  const daysLate = days - (slaDays as number);
  return {
    days,
    withinSla: daysLate <= 0,
    breachedSla: daysLate > 0,
    slaKnown: true,
    daysLate,
  };
}

/**
 * HOW LIKELY TWO ITEM NAMES ARE TO BE THE SAME MEDICINE.
 *
 * Used before a new-item request creates anything. The clinic's request sheet
 * checks nothing, which is how a catalogue grows two entries for one medicine —
 * and two entries mean two stock levels, two costs, and a count that never
 * reconciles.
 *
 * Deliberately crude and deliberately NOT authoritative: it surfaces a
 * candidate for a person to look at, and the person decides. A confident
 * automatic merge on a fuzzy match would be far worse than a duplicate.
 */
export function normaliseItemName(name: string): string {
  return name
    .toLowerCase()
    // Strip strengths and pack sizes: "amoxicillin 500mg" and "amoxicillin
    // 500 mg cap" are the same medicine asked for twice.
    .replace(/\b\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|%)\b/g, ' ')
    .replace(/\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syr|syrup|susp|suspension|inj|injection|cream|oint|ointment)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A 0–1 similarity on normalised names, by shared word tokens. */
export function nameSimilarity(a: string, b: string): number {
  const left = new Set(normaliseItemName(a).split(' ').filter(Boolean));
  const right = new Set(normaliseItemName(b).split(' ').filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

/** The catalogue entry a requested name most likely already is, if any. */
export function findPossibleDuplicate<T extends { id: string; name: string }>(
  requestedName: string,
  catalogue: T[],
  threshold = 0.6,
): { item: T; similarity: number } | null {
  let best: { item: T; similarity: number } | null = null;
  for (const item of catalogue) {
    const similarity = nameSimilarity(requestedName, item.name);
    if (similarity >= threshold && (best === null || similarity > best.similarity)) {
      best = { item, similarity };
    }
  }
  return best;
}
