/**
 * ONE-OFF: AN EMPTY CLINIC FOR A NEW-CLINIC TEST, ON STAGING (overnight
 * brief, 15 October 2026): "create an empty tenant "Klinik Demo Baru" with one
 * owner login for me and no staff, payroll or settings. Do not touch "Klinik
 * Contoh (UAT)"."
 *
 * Made exactly as the platform console makes a new clinic
 * (`PlatformTenantService.create`): the tenant, its first branch and the
 * standard default lists every new clinic gets. Then one owner login. No
 * employees, payroll, HR settings or trial subscription.
 *
 * Safe to press twice: if a tenant of that name exists it changes nothing.
 * It writes only rows of the new tenant. The password never reaches this
 * script: DEMO_OWNER_PASSWORD_HASH is a bcrypt hash made beforehand.
 *
 * Environment: DATABASE_URL (owner connection), DEMO_TENANT_NAME (default
 * "Klinik Demo Baru"), DEMO_OWNER_EMAIL,
 * DEMO_OWNER_PASSWORD_HASH, DEMO_APPLY=true to create (else a dry run).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PlatformTenantService } from '../src/auth/platform-tenant.service';

// "Klinik Demo Baru 2" for a second new-clinic test (owner's decision 7, 15 October 2026).
const NAME = (process.env.DEMO_TENANT_NAME ?? '').trim() || 'Klinik Demo Baru';

async function main() {
  const url = process.env.DATABASE_URL;
  const email = (process.env.DEMO_OWNER_EMAIL ?? '').trim().toLowerCase();
  const hash = process.env.DEMO_OWNER_PASSWORD_HASH ?? '';
  const apply = process.env.DEMO_APPLY === 'true';
  if (!url) throw new Error('DATABASE_URL is not set.');
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) throw new Error('DEMO_OWNER_EMAIL is not an email address.');
  if (!/^\$2[aby]\$1[0-2]\$.{53}$/.test(hash)) throw new Error('DEMO_OWNER_PASSWORD_HASH is not a bcrypt hash.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const existing = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      return tx.tenant.findMany({ where: { name: { equals: NAME, mode: 'insensitive' } }, select: { id: true, slug: true } });
    });
    if (existing.length > 0) {
      console.log(`"${NAME}" already exists (slug ${existing.map((row) => row.slug).join(', ')}). Nothing changed.`);
      return;
    }
    if (!apply) {
      console.log(`DRY RUN: would create tenant "${NAME}", its first branch "${NAME}", the default lists and one owner login (${email}). Nothing changed.`);
      return;
    }

    const tenant = await new PlatformTenantService(prisma as never).create({ name: NAME } as never);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      const clinic = await tx.clinic.findFirstOrThrow({ where: { tenantId: tenant.id } });
      const user = await tx.user.create({ data: { tenantId: tenant.id, email, passwordHash: hash } });
      await tx.staff.create({
        data: { tenantId: tenant.id, userId: user.id, role: 'OWNER_ADMIN', fullName: 'Pemilik Demo', clinicId: clinic.id },
      });
    });
    const counts = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return {
        branches: await tx.clinic.count({ where: { tenantId: tenant.id } }),
        staff: await tx.staff.count({ where: { tenantId: tenant.id } }),
        employeeRecords: await tx.employeeProfile.count({ where: { tenantId: tenant.id } }),
        payrollRuns: await tx.payrollRun.count({ where: { tenantId: tenant.id } }),
      };
    });
    console.log(`Created "${NAME}" (slug ${tenant.slug}): ${JSON.stringify(counts)}. Owner login: ${email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
