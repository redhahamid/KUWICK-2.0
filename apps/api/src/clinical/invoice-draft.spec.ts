import { InvoiceDraft, buildInvoiceDraft, draftTotals } from './invoice-draft';

// ===========================================================================
// b4 PIECE B — THE VISIT'S DRAFT INVOICE, PRICED.
//
// The bar's four promises, asserted here where they are decidable:
//   1. every source auto-pulls — medications, orders, direct services and the
//      consultation charge, with no client-side assembly;
//   2. an OTC visit carries no consultation charge, and SAYS why;
//   3. the discount already recorded on the invoice reaches the draft with
//      its reason;
//   4. a source that changes changes the draft, because the draft is built
//      from the sources every time it is read.
//
// The tx is faked the way `billing-worklist.spec.ts` fakes it — the draft is
// a composition, and what is under test is the composition.
// ===========================================================================

const CONSULTATION_SERVICE = { id: 'svc-consult', name: 'Consultation (Day)', active: true };

const DAY_RULE = {
  id: 'rule-day',
  classification: 'CONSULTATION',
  startTime: '08:00',
  endTime: '17:59',
  effectiveFrom: null,
  effectiveTo: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  serviceCatalog: CONSULTATION_SERVICE,
};

interface World {
  prescriptions?: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  /** Active invoice lines that reference a source. */
  lines?: Array<Record<string, unknown>>;
  consultationLines?: Array<Record<string, unknown>>;
  visit?: Record<string, unknown>;
  tariffRules?: Array<Record<string, unknown>>;
  invoice?: Record<string, unknown> | null;
  /** itemId/serviceCatalogId → price, for the pricing resolver. */
  itemPrice?: Record<string, number>;
  servicePrice?: Record<string, number>;
}

function txWith(world: World) {
  const visit = {
    id: 'visit-1',
    clinicId: 'clinic-1',
    panelClinicId: null,
    classification: null,
    checkInAt: new Date('2026-08-04T02:00:00Z'), // 10:00 Asia/Kuala_Lumpur
    clinic: { timezone: 'Asia/Kuala_Lumpur' },
    queueTicket: { queueType: 'WALK_IN', status: 'IN_CONSULTATION', calledAt: null },
    ...world.visit,
  };
  return {
    prescription: {
      findMany: jest.fn().mockResolvedValue(world.prescriptions ?? []),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const rx = (world.prescriptions ?? []).find((p) => p.id === where.id) as
          | Record<string, unknown>
          | undefined;
        if (!rx) return null;
        const itemId = (rx.itemId as string) ?? 'item-x';
        return { itemId, item: { sellPrice: world.itemPrice?.[itemId] ?? 0 } };
      }),
    },
    orderService: {
      findMany: jest.fn().mockResolvedValue(world.orders ?? []),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const order = (world.orders ?? []).find((o) => o.id === where.id) as
          | Record<string, unknown>
          | undefined;
        if (!order) return null;
        const serviceCatalogId = (order.serviceCatalogId as string) ?? 'svc-x';
        return {
          serviceCatalogId,
          serviceCatalog: { price: world.servicePrice?.[serviceCatalogId] ?? 0 },
        };
      }),
    },
    serviceCatalog: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({
        price: world.servicePrice?.[where.id] ?? 0,
      })),
    },
    panelClinic: { findUnique: jest.fn().mockResolvedValue(null) },
    panelPriceOverride: { findFirst: jest.fn().mockResolvedValue(null) },
    invoiceLine: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        where.sourceConsultationVisitId ? (world.consultationLines ?? []) : (world.lines ?? []),
      ),
    },
    invoice: { findFirst: jest.fn().mockResolvedValue(world.invoice ?? null) },
    visit: { findUnique: jest.fn().mockResolvedValue(visit) },
    consultationTariffRule: { findMany: jest.fn().mockResolvedValue(world.tariffRules ?? [DAY_RULE]) },
    visitWorkflowEvent: { findFirst: jest.fn().mockResolvedValue(null) },
  } as never;
}

const RX = (
  id: string,
  overrides: Partial<{
    quantity: number;
    supplyMode: string | null;
    status: string;
    itemId: string;
    name: string;
  }> = {},
) => ({
  id,
  itemId: overrides.itemId ?? `item-${id}`,
  quantity: overrides.quantity ?? 2,
  supplyMode: overrides.supplyMode === undefined ? 'ONSITE_DISPENSE' : overrides.supplyMode,
  status: overrides.status ?? 'DISPENSED',
  item: { name: overrides.name ?? `Med ${id}` },
});

const ORDER = (
  id: string,
  overrides: Partial<{ orderType: string; status: string; serviceCatalogId: string; name: string }> = {},
) => ({
  id,
  procedureName: overrides.name ?? `Procedure ${id}`,
  orderType: overrides.orderType ?? 'TASK_ORDER',
  status: overrides.status ?? 'COMPLETED',
  serviceCatalogId: overrides.serviceCatalogId ?? `svc-${id}`,
});

const find = (draft: InvoiceDraft, sourceId: string) =>
  draft.lines.find((line) => line.sourceId === sourceId);

// ---------------------------------------------------------------------------
// 1. EVERY SOURCE AUTO-PULLS
// ---------------------------------------------------------------------------
describe('the draft auto-pulls every billable source on the visit', () => {
  const world: World = {
    prescriptions: [RX('rx-1', { quantity: 3, itemId: 'item-amox' })],
    orders: [
      ORDER('ord-1', { orderType: 'TASK_ORDER', serviceCatalogId: 'svc-xray', name: 'Chest X-ray' }),
      ORDER('svc-1', {
        orderType: 'STANDARD_SERVICE',
        status: 'COMPLETED',
        serviceCatalogId: 'svc-dressing',
        name: 'Wound dressing',
      }),
    ],
    itemPrice: { 'item-amox': 4.5 },
    servicePrice: { 'svc-xray': 60, 'svc-dressing': 25, 'svc-consult': 35 },
  };

  it('carries medications, orders/procedures, direct services and the consultation, priced', async () => {
    const draft = await buildInvoiceDraft(txWith(world), 'visit-1');

    expect(draft.lines.map((line) => line.sourceType)).toEqual([
      'PRESCRIPTION',
      'ORDER_SERVICE',
      'ORDER_SERVICE',
      'CONSULTATION',
    ]);

    // Medication is quantity × price, and the QUANTITY is the source's.
    expect(find(draft, 'rx-1')).toMatchObject({ quantity: 3, unitPrice: 4.5, amount: 13.5, counted: true });
    expect(find(draft, 'ord-1')).toMatchObject({ quantity: 1, unitPrice: 60, amount: 60 });
    expect(find(draft, 'svc-1')).toMatchObject({ quantity: 1, unitPrice: 25, amount: 25 });
    expect(find(draft, 'visit-1')).toMatchObject({
      sourceType: 'CONSULTATION',
      description: 'Consultation (Day)',
      unitPrice: 35,
      counted: true,
    });

    // The running total is the sum of the four, and nothing is unpriced.
    expect(draft.subtotal).toBe(133.5);
    expect(draft.total).toBe(133.5);
    expect(draft.unpricedCount).toBe(0);
  });

  it('reads a BILLED line from the invoice instead of re-pricing it', async () => {
    // The catalogue has moved to 9.00 since the charge was made. The draft
    // must report the 4.50 that was actually billed.
    const draft = await buildInvoiceDraft(
      txWith({
        ...world,
        itemPrice: { 'item-amox': 9 },
        lines: [{ id: 'line-1', sourcePrescriptionId: 'rx-1', sourceOrderServiceId: null }],
        invoice: {
          id: 'inv-1',
          invoiceNumber: 'INV-000001',
          invoiceDiscountType: null,
          invoiceDiscountValue: null,
          invoiceDiscountReason: null,
          invoiceDiscountByStaffId: null,
          invoiceDiscountAt: null,
          lines: [
            {
              id: 'line-1',
              quantity: 3,
              unitPrice: 4.5,
              amount: 13.5,
              lineDiscountType: null,
              lineDiscountValue: null,
              lineDiscountAmount: null,
            },
          ],
        },
      }),
      'visit-1',
    );

    expect(find(draft, 'rx-1')).toMatchObject({ billed: true, unitPrice: 4.5, amount: 13.5 });
    expect(draft.invoiceId).toBe('inv-1');
  });

  it('lists an undecided supply as UNPRICED, never as zero', async () => {
    const draft = await buildInvoiceDraft(
      txWith({
        ...world,
        prescriptions: [RX('rx-1', { supplyMode: null })],
      }),
      'visit-1',
    );

    const line = find(draft, 'rx-1')!;
    expect(line.state).toBe('UNRESOLVED_SUPPLY');
    expect(line.amount).toBeNull();
    expect(line.unitPrice).toBeNull();
    expect(line.counted).toBe(false);
    expect(line.stateReason).toMatch(/has not been confirmed/i);
  });

  it('counts clinic medication that is ordered but not yet dispensed', async () => {
    const draft = await buildInvoiceDraft(
      txWith({
        ...world,
        prescriptions: [RX('rx-1', { quantity: 3, itemId: 'item-amox', status: 'ORDERED' })],
      }),
      'visit-1',
    );

    const line = find(draft, 'rx-1')!;
    expect(line.state).toBe('AWAITING_DISPENSE');
    expect(line.counted).toBe(true);
    expect(line.amount).toBe(13.5);
  });

  it('lists a cancelled order with its reason and keeps it out of the total', async () => {
    const draft = await buildInvoiceDraft(
      txWith({ ...world, orders: [ORDER('ord-1', { status: 'CANCELLED', serviceCatalogId: 'svc-xray' })] }),
      'visit-1',
    );

    const line = find(draft, 'ord-1')!;
    expect(line.state).toBe('NOT_CHARGEABLE');
    expect(line.counted).toBe(false);
    expect(line.amount).toBeNull();
    expect(draft.subtotal).toBe(35 + 13.5); // consultation + the medication only
  });
});

// ---------------------------------------------------------------------------
// 2. OTC SKIPS THE CONSULTATION CHARGE
//
// The rule is `consultation-tariff.ts`'s, not this module's — asserted
// THROUGH the draft because that is where a regression would be felt.
// ---------------------------------------------------------------------------
describe('the consultation charge follows the tariff resolver, not the bar', () => {
  const base: World = {
    prescriptions: [RX('rx-1', { quantity: 1, itemId: 'item-x' })],
    itemPrice: { 'item-x': 10 },
    servicePrice: { 'svc-consult': 35 },
  };

  it('OTC (queue type C) carries NO consultation charge, and says why', async () => {
    const draft = await buildInvoiceDraft(
      txWith({
        ...base,
        visit: { queueTicket: { queueType: 'OTC', status: 'IN_CONSULTATION', calledAt: null } },
      }),
      'visit-1',
    );

    const consultation = draft.lines.find((line) => line.sourceType === 'CONSULTATION')!;
    expect(consultation.state).toBe('NOT_CHARGEABLE');
    expect(consultation.counted).toBe(false);
    expect(consultation.amount).toBeNull();
    expect(consultation.stateReason).toBe('This kind of visit carries no consultation charge.');
    // The total is the medication alone.
    expect(draft.subtotal).toBe(10);
  });

  it.each([
    ['EMERGENCY', 'E'],
    ['WALK_IN', 'W'],
    ['APPOINTMENT', 'A'],
  ])('%s (queue type %s) DOES carry the consultation charge', async (queueType) => {
    const draft = await buildInvoiceDraft(
      txWith({
        ...base,
        visit: { queueTicket: { queueType, status: 'IN_CONSULTATION', calledAt: null } },
      }),
      'visit-1',
    );

    const consultation = draft.lines.find((line) => line.sourceType === 'CONSULTATION')!;
    expect(consultation.state).toBe('READY');
    expect(consultation.counted).toBe(true);
    expect(consultation.unitPrice).toBe(35);
    expect(draft.subtotal).toBe(45);
  });

  /**
   * b4 PIECE C (2a) — THE STAGING REPORT, AND WHAT IT TURNED OUT TO BE.
   *
   * Staging showed a doctor consultation billed as Orders RM45 + Medications
   * RM50 = RM95 with no consultation charge. The visit was NOT OTC: the cause
   * was that the UAT clinic has no `ConsultationTariffRule` at all, and this
   * spec's previous assertion — "adds no consultation row at all when the
   * clinic has configured no tariff" — was pinning exactly that silence as
   * correct. It is not correct. It is a consultation fee lost on every visit,
   * with no screen mentioning it.
   *
   * What has NOT changed: no price is invented. D-094's rule stands — no
   * tariff, no charge, and no completion blocker either, because a clinic
   * that has not configured tariffs still has to be able to finish
   * consultations. What changed is that the omission is now SAID.
   */
  it('a clinic with NO tariff still gets a consultation line — unpriced, and saying why', async () => {
    const draft = await buildInvoiceDraft(txWith({ ...base, tariffRules: [] }), 'visit-1');

    // The line exists at all — the whole point of the change.
    const consultation = draft.lines.find((line) => line.sourceType === 'CONSULTATION');
    expect(consultation).toBeDefined();
    expect(consultation!.state).toBe('NOT_CONFIGURED');
    // Never RM 0.00 — that reads as a consultation the clinic gives away.
    expect(consultation!.unitPrice).toBeNull();
    expect(consultation!.amount).toBeNull();
    expect(consultation!.counted).toBe(false);
    expect(consultation!.stateReason).toMatch(/no consultation tariff configured/i);
    // And it says where to fix it, because the person reading this screen is
    // the person who can.
    expect(consultation!.stateReason).toMatch(/Consultation Tariffs/);
    // The total is still only what IS priced. An unpriced line must not be
    // guessed into the sum.
    expect(draft.subtotal).toBe(10);
  });

  it('the unpriced consultation is not counted as a priced-but-unresolved item either', async () => {
    // `unpricedCount` drives "N items not priced yet", which is about COUNTED
    // work whose price failed to resolve. A consultation nobody can charge for
    // is a different fact and has its own wording on the card.
    const draft = await buildInvoiceDraft(txWith({ ...base, tariffRules: [] }), 'visit-1');
    expect(draft.unpricedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. THE DISCOUNT, WITH ITS REASON
// ---------------------------------------------------------------------------
describe('the invoice-level discount reaches the draft with its reason', () => {
  const invoiceWith = (discount: Record<string, unknown>) => ({
    id: 'inv-1',
    invoiceNumber: 'INV-000001',
    invoiceDiscountReason: null,
    invoiceDiscountByStaffId: null,
    invoiceDiscountAt: null,
    lines: [],
    ...discount,
  });

  it('reports a percentage discount, its computed amount, and the recorded reason', async () => {
    const draft = await buildInvoiceDraft(
      txWith({
        orders: [ORDER('svc-1', { orderType: 'STANDARD_SERVICE', serviceCatalogId: 'svc-dressing' })],
        servicePrice: { 'svc-dressing': 100, 'svc-consult': 35 },
        invoice: invoiceWith({
          invoiceDiscountType: 'PERCENTAGE',
          invoiceDiscountValue: 10,
          invoiceDiscountReason: 'Regular dressing patient',
          invoiceDiscountByStaffId: 'staff-9',
          invoiceDiscountAt: new Date('2026-08-17T01:00:00Z'),
        }),
      }),
      'visit-1',
    );

    expect(draft.subtotal).toBe(135);
    expect(draft.discount).toMatchObject({
      type: 'PERCENTAGE',
      value: 10,
      amount: 13.5,
      reason: 'Regular dressing patient',
      byStaffId: 'staff-9',
    });
    expect(draft.total).toBe(121.5);
  });

  it('reports a fixed-amount discount the same way', async () => {
    const draft = await buildInvoiceDraft(
      txWith({
        orders: [ORDER('svc-1', { orderType: 'STANDARD_SERVICE', serviceCatalogId: 'svc-dressing' })],
        servicePrice: { 'svc-dressing': 100, 'svc-consult': 35 },
        invoice: invoiceWith({
          invoiceDiscountType: 'FIXED_AMOUNT',
          invoiceDiscountValue: 20,
          invoiceDiscountReason: 'Staff family',
        }),
      }),
      'visit-1',
    );

    expect(draft.discount).toMatchObject({ type: 'FIXED_AMOUNT', value: 20, amount: 20, reason: 'Staff family' });
    expect(draft.total).toBe(115);
  });

  it('reports no discount when none has been recorded', async () => {
    const draft = await buildInvoiceDraft(
      txWith({ servicePrice: { 'svc-consult': 35 } }),
      'visit-1',
    );
    expect(draft.discount).toBeNull();
    expect(draft.total).toBe(draft.subtotal);
  });
});

// ---------------------------------------------------------------------------
// 4. LIVE UPDATE ON SOURCE CHANGES
//
// The draft holds nothing between reads: it is derived from the sources on
// every call, so adding or removing a source is reflected without any
// reconciliation step. Asserted as two reads of a changing world.
// ---------------------------------------------------------------------------
describe('editing a source changes the draft', () => {
  const servicePrice = { 'svc-xray': 60, 'svc-consult': 35 };

  it('adding a medicine raises the total; removing it lowers it again', async () => {
    const before = await buildInvoiceDraft(
      txWith({ orders: [ORDER('ord-1', { serviceCatalogId: 'svc-xray' })], servicePrice }),
      'visit-1',
    );
    expect(before.subtotal).toBe(95);
    expect(before.lines).toHaveLength(2);

    const after = await buildInvoiceDraft(
      txWith({
        orders: [ORDER('ord-1', { serviceCatalogId: 'svc-xray' })],
        prescriptions: [RX('rx-1', { quantity: 4, itemId: 'item-p' })],
        itemPrice: { 'item-p': 2.5 },
        servicePrice,
      }),
      'visit-1',
    );
    expect(after.subtotal).toBe(105);
    expect(after.lines).toHaveLength(3);

    // And back: a removed prescription leaves no trace in the draft.
    const removed = await buildInvoiceDraft(
      txWith({ orders: [ORDER('ord-1', { serviceCatalogId: 'svc-xray' })], servicePrice }),
      'visit-1',
    );
    expect(removed.subtotal).toBe(95);
    expect(removed.lines).toHaveLength(2);
  });

  it('an order that becomes completed becomes chargeable', async () => {
    const pending = await buildInvoiceDraft(
      txWith({ orders: [ORDER('ord-1', { status: 'PENDING', serviceCatalogId: 'svc-xray' })], servicePrice }),
      'visit-1',
    );
    expect(find(pending, 'ord-1')).toMatchObject({ state: 'NOT_READY', counted: false, amount: null });
    expect(pending.subtotal).toBe(35);

    const done = await buildInvoiceDraft(
      txWith({ orders: [ORDER('ord-1', { status: 'COMPLETED', serviceCatalogId: 'svc-xray' })], servicePrice }),
      'visit-1',
    );
    expect(find(done, 'ord-1')).toMatchObject({ state: 'READY', counted: true, amount: 60 });
    expect(done.subtotal).toBe(95);
  });
});

// ---------------------------------------------------------------------------
// THE ARITHMETIC, on its own.
// ---------------------------------------------------------------------------
describe('draftTotals', () => {
  it('sums only the counted lines', () => {
    expect(
      draftTotals({
        lines: [
          { id: 'a', amount: 10, counted: true },
          { id: 'b', amount: 5, counted: false },
          { id: 'c', amount: 2.5, counted: true },
        ],
        invoiceDiscountType: null,
        invoiceDiscountValue: null,
      }),
    ).toEqual({ subtotal: 12.5, discountAmount: 0, total: 12.5, unpricedCount: 0 });
  });

  it('reports counted lines that have no price, and leaves them out of the sum', () => {
    expect(
      draftTotals({
        lines: [
          { id: 'a', amount: 10, counted: true },
          { id: 'b', amount: null, counted: true },
        ],
        invoiceDiscountType: null,
        invoiceDiscountValue: null,
      }),
    ).toEqual({ subtotal: 10, discountAmount: 0, total: 10, unpricedCount: 1 });
  });

  it('applies a line discount before the overall one', () => {
    // 100 − 10 (line) = 90; 10% of the 90 subtotal-after-line-discounts is
    // the engine's own ordering, and the draft does not re-implement it.
    const totals = draftTotals({
      lines: [
        { id: 'a', amount: 100, counted: true, lineDiscountType: 'FIXED_AMOUNT', lineDiscountValue: 10 },
      ],
      invoiceDiscountType: 'PERCENTAGE',
      invoiceDiscountValue: 10,
    });
    expect(totals.subtotal).toBe(100);
    expect(totals.total).toBe(81);
  });

  it('never returns a negative total', () => {
    const totals = draftTotals({
      lines: [{ id: 'a', amount: 20, counted: true }],
      invoiceDiscountType: 'FIXED_AMOUNT',
      invoiceDiscountValue: 500,
    });
    expect(totals.total).toBeGreaterThanOrEqual(0);
  });
});
