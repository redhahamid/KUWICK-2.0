import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DiagnosisService } from './diagnosis.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    diagnosisCatalog: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
    diagnosis: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  return { service: new DiagnosisService(prisma), prisma };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('DiagnosisService', () => {
  it('addToVisit snapshots code/name from an existing catalog entry', async () => {
    const { service, prisma } = createService();
    (prisma.diagnosisCatalog.findUnique as jest.Mock).mockResolvedValue({
      id: 'cat-1',
      code: 'J00',
      name: 'Common cold',
    });
    (prisma.diagnosis.create as jest.Mock).mockResolvedValue({ id: 'diag-1' });

    await withTenant(() => service.addToVisit({ visitId: 'visit-1', diagnosisCatalogId: 'cat-1' }));

    expect(prisma.diagnosis.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        visitId: 'visit-1',
        diagnosisCatalogId: 'cat-1',
        code: 'J00',
        name: 'Common cold',
      },
    });
  });

  it('addToVisit throws NotFoundException for an unknown diagnosisCatalogId', async () => {
    const { service, prisma } = createService();
    (prisma.diagnosisCatalog.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(withTenant(() => service.addToVisit({ visitId: 'visit-1', diagnosisCatalogId: 'missing' }))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('addToVisit creates a catalog entry inline when only a name is given', async () => {
    const { service, prisma } = createService();
    (prisma.diagnosisCatalog.upsert as jest.Mock).mockResolvedValue({ id: 'cat-2', code: null, name: 'Custom Dx' });
    (prisma.diagnosis.create as jest.Mock).mockResolvedValue({ id: 'diag-2' });

    await withTenant(() => service.addToVisit({ visitId: 'visit-1', name: 'Custom Dx' }));

    expect(prisma.diagnosisCatalog.upsert).toHaveBeenCalledWith({
      where: { tenantId_name: { tenantId: 'test-tenant', name: 'Custom Dx' } },
      create: { tenantId: 'test-tenant', name: 'Custom Dx', code: undefined },
      update: {},
    });
    expect(prisma.diagnosis.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ diagnosisCatalogId: 'cat-2', name: 'Custom Dx' }) }),
    );
  });

  it('addToVisit rejects when neither diagnosisCatalogId nor name is given', async () => {
    const { service } = createService();
    await expect(withTenant(() => service.addToVisit({ visitId: 'visit-1' }))).rejects.toThrow(BadRequestException);
  });

  it('remove throws NotFoundException when the diagnosis does not exist', async () => {
    const { service, prisma } = createService();
    (prisma.diagnosis.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
  });
});
