import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';

config({ path: join(__dirname, '..', '.env') });

// One-off setup for real auth (D-034) on this dev environment: sets a slug
// on the existing seeded tenant, creates the first PlatformAdmin (there's
// no signup flow — someone has to exist to log in), and links a User+
// password to one existing Staff row so the login flow is testable end to
// end. Run: `npx tsx prisma/seed-auth.ts`.
//
// FORCE ROW LEVEL SECURITY applies even to the tenants table itself — a row
// is only visible when app.tenant_id already equals that row's own id — so
// every tenant-scoped read/write here runs inside a transaction that sets
// the session variable first, same pattern as
// core/tenant-scoped-prisma.provider.ts and seed-icd10.ts.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const DEV_TENANT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const DEV_TENANT_SLUG = 'smoke-test-clinic';
const STAFF_LOGIN_EMAIL = 'amira.rahman@smoke-test-clinic.test';
const PLATFORM_ADMIN_EMAIL = 'owner@kuwick.dev';

function randomPassword(): string {
  return randomBytes(9).toString('base64url');
}

async function inTenantScope<T>(fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${DEV_TENANT_ID}, true)`;
    return fn(tx);
  });
}

async function main() {
  const staffPassword = randomPassword();
  const platformAdminPassword = randomPassword();

  await inTenantScope((tx) => tx.tenant.update({ where: { id: DEV_TENANT_ID }, data: { slug: DEV_TENANT_SLUG } }));

  const staff = await inTenantScope((tx) =>
    tx.staff.findFirst({ where: { tenantId: DEV_TENANT_ID, fullName: 'Dr. Amira Rahman' } }),
  );
  if (!staff) {
    throw new Error('Dr. Amira Rahman staff row not found in the dev tenant — nothing to link a login to');
  }

  const staffPasswordHash = await bcrypt.hash(staffPassword, 10);
  const existingUser = staff.userId
    ? await inTenantScope((tx) => tx.user.findUnique({ where: { id: staff.userId! } }))
    : null;
  if (existingUser) {
    await inTenantScope((tx) =>
      tx.user.update({ where: { id: existingUser.id }, data: { passwordHash: staffPasswordHash, status: 'active' } }),
    );
  } else {
    const user = await inTenantScope((tx) =>
      tx.user.create({
        data: { tenantId: DEV_TENANT_ID, email: STAFF_LOGIN_EMAIL, passwordHash: staffPasswordHash, status: 'active' },
      }),
    );
    await inTenantScope((tx) => tx.staff.update({ where: { id: staff.id }, data: { userId: user.id } }));
  }

  // PlatformAdmin has no tenantId/RLS at all (D-034) — plain queries, no
  // session-variable dance needed.
  const platformAdminPasswordHash = await bcrypt.hash(platformAdminPassword, 10);
  const existingAdmin = await prisma.platformAdmin.findUnique({ where: { email: PLATFORM_ADMIN_EMAIL } });
  if (existingAdmin) {
    await prisma.platformAdmin.update({
      where: { id: existingAdmin.id },
      data: { passwordHash: platformAdminPasswordHash, active: true },
    });
  } else {
    await prisma.platformAdmin.create({
      data: { email: PLATFORM_ADMIN_EMAIL, passwordHash: platformAdminPasswordHash, fullName: 'Platform Owner' },
    });
  }

  console.log('--- Dev auth credentials (change these before using anywhere but local dev) ---');
  console.log(`Clinic login:   slug=${DEV_TENANT_SLUG}  email=${STAFF_LOGIN_EMAIL}  password=${staffPassword}`);
  console.log(`Platform admin: email=${PLATFORM_ADMIN_EMAIL}  password=${platformAdminPassword}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
