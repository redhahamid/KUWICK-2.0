import { NotFoundException } from '@nestjs/common';
import { PlatformTenantService } from './platform-tenant.service';
import { PrismaService } from '../core/prisma.service';

function createService() {
  const prisma = {
    tenant: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    $executeRaw: jest.fn(),
  } as unknown as PrismaService;
  // Every call wraps in $transaction to set the app.bypass_tenant_scope
  // GUC first — the mock just runs the callback against the same client.
  (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn((fn: (tx: PrismaService) => unknown) =>
    fn(prisma),
  );
  return { service: new PlatformTenantService(prisma), prisma };
}

describe('PlatformTenantService', () => {
  it('creates a tenant with the given name and slug', async () => {
    const { service, prisma } = createService();
    (prisma.tenant.create as jest.Mock).mockResolvedValue({ id: 'tenant-1' });

    await service.create({ name: 'New Clinic', slug: 'new-clinic' });

    expect(prisma.tenant.create).toHaveBeenCalledWith({ data: { name: 'New Clinic', slug: 'new-clinic' } });
  });

  it('update throws NotFoundException for a missing tenant', async () => {
    const { service, prisma } = createService();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.update('missing', { name: 'X' })).rejects.toThrow(NotFoundException);
  });

  it('update applies partial changes to an existing tenant', async () => {
    const { service, prisma } = createService();
    (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: 'tenant-1' });
    (prisma.tenant.update as jest.Mock).mockResolvedValue({ id: 'tenant-1', status: 'suspended' });

    await service.update('tenant-1', { status: 'suspended' });

    expect(prisma.tenant.update).toHaveBeenCalledWith({ where: { id: 'tenant-1' }, data: { status: 'suspended' } });
  });
});
