import {
  collectBillingWorklist,
  pendingBillingWork,
  tariffReviewItems,
  unbilledReadyItems,
} from './billing-worklist';

// ===========================================================================
// G4.5d3c-3b1 (D-093) / 3b2 (D-094) — SOURCE-AWARE BILLING WORKLIST
// (owner 3b2 tests 12–25). Medication finalises only when DISPENSED; every
// non-chargeable source is listed WITH its reason; the consultation item
// comes from the tariff resolver.
// ===========================================================================

function txWith(world: {
  prescriptions?: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  lines?: Array<Record<string, unknown>>;
  visit?: Record<string, unknown> | null;
  tariffRules?: Array<Record<string, unknown>>;
  consultationLines?: Array<Record<string, unknown>>;
  startEvent?: { createdAt: Date } | null;
}) {
  return {
    prescription: { findMany: jest.fn().mockResolvedValue(world.prescriptions ?? []) },
    orderService: { findMany: jest.fn().mockResolvedValue(world.orders ?? []) },
    invoiceLine: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        where.sourceConsultationVisitId ? (world.consultationLines ?? []) : (world.lines ?? []),
      ),
    },
    visit: {
      findUnique: jest.fn().mockResolvedValue(
        world.visit === null
          ? null
          : {
              id: 'visit-1',
              clinicId: 'clinic-1',
              classification: null,
              checkInAt: new Date('2026-08-04T02:00:00Z'), // 10:00 KL
              clinic: { timezone: 'Asia/Kuala_Lumpur' },
              queueTicket: { queueType: 'WALK_IN', status: 'IN_CONSULTATION', calledAt: null },
              ...world.visit,
            },
      ),
    },
    consultationTariffRule: { findMany: jest.fn().mockResolvedValue(world.tariffRules ?? []) },
    visitWorkflowEvent: {
      findFirst: jest.fn().mockResolvedValue(world.startEvent === undefined ? null : world.startEvent),
    },
  } as never;
}

const RX = (id: string, supplyMode: string | null, status = 'ORDERED') => ({
  id,
  quantity: 10,
  supplyMode,
  status,
  item: { name: `Med ${id}` },
});

const DAY_RULE = {
  id: 'rule-day',
  classification: 'CONSULTATION',
  startTime: '08:00',
  endTime: '22:59',
  effectiveFrom: null,
  effectiveTo: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  serviceCatalog: { id: 'svc-day', name: 'Consultation (Day)', active: true },
};

describe('billing worklist — medication', () => {
  it('12/13. DISPENSED onsite is READY; ORDERED onsite is AWAITING_DISPENSE with no final charge', async () => {
    const items = await collectBillingWorklist(
      txWith({ prescriptions: [RX('a', 'ONSITE_DISPENSE', 'DISPENSED'), RX('b', 'ONSITE_DISPENSE', 'ORDERED')] }),
      'visit-1',
    );
    expect(items.find((i) => i.sourceId === 'a')).toMatchObject({ state: 'READY', quantity: 10 });
    expect(items.find((i) => i.sourceId === 'b')).toMatchObject({ state: 'AWAITING_DISPENSE' });
    expect(unbilledReadyItems(items).map((i) => i.sourceId)).toEqual(['a']);
    // …but the ordered medication is still billing work AHEAD of the patient.
    expect(pendingBillingWork(items).map((i) => i.sourceId)).toEqual(['a', 'b']);
  });

  it('14/15. NULL and DEFERRED supply are UNRESOLVED_SUPPLY — listed, never chargeable', async () => {
    const items = await collectBillingWorklist(
      txWith({ prescriptions: [RX('a', 'DEFERRED'), RX('b', null)] }),
      'visit-1',
    );
    // Scoped to the medications under test: every visit now also carries a
    // consultation row (b4 PIECE C (2a) — a clinic with no tariff says so
    // rather than going silent), and these cases are about supply modes.
    expect(items.filter((i) => i.sourceType === 'PRESCRIPTION').map((i) => i.state)).toEqual([
      'UNRESOLVED_SUPPLY',
      'UNRESOLVED_SUPPLY',
    ]);
    expect(unbilledReadyItems(items)).toHaveLength(0);
    expect(pendingBillingWork(items)).toHaveLength(0);
  });

  it.each([
    ['16. EXTERNAL_PRESCRIPTION', 'EXTERNAL_PRESCRIPTION'],
    ['17. PATIENT_OWN_SUPPLY', 'PATIENT_OWN_SUPPLY'],
    ['18. NO_SUPPLY_REQUIRED', 'NO_SUPPLY_REQUIRED'],
  ])('%s is listed as NOT_CHARGEABLE with its reason', async (_n, mode) => {
    const items = await collectBillingWorklist(txWith({ prescriptions: [RX('a', mode)] }), 'visit-1');
    // The medication under test, scoped: every visit also carries a
    // consultation row now (b4 PIECE C (2a)).
    const meds = items.filter((i) => i.sourceType === 'PRESCRIPTION');
    expect(meds).toHaveLength(1);
    expect(meds[0].state).toBe('NOT_CHARGEABLE');
    expect(meds[0].stateReason).toBeTruthy();
    expect(unbilledReadyItems(items)).toHaveLength(0);
    expect(pendingBillingWork(items)).toHaveLength(0);
  });
});

describe('billing worklist — orders', () => {
  it('19/20/21/22. completed procedure READY, pending NOT_READY, cancelled NOT_CHARGEABLE, direct service READY', async () => {
    const items = await collectBillingWorklist(
      txWith({
        orders: [
          { id: 'o1', procedureName: 'ECG', orderType: 'TASK_ORDER', status: 'PENDING' },
          { id: 'o2', procedureName: 'Nebuliser', orderType: 'TASK_ORDER', status: 'COMPLETED' },
          { id: 'o3', procedureName: 'Consult service', orderType: 'STANDARD_SERVICE', status: 'PENDING' },
          { id: 'o4', procedureName: 'Cancelled thing', orderType: 'TASK_ORDER', status: 'CANCELLED' },
        ],
      }),
      'visit-1',
    );
    expect(items.find((i) => i.sourceId === 'o1')).toMatchObject({ state: 'NOT_READY' });
    expect(items.find((i) => i.sourceId === 'o2')).toMatchObject({ state: 'READY' });
    expect(items.find((i) => i.sourceId === 'o3')).toMatchObject({ state: 'READY' });
    expect(items.find((i) => i.sourceId === 'o4')).toMatchObject({ state: 'NOT_CHARGEABLE' });
    expect(unbilledReadyItems(items).map((i) => i.sourceId).sort()).toEqual(['o2', 'o3']);
  });
});

describe('billing worklist — billed state', () => {
  it('23/24. an existing invoice does not hide another unbilled source; billed sources are identified', async () => {
    const items = await collectBillingWorklist(
      txWith({
        prescriptions: [RX('billed-rx', 'ONSITE_DISPENSE', 'DISPENSED'), RX('open-rx', 'ONSITE_DISPENSE', 'DISPENSED')],
        lines: [{ id: 'l1', sourcePrescriptionId: 'billed-rx', sourceOrderServiceId: null }],
      }),
      'visit-1',
    );
    expect(items.find((i) => i.sourceId === 'billed-rx')).toMatchObject({ billed: true, invoiceLineId: 'l1' });
    expect(items.find((i) => i.sourceId === 'open-rx')).toMatchObject({ billed: false });
    expect(unbilledReadyItems(items).map((i) => i.sourceId)).toEqual(['open-rx']);
  });

  it('25. a CANCELLED invoice line returns its source to the unbilled state', async () => {
    // The query filters cancelled lines at the database level; this mirrors
    // that by returning none, and the item honestly reads unbilled.
    const items = await collectBillingWorklist(
      txWith({ prescriptions: [RX('a', 'ONSITE_DISPENSE', 'DISPENSED')], lines: [] }),
      'visit-1',
    );
    expect(items[0].billed).toBe(false);
  });

  it('items carry stable identifiers and the source quantity for the UI', async () => {
    const items = await collectBillingWorklist(
      txWith({ prescriptions: [RX('a', 'ONSITE_DISPENSE', 'DISPENSED')] }),
      'visit-1',
    );
    expect(items[0]).toMatchObject({
      sourceType: 'PRESCRIPTION',
      sourceId: 'a',
      description: 'Med a',
      sourceStatus: 'DISPENSED',
      supplyMode: 'ONSITE_DISPENSE',
      quantity: 10,
    });
  });
});

describe('billing worklist — consultation item (D-094)', () => {
  /**
   * b4 PIECE C (2a) — this said "no consultation row at all", and that silence
   * is what cost a consultation fee on every visit in a clinic that had never
   * configured a tariff. Reported from staging: RM45 of orders + RM50 of
   * medications, no consultation charge, no explanation, and the visit was not
   * OTC.
   *
   * The RULE is untouched — no tariff still means no price and no completion
   * blocker (D-094). What is asserted now is that the omission is stated.
   */
  it('no tariff configured → a LISTED, unpriced consultation row that says why', async () => {
    const items = await collectBillingWorklist(txWith({ tariffRules: [] }), 'visit-1');
    const consult = items.filter((i) => i.sourceType === 'CONSULTATION');
    expect(consult).toHaveLength(1);
    expect(consult[0]).toMatchObject({ state: 'NOT_CONFIGURED', billed: false, quantity: 1 });
    expect(consult[0].stateReason).toMatch(/no consultation tariff configured/i);
    // NOT a completion blocker, and NOT chargeable work: a clinic that has not
    // configured tariffs must still be able to finish its consultations.
    expect(unbilledReadyItems(items)).toHaveLength(0);
    expect(pendingBillingWork(items)).toHaveLength(0);
    expect(tariffReviewItems(items)).toHaveLength(0);
  });

  it('a matched tariff yields a READY consultation item with quantity 1', async () => {
    const items = await collectBillingWorklist(
      txWith({ tariffRules: [DAY_RULE], startEvent: { createdAt: new Date('2026-08-04T02:00:00Z') } }),
      'visit-1',
    );
    const consult = items.find((i) => i.sourceType === 'CONSULTATION');
    expect(consult).toMatchObject({ state: 'READY', billed: false, quantity: 1, description: 'Consultation (Day)' });
    expect(unbilledReadyItems(items)).toContainEqual(expect.objectContaining({ sourceType: 'CONSULTATION' }));
  });

  it('an active consultation line shows billed; a cancelled one shows WAIVED', async () => {
    const billed = await collectBillingWorklist(
      txWith({
        tariffRules: [DAY_RULE],
        consultationLines: [{ id: 'cl1', description: 'Consultation (Day)', cancelledAt: null }],
      }),
      'visit-1',
    );
    expect(billed.find((i) => i.sourceType === 'CONSULTATION')).toMatchObject({ billed: true, invoiceLineId: 'cl1' });

    const waived = await collectBillingWorklist(
      txWith({
        tariffRules: [DAY_RULE],
        consultationLines: [{ id: 'cl1', description: 'Consultation (Day)', cancelledAt: new Date() }],
        startEvent: { createdAt: new Date('2026-08-04T02:00:00Z') },
      }),
      'visit-1',
    );
    expect(waived.find((i) => i.sourceType === 'CONSULTATION')).toMatchObject({ state: 'WAIVED', billed: false });
    expect(unbilledReadyItems(waived).filter((i) => i.sourceType === 'CONSULTATION')).toHaveLength(0);
  });

  it('an unmatchable time yields TARIFF_REVIEW — a blocker, never a guessed line', async () => {
    const items = await collectBillingWorklist(
      txWith({
        tariffRules: [{ ...DAY_RULE, startTime: '08:00', endTime: '12:00' }],
        startEvent: { createdAt: new Date('2026-08-04T14:00:00Z') }, // 22:00 KL
      }),
      'visit-1',
    );
    expect(items.find((i) => i.sourceType === 'CONSULTATION')).toMatchObject({ state: 'TARIFF_REVIEW' });
  });

  it('an exempt visit shows NOT_CHARGEABLE for consultation', async () => {
    const items = await collectBillingWorklist(
      txWith({
        tariffRules: [DAY_RULE],
        visit: { classification: 'OTC_ONLY' },
        startEvent: { createdAt: new Date('2026-08-04T02:00:00Z') },
      }),
      'visit-1',
    );
    expect(items.find((i) => i.sourceType === 'CONSULTATION')).toMatchObject({ state: 'NOT_CHARGEABLE' });
  });
});
