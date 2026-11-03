import { classifyFeeVariance, impliedRate, type FeeRateGroup } from './fee-value-variance';

/**
 * THE RULE THAT DECIDES WHETHER G-8 IS A FEATURE AT ALL.
 *
 * The owner's instruction of 3 November 2026: if a panel's two fee values
 * split by date it is `PanelFeeTerm` history and nothing needs building; if
 * they do not, it needs a per-claim override with a required reason. Getting
 * this backwards means either building a feature that is not needed, or
 * recording two simultaneous fee rates as one that changed — which would make
 * every claim on the wrong side of the date read as the wrong amount.
 *
 * The cases below are the shapes `PANEL_LEGACY_WORKFLOW_AUDIT.md` §4.2 found
 * in the real workbook, with dates supplied, because the workbook records the
 * counts and not the dates.
 */
const group = (rate: number, claims: number, from: string | null, to = from): FeeRateGroup => ({
  rate,
  claims,
  from,
  to,
});

describe('classifying a panel whose fee value varies', () => {
  it('has nothing to decide about one value', () => {
    expect(classifyFeeVariance([group(8, 2261, '2026-01-01', '2026-10-31')])).toBe('SINGLE');
  });

  it('has nothing to decide about a panel with no claims at all', () => {
    expect(classifyFeeVariance([])).toBe('SINGLE');
  });

  /**
   * The answer that means NO NEW FEATURE: a contract that changed on a date.
   */
  it('reads two values in consecutive periods as a term change', () => {
    expect(
      classifyFeeVariance([
        group(8, 1200, '2026-01-01', '2026-05-31'),
        group(10, 900, '2026-06-01', '2026-10-31'),
      ]),
    ).toBe('BY_DATE');
  });

  /**
   * The answer that DOES need the feature: both rates in use at once. No
   * effective date can describe this, because there is no date on which one
   * replaced the other.
   */
  it('reads two values over the same months as genuinely simultaneous', () => {
    expect(
      classifyFeeVariance([
        group(8, 1200, '2026-01-01', '2026-10-31'),
        group(10, 900, '2026-03-01', '2026-09-30'),
      ]),
    ).toBe('INTERLEAVED');
  });

  /**
   * Two rates on one day is not a changeover. Were this read as BY_DATE, the
   * day of the switch would be ambiguous and one of the two rates would be
   * recorded as never having applied.
   */
  it('treats ranges that touch on a single day as simultaneous', () => {
    expect(
      classifyFeeVariance([
        group(8, 1200, '2026-01-01', '2026-06-01'),
        group(10, 900, '2026-06-01', '2026-10-31'),
      ]),
    ).toBe('INTERLEAVED');
  });

  /**
   * §4.2's actual finding on the biggest panel: 2,261 claims at one value and
   * 7 at another. A tier table built on that would enshrine seven typing
   * mistakes as a commercial rule.
   */
  it('calls a handful of odd claims damage rather than a second tier', () => {
    expect(
      classifyFeeVariance([
        group(8, 2261, '2026-01-01', '2026-10-31'),
        group(7.8, 7, '2026-02-02', '2026-09-14'),
      ]),
    ).toBe('STRAY');
  });

  /** §4.2's other panel: 1,358 exact, 65 carrying floating-point dust, 5 at
      another panel's fee value. Three groups, two of them handfuls. */
  it('calls several handfuls damage too', () => {
    expect(
      classifyFeeVariance([
        group(8, 1358, '2026-01-01', '2026-10-31'),
        group(7.8, 15, '2026-02-01', '2026-08-01'),
        group(4.31, 5, '2026-03-01', '2026-07-01'),
      ]),
    ).toBe('STRAY');
  });

  /**
   * A real second tier is NOT a handful, so it must not be dismissed as one
   * merely because it is the smaller of the two.
   */
  it('does not dismiss a substantial minority as damage', () => {
    expect(
      classifyFeeVariance([
        group(8, 1200, '2026-01-01', '2026-05-31'),
        group(10, 300, '2026-06-01', '2026-10-31'),
      ]),
    ).toBe('BY_DATE');
  });

  /**
   * An imported claim may carry no service date (`legacyServiceDate` is
   * nullable precisely because the workbook does not always have one). The
   * date question then has no answer, and saying so beats inventing one.
   */
  it('refuses to answer when a rate has no dated claim', () => {
    expect(
      classifyFeeVariance([
        group(8, 1200, '2026-01-01', '2026-05-31'),
        group(10, 900, null, null),
      ]),
    ).toBe('UNDATED');
  });
});

describe('the fee rate a claim implies', () => {
  it('is flat ringgit for a per-claim fee', () => {
    expect(impliedRate('AMOUNT', 100, 8)).toBe(8);
    // The same ringgit whatever the claim is worth — which is what makes a
    // flat fee comparable across claims at all.
    expect(impliedRate('AMOUNT', 450.5, 8)).toBe(8);
  });

  it('is a percentage for a percentage fee', () => {
    expect(impliedRate('PERCENT', 100, 10)).toBe(10);
    // Were a percentage panel compared in ringgit, every claim would look like
    // its own tier and the report would be unreadable.
    expect(impliedRate('PERCENT', 250, 25)).toBe(10);
    expect(impliedRate('PERCENT', 37.5, 5.63)).toBe(15.01);
  });

  /** A claim of zero cannot imply a percentage, and dividing by it would
      produce Infinity and a group nobody can interpret. */
  it('falls back to ringgit when the claim is zero', () => {
    expect(impliedRate('PERCENT', 0, 8)).toBe(8);
  });

  it('treats an unconfigured fee type as flat ringgit', () => {
    expect(impliedRate(null, 100, 8)).toBe(8);
  });
});
