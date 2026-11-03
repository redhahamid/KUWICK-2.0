/**
 * DOES A PANEL'S FEE SPLIT BY DATE, OR INTERLEAVE? (G-8)
 *
 * The owner's instruction of 3 November 2026, on the one panel whose workbook
 * shows two fee values across 2,268 claims: "First check whether the values
 * split by date. If yes, it is PanelFeeTerm history (no new feature). If not,
 * per-claim override with a required reason."
 *
 * This is the deciding rule, kept here as pure arithmetic so it can be tested
 * against cases nobody has imported yet. `prisma/reports/panel-fee-value-
 * variance.ts` reads the claims and hands them over.
 *
 * WHY IT IS COMPUTED AT ALL. `PANEL_LEGACY_WORKFLOW_AUDIT.md` §4.2 records the
 * counts — "2,261 claims at one fee value, 7 at a different one" — and not the
 * dates. A count cannot tell a fee that changed in March from seven typing
 * mistakes, and the two lead to opposite builds: one is effective-dated
 * history that already ships, the other is a feature that does not exist.
 */

/** Claims sharing one implied fee rate, and the dates they span. */
export interface FeeRateGroup {
  /** Flat ringgit for an AMOUNT panel, percent of the claim for a PERCENT one. */
  rate: number;
  claims: number;
  /** ISO dates. NULL when no claim in the group carries a service date. */
  from: string | null;
  to: string | null;
}

export type FeeVarianceVerdict =
  /** One rate. Nothing to decide. */
  | 'SINGLE'
  /** The ranges do not overlap: the rate CHANGED on a date. `PanelFeeTerm`
      already handles this, so there is no feature to build. */
  | 'BY_DATE'
  /** The ranges overlap: two rates were genuinely in use at once, which needs
      the per-claim override with a required reason. */
  | 'INTERLEAVED'
  /** One rate holds nearly every claim and the rest is a handful. Reported
      apart from a tier because §4.2 found floating-point dust and another
      panel's fee value pasted into five rows — damage a tier table would
      enshrine as a rule. */
  | 'STRAY'
  /** Some rate has no dated claim, so the date question cannot be answered.
      Said rather than guessed. */
  | 'UNDATED';

/** A handful of claims against thousands is damage, not a tier. */
export const STRAY_SHARE = 0.02;
export const STRAY_COUNT = 20;

export function classifyFeeVariance(groups: FeeRateGroup[]): FeeVarianceVerdict {
  if (groups.length <= 1) return 'SINGLE';

  const total = groups.reduce((sum, group) => sum + group.claims, 0);
  const minor = groups.filter(
    (group) => group.claims / total < STRAY_SHARE && group.claims < STRAY_COUNT,
  );
  // Every group but one is a handful: one rate is the panel's, the rest is dust.
  if (minor.length === groups.length - 1) return 'STRAY';

  if (groups.some((group) => group.from === null || group.to === null)) return 'UNDATED';

  const sorted = [...groups].sort((a, b) => (a.from! < b.from! ? -1 : 1));
  for (let index = 1; index < sorted.length; index += 1) {
    // Touching on the same day counts as overlapping: two rates on one day is
    // not a changeover, it is two rates.
    if (sorted[index].from! <= sorted[index - 1].to!) return 'INTERLEAVED';
  }
  return 'BY_DATE';
}

export const FEE_VARIANCE_ADVICE: Record<FeeVarianceVerdict, string> = {
  SINGLE: 'One fee value. Nothing to decide.',
  BY_DATE:
    'The value CHANGED on a date. This is `PanelFeeTerm` history, which already exists — ' +
    'record the terms with their effective dates. NO NEW FEATURE.',
  INTERLEAVED:
    'Two values were in use at the SAME time. Needs a per-claim fee override with a ' +
    'required reason (G-8).',
  STRAY:
    'One value holds almost every claim; the rest is a handful. Probably transcription ' +
    'damage, not a tier — open the named claims before building anything.',
  UNDATED:
    'Some claims carry no service date, so the dates cannot be compared. Import the ' +
    'missing dates, or answer this panel by hand.',
};

/**
 * The fee rate one claim implies.
 *
 * A PERCENT panel is compared as a percentage of what was claimed, because the
 * ringgit differ on every claim by design and would read as hundreds of tiers.
 * Everything else is compared as flat ringgit.
 */
export function impliedRate(
  feeType: 'PERCENT' | 'AMOUNT' | null,
  claimedAmount: number,
  feeAmount: number,
): number {
  if (feeType === 'PERCENT' && claimedAmount > 0) {
    return Math.round((feeAmount / claimedAmount) * 10000) / 100;
  }
  return Math.round(feeAmount * 100) / 100;
}
