import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { FixtureLedger, assertFixturesAllowed, fixtureLabel, sweepOrphanedFixtures } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G4c1 (D-068) — safe visit-number allocation, against the REAL database and
// HTTP API with REAL concurrency (no mocks).
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g4c1-visit-number-check.ts
const API = 'http://localhost:3000';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let ledger: FixtureLedger | undefined;
let secondaryLedger: FixtureLedger | undefined;

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

// D-048 — `visits` and `visit_number_counters` are FORCE'd and their policies
// key on app.tenant_id ONLY; the bypass GUC does not cover them. A helper that
// set only the bypass would read zero rows and insert nothing, silently, which
// is exactly how an earlier version of this script produced three false
// failures. Both GUCs are set, and the tenant is always explicit.
const asTenant = <T>(
  tenantId: string,
  fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });

const bypass = <T>(fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return fn(tx);
  });

const counterFor = async (tenantId: string) => {
  const rows = await asTenant(tenantId, (tx) =>
    tx.$queryRawUnsafe<{ next_value: number }[]>(
      `SELECT next_value FROM visit_number_counters WHERE tenant_id = '${tenantId}'`,
    ),
  );
  return rows[0]?.next_value ?? null;
};

const numbersFor = async (tenantId: string) => {
  const rows = await asTenant(tenantId, (tx) =>
    tx.$queryRawUnsafe<{ visit_number: string }[]>(
      `SELECT visit_number FROM visits WHERE tenant_id = '${tenantId}' ORDER BY visit_number`,
    ),
  );
  return rows.map((r) => r.visit_number);
};

async function main() {
  assertFixturesAllowed();

  const tokenFor = (s: { user_id: string; tenant_id: string; staff_id: string; role: string }) =>
    jwt.sign({ sub: s.user_id, tenantId: s.tenant_id, staffId: s.staff_id, role: s.role },
      process.env.JWT_ACCESS_SECRET as string, { expiresIn: '60m' });

  const candidates = await bypass((tx) =>
    tx.$queryRawUnsafe<
      { user_id: string; staff_id: string; tenant_id: string; role: string; full_name: string; tenant_name: string }[]
    >(`SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, s.full_name, t.name AS tenant_name
       FROM staff s JOIN users u ON s.user_id = u.id JOIN tenants t ON t.id = s.tenant_id
       WHERE s.active ORDER BY t.name`),
  );

  // Two tenants with a clinic each, so tenant scoping can be proven rather
  // than assumed.
  const usable: (typeof candidates[number] & { clinicId: string; token: string })[] = [];
  const seenTenant = new Set<string>();
  for (const candidate of candidates) {
    if (seenTenant.has(candidate.tenant_id)) continue;
    const token = tokenFor(candidate);
    const clinics = await call('/clinics', token);
    if (clinics.status === 200 && clinics.body.length > 0) {
      seenTenant.add(candidate.tenant_id);
      usable.push({ ...candidate, clinicId: clinics.body[0].id, token });
    }
  }
  if (usable.length === 0) throw new Error('No tenant with a login and a clinic.');
  const primary = usable[0];
  const secondary = usable.find((t) => t.tenant_id !== primary.tenant_id);
  console.log(`Primary tenant: ${primary.tenant_name}${secondary ? ` · secondary: ${secondary.tenant_name}` : ' (no second tenant)'}`);

  const swept = await sweepOrphanedFixtures(prisma, primary.tenant_id);
  if (swept > 0) console.log(`Swept ${swept} leftover fixture visit(s)`);
  if (secondary) {
    const sweptB = await sweepOrphanedFixtures(prisma, secondary.tenant_id);
    if (sweptB > 0) console.log(`Swept ${sweptB} leftover fixture visit(s) in ${secondary.tenant_name}`);
  }
  ledger = new FixtureLedger(prisma, API, primary.token, primary.tenant_id);

  // ---------------------------------------------------------------- baseline
  const before = await numbersFor(primary.tenant_id);
  const counterBefore = await counterFor(primary.tenant_id);
  console.log(`Existing visits in primary tenant: ${before.length} · counter: ${counterBefore}`);
  check(
    'the migration seeded a counter for the tenant',
    counterBefore !== null,
    `next_value = ${counterBefore}`,
  );

  const highestBefore = before
    .filter((n) => /^V-\d{1,9}$/.test(n))
    .reduce((max, n) => Math.max(max, Number(n.slice(2))), 0);
  check(
    'the counter is at least the highest number already in use',
    (counterBefore ?? 0) >= highestBefore,
    `counter ${counterBefore} ≥ highest existing ${highestBefore}`,
  );

  // The seeding proof that matters: a tenant that ALREADY had visits before
  // this migration. An empty tenant seeding to 0 proves nothing — the first
  // version of this migration seeded nothing at all and still looked correct
  // on an empty tenant.
  const populated: { name: string; counter: number | null; highest: number; malformed: number }[] = [];
  const allTenants = await bypass((tx) =>
    tx.$queryRawUnsafe<{ id: string; name: string }[]>('SELECT id, name FROM tenants ORDER BY name'),
  );
  for (const t of allTenants) {
    const stats = await asTenant(t.id, (tx) =>
      tx.$queryRawUnsafe<{ n: number; highest: number; malformed: number }[]>(`
        SELECT count(*)::int AS n,
               COALESCE(MAX(CASE WHEN visit_number ~ '^V-[0-9]{1,9}$'
                            THEN substring(visit_number from 3)::int END), 0) AS highest,
               count(*) FILTER (WHERE visit_number !~ '^V-[0-9]{1,9}$')::int AS malformed
          FROM visits`),
    );
    if (stats[0].n > 0) {
      populated.push({ name: t.name, counter: await counterFor(t.id), highest: stats[0].highest, malformed: stats[0].malformed });
    }
  }
  const seededCorrectly = populated.filter((t) => (t.counter ?? -1) >= t.highest);
  check(
    'every tenant that already had visits was seeded from its highest valid number',
    populated.length > 0 && seededCorrectly.length === populated.length,
    populated.length === 0
      ? 'no populated tenant in this database — seeding not proven'
      : populated.map((t) => `${t.name}: highest ${t.highest}, ${t.malformed} malformed → counter ${t.counter}`).join(' · '),
  );

  const patient = await api('/patients', primary.token, 'POST', {
    name: fixtureLabel('G4c1 Numbering Patient'),
    identifierType: 'PASSPORT',
    identifierValue: `G4C1${Date.now()}`.slice(0, 14),
  });
  ledger.patient(patient.id);

  const makeVisit = (t: typeof primary, label: string) =>
    call('/visits', t.token, 'POST', {
      clinicId: t.clinicId,
      patientId: patient.id,
      staffId: t.staff_id,
      billingType: 'Cash',
      presentingComplaint: fixtureLabel(label),
    });

  // ------------------------------------------------- 3 · create after delete
  const first = await makeVisit(primary, 'G4c1 first');
  check('a visit can be created through the API', first.status === 201, `HTTP ${first.status} ${first.body?.visitNumber}`);
  ledger.visit(first.body.id);

  const doomedNumber = first.body.visitNumber as string;
  await asTenant(primary.tenant_id, (tx) => tx.$executeRawUnsafe(`DELETE FROM visits WHERE id = '${first.body.id}'`));

  const second = await makeVisit(primary, 'G4c1 after delete');
  check(
    'creating a visit AFTER a deletion succeeds (the original defect)',
    second.status === 201,
    `HTTP ${second.status} ${second.body?.visitNumber}`,
  );
  if (second.status === 201) ledger.visit(second.body.id);
  check(
    'a deleted visit number is never reissued',
    second.body?.visitNumber !== doomedNumber,
    `deleted ${doomedNumber} → next issued ${second.body?.visitNumber}`,
  );

  // ------------------------------------------------------- 4/5 · concurrency
  const burst = async (n: number, label: string) => {
    const settled = await Promise.all(
      Array.from({ length: n }, (_, i) => makeVisit(primary, `${label} ${i}`)),
    );
    const ok = settled.filter((r) => r.status === 201);
    ok.forEach((r) => ledger!.visit(r.body.id));
    const numbers = ok.map((r) => r.body.visitNumber as string);
    return { settled, ok, numbers, unique: new Set(numbers) };
  };

  const twenty = await burst(20, 'G4c1 concurrent20');
  check(
    '20 simultaneous creations all succeed',
    twenty.ok.length === 20,
    `${twenty.ok.length}/20 created (${twenty.settled.filter((r) => r.status !== 201).map((r) => r.status).join(',') || 'no failures'})`,
  );
  check(
    '20 simultaneous creations produce 20 UNIQUE numbers',
    twenty.unique.size === twenty.numbers.length && twenty.numbers.length === 20,
    `${twenty.unique.size} distinct of ${twenty.numbers.length}`,
  );

  const fifty = await burst(50, 'G4c1 concurrent50');
  check(
    '50 simultaneous creations produce no duplicate',
    fifty.unique.size === fifty.numbers.length,
    `${fifty.unique.size} distinct of ${fifty.numbers.length} created`,
  );

  // -------------------------------------------------------------- 6 · format
  const allNew = [...twenty.numbers, ...fifty.numbers];
  const malformed = allNew.filter((n) => !/^V-\d{6,}$/.test(n));
  check('every allocated number keeps the established format', malformed.length === 0,
    malformed.length === 0 ? `${allNew.length} numbers all match V-NNNNNN` : malformed.join(', '));

  // --------------------------------------- 7 · failed creation does not leak
  const counterBeforeFailure = await counterFor(primary.tenant_id);
  const failed = await call('/visits', primary.token, 'POST', {
    clinicId: primary.clinicId,
    patientId: '00000000-0000-4000-8000-000000000000',
    staffId: primary.staff_id,
    billingType: 'Cash',
    presentingComplaint: fixtureLabel('G4c1 should fail'),
  });
  check('a creation with a bad patient is refused', failed.status >= 400, `HTTP ${failed.status}`);
  const phantom = await asTenant(primary.tenant_id, (tx) =>
    tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM visits WHERE presenting_complaint LIKE '%G4c1 should fail%'`,
    ),
  );
  check('a failed creation leaves no phantom visit', phantom[0].n === 0, `${phantom[0].n} row(s)`);
  const counterAfterFailure = await counterFor(primary.tenant_id);
  check(
    'a failed creation does not corrupt the counter',
    (counterAfterFailure ?? 0) >= (counterBeforeFailure ?? 0),
    `${counterBeforeFailure} → ${counterAfterFailure} (a rolled-back attempt may leave it unchanged)`,
  );

  // --------------------------------------------- 8 · reads allocate nothing
  const counterBeforeReads = await counterFor(primary.tenant_id);
  await api(`/visits?patientId=${patient.id}`, primary.token);
  await api(`/visits/${second.body.id}`, primary.token);
  await api(`/patients/${patient.id}/history`, primary.token);
  const counterAfterReads = await counterFor(primary.tenant_id);
  check(
    'opening or refreshing a visit allocates no number',
    counterAfterReads === counterBeforeReads,
    `counter unchanged at ${counterAfterReads}`,
  );

  // ------------------------------------------------- 9 · queue creation path
  const counterBeforeQueue = await counterFor(primary.tenant_id);
  const ticket = await call('/queue-tickets', primary.token, 'POST', {
    clinicId: primary.clinicId,
    patientId: patient.id,
    staffId: primary.staff_id,
    billingType: 'Cash',
    presentingComplaint: fixtureLabel('G4c1 queue path'),
    queueType: 'WALK_IN',
  });
  if (ticket.status === 201) {
    const queueVisitId = ticket.body.visitId ?? ticket.body.visit?.id;
    if (queueVisitId) ledger.visit(queueVisitId);
    const counterAfterQueue = await counterFor(primary.tenant_id);
    check(
      'the Queue "Add to Daily Queue" path uses the same allocator',
      (counterAfterQueue ?? 0) === (counterBeforeQueue ?? 0) + 1 &&
        /^V-\d{6,}$/.test(ticket.body.visit?.visitNumber ?? ''),
      `counter ${counterBeforeQueue} → ${counterAfterQueue}, visit ${ticket.body.visit?.visitNumber}`,
    );
  } else {
    check('the Queue "Add to Daily Queue" path uses the same allocator', false, `HTTP ${ticket.status} ${JSON.stringify(ticket.body).slice(0, 120)}`);
  }

  // ------------------------------------------------ 12/13 · tenant isolation
  if (secondary) {
    const counterA = await counterFor(primary.tenant_id);
    const counterB = await counterFor(secondary.tenant_id);
    const otherPatient = await api('/patients', secondary.token, 'POST', {
      name: fixtureLabel('G4c1 Other Tenant Patient'),
      identifierType: 'PASSPORT',
      identifierValue: `G4C1B${Date.now()}`.slice(0, 14),
    });
    // Tenant B's OWN patient. An earlier version of this script posted tenant
    // A's patientId with tenant B's token; the API accepted it and produced
    // cross-tenant visit rows, which is reported separately as a pre-existing
    // validation gap. This check must not create them.
    const scopedVisit = await call('/visits', secondary.token, 'POST', {
      clinicId: secondary.clinicId,
      patientId: otherPatient.id,
      staffId: secondary.staff_id,
      billingType: 'Cash',
      presentingComplaint: fixtureLabel('G4c1 other tenant'),
    });
    const counterAafter = await counterFor(primary.tenant_id);
    const counterBafter = await counterFor(secondary.tenant_id);
    check(
      'each tenant advances only its own counter',
      counterAafter === counterA && (counterBafter ?? 0) > (counterB ?? 0),
      `A ${counterA}→${counterAafter} (unchanged), B ${counterB}→${counterBafter}`,
    );
    check(
      'both tenants may hold the same visit number independently',
      scopedVisit.status === 201,
      `tenant B issued ${scopedVisit.body?.visitNumber}`,
    );
    // Tracked, not hand-deleted: the ledger removes children before parents.
    secondaryLedger = new FixtureLedger(prisma, API, secondary.token, secondary.tenant_id);
    if (scopedVisit.status === 201) secondaryLedger.visit(scopedVisit.body.id);
    secondaryLedger.patient(otherPatient.id);
  } else {
    check('each tenant advances only its own counter', true, 'only one usable tenant in this database — not exercised');
  }

  // ------------------------- 14/15 · malformed legacy + controlled collision
  // A number written OUTSIDE the allocator, exactly as the G4 fixture had to
  // do while this defect existed, plus a malformed legacy value.
  const nowCounter = (await counterFor(primary.tenant_id)) ?? 0;
  const collidingNumber = `V-${String(nowCounter + 1).padStart(6, '0')}`;
  const [planted] = await asTenant(primary.tenant_id, (tx) =>
    tx.$queryRawUnsafe<{ id: string }[]>(`
      INSERT INTO visits (id, tenant_id, clinic_id, patient_id, staff_id, visit_number, billing_type,
        presenting_complaint, check_in_at, created_at, updated_at)
      VALUES (gen_random_uuid(), '${primary.tenant_id}', '${primary.clinicId}', '${patient.id}',
        '${primary.staff_id}', '${collidingNumber}', 'Cash',
        '${fixtureLabel('G4c1 planted collision')}', now(), now(), now())
      RETURNING id`),
  );
  ledger.visit(planted.id);
  const [legacy] = await asTenant(primary.tenant_id, (tx) =>
    tx.$queryRawUnsafe<{ id: string }[]>(`
      INSERT INTO visits (id, tenant_id, clinic_id, patient_id, staff_id, visit_number, billing_type,
        presenting_complaint, check_in_at, created_at, updated_at)
      VALUES (gen_random_uuid(), '${primary.tenant_id}', '${primary.clinicId}', '${patient.id}',
        '${primary.staff_id}', 'LEGACY/2019/0042', 'Cash',
        '${fixtureLabel('G4c1 malformed legacy')}', now(), now(), now())
      RETURNING id`),
  );
  ledger.visit(legacy.id);

  const afterCollision = await makeVisit(primary, 'G4c1 after planted collision');
  check(
    'a number written outside the allocator does not break creation',
    afterCollision.status === 201,
    `HTTP ${afterCollision.status} → ${afterCollision.body?.visitNumber} (planted ${collidingNumber})`,
  );
  if (afterCollision.status === 201) ledger.visit(afterCollision.body.id);
  check(
    'no raw unique-constraint error reaches the client',
    afterCollision.status !== 500 && !JSON.stringify(afterCollision.body ?? {}).includes('P2002'),
    `HTTP ${afterCollision.status}`,
  );
  check(
    'a malformed historical number does not block allocation',
    afterCollision.status === 201,
    'LEGACY/2019/0042 present and ignored for seeding',
  );

  // ============================================ additional allocator evidence

  // 2 · a known existing number is followed exactly.
  //
  // Run in the SECONDARY tenant, whose numbering is still low. Forcing the
  // primary tenant's counter down to 125 would legitimately collide with the
  // V-000126 this run already created and trigger the repair — correct
  // behaviour, but it would prove nothing about "125 → 126".
  if (secondary) {
    const patientS = await api('/patients', secondary.token, 'POST', {
      name: fixtureLabel('G4c1 Sequence Patient'),
      identifierType: 'PASSPORT',
      identifierValue: `G4C1S${Date.now()}`.slice(0, 14),
    });
    secondaryLedger = secondaryLedger ?? new FixtureLedger(prisma, API, secondary.token, secondary.tenant_id);
    secondaryLedger.patient(patientS.id);

    // What matters is that V-000126 and V-000127 are FREE, not that the tenant
    // numbers below 125 — a higher number elsewhere in the sequence does not
    // stop the counter being set to 125 and continuing correctly from there.
    const inTheWay = await asTenant(secondary.tenant_id, (tx) =>
      tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM visits WHERE visit_number IN ('V-000126','V-000127')`),
    );
    if (inTheWay[0].n === 0) {
      await asTenant(secondary.tenant_id, (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE visit_number_counters SET next_value = 125 WHERE tenant_id = '${secondary.tenant_id}'`),
      );
      const mkS = (label: string) =>
        call('/visits', secondary.token, 'POST', {
          clinicId: secondary.clinicId, patientId: patientS.id, staffId: secondary.staff_id,
          billingType: 'Cash', presentingComplaint: fixtureLabel(label),
        });

      const after125 = await mkS('G4c1 after 125');
      if (after125.status === 201) secondaryLedger.visit(after125.body.id);
      check(
        'a counter at 125 produces V-000126',
        after125.body?.visitNumber === 'V-000126',
        `issued ${after125.body?.visitNumber} (HTTP ${after125.status})`,
      );

      // 3 · deleting that number does not make it available again.
      if (after125.status === 201) {
        await asTenant(secondary.tenant_id, (tx) =>
          tx.$executeRawUnsafe(`DELETE FROM visits WHERE id = '${after125.body.id}'`),
        );
      }
      const afterMiddleDelete = await mkS('G4c1 after middle delete');
      if (afterMiddleDelete.status === 201) secondaryLedger.visit(afterMiddleDelete.body.id);
      check(
        'a deleted number is not reissued',
        afterMiddleDelete.body?.visitNumber === 'V-000127',
        `deleted ${after125.body?.visitNumber} → next ${afterMiddleDelete.body?.visitNumber}`,
      );
    } else {
      check('a counter at 125 produces V-000126', false,
        `secondary tenant already numbers above 125 (highest ${highestInSecondary[0].highest})`);
      check('a deleted number is not reissued', false, 'not exercised');
    }
  } else {
    check('a counter at 125 produces V-000126', false, 'no second tenant available');
    check('a deleted number is not reissued', false, 'not exercised');
  }

  // 7 · every branch in a tenant draws from ONE sequence.
  //
  // D-069 requires the acting staff member to be authorised for the branch, so
  // this needs a real staff member per branch rather than one token used for
  // both — which is exactly how a clinic would do it.
  const branchStaff = await asTenant(primary.tenant_id, (tx) =>
    tx.$queryRawUnsafe<{ user_id: string; staff_id: string; role: string; clinic_id: string }[]>(`
      SELECT DISTINCT ON (s.clinic_id) u.id AS user_id, s.id AS staff_id, s.role::text AS role, s.clinic_id
        FROM staff s JOIN users u ON s.user_id = u.id
       WHERE s.active AND s.clinic_id IS NOT NULL AND s.tenant_id = '${primary.tenant_id}'
       ORDER BY s.clinic_id, s.id`),
  );
  // Only tokens that the API itself accepts — a row can look active in SQL and
  // still be refused by requireActor, and a fixture must not assert against a
  // session the server would reject.
  const usableBranchStaff: typeof branchStaff = [];
  for (const s of branchStaff) {
    const probe = await call('/clinics', tokenFor({ ...s, tenant_id: primary.tenant_id }));
    if (probe.status === 200) usableBranchStaff.push(s);
    if (usableBranchStaff.length === 2) break;
  }
  if (usableBranchStaff.length > 1) {
    const [one, two] = usableBranchStaff;
    const mk = (s: typeof one, label: string) =>
      call('/visits', tokenFor({ ...s, tenant_id: primary.tenant_id }), 'POST', {
        clinicId: s.clinic_id, patientId: patient.id, staffId: s.staff_id,
        billingType: 'Cash', presentingComplaint: fixtureLabel(label),
      });
    const inBranchA = await mk(one, 'G4c1 branch A');
    const inBranchB = await mk(two, 'G4c1 branch B');
    if (inBranchA.status === 201) ledger.visit(inBranchA.body.id);
    if (inBranchB.status === 201) ledger.visit(inBranchB.body.id);
    const a = Number(String(inBranchA.body?.visitNumber ?? '').slice(2));
    const b = Number(String(inBranchB.body?.visitNumber ?? '').slice(2));
    check(
      'branches inside one tenant share a single sequence',
      inBranchA.status === 201 && inBranchB.status === 201 && b === a + 1,
      `${inBranchA.body?.visitNumber} (HTTP ${inBranchA.status}) → ${inBranchB.body?.visitNumber} (HTTP ${inBranchB.status}: ${inBranchB.body?.message ?? ""})`,
    );
  } else {
    // Structural fallback: the counter is keyed by tenant alone, so a branch
    // cannot have its own sequence even in principle.
    const key = await asTenant(primary.tenant_id, (tx) =>
      tx.$queryRawUnsafe<{ indexdef: string }[]>(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'visit_number_counters'`),
    );
    check(
      'branches inside one tenant share a single sequence',
      key.every((k) => !k.indexdef.includes('clinic')),
      `no staff assigned to a second branch; counter key is tenant-only: ${key.map((k) => k.indexdef.split('USING')[1]?.trim()).join(', ')}`,
    );
  }

  // 16 · the six-digit ceiling is refused, clearly, and the last number is usable.
  const restore = await counterFor(primary.tenant_id);
  await asTenant(primary.tenant_id, (tx) =>
    tx.$executeRawUnsafe(`UPDATE visit_number_counters SET next_value = 999998 WHERE tenant_id = '${primary.tenant_id}'`),
  );
  const lastUsable = await makeVisit(primary, 'G4c1 last usable');
  if (lastUsable.status === 201) ledger.visit(lastUsable.body.id);
  check(
    'the last number the format can hold is still issued',
    lastUsable.body?.visitNumber === 'V-999999',
    `issued ${lastUsable.body?.visitNumber}`,
  );
  const overflow = await makeVisit(primary, 'G4c1 overflow');
  check(
    'allocation beyond V-999999 is refused with a clear message',
    overflow.status === 409 && /maximum visit number/i.test(JSON.stringify(overflow.body ?? {})),
    `HTTP ${overflow.status} — ${overflow.body?.message ?? ''}`,
  );
  const counterAfterOverflow = await counterFor(primary.tenant_id);
  check(
    'a refused overflow leaves the counter at the ceiling, not past it',
    counterAfterOverflow === 999999,
    `counter ${counterAfterOverflow}`,
  );
  await asTenant(primary.tenant_id, (tx) =>
    tx.$executeRawUnsafe(`UPDATE visit_number_counters SET next_value = ${restore ?? 0} WHERE tenant_id = '${primary.tenant_id}'`),
  );

  // 17 · the counter table is tenant-isolated like the visits it numbers.
  const visibleToPrimary = await asTenant(primary.tenant_id, (tx) =>
    tx.$queryRawUnsafe<{ tenant_id: string }[]>('SELECT tenant_id FROM visit_number_counters'),
  );
  check(
    'the counter table is tenant-isolated',
    visibleToPrimary.length === 1 && visibleToPrimary[0].tenant_id === primary.tenant_id,
    `${visibleToPrimary.length} row(s) visible under this tenant context`,
  );
  const withoutTenantGuc = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<{ n: number }[]>('SELECT count(*)::int AS n FROM visit_number_counters');
  });
  check(
    'the bypass GUC alone does not expose counters (matches the visits policy)',
    withoutTenantGuc[0].n === 0,
    `${withoutTenantGuc[0].n} row(s) without app.tenant_id — same rule as visits`,
  );

  // ---------------------------------------------- 1 · nothing was renumbered
  const stillThere = await numbersFor(primary.tenant_id);
  const missing = before.filter((n) => !stillThere.includes(n));
  check(
    'existing visit numbers are unchanged',
    missing.length === 0,
    before.length === 0 ? 'no pre-existing visits in this database' : `${before.length} preserved`,
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
    await ledger?.cleanup();
    await secondaryLedger?.cleanup();
    await prisma.$disconnect();
  });
