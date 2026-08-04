import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertFixturesAllowed, fixtureLabel } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G4.5d3c-3b (D-095) — LIVE verification of the queue split and Complete Visit.
//
// Proves against the running API and the real database:
//   - every queue status reaches a stage and is counted (nothing vanishes);
//   - cancelled work is excluded from active counts;
//   - the valid routes complete, including the ones that skip stages;
//   - a panel-covered visit completes without the panel having paid;
//   - dispensing cannot be bypassed by ANY role, owner included;
//   - an outstanding patient balance holds the visit in Payment;
//   - completion sets checkOutAt and the ticket status through the ONE
//     authoritative service, appends a workflow event, and is atomic and
//     idempotent under concurrent submission;
//   - completion changes no stock, no invoice total and no panel receivable.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45d3c3b-queue-completion-check.ts
//                                          [--seed-only]
const API = 'http://localhost:3000';
const TENANT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SEED_ONLY = process.argv.includes('--seed-only');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

function scoped<T>(fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, TENANT_ID);
    return fn(tx);
  });
}

async function login(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'DevLocal!2026' }),
  });
  const body = (await res.json()) as { accessToken?: string };
  if (!body.accessToken) throw new Error(`Login failed for ${email}`);
  return body.accessToken;
}

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await call(path, token, method, body);
  if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

interface Ids {
  clinicId: string;
  doctorId: string;
  frontDeskId: string;
  itemId: string;
  serviceId: string;
  panelId: string;
}

async function ids(): Promise<Ids> {
  return scoped(async (tx) => {
    const clinic = await tx.clinic.findFirst({ select: { id: true } });
    const item = await tx.item.findFirst({ where: { sellPrice: { gt: 0 } }, select: { id: true } });
    const service = await tx.serviceCatalog.findFirst({ where: { name: 'Consultation (Day)' }, select: { id: true } });
    const staff = await tx.staff.findMany({ select: { id: true, role: true } });
    const panel = await tx.panelClinic.findFirst({ where: { name: 'MARA' }, select: { id: true } });
    const doctor = staff.find((s) => s.role === 'DOCTOR_RESIDENT' || s.role === 'DOCTOR_LOCUM');
    const frontDesk = staff.find((s) => s.role === 'FRONT_DESK_CLINICAL_STAFF');
    if (!clinic || !item || !service || !doctor || !frontDesk || !panel) {
      throw new Error('Dev tenant is missing a clinic, item, consultation service, doctor, front desk or MARA panel.');
    }
    return {
      clinicId: clinic.id, doctorId: doctor.id, frontDeskId: frontDesk.id,
      itemId: item.id, serviceId: service.id, panelId: panel.id,
    };
  });
}

const created: string[] = [];

/** A visit already past its doctor phase, parked at the given queue status. */
async function makeVisit(
  i: Ids,
  opts: {
    label: string;
    status: string;
    doctorCompleted?: boolean;
    panel?: boolean;
    patientName?: string;
    classification?: string | null;
  },
): Promise<{ visitId: string; ticketId: string; patientId: string }> {
  return scoped(async (tx) => {
    const panel = opts.panel ? await tx.panelClinic.findUnique({ where: { id: i.panelId }, select: { name: true } }) : null;
    const patient = await tx.patient.create({
      data: {
        tenantId: TENANT_ID,
        name: opts.patientName ?? fixtureLabel(opts.label),
        identifierType: 'PASSPORT',
        identifierValue: `QC${Date.now()}${Math.floor(Math.random() * 1000)}`,
      },
    });
    const visit = await tx.visit.create({
      data: {
        tenantId: TENANT_ID,
        clinicId: i.clinicId,
        patientId: patient.id,
        staffId: i.doctorId,
        billingType: panel?.name ?? 'Self-pay',
        panelClinicId: opts.panel ? i.panelId : null,
        panelVerificationStatus: opts.panel ? 'VERIFIED' : null,
        panelCoverageType: opts.panel ? 'UNLIMITED' : null,
        classification: (opts.classification ?? 'FOLLOW_UP_NO_CONSULTATION') as never,
        visitNumber: `QV-${Date.now() % 1000000}-${Math.floor(Math.random() * 100)}`,
        presentingComplaint: fixtureLabel(opts.label),
        doctorCompletedAt: opts.doctorCompleted === false ? null : new Date(),
        doctorCompletedByStaffId: opts.doctorCompleted === false ? null : i.doctorId,
      },
    });
    const ticket = await tx.queueTicket.create({
      data: {
        tenantId: TENANT_ID,
        clinicId: i.clinicId,
        visitId: visit.id,
        ticketNumber: Math.floor(Math.random() * 900) + 100,
        displayNumber: `W${Math.floor(Math.random() * 900) + 100}`,
        queueType: 'WALK_IN',
        status: opts.status as never,
      },
    });
    created.push(visit.id);
    return { visitId: visit.id, ticketId: ticket.id, patientId: patient.id };
  });
}

async function boardRow(token: string, clinicId: string, visitId: string) {
  const board = await api(`/queue-tickets/board?clinicId=${clinicId}`, token);
  return {
    board,
    row: board.rows.find((r: { visitId: string }) => r.visitId === visitId),
  };
}

async function main() {
  assertFixturesAllowed();
  const i = await ids();
  const fd = await login('siti.front@smoke-test-clinic.test');
  const owner = await login('owner.admin@smoke-test-clinic.test');
  const doc = await login('amira.rahman@smoke-test-clinic.test');

  console.log('\nG4.5d3c-3b — queue split and Complete Visit, live');
  console.log('='.repeat(70));

  try {
    if (SEED_ONLY) {
      const waiting = await makeVisit(i, { label: 'queue waiting', status: 'WAITING', doctorCompleted: false, patientName: 'Lim Wei Jie' });
      const consult = await makeVisit(i, { label: 'queue consultation', status: 'IN_CONSULTATION', doctorCompleted: false, patientName: 'Siti Nurhaliza binti Omar' });
      const procedure = await makeVisit(i, { label: 'queue at procedure', status: 'AT_PROCEDURE', doctorCompleted: false, patientName: 'Rajesh a/l Kumaran' });

      // Dispensary: real ordered medication so the blocker is genuine.
      const dispensary = await makeVisit(i, { label: 'queue dispensary', status: 'READY_FOR_DISPENSARY', patientName: 'Nur Aisyah binti Kamal' });
      await scoped((tx) =>
        tx.prescription.createMany({
          data: [
            { tenantId: TENANT_ID, visitId: dispensary.visitId, itemId: i.itemId, quantity: 10, amount: 1, frequency: 'TDS', durationDays: 5, prescribedByStaffId: i.doctorId, supplyMode: 'ONSITE_DISPENSE', status: 'DISPENSED', dispensedAt: new Date() },
            { tenantId: TENANT_ID, visitId: dispensary.visitId, itemId: i.itemId, quantity: 6, amount: 1, frequency: 'BD', durationDays: 3, prescribedByStaffId: i.doctorId, supplyMode: 'ONSITE_DISPENSE', status: 'ORDERED' },
          ],
        }),
      );

      // Payment: one with a balance due, one fully panel-covered, one needing review.
      const balanceDue = await makeVisit(i, { label: 'queue balance due', status: 'READY_FOR_PAYMENT', patientName: 'Ahmad Firdaus bin Yusof' });
      const inv1 = await api('/invoices', fd, 'POST', { visitId: balanceDue.visitId, createdByStaffId: i.frontDeskId });
      await api(`/invoices/${inv1.id}/lines`, fd, 'POST', { description: 'Wound dressing', quantity: 1, unitPrice: 45 });

      const panelCovered = await makeVisit(i, { label: 'queue panel covered', status: 'READY_FOR_PAYMENT', panel: true, patientName: 'Tan Wei Ming' });
      const inv2 = await api('/invoices', fd, 'POST', { visitId: panelCovered.visitId, createdByStaffId: i.frontDeskId });
      await api(`/invoices/${inv2.id}/lines`, fd, 'POST', { description: 'Nebuliser', quantity: 1, unitPrice: 60 });

      const settled = await makeVisit(i, { label: 'queue settled', status: 'READY_FOR_PAYMENT', patientName: 'Kavitha a/p Selvam' });
      const inv3 = await api('/invoices', fd, 'POST', { visitId: settled.visitId, createdByStaffId: i.frontDeskId });
      await api(`/invoices/${inv3.id}/lines`, fd, 'POST', { description: 'Consultation', quantity: 1, unitPrice: 35 });
      await api(`/invoices/${inv3.id}/pay`, fd, 'PATCH', { paymentMethod: 'CASH' });

      console.log('SCREENSHOT FIXTURES (clinic %s)', i.clinicId);
      console.log(`  waiting        ${waiting.visitId}`);
      console.log(`  consultation   ${consult.visitId}`);
      console.log(`  at procedure   ${procedure.visitId}`);
      console.log(`  dispensary     ${dispensary.visitId}`);
      console.log(`  balance due    ${balanceDue.visitId}`);
      console.log(`  panel covered  ${panelCovered.visitId}`);
      console.log(`  settled        ${settled.visitId}`);
      return;
    }

    // --- 1–7/10/11. Every status reaches a stage; cancelled is not active ---
    {
      const made = await Promise.all([
        makeVisit(i, { label: 'stage waiting', status: 'WAITING', doctorCompleted: false }),
        makeVisit(i, { label: 'stage consult', status: 'IN_CONSULTATION', doctorCompleted: false }),
        makeVisit(i, { label: 'stage procedure', status: 'AT_PROCEDURE', doctorCompleted: false }),
        makeVisit(i, { label: 'stage dispensary', status: 'READY_FOR_DISPENSARY' }),
        makeVisit(i, { label: 'stage payment', status: 'READY_FOR_PAYMENT' }),
        makeVisit(i, { label: 'stage legacy', status: 'DISPENSARY_PAYMENT' }),
        makeVisit(i, { label: 'stage cancelled', status: 'CANCELLED' }),
      ]);
      const board = await api(`/queue-tickets/board?clinicId=${i.clinicId}`, fd);
      const byVisit = new Map(board.rows.map((r: { visitId: string }) => [r.visitId, r]));
      const stages = made.map((m) => (byVisit.get(m.visitId) as { stage: string | null })?.stage);
      check('1–6/8. every live status maps to a stage — none vanishes',
        JSON.stringify(stages) === JSON.stringify(['WAITING', 'CONSULTATION', 'CONSULTATION', 'DISPENSARY', 'PAYMENT', 'PAYMENT', null]),
        JSON.stringify(stages));
      check('3. AT_PROCEDURE is flagged for its Consultation row',
        (byVisit.get(made[2].visitId) as { atProcedure: boolean })?.atProcedure === true);
      check('8. the legacy combined status is flagged',
        (byVisit.get(made[5].visitId) as { legacyStatus: boolean })?.legacyStatus === true);
      check('7. CANCELLED is not counted as active work',
        (byVisit.get(made[6].visitId) as { stage: string | null })?.stage === null && board.counts.cancelled >= 1);
      check('10. counts are separated per stage',
        board.counts.waiting >= 1 && board.counts.consultation >= 2 && board.counts.dispensary >= 1 && board.counts.payment >= 2,
        JSON.stringify(board.counts));
    }

    // --- 27/28. Dispensing cannot be bypassed, by ANYONE -------------------
    {
      const visit = await makeVisit(i, { label: 'dispensing blocked', status: 'READY_FOR_DISPENSARY' });
      await scoped((tx) =>
        tx.prescription.create({
          data: {
            tenantId: TENANT_ID, visitId: visit.visitId, itemId: i.itemId, quantity: 5, amount: 1,
            frequency: 'BD', durationDays: 3, prescribedByStaffId: i.doctorId,
            supplyMode: 'ONSITE_DISPENSE', status: 'ORDERED',
          },
        }),
      );
      const { row } = await boardRow(fd, i.clinicId, visit.visitId);
      check('4/27. an undispensed visit sits in Dispensary and is not completable',
        row?.stage === 'DISPENSARY' && row?.canComplete === false &&
          row?.blockers?.some((b: { code: string }) => b.code === 'DISPENSING_PENDING'));
      check('the row reports dispensing progress',
        row?.dispensing?.onsiteTotal === 1 && row?.dispensing?.remaining === 1,
        JSON.stringify(row?.dispensing));

      const asFrontDesk = await call(`/visits/${visit.visitId}/complete`, fd, 'PATCH', {});
      const asOwner = await call(`/visits/${visit.visitId}/complete`, owner, 'PATCH', {});
      check('28. the OWNER cannot override an incomplete dispensing either',
        asFrontDesk.status === 400 && asOwner.status === 400,
        `front desk ${asFrontDesk.status}, owner ${asOwner.status}`);
      const stillOpen = await scoped((tx) => tx.visit.findUnique({ where: { id: visit.visitId }, select: { checkOutAt: true } }));
      check('…and the visit stays open', stillOpen?.checkOutAt === null);
    }

    // --- 30/31. An outstanding balance holds the visit in Payment ----------
    {
      const visit = await makeVisit(i, { label: 'balance blocked', status: 'READY_FOR_PAYMENT' });
      const invoice = await api('/invoices', fd, 'POST', { visitId: visit.visitId, createdByStaffId: i.frontDeskId });
      await api(`/invoices/${invoice.id}/lines`, fd, 'POST', { description: 'Dressing', quantity: 1, unitPrice: 45 });
      const { row } = await boardRow(fd, i.clinicId, visit.visitId);
      check('30/31. an outstanding balance blocks completion and states the amount',
        row?.canComplete === false && row?.billing?.remainingBalance === '45.00' &&
          row?.blockers?.some((b: { code: string }) => b.code === 'PATIENT_BALANCE_REMAINING'),
        `balance ${row?.billing?.remainingBalance}`);
      const refused = await call(`/visits/${visit.visitId}/complete`, fd, 'PATCH', {});
      check('…and the server refuses completion', refused.status === 400, `HTTP ${refused.status}`);
    }

    // --- 12/13/14/15. The valid routes complete ---------------------------
    for (const [label, status] of [
      ['13. Consultation → Payment → Completed', 'READY_FOR_PAYMENT'],
      ['14. Consultation → Dispensary → Completed', 'READY_FOR_DISPENSARY'],
      ['15. Consultation → Completed with no downstream work', 'IN_CONSULTATION'],
    ] as const) {
      const visit = await makeVisit(i, { label: `route ${status}`, status });
      const { row } = await boardRow(fd, i.clinicId, visit.visitId);
      check(`${label}: the board says completable`, row?.canComplete === true,
        `blockers ${JSON.stringify(row?.blockers)}`);
      const result = await api(`/visits/${visit.visitId}/complete`, fd, 'PATCH', {});
      check(`${label}: completes`, result.queueStatus === 'COMPLETED' && Boolean(result.checkOutAt));
    }

    // --- 16. A panel-covered visit completes without the panel paying ------
    {
      const visit = await makeVisit(i, { label: 'panel covered', status: 'READY_FOR_PAYMENT', panel: true });
      const invoice = await api('/invoices', fd, 'POST', { visitId: visit.visitId, createdByStaffId: i.frontDeskId });
      await api(`/invoices/${invoice.id}/lines`, fd, 'POST', { description: 'Nebuliser', quantity: 1, unitPrice: 60 });
      const { row } = await boardRow(fd, i.clinicId, visit.visitId);
      check('16. the panel carries the bill and the patient owes nothing',
        row?.billing?.state === 'SETTLED' && Number(row?.billing?.panelResponsibility) === 60 &&
          row?.billing?.remainingBalance === '0.00',
        `panel ${row?.billing?.panelResponsibility}, patient owes ${row?.billing?.remainingBalance}`);
      const result = await api(`/visits/${visit.visitId}/complete`, fd, 'PATCH', {});
      check('16. …and the visit completes without the panel having paid the clinic',
        result.queueStatus === 'COMPLETED');
      const claim = await scoped((tx) => tx.claimBatchLine.count({ where: { invoiceId: invoice.id } }));
      check('43. completion did NOT mark the panel receivable collected', claim === 0);
    }

    // --- 20/21. Permissions ------------------------------------------------
    {
      const visit = await makeVisit(i, { label: 'permission', status: 'READY_FOR_PAYMENT' });
      const asDoctor = await call(`/visits/${visit.visitId}/complete`, doc, 'PATCH', {});
      check('20. a doctor may not complete a visit', asDoctor.status === 403, `HTTP ${asDoctor.status}`);
      const board = await api(`/queue-tickets/board?clinicId=${i.clinicId}`, doc);
      check('46. …and the doctor’s board withholds the completion decision',
        board.mayCompleteVisits === false &&
          board.rows.every((r: { canComplete: boolean }) => r.canComplete === false));
      const asOwner = await api(`/visits/${visit.visitId}/complete`, owner, 'PATCH', {});
      check('17. the owner may complete an eligible visit', asOwner.queueStatus === 'COMPLETED');
    }

    // --- 35–45. Completion effects ----------------------------------------
    {
      const visit = await makeVisit(i, { label: 'effects', status: 'READY_FOR_PAYMENT' });
      const invoice = await api('/invoices', fd, 'POST', { visitId: visit.visitId, createdByStaffId: i.frontDeskId });
      await api(`/invoices/${invoice.id}/lines`, fd, 'POST', { description: 'Consultation', quantity: 1, unitPrice: 35 });
      await api(`/invoices/${invoice.id}/pay`, fd, 'PATCH', { paymentMethod: 'CASH' });
      const beforeStock = await scoped((tx) => tx.stockMovement.count({ where: { clinicId: i.clinicId } }));
      const beforeInvoice = await scoped((tx) =>
        tx.invoice.findUnique({ where: { id: invoice.id }, select: { totalAmount: true, patientPaidAmount: true } }),
      );

      const result = await api(`/visits/${visit.visitId}/complete`, fd, 'PATCH', {});
      const after = await scoped(async (tx) => ({
        visit: await tx.visit.findUnique({ where: { id: visit.visitId }, select: { checkOutAt: true } }),
        ticket: await tx.queueTicket.findUnique({ where: { id: visit.ticketId }, select: { status: true } }),
        events: await tx.visitWorkflowEvent.count({ where: { visitId: visit.visitId, eventType: 'VISIT_COMPLETED' } }),
        stock: await tx.stockMovement.count({ where: { clinicId: i.clinicId } }),
        invoice: await tx.invoice.findUnique({ where: { id: invoice.id }, select: { totalAmount: true, patientPaidAmount: true } }),
      }));
      check('35. the ticket becomes COMPLETED', after.ticket?.status === 'COMPLETED');
      check('36. checkOutAt is set', after.visit?.checkOutAt !== null);
      check('37. exactly one VISIT_COMPLETED event is appended', after.events === 1, `${after.events} event(s)`);
      check('41. completion changed NO stock', after.stock === beforeStock);
      check('42. completion changed NO invoice total or payment',
        String(after.invoice?.totalAmount) === String(beforeInvoice?.totalAmount) &&
          String(after.invoice?.patientPaidAmount) === String(beforeInvoice?.patientPaidAmount));
      check('the completed visit leaves the active stages', Boolean(result.checkOutAt));

      // 39/40. Concurrency and repetition.
      const repeat = await api(`/visits/${visit.visitId}/complete`, fd, 'PATCH', {});
      check('40. a repeated submission reports the ORIGINAL completion, not a second one',
        repeat.alreadyCompleted === true &&
          new Date(repeat.checkOutAt).getTime() === new Date(result.checkOutAt).getTime());
      const eventsAfterRepeat = await scoped((tx) =>
        tx.visitWorkflowEvent.count({ where: { visitId: visit.visitId, eventType: 'VISIT_COMPLETED' } }),
      );
      check('40. …and writes no second completion event', eventsAfterRepeat === 1);
    }

    // --- 38/39. Concurrent submissions produce ONE completion --------------
    {
      const visit = await makeVisit(i, { label: 'concurrency', status: 'READY_FOR_PAYMENT' });
      const results = await Promise.all(
        Array.from({ length: 4 }, () => call(`/visits/${visit.visitId}/complete`, fd, 'PATCH', {})),
      );
      const ok = results.filter((r) => r.status < 400);
      const fresh = ok.filter((r) => r.body?.alreadyCompleted === false);
      const events = await scoped((tx) =>
        tx.visitWorkflowEvent.count({ where: { visitId: visit.visitId, eventType: 'VISIT_COMPLETED' } }),
      );
      check('38/39. four CONCURRENT completions produce exactly ONE completion',
        fresh.length === 1 && events === 1, `${fresh.length} fresh, ${events} event(s)`);
    }

    // --- 34. A stage that cannot complete ---------------------------------
    {
      const visit = await makeVisit(i, { label: 'waiting ineligible', status: 'WAITING', doctorCompleted: false });
      const { row } = await boardRow(fd, i.clinicId, visit.visitId);
      check('34. a WAITING visit is never offered completion', row?.canComplete === false);
      const refused = await call(`/visits/${visit.visitId}/complete`, fd, 'PATCH', {});
      check('34. …and the server refuses it', refused.status === 400, `HTTP ${refused.status}`);
    }
  } finally {
    if (!SEED_ONLY && created.length > 0) {
      await scoped(async (tx) => {
        const list = created.map((id) => `'${id}'`).join(',');
        await tx.$executeRawUnsafe(`DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE visit_id IN (${list}))`);
        await tx.$executeRawUnsafe(`DELETE FROM invoices WHERE visit_id IN (${list})`);
        await tx.$executeRawUnsafe(`DELETE FROM stock_movements WHERE reference_id IN (SELECT id FROM prescriptions WHERE visit_id IN (${list}))`);
        await tx.$executeRawUnsafe(`DELETE FROM prescriptions WHERE visit_id IN (${list})`);
        await tx.$executeRawUnsafe(`DELETE FROM order_services WHERE visit_id IN (${list})`);
        // Append-only workflow events keep their tickets alive; the synthetic
        // rows are closed and their patients soft-deleted instead.
        await tx.$executeRawUnsafe(`UPDATE queue_tickets SET status = 'COMPLETED' WHERE visit_id IN (${list})`);
        await tx.$executeRawUnsafe(`UPDATE visits SET check_out_at = COALESCE(check_out_at, now()) WHERE id IN (${list})`);
        await tx.$executeRawUnsafe(`UPDATE patients SET deleted_at = now() WHERE id IN (SELECT patient_id FROM visits WHERE id IN (${list}))`);
      });
    }
  }

  if (!SEED_ONLY) {
    console.log('='.repeat(70));
    console.log(`${passed} passed, ${failed} failed\n`);
    process.exit(failed === 0 ? 0 : 1);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
