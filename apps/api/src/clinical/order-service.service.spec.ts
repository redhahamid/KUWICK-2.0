import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderServiceStatus, ServiceOrderType } from '@prisma/client';
import { OrderServiceService } from './order-service.service';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    orderService: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    serviceCatalog: { findUnique: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  const visits = { findById: jest.fn() } as unknown as VisitService;
  return { service: new OrderServiceService(prisma, visits), prisma, visits };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('OrderServiceService', () => {
  it('create snapshots code/procedureName/orderType and defaults requestedByStaffId to the visit doctor', async () => {
    const { service, prisma, visits } = createService();
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1', staffId: 'staff-1' });
    (prisma.serviceCatalog.findUnique as jest.Mock).mockResolvedValue({
      id: 'cat-1',
      code: 'XRAYCHEST',
      name: 'Chest X-Ray',
      orderType: ServiceOrderType.TASK_ORDER,
    });
    (prisma.orderService.create as jest.Mock).mockResolvedValue({ id: 'order-1' });

    await withTenant(() => service.create({ visitId: 'visit-1', serviceCatalogId: 'cat-1', instruction: 'PA VIEW' }));

    expect(prisma.orderService.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        clinicId: 'clinic-1',
        visitId: 'visit-1',
        serviceCatalogId: 'cat-1',
        code: 'XRAYCHEST',
        procedureName: 'Chest X-Ray',
        orderType: ServiceOrderType.TASK_ORDER,
        instruction: 'PA VIEW',
        requestedByStaffId: 'staff-1',
      },
    });
  });

  it('create throws NotFoundException for an unknown serviceCatalogId', async () => {
    const { service, prisma, visits } = createService();
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1', staffId: 'staff-1' });
    (prisma.serviceCatalog.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      withTenant(() => service.create({ visitId: 'visit-1', serviceCatalogId: 'missing' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('procedureQueue filters to TASK_ORDER only', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findMany as jest.Mock).mockResolvedValue([]);

    await service.procedureQueue({ clinicId: 'clinic-1' });

    expect(prisma.orderService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderType: ServiceOrderType.TASK_ORDER, clinicId: 'clinic-1', status: undefined },
      }),
    );
  });

  it('start moves PENDING to IN_PROGRESS', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue({ id: 'o1', status: OrderServiceStatus.PENDING });
    (prisma.orderService.update as jest.Mock).mockResolvedValue({ id: 'o1', status: OrderServiceStatus.IN_PROGRESS });

    await service.start('o1');

    expect(prisma.orderService.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { status: OrderServiceStatus.IN_PROGRESS },
    });
  });

  it('start rejects an order that is not PENDING', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue({
      id: 'o1',
      status: OrderServiceStatus.IN_PROGRESS,
    });
    await expect(service.start('o1')).rejects.toThrow(BadRequestException);
  });

  it('complete moves IN_PROGRESS to COMPLETED and records the result', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue({
      id: 'o1',
      status: OrderServiceStatus.IN_PROGRESS,
    });
    (prisma.orderService.update as jest.Mock).mockResolvedValue({ id: 'o1', status: OrderServiceStatus.COMPLETED });

    await service.complete('o1', { result: 'Clear' });

    expect(prisma.orderService.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { status: OrderServiceStatus.COMPLETED, result: 'Clear', completedAt: expect.any(Date) },
    });
  });

  it('cancel rejects an order that is already completed or cancelled', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue({
      id: 'o1',
      status: OrderServiceStatus.COMPLETED,
    });
    await expect(service.cancel('o1', {})).rejects.toThrow(BadRequestException);
  });
});
