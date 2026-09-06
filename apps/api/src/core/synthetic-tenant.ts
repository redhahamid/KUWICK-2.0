/**
 * IS THIS TENANT A SYNTHETIC UAT ONE, OR SOMEBODY'S CLINIC?
 *
 * The question a maintenance script has to answer before it writes anything to
 * a database it did not create. `prisma/reset-uat-owner.ts` is meant to be run
 * against a REMOTE UAT box, so "is it localhost" proves nothing; what proves
 * something is that every tenant in the database is one a seed in this
 * repository invented.
 *
 * Both UAT seeds mark their tenant: `seed-staging-uat.ts` writes
 * "Kuwick UAT Staging (Synthetic)" and `seed-admin-uat.ts` writes
 * "Klinik Contoh (UAT)". Either marker is accepted; anything else is refused.
 *
 * THE WORD BOUNDARY IS THE WHOLE POINT. The first version of this test matched
 * "uat" as a bare substring, which waves through any clinic whose name happens
 * to contain those three letters — "Klinik Suatu" among them. A guard that
 * fails open on a real clinic's database is worse than no guard, because it is
 * trusted. It lives here, with its own test, rather than inline in a script
 * nothing runs in CI.
 */
const SYNTHETIC_TENANT = /\(synthetic\)|\buat\b/i;

export function isSyntheticTenantName(name: string): boolean {
  return SYNTHETIC_TENANT.test(name);
}
