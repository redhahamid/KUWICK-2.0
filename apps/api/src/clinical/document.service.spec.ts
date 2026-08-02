import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentType } from '@prisma/client';
import { DocumentService } from './document.service';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

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
const NON_CLINICAL_OWNER = { ...DOCTOR, role: 'OWNER_ADMIN' };

function createService(actor: Record<string, unknown> = DOCTOR) {
  const prisma = {
    document: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), delete: jest.fn(), update: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  const visits = { findById: jest.fn() } as unknown as VisitService;

  // G3a — the audited void runs through an interactive transaction.
  const tx = {
    $executeRaw: jest.fn(),
    staff: { findUnique: jest.fn().mockResolvedValue(actor) },
    clinic: { count: jest.fn().mockResolvedValue(1) },
    userClinicAccess: { findMany: jest.fn().mockResolvedValue([]) },
    visit: { findUnique: jest.fn().mockResolvedValue({ clinicId: 'clinic-1' }) },
    document: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({ id: 'doc-1' }), delete: jest.fn() },
  };
  const rawPrisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;

  return { service: new DocumentService(prisma, rawPrisma, visits), prisma, visits, tx };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant', staffId: 'staff-1' }, fn);
}

const SAVED_DOC = {
  id: 'doc-1',
  visitId: 'visit-1',
  content: 'Medical certificate for two days.',
  signedAt: new Date('2026-08-01'),
  signedByStaffId: 'staff-9',
  issuedByStaffId: 'staff-9',
  recordStatus: 'ACTIVE',
  version: 2,
};

const UNSIGNED_DOC = { ...SAVED_DOC, signedAt: null, signedByStaffId: null, version: 1 };

describe('DocumentService', () => {
  it('create defaults issuedByStaffId to the visit doctor when not given', async () => {
    const { service, prisma, visits } = createService();
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'staff-1' });
    (prisma.document.create as jest.Mock).mockResolvedValue({ id: 'doc-1' });

    await withTenant(() => service.create({ visitId: 'visit-1', type: DocumentType.MC, content: '3 days rest' }));

    expect(prisma.document.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        visitId: 'visit-1',
        type: DocumentType.MC,
        content: '3 days rest',
        issuedByStaffId: 'staff-1',
        issuedDate: undefined,
        startDate: undefined,
        endDate: undefined,
        diagnosisText: undefined,
        referredTo: undefined,
      },
    });
  });

  it('create uses an explicitly chosen issuedByStaffId (locum coverage) over the visit doctor', async () => {
    const { service, prisma, visits } = createService();
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'staff-1' });
    (prisma.document.create as jest.Mock).mockResolvedValue({ id: 'doc-1' });

    await withTenant(() =>
      service.create({
        visitId: 'visit-1',
        type: DocumentType.MC,
        content: 'template text',
        issuedByStaffId: 'locum-staff-2',
        issuedDate: '2026-07-31',
        startDate: '2026-07-31',
        endDate: '2026-08-01',
        diagnosisText: 'Upper respiratory tract infection',
      }),
    );

    expect(prisma.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        issuedByStaffId: 'locum-staff-2',
        issuedDate: new Date('2026-07-31'),
        startDate: new Date('2026-07-31'),
        endDate: new Date('2026-08-01'),
        diagnosisText: 'Upper respiratory tract infection',
      }),
    });
  });

  it('findByVisitId orders by createdAt descending', async () => {
    const { service, prisma } = createService();
    (prisma.document.findMany as jest.Mock).mockResolvedValue([]);

    await service.findByVisitId('visit-1');

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  // G3a (D-062) — audited voiding replaces the hard delete.
  it('no longer exposes a hard-delete method', () => {
    const { service } = createService();
    expect((service as unknown as Record<string, unknown>).remove).toBeUndefined();
  });

  it('void never calls prisma delete', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue(SAVED_DOC);

    await withTenant(() => service.voidDocument('doc-1', { reason: 'Issued in error' }));

    expect(tx.document.delete).not.toHaveBeenCalled();
  });

  it('void requires a reason', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue(SAVED_DOC);

    await expect(withTenant(() => service.voidDocument('doc-1', { reason: '  ' }))).rejects.toThrow(
      BadRequestException,
    );
    expect(tx.document.update).not.toHaveBeenCalled();
  });

  it('void records the actor from the session, not the request', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue(SAVED_DOC);

    await withTenant(() =>
      service.voidDocument('doc-1', { reason: 'Wrong patient', voidedByStaffId: 'attacker' } as never),
    );

    const data = tx.document.update.mock.calls[0][0].data;
    expect(data.voidedByStaffId).toBe('staff-1');
    expect(data.voidedByNameSnapshot).toBe('Dr. Amira Rahman');
    expect(data.voidReason).toBe('Wrong patient');
  });

  it('void preserves content, issuer and signature', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue(SAVED_DOC);

    await withTenant(() => service.voidDocument('doc-1', { reason: 'Issued in error' }));

    const data = tx.document.update.mock.calls[0][0].data;
    expect(data.content).toBeUndefined();
    expect(data.signedAt).toBeUndefined();
    expect(data.signedByStaffId).toBeUndefined();
    expect(data.issuedByStaffId).toBeUndefined();
    expect(data.recordStatus).toBe('VOIDED');
  });

  it('void rejects a stale expectedVersion', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue(SAVED_DOC);

    await expect(
      withTenant(() => service.voidDocument('doc-1', { reason: 'stale check', expectedVersion: 1 })),
    ).rejects.toThrow(ConflictException);
  });

  it('re-voiding an already voided document is a conflict', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue({ ...SAVED_DOC, recordStatus: 'VOIDED' });

    await expect(withTenant(() => service.voidDocument('doc-1', { reason: 'again' }))).rejects.toThrow(
      ConflictException,
    );
  });

  it('void throws NotFoundException for an unknown document', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue(null);

    await expect(withTenant(() => service.voidDocument('missing', { reason: 'gone' }))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('front-desk staff may not void a clinical document', async () => {
    const { service, tx } = createService(FRONT_DESK);
    tx.document.findUnique.mockResolvedValue(SAVED_DOC);

    await expect(withTenant(() => service.voidDocument('doc-1', { reason: 'nope' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('a non-clinical owner-admin may not void a clinical document', async () => {
    const { service, tx } = createService(NON_CLINICAL_OWNER);
    tx.document.findUnique.mockResolvedValue(SAVED_DOC);

    await expect(withTenant(() => service.voidDocument('doc-1', { reason: 'admin' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('the active list excludes voided documents by default', async () => {
    const { service, prisma } = createService();
    (prisma.document.findMany as jest.Mock).mockResolvedValue([]);

    await service.findByVisitId('visit-1');

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { visitId: 'visit-1', recordStatus: 'ACTIVE' } }),
    );
  });

  it('history includes voided documents', async () => {
    const { service, prisma } = createService();
    (prisma.document.findMany as jest.Mock).mockResolvedValue([]);

    await service.findByVisitId('visit-1', true);

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { visitId: 'visit-1' } }),
    );
  });

  it('sign throws NotFoundException for an unknown document', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue(null);

    await expect(withTenant(() => service.sign('missing', {}))).rejects.toThrow(NotFoundException);
  });

  // G3b — the signer used to come from the request body, and the browser sent
  // the VISIT's doctor whoever actually clicked. A document could therefore be
  // attributed to a doctor who never saw it.
  it('sign takes the signer from the session, never the request', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue(UNSIGNED_DOC);

    await withTenant(() => service.sign('doc-1', { staffId: 'someone-else' } as never));

    const data = tx.document.update.mock.calls[0][0].data;
    expect(data.signedByStaffId).toBe('staff-1');
    expect(data.signedAt).toEqual(expect.any(Date));
  });

  it('sign never touches the document content', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue(UNSIGNED_DOC);

    await withTenant(() => service.sign('doc-1', {}));

    const data = tx.document.update.mock.calls[0][0].data;
    expect(data.content).toBeUndefined();
    expect(data.issuedByStaffId).toBeUndefined();
  });

  // G3b — a signed document must not be silently re-attributed. This used to
  // overwrite signedAt/signedByStaffId without complaint.
  it('re-signing an already signed document is a conflict', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue({ ...UNSIGNED_DOC, signedAt: new Date('2026-08-01') });

    await expect(withTenant(() => service.sign('doc-1', {}))).rejects.toThrow(ConflictException);
    expect(tx.document.update).not.toHaveBeenCalled();
  });

  it('a voided document cannot be signed', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue({ ...UNSIGNED_DOC, recordStatus: 'VOIDED' });

    await expect(withTenant(() => service.sign('doc-1', {}))).rejects.toThrow(ConflictException);
  });

  it('sign rejects a stale expectedVersion', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue(UNSIGNED_DOC);

    await expect(withTenant(() => service.sign('doc-1', { expectedVersion: 99 }))).rejects.toThrow(
      ConflictException,
    );
  });

  // Deliberately NOT narrowed to doctors: Document.signedAt is the dispensary
  // "prep, sign MC" workflow step, not the C0 medicolegal signature. Front
  // desk signing off a printed MC is the existing workflow, and G3b does not
  // silently take it away.
  it('front-desk staff may still sign off a document', async () => {
    const { service, tx } = createService(FRONT_DESK);
    tx.document.findUnique.mockResolvedValue(UNSIGNED_DOC);

    await withTenant(() => service.sign('doc-1', {}));

    expect(tx.document.update).toHaveBeenCalled();
  });

  it('a non-clinical account may not sign a document', async () => {
    const { service, tx } = createService({ ...DOCTOR, role: 'FINANCE_STAFF' });
    tx.document.findUnique.mockResolvedValue(UNSIGNED_DOC);

    await expect(withTenant(() => service.sign('doc-1', {}))).rejects.toThrow(ForbiddenException);
  });

  // G3b — the workspace names who created, signed and voided each document.
  it('the active list resolves the staff behind each document', async () => {
    const { service, prisma } = createService();
    (prisma.document.findMany as jest.Mock).mockResolvedValue([]);

    await service.findByVisitId('visit-1');

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { issuedBy: true, signedBy: true, voidedBy: true } }),
    );
  });
});
