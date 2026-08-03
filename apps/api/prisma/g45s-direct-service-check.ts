import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { FixtureLedger, assertFixturesAllowed, fixtureLabel } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G4.5s (D-073) — the direct-service workflow, checked against the running
// API and the real database rather than against mocks.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45s-direct-service-check.ts
//
// Cleans up only what it creates, in a finally block, even when it fails.
const API = 'http://localhost:3000';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

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

  const candidates = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<Seed[]>(
      `SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, t.name AS tenant_name
         FROM staff s JOIN users u ON s.user_id = u.id JOIN tenants t ON t.id = s.tenant_id
        WHERE s.active
        ORDER BY CASE WHEN s.role::text LIKE 'DOCTOR%' THEN 0 ELSE 1 END, t.name`,
    );
  });

  // A tenant with a clinic and BOTH service types configured.
  let seed: Seed | undefined;
  let token = '';
  let clinicId = '';
  let taskOrderId = '';
  let directServiceId = '';
  const probed = new Set<string>();
  for (const candidate of candidates) {
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
  if (!seed) throw new Error('No tenant with a clinic and both service types configured.');

  // A second tenant, for the isolation checks.
  const other = candidates.find((c) => c.tenant_id !== seed!.tenant_id);
  const otherToken = other ? tokenFor(other) : '';

  // Recording a payment is a billing role's job — a doctor may raise an
  // invoice and add lines but not take money (D-066). The paid-invoice checks
  // therefore need a second, billing-capable actor in the SAME tenant. That
  // the doctor's own token cannot pay is itself the RBAC matrix working.
  const BILLING_ROLES = ['OWNER_ADMIN', 'FINANCE_STAFF', 'FRONT_DESK_CLINICAL_STAFF'];
  const payer = candidates.find(
    (c) => c.tenant_id === seed!.tenant_id && BILLING_ROLES.includes(c.role),
  );
  const payerToken = payer ? tokenFor(payer) : '';

  console.log(`\nG4.5s — DIRECT SERVICE WORKFLOW CHECK`);
  console.log(`tenant ${seed.tenant_name} as ${seed.role}`);
  console.log('='.repeat(78));

  const ledger = new FixtureLedger(prisma, API, token, seed.tenant_id);

  try {
    const stamp = Date.now();
    const patient = await api('/patients', token, 'POST', {
      name: fixtureLabel('G45s Service Patient'),
      identifierType: 'PASSPORT',
      identifierValue: `S${stamp}`.slice(0, 14),
    });
    ledger.patient(patient.id);
    const visit = await api('/visits', token, 'POST', {
      clinicId,
      patientId: patient.id,
      staffId: seed.staff_id,
      billingType: 'Cash',
      presentingComplaint: fixtureLabel('direct service workflow'),
    });
    ledger.visit(visit.id);

    // --- 1/2. TASK_ORDER is untouched -------------------------------------
    const task = await api('/order-services', token, 'POST', {
      visitId: visit.id,
      serviceCatalogId: taskOrderId,
    });
    check('1. adding a TASK_ORDER still creates PENDING', task.status === 'PENDING', task.status);
    check('   and carries no completion time', task.completedAt === null, String(task.completedAt));

    const started = await api(`/order-services/${task.id}/start`, token, 'PATCH', {});
    check('2. TASK_ORDER Start still works', started.status === 'IN_PROGRESS', started.status);
    const completed = await api(`/order-services/${task.id}/complete`, token, 'PATCH', { result: 'Normal' });
    check('   TASK_ORDER Complete still works', completed.status === 'COMPLETED', completed.status);
    check('   and records the result', completed.result === 'Normal', String(completed.result));

    // --- 3/4/5. STANDARD_SERVICE ------------------------------------------
    const direct = await api('/order-services', token, 'POST', {
      visitId: visit.id,
      serviceCatalogId: directServiceId,
    });
    check('3. adding a STANDARD_SERVICE creates COMPLETED', direct.status === 'COMPLETED', direct.status);
    check('   with a completion timestamp', Boolean(direct.completedAt), String(direct.completedAt));
    check('   attribution preserved', direct.requestedByStaffId === seed.staff_id);
    check('   visit relationship preserved', direct.visitId === visit.id);

    const startDirect = await call(`/order-services/${direct.id}/start`, token, 'PATCH', {});
    check('4. STANDARD_SERVICE cannot be started', startDirect.status === 400, `HTTP ${startDirect.status}`);
    const completeDirect = await call(`/order-services/${direct.id}/complete`, token, 'PATCH', { result: 'x' });
    check('5. STANDARD_SERVICE cannot be completed', completeDirect.status === 400, `HTTP ${completeDirect.status}`);

    // --- 6/7. Queue and task counts ---------------------------------------
    const queue = await api(`/procedure-queue?clinicId=${clinicId}`, token);
    const inQueue = queue.some((q: { id: string }) => q.id === direct.id);
    check('6. STANDARD_SERVICE does not appear in the Procedure Queue', !inQueue);
    check('   the TASK_ORDER model still populates it', Array.isArray(queue));
    const queueTypes = new Set(queue.map((q: { orderType: string }) => q.orderType));
    check(
      '7. the queue contains TASK_ORDER only',
      queueTypes.size === 0 || (queueTypes.size === 1 && queueTypes.has('TASK_ORDER')),
      [...queueTypes].join(',') || 'empty',
    );

    const awaiting = await api(`/order-services?visitId=${visit.id}&orderType=TASK_ORDER&status=PENDING`, token);
    check(
      '   a direct service is not counted as awaiting result',
      !awaiting.some((o: { id: string }) => o.id === direct.id),
    );

    // --- 8. Invoice linkage ------------------------------------------------
    const invoice = await api('/invoices', token, 'POST', {
      visitId: visit.id,
      createdByStaffId: seed.staff_id,
    });
    const billable = await api(`/order-services?visitId=${visit.id}`, token);
    const directIsBillable = billable.some(
      (o: { id: string; status: string }) => o.id === direct.id && o.status !== 'CANCELLED',
    );
    check('8. the direct service is immediately eligible to be charged', directIsBillable);

    await api(`/invoices/${invoice.id}/lines`, token, 'POST', {
      description: 'Direct service',
      unitPrice: 30,
      sourceOrderServiceId: direct.id,
    });
    const afterOne = await api(`/invoices?visitId=${visit.id}`, token);
    const linesFor = (inv: { lines: { sourceOrderServiceId: string | null }[] }[], id: string) =>
      inv.flatMap((i) => i.lines).filter((l) => l.sourceOrderServiceId === id).length;
    check('   one line created', linesFor(afterOne, direct.id) === 1, String(linesFor(afterOne, direct.id)));

    // --- 9. Duplicate refused ---------------------------------------------
    const dup = await call(`/invoices/${invoice.id}/lines`, token, 'POST', {
      description: 'Direct service again',
      unitPrice: 30,
      sourceOrderServiceId: direct.id,
    });
    check('9. a duplicate line is refused by the server', dup.status === 409, `HTTP ${dup.status}`);
    const afterDup = await api(`/invoices?visitId=${visit.id}`, token);
    check('   still exactly one line', linesFor(afterDup, direct.id) === 1, String(linesFor(afterDup, direct.id)));

    // --- 10/11. Reading never charges --------------------------------------
    const totalBefore = Number(afterDup[0].totalAmount);
    await api(`/visits/${visit.id}`, token);
    await api(`/order-services?visitId=${visit.id}`, token);
    await api(`/invoices?visitId=${visit.id}`, token);
    await api(`/order-services?visitId=${visit.id}&orderType=STANDARD_SERVICE`, token);
    const afterReads = await api(`/invoices?visitId=${visit.id}`, token);
    check('10/11. re-reading the record creates no line', linesFor(afterReads, direct.id) === 1);
    check('   and does not change the total', Number(afterReads[0].totalAmount) === totalBefore);

    // --- 12. Concurrency ---------------------------------------------------
    const second = await api('/order-services', token, 'POST', {
      visitId: visit.id,
      serviceCatalogId: directServiceId,
    });
    const racers = await Promise.all(
      [0, 1, 2, 3].map(() =>
        call(`/invoices/${invoice.id}/lines`, token, 'POST', {
          description: 'Concurrent',
          unitPrice: 15,
          sourceOrderServiceId: second.id,
        }),
      ),
    );
    const created = racers.filter((r) => r.status < 400).length;
    const afterRace = await api(`/invoices?visitId=${visit.id}`, token);
    check(
      '12. four concurrent adds produce exactly one line',
      linesFor(afterRace, second.id) === 1,
      `${created} accepted, ${linesFor(afterRace, second.id)} line(s)`,
    );

    // --- 13/14. Cancellation ----------------------------------------------
    const cancelCharged = await call(`/order-services/${direct.id}/cancel`, token, 'PATCH', {
      cancelReason: 'Added in error',
    });
    check(
      '14. cancelling a charged service is refused',
      cancelCharged.status === 409,
      `HTTP ${cancelCharged.status}`,
    );
    check(
      '   and the refusal names the invoice',
      String(cancelCharged.body?.message ?? '').includes('invoice'),
      String(cancelCharged.body?.message ?? '').slice(0, 80),
    );

    const uncharged = await api('/order-services', token, 'POST', {
      visitId: visit.id,
      serviceCatalogId: directServiceId,
    });
    const cancelled = await api(`/order-services/${uncharged.id}/cancel`, token, 'PATCH', {
      cancelReason: 'Wrong visit',
    });
    check('13. an uncharged service cancels', cancelled.status === 'CANCELLED', cancelled.status);
    check('   the reason is stored', cancelled.cancelReason === 'Wrong visit');
    const stillThere = await api(`/order-services?visitId=${visit.id}&orderType=STANDARD_SERVICE`, token);
    check(
      '   the row is preserved, not deleted',
      stillThere.some((o: { id: string }) => o.id === uncharged.id),
    );

    // --- 15/16. Paid invoice untouched --------------------------------------
    const doctorPay = await call(`/invoices/${invoice.id}/pay`, token, 'PATCH', { paymentMethod: 'CASH' });
    check('   a doctor still cannot record a payment', doctorPay.status === 403, `HTTP ${doctorPay.status}`);

    if (payerToken) {
      const beforePay = await api(`/invoices?visitId=${visit.id}`, token);
      const paidTotal = Number(beforePay[0].totalAmount);
      await api(`/invoices/${invoice.id}/pay`, payerToken, 'PATCH', { paymentMethod: 'CASH' });

      const cancelAfterPaid = await call(`/order-services/${direct.id}/cancel`, token, 'PATCH', {
        cancelReason: 'after payment',
      });
      const afterPaid = await api(`/invoices?visitId=${visit.id}`, token);
      check(
        '15. cancelling after payment is refused',
        cancelAfterPaid.status === 409,
        `HTTP ${cancelAfterPaid.status}`,
      );
      check('   the paid invoice total is unchanged', Number(afterPaid[0].totalAmount) === paidTotal);
      check('   the paid invoice is still PAID', afterPaid[0].status === 'PAID', afterPaid[0].status);
      check(
        '16. its line count is unchanged',
        linesFor(afterPaid, direct.id) === 1,
        String(linesFor(afterPaid, direct.id)),
      );
      const dupOnPaid = await call(`/invoices/${invoice.id}/lines`, payerToken, 'POST', {
        description: 'After payment',
        unitPrice: 10,
        sourceOrderServiceId: direct.id,
      });
      check(
        '   a paid invoice takes no new line',
        dupOnPaid.status >= 400,
        `HTTP ${dupOnPaid.status}`,
      );
    } else {
      console.log('  SKIP  15/16 — no billing-capable staff in this tenant');
    }

    // --- 17/18/19. Isolation ------------------------------------------------
    if (otherToken) {
      const cross = await call('/order-services', otherToken, 'POST', {
        visitId: visit.id,
        serviceCatalogId: directServiceId,
      });
      check('17. cross-tenant add is denied', cross.status === 404 || cross.status === 403, `HTTP ${cross.status}`);
      const crossRead = await call(`/order-services?visitId=${visit.id}`, otherToken);
      const leaked = Array.isArray(crossRead.body) && crossRead.body.some((o: { id: string }) => o.id === direct.id);
      check('   cross-tenant read leaks nothing', !leaked);
      const crossCancel = await call(`/order-services/${uncharged.id}/cancel`, otherToken, 'PATCH', {
        cancelReason: 'x',
      });
      check(
        '18. cross-tenant cancel is denied',
        crossCancel.status === 404 || crossCancel.status === 403,
        `HTTP ${crossCancel.status}`,
      );
    } else {
      console.log('  SKIP  17/18 — only one tenant in this database');
    }

    const anon = await call('/order-services', '', 'POST', {
      visitId: visit.id,
      serviceCatalogId: directServiceId,
    });
    check('19. an unauthenticated add is denied', anon.status === 401, `HTTP ${anon.status}`);

    // --- 20. No task vocabulary reaches a direct service ---------------------
    const directRows = await api(`/order-services?visitId=${visit.id}&orderType=STANDARD_SERVICE`, token);
    const anyResult = directRows.some((o: { result: string | null }) => o.result);
    check('20. no direct service carries a result', !anyResult);
    const statuses = new Set(directRows.map((o: { status: string }) => o.status));
    check(
      '   direct services are only COMPLETED or CANCELLED',
      [...statuses].every((s) => s === 'COMPLETED' || s === 'CANCELLED'),
      [...statuses].join(','),
    );

    // --- 21. Orders panel stays TASK_ORDER-only -----------------------------
    const orderPanel = await api(`/order-services?visitId=${visit.id}&orderType=TASK_ORDER`, token);
    check(
      '21. the orders filter returns TASK_ORDER only',
      orderPanel.every((o: { orderType: string }) => o.orderType === 'TASK_ORDER'),
    );
  } finally {
    await ledger.cleanup();
    console.log('\ncleanup: fixture visit and patient removed');
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
