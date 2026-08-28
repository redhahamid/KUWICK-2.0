import { StockMovementType } from '@prisma/client';
import { StockService } from './stock.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    stockBatch: { create: jest.fn(), findMany: jest.fn() },
    stockMovement: { create: jest.fn() },
    stockLevel: { upsert: jest.fn(), findUnique: jest.fn() },
    item: { findUnique: jest.fn() },
    $transaction: undefined as unknown,
  } as unknown as TenantScopedPrismaClient;
  // The adjust path runs its movement and its level in one transaction; the
  // mock hands the same client back so both writes land on the spies above.
  (prisma as unknown as { $transaction: unknown }).$transaction = jest.fn(
    (fn: (c: TenantScopedPrismaClient) => unknown) => fn(prisma),
  );
  return { service: new StockService(prisma), prisma };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('StockService.quickAdd', () => {
  it('creates a batch carrying supplier/expiry/added-by and increments stock', async () => {
    const { service, prisma } = createService();
    (prisma.stockBatch.create as jest.Mock).mockResolvedValue({ id: 'batch-1' });
    (prisma.stockMovement.create as jest.Mock).mockResolvedValue({ id: 'move-1' });
    (prisma.stockLevel.upsert as jest.Mock).mockResolvedValue({ id: 'level-1', quantityOnHand: 20 });

    await withTenant(() =>
      service.quickAdd({
        clinicId: 'clinic-1',
        itemId: 'item-1',
        quantity: 20,
        supplierId: 'supplier-1',
        expiryDate: '2027-01-01',
        batchNumber: 'B-100',
        addedByStaffId: 'staff-1',
      }),
    );

    expect(prisma.stockBatch.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        clinicId: 'clinic-1',
        itemId: 'item-1',
        quantity: 20,
        batchNumber: 'B-100',
        expiryDate: new Date('2027-01-01'),
        receivedDate: expect.any(Date),
        supplierId: 'supplier-1',
        addedByStaffId: 'staff-1',
      },
    });
    // WAVE 2 — every stock write now goes through `postMovement`, which
    // records the structured reason and the acting STAFF member alongside the
    // login, and selects only the id it needs back.
    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'test-tenant',
        clinicId: 'clinic-1',
        itemId: 'item-1',
        batchId: 'batch-1',
        movementType: StockMovementType.GOODS_RECEIVED,
        quantityDelta: 20,
        referenceType: 'QuickStockIn',
        referenceId: 'batch-1',
        createdByStaffId: 'staff-1',
      }),
      select: { id: true },
    });
    expect(prisma.stockLevel.upsert).toHaveBeenCalledWith({
      where: { tenantId_clinicId_itemId: { tenantId: 'test-tenant', clinicId: 'clinic-1', itemId: 'item-1' } },
      create: { tenantId: 'test-tenant', clinicId: 'clinic-1', itemId: 'item-1', quantityOnHand: 20 },
      update: { quantityOnHand: { increment: 20 } },
      select: { quantityOnHand: true },
    });
  });

  it('allows supplier/expiry/batchNumber/addedByStaffId to be omitted', async () => {
    const { service, prisma } = createService();
    (prisma.stockBatch.create as jest.Mock).mockResolvedValue({ id: 'batch-2' });
    (prisma.stockMovement.create as jest.Mock).mockResolvedValue({ id: 'move-2' });
    (prisma.stockLevel.upsert as jest.Mock).mockResolvedValue({ id: 'level-2', quantityOnHand: 5 });

    await withTenant(() => service.quickAdd({ clinicId: 'clinic-1', itemId: 'item-1', quantity: 5 }));

    expect(prisma.stockBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        supplierId: undefined,
        addedByStaffId: undefined,
        expiryDate: undefined,
        batchNumber: undefined,
      }),
    });
  });
});

describe('StockService.listNearExpiry', () => {
  it('computes daysToExpiry for each batch and orders by soonest first', async () => {
    const { service, prisma } = createService();
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);
    (prisma.stockBatch.findMany as jest.Mock).mockResolvedValue([
      { id: 'batch-1', expiryDate: soon, quantity: 5 },
    ]);

    const result = await service.listNearExpiry('clinic-1', 90);

    expect(prisma.stockBatch.findMany).toHaveBeenCalledWith({
      where: {
        clinicId: 'clinic-1',
        quantity: { gt: 0 },
        expiryDate: { not: null, lte: expect.any(Date) },
      },
      include: { item: true, clinic: true, supplier: true },
      orderBy: { expiryDate: 'asc' },
    });
    expect(result[0].daysToExpiry).toBeGreaterThanOrEqual(9);
    expect(result[0].daysToExpiry).toBeLessThanOrEqual(11);
  });
});

describe('StockService.performStockTake — a PREVIEW since wave 2, not a write', () => {
  it('reports the variance and changes NO stock', async () => {
    // The owner brief is explicit: "Do NOT change live stock simply because
    // someone typed a count before approval." This endpoint used to adjust the
    // live level the instant a count arrived. It now computes the variance and
    // writes nothing; the real cycle (count → submit → a SECOND person
    // approves → post) lives in StockTakeService.
    const { service, prisma } = createService();
    (prisma.stockLevel.findUnique as jest.Mock).mockResolvedValue({
      quantityOnHand: 20,
      item: { name: 'Paracetamol' },
    });

    const result = await withTenant(() =>
      service.performStockTake({
        clinicId: 'clinic-1',
        countedByStaffId: 'staff-1',
        counts: [{ itemId: 'item-1', countedQuantity: 18 }],
      }),
    );

    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    expect(prisma.stockLevel.upsert).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      clinicId: 'clinic-1',
      countedItems: 1,
      adjustedItems: 0,
      posted: false,
      results: [{ itemId: 'item-1', itemName: 'Paracetamol', systemQuantity: 20, countedQuantity: 18, variance: -2 }],
    });
    expect(result.note).toMatch(/approves the variance/);
  });

  it('reports a zero variance when the count matches', async () => {
    const { service, prisma } = createService();
    (prisma.stockLevel.findUnique as jest.Mock).mockResolvedValue({
      quantityOnHand: 20,
      item: { name: 'Paracetamol' },
    });

    const result = await withTenant(() =>
      service.performStockTake({
        clinicId: 'clinic-1',
        countedByStaffId: 'staff-1',
        counts: [{ itemId: 'item-1', countedQuantity: 20 }],
      }),
    );

    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    expect(result.results[0].variance).toBe(0);
  });
});

describe('StockService.adjust — the quick +/- on the inventory list', () => {
  it('writes an ADJUSTMENT carrying the reason, NOT a goods receipt', async () => {
    // quickAdd would create a StockBatch and a GOODS_RECEIVED movement: stock
    // that arrived from a supplier nobody named, with no expiry, landing in
    // the near-expiry screen. A person correcting 40 to 41 received nothing.
    const { service, prisma } = createService();
    (prisma.item.findUnique as jest.Mock).mockResolvedValue({ id: 'item-1' });
    (prisma.stockMovement.create as jest.Mock).mockResolvedValue({ id: 'move-1' });
    (prisma.stockLevel.upsert as jest.Mock).mockResolvedValue({ id: 'level-1', quantityOnHand: 41 });

    await withTenant(() =>
      service.adjust({ clinicId: 'clinic-1', itemId: 'item-1', quantityDelta: 1, reason: 'Shelf count' }),
    );

    expect(prisma.stockBatch.create).not.toHaveBeenCalled();
    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'test-tenant',
        clinicId: 'clinic-1',
        itemId: 'item-1',
        movementType: StockMovementType.ADJUSTMENT,
        quantityDelta: 1,
        referenceType: 'InventoryQuickAdjust',
        notes: 'Shelf count',
      }),
      select: { id: true },
    });
  });

  it('takes stock off the shelf on a negative delta and lets the balance go under', async () => {
    // D-020 unchanged: dispensing is never blocked by a system count that has
    // not caught up, and admin reconciles from GET /stock/negative-stock.
    const { service, prisma } = createService();
    (prisma.item.findUnique as jest.Mock).mockResolvedValue({ id: 'item-1' });
    (prisma.stockMovement.create as jest.Mock).mockResolvedValue({ id: 'move-1' });
    (prisma.stockLevel.upsert as jest.Mock).mockResolvedValue({ id: 'level-1', quantityOnHand: 41 });

    await withTenant(() =>
      service.adjust({ clinicId: 'clinic-1', itemId: 'item-1', quantityDelta: -3, reason: 'Broken vial' }),
    );

    expect(prisma.stockLevel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { quantityOnHand: { increment: -3 } } }),
    );
  });

  it('refuses an item that is not this clinic\'s', async () => {
    const { service, prisma } = createService();
    (prisma.item.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      withTenant(() => service.adjust({ clinicId: 'c', itemId: 'gone', quantityDelta: 1, reason: 'x' })),
    ).rejects.toThrow('Item not found');
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
  });
});
