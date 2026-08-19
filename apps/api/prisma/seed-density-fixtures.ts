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
 * Each visit carries TWO prescriptions with `supplyMode: null` on purpose. That
 * is the unresolved state Piece 1 deliberately refused to move to hover, and a
 * fixture without one would let the assertion pass by having nothing to find.
 */

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const TENANT_SLUG = 'kuwick-uat-staging';

/** Stable, so the spec can find this patient without depending on seed order. */
export const DENSITY_PATIENT_IC = '880808088808';
export const DENSITY_PATIENT_NAME = 'Density Fixture (Synthetic)';
export const TYPICAL_VISIT_NUMBER = 'V-DENSITY-TYPICAL';
export const HEAVY_VISIT_NUMBER = 'V-DENSITY-HEAVY';

/**
 * b4 PIECE C — what the canvas's follow-up picker is booked against.
 *
 * The names travel to the spec through `.density-fixtures.json` rather than
 * being copied into it, for the reason the counts already do: two places that
 * have to be kept agreeing by hand eventually stop agreeing.
 */
export const FOLLOW_UP_SERVICE_CODE = 'DENSITY-FOLLOWUP';
export const FOLLOW_UP_SERVICE_NAME = 'Density Follow-up Review';
export const UNMAPPED_SERVICE_CODE = 'DENSITY-UNMAPPED';
export const UNMAPPED_SERVICE_NAME = 'Density Unmapped Procedure';
export const SLOT_LENGTH_MINUTES = 30;
export const DAILY_CAPACITY = 20;

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

    // A REAL DOCTOR, and OWNER_ADMIN is no longer accepted as one.
    //
    // b4 PIECE C made this load-bearing rather than cosmetic. The appointment
    // backbone below hangs off this staff member, and
    // `StaffService.isActiveDoctor` — which every booking goes through —
    // counts only DOCTOR_RESIDENT and DOCTOR_LOCUM. An OWNER_ADMIN picked by
    // an unordered `findFirst` would seed a mapping, a roster and a capacity
    // against somebody who can never be booked, and the failure would arrive
    // as "Staff member is not an active doctor" from a screen that offered
    // them. Failing here instead names the fixture, which is what is wrong.
    const doctor = await tx.staff.findFirst({
      where: { role: { in: ['DOCTOR_RESIDENT', 'DOCTOR_LOCUM'] }, active: true },
      select: { id: true },
    });
    if (!doctor) {
      throw new Error(
        'No active DOCTOR_RESIDENT/DOCTOR_LOCUM in the tenant — run the staging seed first. ' +
          '(An OWNER_ADMIN cannot hold appointments, so it is deliberately not accepted here.)',
      );
    }

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
          name: DENSITY_PATIENT_NAME,
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
            // TWO unresolved rows per visit (PIECE 4; it was one).
            //
            // The rule is that EVERY unresolved-supply row is on screen at
            // rest, and a fixture carrying one cannot tell that rule from a
            // weaker one — "the first unresolved row is visible" passes
            // identically, and it is the rule that fails a doctor with two
            // undecided medicines and a card tall enough for one.
            //
            // Two is the smallest number that distinguishes them. They are
            // deliberately NOT adjacent in insertion order, so a layout that
            // happens to show the top of the list is not mistaken for one that
            // sorts unresolved rows first (`unresolvedSupplyFirst`).
            supplyMode: i === 0 || i === 2 ? null : 'ONSITE_DISPENSE',
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

    // PIECE 4 — `unresolvedSupply` is handed to the spec rather than written
    // into it as a literal. The spec asserts that EVERY unresolved row is on
    // screen at rest, and a number copied into the spec by hand is one the two
    // files then have to be kept agreeing on — which is exactly how an
    // assertion quietly starts checking a count that no longer exists.
    const TYPICAL_COUNTS = { medications: 4, orders: 1, documents: 1, unresolvedSupply: 2 };
    const HEAVY_COUNTS = { medications: 10, orders: 4, documents: 3, unresolvedSupply: 2 };
    const typical = await buildVisit(TYPICAL_VISIT_NUMBER, TYPICAL_COUNTS);
    const heavy = await buildVisit(HEAVY_VISIT_NUMBER, HEAVY_COUNTS);

    // ---------------------------------------------------------------------
    // b4 PIECE C — THE SCHEDULING BACKBONE THE CANVAS BOOKS THROUGH.
    //
    // A follow-up booked from the canvas goes through the same three settings
    // a front-desk booking does, so the fixture has to plant all three or the
    // picker correctly offers nothing:
    //
    //   DOCTOR-SERVICE MAPPING  who may be booked for what
    //   DOCTOR SCHEDULE         the roster window a slot must fall inside
    //   SLOT CAPACITY           the slot length, and how many a day
    //
    // TWO services, and the second one is the point: `FOLLOW_UP_SERVICE` is
    // mapped to this doctor and `UNMAPPED_SERVICE` deliberately is not, so
    // "the picker offers only what the mapping allows" is assertable against a
    // service that exists and is refused rather than against an empty list.
    // ---------------------------------------------------------------------
    const ensureService = async (code: string, name: string) => {
      const existing = await tx.serviceCatalog.findFirst({ where: { code }, select: { id: true } });
      if (existing) {
        // UPDATE, not "leave it alone". `bookable` was added after these rows
        // existed, so a find-or-create left every previously-seeded database
        // with a service the availability engine refuses — and the booking
        // spec then failed for a reason that had nothing to do with booking.
        // The same trap this file already carries a warning about for visits.
        await tx.serviceCatalog.update({ where: { id: existing.id }, data: { bookable: true } });
        return existing;
      }
      return (
        await tx.serviceCatalog.create({
          data: {
            tenantId,
            code,
            name,
            category: 'Consultation',
            orderType: 'STANDARD_SERVICE',
            durationMinutesDefault: 30,
            price: 35,
            // BOOKABLE, or the availability engine answers
            // SERVICE_NOT_BOOKABLE and the spec sees an empty picker for a
            // reason that has nothing to do with what it is testing. The
            // column defaults to false so that nothing goes public by
            // migration; a fixture for a booking test has to say so.
            bookable: true,
          },
          select: { id: true },
        })
      );
    };
    const followUpService = await ensureService(FOLLOW_UP_SERVICE_CODE, FOLLOW_UP_SERVICE_NAME);
    const unmappedService = await ensureService(UNMAPPED_SERVICE_CODE, UNMAPPED_SERVICE_NAME);

    await tx.doctorServiceQualification.upsert({
      where: {
        tenantId_staffId_serviceId: {
          tenantId,
          staffId: doctor.id,
          serviceId: followUpService.id,
        },
      },
      update: {},
      create: { tenantId, staffId: doctor.id, serviceId: followUpService.id },
    });

    // A roster on EVERY day of the week, wide enough that the date the spec
    // picks cannot fall outside it. A single weekday window would make the
    // booking test pass or fail depending on which day CI ran — the thing
    // under test is the canvas booking through the engine, not the calendar.
    //
    // Stored as `@db.Time` values, which Prisma hands back as 1970-01-01
    // instants and `SlotAvailabilityService` reads with UTC getters. The
    // window is written in the same UTC terms the engine compares in.
    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
      const already = await tx.doctorSchedule.findFirst({
        where: { staffId: doctor.id, clinicId, dayOfWeek },
        select: { id: true },
      });
      if (already) continue;
      await tx.doctorSchedule.create({
        data: {
          tenantId,
          clinicId,
          staffId: doctor.id,
          dayOfWeek,
          // A REAL clinic day, in the CLINIC's wall clock. This used to be
          // 00:00-12:00 read as UTC, which agreed with the engine only by
          // accident on a UTC runner; the engine now converts through
          // `Clinic.timezone`.
          //
          // 08:00, not 00:00. A midnight-to-midnight window is technically
          // wider, and it makes the first slot the picker offers a MIDNIGHT
          // appointment — which is what the spec then books and asserts on.
          // A fixture that produces a booking no clinic would make is a
          // fixture that tests the wrong thing.
          startTime: new Date('1970-01-01T08:00:00.000Z'),
          endTime: new Date('1970-01-01T20:00:00.000Z'),
          effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        },
      });
    }

    await tx.slotCapacityConfig.upsert({
      where: {
        tenantId_clinicId_staffId_serviceId: {
          tenantId,
          clinicId,
          staffId: doctor.id,
          serviceId: followUpService.id,
        },
      },
      update: { slotLengthMinutes: SLOT_LENGTH_MINUTES, dailyCapacity: DAILY_CAPACITY },
      create: {
        tenantId,
        clinicId,
        staffId: doctor.id,
        serviceId: followUpService.id,
        slotLengthMinutes: SLOT_LENGTH_MINUTES,
        dailyCapacity: DAILY_CAPACITY,
      },
    });

    lines.push(
      `booking: ${FOLLOW_UP_SERVICE_NAME} mapped to ${doctor.id}, ` +
        `${SLOT_LENGTH_MINUTES}-min slots, capacity ${DAILY_CAPACITY}; ` +
        `${UNMAPPED_SERVICE_NAME} deliberately unmapped (${unmappedService.id})`,
    );

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
          // b4 PIECE C — the booking backbone, handed over the same way.
          booking: {
            patientName: DENSITY_PATIENT_NAME,
            followUpService: FOLLOW_UP_SERVICE_NAME,
            unmappedService: UNMAPPED_SERVICE_NAME,
            slotLengthMinutes: SLOT_LENGTH_MINUTES,
            dailyCapacity: DAILY_CAPACITY,
          },
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
