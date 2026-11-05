/**
 * READ ONLY: TWO QUESTIONS ABOUT THE HIJRAA TENANT (owner, 5 November 2026).
 *
 * 1. Did the weekly locum pay ("Locum fee" / LOCUM_FEE, the hours above the
 *    weekly normal priced from roster and attendance) go through payroll in
 *    the Jan–Sep 2026 test, and is it still there? Counts and totals per
 *    month, from the payroll inputs and from the payslip lines of each run.
 *    No names in this part.
 * 2. Who has a start date of 1 January 2026, so HR can correct it from the
 *    contracts. Names are printed: the log is deleted once read.
 *
 * Writes nothing. Environment: DATABASE_URL (admin connection).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const rm = (value: unknown) => `RM ${Number(value ?? 0).toFixed(2)}`;
const month = (date: Date) => date.toISOString().slice(0, 7);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required.');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  const tenants = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRaw<{ id: string; name: string }[]>`
      SELECT DISTINCT t.id, t.name FROM tenants t JOIN clinics c ON c.tenant_id = t.id WHERE c.name ILIKE '%hijraa%'`;
  });
  if (tenants.length !== 1) throw new Error(`Expected exactly one tenant holding the Hijraa branch, found ${tenants.length}.`);
  const tenantId = tenants[0].id;

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      console.log(`Tenant: ${tenants[0].name}. Read only.\n`);

      console.log('1. LOCUM FEE (LOCUM_FEE) IN 2026');
      const inputs = await tx.payrollInputEntry.findMany({
        where: { tenantId, componentCode: 'LOCUM_FEE', period: { gte: new Date('2026-01-01'), lt: new Date('2027-01-01') } },
        select: { period: true, staffId: true, amount: true, source: true },
      });
      const byMonth = new Map<string, { people: Set<string>; total: number; sources: Set<string> }>();
      for (const row of inputs) {
        const key = month(row.period);
        const entry = byMonth.get(key) ?? { people: new Set(), total: 0, sources: new Set() };
        entry.people.add(row.staffId);
        entry.total += Number(row.amount);
        entry.sources.add(row.source);
        byMonth.set(key, entry);
      }
      console.log('Payroll inputs:  month | people | total | source');
      for (const [key, entry] of [...byMonth.entries()].sort()) {
        console.log(`  ${key} | ${entry.people.size} | ${rm(entry.total)} | ${[...entry.sources].join(', ')}`);
      }
      if (byMonth.size === 0) console.log('  none');

      const runs = await tx.$queryRaw<{ period: Date; status: string; lines: bigint; with_locum: bigint }[]>`
        SELECT r.period, r.status::text AS status, COUNT(l.id) AS lines,
               COUNT(l.id) FILTER (WHERE l.breakdown::text LIKE '%LOCUM_FEE%') AS with_locum
        FROM payroll_runs r LEFT JOIN payroll_lines l ON l.payroll_run_id = r.id
        WHERE r.tenant_id = ${tenantId} AND r.period >= '2026-01-01' AND r.period < '2027-01-01'
        GROUP BY r.id, r.period, r.status ORDER BY r.period`;
      console.log('Payroll runs:  month | status | payslips | payslips with a locum fee line');
      for (const run of runs) console.log(`  ${month(run.period)} | ${run.status} | ${run.lines} | ${run.with_locum}`);
      if (runs.length === 0) console.log('  none');

      const contractors = await tx.employeeProfile.count({ where: { tenantId, engagement: 'CONTRACTOR' } });
      const sessions = await tx.locumSession.count({ where: { tenantId } });
      console.log(`People engaged as contractors: ${contractors}. Locum sessions recorded (Finance route): ${sessions}.\n`);

      console.log('2. START DATE 1 JANUARY 2026 (for HR to check against contracts; nothing is changed)');
      const people = await tx.employeeProfile.findMany({
        where: { tenantId, startDate: new Date('2026-01-01') },
        select: {
          employeeNo: true,
          position: true,
          employmentStatus: true,
          staff: { select: { fullName: true, active: true, clinic: { select: { name: true } } } },
        },
        orderBy: { staff: { fullName: 'asc' } },
      });
      console.log(['No.', 'Name', 'Employee no.', 'Branch', 'Job', 'Status'].join(' | '));
      people.forEach((person, index) =>
        console.log(
          [
            index + 1,
            person.staff.fullName,
            person.employeeNo ?? '—',
            person.staff.clinic?.name ?? '—',
            person.position ?? '—',
            `${person.employmentStatus}${person.staff.active ? '' : ', account inactive'}`,
          ].join(' | '),
        ),
      );
      console.log(`${people.length} people.`);
    },
    { timeout: 60_000 },
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
