import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DiagnosisCategory, DiagnosisPriority, Prisma } from '@prisma/client';
import { DiagnosisService } from './diagnosis.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

const ACTOR = {
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
  actor?: Partial<typeof ACTOR> | null;
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
      expect(where.OR).toEqual([
        { name: { contains: 'J06.9', mode: 'insensitive' } },
        { icd10Code: { contains: 'J06.9', mode: 'insensitive' } },
      ]);
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
        where: { visitId: 'visit-1', priority: DiagnosisPriority.PRIMARY },
        data: { priority: DiagnosisPriority.SECONDARY },
      });
    });

    it('marking a diagnosis primary demotes the previous primary to SECONDARY, not to null', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue({ id: 'diag-1', visitId: 'visit-1', priority: null });

      await withTenant(() => service.setPriority('diag-1', { priority: DiagnosisPriority.PRIMARY }));

      expect(tx.diagnosis.updateMany).toHaveBeenCalledWith({
        where: { visitId: 'visit-1', priority: DiagnosisPriority.PRIMARY, id: { not: 'diag-1' } },
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
      tx.diagnosis.findUnique.mockResolvedValue({ id: 'diag-1', visitId: 'visit-1' });

      await expect(withTenant(() => service.remove('diag-1'))).rejects.toThrow(ForbiddenException);
      expect(tx.diagnosis.delete).not.toHaveBeenCalled();
    });
  });

  describe('removal', () => {
    it('throws NotFoundException when the diagnosis does not exist', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue(null);
      await expect(withTenant(() => service.remove('missing'))).rejects.toThrow(NotFoundException);
    });

    it('still hard-deletes — G2a deliberately did not change this', async () => {
      const { service, tx } = createService();
      tx.diagnosis.findUnique.mockResolvedValue({ id: 'diag-1', visitId: 'visit-1' });

      await withTenant(() => service.remove('diag-1'));

      expect(tx.diagnosis.delete).toHaveBeenCalledWith({ where: { id: 'diag-1' } });
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
