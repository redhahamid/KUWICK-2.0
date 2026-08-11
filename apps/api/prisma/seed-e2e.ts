import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: join(__dirname, '..', '.env') });

/**
 * THE GUARDRAIL — the world the golden path needs, and nothing else.
 *
 * `seed-staging-uat.ts` brings an EMPTY database up to a working clinic:
 * tenant, clinic, staff, medicines with stock. This script runs after it and
 * guarantees the four things the golden path asserts on, each of which the
 * staging seed either does not create or creates incompletely:
 *
 *   1. A doctor who can actually SIGN. The staging seed sets six of the eight
 *      credential fields and comments that "a doctor must be able to sign a
 *      note" — but `isCredentialedClinician` also wants a medical registration
 *      number and a named verifier, so the doctor it creates cannot sign. The
 *      same defect existed in seed-role-fixtures and was fixed there; this
 *      closes it here rather than leaving CI to discover it as a mystery.
 *   2. J06.9 in the diagnosis catalogue — the code the golden path types.
 *   3. A consultation tariff rule covering the whole day, so a CONSULTATION
 *      visit gets its consultation line. Without one the golden path's
 *      "invoice has consult + med lines" assertion has nothing to find, and
 *      the OTC variant's "no consult line" would pass vacuously.
 *   4. One medication that is in stock, priced, and dispensable.
 *
 * Idempotent: safe to re-run, never deletes, never duplicates.
 *
 * SYNTHETIC DATA ONLY — it works exclusively inside the staging seed's own
 * synthetic tenant and creates no patient of its own (the golden path
 * registers its patient through the UI, which is the point).
 *
 *   KUWICK_STAGING_SEED=yes npx tsx prisma/seed-staging-uat.ts
 *   npx tsx prisma/seed-e2e.ts
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const TENANT_SLUG = 'kuwick-uat-staging';

/** The medicine the golden path prescribes and dispenses. */
export const E2E_MEDICATION = 'Paracetamol 500mg';
export const E2E_DIAGNOSIS_CODE = 'J06.9';
export const E2E_DIAGNOSIS_NAME = 'Acute upper respiratory infection';
/** Enough that a run — or a hundred — never exhausts it. */
const STOCK_ON_HAND = 5_000;

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * The tenants table is FORCE RLS against its own id, so the tenant lookup
 * needs the bypass and the work that follows needs the scope. Both in one
 * transaction, same pattern as tenant-scoped-prisma.provider.ts.
 */
async function inTenant<T>(fn: (tx: Tx, tenantId: string, clinicId: string) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const tenant = await tx.tenant.findFirst({ where: { slug: TENANT_SLUG }, select: { id: true } });
    if (!tenant) {
      throw new Error(
        `No tenant with slug "${TENANT_SLUG}". Run: KUWICK_STAGING_SEED=yes npx tsx prisma/seed-staging-uat.ts`,
      );
    }
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'false', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
    const clinic = await tx.clinic.findFirst({ where: { tenantId: tenant.id }, select: { id: true } });
    if (!clinic) throw new Error('The staging tenant has no clinic.');
    return fn(tx, tenant.id, clinic.id);
  });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');

  const report = await inTenant(async (tx, tenantId, clinicId) => {
    const lines: string[] = [];

    // --- 1. A doctor who can sign -------------------------------------
    //
    // The verifier is the OWNER, which is also what the real flow requires:
    // signing authority is granted BY somebody, and a credential with no
    // named granter is not a credential.
    const owner = await tx.staff.findFirst({ where: { role: 'OWNER_ADMIN' }, select: { id: true } });
    const doctors = await tx.staff.findMany({
      where: { role: { in: ['DOCTOR_RESIDENT', 'DOCTOR_LOCUM'] } },
      select: { id: true, fullName: true, medicalRegistrationNo: true },
    });
    if (doctors.length === 0) throw new Error('The staging tenant has no doctor.');
    if (!owner) throw new Error('The staging tenant has no owner to attribute the credential to.');

    for (const [index, doctor] of doctors.entries()) {
      await tx.staff.update({
        where: { id: doctor.id },
        data: {
          professionalType: 'MEDICAL_DOCTOR',
          professionalActive: true,
          // Distinct per doctor — a registration number two people share is
          // not an identity.
          medicalRegistrationNo: doctor.medicalRegistrationNo?.trim() || `MMC E2E-${9000 + index}`,
          professionalVerifiedAt: new Date(),
          professionalVerifiedByStaffId: owner.id,
          canSignClinicalNotes: true,
          clinicalSigningEnabledAt: new Date(),
          clinicalSigningEnabledByStaffId: owner.id,
        },
      });
      lines.push(`doctor credentialed: ${doctor.fullName}`);
    }

    // --- 2. The diagnosis the golden path types ------------------------
    const existingDiagnosis = await tx.diagnosisCatalog.findFirst({
      where: { OR: [{ icd10Code: E2E_DIAGNOSIS_CODE }, { name: E2E_DIAGNOSIS_NAME }] },
      select: { id: true },
    });
    if (existingDiagnosis) {
      await tx.diagnosisCatalog.update({
        where: { id: existingDiagnosis.id },
        data: { icd10Code: E2E_DIAGNOSIS_CODE, name: E2E_DIAGNOSIS_NAME, shortform: 'URTI', active: true },
      });
      lines.push(`diagnosis present: ${E2E_DIAGNOSIS_CODE}`);
    } else {
      await tx.diagnosisCatalog.create({
        data: {
          tenantId,
          icd10Code: E2E_DIAGNOSIS_CODE,
          name: E2E_DIAGNOSIS_NAME,
          shortform: 'URTI',
          category: 'SUMMARIZE',
        },
      });
      lines.push(`diagnosis created: ${E2E_DIAGNOSIS_CODE}`);
    }

    // --- 3. A consultation tariff that covers the whole day ------------
    //
    // Whole-day on purpose: a CI runner can start a test at any hour, and a
    // guardrail that passes at 09:00 and fails at 23:00 teaches people to
    // re-run it rather than read it.
    let consultationService = await tx.serviceCatalog.findFirst({
      where: { name: 'Consultation (E2E)' },
      select: { id: true },
    });
    if (!consultationService) {
      consultationService = await tx.serviceCatalog.create({
        data: {
          tenantId,
          name: 'Consultation (E2E)',
          code: 'E2E-CONSULT',
          category: 'Consultation',
          orderType: 'TASK_ORDER',
          durationMinutesDefault: 10,
          price: 35,
        },
        select: { id: true },
      });
    }

    const existingRule = await tx.consultationTariffRule.findFirst({
      where: { clinicId, classification: 'CONSULTATION', active: true },
      select: { id: true },
    });
    if (existingRule) {
      await tx.consultationTariffRule.update({
        where: { id: existingRule.id },
        data: { startTime: '00:00', endTime: '23:59', serviceCatalogId: consultationService.id, active: true },
      });
      lines.push('consultation tariff: widened to the whole day');
    } else {
      await tx.consultationTariffRule.create({
        data: {
          tenantId,
          clinicId,
          name: 'E2E all-day consultation',
          classification: 'CONSULTATION',
          startTime: '00:00',
          endTime: '23:59',
          serviceCatalogId: consultationService.id,
        },
      });
      lines.push('consultation tariff: created (all day)');
    }

    // --- 4. A medicine in stock ----------------------------------------
    let item = await tx.item.findFirst({ where: { name: E2E_MEDICATION }, select: { id: true } });
    if (!item) {
      item = await tx.item.create({
        data: {
          tenantId,
          name: E2E_MEDICATION,
          category: 'Medication',
          unitOfMeasure: 'tablet',
          sellPrice: 8,
        },
        select: { id: true },
      });
      lines.push(`medication created: ${E2E_MEDICATION}`);
    }

    // Stock is SET, never added — re-running must not inflate the position.
    await tx.stockLevel.upsert({
      where: { tenantId_clinicId_itemId: { tenantId, clinicId, itemId: item.id } },
      update: { quantityOnHand: STOCK_ON_HAND },
      create: { tenantId, itemId: item.id, clinicId, quantityOnHand: STOCK_ON_HAND, minThreshold: 20 },
    });
    lines.push(`${E2E_MEDICATION}: ${STOCK_ON_HAND} on hand`);

    return lines;
  });

  console.log('\nE2E world ready\n' + '='.repeat(60));
  for (const line of report) console.log(`  ${line}`);
  console.log('');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
