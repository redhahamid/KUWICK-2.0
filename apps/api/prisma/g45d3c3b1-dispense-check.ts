import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: join(__dirname, '..', '.env') });

// G4.5d3c-3b1 (D-093) — does the atomic dispense claim ACTUALLY prevent a
// double stock deduction under real concurrency, on the live database under
// its real isolation level?
//
// Two genuinely overlapping transactions each attempt the claim for the same
// ORDERED + ONSITE_DISPENSE prescription. Exactly one may see count 1. And a
// CONTROL runs the OLD read-then-write shape to demonstrate it double-claims
// — a proof that cannot fail proves nothing.
//
//   npx tsx prisma/g45d3c3b1-dispense-check.ts
//
// Creates its own synthetic rows in the dev tenant and removes them at the
// end. No fixture ledger needed: nothing here is clinical review data.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const TENANT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

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

/** The claim exactly as PrescriptionService.dispense issues it. */
async function atomicClaim(prescriptionId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, TENANT_ID);
    // Pause INSIDE the transaction so both are provably open at once.
    await tx.$executeRawUnsafe(`SELECT pg_sleep(0.25)`);
    const result = await tx.prescription.updateMany({
      where: { id: prescriptionId, status: 'ORDERED', supplyMode: 'ONSITE_DISPENSE' },
      data: { status: 'DISPENSED', dispensedAt: new Date() },
    });
    if (result.count === 1) {
      // The stock movement rides the same transaction, as in the service.
      const rx = await tx.prescription.findUnique({
        where: { id: prescriptionId },
        select: { itemId: true, quantity: true, visit: { select: { clinicId: true } } },
      });
      await tx.stockMovement.create({
        data: {
          tenantId: TENANT_ID,
          clinicId: rx!.visit.clinicId,
          itemId: rx!.itemId,
          movementType: 'DISPENSED',
          quantityDelta: -rx!.quantity,
          referenceType: 'Prescription',
          referenceId: prescriptionId,
        },
      });
    }
    return result.count;
  });
}

/** CONTROL — the OLD shape: read the status, then write on what was read. */
async function naiveClaim(prescriptionId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, TENANT_ID);
    const rx = await tx.prescription.findUnique({ where: { id: prescriptionId }, select: { status: true } });
    await tx.$executeRawUnsafe(`SELECT pg_sleep(0.25)`);
    if (rx?.status !== 'ORDERED') return 0;
    await tx.prescription.update({
      where: { id: prescriptionId },
      data: { status: 'DISPENSED', dispensedAt: new Date() },
    });
    return 1;
  });
}

async function makePrescription(supplyMode: string | null): Promise<{ id: string; visitId: string; patientId: string }> {
  return scoped(async (tx) => {
    const clinic = await tx.clinic.findFirst({ select: { id: true } });
    const item = await tx.item.findFirst({ select: { id: true } });
    const staff = await tx.staff.findFirst({ where: { role: { in: ['DOCTOR_RESIDENT', 'DOCTOR_LOCUM'] } } });
    const patient = await tx.patient.create({
      data: {
        tenantId: TENANT_ID,
        name: `ZZ 3b1 Dispense Check ${Date.now()}`,
        identifierType: 'PASSPORT',
        identifierValue: `DC${Date.now()}`,
      },
    });
    const visit = await tx.visit.create({
      data: {
        tenantId: TENANT_ID,
        clinicId: clinic!.id,
        patientId: patient.id,
        staffId: staff!.id,
        billingType: 'Cash',
        visitNumber: `DCHK-${Date.now() % 1000000}`,
      },
    });
    const prescription = await tx.prescription.create({
      data: {
        tenantId: TENANT_ID,
        visitId: visit.id,
        itemId: item!.id,
        quantity: 5,
        amount: 1,
        frequency: 'OD',
        durationDays: 5,
        prescribedByStaffId: staff!.id,
        supplyMode: supplyMode as never,
      },
    });
    return { id: prescription.id, visitId: visit.id, patientId: patient.id };
  });
}

// Visits cannot be hard-deleted by the app role — visit_workflow_events is
// append-only by design (no DELETE grant even for the owner), so the cascade
// is refused. That protection is CORRECT; the harness works within it: hard-
// delete its movements and prescriptions, close the synthetic visit, and
// soft-delete the synthetic patient so nothing shows up in working lists.
async function cleanup(made: Array<{ id: string; visitId: string; patientId: string }>) {
  await scoped(async (tx) => {
    for (const m of made) {
      await tx.stockMovement.deleteMany({ where: { referenceId: m.id } });
      await tx.prescription.delete({ where: { id: m.id } });
      await tx.visit.update({ where: { id: m.visitId }, data: { checkOutAt: new Date() } });
      await tx.patient.update({ where: { id: m.patientId }, data: { deletedAt: new Date() } });
    }
  });
}

async function main() {
  const made: Array<{ id: string; visitId: string; patientId: string }> = [];
  try {
    console.log('\nG4.5d3c-3b1 — atomic dispense under real concurrency');
    console.log('='.repeat(64));

    // 33a. Two overlapping atomic claims: exactly one winner, ONE movement.
    {
      const rx = await makePrescription('ONSITE_DISPENSE');
      made.push(rx);
      const results = await Promise.all([atomicClaim(rx.id), atomicClaim(rx.id)]);
      check('two concurrent atomic claims produce exactly one winner', results.sort().join(',') === '0,1', `[${results}]`);
      const movements = await scoped((tx) => tx.stockMovement.count({ where: { referenceId: rx.id } }));
      check('stock moved exactly ONCE', movements === 1, `${movements} movement(s)`);
    }

    // 33b. Three-way race: still one winner.
    {
      const rx = await makePrescription('ONSITE_DISPENSE');
      made.push(rx);
      const results = await Promise.all([atomicClaim(rx.id), atomicClaim(rx.id), atomicClaim(rx.id)]);
      const winners = results.filter((r) => r === 1).length;
      check('three-way race still has one winner', winners === 1, `[${results}]`);
    }

    // 32. A non-ONSITE mode never claims, even uncontended.
    {
      const rx = await makePrescription('EXTERNAL_PRESCRIPTION');
      made.push(rx);
      const result = await atomicClaim(rx.id);
      check('EXTERNAL_PRESCRIPTION cannot claim a dispense', result === 0);
      const nullRx = await makePrescription(null);
      made.push(nullRx);
      check('a NULL supply mode cannot claim a dispense', (await atomicClaim(nullRx.id)) === 0);
    }

    // CONTROL — the naive shape double-claims under the same race.
    {
      const rx = await makePrescription('ONSITE_DISPENSE');
      made.push(rx);
      const results = await Promise.all([naiveClaim(rx.id), naiveClaim(rx.id)]);
      check(
        'CONTROL: the old read-then-write shape lets BOTH claim',
        results.join(',') === '1,1',
        `[${results}] — this is the double-deduction the atomic claim prevents`,
      );
    }
  } finally {
    await cleanup(made);
  }

  console.log('='.repeat(64));
  console.log(`${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().finally(() => prisma.$disconnect());
