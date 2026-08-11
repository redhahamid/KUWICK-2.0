import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../core/prisma.service';

jest.mock('bcryptjs');

function createService() {
  const prisma = {
    tenant: { findUnique: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    platformAdmin: { findUnique: jest.fn(), update: jest.fn() },
    // TASK 1 — capability roles. Empty by default: the policy module falls
    // back to the legacy role's mapping, which is exactly the state every
    // existing account is in until somebody assigns roles explicitly.
    staffRoleAssignment: { findMany: jest.fn().mockResolvedValue([]) },
    $executeRaw: jest.fn(),
  } as unknown as PrismaService;
  // login/refresh wrap their tenant/user lookups in $transaction to set the
  // app.bypass_tenant_scope / app.tenant_id GUCs first — the mock just runs
  // the callback against the same client.
  (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn((fn: (tx: PrismaService) => unknown) =>
    fn(prisma),
  );
  const jwtService = {
    sign: jest.fn().mockReturnValue('signed-token'),
    verify: jest.fn(),
  } as unknown as import('@nestjs/jwt').JwtService;
  return { service: new AuthService(prisma, jwtService), prisma, jwtService };
}

describe('AuthService', () => {
  afterEach(() => jest.clearAllMocks());

  describe('login', () => {
    const dto = { slug: 'smoke-test-clinic', email: 'doctor@example.com', password: 'correct-password' };

    it('rejects an unknown slug', async () => {
      const { service, prisma } = createService();
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a suspended tenant', async () => {
      const { service, prisma } = createService();
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: 'tenant-1', status: 'suspended' });

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an unknown email within a valid tenant', async () => {
      const { service, prisma } = createService();
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: 'tenant-1', status: 'active' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      const { service, prisma } = createService();
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: 'tenant-1', status: 'active' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        status: 'active',
        passwordHash: 'hashed',
        staff: { id: 'staff-1', active: true, role: 'DOCTOR_RESIDENT', fullName: 'Dr. Amira Rahman' },
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a user with no linked active staff record', async () => {
      const { service, prisma } = createService();
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: 'tenant-1', status: 'active' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        status: 'active',
        passwordHash: 'hashed',
        staff: null,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('issues access + refresh tokens for a valid login', async () => {
      const { service, prisma, jwtService } = createService();
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: 'tenant-1', name: 'Smoke Test Clinic', slug: 'smoke-test-clinic', status: 'active' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        email: dto.email,
        status: 'active',
        passwordHash: 'hashed',
        staff: {
          id: 'staff-1',
          active: true,
          role: 'DOCTOR_RESIDENT',
          fullName: 'Dr. Amira Rahman',
          clinicId: 'clinic-1',
          clinic: { id: 'clinic-1', name: 'Main Branch' },
        },
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto);

      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { lastLoginAt: expect.any(Date) } });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-1', tenantId: 'tenant-1', staffId: 'staff-1', role: 'DOCTOR_RESIDENT' },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
      );
      expect(result.kind).toBe('tenant');
      if (result.kind !== 'tenant') return;
      expect(result.accessToken).toBe('signed-token');
      expect(result.refreshToken).toBe('signed-token');
      expect(result.staff).toEqual({
        id: 'staff-1',
        fullName: 'Dr. Amira Rahman',
        role: 'DOCTOR_RESIDENT',
        clinicId: 'clinic-1',
        clinicName: 'Main Branch',
        // D1 — the session now publishes the AUTHORING CAPABILITY, decided by
        // the same function the write path uses. The Canvas renders this
        // instead of re-deriving it from the role, which is how a
        // credentialed owner-doctor came to be refused by the browser and
        // allowed by the server.
        canAuthorNarrative: true,
        // TASK 1 — the session publishes the whole permission set from the
        // central policy module, so the browser renders the server's answer
        // instead of deriving a second one from the role. With no explicit
        // assignments this staff member falls back to DOCTOR_RESIDENT's
        // mapping, which is the DOCTOR role.
        permissions: [
          'allergy.write',
          // Owner decision: the night-shift doctor raises the invoice and
          // takes payment. NOT billing.corrections — no doctor discounts or
          // voids a bill.
          'billing.counter',
          'clinical.void',
          'consultation.complete',
          'consultation.hold',
          'consultation.resume',
          'diagnosis.write',
          'dispense.perform',
          'document.authoriseClinical',
          'document.issueAdministrative',
          'document.print',
          // NOT note.sign: this fixture has no verified medical registration.
          // The role opens the door to the clinical record; the credential is
          // what puts a name on it.
          'note.staffRemark',
          'note.write',
          'observation.write',
          'order.write',
          'prescription.write',
          'queue.consultationFlow',
        ],
        roles: [],
      });
    });
  });

  // D-049 — unified email-only login: no slug, tenant resolved from the
  // email (and password) alone; platform admins share the same form.
  describe('login (email-only, D-049)', () => {
    const dto = { email: 'doctor@example.com', password: 'correct-password' };

    function tenantUser(overrides: Record<string, unknown> = {}) {
      return {
        id: 'user-1',
        email: dto.email,
        status: 'active',
        passwordHash: 'hashed',
        tenant: { id: 'tenant-1', name: 'Smoke Test Clinic', slug: 'smoke-test-clinic', status: 'active' },
        staff: {
          id: 'staff-1',
          active: true,
          role: 'DOCTOR_RESIDENT',
          fullName: 'Dr. Amira Rahman',
          clinicId: 'clinic-1',
          clinic: { id: 'clinic-1', name: 'Main Branch' },
        },
        ...overrides,
      };
    }

    it('logs into the single clinic whose password matches, with no slug', async () => {
      const { service, prisma } = createService();
      (prisma.user.findMany as jest.Mock).mockResolvedValue([tenantUser()]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto);

      expect(result.kind).toBe('tenant');
      if (result.kind !== 'tenant') return;
      expect(result.tenant.id).toBe('tenant-1');
      expect(result.staff.id).toBe('staff-1');
    });

    it('rejects when the password matches no account', async () => {
      const { service, prisma } = createService();
      (prisma.user.findMany as jest.Mock).mockResolvedValue([tenantUser()]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('skips accounts on suspended tenants and inactive staff', async () => {
      const { service, prisma } = createService();
      (prisma.user.findMany as jest.Mock).mockResolvedValue([
        tenantUser({ id: 'user-suspended', tenant: { id: 'tenant-2', name: 'X', slug: 'x', status: 'suspended' } }),
        tenantUser({ id: 'user-nostaff', staff: null }),
        tenantUser(),
      ]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto);

      expect(result.kind).toBe('tenant');
      if (result.kind !== 'tenant') return;
      expect(result.user.id).toBe('user-1');
    });

    it('asks for the clinic code (409) when the same email+password validates at two clinics', async () => {
      const { service, prisma } = createService();
      (prisma.user.findMany as jest.Mock).mockResolvedValue([
        tenantUser(),
        tenantUser({ id: 'user-2', tenant: { id: 'tenant-2', name: 'Other Clinic', slug: 'other', status: 'active' } }),
      ]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.login(dto)).rejects.toThrow(ConflictException);
    });

    it('signs a platform admin into the platform console from the same form', async () => {
      const { service, prisma, jwtService } = createService();
      (prisma.platformAdmin.findUnique as jest.Mock).mockResolvedValue({
        id: 'admin-1',
        email: dto.email,
        fullName: 'Platform Owner',
        active: true,
        passwordHash: 'hashed',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto);

      expect(result.kind).toBe('platform');
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'admin-1', type: 'platform' },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '1h' },
      );
    });

    it('falls through to clinic login when the email exists as a platform admin but the password is wrong for it', async () => {
      const { service, prisma } = createService();
      (prisma.platformAdmin.findUnique as jest.Mock).mockResolvedValue({
        id: 'admin-1',
        active: true,
        passwordHash: 'admin-hash',
      });
      (prisma.user.findMany as jest.Mock).mockResolvedValue([tenantUser()]);
      (bcrypt.compare as jest.Mock).mockImplementation((_pw: string, hash: string) => Promise.resolve(hash !== 'admin-hash'));

      const result = await service.login(dto);

      expect(result.kind).toBe('tenant');
    });
  });

  describe('refresh', () => {
    it('rejects an invalid/expired refresh token', async () => {
      const { service, jwtService } = createService();
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw new Error('expired');
      });

      await expect(service.refresh({ refreshToken: 'bad' })).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token that is not actually a refresh token', async () => {
      const { service, jwtService } = createService();
      (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'user-1', tenantId: 't1', staffId: 's1', role: 'DOCTOR_RESIDENT', type: 'access' });

      await expect(service.refresh({ refreshToken: 'x' })).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a refresh token for a deactivated staff member', async () => {
      const { service, prisma, jwtService } = createService();
      (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'user-1', tenantId: 't1', staffId: 's1', role: 'DOCTOR_RESIDENT', type: 'refresh' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        status: 'active',
        staff: { id: 's1', active: false },
      });

      await expect(service.refresh({ refreshToken: 'x' })).rejects.toThrow(UnauthorizedException);
    });

    it('issues a fresh token pair for a valid refresh token', async () => {
      const { service, prisma, jwtService } = createService();
      (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'user-1', tenantId: 't1', staffId: 's1', role: 'DOCTOR_RESIDENT', type: 'refresh' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'user-1',
        status: 'active',
        staff: { id: 's1', active: true, role: 'DOCTOR_RESIDENT' },
      });

      const result = await service.refresh({ refreshToken: 'x' });

      expect(result.accessToken).toBe('signed-token');
    });
  });

  describe('loginPlatformAdmin', () => {
    it('rejects an unknown email', async () => {
      const { service, prisma } = createService();
      (prisma.platformAdmin.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.loginPlatformAdmin({ email: 'x@x.com', password: 'p' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a wrong password', async () => {
      const { service, prisma } = createService();
      (prisma.platformAdmin.findUnique as jest.Mock).mockResolvedValue({ id: 'admin-1', active: true, passwordHash: 'hashed' });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.loginPlatformAdmin({ email: 'x@x.com', password: 'wrong' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('issues a platform token for a valid login', async () => {
      const { service, prisma, jwtService } = createService();
      (prisma.platformAdmin.findUnique as jest.Mock).mockResolvedValue({
        id: 'admin-1',
        email: 'x@x.com',
        fullName: 'Platform Owner',
        active: true,
        passwordHash: 'hashed',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.loginPlatformAdmin({ email: 'x@x.com', password: 'correct' });

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'admin-1', type: 'platform' },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '1h' },
      );
      expect(result.accessToken).toBe('signed-token');
    });
  });
});
