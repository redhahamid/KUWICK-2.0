import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderServiceStatus, ServiceOrderType } from '@prisma/client';
import { OrderServiceService } from './order-service.service';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';
import * as fileStorage from '../core/file-storage';

jest.mock('../core/file-storage');

function createService() {
  const prisma = {
    orderService: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    serviceCatalog: { findUnique: jest.fn() },
    attachment: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
    formTemplate: { findUnique: jest.fn() },
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
      data: {
        status: OrderServiceStatus.COMPLETED,
        result: 'Clear',
        formTemplateId: undefined,
        formData: undefined,
        completedAt: expect.any(Date),
      },
    });
  });

  it('complete derives a plain-text result summary from formData when no free-text result is given', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue({
      id: 'o1',
      status: OrderServiceStatus.IN_PROGRESS,
    });
    (prisma.formTemplate.findUnique as jest.Mock).mockResolvedValue({
      id: 'ft-1',
      fields: [
        { id: 'f1', label: 'Hemoglobin', unit: 'g/dL' },
        { id: 'f2', label: 'WBC', unit: 'x10^9/L' },
      ],
    });
    (prisma.orderService.update as jest.Mock).mockResolvedValue({ id: 'o1', status: OrderServiceStatus.COMPLETED });

    await service.complete('o1', { formTemplateId: 'ft-1', formData: { f1: 13.5, f2: 7.2 } });

    expect(prisma.orderService.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: {
        status: OrderServiceStatus.COMPLETED,
        result: 'Hemoglobin: 13.5 g/dL\nWBC: 7.2 x10^9/L',
        formTemplateId: 'ft-1',
        formData: { f1: 13.5, f2: 7.2 },
        completedAt: expect.any(Date),
      },
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

  it('addAttachment saves the file to disk and defaults uploadedByStaffId to the order requester', async () => {
    const { service, prisma } = createService();
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue({
      id: 'o1',
      requestedByStaffId: 'staff-1',
    });
    (fileStorage.saveUploadedFile as jest.Mock).mockResolvedValue({ relativePath: 'tenant-a/o1/uuid-scan.png' });
    (prisma.attachment.create as jest.Mock).mockResolvedValue({ id: 'att-1' });
    const file = { originalname: 'scan.png', mimetype: 'image/png', size: 1234, buffer: Buffer.from('x') } as Express.Multer.File;

    await withTenant(() => service.addAttachment('o1', file));

    expect(fileStorage.saveUploadedFile).toHaveBeenCalledWith('test-tenant', 'o1', file.buffer, 'scan.png');
    expect(prisma.attachment.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        orderServiceId: 'o1',
        fileName: 'scan.png',
        filePath: 'tenant-a/o1/uuid-scan.png',
        mimeType: 'image/png',
        fileSize: 1234,
        uploadedByStaffId: 'staff-1',
      },
    });
  });

  it('findAttachment throws NotFoundException when the attachment belongs to a different order', async () => {
    const { service, prisma } = createService();
    (prisma.attachment.findUnique as jest.Mock).mockResolvedValue({ id: 'att-1', orderServiceId: 'other-order' });
    await expect(service.findAttachment('o1', 'att-1')).rejects.toThrow(NotFoundException);
  });

  it('deleteAttachment removes the DB row and the file on disk', async () => {
    const { service, prisma } = createService();
    (prisma.attachment.findUnique as jest.Mock).mockResolvedValue({
      id: 'att-1',
      orderServiceId: 'o1',
      filePath: 'tenant-a/o1/uuid-scan.png',
    });

    await service.deleteAttachment('o1', 'att-1');

    expect(prisma.attachment.delete).toHaveBeenCalledWith({ where: { id: 'att-1' } });
    expect(fileStorage.deleteUploadedFile).toHaveBeenCalledWith('tenant-a/o1/uuid-scan.png');
  });
});
