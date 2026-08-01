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
  } as unknown as TenantScopedPrismaClient;
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
    (prisma.stockLevel.upsert as jest.Mock).mockResolvedValue({ id: 'level-1' });

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
    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        clinicId: 'clinic-1',
        itemId: 'item-1',
        batchId: 'batch-1',
        movementType: StockMovementType.GOODS_RECEIVED,
        quantityDelta: 20,
        referenceType: 'QuickStockIn',
        referenceId: 'batch-1',
      },
    });
    expect(prisma.stockLevel.upsert).toHaveBeenCalledWith({
      where: { tenantId_clinicId_itemId: { tenantId: 'test-tenant', clinicId: 'clinic-1', itemId: 'item-1' } },
      create: { tenantId: 'test-tenant', clinicId: 'clinic-1', itemId: 'item-1', quantityOnHand: 20 },
      update: { quantityOnHand: { increment: 20 } },
    });
  });

  it('allows supplier/expiry/batchNumber/addedByStaffId to be omitted', async () => {
    const { service, prisma } = createService();
    (prisma.stockBatch.create as jest.Mock).mockResolvedValue({ id: 'batch-2' });
    (prisma.stockMovement.create as jest.Mock).mockResolvedValue({ id: 'move-2' });
    (prisma.stockLevel.upsert as jest.Mock).mockResolvedValue({ id: 'level-2' });

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

describe('StockService.performStockTake', () => {
  it('writes an ADJUSTMENT movement and updates the level when counted differs from system', async () => {
    const { service, prisma } = createService();
    (prisma.stockLevel.findUnique as jest.Mock).mockResolvedValue({
      quantityOnHand: 20,
      item: { name: 'Paracetamol' },
    });
    (prisma.stockMovement.create as jest.Mock).mockResolvedValue({ id: 'move-1' });
    (prisma.stockLevel.upsert as jest.Mock).mockResolvedValue({ id: 'level-1' });

    const result = await withTenant(() =>
      service.performStockTake({
        clinicId: 'clinic-1',
        countedByStaffId: 'staff-1',
        counts: [{ itemId: 'item-1', countedQuantity: 18 }],
      }),
    );

    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        clinicId: 'clinic-1',
        itemId: 'item-1',
        movementType: StockMovementType.ADJUSTMENT,
        quantityDelta: -2,
        referenceType: 'StockTake',
        createdByUserId: 'staff-1',
      },
    });
    expect(prisma.stockLevel.upsert).toHaveBeenCalledWith({
      where: { tenantId_clinicId_itemId: { tenantId: 'test-tenant', clinicId: 'clinic-1', itemId: 'item-1' } },
      create: { tenantId: 'test-tenant', clinicId: 'clinic-1', itemId: 'item-1', quantityOnHand: 18 },
      update: { quantityOnHand: 18 },
    });
    expect(result).toEqual({
      clinicId: 'clinic-1',
      countedItems: 1,
      adjustedItems: 1,
      results: [{ itemId: 'item-1', itemName: 'Paracetamol', systemQuantity: 20, countedQuantity: 18, variance: -2 }],
    });
  });

  it('writes nothing when the counted quantity matches the system quantity', async () => {
    const { service, prisma } = createService();
    (prisma.stockLevel.findUnique as jest.Mock).mockResolvedValue({
      quantityOnHand: 10,
      item: { name: 'Bandage' },
    });

    const result = await withTenant(() =>
      service.performStockTake({
        clinicId: 'clinic-1',
        counts: [{ itemId: 'item-2', countedQuantity: 10 }],
      }),
    );

    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    expect(prisma.stockLevel.upsert).not.toHaveBeenCalled();
    expect(result.adjustedItems).toBe(0);
    expect(result.results[0].variance).toBe(0);
  });

  it('falls back to the Item table and treats a missing StockLevel as zero on hand', async () => {
    const { service, prisma } = createService();
    (prisma.stockLevel.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.item.findUnique as jest.Mock).mockResolvedValue({ name: 'New Item' });
    (prisma.stockMovement.create as jest.Mock).mockResolvedValue({ id: 'move-2' });
    (prisma.stockLevel.upsert as jest.Mock).mockResolvedValue({ id: 'level-2' });

    const result = await withTenant(() =>
      service.performStockTake({
        clinicId: 'clinic-1',
        counts: [{ itemId: 'item-3', countedQuantity: 5 }],
      }),
    );

    expect(result.results[0]).toEqual({
      itemId: 'item-3',
      itemName: 'New Item',
      systemQuantity: 0,
      countedQuantity: 5,
      variance: 5,
    });
  });
});
