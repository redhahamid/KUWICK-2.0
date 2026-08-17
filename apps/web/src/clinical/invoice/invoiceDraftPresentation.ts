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
    return {
      key,
      title,
      lines,
      amount: round2(
        lines.reduce((sum, line) => sum + (line.counted && line.amount != null ? line.amount : 0), 0),
      ),
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
  unpricedLabel: string | null;
  /** Screen-reader wording for the whole bar, since the visual is terse. */
  ariaLabel: string;
}

export function draftBarSummary(draft: InvoiceDraft | undefined): DraftBarSummary {
  if (!draft) {
    return {
      total: money(null),
      itemsLabel: 'Draft invoice',
      discountLabel: null,
      unpricedLabel: null,
      ariaLabel: 'Draft invoice — total not available yet',
    };
  }
  const counted = draft.lines.filter((line) => line.counted).length;
  const itemsLabel = counted === 1 ? '1 item' : `${counted} items`;
  const discountLabel = draft.discount
    ? `less ${money(draft.discount.amount)} discount`
    : null;
  const unpricedLabel =
    draft.unpricedCount > 0
      ? `${draft.unpricedCount} item${draft.unpricedCount === 1 ? '' : 's'} not priced yet`
      : null;
  return {
    total: money(draft.total),
    itemsLabel,
    discountLabel,
    unpricedLabel,
    ariaLabel: [
      `Draft invoice, ${itemsLabel}, total ${money(draft.total)}`,
      discountLabel,
      unpricedLabel,
    ]
      .filter(Boolean)
      .join(', '),
  };
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
