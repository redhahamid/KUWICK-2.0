import { NotFoundException } from '@nestjs/common';
import { VisitAttachmentService } from './visit-attachment.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';
import * as fileStorage from '../core/file-storage';

jest.mock('../core/file-storage');

function createService() {
  const prisma = {
    visitAttachment: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  return { service: new VisitAttachmentService(prisma), prisma };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('VisitAttachmentService', () => {
  it('create saves the file to disk and records the uploader', async () => {
    const { service, prisma } = createService();
    (fileStorage.saveUploadedFile as jest.Mock).mockResolvedValue({ relativePath: 'tenant-a/visit-1/uuid-scan.png' });
    (prisma.visitAttachment.create as jest.Mock).mockResolvedValue({ id: 'att-1' });
    const file = {
      originalname: 'scan.png',
      mimetype: 'image/png',
      size: 1234,
      buffer: Buffer.from('x'),
    } as Express.Multer.File;

    await withTenant(() => service.create('visit-1', file, 'staff-1'));

    expect(fileStorage.saveUploadedFile).toHaveBeenCalledWith('test-tenant', 'visit-1', file.buffer, 'scan.png');
    expect(prisma.visitAttachment.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        visitId: 'visit-1',
        fileName: 'scan.png',
        filePath: 'tenant-a/visit-1/uuid-scan.png',
        mimeType: 'image/png',
        fileSize: 1234,
        uploadedByStaffId: 'staff-1',
      },
    });
  });

  it('findOne throws NotFoundException when the attachment belongs to a different visit', async () => {
    const { service, prisma } = createService();
    (prisma.visitAttachment.findUnique as jest.Mock).mockResolvedValue({ id: 'att-1', visitId: 'other-visit' });
    await expect(service.findOne('visit-1', 'att-1')).rejects.toThrow(NotFoundException);
  });

  it('remove deletes the DB row and the file on disk', async () => {
    const { service, prisma } = createService();
    (prisma.visitAttachment.findUnique as jest.Mock).mockResolvedValue({
      id: 'att-1',
      visitId: 'visit-1',
      filePath: 'tenant-a/visit-1/uuid-scan.png',
    });

    await service.remove('visit-1', 'att-1');

    expect(prisma.visitAttachment.delete).toHaveBeenCalledWith({ where: { id: 'att-1' } });
    expect(fileStorage.deleteUploadedFile).toHaveBeenCalledWith('tenant-a/visit-1/uuid-scan.png');
  });
});
