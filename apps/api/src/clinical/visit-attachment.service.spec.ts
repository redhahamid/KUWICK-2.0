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

// G4.5d3c-3c1 — the buffer is a REAL PNG signature now. It used to be the
// single byte 'x', which the upload path accepted because nothing looked at
// the bytes; the allow-list looks, so a fixture that is not the type it
// claims is refused exactly as a hostile upload would be.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

const testFile = {
  originalname: 'scan.png',
  mimetype: 'image/png',
  size: 1234,
  buffer: PNG_SIGNATURE,
} as Express.Multer.File;

describe('VisitAttachmentService', () => {
  it('create saves the file to disk and takes the uploader from the session', async () => {
    const { service, prisma } = createService();
    (fileStorage.saveUploadedFile as jest.Mock).mockResolvedValue({ relativePath: 'tenant-a/visit-1/uuid-scan.png' });
    (prisma.visitAttachment.create as jest.Mock).mockResolvedValue({ id: 'att-1' });

    await withTenant(() => service.create('visit-1', testFile));

    expect(fileStorage.saveUploadedFile).toHaveBeenCalledWith('test-tenant', 'visit-1', PNG_SIGNATURE, 'scan.png');
    expect(prisma.visitAttachment.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        visitId: 'visit-1',
        fileName: 'scan.png',
        filePath: 'tenant-a/visit-1/uuid-scan.png',
        mimeType: 'image/png',
        fileSize: 1234,
        uploadedByStaffId: 'staff-1',
        category: 'PHOTO',
      },
    });
  });

  // b0 — the tag a fresh upload carries is a SUGGESTION from the file type,
  // and the record says so: nobody is credited with filing it until somebody
  // actually does. An upload that arrived pre-attributed would make "no
  // human has classified this yet" unanswerable from the row.
  it('an uploaded image is suggested as PHOTO, attributed to nobody', async () => {
    const { service, prisma } = createService();
    (fileStorage.saveUploadedFile as jest.Mock).mockResolvedValue({ relativePath: 'p' });
    (prisma.visitAttachment.create as jest.Mock).mockResolvedValue({ id: 'att-1' });

    await withTenant(() => service.create('visit-1', testFile));

    const { data } = (prisma.visitAttachment.create as jest.Mock).mock.calls[0][0];
    expect(data.category).toBe('PHOTO');
    expect(data.categorySetByStaffId).toBeUndefined();
    expect(data.categorySetAt).toBeUndefined();
  });

  it('an uploaded PDF is suggested as LAB', async () => {
    const { service, prisma } = createService();
    (fileStorage.saveUploadedFile as jest.Mock).mockResolvedValue({ relativePath: 'p' });
    (prisma.visitAttachment.create as jest.Mock).mockResolvedValue({ id: 'att-1' });

    await withTenant(() =>
      service.create('visit-1', {
        originalname: 'fbc.pdf',
        mimetype: 'application/pdf',
        size: 90,
        buffer: Buffer.from('%PDF-1.4\n'),
      } as Express.Multer.File),
    );

    expect((prisma.visitAttachment.create as jest.Mock).mock.calls[0][0].data.category).toBe('LAB');
  });

  it('setCategory records the kind, who filed it and when, and bumps the version', async () => {
    const { service, tx } = createService();
    tx.visitAttachment.findUnique.mockResolvedValue(SAVED_ATTACHMENT);

    await withTenant(() => service.setCategory('visit-1', 'att-1', 'LETTER'));

    const { data } = tx.visitAttachment.update.mock.calls[0][0];
    expect(data.category).toBe('LETTER');
    expect(data.categorySetByStaffId).toBe('staff-1');
    expect(data.categorySetAt).toBeInstanceOf(Date);
    expect(data.version).toEqual({ increment: 1 });
  });

  // The reference canvas files `referral-hosp.jpg` as a LETTER. An image that
  // could not be re-filed would make that screen unreachable, so this is the
  // rule the tag exists for — not a hypothetical.
  it('an image may be filed as a LETTER', async () => {
    const { service, tx } = createService();
    tx.visitAttachment.findUnique.mockResolvedValue({ ...SAVED_ATTACHMENT, mimeType: 'image/jpeg' });

    await withTenant(() => service.setCategory('visit-1', 'att-1', 'LETTER'));

    expect(tx.visitAttachment.update.mock.calls[0][0].data.category).toBe('LETTER');
  });

  it('setCategory leaves the filename, MIME type and uploader alone', async () => {
    const { service, tx } = createService();
    tx.visitAttachment.findUnique.mockResolvedValue(SAVED_ATTACHMENT);

    await withTenant(() => service.setCategory('visit-1', 'att-1', 'LAB'));

    const { data } = tx.visitAttachment.update.mock.calls[0][0];
    for (const field of ['fileName', 'mimeType', 'filePath', 'fileSize', 'uploadedByStaffId', 'recordStatus']) {
      expect(data).not.toHaveProperty(field);
    }
  });

  it('setCategory refuses a stale expectedVersion', async () => {
    const { service, tx } = createService();
    tx.visitAttachment.findUnique.mockResolvedValue(SAVED_ATTACHMENT);

    await expect(withTenant(() => service.setCategory('visit-1', 'att-1', 'LAB', 99))).rejects.toThrow(
      ConflictException,
    );
    expect(tx.visitAttachment.update).not.toHaveBeenCalled();
  });

  it('setCategory refuses a removed attachment', async () => {
    const { service, tx } = createService();
    tx.visitAttachment.findUnique.mockResolvedValue({ ...SAVED_ATTACHMENT, recordStatus: 'REMOVED_IN_ERROR' });

    await expect(withTenant(() => service.setCategory('visit-1', 'att-1', 'LAB'))).rejects.toThrow(ConflictException);
    expect(tx.visitAttachment.update).not.toHaveBeenCalled();
  });

  it('setCategory refuses an attachment belonging to a different visit', async () => {
    const { service, tx } = createService();
    tx.visitAttachment.findUnique.mockResolvedValue({ ...SAVED_ATTACHMENT, visitId: 'other-visit' });

    await expect(withTenant(() => service.setCategory('visit-1', 'att-1', 'LAB'))).rejects.toThrow(NotFoundException);
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
