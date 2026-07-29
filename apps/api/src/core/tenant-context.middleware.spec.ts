import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { tenantContextStorage } from './tenant-context';
import { PrismaService } from './prisma.service';

function mockRequest(headers: Record<string, string>): Request {
  return { header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

function createMiddleware(transactionResult: unknown) {
  const prisma = {
    $transaction: jest.fn().mockResolvedValue(transactionResult),
  } as unknown as PrismaService;
  return new TenantContextMiddleware(prisma);
}

describe('TenantContextMiddleware', () => {
  const validTenantId = '11111111-1111-1111-1111-111111111111';
  const res = {} as Response;

  it('rejects a request with no x-tenant-id header', async () => {
    const middleware = createMiddleware(null);
    await expect(middleware.use(mockRequest({}), res, jest.fn())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a malformed UUID', async () => {
    const middleware = createMiddleware(null);
    await expect(
      middleware.use(mockRequest({ 'x-tenant-id': 'not-a-uuid' }), res, jest.fn()),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a well-formed UUID that matches no tenant', async () => {
    const middleware = createMiddleware(null);
    await expect(
      middleware.use(mockRequest({ 'x-tenant-id': validTenantId }), res, jest.fn()),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('calls next() with the tenant context populated for the rest of the pipeline', async () => {
    const middleware = createMiddleware({ id: validTenantId, name: 'Test Tenant' });
    let seenTenantId: string | undefined;
    const next = jest.fn(() => {
      // Simulates the downstream pipeline (guards/interceptors/handler) reading
      // the context — this is the exact propagation the guard-based approach
      // failed to provide, which is why this is middleware, not a guard.
      seenTenantId = tenantContextStorage.getStore()?.tenantId;
    });

    await middleware.use(mockRequest({ 'x-tenant-id': validTenantId }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(seenTenantId).toBe(validTenantId);
  });
});
