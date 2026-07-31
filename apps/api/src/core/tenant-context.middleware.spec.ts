import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { tenantContextStorage } from './tenant-context';
import { PrismaService } from './prisma.service';

function mockRequest(headers: Record<string, string>): Request {
  return { header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

function createMiddleware(transactionResult: unknown, verifyImpl?: () => unknown) {
  const prisma = {
    $transaction: jest.fn().mockResolvedValue(transactionResult),
  } as unknown as PrismaService;
  const jwtService = {
    verify: jest.fn(
      verifyImpl ??
        (() => {
          throw new Error('invalid token');
        }),
    ),
  } as unknown as JwtService;
  return new TenantContextMiddleware(prisma, jwtService);
}

describe('TenantContextMiddleware', () => {
  const validTenantId = '11111111-1111-1111-1111-111111111111';
  const validClaims = { sub: 'user-1', tenantId: validTenantId, staffId: 'staff-1', role: 'DOCTOR_RESIDENT' };
  const res = {} as Response;

  it('rejects a request with no Authorization header', async () => {
    const middleware = createMiddleware(null);
    await expect(middleware.use(mockRequest({}), res, jest.fn())).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a malformed Authorization header (no Bearer prefix)', async () => {
    const middleware = createMiddleware(null);
    await expect(
      middleware.use(mockRequest({ authorization: 'not-bearer-token' }), res, jest.fn()),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an invalid or expired token', async () => {
    const middleware = createMiddleware(null);
    await expect(
      middleware.use(mockRequest({ authorization: 'Bearer bad-token' }), res, jest.fn()),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a valid token whose tenant no longer exists', async () => {
    const middleware = createMiddleware(null, () => validClaims);
    await expect(
      middleware.use(mockRequest({ authorization: 'Bearer good-token' }), res, jest.fn()),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a valid token for a suspended tenant', async () => {
    const middleware = createMiddleware({ id: validTenantId, status: 'suspended' }, () => validClaims);
    await expect(
      middleware.use(mockRequest({ authorization: 'Bearer good-token' }), res, jest.fn()),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('calls next() with the tenant/staff/role context populated for the rest of the pipeline', async () => {
    const middleware = createMiddleware({ id: validTenantId, name: 'Test Tenant', status: 'active' }, () => validClaims);
    let seenContext: ReturnType<typeof tenantContextStorage.getStore>;
    const next = jest.fn(() => {
      // Simulates the downstream pipeline (guards/interceptors/handler) reading
      // the context — this is the exact propagation the guard-based approach
      // failed to provide, which is why this is middleware, not a guard.
      seenContext = tenantContextStorage.getStore();
    });

    await middleware.use(mockRequest({ authorization: 'Bearer good-token' }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(seenContext).toEqual({
      tenantId: validTenantId,
      userId: 'user-1',
      staffId: 'staff-1',
      role: 'DOCTOR_RESIDENT',
    });
  });
});
