/**
 * ONE-OFF: A NEW PASSWORD FOR THE OWNER OF THE DEMO CLINIC "KLINIK PANDUAN"
 * (Payroll A–Z guide, 3 November 2026), so three screenshots can be taken
 * again on staging. Only that tenant, only its one owner login
 * pemilik@klinikpanduan.kuwick.test; anything else and it refuses.
 *
 * The password never reaches this script: GUIDE_OWNER_PASSWORD_HASH is a
 * bcrypt hash made beforehand. Environment: DATABASE_URL (owner connection).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const TENANT = 'Klinik Panduan';
const EMAIL = 'pemilik@klinikpanduan.kuwick.test';

async function main() {
  const url = process.env.DATABASE_URL;
  const hash = process.env.GUIDE_OWNER_PASSWORD_HASH ?? '';
  if (!url) throw new Error('DATABASE_URL is not set.');
  if (!/^\$2[aby]\$1[0-2]\$.{53}$/.test(hash)) throw new Error('GUIDE_OWNER_PASSWORD_HASH is not a bcrypt hash.');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      const tenants = await tx.tenant.findMany({ where: { name: TENANT }, select: { id: true } });
      if (tenants.length !== 1) throw new Error(`Expected one tenant named ${TENANT}, found ${tenants.length}. Nothing changed.`);
      const done = await tx.user.updateMany({ where: { tenantId: tenants[0].id, email: EMAIL }, data: { passwordHash: hash } });
      if (done.count !== 1) throw new Error(`Expected one login ${EMAIL} in ${TENANT}, found ${done.count}. Nothing changed.`);
    });
    console.log(`New password set for ${EMAIL} (${TENANT} only).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
