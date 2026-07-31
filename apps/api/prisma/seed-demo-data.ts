import { join } from 'node:path';
import { config } from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: join(__dirname, '..', '.env') });

// Demo data for the Reports suite (D-039) — the owner asked for "a few
// patients so [reports] can generate all data". Seeds ~60 days of visits,
// orders, prescriptions, and PAID invoices with a realistic panel/cash mix
// into the dev tenant, so every report page has something meaningful to
// chart. Local dev only. Run: `npx tsx prisma/seed-demo-data.ts`.
//
// Idempotency: aborts if any DEMO- visit already exists. Deterministic:
// seeded PRNG, so re-seeding a fresh DB produces the same picture.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const DEV_TENANT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const DAYS_OF_HISTORY = 60;

// mulberry32 — tiny deterministic PRNG.
function makeRng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(20260731);
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const randInt = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

const FIRST_NAMES = ['Ahmad', 'Siti', 'Muhammad', 'Nur', 'Lim', 'Tan', 'Raj', 'Priya', 'Wong', 'Lee', 'Aisyah', 'Farid', 'Mei Ling', 'Kumar', 'Zainab', 'Hafiz', 'Chong', 'Devi', 'Amir', 'Sarah'];
const LAST_NAMES = ['bin Abdullah', 'binti Hassan', 'Wei Jie', 'a/l Muthu', 'binti Ismail', 'Xin Yi', 'bin Omar', 'a/p Raman', 'Jun Hao', 'binti Yusof'];
const PANELS = [
  { name: 'AIA', limit: 150 },
  { name: 'MARA', limit: 200 },
  { name: 'PRUDENTIAL', limit: 120 },
];
const SERVICES = [
  { name: 'XRAY CHEST', code: 'XRAYCHEST', category: 'Imaging', price: 80 },
  { name: 'WOUND DRESSING', code: 'WOUNDDRESS', category: 'Procedure', price: 40 },
  { name: 'ECG', code: 'ECG', category: 'Diagnostic', price: 60 },
  { name: 'URINE FEME', code: 'URINEFEME', category: 'Laboratory', price: 25 },
  { name: 'MINOR SURGERY - I&D', code: 'MINSURGID', category: 'Minor Surgery', price: 250 },
  { name: 'NEBULISER', code: 'NEB', category: 'Procedure', price: 45 },
];
const DRUGS = [
  { name: 'Paracetamol 500mg', price: 8 },
  { name: 'Amoxicillin 250mg/5mL Syrup', price: 18 },
  { name: 'Cetirizine 10mg', price: 12 },
  { name: 'Ibuprofen 400mg', price: 15 },
  { name: 'Omeprazole 20mg', price: 22 },
  { name: 'ORS Sachets', price: 6 },
];
const CASH_METHODS = ['CASH', 'CARD', 'QR', 'BANK_TRANSFER'];

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

async function inScope<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${DEV_TENANT_ID}, true)`;
    return fn(tx);
  });
}

async function main() {
  const already = await inScope((tx) => tx.visit.findFirst({ where: { visitNumber: { startsWith: 'DEMO-' } } }));
  if (already) {
    console.log('Demo data already seeded — nothing to do.');
    return;
  }

  const clinic = await inScope((tx) => tx.clinic.findFirst({ where: { tenantId: DEV_TENANT_ID } }));
  if (!clinic) throw new Error('No clinic in dev tenant');
  const doctors = await inScope((tx) =>
    tx.staff.findMany({ where: { role: { in: ['DOCTOR_RESIDENT', 'DOCTOR_LOCUM'] }, active: true } }),
  );
  if (doctors.length === 0) throw new Error('No active doctors in dev tenant');

  // Panels — reuse existing by name or create.
  const panels: { id: string; name: string; limit: number }[] = [];
  for (const panel of PANELS) {
    const existing = await inScope((tx) => tx.panelClinic.findFirst({ where: { name: panel.name } }));
    const row =
      existing ??
      (await inScope((tx) =>
        tx.panelClinic.create({ data: { tenantId: DEV_TENANT_ID, name: panel.name, limitAmount: panel.limit } }),
      ));
    panels.push({ id: row.id, name: row.name, limit: panel.limit });
  }

  // Task-order services with categories (Procedure Analysis needs these).
  const services: { id: string; name: string; price: number }[] = [];
  for (const service of SERVICES) {
    const existing = await inScope((tx) => tx.serviceCatalog.findFirst({ where: { name: service.name } }));
    const row =
      existing ??
      (await inScope((tx) =>
        tx.serviceCatalog.create({
          data: {
            tenantId: DEV_TENANT_ID,
            name: service.name,
            code: service.code,
            category: service.category,
            orderType: 'TASK_ORDER',
            durationMinutesDefault: 15,
            price: service.price,
          },
        }),
      ));
    services.push({ id: row.id, name: row.name, price: service.price });
  }

  // Drug items.
  const items: { id: string; name: string; price: number }[] = [];
  for (const drug of DRUGS) {
    const existing = await inScope((tx) => tx.item.findFirst({ where: { name: drug.name } }));
    const row =
      existing ??
      (await inScope((tx) =>
        tx.item.create({
          data: { tenantId: DEV_TENANT_ID, name: drug.name, category: 'Medication', sellPrice: new Prisma.Decimal(drug.price) },
        }),
      ));
    items.push({ id: row.id, name: row.name, price: drug.price });
  }

  // Patients across genders/age groups; identifiers unique via index.
  const patients: { id: string }[] = [];
  for (let i = 0; i < 28; i++) {
    const gender = rng() < 0.52 ? 'Female' : 'Male';
    const age = pick([randInt(1, 12), randInt(13, 17), randInt(18, 39), randInt(18, 39), randInt(40, 59), randInt(60, 82)]);
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - age, randInt(0, 11), randInt(1, 28));
    const createdDaysAgo = rng() < 0.3 ? randInt(0, DAYS_OF_HISTORY) : randInt(DAYS_OF_HISTORY + 30, 700);
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - createdDaysAgo);
    const patient = await inScope((tx) =>
      tx.patient.create({
        data: {
          tenantId: DEV_TENANT_ID,
          identifierType: 'NRIC',
          identifierValue: `DEMO${String(900000 + i)}`,
          name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
          gender,
          dob,
          phone: `01${randInt(10000000, 99999999)}`,
          createdAt,
        },
      }),
    );
    patients.push({ id: patient.id });
  }

  let visitSeq = 1;
  let invoiceSeq = 1;
  let visitCount = 0;

  for (let daysAgo = DAYS_OF_HISTORY; daysAgo >= 1; daysAgo--) {
    const perDay = randInt(2, 6);
    for (let v = 0; v < perDay; v++) {
      const checkInAt = new Date();
      checkInAt.setDate(checkInAt.getDate() - daysAgo);
      // 24h clinic: peak hours weighted toward morning + evening.
      checkInAt.setHours(pick([9, 9, 10, 10, 11, 12, 14, 15, 16, 19, 20, 20, 21, 22, 2]), randInt(0, 59), 0, 0);
      const checkOutAt = new Date(checkInAt.getTime() + randInt(20, 80) * 60 * 1000);
      const doctor = pick(doctors);
      const patient = pick(patients);
      const panel = rng() < 0.4 ? pick(panels) : null;

      const visit = await inScope((tx) =>
        tx.visit.create({
          data: {
            tenantId: DEV_TENANT_ID,
            clinicId: clinic.id,
            patientId: patient.id,
            staffId: doctor.id,
            visitNumber: `DEMO-${String(visitSeq++).padStart(5, '0')}`,
            billingType: panel ? panel.name : 'Self-pay',
            panelClinicId: panel?.id,
            checkInAt,
            checkOutAt,
            createdAt: checkInAt,
          },
        }),
      );

      const lines: Prisma.InvoiceLineCreateManyInvoiceInput[] = [];
      lines.push({
        tenantId: DEV_TENANT_ID,
        description: 'Consultation',
        quantity: 1,
        unitPrice: new Prisma.Decimal(randInt(35, 60)),
        amount: new Prisma.Decimal(0),
      });

      if (rng() < 0.45) {
        const service = pick(services);
        const orderService = await inScope((tx) =>
          tx.orderService.create({
            data: {
              tenantId: DEV_TENANT_ID,
              clinicId: clinic.id,
              visitId: visit.id,
              serviceCatalogId: service.id,
              procedureName: service.name,
              orderType: 'TASK_ORDER',
              status: 'COMPLETED',
              requestedByStaffId: doctor.id,
              requestedAt: checkInAt,
              completedAt: checkOutAt,
            },
          }),
        );
        lines.push({
          tenantId: DEV_TENANT_ID,
          description: service.name,
          quantity: 1,
          unitPrice: new Prisma.Decimal(service.price),
          amount: new Prisma.Decimal(0),
          sourceOrderServiceId: orderService.id,
        });
      }

      const drugCount = rng() < 0.75 ? randInt(1, 3) : 0;
      for (let d = 0; d < drugCount; d++) {
        const item = pick(items);
        const prescription = await inScope((tx) =>
          tx.prescription.create({
            data: {
              tenantId: DEV_TENANT_ID,
              visitId: visit.id,
              itemId: item.id,
              quantity: 1,
              amount: new Prisma.Decimal(1),
              frequency: 'TDS',
              durationDays: 5,
              status: 'DISPENSED',
              prescribedByStaffId: doctor.id,
              prescribedAt: checkInAt,
              dispensedAt: checkOutAt,
            },
          }),
        );
        lines.push({
          tenantId: DEV_TENANT_ID,
          description: item.name,
          quantity: 1,
          unitPrice: new Prisma.Decimal(item.price),
          amount: new Prisma.Decimal(0),
          sourcePrescriptionId: prescription.id,
        });
      }

      for (const line of lines) {
        line.amount = new Prisma.Decimal(Number(line.unitPrice) * (line.quantity ?? 1));
      }
      const total = lines.reduce((sum, line) => sum + Number(line.amount), 0);
      const isPaid = rng() >= 0.05;
      const panelCovered = panel ? Math.min(panel.limit, total) : 0;
      const patientPaid = total - panelCovered;

      await inScope((tx) =>
        tx.invoice.create({
          data: {
            tenantId: DEV_TENANT_ID,
            visitId: visit.id,
            invoiceNumber: `DEMO-INV-${String(invoiceSeq++).padStart(5, '0')}`,
            status: isPaid ? 'PAID' : 'UNPAID',
            totalAmount: new Prisma.Decimal(total),
            createdByStaffId: doctor.id,
            createdAt: checkInAt,
            ...(isPaid
              ? {
                  paidAt: checkOutAt,
                  paymentMethod: patientPaid > 0 ? pick(CASH_METHODS) : 'PANEL',
                  panelCoveredAmount: new Prisma.Decimal(panelCovered),
                  patientPaidAmount: new Prisma.Decimal(patientPaid),
                }
              : {}),
            lines: { createMany: { data: lines } },
          },
        }),
      );
      visitCount++;
    }
  }

  console.log(`Seeded ${patients.length} demo patients and ${visitCount} visits/invoices over ${DAYS_OF_HISTORY} days.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
