import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * b4 PIECE 1 — the two visits the RIGHT RAIL VERTICAL BUDGET is measured on.
 *
 * The compaction that made a medication one line was verified by eye. That is
 * not a measurement, and it matters more than usual here: Piece 2 puts a sticky
 * bottom bar into the same vertical space, so the budget has to be known BEFORE
 * something starts consuming it.
 *
 * TWO visits, because one number proves nothing:
 *
 *   TYPICAL — 4 medications, 1 order, 1 document. The common case, and the one
 *             the target is stated against: it must fit 1366×768 with no
 *             scrolling, every card header and every row on screen.
 *   HEAVY   — 10 medications, 4 orders, 3 documents. Not expected to fit. What
 *             is asserted is that it DEGRADES the way it was designed to —
 *             disclosure collapses the overflow, no card is pushed off screen
 *             entirely, no item text is truncated, and the no-supply-mode
 *             warning is still on its row.
 *
 * Each visit carries one prescription with `supplyMode: null` on purpose. That
 * is the unresolved state Piece 1 deliberately refused to move to hover, and a
 * fixture without one would let the assertion pass by having nothing to find.
 */

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const TENANT_SLUG = 'kuwick-uat-staging';

/** Stable, so the spec can find this patient without depending on seed order. */
export const DENSITY_PATIENT_IC = '880808088808';
export const TYPICAL_VISIT_NUMBER = 'V-DENSITY-TYPICAL';
export const HEAVY_VISIT_NUMBER = 'V-DENSITY-HEAVY';

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function inTenant<T>(fn: (tx: Tx, tenantId: string, clinicId: string) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findFirst({ where: { slug: TENANT_SLUG }, select: { id: true } });
    if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} not found — run the staging seed first.`);
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
    const clinic = await tx.clinic.findFirst({ where: { tenantId: tenant.id }, select: { id: true } });
    if (!clinic) throw new Error('No clinic in the tenant — run the staging seed first.');
    return fn(tx, tenant.id, clinic.id);
  });
}

/** Long enough to catch truncation, short enough to be a real drug name. */
const MEDICATIONS = [
  'Paracetamol 500mg',
  'Amoxicillin 500mg',
  'Bromhexine 8mg',
  'Cetirizine 10mg',
  'Metformin 500mg',
  'Amlodipine 5mg',
  'Simvastatin 20mg',
  'Omeprazole 20mg',
  'Salbutamol Inhaler 100mcg',
  'Prednisolone 5mg',
];

async function main() {
  const report = await inTenant(async (tx, tenantId, clinicId) => {
    const lines: string[] = [];

    const doctor = await tx.staff.findFirst({
      where: { role: { in: ['DOCTOR_RESIDENT', 'OWNER_ADMIN'] }, active: true },
      select: { id: true },
    });
    if (!doctor) throw new Error('No doctor in the tenant — run the staging seed first.');

    // Items and a service to hang the fixtures off. Reused if the seed has run
    // before: this script is re-run on every CI e2e job.
    const items = [];
    for (const name of MEDICATIONS) {
      const existing = await tx.item.findFirst({ where: { name }, select: { id: true } });
      items.push(
        existing ??
          (await tx.item.create({
            data: { tenantId, name, sellPrice: 1.5 },
            select: { id: true },
          })),
      );
    }

    let service = await tx.serviceCatalog.findFirst({
      where: { code: 'E2E-WOUNDCARE' },
      select: { id: true, name: true },
    });
    service ??= await tx.serviceCatalog.findFirst({ select: { id: true, name: true } });
    if (!service) throw new Error('No service catalogue entry — run the E2E seed first.');

    const patient =
      (await tx.patient.findFirst({
        where: { identifierValue: DENSITY_PATIENT_IC },
        select: { id: true },
      })) ??
      (await tx.patient.create({
        data: {
          tenantId,
          identifierType: 'NRIC',
          identifierValue: DENSITY_PATIENT_IC,
          name: 'Density Fixture (Synthetic)',
          dob: new Date('1988-08-08'),
          gender: 'FEMALE',
        },
        select: { id: true },
      }));
    lines.push(`patient: ${patient.id}`);

    const buildVisit = async (
      visitNumber: string,
      counts: { medications: number; orders: number; documents: number },
    ) => {
      const existing = await tx.visit.findFirst({ where: { visitNumber }, select: { id: true } });
      if (existing) {
        lines.push(`${visitNumber}: already seeded — ${existing.id}`);
        return existing.id;
      }

      const visit = await tx.visit.create({
        data: {
          tenantId,
          clinicId,
          patientId: patient.id,
          visitNumber,
          billingType: 'CASH',
          staffId: doctor.id,
          presentingComplaint: `Density fixture — ${counts.medications} medications`,
        },
        select: { id: true },
      });

      for (let i = 0; i < counts.medications; i += 1) {
        await tx.prescription.create({
          data: {
            tenantId,
            visitId: visit.id,
            itemId: items[i % items.length].id,
            amount: 1,
            unit: 'tablet',
            frequency: 'TDS',
            durationDays: 5,
            quantity: 15,
            prescribedByStaffId: doctor.id,
            // ONE unresolved row per visit, deliberately. It is the state Piece
            // 1 refused to move to hover, and the spec asserts the warning chip
            // is still rendered — a fixture with none would pass on absence.
            supplyMode: i === 0 ? null : 'ONSITE_DISPENSE',
          },
        });
      }

      for (let i = 0; i < counts.orders; i += 1) {
        await tx.orderService.create({
          data: {
            tenantId,
            clinicId,
            visitId: visit.id,
            serviceCatalogId: service!.id,
            procedureName: `${service!.name} ${i + 1}`,
            orderType: 'TASK_ORDER',
            requestedByStaffId: doctor.id,
          },
        });
      }

      for (let i = 0; i < counts.documents; i += 1) {
        await tx.document.create({
          data: {
            tenantId,
            visitId: visit.id,
            type: 'MC',
            content: `MEDICAL CERTIFICATE — density fixture ${i + 1}`,
            issuedByStaffId: doctor.id,
            startDate: new Date('2026-08-16'),
            endDate: new Date('2026-08-16'),
          },
        });
      }

      lines.push(
        `${visitNumber}: ${visit.id} (${counts.medications} med, ${counts.orders} order, ${counts.documents} doc)`,
      );
      return visit.id;
    };

    const TYPICAL_COUNTS = { medications: 4, orders: 1, documents: 1 };
    const HEAVY_COUNTS = { medications: 10, orders: 4, documents: 3 };
    const typical = await buildVisit(TYPICAL_VISIT_NUMBER, TYPICAL_COUNTS);
    const heavy = await buildVisit(HEAVY_VISIT_NUMBER, HEAVY_COUNTS);

    // Printed the way golden-path.spec.ts prints its visit under test, so a
    // failing run says which URL to open.
    // HANDED TO THE SPEC AS URLS, not found by clicking through the UI.
    // The first version navigated the visits rail by presenting complaint and
    // timed out: a density measurement should fail when the RAIL is too tall,
    // not when a click path changed. Reading ids from a file makes the
    // navigation deterministic and keeps the assertion about geometry.
    //
    // THE COUNTS TRAVEL WITH THE URL, and they are what the spec waits on.
    // The rail renders its panels — headers, empty states, the add controls —
    // before any of the visit's clinical rows have arrived, so "a panel is
    // visible" was a signal that fired on an EMPTY rail: the spec measured a
    // rail with nothing in it and reported zero rows, which read like a
    // fixture the canvas would not accept. It accepts this one; the spec was
    // simply measuring too early. Waiting for the panel to say the number
    // THIS seed planted is the only wait that cannot pass early, and it comes
    // from the seed rather than being copied into the spec as a literal that
    // the two would then have to be kept agreeing on by hand.
    writeFileSync(
      resolve(__dirname, '../../../e2e/.density-fixtures.json'),
      `${JSON.stringify(
        {
          typical: { url: `/patients/${patient.id}?visitId=${typical}`, ...TYPICAL_COUNTS },
          heavy: { url: `/patients/${patient.id}?visitId=${heavy}`, ...HEAVY_COUNTS },
        },
        null,
        2,
      )}\n`,
    );

    lines.push(`TYPICAL url: /patients/${patient.id}?visitId=${typical}`);
    lines.push(`HEAVY url: /patients/${patient.id}?visitId=${heavy}`);
    return lines;
  });

  console.log('density fixtures:');
  for (const line of report) console.log(`  ${line}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
