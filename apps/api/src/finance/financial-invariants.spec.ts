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
    it('asks the panel for claimed + fee', () => {
      const balance = computeClaimBalance({ claimedAmount: '100.00', feeAmount: '8.00' });
      expect(balance.expectedReceivableCents).toBe(10800);
      expect(balance.outstandingCents).toBe(10800);
      expect(balance.adjudicated).toBe(false);
    });

    it('does NOT treat submission as receipt', () => {
      const balance = computeClaimBalance({
        claimedAmount: '100.00',
        feeAmount: '8.00',
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
        { claimedAmount: '100.00', feeAmount: '8.00', approvedAmount: '108.00', receivedAmount: '108.00' },
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
