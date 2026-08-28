import {
  effectiveCount,
  isTransferDiscrepancy,
  lineVariance,
  summariseStockTake,
  summariseTransfer,
  transferShortfall,
} from './stock-variance';

/**
 * The two places a human's number is allowed to disagree with the ledger.
 * Both decide whether stock moves, so both are tested against the cases that
 * actually happen in a clinic rather than against tidy ones.
 */
describe('transfer discrepancies', () => {
  it('a line nobody has confirmed is in transit, not broken', () => {
    // The most consequential distinction here. Treating unconfirmed as a
    // discrepancy would report every transfer as failed the moment it left.
    const line = { quantitySent: 30, quantityReceived: null };
    expect(isTransferDiscrepancy(line)).toBe(false);
    expect(transferShortfall(line)).toBe(0);
  });

  it('a line that arrived intact is not a discrepancy', () => {
    expect(isTransferDiscrepancy({ quantitySent: 30, quantityReceived: 30 })).toBe(false);
  });

  it('a short delivery is a discrepancy, and says how short', () => {
    const line = { quantitySent: 25, quantityReceived: 23 };
    expect(isTransferDiscrepancy(line)).toBe(true);
    expect(transferShortfall(line)).toBe(2);
  });

  it('receiving MORE than was sent is equally a discrepancy', () => {
    // It happens — a box counted wrong at the sending end — and it needs
    // explaining just as much as a shortfall does.
    const line = { quantitySent: 20, quantityReceived: 22 };
    expect(isTransferDiscrepancy(line)).toBe(true);
    expect(transferShortfall(line)).toBe(-2);
  });

  it('receiving nothing at all is a discrepancy, not an absence', () => {
    // Zero received is a CONFIRMED zero: somebody looked in the box and it was
    // empty. That is the strongest discrepancy there is.
    const line = { quantitySent: 12, quantityReceived: 0 };
    expect(isTransferDiscrepancy(line)).toBe(true);
    expect(transferShortfall(line)).toBe(12);
  });

  it('summarises a mixed transfer', () => {
    const summary = summariseTransfer([
      { quantitySent: 30, quantityReceived: 30 },
      { quantitySent: 25, quantityReceived: 23 },
      { quantitySent: 10, quantityReceived: null },
    ]);
    expect(summary.totalSent).toBe(65);
    expect(summary.totalReceived).toBe(53);
    expect(summary.discrepancyCount).toBe(1);
    expect(summary.netShortfall).toBe(2);
    // Not everything has been confirmed, so the transfer is not finished.
    expect(summary.fullyConfirmed).toBe(false);
  });

  it('is only fully confirmed once every line has an answer', () => {
    expect(summariseTransfer([{ quantitySent: 5, quantityReceived: 5 }]).fullyConfirmed).toBe(true);
    expect(summariseTransfer([]).fullyConfirmed).toBe(false);
  });
});

describe('stock take variance', () => {
  it('an uncounted line has no variance, and is not a variance of minus everything', () => {
    // The failure this guards against: treating "nobody counted it" as
    // "counted zero" would post a movement wiping the item off the shelf.
    const line = { systemQuantity: 40, countedQuantity: null };
    expect(effectiveCount(line)).toBeNull();
    expect(lineVariance(line)).toBeNull();
  });

  it('counting zero IS a count, and IS a variance', () => {
    const line = { systemQuantity: 40, countedQuantity: 0 };
    expect(effectiveCount(line)).toBe(0);
    expect(lineVariance(line)).toBe(-40);
  });

  it('a recount supersedes the first count', () => {
    // That is the whole reason a recount exists: it is the more considered
    // number, taken because the first one was doubted.
    const line = { systemQuantity: 100, countedQuantity: 82, recountQuantity: 97 };
    expect(effectiveCount(line)).toBe(97);
    expect(lineVariance(line)).toBe(-3);
  });

  it('a recount of zero still supersedes, rather than falling back', () => {
    // `recount ?? counted` is right and `recount || counted` is not — the
    // second silently ignores a recount that found an empty shelf.
    const line = { systemQuantity: 20, countedQuantity: 18, recountQuantity: 0 };
    expect(effectiveCount(line)).toBe(0);
    expect(lineVariance(line)).toBe(-20);
  });

  it('values the variance at each line own cost', () => {
    const summary = summariseStockTake([
      { systemQuantity: 100, countedQuantity: 96, unitCost: 3.4 },
      { systemQuantity: 50, countedQuantity: 50, unitCost: 9 },
    ]);
    expect(summary.countedCount).toBe(2);
    expect(summary.varianceCount).toBe(1);
    expect(summary.netVarianceUnits).toBe(-4);
    // -4 × RM3.40 = -RM13.60
    expect(summary.varianceValueCents).toBe(-1360);
    expect(summary.varianceLinesWithoutCost).toBe(0);
  });

  it('reports a variance with no cost separately rather than valuing it at zero', () => {
    // Valuing an unknown cost at nothing makes the loss look smaller than it
    // is. The count is reported so the reader knows the figure is understated.
    const summary = summariseStockTake([
      { systemQuantity: 10, countedQuantity: 7, unitCost: null },
      { systemQuantity: 10, countedQuantity: 8, unitCost: 2 },
    ]);
    expect(summary.varianceCount).toBe(2);
    expect(summary.varianceValueCents).toBe(-400);
    expect(summary.varianceLinesWithoutCost).toBe(1);
  });

  it('an excluded line moves no stock and is not counted as a variance', () => {
    const summary = summariseStockTake([
      { systemQuantity: 10, countedQuantity: 4, unitCost: 5, excluded: true },
      { systemQuantity: 10, countedQuantity: 9, unitCost: 5 },
    ]);
    expect(summary.excludedCount).toBe(1);
    expect(summary.varianceCount).toBe(1);
    expect(summary.netVarianceUnits).toBe(-1);
    expect(summary.varianceValueCents).toBe(-500);
  });

  it('counts what is still outstanding, so a take cannot be posted half-counted by accident', () => {
    const summary = summariseStockTake([
      { systemQuantity: 10, countedQuantity: 10 },
      { systemQuantity: 5, countedQuantity: null },
      { systemQuantity: 8, countedQuantity: null, excluded: true },
    ]);
    expect(summary.lineCount).toBe(3);
    expect(summary.countedCount).toBe(1);
    // The excluded one is not outstanding — somebody decided about it.
    expect(summary.uncountedCount).toBe(1);
  });

  it('a surplus is a variance too, and adds stock back', () => {
    const summary = summariseStockTake([{ systemQuantity: 12, countedQuantity: 15, unitCost: 4 }]);
    expect(summary.netVarianceUnits).toBe(3);
    expect(summary.varianceValueCents).toBe(1200);
  });

  it('an empty take summarises to nothing rather than throwing', () => {
    const summary = summariseStockTake([]);
    expect(summary).toMatchObject({ lineCount: 0, countedCount: 0, varianceCount: 0, varianceValueCents: 0 });
  });
});
