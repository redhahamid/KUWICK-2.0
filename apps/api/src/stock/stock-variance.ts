import { MoneyLike, toCents } from '../finance/money';

/**
 * THE TWO PIECES OF STOCK ARITHMETIC, AS PURE FUNCTIONS.
 *
 * A transfer discrepancy and a stock-take variance are the only two places in
 * the system where a HUMAN's number is allowed to disagree with the ledger's,
 * and both decide whether stock moves. They lived inline in their services,
 * which meant the only way to test them was to stand up a database, and the
 * only way to reuse them was to write the rule again in the report that shows
 * them — which is how two screens end up counting discrepancies differently.
 *
 * Nothing here touches the database or knows what a Prisma model is. The
 * services keep the writing; this keeps the deciding.
 */

// --- TRANSFERS -------------------------------------------------------------

export interface TransferLineCounts {
  quantitySent: number;
  /** NULL until the receiving branch confirms. Absent is not zero. */
  quantityReceived: number | null;
}

/**
 * Did what arrived match what was sent?
 *
 * An unconfirmed line is NOT a discrepancy — it is stock in transit, which is
 * a different thing on a different screen. Collapsing the two would report
 * every transfer as broken the moment it left the building.
 */
export function isTransferDiscrepancy(line: TransferLineCounts): boolean {
  return line.quantityReceived !== null && line.quantityReceived !== line.quantitySent;
}

/**
 * How much of a line never arrived. Positive means short, negative means the
 * receiver counted MORE than was sent — which happens, and is just as much a
 * discrepancy to explain as a shortfall.
 */
export function transferShortfall(line: TransferLineCounts): number {
  if (line.quantityReceived === null) return 0;
  return line.quantitySent - line.quantityReceived;
}

export interface TransferSummary {
  totalSent: number;
  totalReceived: number;
  discrepancyCount: number;
  /** Net units that left one branch and never reached the other. */
  netShortfall: number;
  /** True once every line has been confirmed. */
  fullyConfirmed: boolean;
}

export function summariseTransfer(lines: TransferLineCounts[]): TransferSummary {
  return {
    totalSent: lines.reduce((total, line) => total + line.quantitySent, 0),
    totalReceived: lines.reduce((total, line) => total + (line.quantityReceived ?? 0), 0),
    discrepancyCount: lines.filter(isTransferDiscrepancy).length,
    netShortfall: lines.reduce((total, line) => total + transferShortfall(line), 0),
    fullyConfirmed: lines.length > 0 && lines.every((line) => line.quantityReceived !== null),
  };
}

// --- STOCK TAKES -----------------------------------------------------------

export interface StockTakeLineCounts {
  /** What the ledger said when the take was opened, frozen at that moment. */
  systemQuantity: number;
  /** NULL means nobody has counted this line yet. */
  countedQuantity: number | null;
  /** A second, more considered count. Supersedes the first when present. */
  recountQuantity?: number | null;
  /** Excluded lines are deliberately not posted. */
  excluded?: boolean;
  /** Cost per unit, for valuing the variance. NULL where no cost is on record. */
  unitCost?: MoneyLike | null;
}

/**
 * The count that actually counts.
 *
 * A recount supersedes the first count — that is the entire reason a recount
 * exists. Returns null when nobody has counted, which is NOT the same as
 * counting zero and must never be turned into a variance of minus everything.
 */
export function effectiveCount(line: StockTakeLineCounts): number | null {
  if (line.countedQuantity === null || line.countedQuantity === undefined) return null;
  return line.recountQuantity ?? line.countedQuantity;
}

/** Counted minus system. Null while uncounted. */
export function lineVariance(line: StockTakeLineCounts): number | null {
  const counted = effectiveCount(line);
  if (counted === null) return null;
  return counted - line.systemQuantity;
}

export interface StockTakeSummary {
  lineCount: number;
  countedCount: number;
  uncountedCount: number;
  varianceCount: number;
  excludedCount: number;
  /** Units the count would add (positive) or remove (negative) on posting. */
  netVarianceUnits: number;
  /** What that is worth, in cents, at each line's recorded unit cost. */
  varianceValueCents: number;
  /** Lines with a variance but no cost on record — the value is understated. */
  varianceLinesWithoutCost: number;
}

/**
 * What a take would do if it were posted now.
 *
 * Used by the list (to show what is pending), by the approval screen (to show
 * what is about to happen) and by the posting itself, so the number somebody
 * approves is the number that gets written.
 *
 * Excluded lines are counted as excluded and contribute nothing else: a line
 * somebody deliberately set aside must not quietly move stock.
 */
export function summariseStockTake(lines: StockTakeLineCounts[]): StockTakeSummary {
  let countedCount = 0;
  let varianceCount = 0;
  let excludedCount = 0;
  let netVarianceUnits = 0;
  let varianceValueCents = 0;
  let varianceLinesWithoutCost = 0;

  for (const line of lines) {
    if (line.excluded) {
      excludedCount += 1;
      continue;
    }
    const variance = lineVariance(line);
    if (variance === null) continue;
    countedCount += 1;
    if (variance === 0) continue;
    varianceCount += 1;
    netVarianceUnits += variance;
    if (line.unitCost === null || line.unitCost === undefined) {
      varianceLinesWithoutCost += 1;
      continue;
    }
    varianceValueCents += variance * toCents(line.unitCost);
  }

  return {
    lineCount: lines.length,
    countedCount,
    uncountedCount: lines.filter((line) => !line.excluded && effectiveCount(line) === null).length,
    varianceCount,
    excludedCount,
    netVarianceUnits,
    varianceValueCents,
    varianceLinesWithoutCost,
  };
}
