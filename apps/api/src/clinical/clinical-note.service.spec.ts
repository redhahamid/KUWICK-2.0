import { ClinicalNoteService } from './clinical-note.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    clinicalNote: { findUnique: jest.fn(), upsert: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  return { service: new ClinicalNoteService(prisma), prisma };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('ClinicalNoteService', () => {
  it('findByVisitId returns null when no note exists yet', async () => {
    const { service, prisma } = createService();
    (prisma.clinicalNote.findUnique as jest.Mock).mockResolvedValue(null);

    const result = await service.findByVisitId('visit-1');

    expect(result).toBeNull();
  });

  it('findByVisitId computes BMI from weight (kg) and height (cm)', async () => {
    const { service, prisma } = createService();
    (prisma.clinicalNote.findUnique as jest.Mock).mockResolvedValue({
      id: 'note-1',
      visitId: 'visit-1',
      weight: 70,
      height: 175,
    });

    const result = await service.findByVisitId('visit-1');

    // 70 / (1.75^2) = 22.857... rounded to 1dp
    expect(result?.bmi).toBeCloseTo(22.9, 1);
  });

  it('findByVisitId returns null BMI when weight or height is missing', async () => {
    const { service, prisma } = createService();
    (prisma.clinicalNote.findUnique as jest.Mock).mockResolvedValue({
      id: 'note-1',
      visitId: 'visit-1',
      weight: 70,
      height: null,
    });

    const result = await service.findByVisitId('visit-1');

    expect(result?.bmi).toBeNull();
  });

  it('upsert creates a note scoped to the current tenant on first save', async () => {
    const { service, prisma } = createService();
    (prisma.clinicalNote.upsert as jest.Mock).mockResolvedValue({
      id: 'note-1',
      visitId: 'visit-1',
      weight: null,
      height: null,
      notes: 'Patient reports mild cough',
    });

    await withTenant(() => service.upsert('visit-1', { notes: 'Patient reports mild cough' }));

    expect(prisma.clinicalNote.upsert).toHaveBeenCalledWith({
      where: { visitId: 'visit-1' },
      create: { tenantId: 'test-tenant', visitId: 'visit-1', notes: 'Patient reports mild cough' },
      update: { notes: 'Patient reports mild cough' },
    });
  });
});
