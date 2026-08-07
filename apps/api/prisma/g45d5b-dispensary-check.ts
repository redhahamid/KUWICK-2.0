import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertFixturesAllowed, fixtureLabel } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G4.5d5b — LIVE proof of the dispensary, against the running API over real
// HTTP.
//
// The unit specs prove the services. This proves the SYSTEM: that the role
// gate and the branch gate are actually wired in front of the routes, that a
// client-supplied quantity is ignored, that dispensing moves stock and the
// queue in one step, and — the property with the sharpest edge — that
// printing a label moves NOTHING.
//
// Every hostile case is sent the way an attacker would send it: a direct
// fetch, with no browser anywhere in the path, which is why hiding a button
// was never a control.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45d5b-dispensary-check.ts
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45d5b-dispensary-check.ts --seed-only
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

async function call(
  method: 'GET' | 'POST',
  path: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const created: string[] = [];

interface Seeded {
  visitId: string;
  ticketId: string;
  prescriptionIds: string[];
  itemIds: string[];
}

/**
 * A visit sitting at the dispensary with a realistic mix.
 *
 * Three clinic-supplied rows (one plentiful, one short, one already
 * dispensed), one external prescription and one with an unresolved supply
 * mode — because a board that has only ever seen the happy case is a board
 * whose refusals have never run.
 */
async function seedVisit(
  clinicId: string,
  doctorId: string,
  label: string,
  opts: { status?: string } = {},
): Promise<Seeded> {
  return scoped(async (tx) => {
    // The catalogue has no drug flag; medication items are the ones a
    // prescription can point at, so any active item serves here.
    const items = await tx.item.findMany({ where: { active: true }, take: 5, select: { id: true } });
    if (items.length < 4) throw new Error('Dev tenant needs at least four drug items.');

    const patient = await tx.patient.create({
      data: {
        tenantId: TENANT_ID,
        name: fixtureLabel(label),
        identifierType: 'PASSPORT',
        identifierValue: `DS${Date.now()}${Math.floor(Math.random() * 1000)}`,
      },
    });
    const visit = await tx.visit.create({
      data: {
        tenantId: TENANT_ID,
        clinicId,
        patientId: patient.id,
        staffId: doctorId,
        billingType: 'Self-pay',
        classification: 'FOLLOW_UP_NO_CONSULTATION',
        visitNumber: `DV-${Date.now() % 1000000}-${Math.floor(Math.random() * 100)}`,
        presentingComplaint: fixtureLabel(label),
        doctorCompletedAt: new Date(),
      },
    });
    const ticket = await tx.queueTicket.create({
      data: {
        tenantId: TENANT_ID,
        clinicId,
        visitId: visit.id,
        ticketNumber: Math.floor(Math.random() * 900) + 100,
        displayNumber: `D${Math.floor(Math.random() * 900) + 100}`,
        queueType: 'WALK_IN',
        status: (opts.status ?? 'READY_FOR_DISPENSARY') as never,
      },
    });

    // Plenty on the shelf for the first item, deliberately short for the
    // second, so both the ordinary path and the shortage path are live.
    await tx.stockLevel.upsert({
      where: { tenantId_clinicId_itemId: { tenantId: TENANT_ID, clinicId, itemId: items[0].id } },
      create: { tenantId: TENANT_ID, clinicId, itemId: items[0].id, quantityOnHand: 500 },
      update: { quantityOnHand: 500 },
    });
    await tx.stockLevel.upsert({
      where: { tenantId_clinicId_itemId: { tenantId: TENANT_ID, clinicId, itemId: items[1].id } },
      create: { tenantId: TENANT_ID, clinicId, itemId: items[1].id, quantityOnHand: 2 },
      update: { quantityOnHand: 2 },
    });

    const base = {
      tenantId: TENANT_ID,
      visitId: visit.id,
      prescribedByStaffId: doctorId,
      amount: '1',
      unit: 'tablet',
      frequency: 'TDS',
      durationDays: 5,
    };
    const plentiful = await tx.prescription.create({
      data: { ...base, itemId: items[0].id, quantity: 15, supplyMode: 'ONSITE_DISPENSE', status: 'ORDERED' },
    });
    const short = await tx.prescription.create({
      data: { ...base, itemId: items[1].id, quantity: 20, supplyMode: 'ONSITE_DISPENSE', status: 'ORDERED' },
    });
    const external = await tx.prescription.create({
      data: { ...base, itemId: items[2].id, quantity: 10, supplyMode: 'EXTERNAL_PRESCRIPTION', status: 'ORDERED' },
    });
    const unresolved = await tx.prescription.create({
      data: { ...base, itemId: items[3].id, quantity: 6, supplyMode: null, status: 'ORDERED' },
    });

    created.push(visit.id);
    return {
      visitId: visit.id,
      ticketId: ticket.id,
      prescriptionIds: [plentiful.id, short.id, external.id, unresolved.id],
      itemIds: items.slice(0, 4).map((item) => item.id),
    };
  });
}

async function main() {
  assertFixturesAllowed();
  const owner = await login('owner.admin@smoke-test-clinic.test');
  const front = await login('siti.front@smoke-test-clinic.test');
  const finance = await login('faiz.finance@smoke-test-clinic.test');

  const { clinicId, doctorId } = await scoped(async (tx) => {
    const clinic = await tx.clinic.findFirst({ select: { id: true } });
    const staff = await tx.staff.findMany({ select: { id: true, role: true } });
    const doctor = staff.find((s) => s.role === 'DOCTOR_RESIDENT' || s.role === 'DOCTOR_LOCUM');
    if (!clinic || !doctor) throw new Error('Dev tenant is missing a clinic or a doctor.');
    return { clinicId: clinic.id, doctorId: doctor.id };
  });

  if (SEED_ONLY) {
    const seeded = await seedVisit(clinicId, doctorId, 'dispensary review');
    console.log(`clinicId=${clinicId}`);
    console.log(`visitId=${seeded.visitId}`);
    console.log(`prescriptionId=${seeded.prescriptionIds[0]}`);
    await prisma.$disconnect();
    return;
  }

  console.log('\nG4.5d5b — dispensary, labels and routing, live over HTTP');
  console.log('='.repeat(72));

  try {
    const seeded = await seedVisit(clinicId, doctorId, 'dispensary live');
    const [plentiful, short, external, unresolved] = seeded.prescriptionIds;

    // === 1–4. The board ================================================
    {
      const board = await call('GET', `/dispensary/board?clinicId=${clinicId}`, front);
      const row = board.body?.rows?.find((r: any) => r.visitId === seeded.visitId);
      check('1. the board answers and carries the seeded visit', board.status === 200 && Boolean(row),
        `HTTP ${board.status}`);
      check('2. only clinic-supplied medication is dispensary work',
        row?.medications?.length === 2 &&
          !row.medications.some((m: any) => m.prescriptionId === external || m.prescriptionId === unresolved),
        `${row?.medications?.length} cards`);
      check('3. an unresolved supply mode is counted separately, not hidden',
        row?.unresolvedCount === 1, `unresolvedCount=${row?.unresolvedCount}`);
      check('4. the shortage is visible before anything is dispensed',
        row?.hasStockWarning === true &&
          row.medications.some((m: any) => m.stock.state === 'INSUFFICIENT'),
        `hasStockWarning=${row?.hasStockWarning}`);
    }

    // === 5–8. Permission is the SERVER'S ===============================
    {
      const anon = await call('GET', `/dispensary/board?clinicId=${clinicId}`, null);
      check('5. an unauthenticated board read is refused', anon.status === 401, `HTTP ${anon.status}`);

      const financeBoard = await call('GET', `/dispensary/board?clinicId=${clinicId}`, finance);
      check('6. finance may not even view the dispensary', financeBoard.status === 403,
        `HTTP ${financeBoard.status}`);

      const financeDispense = await call('POST', '/dispensary/dispense', finance, {
        visitId: seeded.visitId,
        prescriptionIds: [plentiful],
      });
      check('7. finance is refused at the dispense route, not just in the UI',
        financeDispense.status === 403, `HTTP ${financeDispense.status}`);

      const stillOrdered = await scoped((tx) =>
        tx.prescription.findUnique({ where: { id: plentiful }, select: { status: true } }),
      );
      check('8. the refused call changed nothing', stillOrdered?.status === 'ORDERED',
        `${stillOrdered?.status}`);
    }

    // === 9–11. A label is assembled from the RECORD =====================
    {
      const preview = await call('GET', `/dispensary/prescriptions/${plentiful}/label-preview`, front);
      check('9. the label preview comes from the prescription',
        preview.status === 200 && Boolean(preview.body?.medication?.name) && Boolean(preview.body?.prescriber),
        `HTTP ${preview.status}`);

      const printsBefore = await scoped((tx) => tx.labelPrint.count({ where: { prescriptionId: plentiful } }));
      check('10. previewing records NO print', printsBefore === 0, `${printsBefore} rows`);

      const forbidden = await call('GET', `/dispensary/prescriptions/${external}/label-preview`, front);
      check('11. no label is offered for medication the clinic does not supply',
        forbidden.status === 400, `HTTP ${forbidden.status}`);
    }

    // === 12–16. PRINT LABEL != DISPENSE =================================
    {
      const before = await scoped(async (tx) => ({
        prescription: await tx.prescription.findUnique({
          where: { id: plentiful },
          select: { status: true, dispensedAt: true },
        }),
        stock: await tx.stockLevel.findFirst({
          where: { tenantId: TENANT_ID, clinicId, itemId: seeded.itemIds[0] },
          select: { quantityOnHand: true },
        }),
        ticket: await tx.queueTicket.findUnique({ where: { id: seeded.ticketId }, select: { status: true } }),
        movements: await tx.stockMovement.count({ where: { itemId: seeded.itemIds[0] } }),
        invoices: await tx.invoice.count({ where: { visitId: seeded.visitId } }),
      }));

      const printed = await call('POST', `/dispensary/prescriptions/${plentiful}/label`, front, { copies: 2 });
      check('12. printing succeeds and returns the label', printed.status === 201 || printed.status === 200,
        `HTTP ${printed.status}`);

      const after = await scoped(async (tx) => ({
        prescription: await tx.prescription.findUnique({
          where: { id: plentiful },
          select: { status: true, dispensedAt: true },
        }),
        stock: await tx.stockLevel.findFirst({
          where: { tenantId: TENANT_ID, clinicId, itemId: seeded.itemIds[0] },
          select: { quantityOnHand: true },
        }),
        ticket: await tx.queueTicket.findUnique({ where: { id: seeded.ticketId }, select: { status: true } }),
        movements: await tx.stockMovement.count({ where: { itemId: seeded.itemIds[0] } }),
        invoices: await tx.invoice.count({ where: { visitId: seeded.visitId } }),
        prints: await tx.labelPrint.findMany({ where: { prescriptionId: plentiful } }),
      }));

      check('13. printing moved NO stock',
        before.stock?.quantityOnHand === after.stock?.quantityOnHand &&
          before.movements === after.movements,
        `${before.stock?.quantityOnHand} -> ${after.stock?.quantityOnHand}`);
      check('14. printing changed NO prescription status',
        after.prescription?.status === 'ORDERED' && after.prescription?.dispensedAt === null,
        `${after.prescription?.status}`);
      check('15. printing moved NO queue ticket and created NO invoice',
        before.ticket?.status === after.ticket?.status && before.invoices === after.invoices,
        `${after.ticket?.status}`);
      check('16. the print IS audited, with who and how many copies',
        after.prints.length === 1 && after.prints[0].copies === 2 && after.prints[0].printSequence === 1 &&
          after.prints[0].isReprint === false && Boolean(after.prints[0].printedByStaffId),
        `${after.prints.length} row(s)`);
    }

    // === 17–18. Reprints and the copy bound =============================
    {
      const again = await call('POST', `/dispensary/prescriptions/${plentiful}/label`, front, { copies: 1 });
      const rows = await scoped((tx) =>
        tx.labelPrint.findMany({ where: { prescriptionId: plentiful }, orderBy: { printSequence: 'asc' } }),
      );
      check('17. a second print is sequenced and marked as a reprint',
        again.status < 300 && rows.length === 2 && rows[1].printSequence === 2 && rows[1].isReprint === true,
        `${rows.length} rows`);

      const tooMany = await call('POST', `/dispensary/prescriptions/${plentiful}/label`, front, { copies: 9 });
      check('18. the copy count is bounded by the server', tooMany.status === 400, `HTTP ${tooMany.status}`);
    }

    // === 19–22. Dispensing ==============================================
    {
      const stockBefore = await scoped((tx) =>
        tx.stockLevel.findFirst({
          where: { tenantId: TENANT_ID, clinicId, itemId: seeded.itemIds[0] },
          select: { quantityOnHand: true },
        }),
      );

      // A client-supplied quantity, sent deliberately. The server reads the
      // prescribed quantity and must ignore this entirely.
      const result = await call('POST', '/dispensary/dispense', front, {
        visitId: seeded.visitId,
        prescriptionIds: [plentiful],
        quantity: 1,
        quantityDispensed: 1,
      });
      const stockAfter = await scoped((tx) =>
        tx.stockLevel.findFirst({
          where: { tenantId: TENANT_ID, clinicId, itemId: seeded.itemIds[0] },
          select: { quantityOnHand: true },
        }),
      );
      const moved = (stockBefore?.quantityOnHand ?? 0) - (stockAfter?.quantityOnHand ?? 0);

      check('19. dispensing succeeds', result.status < 300 && result.body?.summary?.dispensed === 1,
        `HTTP ${result.status}`);
      check('20. the PRESCRIBED quantity moved, not the client-supplied one', moved === 15, `moved ${moved}`);
      check('21. the prescription records who dispensed it and when',
        await scoped(async (tx) => {
          const row = await tx.prescription.findUnique({
            where: { id: plentiful },
            select: { status: true, dispensedAt: true, dispensedByStaffId: true },
          });
          return row?.status === 'DISPENSED' && Boolean(row.dispensedAt) && Boolean(row.dispensedByStaffId);
        }));
      check('22. a second dispense of the same row is refused, not repeated',
        await (async () => {
          const repeat = await call('POST', '/dispensary/dispense', front, {
            visitId: seeded.visitId,
            prescriptionIds: [plentiful],
          });
          const stock = await scoped((tx) =>
            tx.stockLevel.findFirst({
              where: { tenantId: TENANT_ID, clinicId, itemId: seeded.itemIds[0] },
              select: { quantityOnHand: true },
            }),
          );
          return (
            repeat.body?.results?.[0]?.outcome === 'ALREADY_DISPENSED' &&
            stock?.quantityOnHand === stockAfter?.quantityOnHand
          );
        })());
    }

    // === 23–25. Shortage, routing and cross-visit refusal ===============
    {
      const refused = await call('POST', '/dispensary/dispense', front, {
        visitId: seeded.visitId,
        prescriptionIds: [short],
      });
      // The MESSAGE is asserted, not just the count: "nothing was dispensed"
      // would also be true if the call had failed for an unrelated reason,
      // and a check that cannot tell those apart proves nothing.
      check('23. a shortage is refused, and says how to proceed',
        refused.body?.summary?.dispensed === 0 &&
          /acknowledge the shortage/i.test(refused.body?.results?.[0]?.message ?? ''),
        `${refused.body?.results?.[0]?.message}`);

      const acknowledged = await call('POST', '/dispensary/dispense', front, {
        visitId: seeded.visitId,
        prescriptionIds: [short],
        acknowledgeStockWarning: true,
      });
      const ticket = await scoped((tx) =>
        tx.queueTicket.findUnique({ where: { id: seeded.ticketId }, select: { status: true } }),
      );
      check('24. an acknowledged shortage dispenses and moves the patient on',
        acknowledged.body?.summary?.dispensed === 1 &&
          acknowledged.body?.routing?.dispensingComplete === true &&
          ticket?.status === 'READY_FOR_PAYMENT',
        `${ticket?.status}`);

      const other = await seedVisit(clinicId, doctorId, 'dispensary cross visit');
      const crossed = await call('POST', '/dispensary/dispense', front, {
        visitId: seeded.visitId,
        prescriptionIds: [other.prescriptionIds[0]],
      });
      const untouched = await scoped((tx) =>
        tx.prescription.findUnique({ where: { id: other.prescriptionIds[0] }, select: { status: true } }),
      );
      check('25. a prescription from another visit cannot be dispensed through this one',
        crossed.status >= 400 && untouched?.status === 'ORDERED',
        `HTTP ${crossed.status} / ${untouched?.status}`);
    }

    // === Bonus. One workflow event, and the audit is append-only ========
    {
      const events = await scoped((tx) =>
        tx.visitWorkflowEvent.count({
          where: { visitId: seeded.visitId, eventType: 'DISPENSING_COMPLETED' },
        }),
      );
      check('26. dispensing completion is recorded exactly once', events === 1, `${events} event(s)`);

      let deleteRefused = false;
      try {
        await scoped((tx) => tx.$executeRawUnsafe(`DELETE FROM label_prints WHERE prescription_id = '${plentiful}'`));
      } catch {
        deleteRefused = true;
      }
      check('27. the label print audit cannot be deleted', deleteRefused);
    }
  } finally {
    if (created.length > 0) {
      await scoped(async (tx) => {
        const list = created.map((id) => `'${id}'`).join(',');
        await tx.$executeRawUnsafe(
          `DELETE FROM stock_movements WHERE reference_id IN (SELECT id FROM prescriptions WHERE visit_id IN (${list}))`,
        );
        // Prescriptions are SOFT-deleted here, never removed.
        //
        // `label_prints` references them ON DELETE RESTRICT, and the audit
        // table is append-only — the application role holds no UPDATE or
        // DELETE on it at all. PostgreSQL's referential-integrity check locks
        // the referencing rows, which needs one of exactly those privileges,
        // so a DELETE of a labelled prescription is refused by the database.
        //
        // That is the guarantee working, not an obstacle to route around:
        // check 27 above asserts it. Cleanup follows the same pattern the
        // workflow-event fixtures use — close the record, do not erase it.
        await tx.$executeRawUnsafe(
          `UPDATE prescriptions SET deleted_at = now(), status = 'CANCELLED' WHERE visit_id IN (${list})`,
        );
        await tx.$executeRawUnsafe(`UPDATE queue_tickets SET status = 'COMPLETED' WHERE visit_id IN (${list})`);
        await tx.$executeRawUnsafe(
          `UPDATE visits SET check_out_at = COALESCE(check_out_at, now()) WHERE id IN (${list})`,
        );
        await tx.$executeRawUnsafe(
          `UPDATE patients SET deleted_at = now() WHERE id IN (SELECT patient_id FROM visits WHERE id IN (${list}))`,
        );
      });
    }
  }

  console.log('='.repeat(72));
  console.log(`${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
