import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VisitAttachmentService } from './visit-attachment.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';
import * as fileStorage from '../core/file-storage';

jest.mock('../core/file-storage');

const DOCTOR: Record<string, unknown> = {
  id: 'staff-1',
  fullName: 'Dr. Amira Rahman',
  role: 'DOCTOR_RESIDENT',
  active: true,
  clinicId: 'clinic-1',
  userId: 'user-1',
  professionalType: null,
  professionalActive: false,
};

const FRONT_DESK = { ...DOCTOR, role: 'FRONT_DESK_CLINICAL_STAFF' };

function createService(actor: Record<string, unknown> = DOCTOR) {
  const prisma = {
    visitAttachment: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
  } as unknown as TenantScopedPrismaClient;

  const tx = {
    $executeRaw: jest.fn(),
    staff: { findUnique: jest.fn().mockResolvedValue(actor) },
    clinic: { count: jest.fn().mockResolvedValue(1) },
    userClinicAccess: { findMany: jest.fn().mockResolvedValue([]) },
    visit: { findUnique: jest.fn().mockResolvedValue({ clinicId: 'clinic-1' }) },
    visitAttachment: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'att-1' }),
      delete: jest.fn(),
    },
  };
  const rawPrisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;

  return { service: new VisitAttachmentService(prisma, rawPrisma), prisma, tx };
}

const SAVED_ATTACHMENT = {
  id: 'att-1',
  visitId: 'visit-1',
  fileName: 'otoscope-right.png',
  filePath: 'tenant-a/visit-1/uuid-scan.png',
  mimeType: 'image/png',
  uploadedByStaffId: 'staff-9',
  recordStatus: 'ACTIVE',
  version: 1,
};

function withTenant<T>(fn: () => Promise<T>, staffId = 'staff-1'): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant', staffId }, fn);
}

const testFile = {
  originalname: 'scan.png',
  mimetype: 'image/png',
  size: 1234,
  buffer: Buffer.from('x'),
} as Express.Multer.File;

describe('VisitAttachmentService', () => {
  it('create saves the file to disk and takes the uploader from the session', async () => {
    const { service, prisma } = createService();
    (fileStorage.saveUploadedFile as jest.Mock).mockResolvedValue({ relativePath: 'tenant-a/visit-1/uuid-scan.png' });
    (prisma.visitAttachment.create as jest.Mock).mockResolvedValue({ id: 'att-1' });

    await withTenant(() => service.create('visit-1', testFile));

    expect(fileStorage.saveUploadedFile).toHaveBeenCalledWith('test-tenant', 'visit-1', testFile.buffer, 'scan.png');
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

  // C0 (D-051) — the browser used to post uploadedByStaffId in the body. The
  // service no longer accepts one at all, so a spoofed value cannot land on
  // the record: attribution comes only from the authenticated session.
  it('ignores any uploader identity the caller tries to supply', async () => {
    const { service, prisma } = createService();
    (fileStorage.saveUploadedFile as jest.Mock).mockResolvedValue({ relativePath: 'p' });
    (prisma.visitAttachment.create as jest.Mock).mockResolvedValue({ id: 'att-2' });

    await withTenant(
      () => (service.create as (v: string, f: Express.Multer.File, spoof?: string) => Promise<unknown>)(
        'visit-1',
        testFile,
        'staff-someone-else',
      ),
      'staff-real',
    );

    expect(prisma.visitAttachment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ uploadedByStaffId: 'staff-real' }) }),
    );
  });

  it('findOne throws NotFoundException when the attachment belongs to a different visit', async () => {
    const { service, prisma } = createService();
    (prisma.visitAttachment.findUnique as jest.Mock).mockResolvedValue({ id: 'att-1', visitId: 'other-visit' });
    await expect(service.findOne('visit-1', 'att-1')).rejects.toThrow(NotFoundException);
  });

  it('removal marks the row REMOVED_IN_ERROR instead of deleting it', async () => {
    const { service, tx } = createService();
    tx.visitAttachment.findUnique.mockResolvedValue(SAVED_ATTACHMENT);

    await withTenant(() => service.removeFromVisit('visit-1', 'att-1', { reason: 'Uploaded to the wrong visit' }));

    expect(tx.visitAttachment.update).toHaveBeenCalled();
  });

  // G3a (D-062) — the file must survive an audited removal.
  it('does NOT delete the underlying clinical file', async () => {
    const { service, tx } = createService();
    tx.visitAttachment.findUnique.mockResolvedValue(SAVED_ATTACHMENT);

    await withTenant(() => service.removeFromVisit('visit-1', 'att-1', { reason: 'Wrong visit' }));

    expect(fileStorage.deleteUploadedFile).not.toHaveBeenCalled();
    expect(tx.visitAttachment.delete).not.toHaveBeenCalled();
  });

  it('preserves filename, MIME type and uploader on removal', async () => {
    const { service, tx } = createService();
    tx.visitAttachment.findUnique.mockResolvedValue(SAVED_ATTACHMENT);

    await withTenant(() => service.removeFromVisit('visit-1', 'att-1', { reason: 'Wrong visit' }));

    const data = tx.visitAttachment.update.mock.calls[0][0].data;
    expect(data.fileName).toBeUndefined();
    expect(data.filePath).toBeUndefined();
    expect(data.mimeType).toBeUndefined();
    expect(data.uploadedByStaffId).toBeUndefined();
    expect(data.recordStatus).toBe('REMOVED_IN_ERROR');
  });

  it('requires a removal reason', async () => {
    const { service, tx } = createService();
    tx.visitAttachment.findUnique.mockResolvedValue(SAVED_ATTACHMENT);

    await expect(
      withTenant(() => service.removeFromVisit('visit-1', 'att-1', { reason: ' ' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('records the remover from the session, not the request', async () => {
    const { service, tx } = createService();
    tx.visitAttachment.findUnique.mockResolvedValue(SAVED_ATTACHMENT);

    await withTenant(() =>
      service.removeFromVisit('visit-1', 'att-1', {
        reason: 'Wrong visit',
        removedByStaffId: 'attacker',
      } as never),
    );

    const data = tx.visitAttachment.update.mock.calls[0][0].data;
    expect(data.removedByStaffId).toBe('staff-1');
    expect(data.removedByNameSnapshot).toBe('Dr. Amira Rahman');
  });

  it('re-removing an already removed attachment is a conflict', async () => {
    const { service, tx } = createService();
    tx.visitAttachment.findUnique.mockResolvedValue({ ...SAVED_ATTACHMENT, recordStatus: 'REMOVED_IN_ERROR' });

    await expect(
      withTenant(() => service.removeFromVisit('visit-1', 'att-1', { reason: 'again' })),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects a stale expectedVersion', async () => {
    const { service, tx } = createService();
    tx.visitAttachment.findUnique.mockResolvedValue(SAVED_ATTACHMENT);

    await expect(
      withTenant(() => service.removeFromVisit('visit-1', 'att-1', { reason: 'stale', expectedVersion: 99 })),
    ).rejects.toThrow(ConflictException);
  });

  it('front-desk staff may not remove a clinical attachment', async () => {
    const { service, tx } = createService(FRONT_DESK);
    tx.visitAttachment.findUnique.mockResolvedValue(SAVED_ATTACHMENT);

    await expect(
      withTenant(() => service.removeFromVisit('visit-1', 'att-1', { reason: 'nope' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('the active gallery excludes removed attachments by default', async () => {
    const { service, prisma } = createService();
    (prisma.visitAttachment.findMany as jest.Mock).mockResolvedValue([]);

    await service.listByVisitId('visit-1');

    expect(prisma.visitAttachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { visitId: 'visit-1', recordStatus: 'ACTIVE' } }),
    );
  });

  it('history includes removed attachments', async () => {
    const { service, prisma } = createService();
    (prisma.visitAttachment.findMany as jest.Mock).mockResolvedValue([]);

    await service.listByVisitId('visit-1', true);

    expect(prisma.visitAttachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { visitId: 'visit-1' } }),
    );
  });
});
