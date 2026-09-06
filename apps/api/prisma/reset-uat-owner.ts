import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { config } from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { isSyntheticTenantName } from '../src/core/synthetic-tenant';

config({ path: join(__dirname, '..', '.env') });

/**
 * RECOVER THE SYNTHETIC UAT OWNER LOGIN — and nothing else.
 *
 * Why this exists. `seed-staging-uat.ts` prints its password ONCE and never
 * stores it anywhere, which is the right call: a UAT password committed to a
 * repository is a UAT password in every fork of it. The cost is that losing
 * that one line locks the owner out of an environment full of perfectly good
 * synthetic data, and the only tool in the repository for getting back in was
 * the seed itself — which rebuilds patients, visits, invoices and stock
 * positions on its way past. Re-running a whole world to fix one password is
 * how UAT findings get erased mid-review.
 *
 * So this script touches TWO ROWS: the owner's `users` row and the `staff` row
 * behind it. It creates nothing else, deletes nothing at all, and does not so
 * much as read a patient. Every other account keeps the password it has.
 *
 *   KUWICK_UAT_OWNER_RESET=yes npx tsx prisma/reset-uat-owner.ts
 *
 * The password comes from UAT_OWNER_PASSWORD, or is generated and printed once
 * at the end. The hash is never printed, logged or returned.
 */

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

/**
 * ONE TRANSACTION, WITH THE SAME NARROW RLS BYPASS THE STAGING SEED USES.
 *
 * `tenants` is FORCE RLS against its own id, so a session that does not yet
 * claim a tenant cannot even SEE one — the guard below would read an empty
 * table and cheerfully conclude the database is safe. `app.bypass_tenant_scope`
 * is set with `set_config(..., true)`, which is LOCAL to this transaction and
 * gone the moment it ends (DECISIONS.md: a session GUC scoped to a single
 * transaction, chosen over granting the app role BYPASSRLS, which would have
 * disabled RLS on every connection forever).
 *
 * Everything this script does happens inside it, so a failure half way through
 * leaves the account exactly as it found it.
 */
async function bypassing<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_tenant_scope', 'true', true)`);
    return fn(tx);
  });
}

/**
 * The owner `seed-staging-uat.ts` creates. Recovering THAT account rather than
 * minting a second one is the point: two owner logins for one UAT environment
 * is two answers to "who is the owner here", and the guide would then have to
 * explain which one is real.
 */
const DEFAULT_EMAIL = 'owner@uat.kuwick.invalid';

/**
 * RFC 2606 reserves `.invalid`, and every synthetic account in this repository
 * lives there. Refusing anything else is what stops this script from being
 * pointed at a real person's login on a real clinic's database.
 */
function assertSyntheticEmail(email: string): void {
  if (!email.toLowerCase().endsWith('.invalid')) {
    throw new Error(
      `Refusing to touch ${email}: this script only resets SYNTHETIC accounts, whose addresses end in the ` +
        'reserved .invalid TLD. A real address here would mean this is pointed at a real clinic.',
    );
  }
}

/**
 * Refuse to run anywhere this could reach a real clinic.
 *
 * Same shape as the staging seed's guard and for the same reason: this is
 * MEANT to run against a remote database, so "is it localhost" proves nothing.
 * What proves something is that every tenant in the database is a synthetic
 * one — a real clinic's database fails this on its first row.
 */
async function assertSafeToReset(tx: Prisma.TransactionClient): Promise<{ tenantId: string; tenantName: string }> {
  const problems: string[] = [];
  if (process.env.NODE_ENV === 'production') problems.push('NODE_ENV is production');
  if (process.env.KUWICK_UAT_OWNER_RESET !== 'yes') problems.push('KUWICK_UAT_OWNER_RESET is not "yes"');
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL is not set');
  if (problems.length > 0) {
    throw new Error(`Refusing to run:\n  - ${problems.join('\n  - ')}`);
  }

  const tenants = await tx.$queryRawUnsafe<{ id: string; name: string; status: string }[]>(
    `SELECT id, name, status FROM tenants`,
  );
  if (tenants.length === 0) throw new Error('No tenant in this database — run the seed first, not this.');

  // One definition of "is this a synthetic tenant", in src/core with its own
  // test, rather than a regex written inline in a script nothing runs in CI.
  const real = tenants.filter((t) => !isSyntheticTenantName(t.name));
  if (real.length > 0) {
    throw new Error(
      `Refusing to run: ${real.length} tenant(s) here are not marked synthetic — ` +
        `${real.map((t) => `"${t.name}"`).join(', ')}. This looks like a real database.`,
    );
  }
  if (tenants.length > 1) {
    throw new Error(
      `Refusing to guess: ${tenants.length} synthetic tenants in this database. ` +
        'Point DATABASE_URL at one UAT environment at a time.',
    );
  }
  return { tenantId: tenants[0].id, tenantName: tenants[0].name };
}

async function main(): Promise<void> {
  const email = (process.env.UAT_OWNER_EMAIL ?? DEFAULT_EMAIL).trim().toLowerCase();
  assertSyntheticEmail(email);

  // Generated rather than defaulted when unset: a password constant in a
  // repository is not a password.
  const password = process.env.UAT_OWNER_PASSWORD ?? `Uat!${randomBytes(9).toString('base64url')}`;
  const passwordHash = await bcrypt.hash(password, 10);

  const { tenantName, branchName, existed } = await bypassing(async (tx) => {
    const { tenantId, tenantName } = await assertSafeToReset(tx);

    // Every UAT environment in this repository is single-clinic or has an
    // obvious first branch; the owner belongs to it. `staff.clinicId` is where
    // a person WORKS — it does not narrow what an owner may administer, which
    // is decided by permissions (core/branch-scope.ts resolves an account
    // holding `settings.manage` to every branch).
    const clinic = await tx.$queryRawUnsafe<{ id: string; name: string }[]>(
      `SELECT id, name FROM clinics WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`,
      tenantId,
    );
    if (clinic.length === 0) throw new Error('No clinic in this tenant — run the seed first, not this.');

    const before = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM users WHERE tenant_id = $1 AND lower(email) = $2`,
      tenantId,
      email,
    );
    const existed = before.length > 0;

    // ONE user row and ONE staff row. Written as explicit statements rather
    // than an upsert-everything helper so that what this touches is readable
    // at a glance by whoever has to approve running it against a live UAT box.
    const userId = existed
      ? before[0].id
      : (
          await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO users (id, tenant_id, email, password_hash, status, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, 'active', now(), now())
             RETURNING id`,
            tenantId,
            email,
            passwordHash,
          )
        )[0].id;

    if (existed) {
      await tx.$executeRawUnsafe(
        `UPDATE users SET password_hash = $1, status = 'active', updated_at = now() WHERE id = $2`,
        passwordHash,
        userId,
      );
    }

    // The login also needs an ACTIVE staff row: auth.service.ts refuses a user
    // with none, and OWNER_ADMIN is what carries the owner's capability through
    // LEGACY_ROLE_FALLBACK (OWNER + ADMINISTRATOR) in core/permissions.ts.
    const staff = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM staff WHERE tenant_id = $1 AND user_id = $2`,
      tenantId,
      userId,
    );
    if (staff.length > 0) {
      await tx.$executeRawUnsafe(
        `UPDATE staff SET role = 'OWNER_ADMIN', active = true, clinic_id = $1, updated_at = now() WHERE id = $2`,
        clinic[0].id,
        staff[0].id,
      );
    } else {
      await tx.$executeRawUnsafe(
        `INSERT INTO staff (id, tenant_id, user_id, role, full_name, active, clinic_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 'OWNER_ADMIN', $3, true, $4, now(), now())`,
        tenantId,
        userId,
        'UAT Owner (Synthetic)',
        clinic[0].id,
      );
    }

    return { tenantName, branchName: clinic[0].name, existed };
  });

  console.log('');
  console.log(`Synthetic UAT owner ${existed ? 'RESET' : 'CREATED'} — nothing else was touched.`);
  console.log(`  tenant  : ${tenantName}`);
  console.log(`  branch  : ${branchName}`);
  console.log(`  email   : ${email}`);
  console.log(`  password: ${password}`);
  console.log('');
  console.log('Store the password now — it is not written anywhere and cannot be read back.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
