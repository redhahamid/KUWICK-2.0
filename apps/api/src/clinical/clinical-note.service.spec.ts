import { ClinicalNoteService } from './clinical-note.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    clinicalNote: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  return { service: new ClinicalNoteService(prisma), prisma };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('ClinicalNoteService', () => {
  it('listByVisitId returns an empty list when no notes exist yet', async () => {
    const { service, prisma } = createService();
    (prisma.clinicalNote.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.listByVisitId('visit-1');

    expect(result).toEqual([]);
    expect(prisma.clinicalNote.findMany).toHaveBeenCalledWith({
      where: { visitId: 'visit-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('listByVisitId computes BMI per note from weight (kg) and height (cm)', async () => {
    const { service, prisma } = createService();
    (prisma.clinicalNote.findMany as jest.Mock).mockResolvedValue([
      { id: 'note-1', visitId: 'visit-1', weight: 70, height: 175 },
      { id: 'note-2', visitId: 'visit-1', weight: 70, height: null },
    ]);

    const result = await service.listByVisitId('visit-1');

    // 70 / (1.75^2) = 22.857... rounded to 1dp
    expect(result[0].bmi).toBeCloseTo(22.9, 1);
    expect(result[1].bmi).toBeNull();
  });

  it('create scopes a new note to the current tenant and visit', async () => {
    const { service, prisma } = createService();
    (prisma.clinicalNote.create as jest.Mock).mockResolvedValue({
      id: 'note-1',
      visitId: 'visit-1',
      weight: null,
      height: null,
      notes: 'Patient reports mild cough',
    });

    await withTenant(() => service.create('visit-1', { notes: 'Patient reports mild cough' }));

    expect(prisma.clinicalNote.create).toHaveBeenCalledWith({
      data: { tenantId: 'test-tenant', visitId: 'visit-1', notes: 'Patient reports mild cough' },
    });
  });

  it('update edits an existing note by id, independent of other notes on the same visit', async () => {
    const { service, prisma } = createService();
    (prisma.clinicalNote.update as jest.Mock).mockResolvedValue({
      id: 'note-2',
      visitId: 'visit-1',
      weight: 70,
      height: 175,
      notes: 'Reassessment after nebuliser',
    });

    const result = await service.update('note-2', { notes: 'Reassessment after nebuliser' });

    expect(prisma.clinicalNote.update).toHaveBeenCalledWith({
      where: { id: 'note-2' },
      data: { notes: 'Reassessment after nebuliser' },
    });
    expect(result.bmi).toBeCloseTo(22.9, 1);
  });
});
