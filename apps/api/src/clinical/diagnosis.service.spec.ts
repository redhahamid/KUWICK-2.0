import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DiagnosisCategory, DiagnosisPriority, Prisma } from '@prisma/client';
import { DiagnosisService, icd10SearchTerms } from './diagnosis.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

const ACTOR: Record<string, unknown> = {
  id: 'staff-1',
  fullName: 'Dr. Amira Rahman',
  role: 'DOCTOR_RESIDENT',
  active: true,
  clinicId: 'clinic-1',
  userId: 'user-1',
  professionalType: null,
  medicalRegistrationNo: null,
};

interface Options {
  actor?: Record<string, unknown> | null;
  visitClinicId?: string | null;
  tenantBranchCount?: number;
  authorisedClinicIds?: string[];
}

function createService(options: Options = {}) {
  const {
    actor = ACTOR,
    visitClinicId = 'clinic-1',
    tenantBranchCount = 1,
    authorisedClinicIds = [],
  } = options;

  // The transactional client. G2a runs writes through PrismaService inside an
  // interactive transaction so demote+promote is atomic.
  const tx = {
    $executeRaw: jest.fn(),
    staff: { findUnique: jest.fn().mockResolvedValue(actor) },
    clinic: { count: jest.fn().mockResolvedValue(tenantBranchCount) },
    userClinicAccess: {
      findMany: jest.fn().mockResolvedValue(authorisedClinicIds.map((clinicId) => ({ clinicId }))),
    },
    visit: {
      findUnique: jest.fn().mockResolvedValue(visitClinicId ? { clinicId: visitClinicId } : null),
    },
    diagnosisCatalog: { findUnique: jest.fn(), upsert: jest.fn() },
    diagnosis: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'diag-new' }),
      update: jest.fn().mockResolvedValue({ id: 'diag-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn(),
    },
  };

  const rawPrisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  const prisma = {
    diagnosisCatalog: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    diagnosis: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
  } as unknown as TenantScopedPrismaClient;

  return { service: new DiagnosisService(prisma, rawPrisma), prisma, tx };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant', staffId: 'staff-1' }, fn);
}

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: 'diagnoses_one_primary_per_visit' },
  });
}

describe('DiagnosisService', () => {
  describe('catalog behaviour (unchanged by G2a)', () => {
    it('searchCatalog filters by category when given', async () => {
      const { service, prisma } = createService();
      (prisma.diagnosisCatalog.findMany as jest.Mock).mockResolvedValue([]);

      await service.searchCatalog('cold', DiagnosisCategory.FULL);

      expect(prisma.diagnosisCatalog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true, category: DiagnosisCategory.FULL }),
        }),
      );
    });

    // G2b — a GP who knows the code should be able to type it.
    it('searchCatalog matches the ICD-10 code as well as the name', async () => {
      const { service, prisma } = createService();
      (prisma.diagnosisCatalog.findMany as jest.Mock).mockResolvedValue([]);

      await service.searchCatalog('J06.9');

      const where = (prisma.diagnosisCatalog.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.OR).toContainEqual({ name: { contains: 'J06.9', mode: 'insensitive' } });
      expect(where.OR).toContainEqual({ icd10Code: { contains: 'J06.9', mode: 'insensitive' } });
    });

    // G4.5d6 — the code is read off a panel form or a referral letter, and it
    // gets typed without the dot about as often as with it.
    it('searchCatalog finds a dotted code from an undotted one', async () => {
      const { service, prisma } = createService();
      (prisma.diagnosisCatalog.findMany as jest.Mock).mockResolvedValue([]);

      await service.searchCatalog('J069');

      const where = (prisma.diagnosisCatalog.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.OR).toContainEqual({ icd10Code: { contains: 'J06.9', mode: 'insensitive' } });
      expect(where.OR).toContainEqual({ icd10Code: { contains: 'J069', mode: 'insensitive' } });
    });

    it('searchCatalog invents no code for text that is not code-shaped', () => {
      // Only the SHAPE is inferred. A diagnosis name must never be turned
      // into a code that does not exist.
      expect(icd10SearchTerms('asthma')).toEqual(['asthma']);
      expect(icd10SearchTerms('J06')).toEqual(['J06']);
      expect(icd10SearchTerms('J06.9')).toEqual(['J06.9', 'J069']);
      expect(icd10SearchTerms('M545')).toEqual(['M545', 'M54.5']);
    });

    it('searchCatalog applies no text filter when no query is given', async () => {
      const { service, prisma } = createService();
      (prisma.diagnosisCatalog.findMany as jest.Mock).mockResolvedValue([]);

      await service.searchCatalog(undefined, DiagnosisCategory.CUSTOM);

      const where = (prisma.diagnosisCatalog.findMany as jest.Mock).mock.calls[0][0].where;
      expect(where.OR).toBeUndefined();
    });

    it('createCustom always creates a CUSTOM-category entry', async () => {
      const { service, prisma } = createService();
      (prisma.diagnosisCatalog.create as jest.Mock).mockResolvedValue({ id: 'cat-3' });

      await withTenant(() => service.createCustom({ name: 'My Custom Dx', icd10Code: 'X99' }));

      expect(prisma.diagnosisCatalog.create).toHaveBeenCalledWith({
        data: { tenantId: 'test-tenant', name: 'My Custom Dx', icd10Code: 'X99', category: DiagnosisCategory.CUSTOM },
      });
    });

    it('bulkActivateCategory updates every entry in the given category', async () => {
      const { service, prisma } = createService();

      await service.bulkActivateCategory(DiagnosisCategory.SUMMARIZE, { active: false });

      expect(prisma.diagnosisCatalog.updateMany).toHaveBeenCalledWith({
        where: { category: DiagnosisCategory.SUMMARIZE },
        data: { active: false },
      });
    });

    it('setCatalogActive throws NotFoundException for an unknown entry', async () => {
      const { service, prisma } = createService();
      (prisma.diagnosisCatalog.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.setCatalogActive('missing', true)).rejects.toThrow(NotFoundException);
    });
  });

  describe('adding to a visit', () => {
    it('snapshots icd10Code/name from an existing catalog entry', async () => {
      const { service, tx } = createService();
      tx.diagnosisCatalog.findUnique.mockResolvedValue({ id: 'cat-1', icd10Code: 'J00', name: 'Common cold' });

      await withTenant(() => service.addToVisit({ visitId: 'visit-1', diagnosisCatalogId: 'cat-1' }));

      expect(tx.diagnosis.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ icd10Code: 'J00', name: 'Common cold', diagnosisCatalogId: 'cat-1' }),
        }),
      );
    });

    it('throws NotFoundException for an unknown diagnosisCatalogId', async () => {
      const { service, tx } = createService();
      tx.diagnosisCatalog.findUnique.mockResolvedValue(null);

      await expect(
        withTenant(() => service.addToVisit({ visitId: 'visit-1', diagnosisCatalogId: 'missing' })),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a CUSTOM catalog entry inline when only a name is given', async () => {
      const { service, tx } = createService();
      tx.diagnosisCatalog.upsert.mockResolvedValue({ id: 'cat-2', icd10Code: null, name: 'Custom Dx' });

      await withTenant(() => service.addToVisit({ visitId: 'visit-1', name: 'Custom Dx' }));

      expect(tx.diagnosisCatalog.upsert).toHaveBeenCalledWith({
        where: { tenantId_name: { tenantId: 'test-tenant', name: 'Custom Dx' } },
        create: { tenantId: 'test-tenant', name: 'Custom Dx', icd10Code: undefined, category: DiagnosisCategory.CUSTOM },
        update: {},
      });
    });

    it('rejects when neither diagnosisCatalogId nor name is given', async () => {
      const { service } = createService();
      await expect(withTenant(() => service.addToVisit({ visitId: 'visit-1' }))).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------
  // G2a (D-059) — attribution
  // ---------------------------------------------------------------------
  describe('attribution', () => {
    it('records the ACTUAL session staff id, not anything from the request', async () => {
      const { service, tx } = createService();
      tx.diagnosisCatalog.findUnique.mockResolvedValue({ id: 'cat-1', icd10Code: 'J00', name: 'Common cold' });

      await withTenant(() => service.addToVisit({ visitId: 'visit-1', diagnosisCatalogId: 'cat-1' }));

      expect(tx.diagnosis.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ addedByStaffId: 'staff-1' }) }),
      );
    });

    it('preserves name and role snapshots taken at write time', async () => {
      const { service, tx } = createService();
      tx.diagnosisCatalog.findUnique.mockResolvedValue({ id: 'cat-1', icd10Code: 'J00', name: 'Common cold' });

      await withTenant(() => service.addToVisit({ visitId: 'visit-1', diagnosisCatalogId: 'cat-1' }));

      expect(tx.diagnosis.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            addedByNameSnapshot: 'Dr. Amira Rahman',
            addedByRoleSnapshot: 'DOCTOR_RESIDENT',
          }),
        }),
      );
    });

    it('ignores a browser-supplied addedByStaffId even if it reaches the service', async () => {
      const { service, tx } = createService();
      tx.diagnosisCatalog.findUnique.mockResolvedValue({ id: 'cat-1', icd10Code: 'J00', name: 'Common cold' });

      await withTenant(() =>
        service.addToVisit({
          visitId: 'visit-1',
          diagnosisCatalogId: 'cat-1',
          // Simulates a client that got past the DTO — the service must still
          // use the session identity.
          addedByStaffId: 'attacker-staff',
        } as never),
      );

      const data = (tx.diagnosis.create as jest.Mock).mock.calls[0][0].data;
      expect(data.addedByStaffId).toBe('staff-1');
      expect(data.addedByStaffId).not.toBe('attacker-staff');
    });

    it('marks new diagnoses as NOT legacy — only the migration sets that flag', async () => {
      const { service, tx } = createService();
      tx.diagnosisCatalog.findUnique.mockResolvedValue({ id: 'cat-1', icd10Code: 'J00', name: 'Common cold' });

      await withTenant(() => service.addToVisit({ visitId: 'visit-1', diagnosisCatalogId: 'cat-1' }));

      expect(tx.diagnosis.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ legacyAttributionUnknown: false }) }),
      );
    });

    it('refuses when there is no authenticated staff member on the session', async () => {
      const { service } = createService({ actor: null });
      await expect(
        tenantContextStorage.run({ tenantId: 'test-tenant' }, () =>
          service.addToVisit({ visitId: 'visit-1', diagnosisCatalogId: 'cat-1' }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses when the staff account is inactive', async () => {
      const { service } = createService({ actor: { ...ACTOR, active: false } });
      await expect(
        withTenant(() => service.addToVisit({ visitId: 'visit-1', diagnosisCatalogId: 'cat-1' })),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------
  // G2a — priority
  // ---------------------------------------------------------------------
  describe('primary diagnosis rule', () => {
    it('does not record a priority when none is given', async () => {
      const { service, tx } = createService();
      tx.diagnosisCatalog.findUnique.mockResolvedValue({ id: 'cat-1', icd10Code: 'J00', name: 'Common cold' });

      await withTenant(() => service.addToVisit({ visitId: 'visit-1', diagnosisCatalogId: 'cat-1' }));

      expect(tx.diagnosis.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ priority: null }) }),
      );
    });

    it('demotes the existing primary when a new diagnosis is added as primary', async () => {
      const { service, tx } = createService();
      tx.diagnosisCatalog.findUnique.mockResolvedValue({ id: 'cat-1', icd10Code: 'J00', name: 'Common cold' });

      await withTenant(() =>
        service.addToVisit({
          visitId: 'visit-1',
          diagnosisCatalogId: 'cat-1',
          priority: DiagnosisPriority.PRIMARY,
        }),
      );

      expect(tx.diagnosis.updateMany).toHaveBeenCalledWith({
        where: { visitId: 'visit-1', priority: DiagnosisPriority.PRIMARY, recordStatus: 'ACTIVE' },
        data: { priority: DiagnosisPriority.SECONDARY },
      });
    });

    it('marking a diagnosis primary demotes the previous primary to SECONDARY, not to null', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue({ id: 'diag-1', visitId: 'visit-1', priority: null });

      await withTenant(() => service.setPriority('diag-1', { priority: DiagnosisPriority.PRIMARY }));

      expect(tx.diagnosis.updateMany).toHaveBeenCalledWith({
        where: {
          visitId: 'visit-1',
          priority: DiagnosisPriority.PRIMARY,
          recordStatus: 'ACTIVE',
          id: { not: 'diag-1' },
        },
        data: { priority: DiagnosisPriority.SECONDARY },
      });
      expect(tx.diagnosis.update).toHaveBeenCalledWith({
        where: { id: 'diag-1' },
        data: { priority: DiagnosisPriority.PRIMARY },
      });
    });

    it('demote and promote happen inside ONE transaction', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue({ id: 'diag-1', visitId: 'visit-1', priority: null });

      await withTenant(() => service.setPriority('diag-1', { priority: DiagnosisPriority.PRIMARY }));

      // Both writes went through the same tx client handed to the callback.
      expect(tx.diagnosis.updateMany).toHaveBeenCalled();
      expect(tx.diagnosis.update).toHaveBeenCalled();
    });

    it('reports a concurrent primary race as 409 rather than leaving two primaries', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue({ id: 'diag-1', visitId: 'visit-1', priority: null });
      tx.diagnosis.update.mockRejectedValue(uniqueViolation());

      await expect(
        withTenant(() => service.setPriority('diag-1', { priority: DiagnosisPriority.PRIMARY })),
      ).rejects.toThrow(ConflictException);
    });

    it('clearing priority back to "not recorded" does not demote anything', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue({ id: 'diag-1', visitId: 'visit-1', priority: 'PRIMARY' });

      await withTenant(() => service.setPriority('diag-1', { priority: null }));

      expect(tx.diagnosis.updateMany).not.toHaveBeenCalled();
      expect(tx.diagnosis.update).toHaveBeenCalledWith({ where: { id: 'diag-1' }, data: { priority: null } });
    });

    it('setPriority throws NotFoundException for an unknown diagnosis', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue(null);
      await expect(
        withTenant(() => service.setPriority('missing', { priority: DiagnosisPriority.PRIMARY })),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------
  // G2a — branch access (cross-tenant is enforced by RLS, below the service)
  // ---------------------------------------------------------------------
  describe('branch access', () => {
    it('denies adding a diagnosis to a visit at an unauthorised branch', async () => {
      const { service } = createService({
        visitClinicId: 'clinic-999',
        tenantBranchCount: 3,
        authorisedClinicIds: [],
      });

      await expect(
        withTenant(() => service.addToVisit({ visitId: 'visit-1', diagnosisCatalogId: 'cat-1' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a branch explicitly granted through UserClinicAccess', async () => {
      const { service, tx } = createService({
        visitClinicId: 'clinic-2',
        tenantBranchCount: 3,
        authorisedClinicIds: ['clinic-2'],
      });
      tx.diagnosisCatalog.findUnique.mockResolvedValue({ id: 'cat-1', icd10Code: 'J00', name: 'Common cold' });

      await expect(
        withTenant(() => service.addToVisit({ visitId: 'visit-1', diagnosisCatalogId: 'cat-1' })),
      ).resolves.toBeDefined();
    });

    it('denies changing priority on a visit at an unauthorised branch', async () => {
      const { service, tx } = createService({
        visitClinicId: 'clinic-999',
        tenantBranchCount: 3,
        authorisedClinicIds: [],
      });
      tx.diagnosis.findUnique.mockResolvedValue({ id: 'diag-1', visitId: 'visit-1', priority: null });

      await expect(
        withTenant(() => service.setPriority('diag-1', { priority: DiagnosisPriority.PRIMARY })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('denies removing a diagnosis at an unauthorised branch', async () => {
      const { service, tx } = createService({
        visitClinicId: 'clinic-999',
        tenantBranchCount: 3,
        authorisedClinicIds: [],
      });
      tx.diagnosis.findUnique.mockResolvedValue({ id: 'diag-1', visitId: 'visit-1', recordStatus: 'ACTIVE', version: 1 });

      await expect(
        withTenant(() => service.removeFromVisit('diag-1', { removalReason: 'wrong branch' })),
      ).rejects.toThrow(ForbiddenException);
      expect(tx.diagnosis.update).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // G2 closure (D-061) — audited removal replaces the hard delete
  // ---------------------------------------------------------------------
  describe('audited removal', () => {
    const SAVED = {
      id: 'diag-1',
      visitId: 'visit-1',
      name: 'Common cold',
      icd10Code: 'J00',
      priority: DiagnosisPriority.PRIMARY,
      recordStatus: 'ACTIVE',
      version: 3,
      addedByStaffId: 'other-staff',
      addedByNameSnapshot: 'Dr. Original',
    };

    it('no longer exposes a hard-delete method', () => {
      const { service } = createService();
      expect((service as unknown as Record<string, unknown>).remove).toBeUndefined();
    });

    it('never calls prisma delete', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue(SAVED);

      await withTenant(() => service.removeFromVisit('diag-1', { removalReason: 'Entered in error' }));

      expect(tx.diagnosis.delete).not.toHaveBeenCalled();
    });

    it('requires a removal reason', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue(SAVED);

      await expect(withTenant(() => service.removeFromVisit('diag-1', { removalReason: '   ' }))).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.diagnosis.update).not.toHaveBeenCalled();
    });

    it('records the remover from the session, not the request', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue(SAVED);

      await withTenant(() =>
        service.removeFromVisit('diag-1', {
          removalReason: 'Wrong patient',
          removedByStaffId: 'attacker',
        } as never),
      );

      const data = (tx.diagnosis.update as jest.Mock).mock.calls[0][0].data;
      expect(data.removedByStaffId).toBe('staff-1');
      expect(data.removedByNameSnapshot).toBe('Dr. Amira Rahman');
      expect(data.removedByRoleSnapshot).toBe('DOCTOR_RESIDENT');
      expect(data.removalReason).toBe('Wrong patient');
    });

    it('preserves the original entry — content, priority and original attribution', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue(SAVED);

      await withTenant(() => service.removeFromVisit('diag-1', { removalReason: 'Entered in error' }));

      const data = (tx.diagnosis.update as jest.Mock).mock.calls[0][0].data;
      // Nothing about the original entry may be rewritten by a removal.
      expect(data.name).toBeUndefined();
      expect(data.icd10Code).toBeUndefined();
      expect(data.priority).toBeUndefined();
      expect(data.addedByStaffId).toBeUndefined();
      expect(data.addedByNameSnapshot).toBeUndefined();
      expect(data.addedAt).toBeUndefined();
      expect(data.recordStatus).toBe('REMOVED_IN_ERROR');
    });

    it('rejects a stale expectedVersion as a conflict', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue(SAVED);

      await expect(
        withTenant(() => service.removeFromVisit('diag-1', { removalReason: 'x y z', expectedVersion: 2 })),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses to remove an already-removed diagnosis', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue({ ...SAVED, recordStatus: 'REMOVED_IN_ERROR' });

      await expect(
        withTenant(() => service.removeFromVisit('diag-1', { removalReason: 'again' })),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the diagnosis does not exist', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue(null);
      await expect(
        withTenant(() => service.removeFromVisit('missing', { removalReason: 'gone' })),
      ).rejects.toThrow(NotFoundException);
    });

    it('denies removal at an unauthorised branch', async () => {
      const { service, tx } = createService({
        visitClinicId: 'clinic-999',
        tenantBranchCount: 3,
        authorisedClinicIds: [],
      });
      tx.diagnosis.findUnique.mockResolvedValue(SAVED);

      await expect(
        withTenant(() => service.removeFromVisit('diag-1', { removalReason: 'wrong branch' })),
      ).rejects.toThrow(ForbiddenException);
      expect(tx.diagnosis.update).not.toHaveBeenCalled();
    });

    it('a legacy diagnosis is removable, and its unknown original author is not fabricated', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue({
        ...SAVED,
        addedByStaffId: null,
        addedByNameSnapshot: null,
        legacyAttributionUnknown: true,
      });

      await withTenant(() => service.removeFromVisit('diag-1', { removalReason: 'Legacy duplicate' }));

      const data = (tx.diagnosis.update as jest.Mock).mock.calls[0][0].data;
      expect(data.addedByStaffId).toBeUndefined();
      expect(data.addedByNameSnapshot).toBeUndefined();
      // The removal event itself still carries reliable attribution.
      expect(data.removedByStaffId).toBe('staff-1');
    });
  });

  describe('clinical authorisation', () => {
    const FRONT_DESK = { ...ACTOR, role: 'FRONT_DESK_CLINICAL_STAFF', professionalType: null };
    const NON_CLINICAL_OWNER = { ...ACTOR, role: 'OWNER_ADMIN', professionalType: null };
    const DOCTOR_OWNER = {
      ...ACTOR,
      role: 'OWNER_ADMIN',
      professionalType: 'MEDICAL_DOCTOR',
      professionalActive: true,
    };

    it('front-desk clinical staff may not remove a diagnosis', async () => {
      const { service, tx } = createService({ actor: FRONT_DESK });
      tx.diagnosis.findUnique.mockResolvedValue({ id: 'diag-1', visitId: 'visit-1', recordStatus: 'ACTIVE', version: 1 });

      await expect(
        withTenant(() => service.removeFromVisit('diag-1', { removalReason: 'nope' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('front-desk clinical staff may not add a diagnosis', async () => {
      const { service } = createService({ actor: FRONT_DESK });
      await expect(
        withTenant(() => service.addToVisit({ visitId: 'visit-1', diagnosisCatalogId: 'cat-1' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a NON-CLINICAL owner-admin may not remove a diagnosis', async () => {
      const { service, tx } = createService({ actor: NON_CLINICAL_OWNER });
      tx.diagnosis.findUnique.mockResolvedValue({ id: 'diag-1', visitId: 'visit-1', recordStatus: 'ACTIVE', version: 1 });

      await expect(
        withTenant(() => service.removeFromVisit('diag-1', { removalReason: 'admin override' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('an owner-admin who IS a doctor may remove a diagnosis', async () => {
      const { service, tx } = createService({ actor: DOCTOR_OWNER });
      tx.diagnosis.findUnique.mockResolvedValue({ id: 'diag-1', visitId: 'visit-1', recordStatus: 'ACTIVE', version: 1 });

      await expect(
        withTenant(() => service.removeFromVisit('diag-1', { removalReason: 'Entered in error' })),
      ).resolves.toBeDefined();
    });
  });

  describe('active-only reads', () => {
    it('excludes removed diagnoses by default', async () => {
      const { service, prisma } = createService();
      (prisma.diagnosis.findMany as jest.Mock).mockResolvedValue([]);

      await service.findByVisitId('visit-1');

      expect(prisma.diagnosis.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { visitId: 'visit-1', recordStatus: 'ACTIVE' } }),
      );
    });

    it('includes removed diagnoses for the audit view', async () => {
      const { service, prisma } = createService();
      (prisma.diagnosis.findMany as jest.Mock).mockResolvedValue([]);

      await service.findByVisitId('visit-1', true);

      expect(prisma.diagnosis.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { visitId: 'visit-1' } }),
      );
    });
  });

  describe('read ordering', () => {
    it('returns the primary diagnosis first', async () => {
      const { service, prisma } = createService();
      (prisma.diagnosis.findMany as jest.Mock).mockResolvedValue([
        { id: 'a', priority: null },
        { id: 'b', priority: DiagnosisPriority.SECONDARY },
        { id: 'c', priority: DiagnosisPriority.PRIMARY },
      ]);

      const result = await service.findByVisitId('visit-1');

      expect(result[0].id).toBe('c');
    });
  });
});
