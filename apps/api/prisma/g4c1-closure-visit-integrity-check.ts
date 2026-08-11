import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { FixtureLedger, assertFixturesAllowed, fixtureLabel } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G4c1 closure (D-069) — visit-creation relationship integrity, against the
// real database and HTTP API.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g4c1-closure-visit-integrity-check.ts
const API = 'http://localhost:3000';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const ledgers: FixtureLedger[] = [];
const fixtureStaffIds: string[] = [];
const fixtureUserIds: string[] = [];

const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
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
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${r.raw}`);
  return r.body;
}

// D-048 — these tables are FORCE'd against app.tenant_id; the bypass GUC alone
// reads nothing. Both are always set, and the tenant is explicit.
const asTenant = <T>(tenantId: string, fn: (tx: any) => Promise<T>) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });

const counterFor = async (tenantId: string) => {
  const rows = await asTenant(tenantId, (tx) =>
    tx.$queryRawUnsafe(`SELECT next_value FROM visit_number_counters WHERE tenant_id = '${tenantId}'`),
  );
  return (rows as { next_value: number }[])[0]?.next_value ?? null;
};

/** No driver internals may reach the client, whatever the outcome. */
const leaksDriverDetail = (raw: string) =>
  /P200\d|PrismaClient|prisma\.|constraint|violates|driverAdapter/i.test(raw);

async function main() {
  assertFixturesAllowed();

  const tokenFor = (s: { user_id: string; tenant_id: string; staff_id: string; role: string }) =>
    jwt.sign({ sub: s.user_id, tenantId: s.tenant_id, staffId: s.staff_id, role: s.role },
      process.env.JWT_ACCESS_SECRET as string, { expiresIn: '60m' });

  const candidates = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<
      { user_id: string; staff_id: string; tenant_id: string; role: string; tenant_name: string }[]
    >(`SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, t.name AS tenant_name
       FROM staff s JOIN users u ON s.user_id = u.id JOIN tenants t ON t.id = s.tenant_id
       WHERE s.active ORDER BY t.name`);
  });

  const tenants: (typeof candidates[number] & { clinicId: string; token: string })[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.tenant_id)) continue;
    const token = tokenFor(c);
    const clinics = await call('/clinics', token);
    if (clinics.status === 200 && clinics.body.length > 0) {
      seen.add(c.tenant_id);
      tenants.push({ ...c, clinicId: clinics.body[0].id, token });
    }
  }
  // Prefer a tenant that has a bookable service, so the appointment-arrival
  // path is genuinely exercised rather than argued for.
  for (const t of tenants) {
    const services = await call('/services', t.token);
    (t as { serviceCount?: number }).serviceCount = services.status === 200 ? services.body.length : 0;
  }
  tenants.sort((x, y) => ((y as { serviceCount?: number }).serviceCount ?? 0) - ((x as { serviceCount?: number }).serviceCount ?? 0));

  const A = tenants[0];
  const B = tenants.find((t) => t.tenant_id !== A.tenant_id);
  if (!A || !B) throw new Error('This check needs two tenants that each have a clinic.');
  console.log(`Tenant A: ${A.tenant_name} · Tenant B: ${B.tenant_name}`);

  const ledgerA = new FixtureLedger(prisma, API, A.token, A.tenant_id);
  const ledgerB = new FixtureLedger(prisma, API, B.token, B.tenant_id);
  ledgers.push(ledgerA, ledgerB);

  const stamp = Date.now();
  const patientA = await api('/patients', A.token, 'POST', {
    name: fixtureLabel('D069 Patient A'), identifierType: 'PASSPORT', identifierValue: `D69A${stamp}`.slice(0, 14),
  });
  ledgerA.patient(patientA.id);
  const patientB = await api('/patients', B.token, 'POST', {
    name: fixtureLabel('D069 Patient B'), identifierType: 'PASSPORT', identifierValue: `D69B${stamp}`.slice(0, 14),
  });
  ledgerB.patient(patientB.id);

  const visitBody = (over: Record<string, unknown> = {}) => ({
    clinicId: A.clinicId, patientId: patientA.id, staffId: A.staff_id,
    billingType: 'Cash', presentingComplaint: fixtureLabel('D069 probe'), ...over,
  });

  // ------------------------------------------------------------- 1 · baseline
  const ok = await call('/visits', A.token, 'POST', visitBody());
  check('a fully valid same-tenant request still creates a visit', ok.status === 201, `HTTP ${ok.status} ${ok.body?.visitNumber}`);
  if (ok.status === 201) ledgerA.visit(ok.body.id);

  // --------------------------------------------------- 2/3 · patient identity
  const counterBefore = await counterFor(A.tenant_id);

  const crossPatient = await call('/visits', A.token, 'POST', visitBody({ patientId: patientB.id }));
  check(
    "THE DEFECT: another tenant's patientId cannot create a visit",
    crossPatient.status === 404,
    `HTTP ${crossPatient.status} — ${crossPatient.body?.message ?? ''}`,
  );

  const unknownPatient = await call('/visits', A.token, 'POST', {
    ...visitBody(), patientId: '00000000-0000-4000-8000-000000000000',
  });
  check(
    'an unknown patientId returns a controlled 404, not a 500',
    unknownPatient.status === 404,
    `HTTP ${unknownPatient.status}`,
  );
  check(
    'the cross-tenant and unknown responses are indistinguishable',
    crossPatient.status === unknownPatient.status &&
      crossPatient.body?.message === unknownPatient.body?.message,
    `both: HTTP ${crossPatient.status} "${crossPatient.body?.message}"`,
  );

  // ------------------------------------------------------------- 4/5 · clinic
  const crossClinic = await call('/visits', A.token, 'POST', visitBody({ clinicId: B.clinicId }));
  check(
    "another tenant's clinicId cannot create a visit",
    crossClinic.status === 404 || crossClinic.status === 403,
    `HTTP ${crossClinic.status} — ${crossClinic.body?.message ?? ''}`,
  );
  const unknownClinic = await call('/visits', A.token, 'POST', {
    ...visitBody(), clinicId: '00000000-0000-4000-8000-000000000000',
  });
  check('an unknown clinicId returns a controlled response', unknownClinic.status === 404, `HTTP ${unknownClinic.status}`);

  // -------------------------------------------------------------- 6/7 · staff
  const crossStaff = await call('/visits', A.token, 'POST', visitBody({ staffId: B.staff_id }));
  check(
    "another tenant's staffId cannot be recorded as attending",
    crossStaff.status === 404,
    `HTTP ${crossStaff.status} — ${crossStaff.body?.message ?? ''}`,
  );
  const unknownStaff = await call('/visits', A.token, 'POST', {
    ...visitBody(), staffId: '00000000-0000-4000-8000-000000000000',
  });
  check('an unknown staffId returns a controlled response', unknownStaff.status === 404, `HTTP ${unknownStaff.status}`);

  // An inactive staff member, made inactive directly so no admin route is needed.
  const inactive = await api('/staff', A.token, 'POST', {
    fullName: fixtureLabel('D069 Inactive Doctor'), role: 'DOCTOR_LOCUM',
    loginEmail: `kuwick-fixture-d069-${stamp}@example.invalid`, loginPassword: `Fixture!${stamp}`,
  });
  fixtureStaffIds.push(inactive.id);
  if (inactive.userId) fixtureUserIds.push(inactive.userId);
  await asTenant(A.tenant_id, (tx) => tx.$executeRawUnsafe(`UPDATE staff SET active = false WHERE id = '${inactive.id}'`));
  const inactiveStaff = await call('/visits', A.token, 'POST', visitBody({ staffId: inactive.id }));
  check(
    'an inactive staff member cannot be recorded as attending',
    inactiveStaff.status === 400,
    `HTTP ${inactiveStaff.status} — ${inactiveStaff.body?.message ?? ''}`,
  );

  // ------------------------------------------------ 19 · counter untouched
  const counterAfter = await counterFor(A.tenant_id);
  check(
    'no rejected request consumed a visit number',
    counterAfter === counterBefore,
    `counter ${counterBefore} → ${counterAfter} across ${7} rejected attempts`,
  );

  // ---------------------------------------------- 22 · no driver detail leaks
  const leaky = [crossPatient, unknownPatient, crossClinic, unknownClinic, crossStaff, unknownStaff, inactiveStaff]
    .filter((r) => leaksDriverDetail(r.raw));
  check(
    'no raw Prisma or foreign-key detail reaches the client',
    leaky.length === 0,
    leaky.length === 0 ? 'all responses are application messages' : leaky.map((r) => r.raw.slice(0, 80)).join(' | '),
  );

  // -------------------------------------------------------- 17 · queue path
  const queueCross = await call('/queue-tickets', A.token, 'POST', {
    clinicId: A.clinicId, patientId: patientB.id, staffId: A.staff_id,
    billingType: 'Cash', queueType: 'WALK_IN', presentingComplaint: fixtureLabel('D069 queue probe'),
  });
  check(
    'the Queue path applies the same validation',
    queueCross.status === 404,
    `HTTP ${queueCross.status} — ${queueCross.body?.message ?? ''}`,
  );
  const queueOk = await call('/queue-tickets', A.token, 'POST', {
    clinicId: A.clinicId, patientId: patientA.id, staffId: A.staff_id,
    billingType: 'Cash', queueType: 'WALK_IN', presentingComplaint: fixtureLabel('D069 queue valid'),
  });
  check('the Queue path still works for a valid request', queueOk.status === 201, `HTTP ${queueOk.status}`);
  if (queueOk.status === 201 && (queueOk.body.visitId ?? queueOk.body.visit?.id)) {
    ledgerA.visit(queueOk.body.visitId ?? queueOk.body.visit.id);
  }

  // -------------------------------------------------- 18 · appointment path
  // `arrived()` reads patient, clinic and doctor from the STORED appointment —
  // the client supplies only the appointment id — so there is no id to inject.
  // What is verified here is that the path still functions end to end.
  // Appointment BOOKING has its own rules (active doctor, service
  // qualification) which are not what this closure is about. The appointment
  // row is therefore seeded directly, in CONFIRMED state, so the check
  // exercises the ARRIVAL path — the one that creates a visit.
  const services = await call('/services', A.token);
  let appointmentDetail = 'no bookable service in this tenant';
  let appointmentPass = false;
  if (services.status === 200 && services.body.length > 0) {
    const from = new Date(Date.now() + 45 * 60 * 1000);
    const to = new Date(from.getTime() + 15 * 60 * 1000);
    const [appt] = (await asTenant(A.tenant_id, (tx) =>
      tx.$queryRawUnsafe(`
        INSERT INTO appointments (id, tenant_id, clinic_id, patient_id, staff_id, service_id, status,
          source, scheduled_start, scheduled_end, notes, created_at, updated_at)
        VALUES (gen_random_uuid(), '${A.tenant_id}', '${A.clinicId}', '${patientA.id}',
          '${A.staff_id}', '${services.body[0].id}', 'CONFIRMED', 'FRONT_DESK',
          '${from.toISOString()}', '${to.toISOString()}',
          '${fixtureLabel('D069 appointment')}', now(), now())
        RETURNING id`),
    )) as { id: string }[];

    const before = (await api(`/visits?patientId=${patientA.id}`, A.token)).length;
    const arrived = await call(`/appointments/${appt.id}/arrived`, A.token, 'PATCH', {});
    const after = await api(`/visits?patientId=${patientA.id}`, A.token);
    const fresh = after.filter((v: { id: string }) => !ledgerA.visitIds.includes(v.id));
    fresh.forEach((v: { id: string }) => ledgerA.visit(v.id));
    appointmentPass = arrived.status === 200 && after.length === before + 1;
    appointmentDetail = `HTTP ${arrived.status}, visits ${before} → ${after.length}, number ${fresh[0]?.visitNumber ?? 'n/a'}`;
    await asTenant(A.tenant_id, (tx) => tx.$executeRawUnsafe(`DELETE FROM appointments WHERE id = '${appt.id}'`));
  }
  check('the appointment-arrival path creates a visit through the same validation', appointmentPass, appointmentDetail);

  // ------------------------------------------- 21 · no cross-tenant residue
  const stray = await asTenant(A.tenant_id, (tx) =>
    tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM visits v
      WHERE NOT EXISTS (SELECT 1 FROM patients p WHERE p.id = v.patient_id)`),
  );
  const strayB = await asTenant(B.tenant_id, (tx) =>
    tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM visits v
      WHERE NOT EXISTS (SELECT 1 FROM patients p WHERE p.id = v.patient_id)`),
  );
  check(
    'no cross-tenant visit row exists after the abuse attempts',
    (stray as { n: number }[])[0].n === 0 && (strayB as { n: number }[])[0].n === 0,
    `tenant A: ${(stray as { n: number }[])[0].n}, tenant B: ${(strayB as { n: number }[])[0].n}`,
  );

  // ------------------------------------------------ 23 · concurrency intact
  const burst = await Promise.all(
    Array.from({ length: 10 }, (_, i) => call('/visits', A.token, 'POST', visitBody({
      presentingComplaint: fixtureLabel(`D069 concurrent ${i}`),
    }))),
  );
  const created = burst.filter((r) => r.status === 201);
  created.forEach((r) => ledgerA.visit(r.body.id));
  const numbers = new Set(created.map((r) => r.body.visitNumber));
  check(
    'validated creation is still safe under concurrency',
    created.length === 10 && numbers.size === 10,
    `${created.length}/10 created, ${numbers.size} unique numbers`,
  );
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length > 0) process.exitCode = 1;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const l of ledgers) await l.cleanup();
    if (fixtureStaffIds.length > 0 || fixtureUserIds.length > 0) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
          for (const id of fixtureStaffIds) await tx.$executeRawUnsafe(`DELETE FROM staff WHERE id = '${id}'`);
          for (const id of fixtureUserIds) await tx.$executeRawUnsafe(`DELETE FROM users WHERE id = '${id}'`);
        });
      } catch (error) {
        console.warn(`  staff cleanup: ${(error as Error).message}`);
      }
    }
    await prisma.$disconnect();
  });
