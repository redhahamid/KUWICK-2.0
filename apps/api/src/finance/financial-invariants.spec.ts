import {
  accumulateAging,
  agingBucketOf,
  computeClaimBalance,
  computeInvoiceTotals,
  computePatientBalance,
  creditedCents,
  daysBetween,
  emptyAging,
  grossReceivedCents,
  netReceivedCents,
  refundedCents,
  rollUpClaims,
} from './financial-invariants';

describe('financial invariants', () => {
  // -------------------------------------------------------------------------
  // INVARIANT 1 — grand total
  // -------------------------------------------------------------------------
  describe('invoice grand total', () => {
    it('is lines − line discounts − invoice discount + tax', () => {
      const totals = computeInvoiceTotals(
        [
          { amount: '100.00', lineDiscountAmount: '10.00', taxAmount: '5.40' },
          { amount: '50.00', taxAmount: '3.00' },
        ],
        '5.00',
      );
      expect(totals.subtotalCents).toBe(15000);
      expect(totals.lineDiscountCents).toBe(1000);
      expect(totals.invoiceDiscountCents).toBe(500);
      expect(totals.taxCents).toBe(840);
      expect(totals.grandTotalCents).toBe(15000 - 1000 - 500 + 840);
    });

    it('excludes cancelled lines from every component, not just the subtotal', () => {
      const totals = computeInvoiceTotals([
        { amount: '100.00', taxAmount: '6.00' },
        { amount: '80.00', lineDiscountAmount: '8.00', taxAmount: '4.32', cancelledAt: new Date() },
      ]);
      expect(totals.subtotalCents).toBe(10000);
      expect(totals.lineDiscountCents).toBe(0);
      expect(totals.taxCents).toBe(600);
      expect(totals.grandTotalCents).toBe(10600);
    });

    it('is zero for an invoice with no lines', () => {
      expect(computeInvoiceTotals([]).grandTotalCents).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // INVARIANT 2 — money received
  // -------------------------------------------------------------------------
  describe('net received', () => {
    it('subtracts refunds from payments', () => {
      const payments = [
        { kind: 'PAYMENT' as const, amount: '80.00' },
        { kind: 'REFUND' as const, amount: '30.00' },
      ];
      expect(netReceivedCents(payments)).toBe(5000);
      expect(grossReceivedCents(payments)).toBe(8000);
      expect(refundedCents(payments)).toBe(3000);
    });

    it('ignores a reversed payment entirely, in both directions', () => {
      expect(
        netReceivedCents([
          { kind: 'PAYMENT', amount: '80.00', reversedAt: new Date() },
          { kind: 'PAYMENT', amount: '20.00' },
        ]),
      ).toBe(2000);
      expect(
        netReceivedCents([
          { kind: 'PAYMENT', amount: '80.00' },
          { kind: 'REFUND', amount: '30.00', reversedAt: new Date() },
        ]),
      ).toBe(8000);
    });

    it('adds up many partial payments exactly', () => {
      const payments = Array.from({ length: 7 }, () => ({ kind: 'PAYMENT' as const, amount: '14.29' }));
      expect(netReceivedCents(payments)).toBe(10003);
    });
  });

  // -------------------------------------------------------------------------
  // INVARIANT 3 — credits
  // -------------------------------------------------------------------------
  describe('credit notes', () => {
    it('counts only ISSUED notes — a draft has not been approved and a void one was withdrawn', () => {
      expect(
        creditedCents([
          { status: 'ISSUED', totalAmount: '40.00' },
          { status: 'DRAFT', totalAmount: '100.00' },
          { status: 'VOID', totalAmount: '250.00' },
        ]),
      ).toBe(4000);
    });
  });

  // -------------------------------------------------------------------------
  // INVARIANT 4 — patient balance
  // -------------------------------------------------------------------------
  describe('patient balance', () => {
    it('is measured against PATIENT RESPONSIBILITY, never the grand total', () => {
      // RM150 invoice, panel carries RM120, patient owes RM30 and paid it.
      const balance = computePatientBalance({
        patientResponsibility: '30.00',
        payments: [{ kind: 'PAYMENT', amount: '30.00' }],
      });
      expect(balance.balanceCents).toBe(0);
      expect(balance.settled).toBe(true);
    });

    it('leaves a partial payment partly outstanding', () => {
      const balance = computePatientBalance({
        patientResponsibility: '100.00',
        payments: [{ kind: 'PAYMENT', amount: '40.00' }],
      });
      expect(balance.balanceCents).toBe(6000);
      expect(balance.settled).toBe(false);
    });

    it('reopens a balance when a payment is refunded', () => {
      const balance = computePatientBalance({
        patientResponsibility: '100.00',
        payments: [
          { kind: 'PAYMENT', amount: '100.00' },
          { kind: 'REFUND', amount: '25.00' },
        ],
      });
      expect(balance.balanceCents).toBe(2500);
    });

    it('reports an over-collection as overpaid, never as a negative balance', () => {
      const balance = computePatientBalance({
        patientResponsibility: '50.00',
        payments: [{ kind: 'PAYMENT', amount: '80.00' }],
      });
      expect(balance.balanceCents).toBe(0);
      expect(balance.overpaidCents).toBe(3000);
      expect(balance.settled).toBe(true);
    });

    it('lets an issued credit note settle the remainder', () => {
      const balance = computePatientBalance({
        patientResponsibility: '100.00',
        payments: [{ kind: 'PAYMENT', amount: '60.00' }],
        creditNotes: [{ status: 'ISSUED', totalAmount: '40.00' }],
      });
      expect(balance.balanceCents).toBe(0);
      expect(balance.settled).toBe(true);
    });

    it('does not let a DRAFT credit note settle anything', () => {
      const balance = computePatientBalance({
        patientResponsibility: '100.00',
        payments: [{ kind: 'PAYMENT', amount: '60.00' }],
        creditNotes: [{ status: 'DRAFT', totalAmount: '40.00' }],
      });
      expect(balance.balanceCents).toBe(4000);
    });
  });

  // -------------------------------------------------------------------------
  // INVARIANT 5 — panel receivable
  // -------------------------------------------------------------------------
  describe('claim balance', () => {
    it('asks the panel for claimed + fee when the fee is ADDED', () => {
      const balance = computeClaimBalance({
        claimedAmount: '100.00',
        feeAmount: '8.00',
        feeTreatment: 'ADDED_TO_RECEIVABLE',
      });
      expect(balance.expectedReceivableCents).toBe(10800);
      expect(balance.outstandingCents).toBe(10800);
      expect(balance.adjudicated).toBe(false);
      expect(balance.feeTreatmentResolved).toBe(true);
    });

    // ---------------------------------------------------------------------
    // G-1 — WHICH WAY THE FEE MOVES.
    //
    // Every sheet in the clinic's panel workbook computes
    // `CLAIM TO RECEIVE = CLAIMED − FEE`. Tested against money actually banked:
    // of 2,640 paid claims carrying a non-zero fee, 2,615 arrived as exactly
    // claimed − fee, two as claimed, and NONE as claimed + fee. The three cases
    // below are the three states that fact left the model in.
    // ---------------------------------------------------------------------
    it('expects claimed MINUS fee when the panel withholds it', () => {
      // The shape that 99.1% of the clinic's paid fee-bearing claims took:
      // bill 100, the panel keeps its 8, bank 92.
      const balance = computeClaimBalance({
        claimedAmount: '100.00',
        feeAmount: '8.00',
        feeTreatment: 'WITHHELD_FROM_CLAIM',
      });
      expect(balance.expectedReceivableCents).toBe(9200);
      expect(balance.outstandingCents).toBe(9200);
      expect(balance.feeTreatmentResolved).toBe(true);
    });

    it('settles to zero — not to twice the fee — when a withheld-fee claim is paid', () => {
      // The failure this fixes: under `claimed + fee` this claim reads as RM16
      // short forever, on a panel that has paid it in full.
      const balance = computeClaimBalance({
        claimedAmount: '100.00',
        feeAmount: '8.00',
        feeTreatment: 'WITHHELD_FROM_CLAIM',
        approvedAmount: '92.00',
        receivedAmount: '92.00',
      });
      expect(balance.outstandingCents).toBe(0);
    });

    it('applies the fee in NEITHER direction when nobody has established the rule', () => {
      // Not a guess in the old direction, and not a guess in the new one.
      const balance = computeClaimBalance({ claimedAmount: '100.00', feeAmount: '8.00' });
      expect(balance.expectedReceivableCents).toBe(10000);
      expect(balance.feeTreatmentResolved).toBe(false);
      expect(balance.feeCents).toBe(800);
      // …and an explicit UNCONFIGURED behaves identically to an absent one.
      expect(
        computeClaimBalance({ claimedAmount: '100.00', feeAmount: '8.00', feeTreatment: 'UNCONFIGURED' })
          .expectedReceivableCents,
      ).toBe(10000);
    });

    it('NO_FEE is resolved and is not the same state as UNCONFIGURED', () => {
      // Collapsing the two was the previous design, and it left a panel that
      // charges nothing indistinguishable from one nobody had asked about — so
      // no screen could tell an owner which panels needed an answer.
      const noFee = computeClaimBalance({ claimedAmount: '100.00', feeAmount: '0', feeTreatment: 'NO_FEE' });
      expect(noFee.expectedReceivableCents).toBe(10000);
      expect(noFee.feeTreatmentResolved).toBe(true);
      const unknown = computeClaimBalance({ claimedAmount: '100.00', feeAmount: '8.00', feeTreatment: 'UNCONFIGURED' });
      expect(unknown.feeTreatmentResolved).toBe(false);
    });

    // -----------------------------------------------------------------------
    // THE REGRESSION THE OWNER ASKED FOR BY NAME (decision of 2026-08-31).
    //
    // "RM100 claimed, RM8 withheld fee, expected receivable = RM92. If RM92
    //  received, outstanding = RM0. Never expected = RM108, or outstanding =
    //  RM16 after receiving RM92."
    //
    // Written as the owner stated it, in the owner's numbers, so the assertion
    // that fails if D-041's behaviour ever comes back reads like the decision
    // that removed it.
    // -----------------------------------------------------------------------
    describe('D-041 supersession — RM100 claimed, RM8 withheld', () => {
      const claim = {
        claimedAmount: '100.00',
        feeAmount: '8.00',
        feeTreatment: 'WITHHELD_FROM_CLAIM' as const,
      };

      it('expects RM92, and never RM108', () => {
        const balance = computeClaimBalance(claim);
        expect(balance.expectedReceivableCents).toBe(9200);
        expect(balance.expectedReceivableCents).not.toBe(10800);
      });

      it('settles to RM0 when RM92 is received, and never leaves RM16 outstanding', () => {
        const balance = computeClaimBalance({ ...claim, approvedAmount: '92.00', receivedAmount: '92.00' });
        expect(balance.outstandingCents).toBe(0);
        expect(balance.outstandingCents).not.toBe(1600);
      });

      it('settles to RM0 on receipt even before the panel has adjudicated', () => {
        // The un-adjudicated path uses the expected receivable as its base, and
        // that is where the old +fee behaviour left a permanent RM16 shortfall.
        const balance = computeClaimBalance({ ...claim, receivedAmount: '92.00' });
        expect(balance.outstandingCents).toBe(0);
      });

      it('rolls up the same way — twenty such claims owe RM1,840, not RM2,160', () => {
        const roll = rollUpClaims(Array.from({ length: 20 }, () => claim));
        expect(roll.expectedReceivableCents).toBe(184000);
        expect(roll.expectedReceivableCents).not.toBe(216000);
        expect(roll.unresolvedFeeTreatmentCount).toBe(0);
      });
    });

    it('treats a zero fee as resolved, because there is no sign to get wrong', () => {
      const balance = computeClaimBalance({ claimedAmount: '100.00', feeAmount: '0.00' });
      expect(balance.expectedReceivableCents).toBe(10000);
      expect(balance.feeTreatmentResolved).toBe(true);
    });

    it('counts the unresolved claims in a panel roll-up rather than hiding them', () => {
      const roll = rollUpClaims([
        { claimedAmount: '100.00', feeAmount: '8.00', feeTreatment: 'WITHHELD_FROM_CLAIM' as const },
        { claimedAmount: '50.00', feeAmount: '8.00', feeTreatment: 'UNCONFIGURED' as const },
        { claimedAmount: '40.00', feeAmount: '0.00', feeTreatment: 'NO_FEE' as const },
      ]);
      expect(roll.unresolvedFeeTreatmentCount).toBe(1);
      expect(roll.expectedReceivableCents).toBe(9200 + 5000 + 4000);
    });

    it('does NOT treat submission as receipt', () => {
      const balance = computeClaimBalance({
        claimedAmount: '100.00',
        feeAmount: '8.00',
        feeTreatment: 'ADDED_TO_RECEIVABLE',
        status: 'SUBMITTED',
      });
      expect(balance.receivedCents).toBe(0);
      expect(balance.outstandingCents).toBe(10800);
    });

    it('switches the collectable base to the APPROVED amount once adjudicated', () => {
      // Claimed 108, panel approved only 90. Outstanding is 90, not 108 —
      // chasing the other 18 as receivable is the drift this rule prevents.
      const balance = computeClaimBalance({
        claimedAmount: '100.00',
        feeAmount: '8.00',
        feeTreatment: 'ADDED_TO_RECEIVABLE',
        approvedAmount: '90.00',
        rejectedAmount: '18.00',
      });
      expect(balance.adjudicated).toBe(true);
      expect(balance.outstandingCents).toBe(9000);
    });

    it('handles a partial receipt against an approved claim', () => {
      const balance = computeClaimBalance({
        claimedAmount: '100.00',
        feeAmount: '8.00',
        feeTreatment: 'ADDED_TO_RECEIVABLE',
        approvedAmount: '108.00',
        receivedAmount: '60.00',
      });
      expect(balance.outstandingCents).toBe(4800);
    });

    it('closes out with a write-off', () => {
      const balance = computeClaimBalance({
        claimedAmount: '100.00',
        approvedAmount: '100.00',
        receivedAmount: '70.00',
        writtenOffAmount: '30.00',
      });
      expect(balance.outstandingCents).toBe(0);
    });

    it('never reports a negative outstanding when a panel overpays', () => {
      const balance = computeClaimBalance({
        claimedAmount: '100.00',
        approvedAmount: '100.00',
        receivedAmount: '120.00',
      });
      expect(balance.outstandingCents).toBe(0);
    });

    it('reconciles: expected = received + outstanding + rejected-not-claimed + written off', () => {
      const claims = [
        {
          claimedAmount: '100.00',
          feeAmount: '8.00',
          feeTreatment: 'ADDED_TO_RECEIVABLE' as const,
          approvedAmount: '108.00',
          receivedAmount: '108.00',
        },
        { claimedAmount: '200.00', feeAmount: '0', approvedAmount: '150.00', rejectedAmount: '50.00', receivedAmount: '150.00' },
        { claimedAmount: '50.00', feeAmount: '0' },
      ];
      const roll = rollUpClaims(claims);
      expect(roll.expectedReceivableCents).toBe(10800 + 20000 + 5000);
      expect(roll.receivedCents).toBe(10800 + 15000);
      expect(roll.outstandingCents).toBe(5000);
      expect(roll.rejectedCents).toBe(5000);
      // Everything asked for is accounted for exactly once.
      expect(roll.receivedCents + roll.outstandingCents + roll.rejectedCents + roll.writtenOffCents).toBe(
        roll.expectedReceivableCents,
      );
    });
  });

  // -------------------------------------------------------------------------
  // AGING
  // -------------------------------------------------------------------------
  describe('aging', () => {
    it('puts each day in exactly one bucket, on the documented edges', () => {
      expect(agingBucketOf(0)).toBe('CURRENT');
      expect(agingBucketOf(30)).toBe('CURRENT');
      expect(agingBucketOf(31)).toBe('D31_60');
      expect(agingBucketOf(60)).toBe('D31_60');
      expect(agingBucketOf(61)).toBe('D61_90');
      expect(agingBucketOf(90)).toBe('D61_90');
      expect(agingBucketOf(91)).toBe('D90_PLUS');
      expect(agingBucketOf(4000)).toBe('D90_PLUS');
    });

    it('counts whole days regardless of time of day', () => {
      expect(daysBetween(new Date('2026-08-01T23:59:00Z'), new Date('2026-08-02T00:01:00Z'))).toBe(1);
      expect(daysBetween(new Date('2026-08-01T00:00:00Z'), new Date('2026-08-01T23:59:00Z'))).toBe(0);
    });

    it('totals across buckets equal the sum of what went in', () => {
      const aging = emptyAging();
      accumulateAging(aging, 5, 1000);
      accumulateAging(aging, 45, 2000);
      accumulateAging(aging, 75, 3000);
      accumulateAging(aging, 200, 4000);
      expect(aging).toEqual({ CURRENT: 1000, D31_60: 2000, D61_90: 3000, D90_PLUS: 4000 });
      expect(Object.values(aging).reduce((a, b) => a + b, 0)).toBe(10000);
    });
  });
});

describe('over-recovery — when a panel pays more than its own fee rule says', () => {
  // The clinic's workbook contains two of these (D-112 §4.1a): a panel with a
  // configured admin fee that remitted the whole claim anyway. Before this
  // term the reconciliation was out by exactly that fee, and the dashboard
  // read "does not reconcile" on a legitimate business event.
  const withheld = { claimedAmount: 120, feeAmount: 9.6, feeTreatment: 'WITHHELD_FROM_CLAIM' as const };

  it('a claim settled at exactly the expectation has no over-recovery', () => {
    const balance = computeClaimBalance({ ...withheld, approvedAmount: 110.4, receivedAmount: 110.4 });
    expect(balance.expectedReceivableCents).toBe(11_040);
    expect(balance.overRecoveredCents).toBe(0);
  });

  it('a panel that did not deduct its fee over-recovers by exactly the fee', () => {
    const balance = computeClaimBalance({ ...withheld, approvedAmount: 120, receivedAmount: 120 });
    expect(balance.overRecoveredCents).toBe(960);
    // And the identity holds WITH the term, which is the whole point.
    expect(
      balance.receivedCents + balance.outstandingCents + balance.rejectedCents + balance.writtenOffCents,
    ).toBe(balance.expectedReceivableCents + balance.overRecoveredCents);
  });

  it('a part-approved claim has no over-recovery — the shortfall is the rejection', () => {
    const balance = computeClaimBalance({
      claimedAmount: 220,
      feeAmount: 17.6,
      feeTreatment: 'WITHHELD_FROM_CLAIM',
      approvedAmount: 180,
      rejectedAmount: 22.4,
      receivedAmount: 120,
    });
    expect(balance.overRecoveredCents).toBe(0);
    expect(
      balance.receivedCents + balance.outstandingCents + balance.rejectedCents + balance.writtenOffCents,
    ).toBe(balance.expectedReceivableCents + balance.overRecoveredCents);
  });

  it('a claim rejected in full has no over-recovery', () => {
    const balance = computeClaimBalance({ ...withheld, approvedAmount: 0, rejectedAmount: 110.4 });
    expect(balance.overRecoveredCents).toBe(0);
    expect(
      balance.receivedCents + balance.outstandingCents + balance.rejectedCents + balance.writtenOffCents,
    ).toBe(balance.expectedReceivableCents);
  });

  it('paying an UNADJUDICATED claim more than expected is over-recovery too', () => {
    // No adjudication to read, so the only statement the panel has made is the
    // money itself.
    const balance = computeClaimBalance({ ...withheld, receivedAmount: 120 });
    expect(balance.adjudicated).toBe(false);
    expect(balance.overRecoveredCents).toBe(960);
  });

  it('the roll-up carries it, so a panel of mixed claims still reconciles', () => {
    const roll = rollUpClaims([
      { ...withheld, approvedAmount: 110.4, receivedAmount: 110.4 },
      { ...withheld, approvedAmount: 120, receivedAmount: 120 },
      { ...withheld, approvedAmount: 0, rejectedAmount: 110.4 },
    ]);
    expect(roll.overRecoveredCents).toBe(960);
    expect(
      roll.receivedCents + roll.outstandingCents + roll.rejectedCents + roll.writtenOffCents,
    ).toBe(roll.expectedReceivableCents + roll.overRecoveredCents);
  });
});
