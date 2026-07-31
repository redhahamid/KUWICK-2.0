import { StockMovementType } from '@prisma/client';
import { StockService } from './stock.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    stockBatch: { create: jest.fn() },
    stockMovement: { create: jest.fn() },
    stockLevel: { upsert: jest.fn() },
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
