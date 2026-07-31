import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PanelPricingService } from './panel-pricing.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    panelPriceOverride: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
    panelExclusion: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  return { service: new PanelPricingService(prisma), prisma };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('PanelPricingService', () => {
  it('createOverride rejects when neither itemId nor serviceCatalogId is given', async () => {
    const { service } = createService();
    await expect(withTenant(() => service.createOverride('panel-1', { overridePrice: 10 }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('createOverride rejects when both itemId and serviceCatalogId are given', async () => {
    const { service } = createService();
    await expect(
      withTenant(() =>
        service.createOverride('panel-1', { itemId: 'item-1', serviceCatalogId: 'svc-1', overridePrice: 10 }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('createOverride creates a row scoped to the panel and current tenant', async () => {
    const { service, prisma } = createService();
    (prisma.panelPriceOverride.create as jest.Mock).mockResolvedValue({ id: 'override-1' });

    await withTenant(() => service.createOverride('panel-1', { itemId: 'item-1', overridePrice: 12.5 }));

    expect(prisma.panelPriceOverride.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        panelClinicId: 'panel-1',
        itemId: 'item-1',
        serviceCatalogId: undefined,
        overridePrice: 12.5,
      },
    });
  });

  it('removeOverride throws NotFoundException for a row belonging to a different panel', async () => {
    const { service, prisma } = createService();
    (prisma.panelPriceOverride.findUnique as jest.Mock).mockResolvedValue({ id: 'o-1', panelClinicId: 'panel-2' });

    await expect(service.removeOverride('panel-1', 'o-1')).rejects.toThrow(NotFoundException);
  });

  it('createExclusion rejects when neither itemId nor serviceCatalogId is given', async () => {
    const { service } = createService();
    await expect(withTenant(() => service.createExclusion('panel-1', {}))).rejects.toThrow(BadRequestException);
  });

  it('createExclusion creates a row scoped to the panel and current tenant', async () => {
    const { service, prisma } = createService();
    (prisma.panelExclusion.create as jest.Mock).mockResolvedValue({ id: 'excl-1' });

    await withTenant(() =>
      service.createExclusion('panel-1', { serviceCatalogId: 'svc-1', reason: 'Not covered' }),
    );

    expect(prisma.panelExclusion.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        panelClinicId: 'panel-1',
        itemId: undefined,
        serviceCatalogId: 'svc-1',
        reason: 'Not covered',
      },
    });
  });

  it('removeExclusion throws NotFoundException for a row belonging to a different panel', async () => {
    const { service, prisma } = createService();
    (prisma.panelExclusion.findUnique as jest.Mock).mockResolvedValue({ id: 'e-1', panelClinicId: 'panel-2' });

    await expect(service.removeExclusion('panel-1', 'e-1')).rejects.toThrow(NotFoundException);
  });
});
