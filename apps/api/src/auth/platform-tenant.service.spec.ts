import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PlatformTenantService } from './platform-tenant.service';
import { PrismaService } from '../core/prisma.service';

function createService() {
  const prisma = {
    tenant: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn() },
    clinic: { create: jest.fn().mockResolvedValue({ id: 'clinic-1' }), findFirst: jest.fn().mockResolvedValue({ id: 'clinic-1' }) },
    user: { create: jest.fn().mockResolvedValue({ id: 'owner-user-1', email: 'new@owner.com' }), update: jest.fn() },
    staff: { create: jest.fn().mockResolvedValue({ id: 'owner-staff-1', fullName: 'New Owner' }), findFirst: jest.fn(), update: jest.fn() },
    defaultPanelClinic: { findMany: jest.fn().mockResolvedValue([]) },
    defaultProcedure: { findMany: jest.fn().mockResolvedValue([]) },
    defaultDocumentTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    panelClinic: { createMany: jest.fn() },
    serviceCatalog: { createMany: jest.fn() },
    customDocumentTemplate: { createMany: jest.fn() },
    tenantSubscription: { create: jest.fn() },
    $executeRaw: jest.fn(),
  } as unknown as PrismaService;
  // Every call wraps in $transaction to set a session GUC first — the mock
  // just runs the callback against the same client.
  (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn((fn: (tx: PrismaService) => unknown) =>
    fn(prisma),
  );
  return { service: new PlatformTenantService(prisma), prisma };
}

describe('PlatformTenantService', () => {
  it('creates a tenant with its first clinic', async () => {
    const { service, prisma } = createService();
    (prisma.tenant.create as jest.Mock).mockResolvedValue({ id: 'tenant-1' });

    await service.create({ name: 'New Clinic', slug: 'new-clinic', address: '123 Jalan Alpha', phone: '+60123', email: 'info@new.com' });

    expect(prisma.tenant.create).toHaveBeenCalledWith({
      data: { name: 'New Clinic', slug: 'new-clinic', registrationNo: undefined },
    });
    expect(prisma.clinic.create).toHaveBeenCalledWith({
      data: { tenantId: 'tenant-1', name: 'New Clinic', address: '123 Jalan Alpha', phone: '+60123', email: 'info@new.com' },
    });
    expect(prisma.tenantSubscription.create).not.toHaveBeenCalled();
  });

  // D-049 — the console no longer asks for a slug; it's derived from the name.
  it('derives a slug from the clinic name when none is given, suffixing on collision', async () => {
    const { service, prisma } = createService();
    (prisma.tenant.create as jest.Mock).mockResolvedValue({ id: 'tenant-1' });
    (prisma.tenant.findMany as jest.Mock).mockResolvedValue([{ slug: 'klinik-alpha-kajang' }]);

    await service.create({ name: 'Klinik Alpha (Kajang)' });

    expect(prisma.tenant.create).toHaveBeenCalledWith({
      data: { name: 'Klinik Alpha (Kajang)', slug: 'klinik-alpha-kajang-2', registrationNo: undefined },
    });
  });

  /**
   * N-1 — the default panel list is copied into a new tenant, and the NAME used
   * to be the only field that travelled. A clinic therefore lost the portal
   * address and the kind of body each panel is at the moment it was created,
   * and had to re-enter both by hand on a screen that could not suggest them.
   */
  it('carries the portal URL and the kind of panel over from the default list', async () => {
    const { service, prisma } = createService();
    (prisma.tenant.create as jest.Mock).mockResolvedValue({ id: 'tenant-1' });
    (prisma.defaultPanelClinic.findMany as jest.Mock).mockResolvedValue([
      { id: 'd1', name: 'Demo TPA A', url: 'https://portal.example.test', panelType: 'TPA', active: true },
      { id: 'd2', name: 'Demo Government Scheme', url: null, panelType: 'GOVERNMENT', active: true },
    ]);

    await service.create({ name: 'New Clinic' });

    expect(prisma.panelClinic.createMany).toHaveBeenCalledWith({
      data: [
        {
          tenantId: 'tenant-1',
          name: 'Demo TPA A',
          portalUrl: 'https://portal.example.test',
          panelType: 'TPA',
        },
        {
          tenantId: 'tenant-1',
          name: 'Demo Government Scheme',
          portalUrl: null,
          panelType: 'GOVERNMENT',
        },
      ],
    });
  });

  /**
   * And nothing MORE than those three. A term, a fee or a limit copied from the
   * platform's list would be a guess wearing the authority of a default, on
   * numbers that decide what a panel owes. The setup wizard (N-2) asks instead.
   */
  it('copies no term, fee or limit onto a new tenant\u2019s panels', async () => {
    const { service, prisma } = createService();
    (prisma.tenant.create as jest.Mock).mockResolvedValue({ id: 'tenant-1' });
    (prisma.defaultPanelClinic.findMany as jest.Mock).mockResolvedValue([
      { id: 'd1', name: 'Demo TPA A', url: null, panelType: 'TPA', active: true },
    ]);

    await service.create({ name: 'New Clinic' });

    const [{ data }] = (prisma.panelClinic.createMany as jest.Mock).mock.calls[0];
    expect(Object.keys(data[0]).sort()).toEqual(['name', 'panelType', 'portalUrl', 'tenantId']);
  });

  // D-049 — the clinic's first OWNER_ADMIN login is created with the clinic.
  it('creates the owner-admin user + staff when owner credentials are given', async () => {
    const { service, prisma } = createService();
    (prisma.tenant.create as jest.Mock).mockResolvedValue({ id: 'tenant-1' });

    await service.create({
      name: 'New Clinic',
      ownerFullName: 'Dr. Aisyah Binti Ahmad',
      ownerEmail: 'aisyah@newclinic.com',
      ownerPassword: 'super-secret-1',
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { tenantId: 'tenant-1', email: 'aisyah@newclinic.com', passwordHash: expect.any(String) },
    });
    const hash = (prisma.user.create as jest.Mock).mock.calls[0][0].data.passwordHash as string;
    expect(hash).not.toBe('super-secret-1');
    expect(prisma.staff.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        userId: 'owner-user-1',
        role: 'OWNER_ADMIN',
        fullName: 'Dr. Aisyah Binti Ahmad',
        clinicId: 'clinic-1',
      },
    });
  });

  it('creates no login at all when owner credentials are omitted', async () => {
    const { service, prisma } = createService();
    (prisma.tenant.create as jest.Mock).mockResolvedValue({ id: 'tenant-1' });

    await service.create({ name: 'New Clinic' });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.staff.create).not.toHaveBeenCalled();
  });

  it('copies active default panels and procedures into the new tenant', async () => {
    const { service, prisma } = createService();
    (prisma.tenant.create as jest.Mock).mockResolvedValue({ id: 'tenant-1' });
    (prisma.defaultPanelClinic.findMany as jest.Mock).mockResolvedValue([{ id: 'dp-1', name: 'AIA' }]);
    (prisma.defaultProcedure.findMany as jest.Mock).mockResolvedValue([
      { id: 'dproc-1', name: 'XRAY CHEST', code: 'XRAYCHEST', price: 80 },
    ]);

    await service.create({ name: 'New Clinic', slug: 'new-clinic' });

    expect(prisma.panelClinic.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: 'tenant-1', name: 'AIA' }],
    });
    expect(prisma.serviceCatalog.createMany).toHaveBeenCalledWith({
      data: [
        {
          tenantId: 'tenant-1',
          name: 'XRAY CHEST',
          code: 'XRAYCHEST',
          price: 80,
          orderType: 'TASK_ORDER',
          durationMinutesDefault: 15,
        },
      ],
    });
  });

  it('grants a 14-day trial subscription when startAsTrial is set', async () => {
    const { service, prisma } = createService();
    (prisma.tenant.create as jest.Mock).mockResolvedValue({ id: 'tenant-1' });

    await service.create({ name: 'New Clinic', slug: 'new-clinic', startAsTrial: true });

    expect(prisma.tenantSubscription.create).toHaveBeenCalledWith({
      data: { tenantId: 'tenant-1', status: 'TRIAL', endsAt: expect.any(Date) },
    });
    const endsAt = (prisma.tenantSubscription.create as jest.Mock).mock.calls[0][0].data.endsAt as Date;
    const days = Math.round((endsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    expect(days).toBe(14);
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

  // D-049 — editing the owner login from the console.
  describe('updateOwner', () => {
    const existingOwner = {
      id: 'owner-staff-1',
      userId: 'owner-user-1',
      fullName: 'Old Name',
      user: { id: 'owner-user-1', email: 'old@owner.com', passwordHash: 'old-hash' },
    };

    it('updates name and email, leaving the password untouched when omitted', async () => {
      const { service, prisma } = createService();
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: 'tenant-1' });
      (prisma.staff.findFirst as jest.Mock).mockResolvedValue(existingOwner);

      const result = await service.updateOwner('tenant-1', { fullName: 'New Name', email: 'new@owner.com' });

      expect(prisma.staff.update).toHaveBeenCalledWith({ where: { id: 'owner-staff-1' }, data: { fullName: 'New Name' } });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'owner-user-1' },
        data: { email: 'new@owner.com' },
      });
      expect(result).toEqual({ staffId: 'owner-staff-1', fullName: 'New Name', email: 'new@owner.com' });
    });

    it('rehashes and stores a new password when provided', async () => {
      const { service, prisma } = createService();
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: 'tenant-1' });
      (prisma.staff.findFirst as jest.Mock).mockResolvedValue(existingOwner);

      await service.updateOwner('tenant-1', { password: 'brand-new-pass' });

      const data = (prisma.user.update as jest.Mock).mock.calls[0][0].data as { passwordHash: string };
      expect(data.passwordHash).toBeDefined();
      expect(data.passwordHash).not.toBe('brand-new-pass');
      expect(prisma.staff.update).not.toHaveBeenCalled();
    });

    it('creates the owner login when the tenant has none and all fields are given', async () => {
      const { service, prisma } = createService();
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: 'tenant-1' });
      (prisma.staff.findFirst as jest.Mock).mockResolvedValue(null);

      await service.updateOwner('tenant-1', { fullName: 'New Owner', email: 'new@owner.com', password: 'super-secret' });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { tenantId: 'tenant-1', email: 'new@owner.com', passwordHash: expect.any(String) },
      });
      expect(prisma.staff.create).toHaveBeenCalledWith({
        data: { tenantId: 'tenant-1', userId: 'owner-user-1', role: 'OWNER_ADMIN', fullName: 'New Owner', clinicId: 'clinic-1' },
      });
    });

    it('rejects a partial create when the tenant has no owner login yet', async () => {
      const { service, prisma } = createService();
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: 'tenant-1' });
      (prisma.staff.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.updateOwner('tenant-1', { email: 'only@email.com' })).rejects.toThrow(BadRequestException);
    });
  });
});
