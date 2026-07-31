import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../core/prisma.service';

jest.mock('bcryptjs');

function createService() {
  const prisma = {
    tenant: { findUnique: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
    platformAdmin: { findUnique: jest.fn(), update: jest.fn() },
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
        staff: { id: 'staff-1', active: true, role: 'DOCTOR_RESIDENT', fullName: 'Dr. Amira Rahman' },
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto);

      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { lastLoginAt: expect.any(Date) } });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-1', tenantId: 'tenant-1', staffId: 'staff-1', role: 'DOCTOR_RESIDENT' },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
      );
      expect(result.accessToken).toBe('signed-token');
      expect(result.refreshToken).toBe('signed-token');
      expect(result.staff).toEqual({ id: 'staff-1', fullName: 'Dr. Amira Rahman', role: 'DOCTOR_RESIDENT' });
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
