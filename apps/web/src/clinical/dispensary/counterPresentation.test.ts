import { describe, expect, it } from 'vitest';
import {
  BillingSummary,
  dispenseExceptions,
  medicationLine,
  medicationState,
  money,
  panelReceivableLine,
  paymentLine,
  paymentState,
  primaryAction,
} from './counterPresentation';

// ===========================================================================
// G4.5d5c — THE COUNTER'S RULES
//
// The UAT complaint was fragmentation: five surfaces to serve one patient.
// The replacement is two INDEPENDENT obligations and one next action, and
// these tests pin the two places that model can go wrong — pretending a panel
// patient has paid, and inventing a sequence the clinic does not work in.
// ===========================================================================

const billing = (over: Partial<BillingSummary> = {}): BillingSummary => ({
  grandTotal: '85.00',
  panelResponsibility: '0.00',
  patientResponsibility: '85.00',
  remainingBalance: '85.00',
  invoiceId: 'inv-1',
  status: 'UNPAID',
  ...over,
});

const med = (status: string, over: Record<string, unknown> = {}) => ({
  prescriptionId: `rx-${status}`,
  status,
  quantity: 10,
  stock: { state: 'IN_STOCK' as const, onHand: 100 },
  ...over,
});

describe('medication obligation', () => {
  it('1. nothing prescribed is not the same as nothing done', () => {
    expect(medicationState([])).toBe('NONE_REQUIRED');
  });

  it('2. any ordered row leaves the obligation open', () => {
    expect(medicationState([med('DISPENSED'), med('ORDERED')])).toBe('PENDING');
  });

  it('3. all handed over closes it', () => {
    expect(medicationState([med('DISPENSED'), med('DISPENSED')])).toBe('DISPENSED');
  });

  it('4. a cancelled row does not hold the counter open', () => {
    expect(medicationState([med('DISPENSED'), med('CANCELLED')])).toBe('DISPENSED');
  });
});

describe('payment obligation', () => {
  it('5. no invoice is its own state, not "settled"', () => {
    expect(paymentState(null)).toBe('NO_INVOICE');
    expect(paymentState(billing({ invoiceId: null }))).toBe('NO_INVOICE');
  });

  it('6. money owed is outstanding', () => {
    expect(paymentState(billing())).toBe('OUTSTANDING');
  });

  it('7. money collected is settled', () => {
    expect(paymentState(billing({ remainingBalance: '0.00' }))).toBe('SETTLED');
  });

  it('8. ZERO PAYABLE IS NOT PAID', () => {
    // The defect this whole type exists to prevent. A panel patient who owes
    // nothing has a receivable the clinic still has to claim; calling that
    // "settled" writes money off silently.
    expect(paymentState(billing({ patientResponsibility: '0.00', remainingBalance: '0.00' }))).toBe(
      'NOT_REQUIRED',
    );
  });

  it('9. the two are worded differently, and only one claims a payment', () => {
    const settled = paymentLine('SETTLED', billing({ remainingBalance: '0.00' }));
    const none = paymentLine('NOT_REQUIRED', billing({ patientResponsibility: '0.00' }));
    expect(settled.label).toBe('Patient payment settled');
    expect(none.label).toBe('No patient payment required');
    expect(none.label).not.toMatch(/settled|paid/i);
  });

  it('10. an outstanding balance is named with its amount', () => {
    expect(paymentLine('OUTSTANDING', billing()).label).toBe('Payment RM85.00 outstanding');
  });
});

describe('the panel receivable', () => {
  it('11. is stated when there is one', () => {
    expect(panelReceivableLine(billing({ panelResponsibility: '40.00' }))).toBe(
      'Panel receivable RM40.00',
    );
  });

  it('12. is absent on a self-pay visit, rather than a reassuring zero', () => {
    expect(panelReceivableLine(billing())).toBeNull();
    expect(panelReceivableLine(null)).toBeNull();
  });
});

describe('money', () => {
  it('13. always carries its currency', () => {
    expect(money('45')).toBe('RM45.00');
    expect(money(0)).toBe('RM0.00');
  });

  it('14. a nonsense amount is a dash, never NaN', () => {
    expect(money(null)).toBe('—');
    expect(money('abc')).toBe('—');
  });
});

describe('exceptions interrupt only when they exist', () => {
  it('15. a normal, fully-stocked hand-over raises none', () => {
    expect(dispenseExceptions([{ ...med('ORDERED'), name: 'Paracetamol' }])).toEqual([]);
  });

  it('16. a genuine shortfall is raised, with the numbers', () => {
    const exceptions = dispenseExceptions([
      {
        ...med('ORDERED', { quantity: 30, stock: { state: 'INSUFFICIENT', onHand: 3 } }),
        name: 'Ibuprofen 400 mg',
      },
    ]);
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0].detail).toBe('Required 30 · system stock 3');
  });

  it('17. an incomparable unit is NOT an exception to acknowledge away', () => {
    // The card already says the units cannot be compared. Turning that into
    // a shortage tick would assert a shortage nobody established.
    expect(
      dispenseExceptions([
        { ...med('ORDERED', { stock: { state: 'UNIT_UNKNOWN', onHand: null } }), name: 'Syrup' },
      ]),
    ).toEqual([]);
  });

  it('18. an already-dispensed row raises nothing', () => {
    expect(
      dispenseExceptions([
        { ...med('DISPENSED', { stock: { state: 'OUT_OF_STOCK', onHand: 0 } }), name: 'Gone' },
      ]),
    ).toEqual([]);
  });
});

describe('the single next action', () => {
  const base = { serverBlockers: [], completed: false };

  it('19. medicines still to hand over come first', () => {
    expect(primaryAction({ ...base, medication: 'PENDING', payment: 'OUTSTANDING' })).toMatchObject({
      stage: 'CONFIRM_MEDICATIONS',
      label: 'Confirm Medications Dispensed',
    });
  });

  it('20. once they are out, money is next', () => {
    expect(primaryAction({ ...base, medication: 'DISPENSED', payment: 'OUTSTANDING' }).stage).toBe(
      'COLLECT_PAYMENT',
    );
  });

  it('21. NO ARTIFICIAL SEQUENCE — payment settled first still leaves medicines next', () => {
    // A clinic may take the money before the bag leaves the counter. The
    // obligations are independent, so whichever is open is what is offered.
    expect(primaryAction({ ...base, medication: 'PENDING', payment: 'SETTLED' }).stage).toBe(
      'CONFIRM_MEDICATIONS',
    );
  });

  it('22. both satisfied offers completion', () => {
    expect(primaryAction({ ...base, medication: 'DISPENSED', payment: 'SETTLED' })).toMatchObject({
      stage: 'COMPLETE_VISIT',
      reasons: [],
    });
  });

  it('23. a visit needing neither is immediately completable', () => {
    expect(
      primaryAction({ ...base, medication: 'NONE_REQUIRED', payment: 'NOT_REQUIRED' }).stage,
    ).toBe('COMPLETE_VISIT');
  });

  it('24. a server blocker blocks — and says exactly why', () => {
    const action = primaryAction({
      medication: 'DISPENSED',
      payment: 'SETTLED',
      completed: false,
      serverBlockers: [{ code: 'PROCEDURE_IN_PROGRESS', message: 'Procedure FBC still in progress.' }],
    });
    expect(action.stage).toBe('BLOCKED');
    // Never a disabled button with no reason.
    expect(action.reasons).toEqual(['Procedure FBC still in progress.']);
  });

  it('25. a completed visit offers nothing further', () => {
    expect(
      primaryAction({ ...base, medication: 'DISPENSED', payment: 'SETTLED', completed: true }).stage,
    ).toBe('DONE');
  });
});

describe('the counter check reads as work, not jargon', () => {
  it('26. outstanding medicines are counted in plain words', () => {
    expect(medicationLine('PENDING', { total: 3, remaining: 1 }).label).toBe(
      '1 medication not dispensed',
    );
    expect(medicationLine('PENDING', { total: 3, remaining: 2 }).label).toBe(
      '2 medications not dispensed',
    );
  });

  it('27. no line leaks an enum or a status code', () => {
    const lines = [
      medicationLine('PENDING', { total: 2, remaining: 2 }),
      medicationLine('DISPENSED', { total: 2, remaining: 0 }),
      medicationLine('NONE_REQUIRED', { total: 0, remaining: 0 }),
      paymentLine('OUTSTANDING', billing()),
      paymentLine('SETTLED', billing()),
      paymentLine('NOT_REQUIRED', billing()),
      paymentLine('NO_INVOICE', null),
    ];
    for (const line of lines) {
      expect(line.label).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
    }
  });

  it('28. a done line is marked done, an outstanding one is not', () => {
    expect(medicationLine('DISPENSED', { total: 1, remaining: 0 }).done).toBe(true);
    expect(paymentLine('OUTSTANDING', billing()).done).toBe(false);
  });
});
