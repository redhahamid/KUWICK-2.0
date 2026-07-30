import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseOrderStatus } from '@prisma/client';
import { GoodsReceivingService } from './goods-receiving.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    purchaseOrder: { findUnique: jest.fn(), update: jest.fn() },
    goodsReceivedNote: { create: jest.fn(), findUnique: jest.fn() },
    stockBatch: { create: jest.fn() },
    stockMovement: { create: jest.fn() },
    stockLevel: { upsert: jest.fn() },
    purchaseOrderLine: { update: jest.fn(), findMany: jest.fn() },
    goodsReceivedNoteLine: { create: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  return { service: new GoodsReceivingService(prisma), prisma };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('GoodsReceivingService', () => {
  it('throws NotFoundException when the purchase order does not exist', async () => {
    const { service, prisma } = createService();
    (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(withTenant(() => service.receive('missing', { clinicId: 'c1', lines: [] }))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws BadRequestException when the purchase order is already closed', async () => {
    const { service, prisma } = createService();
    (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue({
      id: 'po1',
      status: PurchaseOrderStatus.CLOSED,
      lines: [],
    });

    await expect(withTenant(() => service.receive('po1', { clinicId: 'c1', lines: [] }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException when receiving more than the outstanding quantity on a line', async () => {
    const { service, prisma } = createService();
    (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue({
      id: 'po1',
      status: PurchaseOrderStatus.ORDERED,
      lines: [{ id: 'line1', purchaseOrderId: 'po1', itemId: 'item1', orderedQuantity: 5, receivedQuantity: 3 }],
    });
    (prisma.goodsReceivedNote.create as jest.Mock).mockResolvedValue({ id: 'grn1' });

    await expect(
      withTenant(() =>
        service.receive('po1', {
          clinicId: 'c1',
          lines: [{ purchaseOrderLineId: 'line1', quantityReceived: 3 }],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a line id that does not belong to the purchase order', async () => {
    const { service, prisma } = createService();
    (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue({
      id: 'po1',
      status: PurchaseOrderStatus.ORDERED,
      lines: [{ id: 'line1', purchaseOrderId: 'po1', itemId: 'item1', orderedQuantity: 5, receivedQuantity: 0 }],
    });
    (prisma.goodsReceivedNote.create as jest.Mock).mockResolvedValue({ id: 'grn1' });

    await expect(
      withTenant(() =>
        service.receive('po1', {
          clinicId: 'c1',
          lines: [{ purchaseOrderLineId: 'not-this-po-line', quantityReceived: 1 }],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
