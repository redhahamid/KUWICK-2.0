/**
 * THE DIVISOR, AND WHETHER ANYBODY HAS ACTUALLY STATED IT.
 *
 * `ceil(clinical ÷ divisor)` is the whole of the dispense-quantity arithmetic,
 * and the audit (docs/seed-review/medicine-pricing-divisors.csv) found the
 * divisor missing on 149 of 242 rows. So the interesting question is not "what
 * is the number" — it is "is there one, and where did it come from", because
 * the wrong answer to that bills a 5-day course as 40 boxes without a word.
 *
 * ONE function, exported, because there are three readers coming: the
 * inventory list's NEEDS ATTENTION marker, the edit form, and the pricing
 * formula itself. Three implementations of clinic-over-import precedence is
 * three chances for the screen to say one thing and the bill to do another.
 */

/** What the row's divisor is standing on. */
export type DivisorSource =
  /** The clinic's own `quantityPerStockUnit` — 1E, and the one that wins. */
  | 'CLINIC'
  /** `unitsPerPack`, parsed at import from the source's pack string. */
  | 'IMPORT'
  /** Nothing. Not zero, not one — nobody has said. */
  | 'NONE';

/** Why a row is on the pricing worklist. Null when it is not. */
export type DivisorAttention =
  /** No divisor anywhere. `ceil(clinical ÷ null)` cannot be priced. */
  | 'NO_DIVISOR'
  /**
   * The divisor is 1 and nobody has declared this item dispensed whole.
   *
   * A 1 arrived at by a person looking at a bottle and a 1 sitting in the
   * column because a spreadsheet's pack string happened to start with one are
   * the same number and opposite facts. The second is the one that silently
   * prices a 30-tablet course as 30 boxes.
   */
  | 'UNCONFIRMED_ONE';

export interface DivisorRow {
  quantityPerStockUnit?: number | null;
  unitsPerPack?: number | null;
  dispensedWholeAt?: Date | string | null;
}

export interface DivisorFacts {
  /** The number the dispense maths divides by. Null means it cannot. */
  divisor: number | null;
  source: DivisorSource;
  /** Somebody at this clinic said this item is handed over whole. */
  dispensedWhole: boolean;
  /** Set when this row belongs on the pricing worklist. */
  attention: DivisorAttention | null;
}

/**
 * Clinic over import, and the reason is 1E's: only the clinic knows whether
 * THEIR strips hold 10 or 12. The import's number is a parse of somebody
 * else's packaging string and it yields the moment a person here disagrees.
 *
 * A non-positive divisor is treated as absent rather than trusted. Zero would
 * divide by zero and a negative would price a course as a refund; neither is a
 * number anybody meant, and the honest reading of both is "not stated".
 */
export function divisorFacts(row: DivisorRow): DivisorFacts {
  const clinic = positive(row.quantityPerStockUnit);
  const imported = positive(row.unitsPerPack);
  const dispensedWhole = row.dispensedWholeAt != null;

  const divisor = clinic ?? imported ?? null;
  const source: DivisorSource = clinic != null ? 'CLINIC' : imported != null ? 'IMPORT' : 'NONE';

  return { divisor, source, dispensedWhole, attention: attentionFor(divisor, dispensedWhole) };
}

/**
 * The worklist rule, in one place.
 *
 * The UNCONFIRMED_ONE half applies to an IMPORT-sourced 1 as well as a
 * clinic-typed one, and that is deliberate: the source spreadsheet's pack
 * string is not somebody at this clinic saying "this bottle goes over the
 * counter whole". Today it costs exactly ONE extra row across the whole
 * 242-row catalogue — the rule is here for the curation pass, where the
 * temptation is to clear 149 blanks by typing 1 into all of them.
 */
function attentionFor(divisor: number | null, dispensedWhole: boolean): DivisorAttention | null {
  if (divisor == null) return 'NO_DIVISOR';
  if (divisor === 1 && !dispensedWhole) return 'UNCONFIRMED_ONE';
  return null;
}

/** What the screen says about a row that needs attention. */
export function divisorAttentionReason(attention: DivisorAttention): string {
  return attention === 'NO_DIVISOR'
    ? 'No quantity per stock unit — this item cannot be priced per dispense until somebody states how many are in a pack.'
    : 'Quantity per stock unit is 1, and nobody has confirmed this item is dispensed whole. Confirm it, or state the real count.';
}

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
