import { Client } from 'pg';

/**
 * PHASE 0 — the connection for SYSTEM-LEVEL questions.
 *
 * Owner's architectural decision, 2026-08-13: **boot-time checks must never use
 * request-scoped infrastructure.** The tenant-scoped Prisma client throwing
 * "Tenant context not set" outside a request is CORRECT — the defect was a boot
 * check reaching for it. So boot-time questions get their own short-lived,
 * unscoped connection, which never carries tenant context and may therefore
 * only ever ask things that are true of the DEPLOYMENT rather than of a clinic.
 *
 * WHAT MAY BE ASKED HERE. "Which role am I?", "does this table exist?", "does
 * this database hold any catalogue rows at all?" — deployment facts, counts and
 * metadata. **Never a patient, a visit, or any row belonging to a tenant.** This
 * connection is outside RLS's protection by construction: it has no
 * `app.tenant_id`, so a tenant-scoped query through it would either return
 * nothing (and be read as "empty") or, as the app role, be filtered to nothing
 * while looking like a real answer. Both are worse than not asking.
 *
 * WHY `pg` AND NOT PRISMA. Prisma's client is extended in this app
 * (`tenant-scoped-prisma.provider`) and the extension intercepts operations, so
 * "a raw query on the unextended service" is a distinction that is easy to lose
 * in a refactor — it is what cost a boot crash the first time this was
 * attempted. A separate `pg` client cannot be confused for the request path.
 * `pg` is already a dependency; `PrismaPg` is built on it.
 *
 * SHORT-LIVED. Connect, ask, disconnect. It holds no pool and survives no
 * request, so it cannot become a back door that outlives the check it was
 * written for.
 */
export async function withSystemConnection<T>(
  fn: (query: (sql: string, values?: unknown[]) => Promise<Array<Record<string, unknown>>>) => Promise<T>,
  connectionString = process.env.DATABASE_URL,
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(async (sql, values) => {
      const result = await client.query(sql, values as never);
      return result.rows as Array<Record<string, unknown>>;
    });
  } finally {
    // Released even when the check throws — a refused boot must not also leak a
    // connection into a database that is about to be restarted repeatedly.
    await client.end().catch(() => undefined);
  }
}
