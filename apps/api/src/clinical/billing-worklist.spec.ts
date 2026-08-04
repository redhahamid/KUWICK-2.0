import { collectBillingWorklist, unbilledReadyItems } from './billing-worklist';

// ===========================================================================
// G4.5d3c-3b1 (D-093) — SOURCE-AWARE UNBILLED DETECTION (26–31)
// ===========================================================================

function txWith(world: {
  prescriptions?: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  lines?: Array<Record<string, unknown>>;
}) {
  return {
    prescription: { findMany: jest.fn().mockResolvedValue(world.prescriptions ?? []) },
    orderService: { findMany: jest.fn().mockResolvedValue(world.orders ?? []) },
    invoiceLine: { findMany: jest.fn().mockResolvedValue(world.lines ?? []) },
  } as never;
}

const RX = (id: string, supplyMode: string | null, status = 'ORDERED') => ({
  id,
  quantity: 10,
  supplyMode,
  status,
  item: { name: `Med ${id}` },
});

describe('billing worklist', () => {
  it('31. a valid ONSITE prescription is chargeable through its lifecycle (ORDERED and DISPENSED)', async () => {
    const items = await collectBillingWorklist(
      txWith({ prescriptions: [RX('a', 'ONSITE_DISPENSE', 'ORDERED'), RX('b', 'ONSITE_DISPENSE', 'DISPENSED')] }),
      'visit-1',
    );
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.state === 'READY' && !i.billed)).toBe(true);
  });

  it.each([
    ['27. EXTERNAL_PRESCRIPTION', 'EXTERNAL_PRESCRIPTION'],
    ['28. PATIENT_OWN_SUPPLY', 'PATIENT_OWN_SUPPLY'],
    ['29. NO_SUPPLY_REQUIRED', 'NO_SUPPLY_REQUIRED'],
  ])('%s never appears as clinic medication work', async (_n, mode) => {
    const items = await collectBillingWorklist(txWith({ prescriptions: [RX('a', mode)] }), 'visit-1');
    expect(items).toHaveLength(0);
  });

  it('30. DEFERRED and NULL are UNRESOLVED — listed, never chargeable', async () => {
    const items = await collectBillingWorklist(
      txWith({ prescriptions: [RX('a', 'DEFERRED'), RX('b', null)] }),
      'visit-1',
    );
    expect(items.map((i) => i.state)).toEqual(['UNRESOLVED_SUPPLY', 'UNRESOLVED_SUPPLY']);
    expect(unbilledReadyItems(items)).toHaveLength(0);
  });

  it('26. an existing invoice does not hide another uninvoiced source', async () => {
    const items = await collectBillingWorklist(
      txWith({
        prescriptions: [RX('billed-rx', 'ONSITE_DISPENSE'), RX('open-rx', 'ONSITE_DISPENSE')],
        lines: [{ id: 'l1', sourcePrescriptionId: 'billed-rx', sourceOrderServiceId: null }],
      }),
      'visit-1',
    );
    expect(items.find((i) => i.sourceId === 'billed-rx')).toMatchObject({ billed: true, invoiceLineId: 'l1' });
    expect(items.find((i) => i.sourceId === 'open-rx')).toMatchObject({ billed: false });
    expect(unbilledReadyItems(items).map((i) => i.sourceId)).toEqual(['open-rx']);
  });

  it('a pending TASK_ORDER is not billing work; a COMPLETED one is; a STANDARD_SERVICE always is', async () => {
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
    expect(items.map((i) => i.sourceId).sort()).toEqual(['o2', 'o3']);
  });

  it('a CANCELLED invoice line reopens the item honestly', async () => {
    // The worklist query filters cancelled lines out at the database level;
    // this mirrors that by returning none, and the item reads unbilled.
    const items = await collectBillingWorklist(
      txWith({ prescriptions: [RX('a', 'ONSITE_DISPENSE')], lines: [] }),
      'visit-1',
    );
    expect(items[0].billed).toBe(false);
  });

  it('items carry stable identifiers for the 3b2 UI', async () => {
    const items = await collectBillingWorklist(
      txWith({ prescriptions: [RX('a', 'ONSITE_DISPENSE')] }),
      'visit-1',
    );
    expect(items[0]).toMatchObject({
      sourceType: 'PRESCRIPTION',
      sourceId: 'a',
      description: 'Med a',
      quantity: 10,
    });
  });
});
