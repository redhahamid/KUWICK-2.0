import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { FixtureLedger, assertFixturesAllowed, fixtureLabel, sweepOrphanedFixtures } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G2a (D-059) — diagnosis attribution and the one-primary-per-visit rule,
// exercised against the REAL database and the REAL HTTP API.
//
// The unit tests mock Prisma, so they prove the service's intent. This proves
// the parts only the database can settle: the partial unique index, and what
// actually happens when two "make this primary" requests race.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g2a-diagnosis-integrity-check.ts
const API = 'http://localhost:3000';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let ledger: FixtureLedger | undefined;

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
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await call(path, token, method, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

async function main() {
  assertFixturesAllowed();

  const seeds = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<
      { user_id: string; staff_id: string; tenant_id: string; role: string; full_name: string; tenant_name: string }[]
    >(`
      SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, s.full_name, t.name AS tenant_name
      FROM staff s JOIN users u ON s.user_id = u.id JOIN tenants t ON t.id = s.tenant_id
      WHERE s.active AND s.role IN ('DOCTOR_RESIDENT','DOCTOR_LOCUM')
    `);
  });
  const seed = seeds[0];
  const otherTenantSeed = seeds.find((s) => s.tenant_id !== seed.tenant_id);

  const tokenFor = (s: typeof seed) =>
    jwt.sign(
      { sub: s.user_id, tenantId: s.tenant_id, staffId: s.staff_id, role: s.role },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: '30m' },
    );
  const token = tokenFor(seed);

  const swept = await sweepOrphanedFixtures(prisma, seed.tenant_id);
  if (swept > 0) console.log(`Swept ${swept} leftover fixture visit(s)`);
  ledger = new FixtureLedger(prisma, API, token, seed.tenant_id);

  const patients = await api('/patients', token);
  const clinics = await api('/clinics', token);
  const visit = await api('/visits', token, 'POST', {
    clinicId: clinics[0].id,
    patientId: patients[0].id,
    staffId: seed.staff_id,
    billingType: 'Cash',
    presentingComplaint: fixtureLabel('G2a diagnosis integrity'),
  });
  ledger.visit(visit.id);

  const catalog = await api('/diagnosis-catalog?search=a&category=SUMMARIZE', token);
  const made: { id: string }[] = [];
  for (const entry of catalog.slice(0, 4)) {
    made.push(await api('/diagnoses', token, 'POST', { visitId: visit.id, diagnosisCatalogId: entry.id }));
  }
  check('4 diagnoses created', made.length === 4, `${made.length} created`);

  // 1 — real session attribution
  const fresh = await api(`/diagnoses?visitId=${visit.id}`, token);
  check(
    'new diagnosis carries the session staff id',
    fresh.every((d: { addedByStaffId: string }) => d.addedByStaffId === seed.staff_id),
    `all attributed to ${seed.staff_id.slice(0, 8)}`,
  );
  // 3 — snapshots
  check(
    'name and role snapshots are stored',
    fresh.every(
      (d: { addedByNameSnapshot: string; addedByRoleSnapshot: string }) =>
        d.addedByNameSnapshot === seed.full_name && d.addedByRoleSnapshot === seed.role,
    ),
    `"${fresh[0].addedByNameSnapshot}" / ${fresh[0].addedByRoleSnapshot}`,
  );
  check(
    'new diagnoses are not flagged as legacy',
    fresh.every((d: { legacyAttributionUnknown: boolean }) => !d.legacyAttributionUnknown),
    'legacyAttributionUnknown=false',
  );
  check(
    'new diagnoses start with no recorded priority',
    fresh.every((d: { priority: string | null }) => d.priority === null),
    'priority=null until the doctor sets it',
  );

  // 2 — browser-supplied attribution is rejected outright
  const spoof = await call('/diagnoses', token, 'POST', {
    visitId: visit.id,
    diagnosisCatalogId: catalog[0].id,
    addedByStaffId: 'attacker-staff-id',
  });
  check(
    'browser-supplied addedByStaffId is rejected with 400',
    spoof.status === 400,
    `HTTP ${spoof.status} ${JSON.stringify(spoof.body?.message ?? '').slice(0, 90)}`,
  );

  // 5 — exactly one primary
  await api(`/diagnoses/${made[0].id}/priority`, token, 'PATCH', { priority: 'PRIMARY' });
  let list = await api(`/diagnoses?visitId=${visit.id}`, token);
  check(
    'marking one diagnosis primary yields exactly one PRIMARY',
    list.filter((d: { priority: string }) => d.priority === 'PRIMARY').length === 1,
    `${list.filter((d: { priority: string }) => d.priority === 'PRIMARY').length} primary`,
  );
  check(
    'the primary diagnosis is returned first',
    list[0].id === made[0].id,
    'PRIMARY sorts ahead of the rest',
  );

  // 6 — switching primary demotes the previous one to SECONDARY
  await api(`/diagnoses/${made[1].id}/priority`, token, 'PATCH', { priority: 'PRIMARY' });
  list = await api(`/diagnoses?visitId=${visit.id}`, token);
  const byId = new Map(list.map((d: { id: string; priority: string | null }) => [d.id, d.priority]));
  check(
    'switching primary leaves exactly one PRIMARY',
    list.filter((d: { priority: string }) => d.priority === 'PRIMARY').length === 1,
    `new primary = ${byId.get(made[1].id)}`,
  );
  check(
    'the previous primary becomes SECONDARY, not unrecorded',
    byId.get(made[0].id) === 'SECONDARY',
    `previous primary is now ${byId.get(made[0].id)}`,
  );

  // 6b — concurrent race. Two different diagnoses promoted at the same time.
  const [raceA, raceB] = await Promise.all([
    call(`/diagnoses/${made[2].id}/priority`, token, 'PATCH', { priority: 'PRIMARY' }),
    call(`/diagnoses/${made[3].id}/priority`, token, 'PATCH', { priority: 'PRIMARY' }),
  ]);
  list = await api(`/diagnoses?visitId=${visit.id}`, token);
  const primaries = list.filter((d: { priority: string }) => d.priority === 'PRIMARY').length;
  check(
    'concurrent promotions never leave two primaries',
    primaries === 1,
    `HTTP ${raceA.status}/${raceB.status} → ${primaries} primary afterwards`,
  );

  // Clearing priority
  const stillPrimary = list.find((d: { priority: string }) => d.priority === 'PRIMARY');
  await api(`/diagnoses/${stillPrimary.id}/priority`, token, 'PATCH', { priority: null });
  list = await api(`/diagnoses?visitId=${visit.id}`, token);
  check(
    'priority can be cleared back to "not recorded"',
    list.filter((d: { priority: string }) => d.priority === 'PRIMARY').length === 0,
    'no primary recorded',
  );

  // 4 + 10 — legacy rows keep their honest state and survived the migration
  const legacy = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${seed.tenant_id}, true)`;
    return tx.$queryRawUnsafe<{ n: number; with_priority: number; with_author: number }[]>(`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE priority IS NOT NULL)::int AS with_priority,
             count(*) FILTER (WHERE added_by_staff_id IS NOT NULL)::int AS with_author
        FROM diagnoses WHERE legacy_attribution_unknown = true`);
  });
  check(
    'legacy diagnoses were never given invented attribution',
    legacy[0].with_author === 0,
    `${legacy[0].n} legacy row(s), ${legacy[0].with_author} with an author`,
  );
  check(
    'legacy diagnoses were never given an invented priority',
    legacy[0].with_priority === 0,
    `${legacy[0].with_priority} with a priority`,
  );

  // 7 — cross-tenant isolation.
  //
  // Every active doctor with a login belongs to one tenant in this dataset, so
  // there is no second real doctor to act as. Instead, mint a token scoped to a
  // DIFFERENT tenant — which is exactly the shape of a forged or misrouted
  // token — and confirm RLS hides the first tenant's diagnoses from it.
  const otherTenant = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const rows = await tx.$queryRawUnsafe<{ id: string; name: string }[]>(
      `SELECT id, name FROM tenants WHERE id <> '${seed.tenant_id}' LIMIT 1`,
    );
    return rows[0] ?? null;
  });

  if (otherTenant) {
    const foreignToken = jwt.sign(
      { sub: seed.user_id, tenantId: otherTenant.id, staffId: seed.staff_id, role: seed.role },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: '30m' },
    );
    const cross = await call(`/diagnoses?visitId=${visit.id}`, foreignToken);
    const leaked = Array.isArray(cross.body) ? cross.body.length : -1;
    check(
      `a token scoped to another tenant ("${otherTenant.name}") sees none of this visit’s diagnoses`,
      leaked === 0,
      `HTTP ${cross.status}, ${leaked} row(s) visible`,
    );
    const crossWrite = await call(`/diagnoses/${made[0].id}/priority`, foreignToken, 'PATCH', { priority: 'PRIMARY' });
    check(
      'a token scoped to another tenant cannot change this diagnosis',
      crossWrite.status >= 400,
      `HTTP ${crossWrite.status}`,
    );
    // And the record is genuinely untouched afterwards.
    const after = await api(`/diagnoses?visitId=${visit.id}`, token);
    check(
      'the cross-tenant attempt left the record unchanged',
      after.filter((d: { priority: string }) => d.priority === 'PRIMARY').length === 0,
      'still no primary recorded',
    );
  } else {
    console.log('SKIP  cross-tenant — only one tenant exists in this database');
  }
  void otherTenantSeed;

  // 9 — catalogue search still works, all three sources
  for (const category of ['SUMMARIZE', 'FULL', 'CUSTOM']) {
    const hits = await api(`/diagnosis-catalog?search=a&category=${category}`, token);
    check(`catalogue search still works (${category})`, Array.isArray(hits), `${hits.length} result(s)`);
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
    await ledger?.cleanup();
    await prisma.$disconnect();
  });
