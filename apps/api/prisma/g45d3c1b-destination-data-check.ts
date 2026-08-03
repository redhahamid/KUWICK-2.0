import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: join(__dirname, '..', '.env') });

// G4.5d3c-1b (D-084) — supply mode and patient responsibility, verified
// against the live database.
//
//   npx tsx prisma/g45d3c1b-destination-data-check.ts
//
// D-048: `tenants` needs app.bypass_tenant_scope; every clinical table needs
// app.tenant_id. Read blind, each returns zero rows and no error.
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

async function asTenant<T>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
    return fn(tx);
  });
}

async function listTenants(): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_tenant_scope', 'true', true)`);
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM tenants`);
    return rows.map((r) => r.id);
  });
}

/** The invariant the future billing rule must maintain. */
function responsibilityHolds(total: number, panel: number, responsibility: number): boolean {
  return Math.abs(panel + responsibility - total) < 0.005;
}

function remainingPatientAmount(responsibility: number | null, paid: number): number | null {
  if (responsibility === null) return null; // UNDETERMINED — never guessed.
  return Math.max(responsibility - paid, 0);
}

async function main() {
  console.log('\nG4.5d3c-1b — SUPPLY MODE AND PATIENT RESPONSIBILITY');
  console.log('='.repeat(78));

  const tenants = await listTenants();
  let prescriptions = 0;
  let withSupplyMode = 0;
  let invoices = 0;
  let withResponsibility = 0;
  let paidTouched = 0;
  let cancelledTouched = 0;

  for (const id of tenants) {
    const [p] = await asTenant(id, (tx) =>
      tx.$queryRawUnsafe<Array<{ n: bigint; sm: bigint }>>(
        `SELECT count(*) AS n, count(*) FILTER (WHERE supply_mode IS NOT NULL) AS sm FROM prescriptions`,
      ),
    );
    prescriptions += Number(p.n);
    withSupplyMode += Number(p.sm);

    const [i] = await asTenant(id, (tx) =>
      tx.$queryRawUnsafe<Array<{ n: bigint; pr: bigint; paid: bigint; canc: bigint }>>(
        `SELECT count(*) AS n,
                count(*) FILTER (WHERE patient_responsibility_amount IS NOT NULL) AS pr,
                count(*) FILTER (WHERE status = 'PAID'      AND patient_responsibility_amount IS NOT NULL) AS paid,
                count(*) FILTER (WHERE status = 'CANCELLED' AND patient_responsibility_amount IS NOT NULL) AS canc
         FROM invoices`,
      ),
    );
    invoices += Number(i.n);
    withResponsibility += Number(i.pr);
    paidTouched += Number(i.paid);
    cancelledTouched += Number(i.canc);
  }
  console.log(`\n  ${tenants.length} tenants · ${prescriptions} prescriptions · ${invoices} invoices\n`);

  // -- 1, 3: existing rows still read --------------------------------------
  check('1. existing Prescriptions with NULL supplyMode remain readable', prescriptions > 0, `${prescriptions} rows`);
  check('3. existing Invoices with NULL patientResponsibilityAmount remain readable', invoices > 0, `${invoices} rows`);

  // -- 7, 8, 9, 10: nothing was backfilled or disturbed ---------------------
  check('7. no historical Prescription was backfilled', withSupplyMode === 0, `${withSupplyMode} carry a supply mode`);
  check('8. no historical Invoice was backfilled', withResponsibility === 0, `${withResponsibility} carry a responsibility amount`);
  check('9. no PAID invoice was modified', paidTouched === 0);
  check('10. no CANCELLED invoice was modified', cancelledTouched === 0);

  // -- 2: all five modes persist -------------------------------------------
  const labels = await prisma.$queryRawUnsafe<Array<{ enumlabel: string }>>(
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'PrescriptionSupplyMode' ORDER BY e.enumsortorder`,
  );
  const modes = labels.map((l) => l.enumlabel);
  const expected = ['ONSITE_DISPENSE', 'EXTERNAL_PRESCRIPTION', 'PATIENT_OWN_SUPPLY', 'DEFERRED', 'NO_SUPPLY_REQUIRED'];
  check('2a. the enum holds exactly the five approved values', modes.length === 5 && expected.every((m) => modes.includes(m)), modes.join(', '));

  const tenantWithData = await findTenantWithPrescription(tenants);
  let allModesPersist = false;
  if (tenantWithData) {
    const { tenantId, prescriptionId } = tenantWithData;
    allModesPersist = true;
    for (const mode of expected) {
      const readBack = await probeSupplyMode(tenantId, prescriptionId, mode);
      if (readBack !== mode) {
        allModesPersist = false;
        console.log(`        (${mode} read back as ${JSON.stringify(readBack)})`);
      }
    }
  }
  check('2b. all five supply modes write and read back', allModesPersist, 'each written and rolled back');

  // -- 4, 5, 6: the three worked examples -----------------------------------
  const cash = { total: 85, panel: 0, responsibility: 85, paid: 0 };
  const panelFull = { total: 120, panel: 120, responsibility: 0, paid: 0 };
  const copay = { total: 150, panel: 120, responsibility: 30, paid: 0 };

  check('4. CASH — 85 total, 0 panel, 85 patient responsibility',
    responsibilityHolds(cash.total, cash.panel, cash.responsibility) &&
      remainingPatientAmount(cash.responsibility, cash.paid) === 85,
    'patient-facing payment work remains');

  check('5. FULLY PANEL COVERED — 120 total, 120 panel, 0 patient responsibility',
    responsibilityHolds(panelFull.total, panelFull.panel, panelFull.responsibility) &&
      remainingPatientAmount(panelFull.responsibility, panelFull.paid) === 0,
    'UNPAID, but the payment counter is NOT required');

  check('6. COPAYMENT — 150 total, 120 panel, 30 patient responsibility',
    responsibilityHolds(copay.total, copay.panel, copay.responsibility) &&
      remainingPatientAmount(copay.responsibility, copay.paid) === 30,
    'only the copay remains');

  check('6b. a NULL responsibility is UNDETERMINED, never assumed to be zero',
    remainingPatientAmount(null, 0) === null,
    'the future completion service must not guess');

  check('6c. Invoice.status alone cannot answer the payment question',
    // Both examples are UNPAID with patientPaidAmount 0, and they need
    // opposite destinations. That is the whole point of the new column.
    remainingPatientAmount(cash.responsibility, 0) !== remainingPatientAmount(panelFull.responsibility, 0),
    'two UNPAID invoices, opposite destinations');

  // -- 11, 12: tenant isolation still holds ---------------------------------
  const other = tenants.find((t) => t !== tenantWithData?.tenantId);
  let crossPrescription = 0;
  let crossInvoice = 0;
  if (other && tenantWithData) {
    crossPrescription = await asTenant(other, (tx) =>
      tx.prescription.count({ where: { tenantId: tenantWithData.tenantId } }),
    );
    crossInvoice = await asTenant(other, (tx) =>
      tx.invoice.count({ where: { tenantId: tenantWithData.tenantId } }),
    );
  }
  check('11. cross-tenant Prescription access remains denied', crossPrescription === 0);
  check('12. cross-tenant Invoice access remains denied', crossInvoice === 0);

  // -- 13, 14: the existing workflows still query --------------------------
  if (tenantWithData) {
    const ok = await asTenant(tenantWithData.tenantId, async (tx) => {
      const meds = await tx.prescription.findMany({
        where: { deletedAt: null },
        include: { item: true, prescribedBy: true },
        take: 3,
      });
      const bills = await tx.invoice.findMany({ include: { lines: true, visit: true }, take: 3 });
      return Array.isArray(meds) && Array.isArray(bills);
    });
    check('13/14. existing medication and billing queries still compile and run', ok);
  }

  // -- 18: the rollback limitation is written down --------------------------
  const sql = readFileSync(
    join(__dirname, 'migrations', '20260804030000_supply_mode_and_patient_responsibility', 'migration.sql'),
    'utf8',
  );
  check('18. the PostgreSQL enum rollback limitation is documented',
    // The prose wraps across comment lines, so match the phrase, not the line.
    /ROLLBACK LIMITATION/.test(sql) && /cannot DROP a value/i.test(sql));
  check('18b. the migration writes no data', !/^\s*(INSERT INTO|UPDATE)\s/im.test(sql.replace(/--.*$/gm, '')), 'DDL only');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

async function findTenantWithPrescription(tenants: string[]) {
  for (const tenantId of tenants) {
    const row = await asTenant(tenantId, (tx) => tx.prescription.findFirst({ select: { id: true } }));
    if (row) return { tenantId, prescriptionId: row.id as string };
  }
  return null;
}

/** Writes a supply mode, reads it back, and always rolls the change away. */
async function probeSupplyMode(tenantId: string, id: string, mode: string): Promise<string | null> {
  let readBack: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
      const rows = await tx.$queryRawUnsafe<Array<{ supply_mode: string }>>(
        `UPDATE prescriptions SET supply_mode = $1::"PrescriptionSupplyMode"
          WHERE id = $2 RETURNING supply_mode`,
        mode,
        id,
      );
      readBack = rows[0]?.supply_mode ?? null;
      throw new Error('__rollback__');
    });
  } catch (e) {
    if (!(e as Error).message.includes('__rollback__')) {
      console.log(`        (${mode} probe failed: ${(e as Error).message.split('\n')[0]})`);
      return null;
    }
  }
  return readBack;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
