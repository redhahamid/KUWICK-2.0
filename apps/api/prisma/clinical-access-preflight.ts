import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: join(__dirname, '..', '.env') });

// C0 closure (D-051) — PRE-DEPLOYMENT clinical-access preflight.
//
// C0 makes branch access fail closed: a null home branch no longer means "all
// branches". Run this BEFORE deploying to any environment with real data and
// resolve every row it flags — otherwise an active doctor can silently lose
// the ability to write clinical records the moment C0 ships.
//
// Read-only. It changes nothing and assigns no branches: an unassigned doctor
// is a decision for the clinic owner to record, not for a script to guess.
//
// Run: npx tsx prisma/clinical-access-preflight.ts
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const DOCTOR_ROLES = ['DOCTOR_RESIDENT', 'DOCTOR_LOCUM'];
const CLINICAL_ROLES = [...DOCTOR_ROLES, 'FRONT_DESK_CLINICAL_STAFF', 'OWNER_ADMIN'];

interface Row {
  tenant: string;
  tenantId: string;
  staffId: string;
  fullName: string;
  role: string;
  clinicId: string | null;
  branchCount: number;
  explicitGrants: number;
}

function classify(row: Row): { status: 'OK' | 'ACTION REQUIRED'; reason: string } {
  if (row.branchCount <= 1) {
    return { status: 'OK', reason: 'single-branch tenant — branch auto-resolves' };
  }
  if (row.clinicId) {
    return { status: 'OK', reason: 'home branch assigned' };
  }
  if (row.explicitGrants > 0) {
    return { status: 'OK', reason: `relies on ${row.explicitGrants} explicit UserClinicAccess grant(s)` };
  }
  return {
    status: 'ACTION REQUIRED',
    reason: 'no home branch in a multi-branch tenant — WILL LOSE clinical access after deployment',
  };
}

async function main() {
  const tenants = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  });

  const rows: Row[] = [];
  for (const tenant of tenants) {
    const data = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      const branchCount = await tx.clinic.count();
      const staff = await tx.staff.findMany({
        where: { active: true, role: { in: CLINICAL_ROLES as never } },
        select: { id: true, fullName: true, role: true, clinicId: true, userId: true },
        orderBy: { fullName: 'asc' },
      });
      const grants = await Promise.all(
        staff.map((s) => (s.userId ? tx.userClinicAccess.count({ where: { userId: s.userId } }) : Promise.resolve(0))),
      );
      return { branchCount, staff, grants };
    });

    data.staff.forEach((s, i) => {
      rows.push({
        tenant: tenant.name,
        tenantId: tenant.id,
        staffId: s.id,
        fullName: s.fullName,
        role: s.role,
        clinicId: s.clinicId,
        branchCount: data.branchCount,
        explicitGrants: data.grants[i],
      });
    });
  }

  const classified = rows.map((r) => ({ ...r, ...classify(r) }));
  const blocked = classified.filter((r) => r.status === 'ACTION REQUIRED');
  const grantReliant = classified.filter((r) => r.reason.startsWith('relies on'));
  const doctorsNoBranch = classified.filter((r) => DOCTOR_ROLES.includes(r.role) && r.clinicId === null);

  console.log('='.repeat(78));
  console.log('CLINICAL ACCESS PREFLIGHT (C0 / D-051) — run before deploying fail-closed branch access');
  console.log('='.repeat(78));
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Active clinical staff examined: ${classified.length} across ${tenants.length} tenant(s)\n`);

  console.log('--- ACTIVE DOCTORS WITH NO HOME BRANCH -------------------------------------');
  if (doctorsNoBranch.length === 0) {
    console.log('  (none)');
  } else {
    for (const r of doctorsNoBranch) {
      console.log(`  ${r.fullName} [${r.role}] — ${r.tenant} (${r.branchCount} branch(es)) → ${r.status}: ${r.reason}`);
    }
  }

  console.log('\n--- USERS RELYING ON EXPLICIT BRANCH GRANTS --------------------------------');
  if (grantReliant.length === 0) {
    console.log('  (none)');
  } else {
    for (const r of grantReliant) {
      console.log(`  ${r.fullName} [${r.role}] — ${r.tenant}: ${r.reason}`);
    }
  }

  console.log('\n--- WOULD LOSE CLINICAL ACCESS AFTER DEPLOYMENT ----------------------------');
  if (blocked.length === 0) {
    console.log('  (none) — safe to deploy');
  } else {
    for (const r of blocked) {
      console.log(`  !! ${r.fullName} [${r.role}] — ${r.tenant}`);
      console.log(`     staffId=${r.staffId}  tenantId=${r.tenantId}  branches=${r.branchCount}`);
      console.log(`     Resolve by assigning a home branch, granting explicit UserClinicAccess,`);
      console.log(`     or deactivating the account. Record the decision — do not assign silently.`);
    }
  }

  console.log('\n--- FULL MATRIX ------------------------------------------------------------');
  console.table(
    classified.map((r) => ({
      Tenant: r.tenant,
      Staff: r.fullName,
      Role: r.role,
      Branches: r.branchCount,
      HomeBranch: r.clinicId ? 'set' : 'none',
      Grants: r.explicitGrants,
      Status: r.status,
    })),
  );

  console.log(`\nRESULT: ${blocked.length === 0 ? 'PASS — no active clinical user loses access.' : `FAIL — ${blocked.length} account(s) need a recorded decision.`}`);
  process.exitCode = blocked.length === 0 ? 0 : 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
