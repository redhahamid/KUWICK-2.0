/**
 * ONE-OFF: "STANDARD LEAVE" FOR THE STAFF IN THE HIJRAA TENANT WHO HAVE NO
 * LEAVE POLICY (owner's instruction, 3 November 2026).
 *
 * Only the tenant that holds the Hijraa branch ("Klinik Contoh (UAT)"), and
 * only people in it with no leave policy: each is put on the policy named
 * "Standard leave" (made from the tenant's leave types if it has none).
 * Nothing else is changed: no employee numbers, no other policy, no balance.
 *
 * Then, for HR to compare with each contract, every one of those people with
 * their branch, start date, completed years of service and the annual leave
 * Kuwick now gives them for this year, worked out exactly as the Leave page
 * does (the policy's days, never below the Act's minimum for their service,
 * pro-rated in the year they joined, the clinic's rounding). The log names
 * staff: it is deleted once read.
 *
 * Environment: DATABASE_URL (admin connection), HIJRAA_APPLY=true to write
 * (else a dry run that changes nothing and still prints the list as it would be).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { LEAVE_RULES_SETTING, leaveKinds, leaveRulesOf, proRatesOnJoin, statutoryFloor, yearsOfServiceAt } from '../src/hr/leave-types';
import { proRateEntitlement } from '../src/workforce/leave-balance';
import { STANDARD_LEAVE_POLICY, standardLeavePolicyId } from '../src/workforce/new-staff-defaults';

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : 'not recorded');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required.');
  const apply = process.env.HIJRAA_APPLY === 'true';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  const tenants = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRaw<{ id: string; name: string }[]>`
      SELECT DISTINCT t.id, t.name FROM tenants t JOIN clinics c ON c.tenant_id = t.id WHERE c.name ILIKE '%hijraa%'`;
  });
  if (tenants.length !== 1) throw new Error(`Expected exactly one tenant holding the Hijraa branch, found ${tenants.length}. Nothing done.`);
  const tenant = tenants[0];
  const year = new Date().getUTCFullYear();

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      const tenantId = tenant.id;
      const policies = await tx.leavePolicy.findMany({ where: { tenantId }, select: { name: true, active: true, _count: { select: { employees: true } } } });
      console.log(`${apply ? 'APPLYING' : 'DRY RUN (nothing is written)'} — ${tenant.name}.`);
      console.log(`Leave policies there now: ${policies.map((p) => `${p.name}${p.active ? '' : ' (off)'}: ${p._count.employees}`).join('; ') || 'none'}.`);

      const people = await tx.employeeProfile.findMany({
        where: { tenantId, leavePolicyId: null },
        select: {
          id: true,
          staffId: true,
          startDate: true,
          endDate: true,
          employeeNo: true,
          staff: { select: { fullName: true, active: true, clinic: { select: { name: true } } } },
        },
        orderBy: [{ startDate: { sort: 'asc', nulls: 'last' } }],
      });
      console.log(`People with no leave policy: ${people.length}.`);
      if (people.length === 0) return;

      const hadStandard = policies.some((p) => p.name === STANDARD_LEAVE_POLICY);
      // A dry run reads the policy as it would be: the existing one, or the tenant's leave types.
      const policyId = apply ? await standardLeavePolicyId(tx, tenantId) : null;
      if (apply) {
        const done = await tx.employeeProfile.updateMany({ where: { id: { in: people.map((p) => p.id) } , leavePolicyId: null }, data: { leavePolicyId: policyId } });
        console.log(`${hadStandard ? 'Assigned' : 'Made "Standard leave" from the tenant’s leave types and assigned'} it to ${done.count} people. Nothing else changed.`);
      } else {
        console.log(hadStandard ? 'Would assign the existing "Standard leave".' : 'Would make "Standard leave" from the tenant’s leave types, then assign it.');
      }

      const standard = await tx.leavePolicy.findFirst({ where: { tenantId, name: STANDARD_LEAVE_POLICY }, include: { entitlements: true } });
      const kinds = leaveKinds(await tx.leaveTypeSetting.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } }));
      const annualKind = kinds.find((kind) => kind.code === 'ANNUAL');
      const policyDays = standard
        ? Number(standard.entitlements.find((row) => row.leaveType === 'ANNUAL')?.daysPerYear ?? annualKind?.daysPerYear ?? 0)
        : Number(annualKind?.daysPerYear ?? 0);
      const proRateOnJoin = standard ? standard.proRateOnJoin : true;
      const rules = leaveRulesOf((await tx.globalSetting.findUnique({ where: { tenantId_key: { tenantId, key: LEAVE_RULES_SETTING } } }))?.value);
      const stored = await tx.leaveBalance.findMany({
        where: { tenantId, staffId: { in: people.map((p) => p.staffId) }, leaveType: 'ANNUAL', benefitYear: year },
        select: { staffId: true, entitledDays: true },
      });
      const fixed = new Map(stored.filter((row) => row.entitledDays !== null).map((row) => [row.staffId, Number(row.entitledDays)]));

      console.log(`\nStandard leave gives ${policyDays} days of annual leave a year; never less than the Act (8 under 2 years, 12 from 2, 16 from 5).`);
      console.log(`Years of service are completed years on 1 January ${year}, as Kuwick counts them.\n`);
      console.log(['No.', 'Name', 'Branch', 'Started', 'Years', `Annual a year`, `${year} entitlement`, 'Note'].join(' | '));
      people.forEach((person, index) => {
        const years = yearsOfServiceAt(person.startDate, year);
        const fullYear = Math.max(policyDays, statutoryFloor('ANNUAL', years));
        const proRate = proRateOnJoin && proRatesOnJoin('ANNUAL') && !rules.notProRated.includes('ANNUAL');
        const keyed = fixed.get(person.staffId);
        const thisYear =
          keyed !== undefined ? keyed : proRate ? proRateEntitlement(fullYear, year, person.startDate, person.endDate, rules.rounding === 'WHOLE' ? 1 : 0.5) : fullYear;
        const notes = [
          keyed !== undefined ? 'entitlement fixed by HR on the balance' : null,
          fullYear > policyDays ? 'Act minimum for service applies' : null,
          person.endDate ? `left ${day(person.endDate)}` : null,
          !person.staff.active ? 'account inactive' : null,
          !person.startDate ? 'no start date: counted as under 2 years' : null,
        ].filter(Boolean);
        console.log(
          [index + 1, person.staff.fullName, person.staff.clinic?.name ?? '—', day(person.startDate), years, `${fullYear} days`, `${thisYear} days`, notes.join('; ') || '—'].join(' | '),
        );
      });
    },
    { timeout: 60_000 },
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
