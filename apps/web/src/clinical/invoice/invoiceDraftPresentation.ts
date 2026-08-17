import { InvoiceDraft, InvoiceDraftLine } from '../types';

/**
 * b4 PIECE B — how the draft invoice READS, and nothing else.
 *
 * Every number and every judgement in here arrives from the server's draft
 * (`invoice-draft.ts`). This file groups, orders and words it. In particular
 * it does NOT decide whether a visit carries a consultation charge — that is
 * `consultation-tariff.ts`'s answer, delivered as a line with a state and a
 * reason, and this file's only job is to print the reason the server gave.
 */

export type DraftGroupKey = 'CONSULTATION' | 'MEDICATION' | 'ORDER' | 'SERVICE';

export interface DraftGroup {
  key: DraftGroupKey;
  /** The rail card this group's lines come from, named the same way. */
  title: string;
  lines: InvoiceDraftLine[];
  /** Sum of the counted amounts in this group. */
  amount: number;
  /**
   * b4 PIECE C — whether anything in this group is actually being charged.
   *
   * FALSE is not the same as an amount of zero, and the difference is the
   * whole point: a group with nothing counted in it — an OTC visit's
   * consultation, a procedure that has not been done, a consultation the
   * clinic has no tariff for — must read as "No charge" and never as
   * "RM 0.00", which reads as a thing the clinic gave away for free.
   */
  charged: boolean;
}

/**
 * The reading order of the itemised breakdown: the consultation first
 * (it is the charge that is there on every visit and the one a doctor is
 * most often checking), then the three rail cards in the rail's own order.
 * A breakdown ordered differently from the cards it summarises makes the
 * reader map between two orders to check one figure.
 */
const GROUP_TITLES: Array<[DraftGroupKey, string]> = [
  ['CONSULTATION', 'Consultation'],
  ['SERVICE', 'Direct Services'],
  ['ORDER', 'Orders / Procedures'],
  ['MEDICATION', 'Medications'],
];

/**
 * ORDER vs SERVICE is `ServicesRail`'s distinction, and it is made the same
 * way here: `OrderService.orderType` is snapshotted from the catalogue, and
 * a STANDARD_SERVICE is a direct service while a TASK_ORDER is a procedure.
 * The draft carries the source type; the server's worklist does not split the
 * two, so the split is made from what the line describes about itself.
 */
export function groupKeyFor(line: InvoiceDraftLine): DraftGroupKey {
  if (line.sourceType === 'CONSULTATION') return 'CONSULTATION';
  if (line.sourceType === 'PRESCRIPTION') return 'MEDICATION';
  return line.orderType === 'STANDARD_SERVICE' ? 'SERVICE' : 'ORDER';
}

export function groupDraftLines(draft: InvoiceDraft | undefined): DraftGroup[] {
  if (!draft) return [];
  return GROUP_TITLES.map(([key, title]) => {
    const lines = draft.lines.filter((line) => groupKeyFor(line) === key);
    const counted = lines.filter((line) => line.counted && line.amount != null);
    return {
      key,
      title,
      lines,
      amount: round2(counted.reduce((sum, line) => sum + (line.amount as number), 0)),
      charged: counted.length > 0,
    };
  }).filter((group) => group.lines.length > 0);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** RM, two places, always — a running total that drops a trailing zero reads as a different number. */
export function money(value: number | null): string {
  if (value == null) return '—';
  return `RM ${value.toFixed(2)}`;
}

/**
 * What the slim bar says at rest, in one line.
 *
 * The total is the headline. The two qualifications that change what the
 * number MEANS are said beside it rather than left for the expansion:
 * a discount is applied, and some chargeable work has no price yet. A running
 * total that silently omits an unpriced item is a total that is wrong by an
 * unknown amount, and the bar must not present it as complete.
 */
export interface DraftBarSummary {
  total: string;
  /** e.g. "4 items" — what the total is made of. */
  itemsLabel: string;
  discountLabel: string | null;
  /**
   * b4 PIECE C (2b) — "1 item not priced", NAMED.
   *
   * It said "N items outstanding" beside a total, and a doctor could not tell
   * which of two different problems they had. This one means THE TOTAL IS
   * INCOMPLETE: something chargeable has no price, so the figure beside it is
   * wrong by an unknown amount.
   *
   * It also now COUNTS THE RIGHT THINGS. The server's `unpricedCount` is
   * counted-lines-whose-price-failed, which excludes the case this chip was
   * built for: a medicine whose supply mode is undecided (D-091) is listed,
   * unpriced and UNCOUNTED, so the chip never fired on the very state it
   * exists to report. An undecided supply is exactly "not priced yet".
   */
  unpricedLabel: string | null;
  /**
   * b4 PIECE C (2b) — "1 medicine to dispense". A DIFFERENT FACT from the one
   * above and a different action: the price is known and in the total; what
   * has not happened is the patient receiving it.
   */
  toDispenseLabel: string | null;
  /** Screen-reader wording for the whole bar, since the visual is terse. */
  ariaLabel: string;
}

/** "1 item" / "3 items", for a noun that pluralises with an s. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function draftBarSummary(draft: InvoiceDraft | undefined): DraftBarSummary {
  if (!draft) {
    return {
      total: money(null),
      itemsLabel: 'Draft invoice',
      discountLabel: null,
      unpricedLabel: null,
      toDispenseLabel: null,
      ariaLabel: 'Draft invoice — total not available yet',
    };
  }
  const counted = draft.lines.filter((line) => line.counted).length;
  const itemsLabel = counted === 1 ? '1 item' : `${counted} items`;
  const discountLabel = draft.discount
    ? `less ${money(draft.discount.amount)} discount`
    : null;

  // Counted-but-unpriced (the server's own count) PLUS the undecided supplies,
  // which are unpriced and uncounted and were therefore invisible to it. Not
  // the consultation gap: that has its own wording, and counting it twice
  // would make one problem look like two.
  const undecidedSupply = draft.lines.filter(
    (line) => line.state === 'UNRESOLVED_SUPPLY' && line.amount == null,
  ).length;
  const notPriced = draft.unpricedCount + undecidedSupply;
  const unpricedLabel = notPriced > 0 ? `${plural(notPriced, 'item')} not priced` : null;

  const awaitingDispense = draft.lines.filter((line) => line.state === 'AWAITING_DISPENSE').length;
  const toDispenseLabel =
    awaitingDispense > 0 ? `${plural(awaitingDispense, 'medicine')} to dispense` : null;

  return {
    total: money(draft.total),
    itemsLabel,
    discountLabel,
    unpricedLabel,
    toDispenseLabel,
    ariaLabel: [
      `Draft invoice, ${itemsLabel}, total ${money(draft.total)}`,
      discountLabel,
      unpricedLabel && `${unpricedLabel} — the total is incomplete`,
      toDispenseLabel && `${toDispenseLabel} — not yet received by the patient`,
    ]
      .filter(Boolean)
      .join(', '),
  };
}

/**
 * b4 PIECE C (2a) — IS THE CONSULTATION BEING CHARGED, AND IF NOT, IS THAT A
 * DECISION OR A GAP?
 *
 * Two of these mean the clinic decided: an OTC visit carries no consultation
 * charge (NOT_CHARGEABLE) and a waived one was waived by somebody with a
 * reason. Two mean nobody decided anything — the branch has no consultation
 * tariff at all (NOT_CONFIGURED), or its rules do not cover the hour this
 * consultation started (TARIFF_REVIEW). The second pair is a fee the clinic
 * meant to charge and is not charging, which is what the staging report turned
 * out to be, so it is named on the card at rest rather than left inside the
 * itemised detail.
 */
export function consultationGap(draft: InvoiceDraft | undefined): string | null {
  const line = (draft?.lines ?? []).find((item) => item.sourceType === 'CONSULTATION');
  if (!line || line.counted) return null;
  if (line.state === 'NOT_CONFIGURED' || line.state === 'TARIFF_REVIEW') {
    return 'Consultation not charged';
  }
  return null;
}

/**
 * The right-hand note on a line that carries no amount. The server's own
 * `stateReason` where it gave one — its words, not a re-wording — and a short
 * fallback for the states that carry none.
 */
export function lineNote(line: InvoiceDraftLine): string | null {
  if (line.counted && line.amount != null) return null;
  if (line.stateReason) return line.stateReason;
  if (line.amount == null) return 'No price could be established for this item.';
  return null;
}

/**
 * Whether the discount control can do anything, and what to say when it
 * cannot. The RULE is the server's (`InvoiceDraftService.applyDiscount`
 * refuses when the visit has no open invoice, and the permission is
 * `billing.corrections`); this only decides whether to offer the control or
 * the explanation.
 */
export function discountAvailability(draft: InvoiceDraft | undefined): {
  available: boolean;
  reason: string | null;
} {
  if (!draft) return { available: false, reason: null };
  if (!draft.invoiceId) {
    return {
      available: false,
      reason:
        'There is no open invoice for this visit yet, so there is nothing to discount. ' +
        'The discount can be applied once the counter raises the bill.',
    };
  }
  return { available: true, reason: null };
}
