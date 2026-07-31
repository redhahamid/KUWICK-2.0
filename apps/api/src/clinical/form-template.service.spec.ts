import { NotFoundException } from '@nestjs/common';
import { FormTemplateService } from './form-template.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    formTemplate: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  return { service: new FormTemplateService(prisma), prisma };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

const SAMPLE_FIELDS = [{ id: 'f1', label: 'Hemoglobin', type: 'NUMBER', unit: 'g/dL' }];

describe('FormTemplateService', () => {
  it('create stores the field array against the given service', async () => {
    const { service, prisma } = createService();
    (prisma.formTemplate.create as jest.Mock).mockResolvedValue({ id: 'ft-1' });

    await withTenant(() => service.create({ name: 'FBC', serviceCatalogId: 'svc-1', fields: SAMPLE_FIELDS as never }));

    expect(prisma.formTemplate.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        name: 'FBC',
        serviceCatalogId: 'svc-1',
        fields: SAMPLE_FIELDS,
      },
    });
  });

  it('findByServiceCatalogId only matches active templates', async () => {
    const { service, prisma } = createService();
    (prisma.formTemplate.findFirst as jest.Mock).mockResolvedValue(null);

    await service.findByServiceCatalogId('svc-1');

    expect(prisma.formTemplate.findFirst).toHaveBeenCalledWith({
      where: { serviceCatalogId: 'svc-1', active: true },
    });
  });

  it('update throws NotFoundException for an unknown template', async () => {
    const { service, prisma } = createService();
    (prisma.formTemplate.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.update('missing', { name: 'X' })).rejects.toThrow(NotFoundException);
  });
});
