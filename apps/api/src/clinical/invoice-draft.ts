import { InvoiceDiscountType, InvoiceStatus } from '@prisma/client';
import { calculateResponsibility } from './billing-calculation';
import { resolveSourcedPrice } from './billing-pricing';
import {
  BillingWorklistItem,
  BillingWorklistSourceType,
  collectBillingWorklist,
} from './billing-worklist';
import { ClinicalTx } from './clinical-actor';
import { resolveConsultationState } from './consultation-tariff';

/**
 * b4 PIECE B — THE VISIT'S DRAFT INVOICE, PRICED.
 *
 * What the sticky bottom bar renders: every billable line already on this
 * visit — medications (quantity × price), orders/procedures, direct services
 * and the consultation charge — with a running total. The browser renders
 * this; it derives none of it.
 *
 * THIS MODULE ANSWERS NOTHING TWICE. Every judgement it needs already has an
 * owner, and it calls that owner rather than re-deciding:
 *
 *   WHICH SOURCES ARE BILLABLE, and in what state → `collectBillingWorklist`
 *     (D-093/D-094). Including the consultation item, which means the
 *     OTC-skips-consultation rule is `consultation-tariff.ts`'s answer
 *     (`classifyVisit` → OTC_ONLY → EXEMPT → a NOT_CHARGEABLE row), reaching
 *     this file already decided. There is no queue-type test anywhere below.
 *   WHAT A LINE COSTS → `resolveSourcedPrice` (D-093), the one place a
 *     contractual unit price comes from.
 *   WHAT THE DISCOUNT DOES TO THE TOTAL → `calculateResponsibility` (D-093),
 *     the billing engine, called with the draft's lines.
 *
 * A BILLED LINE IS READ, NOT RE-PRICED. Once a source has an active invoice
 * line, that line's stored quantity, unit price and line discount are the
 * facts, and the draft reports them. Re-resolving the price would let a
 * catalogue edit silently restate a charge that has already been made.
 *
 * WHAT IS COUNTED. The running total is the visit's CHARGEABLE work:
 *
 *   READY              counted — a finalisable charge
 *   AWAITING_DISPENSE  counted — clinic medication ordered but not yet
 *                      dispensed. It is chargeable work the patient is going
 *                      to be billed for, and a total that omitted it would
 *                      understate every visit that has not reached the
 *                      dispensary yet, which is all of them at this point in
 *                      the consultation.
 *   UNRESOLVED_SUPPLY  listed, NOT counted, and NOT priced. A NULL supply
 *                      mode is an unmade decision (D-091); pricing it would
 *                      answer the question the rail refuses to answer for the
 *                      doctor. It is reported as unpriced, never as zero.
 *   NOT_CHARGEABLE     listed with its reason, not counted. This is where an
 *   / WAIVED           OTC visit's consultation lands, so the bar can say WHY
 *                      there is no consultation charge rather than going
 *                      silent about it.
 *   TARIFF_REVIEW      listed with its reason, not counted, not priceable.
 *   NOT_CONFIGURED     the same, for a clinic with no consultation tariff at
 *                      all. b4 PIECE C (2a): before this state existed the
 *                      consultation was simply MISSING from the draft, so a
 *                      clinic that had never configured a tariff billed every
 *                      visit without its consultation fee and no screen said
 *                      so. No price is invented — the omission is stated.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW. The panel/patient split. That is
 * Billing Review's screen and its own engine run against the visit's verified
 * benefit; a doctor mid-consultation is asking what the visit costs, and a
 * second, differently-derived responsibility figure on a bottom bar is how
 * two numbers start disagreeing. The engine is called here in its CASH shape
 * for the arithmetic alone.
 */

/** States whose amounts make up the running total. */
const COUNTED_STATES = new Set(['READY', 'AWAITING_DISPENSE']);

/** States that have no price and must never be shown as RM 0.00. */
const UNPRICEABLE_STATES = new Set(['UNRESOLVED_SUPPLY', 'TARIFF_REVIEW', 'NOT_CONFIGURED']);

export interface InvoiceDraftLine {
  sourceType: BillingWorklistSourceType;
  sourceId: string;
  description: string;
  state: BillingWorklistItem['state'];
  stateReason: string | null;
  /** STANDARD_SERVICE / TASK_ORDER, so the bar can group direct services
   *  apart from procedures the way the rail cards do. NULL otherwise. */
  orderType: string | null;
  quantity: number;
  /** NULL means "no price established", which is never the same as zero. */
  unitPrice: number | null;
  /** quantity × unitPrice, pre-discount. NULL for the same reason. */
  amount: number | null;
  /** Whether this line's amount is inside `subtotal`. */
  counted: boolean;
  billed: boolean;
  invoiceLineId: string | null;
  /** A line-level discount already recorded on the billed line. */
  lineDiscountAmount: number | null;
}

export interface InvoiceDraftDiscount {
  type: InvoiceDiscountType;
  value: number;
  amount: number;
  reason: string;
  byStaffId: string | null;
  at: Date | null;
}

export interface InvoiceDraft {
  visitId: string;
  /** The visit's open invoice, when one exists. NULL until billing raises it. */
  invoiceId: string | null;
  invoiceNumber: string | null;
  lines: InvoiceDraftLine[];
  /** Sum of counted line amounts, before any discount. */
  subtotal: number;
  discount: InvoiceDraftDiscount | null;
  /** subtotal − line discounts − the overall discount. */
  total: number;
  /**
   * Counted lines whose price could not be established. A total is not the
   * whole story while this is non-zero, and the bar says so.
   */
  unpricedCount: number;
  /**
   * PIECE 4 — EVERY line that is real work with no price on it, whether or not
   * it is counted in the total.
   *
   * `unpricedCount` is counted-lines-whose-price-failed, and it keeps that
   * meaning because the total's arithmetic depends on it. But it has never
   * been the number the SCREEN needs: an undecided supply (D-091) and now a
   * medicine with no divisor are both listed, unpriced and UNCOUNTED, so the
   * chip built to say "the total is incomplete" was silent on the two states
   * that make it incomplete.
   *
   * The browser was patching that by re-deriving the count from the line
   * states — a surface working out a billing fact for itself, which is the
   * thing this file exists to stop. It is computed here now, once, from the
   * lines as assembled.
   */
  notPricedCount: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The bar's own arithmetic, isolated from the database so it can be tested
 * as arithmetic. Delegates to the billing engine in its CASH shape: the draft
 * needs subtotal, discount amount and total, and those are the same sums
 * whatever the panel does with them afterwards.
 */
export function draftTotals(params: {
  lines: Array<{
    id: string;
    amount: number | null;
    counted: boolean;
    lineDiscountType?: InvoiceDiscountType | null;
    lineDiscountValue?: number | null;
  }>;
  invoiceDiscountType: InvoiceDiscountType | null;
  invoiceDiscountValue: number | null;
}): { subtotal: number; discountAmount: number; total: number; unpricedCount: number } {
  const counted = params.lines.filter((line) => line.counted);
  const priced = counted.filter((line) => line.amount != null);
  const result = calculateResponsibility({
    lines: priced.map((line) => ({
      id: line.id,
      amount: line.amount as number,
      excludedFromPanel: false,
      cancelled: false,
      lineDiscountType: line.lineDiscountType ?? null,
      lineDiscountValue: line.lineDiscountValue ?? null,
    })),
    invoiceDiscountType: params.invoiceDiscountType,
    invoiceDiscountValue: params.invoiceDiscountValue,
    benefit: { kind: 'CASH' },
  });
  return {
    subtotal: round2(result.subtotalAmount),
    discountAmount: round2(result.invoiceDiscountAmount ?? 0),
    total: round2(result.totalAmount),
    unpricedCount: counted.length - priced.length,
  };
}

export async function buildInvoiceDraft(tx: ClinicalTx, visitId: string): Promise<InvoiceDraft> {
  const worklist = await collectBillingWorklist(tx, visitId);

  const visit = await tx.visit.findUnique({
    where: { id: visitId },
    select: { panelClinicId: true },
  });
  const panelClinicId = visit?.panelClinicId ?? null;

  // The visit's open invoice, for the lines already made facts and for the
  // discount already applied. A CANCELLED invoice is not this visit's bill.
  const invoice = await tx.invoice.findFirst({
    where: { visitId, status: { not: InvoiceStatus.CANCELLED } },
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDiscountType: true,
      invoiceDiscountValue: true,
      invoiceDiscountReason: true,
      invoiceDiscountByStaffId: true,
      invoiceDiscountAt: true,
      lines: {
        where: { cancelledAt: null },
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          amount: true,
          lineDiscountType: true,
          lineDiscountValue: true,
          lineDiscountAmount: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  const storedLine = new Map((invoice?.lines ?? []).map((line) => [line.id, line]));

  // The consultation's SERVICE, for pricing an unbilled consultation charge.
  // Same resolver the worklist used — asked again for the one field the
  // worklist does not carry, never re-decided.
  const consultationItem = worklist.find((item) => item.sourceType === 'CONSULTATION');
  const consultationServiceId =
    consultationItem && !consultationItem.billed && consultationItem.state === 'READY'
      ? await consultationServiceIdFor(tx, visitId)
      : null;

  const lines: InvoiceDraftLine[] = [];
  for (const item of worklist) {
    const counted = COUNTED_STATES.has(item.state);
    const stored = item.invoiceLineId ? storedLine.get(item.invoiceLineId) : undefined;

    // 1. Already an active line: the stored figures ARE the charge.
    if (stored) {
      lines.push({
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        description: item.description,
        state: item.state,
        stateReason: item.stateReason,
        orderType: item.orderType,
        quantity: stored.quantity,
        unitPrice: Number(stored.unitPrice),
        amount: Number(stored.amount),
        counted,
        billed: true,
        invoiceLineId: item.invoiceLineId,
        lineDiscountAmount: stored.lineDiscountAmount != null ? Number(stored.lineDiscountAmount) : null,
      });
      continue;
    }

    // 2. Not chargeable, or not decided: listed with its reason, unpriced.
    if (!counted || UNPRICEABLE_STATES.has(item.state)) {
      lines.push({
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        description: item.description,
        state: item.state,
        stateReason: item.stateReason,
        orderType: item.orderType,
        quantity: item.quantity ?? 1,
        unitPrice: null,
        amount: null,
        counted: false,
        billed: false,
        invoiceLineId: null,
        lineDiscountAmount: null,
      });
      continue;
    }

    // 3. Chargeable and not yet billed: the projected charge, priced by the
    //    one pricing truth. A source that will not price is reported unpriced
    //    rather than assumed free.
    const resolved = await resolveSourcedPrice(tx, {
      panelClinicId,
      ...(item.sourceType === 'PRESCRIPTION' ? { sourcePrescriptionId: item.sourceId } : {}),
      ...(item.sourceType === 'ORDER_SERVICE' ? { sourceOrderServiceId: item.sourceId } : {}),
      ...(item.sourceType === 'CONSULTATION' && consultationServiceId
        ? { serviceCatalogId: consultationServiceId }
        : {}),
    });
    // A MEDICINE IS CHARGED IN PACKS, NOT IN TABLETS.
    //
    // `resolved.dispense` carries the conversion for prescriptions: the
    // doctor's 30 tablets against strips of 10 is three strips, priced at the
    // strip price. Services and orders carry no conversion and their quantity
    // stands as it always did.
    //
    // A medicine whose divisor nobody has stated cannot be converted, so it is
    // LISTED, UNPRICED and UNCOUNTED with the reason on the line — the same
    // shape an undecided supply mode already uses (D-091). Falling back to a
    // divisor of 1 is the identity that bills a course of Tamiflu at RM1,550.
    const dispense = resolved?.dispense;
    const quantity = dispense ? (dispense.dispenseQuantity ?? item.quantity ?? 1) : (item.quantity ?? 1);
    const unpriceable = dispense != null && dispense.dispenseQuantity === null;

    lines.push({
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      description: item.description,
      state: item.state,
      stateReason: unpriceable ? dispense.reason : item.stateReason,
      orderType: item.orderType,
      quantity,
      unitPrice: resolved && !unpriceable ? resolved.unitPrice : null,
      amount: resolved && !unpriceable ? round2(resolved.unitPrice * quantity) : null,
      // Uncounted, so the total is not quietly wrong by an unknown amount. The
      // unpriced chip reads exactly this.
      counted: !unpriceable,
      billed: false,
      invoiceLineId: null,
      lineDiscountAmount: null,
    });
  }

  const totals = draftTotals({
    lines: lines.map((line, index) => ({
      id: line.invoiceLineId ?? `draft-${index}`,
      amount: line.amount,
      counted: line.counted,
      lineDiscountType: storedLineDiscountType(storedLine, line),
      lineDiscountValue: storedLineDiscountValue(storedLine, line),
    })),
    invoiceDiscountType: invoice?.invoiceDiscountType ?? null,
    invoiceDiscountValue:
      invoice?.invoiceDiscountValue != null ? Number(invoice.invoiceDiscountValue) : null,
  });

  return {
    visitId,
    invoiceId: invoice?.id ?? null,
    invoiceNumber: invoice?.invoiceNumber ?? null,
    lines,
    subtotal: totals.subtotal,
    discount:
      invoice?.invoiceDiscountType && invoice.invoiceDiscountValue != null
        ? {
            type: invoice.invoiceDiscountType,
            value: Number(invoice.invoiceDiscountValue),
            amount: totals.discountAmount,
            reason: invoice.invoiceDiscountReason ?? '',
            byStaffId: invoice.invoiceDiscountByStaffId ?? null,
            at: invoice.invoiceDiscountAt ?? null,
          }
        : null,
    total: totals.total,
    unpricedCount: totals.unpricedCount,
    // Chargeable work with no price on it. A NOT_CHARGEABLE line is excluded
    // deliberately: "this visit carries no consultation charge" is an answer,
    // not a gap, and counting it would send somebody looking for a price that
    // was never meant to exist.
    notPricedCount: lines.filter(
      (line) => !line.billed && line.amount == null && line.state !== 'NOT_CHARGEABLE',
    ).length,
  };
}

type StoredLine = {
  lineDiscountType: InvoiceDiscountType | null;
  lineDiscountValue: unknown;
};

function storedLineDiscountType(
  stored: Map<string, StoredLine>,
  line: InvoiceDraftLine,
): InvoiceDiscountType | null {
  return line.invoiceLineId ? (stored.get(line.invoiceLineId)?.lineDiscountType ?? null) : null;
}

function storedLineDiscountValue(stored: Map<string, StoredLine>, line: InvoiceDraftLine): number | null {
  const value = line.invoiceLineId ? stored.get(line.invoiceLineId)?.lineDiscountValue : null;
  return value != null ? Number(value) : null;
}

async function consultationServiceIdFor(tx: ClinicalTx, visitId: string): Promise<string | null> {
  const state = await resolveConsultationState(tx, visitId);
  return state.kind === 'READY' ? state.service.id : null;
}
