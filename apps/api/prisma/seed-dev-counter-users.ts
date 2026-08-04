import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';

config({ path: join(__dirname, '..', '.env') });

// G4.5d3c-3b2 (D-094) — DEV counter logins.
//
// The Billing Review workspace splits counter work across three tiers
// (front desk / finance / owner), and the dev tenant had no FINANCE_STAFF or
// OWNER_ADMIN login — so the ALLOWED discount and benefit-override paths could
// only ever be proven by unit test, never live. This creates them.
//
// Local development only. Production clinics are NOT required to have a
// finance user: every finance-tier action is also available to OWNER_ADMIN.
//
//   npx tsx prisma/seed-dev-counter-users.ts
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const DEV_TENANT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const PASSWORD = 'DevLocal!2026';

const ACCOUNTS = [
  { email: 'faiz.finance@smoke-test-clinic.test', fullName: 'Faiz Finance', role: 'FINANCE_STAFF' as const },
  { email: 'owner.admin@smoke-test-clinic.test', fullName: 'Nadia Owner', role: 'OWNER_ADMIN' as const },
];

function inTenantScope<T>(fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${DEV_TENANT_ID}, true)`;
    return fn(tx);
  });
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const clinic = await inTenantScope((tx) => tx.clinic.findFirst({ select: { id: true, name: true } }));
  if (!clinic) throw new Error('The dev tenant has no clinic to attach counter staff to.');

  for (const account of ACCOUNTS) {
    await inTenantScope(async (tx) => {
      const existingUser = await tx.user.findFirst({ where: { email: account.email } });
      const user = existingUser
        ? await tx.user.update({ where: { id: existingUser.id }, data: { passwordHash, status: 'active' } })
        : await tx.user.create({
            data: { tenantId: DEV_TENANT_ID, email: account.email, passwordHash, status: 'active' },
          });

      const existingStaff = await tx.staff.findFirst({ where: { userId: user.id } });
      if (existingStaff) {
        await tx.staff.update({
          where: { id: existingStaff.id },
          data: { role: account.role, active: true, clinicId: clinic.id },
        });
      } else {
        await tx.staff.create({
          data: {
            tenantId: DEV_TENANT_ID,
            clinicId: clinic.id,
            userId: user.id,
            fullName: account.fullName,
            role: account.role,
            active: true,
          },
        });
      }
      console.log(`  ${account.role.padEnd(24)} ${account.email}`);
    });
  }
  console.log(`\nAll of the above use password: ${PASSWORD}  (branch: ${clinic.name})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
