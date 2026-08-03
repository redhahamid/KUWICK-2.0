import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { FIXTURE_TAG, FixtureLedger, assertFixturesAllowed, fixtureLabel } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// S2 (D-074) — order/service creation branch integrity, against the running
// API. Complements the unit tests: this proves the HTTP surface is protected
// independently of the UI, which is the only thing an attacker touches.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/s2-order-branch-check.ts
const API = 'http://localhost:3000';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const FIXTURE_EMAIL_PREFIX = 'kuwick-fixture-s2-';

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, raw: text };
}

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await call(path, token, method, body);
  if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${r.raw.slice(0, 300)}`);
  return r.body;
}

interface Seed {
  user_id: string;
  staff_id: string;
  tenant_id: string;
  role: string;
  clinic_id: string | null;
  full_name: string;
  tenant_name: string;
}

async function main() {
  assertFixturesAllowed();

  const tokenFor = (s: Seed) =>
    jwt.sign(
      { sub: s.user_id, tenantId: s.tenant_id, staffId: s.staff_id, role: s.role },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: '2h' },
    );

  const staff = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<Seed[]>(
      `SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, s.clinic_id, s.full_name,
              t.name AS tenant_name
         FROM staff s JOIN users u ON s.user_id = u.id JOIN tenants t ON t.id = s.tenant_id
        WHERE s.active
        ORDER BY CASE WHEN s.role::text LIKE 'DOCTOR%' THEN 0 ELSE 1 END`,
    );
  });

  let seed: Seed | undefined;
  let token = '';
  let clinicId = '';
  let taskOrderId = '';
  let directServiceId = '';
  const probed = new Set<string>();
  for (const candidate of staff) {
    if (probed.has(candidate.tenant_id)) continue;
    probed.add(candidate.tenant_id);
    const t = tokenFor(candidate);
    const clinics = await call('/clinics', t);
    const services = await call('/services', t);
    if (clinics.status !== 200 || !clinics.body?.length || !services.body?.length) continue;
    const task = services.body.find((s: { orderType: string }) => s.orderType === 'TASK_ORDER');
    const direct = services.body.find((s: { orderType: string }) => s.orderType === 'STANDARD_SERVICE');
    if (!task || !direct) continue;
    seed = candidate;
    token = t;
    clinicId = clinics.body[0].id;
    taskOrderId = task.id;
    directServiceId = direct.id;
    break;
  }
  if (!seed) throw new Error('No tenant with a clinic and both service types.');

  const other = staff.find((c) => c.tenant_id !== seed!.tenant_id);
  const otherToken = other ? tokenFor(other) : '';

  console.log('\nS2 — ORDER/SERVICE CREATION BRANCH INTEGRITY');
  console.log(`tenant ${seed.tenant_name} as ${seed.role}`);
  console.log('='.repeat(78));

  const ledger = new FixtureLedger(prisma, API, token, seed.tenant_id);
  let strandedBranchStaffId: string | null = null;
  let seededStaff: Seed[] = [];
  let seededServiceIds: string[] = [];

  try {
    const stamp = Date.now();
    const patient = await api('/patients', token, 'POST', {
      name: fixtureLabel('S2 Branch Patient'),
      identifierType: 'PASSPORT',
      identifierValue: `B${stamp}`.slice(0, 14),
    });
    ledger.patient(patient.id);
    const visit = await api('/visits', token, 'POST', {
      clinicId,
      patientId: patient.id,
      staffId: seed.staff_id,
      billingType: 'Cash',
      presentingComplaint: fixtureLabel('branch integrity'),
    });
    ledger.visit(visit.id);

    const countOrders = async () => {
      const rows = await api(`/order-services?visitId=${visit.id}`, token);
      return rows.length;
    };

    // --- 1/2. The authorised path still works ------------------------------
    const task = await api('/order-services', token, 'POST', {
      visitId: visit.id,
      serviceCatalogId: taskOrderId,
    });
    check('1. same-tenant authorised-branch TASK_ORDER succeeds', task.status === 'PENDING', task.status);
    check('   branch taken from the visit', task.clinicId === clinicId);

    const direct = await api('/order-services', token, 'POST', {
      visitId: visit.id,
      serviceCatalogId: directServiceId,
    });
    check(
      '2. same-tenant authorised-branch STANDARD_SERVICE succeeds',
      direct.status === 'COMPLETED',
      direct.status,
    );
    check('9. e4ae300 behaviour unchanged — completedAt still set', Boolean(direct.completedAt));

    const baseline = await countOrders();

    // --- 3. Unauthorised branch --------------------------------------------
    // Uses a tenant that ALREADY has two branches with staff homed at each.
    //
    // An earlier version of this check created a second clinic when none
    // existed. That was wrong and it did real damage: adding a branch flips
    // the tenant from single- to multi-branch, and every staff member with a
    // null home clinic and no explicit grant immediately loses access to
    // everything — including the doctor this script was running as. A
    // security check must not reshape the thing it is measuring.
    // Find a tenant that ALREADY has two branches, and give it one fixture
    // doctor homed at each. Seeding staff into an already-multi-branch tenant
    // changes nobody else's access; creating a BRANCH would have (see above).
    const branchPair = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      const rows = await tx.$queryRawUnsafe<{ tenant_id: string; a_clinic: string; b_clinic: string }[]>(
        `SELECT c1.tenant_id, c1.id AS a_clinic, c2.id AS b_clinic
           FROM clinics c1 JOIN clinics c2 ON c1.tenant_id = c2.tenant_id AND c1.id < c2.id
          LIMIT 1`,
      );
      if (rows.length === 0) return null;
      const pair = rows[0];

      // The bypass GUC covers reads on these tables but not the INSERT
      // policies, which key on app.tenant_id (the D-048 family). Set it to the
      // tenant being seeded, or every insert below fails RLS.
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${pair.tenant_id}', true)`);

      // A real bcrypt hash is unnecessary — these tokens are minted directly
      // and the accounts are never used to log in. They are deleted below.
      const makeStaff = async (clinic: string, label: string): Promise<Seed> => {
        const userId = randomUUID();
        const staffId = randomUUID();
        await tx.$executeRawUnsafe(
          `INSERT INTO users (id, tenant_id, email, password_hash, status, created_at, updated_at)
           VALUES ('${userId}', '${pair.tenant_id}', '${FIXTURE_EMAIL_PREFIX}${label}-${stamp}@fixture.test',
                   'x', 'active', now(), now())`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO staff (id, tenant_id, user_id, role, full_name, active, clinic_id, created_at, updated_at)
           VALUES ('${staffId}', '${pair.tenant_id}', '${userId}', 'DOCTOR_RESIDENT',
                   '${fixtureLabel(`S2 ${label}`)}', true, '${clinic}', now(), now())`,
        );
        return {
          user_id: userId,
          staff_id: staffId,
          tenant_id: pair.tenant_id,
          role: 'DOCTOR_RESIDENT',
          clinic_id: clinic,
          full_name: `S2 ${label}`,
          tenant_name: '',
        };
      };

      // The branch-pair tenant may not have both service types configured —
      // it is whichever tenant happens to have two clinics, not a curated
      // one. Seed what is missing so BOTH order types get exercised across a
      // branch boundary, rather than quietly testing only one.
      const existing = await tx.$queryRawUnsafe<{ id: string; order_type: string }[]>(
        `SELECT id, order_type::text FROM service_catalog WHERE tenant_id = '${pair.tenant_id}' AND active`,
      );
      const seedService = async (orderType: string, label: string) => {
        const found = existing.find((s) => s.order_type === orderType);
        if (found) return { id: found.id, seeded: false };
        const id = randomUUID();
        await tx.$executeRawUnsafe(
          `INSERT INTO service_catalog
             (id, tenant_id, name, code, order_type, price, duration_minutes_default, active, created_at, updated_at)
           VALUES ('${id}', '${pair.tenant_id}', '${fixtureLabel(`S2 ${label}`)}',
                   'S2${label.toUpperCase()}${String(stamp).slice(-5)}', '${orderType}', 10, 15, true, now(), now())`,
        );
        return { id, seeded: true };
      };

      return {
        ...pair,
        a: await makeStaff(pair.a_clinic, 'BranchA'),
        b: await makeStaff(pair.b_clinic, 'BranchB'),
        taskService: await seedService('TASK_ORDER', 'Task'),
        directService: await seedService('STANDARD_SERVICE', 'Direct'),
      };
    });
    seededStaff = branchPair ? [branchPair.a, branchPair.b] : [];
    seededServiceIds = branchPair
      ? [branchPair.taskService, branchPair.directService].filter((s) => s.seeded).map((s) => s.id)
      : [];

    if (branchPair?.a && branchPair.b) {
      const homeToken = tokenFor(branchPair.a);
      const foreignBranchToken = tokenFor(branchPair.b);
      strandedBranchStaffId = branchPair.b.staff_id;

      // A visit at branch A, created by branch A's own staff.
      const bPatient = await api('/patients', homeToken, 'POST', {
        name: fixtureLabel('S2 Cross Branch Patient'),
        identifierType: 'PASSPORT',
        identifierValue: `X${stamp}`.slice(0, 14),
      });
      const bVisit = await api('/visits', homeToken, 'POST', {
        clinicId: branchPair.a_clinic,
        patientId: bPatient.id,
        staffId: branchPair.a.staff_id,
        billingType: 'Cash',
        presentingComplaint: fixtureLabel('cross branch'),
      });
      const branchLedger = new FixtureLedger(prisma, API, homeToken, branchPair.tenant_id);
      branchLedger.patient(bPatient.id);
      branchLedger.visit(bVisit.id);

      try {
        const theirTask = { id: branchPair.taskService.id };
        const theirDirect = { id: branchPair.directService.id };

        const before = (await api(`/order-services?visitId=${bVisit.id}`, homeToken)).length;

        if (theirTask) {
          const crossTask = await call('/order-services', foreignBranchToken, 'POST', {
            visitId: bVisit.id,
            serviceCatalogId: theirTask.id,
          });
          check(
            '3. an unauthorised branch is refused (TASK_ORDER)',
            crossTask.status === 403,
            `HTTP ${crossTask.status}`,
          );
        }
        if (theirDirect) {
          const crossDirect = await call('/order-services', foreignBranchToken, 'POST', {
            visitId: bVisit.id,
            serviceCatalogId: theirDirect.id,
          });
          check(
            '   and for a chargeable direct service',
            crossDirect.status === 403,
            `HTTP ${crossDirect.status}`,
          );
        }
        const after = (await api(`/order-services?visitId=${bVisit.id}`, homeToken)).length;
        check('6. no OrderService survives a cross-branch refusal', after === before, `${before} -> ${after}`);
      } finally {
        await branchLedger.cleanup();
      }
    } else {
      console.log('  SKIP  3 — no tenant in this database has two branches with staff homed at each');
    }

    // --- 4. Foreign visit ---------------------------------------------------
    if (otherToken) {
      const foreignVisit = await call('/order-services', otherToken, 'POST', {
        visitId: visit.id,
        serviceCatalogId: directServiceId,
      });
      check(
        '4. a foreign visit is refused, non-disclosing',
        foreignVisit.status === 404,
        `HTTP ${foreignVisit.status}`,
      );
      const madeUp = await call('/order-services', otherToken, 'POST', {
        visitId: '00000000-0000-4000-8000-000000000000',
        serviceCatalogId: directServiceId,
      });
      check(
        '   an id that never existed looks identical',
        madeUp.status === foreignVisit.status,
        `HTTP ${madeUp.status}`,
      );
      check(
        '   no Prisma or database wording leaks',
        !/prisma|constraint|column|relation/i.test(foreignVisit.raw),
        foreignVisit.raw.slice(0, 60),
      );

      // --- 5. Foreign catalogue entry --------------------------------------
      const foreignServices = await call('/services', otherToken);
      const theirService = foreignServices.body?.[0];
      if (theirService) {
        const crossCatalog = await call('/order-services', token, 'POST', {
          visitId: visit.id,
          serviceCatalogId: theirService.id,
        });
        check(
          '5. a foreign ServiceCatalog entry is refused',
          crossCatalog.status === 404,
          `HTTP ${crossCatalog.status}`,
        );
      }
    } else {
      console.log('  SKIP  4/5 — only one tenant in this database');
    }

    const unknownService = await call('/order-services', token, 'POST', {
      visitId: visit.id,
      serviceCatalogId: '00000000-0000-4000-8000-000000000000',
    });
    check('   an unknown service is refused', unknownService.status === 404, `HTTP ${unknownService.status}`);

    // --- 6/7. Nothing survives a rejection -----------------------------------
    check('6. order count unchanged after every rejection', (await countOrders()) === baseline);
    const invoices = await api(`/invoices?visitId=${visit.id}`, token);
    const lineCount = invoices.flatMap((i: { lines: unknown[] }) => i.lines).length;
    check('7. no invoice line was created by any rejected request', lineCount === 0, String(lineCount));
    const queue = await api(`/procedure-queue?clinicId=${clinicId}`, token);
    const strayTasks = queue.filter((q: { visitId: string }) => q.visitId === visit.id).length;
    check('   no stray staff task in the Procedure Queue', strayTasks === 1, `${strayTasks} (the 1 legitimate order)`);

    // --- 8. TASK_ORDER workflow untouched -------------------------------------
    const started = await api(`/order-services/${task.id}/start`, token, 'PATCH', {});
    const completed = await api(`/order-services/${task.id}/complete`, token, 'PATCH', { result: 'Normal' });
    check(
      '8. TASK_ORDER Start/Complete unchanged',
      started.status === 'IN_PROGRESS' && completed.status === 'COMPLETED',
      `${started.status} -> ${completed.status}`,
    );

    // --- 10. Protected independently of the UI ---------------------------------
    const anon = await call('/order-services', '', 'POST', {
      visitId: visit.id,
      serviceCatalogId: directServiceId,
    });
    check('10. an unauthenticated direct API call is refused', anon.status === 401, `HTTP ${anon.status}`);
    const garbage = await call('/order-services', 'not-a-real-token', 'POST', {
      visitId: visit.id,
      serviceCatalogId: directServiceId,
    });
    check('    a forged token is refused', garbage.status === 401, `HTTP ${garbage.status}`);
    check('    still no extra orders', (await countOrders()) === baseline);
  } finally {
    await ledger.cleanup();
    if (seededStaff.length > 0) {
      // The two fixture doctors, and nothing else. Removed by id, never by
      // pattern, and only after their visits are gone.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
        // app.tenant_id as well: service_catalog's policies key on it, and a
        // DELETE that does not match a policy removes NOTHING and reports no
        // error. The first version of this cleanup looked like it worked and
        // left a fixture row behind (D-048 again, this time on the way out).
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${seededStaff[0].tenant_id}', true)`);
        for (const s of seededStaff) {
          await tx.$executeRawUnsafe(`DELETE FROM staff WHERE id = '${s.staff_id}'`);
          await tx.$executeRawUnsafe(`DELETE FROM users WHERE id = '${s.user_id}'`);
        }
        for (const id of seededServiceIds) {
          await tx.$executeRawUnsafe(`DELETE FROM service_catalog WHERE id = '${id}'`);
        }
      });

      // Verified, not assumed — the same mistake is why this check exists.
      const left = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${seededStaff[0].tenant_id}', true)`);
        const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT COUNT(*) n FROM service_catalog WHERE name LIKE '${FIXTURE_TAG} S2%'`,
        );
        return Number(rows[0].n);
      });
      console.log(
        `cleanup: ${seededStaff.length} seeded branch accounts and ${seededServiceIds.length} services removed` +
          (left === 0 ? ' (verified none remain)' : ` — WARNING: ${left} service(s) still present`),
      );
    }
    if (strandedBranchStaffId) {
      console.log(`  note: reused existing staff ${strandedBranchStaffId} for the cross-branch check`);
    }
    console.log('cleanup: fixture visit and patient removed');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
