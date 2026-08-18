import { describe, expect, it } from 'vitest';
import {
  discountAvailability,
  draftBarSummary,
  groupDraftLines,
  groupKeyFor,
  lineNote,
  money,
} from './invoiceDraftPresentation';
import { InvoiceDraft, InvoiceDraftLine } from '../types';

// ===========================================================================
// b4 PIECE B — how the draft READS.
//
// What is pinned here: that a missing price is never printed as RM 0.00, that
// a line carrying no charge keeps the SERVER'S reason rather than a re-worded
// one, and that the slim bar states the two things that change what its total
// MEANS — a discount, and work that has no price yet.
// ===========================================================================

const LINE = (over: Partial<InvoiceDraftLine> = {}): InvoiceDraftLine => ({
  sourceType: 'PRESCRIPTION',
  sourceId: 'rx-1',
  description: 'Amoxicillin 500mg',
  state: 'READY',
  stateReason: null,
  orderType: null,
  quantity: 1,
  unitPrice: 10,
  amount: 10,
  counted: true,
  billed: false,
  invoiceLineId: null,
  lineDiscountAmount: null,
  ...over,
});

const DRAFT = (over: Partial<InvoiceDraft> = {}): InvoiceDraft => ({
  visitId: 'visit-1',
  invoiceId: null,
  invoiceNumber: null,
  lines: [],
  subtotal: 0,
  discount: null,
  total: 0,
  unpricedCount: 0,
  ...over,
});

describe('money', () => {
  it('always prints two places — a dropped zero reads as a different number', () => {
    expect(money(35)).toBe('RM 35.00');
    expect(money(7.5)).toBe('RM 7.50');
    expect(money(0)).toBe('RM 0.00');
  });

  it('prints a DASH, never RM 0.00, when there is no price', () => {
    expect(money(null)).toBe('—');
  });
});

describe('groupKeyFor', () => {
  it('splits direct services from procedures the way the rail cards do', () => {
    expect(groupKeyFor(LINE({ sourceType: 'CONSULTATION' }))).toBe('CONSULTATION');
    expect(groupKeyFor(LINE({ sourceType: 'PRESCRIPTION' }))).toBe('MEDICATION');
    expect(groupKeyFor(LINE({ sourceType: 'ORDER_SERVICE', orderType: 'STANDARD_SERVICE' }))).toBe('SERVICE');
    expect(groupKeyFor(LINE({ sourceType: 'ORDER_SERVICE', orderType: 'TASK_ORDER' }))).toBe('ORDER');
  });
});

describe('groupDraftLines', () => {
  const draft = DRAFT({
    lines: [
      LINE({ sourceId: 'rx-1', amount: 10 }),
      LINE({ sourceId: 'rx-2', amount: 5 }),
      LINE({ sourceType: 'ORDER_SERVICE', sourceId: 'ord-1', orderType: 'TASK_ORDER', amount: 60 }),
      LINE({ sourceType: 'CONSULTATION', sourceId: 'visit-1', amount: 35 }),
    ],
  });

  it('reads in the rail’s own order, consultation first', () => {
    expect(groupDraftLines(draft).map((group) => group.title)).toEqual([
      'Consultation',
      'Orders / Procedures',
      'Medications',
    ]);
  });

  it('omits a group with no lines rather than printing an empty heading', () => {
    expect(groupDraftLines(draft).some((group) => group.key === 'SERVICE')).toBe(false);
  });

  it('totals only the counted lines in each group', () => {
    const withUncounted = DRAFT({
      lines: [
        LINE({ sourceId: 'rx-1', amount: 10 }),
        LINE({ sourceId: 'rx-2', amount: null, counted: false, state: 'UNRESOLVED_SUPPLY' }),
      ],
    });
    expect(groupDraftLines(withUncounted)[0].amount).toBe(10);
  });

  it('is empty for a draft that has not arrived', () => {
    expect(groupDraftLines(undefined)).toEqual([]);
  });
});

describe('draftBarSummary', () => {
  it('states the total and what it is made of', () => {
    const summary = draftBarSummary(DRAFT({ lines: [LINE(), LINE({ sourceId: 'rx-2' })], total: 20 }));
    expect(summary.total).toBe('RM 20.00');
    expect(summary.itemsLabel).toBe('2 items');
    expect(summary.discountLabel).toBeNull();
    expect(summary.unpricedLabel).toBeNull();
  });

  it('singularises one item', () => {
    expect(draftBarSummary(DRAFT({ lines: [LINE()], total: 10 })).itemsLabel).toBe('1 item');
  });

  it('says a discount is in force, at rest, without expanding anything', () => {
    const summary = draftBarSummary(
      DRAFT({
        lines: [LINE()],
        subtotal: 10,
        total: 9,
        discount: { type: 'PERCENTAGE', value: 10, amount: 1, reason: 'Regular dressing patient', byStaffId: null, at: null },
      }),
    );
    expect(summary.discountLabel).toBe('less RM 1.00 discount');
  });

  it('says when chargeable work has no price — the total is short by an unknown amount', () => {
    const summary = draftBarSummary(DRAFT({ lines: [LINE()], total: 10, unpricedCount: 2 }));
    expect(summary.unpricedLabel).toBe('2 items not priced');
    expect(summary.ariaLabel).toContain('2 items not priced');
  });

  /**
   * b4 PIECE C (2b) — THE CHIP DID NOT FIRE ON THE STATE IT WAS BUILT FOR.
   *
   * `unpricedCount` is the server's count of COUNTED lines whose price failed
   * to resolve. A medicine whose supply mode is undecided (D-091) is listed,
   * unpriced and UNCOUNTED — so it was in neither number, and a visit carrying
   * one showed a confident total with nothing beside it.
   *
   * PIECE 4 — that used to be patched here, by re-deriving the count from the
   * line states in the browser. It held until a THIRD such state arrived (a
   * medicine with no divisor), at which point the browser would have been
   * maintaining its own list of "states that mean the total is incomplete" —
   * a billing fact, derived on the wrong side. The server counts it now, and
   * the chip reads `notPricedCount`.
   */
  it('reads the server’s count of unpriced work, counted or not', () => {
    const summary = draftBarSummary(
      DRAFT({
        lines: [
          LINE(),
          LINE({
            sourceId: 'rx-2',
            state: 'UNRESOLVED_SUPPLY',
            unitPrice: null,
            amount: null,
            counted: false,
          }),
        ],
        total: 10,
        unpricedCount: 0,
        notPricedCount: 1,
      }),
    );
    expect(summary.unpricedLabel).toBe('1 item not priced');
  });

  it('falls back to unpricedCount for a draft from before the field existed', () => {
    const summary = draftBarSummary(DRAFT({ lines: [LINE()], total: 10, unpricedCount: 2 }));
    expect(summary.unpricedLabel).toBe('2 items not priced');
  });

  /**
   * b4 PIECE C (2b) — TWO FACTS, NAMED, AND BOTH WHEN BOTH ARE TRUE.
   *
   * "1 item outstanding" could not tell a doctor whether the TOTAL was
   * incomplete or whether the PATIENT had not been handed their medicine.
   * Different facts, different actions, different words.
   */
  it('names an undispensed medicine separately from an unpriced item', () => {
    const summary = draftBarSummary(
      DRAFT({
        lines: [
          LINE({ state: 'AWAITING_DISPENSE' }),
          LINE({ sourceId: 'rx-2', state: 'AWAITING_DISPENSE' }),
          LINE({
            sourceId: 'rx-3',
            state: 'UNRESOLVED_SUPPLY',
            unitPrice: null,
            amount: null,
            counted: false,
          }),
        ],
        total: 20,
        notPricedCount: 1,
      }),
    );
    expect(summary.toDispenseLabel).toBe('2 medicines to dispense');
    expect(summary.unpricedLabel).toBe('1 item not priced');
    // A screen reader gets both, each with what it means.
    expect(summary.ariaLabel).toContain('the total is incomplete');
    expect(summary.ariaLabel).toContain('not yet received by the patient');
  });

  it('says neither when everything is priced and dispensed', () => {
    const summary = draftBarSummary(DRAFT({ lines: [LINE()], total: 10 }));
    expect(summary.unpricedLabel).toBeNull();
    expect(summary.toDispenseLabel).toBeNull();
  });

  it('reads as a sentence for a screen reader, since the visual is terse', () => {
    expect(draftBarSummary(DRAFT({ lines: [LINE()], total: 10 })).ariaLabel).toBe(
      'Draft invoice, 1 item, total RM 10.00',
    );
  });

  it('does not invent a total before the draft arrives', () => {
    expect(draftBarSummary(undefined).total).toBe('—');
  });
});

describe('lineNote', () => {
  it("uses the SERVER'S wording for a line that carries no charge", () => {
    expect(
      lineNote(
        LINE({
          counted: false,
          amount: null,
          state: 'NOT_CHARGEABLE',
          stateReason: 'This kind of visit carries no consultation charge.',
        }),
      ),
    ).toBe('This kind of visit carries no consultation charge.');
  });

  it('says something rather than nothing when a chargeable line would not price', () => {
    expect(lineNote(LINE({ amount: null, unitPrice: null }))).toBe(
      'No price could be established for this item.',
    );
  });

  it('adds no note to an ordinary priced line', () => {
    expect(lineNote(LINE())).toBeNull();
  });
});

describe('discountAvailability', () => {
  it('offers the control once the visit has an invoice to discount', () => {
    expect(discountAvailability(DRAFT({ invoiceId: 'inv-1' }))).toEqual({ available: true, reason: null });
  });

  it('explains rather than offering a dead control when there is no invoice yet', () => {
    const availability = discountAvailability(DRAFT());
    expect(availability.available).toBe(false);
    expect(availability.reason).toMatch(/no open invoice for this visit yet/i);
  });
});
