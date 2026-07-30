import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';

// A raw, unscoped PrismaClient against whatever DATABASE_URL currently
// resolves to (kuwick_test, via setup-env.ts) — deliberately bypasses
// TENANT_SCOPED_PRISMA so fixture setup and the RLS spec can control
// app.tenant_id explicitly, including "not set at all."
export function createTestPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
}

// Mirrors the pattern in core/tenant-context.middleware.ts and
// core/tenant-scoped-prisma.provider.ts: runs `fn` inside a transaction
// with app.tenant_id set, so RLS scopes it exactly as a real request would.
export async function withTenantContext<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

export function randomId(): string {
  return randomUUID();
}
