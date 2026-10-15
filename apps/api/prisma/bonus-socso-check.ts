/**
 * ONE-OFF: BONUS AND SOCSO/EIS ON STAGING (owner's decision 5, 15 October 2026).
 *
 * PERKESO counts annual bonus outside "wages", so the standard Bonus item no
 * longer carries SOCSO/EIS. Two jobs, chosen by BONUS_TASK:
 *
 *   REPORT    read-only. For the tenant whose branch is called "Hijraa": the
 *             Bonus item's SOCSO/EIS setting, and every approved or paid
 *             payslip of January–September 2026 where a bonus was in the
 *             SOCSO or EIS wage, with the contribution the bonus added.
 *             Changes nothing.
 *   FIX_DEMO  "Klinik Demo Baru" only: turns SOCSO and EIS off on its Bonus
 *             item. In place while no month has been approved there (the
 *             seeded row nobody has used); refuses otherwise. BONUS_APPLY=true
 *             to write, else a dry run.
 *
 * The extra contribution is SOCSO (Act 4) and EIS on the wage with the bonus
 * minus the same without it, from Kuwick's own built-in tables. LINDUNG 24
 * JAM is a separate scheme and is not counted here.
 *
 * Environment: DATABASE_URL (owner connection), BONUS_TASK, BONUS_APPLY,
 * BONUS_BRANCH (part of the branch name to report on; default "hijraa").
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { eisContribution, socsoContribution } from '../src/statutory/contributions';

const DEMO = 'Klinik Demo Baru';
const rm = (cents: number) => (cents / 100).toFixed(2);
const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);
const asTx = (tx: unknown) => tx as Prisma.TransactionClient;

function computed<T extends { employerCents: number; employeeCents: number }>(outcome: { kind: string; value?: T }) {
  return outcome.kind === 'COMPUTED' && outcome.value ? outcome.value : { employerCents: 0, employeeCents: 0 };
}

async function report(prisma: PrismaClient) {
  await prisma.$transaction(async (raw) => {
    const tx = asTx(raw);
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const tenants = await tx.$queryRaw<{ tenant_id: string; tenant: string; branch: string }[]>`
      SELECT DISTINCT c.tenant_id, t.name AS tenant, c.name AS branch
      FROM clinics c JOIN tenants t ON t.id = c.tenant_id
      WHERE c.name ILIKE ${`%${process.env.BONUS_BRANCH ?? 'hijraa'}%`}`;
    if (tenants.length === 0) {
      console.log('No branch named like "Hijraa" was found. Nothing to report.');
      return;
    }
    for (const tenant of [...new Map(tenants.map((row) => [row.tenant_id, row])).values()]) {
      console.log(`\n=== Tenant "${tenant.tenant}" (branch ${tenants.filter((row) => row.tenant_id === tenant.tenant_id).map((row) => row.branch).join(', ')}) ===`);
      const items = await tx.$queryRaw<{ code: string; name: string; socso_liable: boolean; eis_liable: boolean; effective_from: Date; effective_to: Date | null; active: boolean }[]>`
        SELECT code, name, socso_liable, eis_liable, effective_from, effective_to, active FROM pay_components
        WHERE tenant_id = ${tenant.tenant_id} AND (code = 'BONUS' OR name ILIKE '%bonus%')
        ORDER BY code, effective_from`;
      console.log('Bonus item(s) and their SOCSO/EIS setting, version by version:');
      for (const item of items) {
        console.log(
          `  ${item.code} "${item.name}" from ${item.effective_from.toISOString().slice(0, 10)}${item.effective_to ? ` to ${item.effective_to.toISOString().slice(0, 10)}` : ''}: SOCSO ${item.socso_liable ? 'ON' : 'off'}, EIS ${item.eis_liable ? 'ON' : 'off'}${item.active ? '' : ' (inactive)'}`,
        );
      }
      const codes = [...new Set(items.map((item) => item.code))];
      const lines = await tx.$queryRaw<{ name: string; employee_no: string | null; period: Date; run_type: string; status: string; socso_employee: unknown; socso_employer: unknown; eis_employee: unknown; eis_employer: unknown; breakdown: unknown }[]>`
        SELECT s.full_name AS name, ep.employee_no, r.period, r.run_type::text, r.status::text,
               l.socso_employee, l.socso_employer, l.eis_employee, l.eis_employer, l.breakdown
        FROM payroll_lines l
        JOIN payroll_runs r ON r.id = l.payroll_run_id
        JOIN staff s ON s.id = l.staff_id
        LEFT JOIN employee_profiles ep ON ep.staff_id = l.staff_id
        WHERE l.tenant_id = ${tenant.tenant_id} AND r.status::text IN ('APPROVED', 'PAID')
          AND r.period >= DATE '2026-01-01' AND r.period < DATE '2026-10-01'
        ORDER BY r.period, s.full_name`;
      const liableOn = (code: string, period: Date, scheme: 'socso_liable' | 'eis_liable') => {
        const version = items.find((item) => item.code === code && item.effective_from <= period && (!item.effective_to || item.effective_to > period));
        return Boolean(version?.[scheme]);
      };
      const rows: string[] = [];
      for (const line of lines) {
        const breakdown = (line.breakdown ?? {}) as { components?: { code: string; kind: string; amount: unknown }[]; bases?: { socsoCents?: number; eisCents?: number } };
        const bonus = (breakdown.components ?? []).filter((c) => codes.includes(c.code) && c.kind === 'EARNING');
        const bonusCents = bonus.reduce((sum, c) => sum + cents(c.amount), 0);
        if (bonusCents <= 0) continue;
        const socsoBonus = bonus.filter((c) => liableOn(c.code, line.period, 'socso_liable')).reduce((sum, c) => sum + cents(c.amount), 0);
        const eisBonus = bonus.filter((c) => liableOn(c.code, line.period, 'eis_liable')).reduce((sum, c) => sum + cents(c.amount), 0);
        if (socsoBonus === 0 && eisBonus === 0) continue;
        const socsoBase = Number(breakdown.bases?.socsoCents ?? 0);
        const eisBase = Number(breakdown.bases?.eisCents ?? 0);
        const category = cents(line.socso_employee) > 0 ? 'FIRST' : 'SECOND';
        const sWith = computed(socsoContribution(socsoBase, category as never));
        const sWithout = computed(socsoContribution(Math.max(0, socsoBase - socsoBonus), category as never));
        const eWith = computed(eisContribution(eisBase));
        const eWithout = computed(eisContribution(Math.max(0, eisBase - eisBonus)));
        rows.push(
          [
            line.period.toISOString().slice(0, 7),
            line.run_type,
            line.employee_no ?? '-',
            line.name,
            rm(bonusCents),
            rm(socsoBase),
            `${rm(sWith.employeeCents - sWithout.employeeCents)}/${rm(sWith.employerCents - sWithout.employerCents)}`,
            `${rm(eWith.employeeCents - eWithout.employeeCents)}/${rm(eWith.employerCents - eWithout.employerCents)}`,
            `${rm(cents(line.socso_employee))}/${rm(cents(line.socso_employer))}`,
            `${rm(cents(line.eis_employee))}/${rm(cents(line.eis_employer))}`,
          ].join(' | '),
        );
      }
      console.log(`\nApproved or paid payslips Jan–Sep 2026 with a bonus in the SOCSO/EIS wage: ${rows.length}`);
      if (rows.length > 0) {
        console.log('month | run | emp no | name | bonus RM | SOCSO wage RM | SOCSO from bonus ee/er | EIS from bonus ee/er | SOCSO charged ee/er | EIS charged ee/er');
        for (const row of rows) console.log(row);
      }
    }
  });
}

async function fixDemo(prisma: PrismaClient, apply: boolean) {
  await prisma.$transaction(async (raw) => {
    const tx = asTx(raw);
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const tenant = await tx.tenant.findFirst({ where: { name: { equals: DEMO, mode: 'insensitive' } }, select: { id: true } });
    if (!tenant) throw new Error(`No tenant called "${DEMO}".`);
    const approved = await tx.payrollRun.count({ where: { tenantId: tenant.id, status: { in: ['APPROVED', 'PAID'] } } });
    const bonus = await tx.payComponent.findMany({ where: { tenantId: tenant.id, code: 'BONUS' }, orderBy: { effectiveFrom: 'asc' } });
    console.log(`"${DEMO}": ${bonus.length} Bonus version(s); approved or paid months: ${approved}.`);
    for (const row of bonus) console.log(`  from ${row.effectiveFrom.toISOString().slice(0, 10)}: SOCSO ${row.socsoLiable ? 'ON' : 'off'}, EIS ${row.eisLiable ? 'ON' : 'off'}`);
    if (approved > 0) throw new Error('A month is approved here, so the Bonus item must be changed as a dated version on Payroll items, not in place. Nothing changed.');
    const toChange = bonus.filter((row) => row.socsoLiable || row.eisLiable);
    if (toChange.length === 0) {
      console.log('Bonus already has SOCSO and EIS off. Nothing to do.');
      return;
    }
    if (!apply) {
      console.log(`DRY RUN: would turn SOCSO and EIS off on ${toChange.length} Bonus version(s). Nothing changed.`);
      return;
    }
    for (const row of toChange) {
      await tx.payComponent.update({
        where: { id: row.id },
        data: {
          socsoLiable: false,
          eisLiable: false,
          changeReason: 'Annual bonus is not wages for SOCSO or EIS (PERKESO). Owner decision, 15 October 2026; no month approved yet.',
        },
      });
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: null,
          action: 'payComponent.changed',
          entityType: 'PayComponent',
          entityId: row.id,
          before: { socsoLiable: row.socsoLiable, eisLiable: row.eisLiable } as never,
          after: { socsoLiable: false, eisLiable: false, _reason: 'Bonus is not wages for SOCSO/EIS (PERKESO); owner decision 15 Oct 2026', _source: 'one-off script bonus-socso-check.ts' } as never,
        },
      });
    }
    console.log(`Turned SOCSO and EIS off on ${toChange.length} Bonus version(s) of "${DEMO}".`);
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const task = process.env.BONUS_TASK;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    if (task === 'REPORT') await report(prisma);
    else if (task === 'FIX_DEMO') await fixDemo(prisma, process.env.BONUS_APPLY === 'true');
    else throw new Error('BONUS_TASK must be REPORT or FIX_DEMO.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
