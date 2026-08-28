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

/**
 * The same, as the MIGRATION OWNER rather than the application role.
 *
 * Needed for exactly one thing: clearing append-only tables between tests.
 * `audit_logs`, `stock_movements`, `payments` and `claim_events` have their
 * DELETE grant revoked from the application role on purpose, so a fixture that
 * writes one cannot tidy it up afterwards — and an audit row holds a foreign
 * key to its tenant, which then cannot be deleted either.
 *
 * Row-level security still applies (the tables are FORCE'd, so ownership does
 * not exempt this connection), so it must still be used inside
 * `withTenantContext`. It is a way past the GRANT, not past the policy.
 */
export function createOwnerTestPrismaClient(): PrismaClient {
  const url = process.env.TEST_OWNER_DATABASE_URL ?? process.env.DATABASE_URL;
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
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

/**
 * A BOOKING DATE THAT DOES NOT ROT.
 *
 * The appointment suites book slots, and the booking rules refuse the past.
 * They used to hardcode a Wednesday in August 2026 — which passed every run
 * until that Wednesday arrived, after which every booking in three suites
 * started coming back 422 for a reason that had nothing to do with the code
 * under test.
 *
 * So the date moves with the clock instead: the next occurrence of a fixed
 * weekday, at least a week out. Far enough ahead that no minimum-notice or
 * advance-booking rule rejects it, and always the SAME weekday, so a roster
 * row keyed on `dayOfWeek` still lines up with the slot being booked.
 *
 * Returns 'YYYY-MM-DD' in UTC, which is what these suites interpolate into
 * their scheduledStart/scheduledEnd strings.
 */
export function upcomingWeekday(dayOfWeek: number, minDaysAhead = 7): string {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + minDaysAhead);
  while (day.getUTCDay() !== dayOfWeek) {
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return day.toISOString().slice(0, 10);
}
