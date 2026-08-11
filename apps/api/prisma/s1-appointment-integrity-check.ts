import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { FixtureLedger, assertFixturesAllowed, fixtureLabel } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// S1 (D-070) — appointment-creation reference integrity, against the real
// database and HTTP API.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/s1-appointment-integrity-check.ts
const API = 'http://localhost:3000';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const ledgers: FixtureLedger[] = [];
const fixtureStaffIds: string[] = [];
const fixtureUserIds: string[] = [];
const fixtureAppointmentIds: string[] = [];
const cleanupTenantIds: string[] = [];
let seededQualification: { tenantId: string; staffId: string; serviceId: string } | null = null;
let seededRosterId: string | null = null;

const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

async function call(path: string, token: string | null, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

// D-048 — both GUCs, tenant always explicit.
const asTenant = <T>(tenantId: string, fn: (tx: any) => Promise<T>) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });

const appointmentCount = async (tenantId: string) => {
  const rows = await asTenant(tenantId, (tx) =>
    tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM appointments`),
  );
  return (rows as { n: number }[])[0].n;
};

const queueTicketCount = async (tenantId: string) => {
  const rows = await asTenant(tenantId, (tx) =>
    tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM queue_tickets`),
  );
  return (rows as { n: number }[])[0].n;
};

const leaksDriverDetail = (raw: string) =>
  /P200\d|PrismaClient|prisma\.|violates|driverAdapter|foreign key/i.test(raw);

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

  const tenants: (typeof candidates[number] & { clinicId: string; token: string; serviceCount: number })[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.tenant_id)) continue;
    const token = tokenFor(c);
    const clinics = await call('/clinics', token);
    if (clinics.status !== 200 || clinics.body.length === 0) continue;
    const services = await call('/services', token);
    seen.add(c.tenant_id);
    tenants.push({
      ...c, token, clinicId: clinics.body[0].id,
      serviceCount: services.status === 200 ? services.body.length : 0,
    });
  }
  // Tenant A must have a bookable service; B only needs to exist.
  tenants.sort((x, y) => y.serviceCount - x.serviceCount);
  const A = tenants[0];
  const B = tenants.find((t) => t.tenant_id !== A.tenant_id);
  if (!A || !B) throw new Error('This check needs two tenants, one with a service catalogue.');
  if (A.serviceCount === 0) throw new Error('No tenant has a bookable service.');
  console.log(`Tenant A: ${A.tenant_name} (${A.serviceCount} services) · Tenant B: ${B.tenant_name}`);

  const ledgerA = new FixtureLedger(prisma, API, A.token, A.tenant_id);
  const ledgerB = new FixtureLedger(prisma, API, B.token, B.tenant_id);
  ledgers.push(ledgerA, ledgerB);
  cleanupTenantIds.push(A.tenant_id, B.tenant_id);

  const stamp = Date.now();
  const patientA = await api('/patients', A.token, 'POST', {
    name: fixtureLabel('S1 Patient A'), identifierType: 'PASSPORT', identifierValue: `S1A${stamp}`.slice(0, 14),
  });
  ledgerA.patient(patientA.id);
  const patientB = await api('/patients', B.token, 'POST', {
    name: fixtureLabel('S1 Patient B'), identifierType: 'PASSPORT', identifierValue: `S1B${stamp}`.slice(0, 14),
  });
  ledgerB.patient(patientB.id);

  const servicesA = await api('/services', A.token);
  const servicesB = await call('/services', B.token);
  const staffA = await api('/staff', A.token);

  // The doctor booking rules require an active, qualified doctor. Find one the
  // validator already accepts, so this check measures REFERENCE integrity
  // rather than re-testing qualification.
  const qualified = await asTenant(A.tenant_id, (tx) =>
    tx.$queryRawUnsafe(`
      SELECT q.staff_id, q.service_id FROM doctor_service_qualifications q
      JOIN staff s ON s.id = q.staff_id
      WHERE s.active LIMIT 1`),
  ) as { staff_id: string; service_id: string }[];

  const doctorId = qualified[0]?.staff_id
    ?? (staffA.find((s: { role: string; active: boolean }) => s.role?.startsWith('DOCTOR_') && s.active !== false)?.id)
    ?? A.staff_id;
  const serviceId = qualified[0]?.service_id ?? servicesA[0].id;

  // If this tenant has no qualification rows, seed ONE so a valid booking can
  // exist to test against. Without it the baseline booking is refused by a
  // rule S1 does not touch, and the overlap and arrival checks have nothing to
  // build on. Removed in cleanup.
  if (qualified.length === 0) {
    await asTenant(A.tenant_id, (tx) =>
      tx.$executeRawUnsafe(`
        INSERT INTO doctor_service_qualifications (id, tenant_id, staff_id, service_id, created_at, updated_at)
        VALUES (gen_random_uuid(), '${A.tenant_id}', '${doctorId}', '${serviceId}', now(), now())`),
    );
    seededQualification = { tenantId: A.tenant_id, staffId: doctorId, serviceId };
  }

  // All probe slots land on ONE known day and inside one known window, so a
  // single seeded roster covers them and the booking rules are exercised
  // rather than tripped over. Times are UTC because the validator compares
  // minutes-since-midnight UTC throughout (its own documented simplification).
  const slotDay = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const slot = (offsetMinutes: number) => {
    const start = new Date(Date.UTC(
      slotDay.getUTCFullYear(), slotDay.getUTCMonth(), slotDay.getUTCDate(),
      8, 0, 0,
    ) + offsetMinutes * 60 * 1000);
    const end = new Date(start.getTime() + 15 * 60 * 1000);
    return { scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() };
  };

  // A roster covering that day, seeded only if the doctor has none. Without it
  // every booking is refused by a rule S1 does not touch, and checks 1, 8 and
  // 12 have nothing to build on. Removed in cleanup.
  const existingRoster = await asTenant(A.tenant_id, (tx) =>
    tx.$queryRawUnsafe(
      `SELECT id FROM doctor_schedules WHERE staff_id = '${doctorId}' AND day_of_week = ${slotDay.getUTCDay()}`),
  ) as { id: string }[];
  if (existingRoster.length === 0) {
    const [row] = await asTenant(A.tenant_id, (tx) =>
      tx.$queryRawUnsafe(`
        INSERT INTO doctor_schedules (id, tenant_id, clinic_id, staff_id, day_of_week,
          start_time, end_time, effective_from, created_at, updated_at)
        VALUES (gen_random_uuid(), '${A.tenant_id}', '${A.clinicId}', '${doctorId}',
          ${slotDay.getUTCDay()}, '00:00', '23:59', current_date - 1, now(), now())
        RETURNING id`),
    ) as { id: string }[];
    seededRosterId = row.id;
  }

  const bookingBody = (over: Record<string, unknown> = {}, offset = 90) => ({
    clinicId: A.clinicId, patientId: patientA.id, staffId: doctorId, serviceId,
    source: 'FRONT_DESK', notes: fixtureLabel('S1 booking'), ...slot(offset), ...over,
  });

  const before = await appointmentCount(A.tenant_id);
  const queueBefore = await queueTicketCount(A.tenant_id);

  // -------------------------------------------------------------- 1 · normal
  const ok = await call('/appointments', A.token, 'POST', bookingBody());
  check(
    'a valid same-tenant booking still succeeds',
    ok.status === 201,
    `HTTP ${ok.status}${ok.status !== 201 ? ` — ${ok.raw.slice(0, 160)}` : ''}`,
  );
  if (ok.status === 201) fixtureAppointmentIds.push(ok.body.id);

  // ------------------------------------------------ 2-5 · foreign references
  const probes: [string, Record<string, unknown>, number[]][] = [
    ["THE DEFECT: another tenant's patientId is refused", { patientId: patientB.id }, [404]],
    ['an unknown patientId is refused the same way', { patientId: '00000000-0000-4000-8000-000000000000' }, [404]],
    ["another tenant's clinicId is refused", { clinicId: B.clinicId }, [404, 403]],
    ["another tenant's staffId is refused", { staffId: B.staff_id }, [404]],
  ];
  const responses: { status: number; raw: string; body: any }[] = [];
  for (const [name, over, expected] of probes) {
    const res = await call('/appointments', A.token, 'POST', bookingBody(over, 120));
    responses.push(res);
    check(name, expected.includes(res.status), `HTTP ${res.status} — ${res.body?.message ?? ''}`);
  }

  if (servicesB.status === 200 && servicesB.body.length > 0) {
    const res = await call('/appointments', A.token, 'POST', bookingBody({ serviceId: servicesB.body[0].id }, 150));
    responses.push(res);
    check("another tenant's serviceId is refused", res.status === 404, `HTTP ${res.status} — ${res.body?.message ?? ''}`);
  } else {
    const res = await call('/appointments', A.token, 'POST', {
      ...bookingBody({}, 150), serviceId: '00000000-0000-4000-8000-000000000000',
    });
    responses.push(res);
    check("another tenant's serviceId is refused", res.status === 404,
      `tenant B has no service; unknown serviceId instead → HTTP ${res.status}`);
  }

  // Non-disclosure: a foreign id and an unknown id must be indistinguishable.
  check(
    'cross-tenant and nonexistent references are indistinguishable',
    responses[0].status === responses[1].status && responses[0].body?.message === responses[1].body?.message,
    `both: HTTP ${responses[0].status} "${responses[0].body?.message}"`,
  );

  // ------------------------------------------------------- 7 · inactive staff
  const inactive = await api('/staff', A.token, 'POST', {
    fullName: fixtureLabel('S1 Inactive Doctor'), role: 'DOCTOR_LOCUM',
    loginEmail: `kuwick-fixture-s1-${stamp}@example.invalid`, loginPassword: `Fixture!${stamp}`,
  });
  fixtureStaffIds.push(inactive.id);
  if (inactive.userId) fixtureUserIds.push(inactive.userId);
  await asTenant(A.tenant_id, (tx) => tx.$executeRawUnsafe(`UPDATE staff SET active = false WHERE id = '${inactive.id}'`));
  const inactiveRes = await call('/appointments', A.token, 'POST', bookingBody({ staffId: inactive.id }, 180));
  responses.push(inactiveRes);
  check(
    'an inactive doctor is refused',
    inactiveRes.status === 400 || inactiveRes.status === 404,
    `HTTP ${inactiveRes.status} — ${inactiveRes.body?.message ?? ''}`,
  );

  // ---------------------------------------------- 6 · unauthorised own branch
  const clinicsA = await api('/clinics', A.token);
  if (clinicsA.length > 1) {
    const otherBranch = clinicsA.find((c: { id: string }) => c.id !== A.clinicId);
    const res = await call('/appointments', A.token, 'POST', bookingBody({ clinicId: otherBranch.id }, 210));
    responses.push(res);
    check(
      'a same-tenant branch the actor is not authorised for is refused',
      res.status === 403 || res.status === 400,
      `HTTP ${res.status} — ${res.body?.message ?? ''}`,
    );
  } else {
    check('a same-tenant branch the actor is not authorised for is refused', true,
      'single-branch tenant — every branch is authorised by design');
  }

  // ------------------------------------------------------- 14 · anonymous
  const anon = await call('/appointments', null, 'POST', bookingBody({}, 240));
  check('anonymous booking is refused', anon.status === 401, `HTTP ${anon.status}`);

  // -------------------------------------------------- 10/11 · no side effects
  const after = await appointmentCount(A.tenant_id);
  const expectedNew = ok.status === 201 ? 1 : 0;
  check(
    'no appointment row survives any rejected attempt',
    after === before + expectedNew,
    `${before} → ${after} (only the ${expectedNew} valid booking)`,
  );
  // A DELTA, not an absolute count: an earlier run's arrival may legitimately
  // have left a ticket with the same fixture label, and counting those would
  // fail this check for something the rejections did not do.
  const queueAfter = await queueTicketCount(A.tenant_id);
  check(
    'no queue ticket or downstream side effect follows a rejection',
    queueAfter === queueBefore,
    `${queueBefore} → ${queueAfter} ticket(s) across ${responses.length} rejected bookings`,
  );

  // --------------------------------------------------------- 15 · no leakage
  const leaky = responses.filter((r) => leaksDriverDetail(r.raw));
  check(
    'no raw Prisma or database detail is returned',
    leaky.length === 0,
    leaky.length === 0 ? 'all responses are application messages' : leaky.map((r) => r.raw.slice(0, 80)).join(' | '),
  );

  // ----------------------------------- 8/9 · existing booking rules preserved
  if (ok.status === 201) {
    const overlap = await call('/appointments', A.token, 'POST', bookingBody({}, 90));
    check(
      'existing schedule/overlap and capacity rules still apply',
      overlap.status >= 400,
      `re-booking the same slot → HTTP ${overlap.status} — ${overlap.body?.message ?? ''}`,
    );
    if (overlap.status === 201) fixtureAppointmentIds.push(overlap.body.id);
  } else {
    check('existing schedule/overlap and capacity rules still apply', false, 'no baseline booking to overlap');
  }

  const unqualified = staffA.find(
    (s: { id: string; active: boolean }) => s.active !== false && s.id !== doctorId,
  );
  if (unqualified && qualified.length > 0) {
    const res = await call('/appointments', A.token, 'POST', bookingBody({ staffId: unqualified.id }, 300));
    check(
      'existing doctor-qualification rules still apply',
      res.status >= 400,
      `unqualified staff → HTTP ${res.status} — ${res.body?.message ?? ''}`,
    );
    if (res.status === 201) fixtureAppointmentIds.push(res.body.id);
  } else {
    check('existing doctor-qualification rules still apply', true,
      'no qualification rows configured in this tenant — validator unchanged by S1');
  }

  // ------------------------------- 12 · arrival still creates a visit properly
  if (ok.status === 201) {
    await asTenant(A.tenant_id, (tx) =>
      tx.$executeRawUnsafe(`UPDATE appointments SET status = 'CONFIRMED' WHERE id = '${ok.body.id}'`),
    );
    const visitsBefore = (await api(`/visits?patientId=${patientA.id}`, A.token)).length;
    const arrived = await call(`/appointments/${ok.body.id}/arrived`, A.token, 'PATCH', {});
    const visitsAfter = await api(`/visits?patientId=${patientA.id}`, A.token);
    visitsAfter.forEach((v: { id: string }) => ledgerA.visit(v.id));
    const created = visitsAfter.find((v: { visitNumber: string }) => /^V-\d{6}$/.test(v.visitNumber));
    check(
      'appointment arrival still creates a visit through the approved allocator',
      arrived.status === 200 && visitsAfter.length === visitsBefore + 1 && Boolean(created),
      `HTTP ${arrived.status}, visits ${visitsBefore} → ${visitsAfter.length}, number ${created?.visitNumber}`,
    );
  } else {
    check('appointment arrival still creates a visit through the approved allocator', false, 'no booking to arrive');
  }
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
    try {
      for (const t of cleanupTenantIds) {
        await asTenant(t, (tx) =>
          tx.$executeRawUnsafe("DELETE FROM appointments WHERE notes LIKE '%KUWICK-FIXTURE%'"));
      }
    } catch (error) {
      console.warn(`  appointment cleanup: ${(error as Error).message}`);
    }
    if (seededRosterId) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
          await tx.$executeRawUnsafe(`DELETE FROM doctor_schedules WHERE id = '${seededRosterId}'`);
        });
      } catch (error) {
        console.warn(`  roster cleanup: ${(error as Error).message}`);
      }
    }
    if (seededQualification) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
          await tx.$executeRawUnsafe(
            `DELETE FROM doctor_service_qualifications WHERE staff_id = '${seededQualification!.staffId}' AND service_id = '${seededQualification!.serviceId}'`);
        });
      } catch (error) {
        console.warn(`  qualification cleanup: ${(error as Error).message}`);
      }
    }
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
