import {
  computeSupplierInvoiceBalance,
  payableAgeBucket,
  rollUpPayables,
  supplierExposure,
} from './supplier-payables';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const NOW = d('2026-08-31');

describe('computeSupplierInvoiceBalance', () => {
  it('owes the invoice until something is allocated against it', () => {
    const b = computeSupplierInvoiceBalance({ totalAmount: '1250.00' }, NOW);
    expect(b.balanceCents).toBe(125000);
    expect(b.paidCents).toBe(0);
    expect(b.settled).toBe(false);
  });

  it('derives paid from allocations, and settles exactly', () => {
    const b = computeSupplierInvoiceBalance({ totalAmount: '1250.00', allocatedAmount: '1250.00' }, NOW);
    expect(b.balanceCents).toBe(0);
    expect(b.settled).toBe(true);
  });

  it('never reports a negative balance when a supplier is overpaid', () => {
    const b = computeSupplierInvoiceBalance({ totalAmount: '100.00', allocatedAmount: '130.00' }, NOW);
    expect(b.balanceCents).toBe(0);
    expect(b.overpaidCents).toBe(3000);
  });

  it('a cancelled invoice owes nothing, whatever its face value', () => {
    const b = computeSupplierInvoiceBalance({ totalAmount: '900.00', status: 'CANCELLED' }, NOW);
    expect(b.balanceCents).toBe(0);
    expect(b.settled).toBe(true);
  });

  it('is overdue only once the due date has actually passed', () => {
    expect(
      computeSupplierInvoiceBalance({ totalAmount: '100.00', dueDate: d('2026-09-10') }, NOW).overdue,
    ).toBe(false);
    expect(
      computeSupplierInvoiceBalance({ totalAmount: '100.00', dueDate: d('2026-08-01') }, NOW).overdue,
    ).toBe(true);
  });

  it('a DISPUTED invoice is never overdue — it is being argued about', () => {
    // Listing a disputed bill under "must pay this week" is how a clinic pays
    // an invoice it had already refused.
    const b = computeSupplierInvoiceBalance(
      { totalAmount: '100.00', dueDate: d('2026-01-01'), status: 'DISPUTED' },
      NOW,
    );
    expect(b.overdue).toBe(false);
    expect(b.balanceCents).toBe(10000);
  });

  it('says it does not know rather than assuming thirty days', () => {
    const b = computeSupplierInvoiceBalance({ totalAmount: '100.00' }, NOW);
    expect(b.daysUntilDue).toBeNull();
    expect(b.overdue).toBe(false);
  });
});

describe('rollUpPayables', () => {
  const invoices = [
    { totalAmount: '1000.00', dueDate: d('2026-06-01') }, // overdue 91 days
    { totalAmount: '500.00', dueDate: d('2026-09-03') }, // due in 3 days
    { totalAmount: '800.00', dueDate: d('2026-11-01') }, // not due for a while
    { totalAmount: '300.00', allocatedAmount: '300.00', dueDate: d('2026-07-01') }, // settled
    { totalAmount: '250.00', dueDate: d('2026-05-01'), status: 'DISPUTED' as const },
    { totalAmount: '400.00' }, // no term configured
  ];

  it('answers the one question the clinic cannot answer today', () => {
    const roll = rollUpPayables(invoices, NOW);
    expect(roll.outstandingCents).toBe(100000 + 50000 + 80000 + 25000 + 40000);
  });

  it('separates overdue, due this week, disputed and undated — and never double counts', () => {
    const roll = rollUpPayables(invoices, NOW);
    expect(roll.overdueCents).toBe(100000);
    expect(roll.overdueInvoices).toBe(1);
    expect(roll.dueThisWeekCents).toBe(50000);
    expect(roll.dueThisWeekInvoices).toBe(1);
    expect(roll.disputedCents).toBe(25000);
    expect(roll.undatedCents).toBe(40000);
    // Every unsettled invoice lands in exactly one bucket, and the one not-yet-
    // due invoice is in none of them.
    expect(
      roll.overdueCents + roll.dueThisWeekCents + roll.disputedCents + roll.undatedCents + 80000,
    ).toBe(roll.outstandingCents);
  });

  it('a settled invoice contributes to totals but to no attention bucket', () => {
    const roll = rollUpPayables([{ totalAmount: '300.00', allocatedAmount: '300.00', dueDate: d('2020-01-01') }], NOW);
    expect(roll.totalCents).toBe(30000);
    expect(roll.outstandingCents).toBe(0);
    expect(roll.overdueInvoices).toBe(0);
  });
});

describe('payableAgeBucket', () => {
  it('ages from the DUE date, because that is the conversation a supplier has', () => {
    expect(payableAgeBucket(5)).toBe('NOT_DUE');
    expect(payableAgeBucket(0)).toBe('NOT_DUE');
    expect(payableAgeBucket(-1)).toBe('D1_30');
    expect(payableAgeBucket(-30)).toBe('D1_30');
    expect(payableAgeBucket(-31)).toBe('D31_60');
    expect(payableAgeBucket(-61)).toBe('D61_90');
    expect(payableAgeBucket(-91)).toBe('D90_PLUS');
  });

  it('has no bucket at all when nothing was ever due', () => {
    expect(payableAgeBucket(null)).toBeNull();
  });
});

describe('supplierExposure', () => {
  it('compares what is owed against the credit line', () => {
    const e = supplierExposure(750000, '10000.00');
    expect(e.utilisation).toBe(0.75);
    expect(e.overLimit).toBe(false);
    expect(e.headroomCents).toBe(250000);
  });

  it('flags over the limit, but is never a block', () => {
    const e = supplierExposure(1200000, '10000.00');
    expect(e.overLimit).toBe(true);
    expect(e.headroomCents).toBe(0);
  });

  it('an unknown limit is never "over" — not knowing is not the same as knowing', () => {
    const e = supplierExposure(9_999_999, null);
    expect(e.overLimit).toBe(false);
    expect(e.utilisation).toBeNull();
    expect(e.headroomCents).toBeNull();
  });
});
