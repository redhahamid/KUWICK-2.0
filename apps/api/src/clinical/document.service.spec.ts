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
    customDocumentTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
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

// G3b closure (D-064) — the two shapes authority now depends on.
const CLINICAL_DRAFT = {
  ...UNSIGNED_DOC,
  type: DocumentType.MC,
  requiresClinicalAuthorisation: true,
  authorisationKind: null,
};
const ADMIN_DRAFT = {
  ...UNSIGNED_DOC,
  type: DocumentType.CUSTOM,
  title: 'Time Slip',
  requiresClinicalAuthorisation: false,
  authorisationKind: null,
};

describe('DocumentService', () => {
  // SUPERSEDED BY D-085. This asserted that a document with no chosen issuer
  // was stamped with the VISIT'S attending doctor — so a draft typed by front
  // desk carried Dr A's name. `issuedByStaffId` is the CREATOR, and the
  // creator is whoever is logged in.
  it('create records the authenticated CREATOR, not the visit doctor', async () => {
    const { service, prisma, visits } = createService();
    // The visit belongs to a DIFFERENT doctor, so the assertion below
    // discriminates instead of passing by coincidence.
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'dr-attending' });
    (prisma.document.create as jest.Mock).mockResolvedValue({ id: 'doc-1' });
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'dr-1' });

    await withTenant(() => service.create({ visitId: 'visit-1', type: DocumentType.MC, content: '3 days rest' }));

    expect(prisma.document.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        visitId: 'visit-1',
        type: DocumentType.MC,
        content: '3 days rest',
        requiresClinicalAuthorisation: true,
        issuedByStaffId: 'staff-1',
        issuedDate: undefined,
        startDate: undefined,
        endDate: undefined,
        diagnosisText: undefined,
        referredTo: undefined,
        hours: undefined,
      },
    });
  });

  // b3 PHASE F — the two new types, and why they are classified differently.
  it('a TIME SLIP does not require clinical authorisation — attendance is not an opinion', async () => {
    // "Attended between two and half past four" is a fact the counter
    // witnessed. Requiring a doctor to sign it would either stop front desk
    // doing an existing part of their job, or teach a doctor to authorise
    // things they did not see.
    const { service, prisma, visits } = createService();
    (prisma.document.create as jest.Mock).mockResolvedValue({ id: 'doc-1' });
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'dr-1' });
    await withTenant(() =>
      service.create({ visitId: 'visit-1', type: DocumentType.TIME_SLIP, content: 'slip', hours: 2.5 }),
    );
    expect((prisma.document.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      type: DocumentType.TIME_SLIP,
      requiresClinicalAuthorisation: false,
      hours: 2.5,
    });
  });

  it('a CONSENT does not either — it records the PATIENT\'s agreement', async () => {
    const { service, prisma, visits } = createService();
    (prisma.document.create as jest.Mock).mockResolvedValue({ id: 'doc-1' });
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'dr-1' });
    await withTenant(() => service.create({ visitId: 'visit-1', type: DocumentType.CONSENT, content: 'consent' }));
    expect((prisma.document.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      type: DocumentType.CONSENT,
      requiresClinicalAuthorisation: false,
    });
  });

  it('an MC still does — nothing here widened the clinical types', async () => {
    const { service, prisma, visits } = createService();
    (prisma.document.create as jest.Mock).mockResolvedValue({ id: 'doc-1' });
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'dr-1' });
    await withTenant(() => service.create({ visitId: 'visit-1', type: DocumentType.MC, content: 'mc' }));
    expect((prisma.document.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      requiresClinicalAuthorisation: true,
    });
  });

  it('hours are stored only where they were sent — an MC carries none', async () => {
    const { service, prisma, visits } = createService();
    (prisma.document.create as jest.Mock).mockResolvedValue({ id: 'doc-1' });
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'dr-1' });
    await withTenant(() => service.create({ visitId: 'visit-1', type: DocumentType.MC, content: 'mc' }));
    expect((prisma.document.create as jest.Mock).mock.calls[0][0].data.hours).toBeUndefined();
  });

  // SUPERSEDED BY D-085. `issuedByStaffId` used to be accepted from the
  // browser, which let a caller name anyone at all as the document's issuer.
  // Locum coverage is served by the locum being logged in, not by the request
  // asserting whose name to print.
  it('create IGNORES a browser-supplied issuedByStaffId', async () => {
    const { service, prisma, visits } = createService();
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'staff-1' });
    (prisma.document.create as jest.Mock).mockResolvedValue({ id: 'doc-1' });
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'dr-1' });

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
        // 'locum-staff-2' was sent and is discarded; the session wins.
        issuedByStaffId: 'staff-1',
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

  // =========================================================================
  // G3b closure (D-064) — authorisation semantics and permissions.
  // =========================================================================

  it('authorise throws NotFoundException for an unknown document', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue(null);

    await expect(withTenant(() => service.authorise('missing', {}))).rejects.toThrow(NotFoundException);
  });

  it('a doctor can clinically authorise a medical certificate', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue(CLINICAL_DRAFT);

    await withTenant(() => service.authorise('doc-1', {}));

    const data = tx.document.update.mock.calls[0][0].data;
    expect(data.authorisationKind).toBe('CLINICAL');
    expect(data.signedByStaffId).toBe('staff-1');
    expect(data.authorisedByNameSnapshot).toBe('Dr. Amira Rahman');
  });

  it('a doctor can clinically authorise a referral', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue({ ...CLINICAL_DRAFT, type: DocumentType.REFERRAL });

    await withTenant(() => service.authorise('doc-1', {}));

    expect(tx.document.update.mock.calls[0][0].data.authorisationKind).toBe('CLINICAL');
  });

  // THE defect this closure exists to fix: front desk could put what reads as
  // a doctor's signature on a medical certificate.
  it('front-desk staff may NOT clinically authorise a medical certificate', async () => {
    const { service, tx } = createService(FRONT_DESK);
    tx.document.findUnique.mockResolvedValue(CLINICAL_DRAFT);

    await expect(withTenant(() => service.authorise('doc-1', {}))).rejects.toThrow(ForbiddenException);
    expect(tx.document.update).not.toHaveBeenCalled();
  });

  it('front-desk staff may NOT clinically authorise a referral', async () => {
    const { service, tx } = createService(FRONT_DESK);
    tx.document.findUnique.mockResolvedValue({ ...CLINICAL_DRAFT, type: DocumentType.REFERRAL });

    await expect(withTenant(() => service.authorise('doc-1', {}))).rejects.toThrow(ForbiddenException);
  });

  it('a non-clinical owner-admin may NOT clinically authorise', async () => {
    const { service, tx } = createService(NON_CLINICAL_OWNER);
    tx.document.findUnique.mockResolvedValue(CLINICAL_DRAFT);

    await expect(withTenant(() => service.authorise('doc-1', {}))).rejects.toThrow(ForbiddenException);
  });

  // An owner who IS a doctor qualifies through their professional identity,
  // not their job title.
  it('an owner-admin with an active MEDICAL_DOCTOR identity may authorise', async () => {
    const { service, tx } = createService({
      ...NON_CLINICAL_OWNER,
      professionalType: 'MEDICAL_DOCTOR',
      professionalActive: true,
    });
    tx.document.findUnique.mockResolvedValue(CLINICAL_DRAFT);

    await withTenant(() => service.authorise('doc-1', {}));

    expect(tx.document.update.mock.calls[0][0].data.authorisationKind).toBe('CLINICAL');
  });

  // Administrative documents keep the existing staff permission — the closure
  // says preserve it, not widen or narrow it.
  it('front-desk staff MAY issue an administrative document', async () => {
    const { service, tx } = createService(FRONT_DESK);
    tx.document.findUnique.mockResolvedValue(ADMIN_DRAFT);

    await withTenant(() => service.authorise('doc-1', {}));

    const data = tx.document.update.mock.calls[0][0].data;
    expect(data.authorisationKind).toBe('ADMINISTRATIVE');
    expect(data.authorisedByNameSnapshot).toBe('Dr. Amira Rahman');
  });

  it('an administrative issuance never claims clinical authorisation', async () => {
    const { service, tx } = createService(FRONT_DESK);
    tx.document.findUnique.mockResolvedValue(ADMIN_DRAFT);

    await withTenant(() => service.authorise('doc-1', {}));

    expect(tx.document.update.mock.calls[0][0].data.authorisationKind).not.toBe('CLINICAL');
  });

  it('a finance account may not authorise anything', async () => {
    const { service, tx } = createService({ ...DOCTOR, role: 'FINANCE_STAFF' });
    tx.document.findUnique.mockResolvedValue(ADMIN_DRAFT);

    await expect(withTenant(() => service.authorise('doc-1', {}))).rejects.toThrow(ForbiddenException);
  });

  // Authority is read from the ROW, so editing a template afterwards cannot
  // change who was allowed to authorise an already-issued document.
  it('authority follows the requirement frozen on the document', async () => {
    const { service, tx } = createService(FRONT_DESK);
    tx.document.findUnique.mockResolvedValue({
      ...ADMIN_DRAFT,
      type: DocumentType.CUSTOM,
      requiresClinicalAuthorisation: true,
    });

    await expect(withTenant(() => service.authorise('doc-1', {}))).rejects.toThrow(ForbiddenException);
  });

  it('authorise takes the actor from the session, never the request', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue(CLINICAL_DRAFT);

    await withTenant(() => service.authorise('doc-1', { staffId: 'someone-else' } as never));

    expect(tx.document.update.mock.calls[0][0].data.signedByStaffId).toBe('staff-1');
  });

  it('authorise never touches the document content or issuer', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue(CLINICAL_DRAFT);

    await withTenant(() => service.authorise('doc-1', {}));

    const data = tx.document.update.mock.calls[0][0].data;
    expect(data.content).toBeUndefined();
    expect(data.issuedByStaffId).toBeUndefined();
  });

  it('re-authorising an already authorised document is a conflict', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue({ ...CLINICAL_DRAFT, signedAt: new Date('2026-08-01') });

    await expect(withTenant(() => service.authorise('doc-1', {}))).rejects.toThrow(ConflictException);
    expect(tx.document.update).not.toHaveBeenCalled();
  });

  it('a voided document cannot be authorised', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue({ ...CLINICAL_DRAFT, recordStatus: 'VOIDED' });

    await expect(withTenant(() => service.authorise('doc-1', {}))).rejects.toThrow(ConflictException);
  });

  it('authorise rejects a stale expectedVersion', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue(CLINICAL_DRAFT);

    await expect(withTenant(() => service.authorise('doc-1', { expectedVersion: 99 }))).rejects.toThrow(
      ConflictException,
    );
  });

  it('a legacy sign-off is never converted into a clinical authorisation', async () => {
    const { service, tx } = createService();
    tx.document.findUnique.mockResolvedValue({
      ...CLINICAL_DRAFT,
      signedAt: new Date('2026-07-01'),
      authorisationKind: 'LEGACY_SIGN_OFF',
    });

    await expect(withTenant(() => service.authorise('doc-1', {}))).rejects.toThrow(ConflictException);
    expect(tx.document.update).not.toHaveBeenCalled();
  });

  // --- classification at creation -----------------------------------------

  it.each([DocumentType.MC, DocumentType.REFERRAL, DocumentType.MEMO, DocumentType.QUARANTINE])(
    '%s requires clinical authorisation',
    async (type) => {
      const { service, prisma, visits } = createService();
      (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'staff-1' });
      (prisma.document.create as jest.Mock).mockResolvedValue({ id: 'doc-1' });
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'dr-1' });

      await withTenant(() => service.create({ visitId: 'visit-1', type, content: 'x' }));

      expect(prisma.document.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ requiresClinicalAuthorisation: true }) }),
      );
    },
  );

  it('a CUSTOM document follows its template setting', async () => {
    const { service, prisma, visits } = createService();
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'staff-1' });
    (prisma.customDocumentTemplate.findFirst as jest.Mock).mockResolvedValue({
      requiresClinicalAuthorisation: false,
    });
    (prisma.document.create as jest.Mock).mockResolvedValue({ id: 'doc-1' });
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'dr-1' });

    await withTenant(() =>
      service.create({ visitId: 'visit-1', type: DocumentType.CUSTOM, title: 'Time Slip', content: 'x' }),
    );

    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requiresClinicalAuthorisation: false }) }),
    );
  });

  // Fail closed: an unclassifiable document is the one you least want front
  // desk authorising.
  it('a CUSTOM document with no findable template is treated as clinical', async () => {
    const { service, prisma, visits } = createService();
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'staff-1' });
    (prisma.customDocumentTemplate.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.document.create as jest.Mock).mockResolvedValue({ id: 'doc-1' });
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'dr-1' });

    await withTenant(() =>
      service.create({ visitId: 'visit-1', type: DocumentType.CUSTOM, title: 'Unknown', content: 'x' }),
    );

    expect(prisma.document.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requiresClinicalAuthorisation: true }) }),
    );
  });


  it('the active list resolves the staff behind each document', async () => {
    const { service, prisma } = createService();
    (prisma.document.findMany as jest.Mock).mockResolvedValue([]);

    await service.findByVisitId('visit-1');

    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ include: { issuedBy: true, signedBy: true, voidedBy: true } }),
    );
  });
});
