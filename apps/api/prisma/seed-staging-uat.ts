import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { credentialedClinicianFields } from '../src/core/credentialing';

config({ path: join(__dirname, '..', '.env') });

/**
 * G4.5-STAGING — bootstrap a STAGING/UAT environment from an EMPTY database.
 *
 * Why this exists. Every other seed in this repo assumes the tenant, clinic,
 * item catalogue and staff already exist — they were created by hand on the
 * original dev box and were never committed. A freshly migrated database
 * therefore has zero tenants, zero clinics, zero items and zero users, and
 * nothing in the repository could bring one up. That is what blocked standing
 * up a new environment, and this script closes it.
 *
 * SYNTHETIC DATA ONLY. Every identity here is obviously fake: the tenant is
 * "Klinik UAT Staging", identifiers are in the reserved 000000-00-xxxx form,
 * and every email is on the non-routable `.invalid` TLD reserved by RFC 2606.
 * Nothing in this file came from, or resembles, a real clinic record.
 *
 *   KUWICK_STAGING_SEED=yes npx tsx prisma/seed-staging-uat.ts
 *
 * Passwords are NEVER committed. They are read from STAGING_SEED_PASSWORD, or
 * generated randomly and printed once at the end of the run.
 */

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const TENANT_ID = 'ffffffff-0000-4000-8000-00000000staging'.replace('staging', '0001');
const TENANT_SLUG = 'kuwick-uat-staging';
const CLINIC_NAME = 'Klinik UAT Staging (Synthetic)';

/** RFC 2606 reserves `.invalid`; mail to it can never leave the building. */
const DOMAIN = 'uat.kuwick.invalid';

const ROLES = [
  { key: 'owner', email: `owner@${DOMAIN}`, fullName: 'UAT Owner (Synthetic)', role: 'OWNER_ADMIN' as const },
  { key: 'frontdesk', email: `frontdesk@${DOMAIN}`, fullName: 'UAT Front Desk (Synthetic)', role: 'FRONT_DESK_CLINICAL_STAFF' as const },
  { key: 'finance', email: `finance@${DOMAIN}`, fullName: 'UAT Finance (Synthetic)', role: 'FINANCE_STAFF' as const },
  { key: 'doctor', email: `doctor@${DOMAIN}`, fullName: 'Dr UAT Doctor (Synthetic)', role: 'DOCTOR_RESIDENT' as const },
  { key: 'stock', email: `stock@${DOMAIN}`, fullName: 'UAT Stock Staff (Synthetic)', role: 'STOCK_STAFF' as const },
];

/**
 * Refuse to run anywhere this could destroy or expose real data.
 *
 * Deliberately NOT satisfiable by one variable. Unlike the local fixture
 * scripts, this one is MEANT to run against a remote database, so the local
 * host check cannot be the guard — the guard is instead that the database
 * must be empty of any tenant other than the staging tenant itself.
 */
async function assertSafeToSeed(): Promise<void> {
  const problems: string[] = [];

  if (process.env.NODE_ENV === 'production') problems.push('NODE_ENV is production');
  if (process.env.KUWICK_STAGING_SEED !== 'yes') problems.push('KUWICK_STAGING_SEED is not "yes"');
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL is not set');

  if (problems.length === 0) {
    // The decisive check: this database must contain no tenant that is not
    // ours. Pointed at a real clinic database by mistake, it stops here.
    const rows = await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
      `SELECT id, name FROM tenants`,
    );
    const foreign = rows.filter((t) => t.id !== TENANT_ID);
    if (foreign.length > 0) {
      problems.push(
        `database already holds ${foreign.length} other tenant(s) — refusing to touch it ` +
          `(first: "${foreign[0].name}")`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      'Refusing to seed staging.\n' +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\n\nThis script creates synthetic UAT data and must never run against a real clinic database.',
    );
  }
}

function scoped<T>(fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    // The tenants table is FORCE RLS against its own id, so the very first
    // insert only works once the session already claims that tenant.
    await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_tenant_scope', 'true', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, TENANT_ID);
    return fn(tx);
  });
}

const nric = (n: number) => `000000-00-${String(1000 + n)}`;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60000);

async function main() {
  await assertSafeToSeed();

  const password = process.env.STAGING_SEED_PASSWORD ?? `Uat-${randomBytes(9).toString('base64url')}`;
  const passwordHash = await bcrypt.hash(password, 10);

  // --- 1. Tenant, clinic, room -------------------------------------------
  const { clinicId } = await scoped(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO tenants (id, name, slug, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', now(), now())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug`,
      TENANT_ID,
      'Kuwick UAT Staging (Synthetic)',
      TENANT_SLUG,
    );
    const existing = await tx.clinic.findFirst({ select: { id: true } });
    const clinic =
      existing ??
      (await tx.clinic.create({
        data: {
          tenantId: TENANT_ID,
          name: CLINIC_NAME,
          address: 'No. 1, Jalan Ujian, 43650 Bandar Baru Bangi, Selangor',
          phone: '+60 3-0000 0000',
          timezone: 'Asia/Kuala_Lumpur',
        },
      }));
    const room = await tx.room.findFirst({ where: { clinicId: clinic.id } });
    if (!room) {
      await tx.room.create({ data: { tenantId: TENANT_ID, clinicId: clinic.id, name: 'Consultation 1' } });
      await tx.room.create({ data: { tenantId: TENANT_ID, clinicId: clinic.id, name: 'Treatment Room' } });
    }
    return { clinicId: clinic.id };
  });

  // --- 2. Staff logins ----------------------------------------------------
  const staffIds: Record<string, string> = {};
  for (const account of ROLES) {
    staffIds[account.key] = await scoped(async (tx) => {
      const existingUser = await tx.user.findFirst({ where: { email: account.email } });
      const user =
        existingUser ??
        (await tx.user.create({
          data: { tenantId: TENANT_ID, email: account.email, passwordHash, status: 'active' },
        }));
      if (existingUser) {
        await tx.user.update({ where: { id: user.id }, data: { passwordHash, status: 'active' } });
      }
      const existingStaff = await tx.staff.findFirst({ where: { userId: user.id } });
      const isDoctor = account.role === 'DOCTOR_RESIDENT';
      // The owner is first in ROLES, so it exists by the time a doctor is
      // reached. Asserted rather than assumed — reordering ROLES would
      // otherwise silently mint an unattributed credential.
      const granterStaffId = staffIds.owner;
      if (isDoctor && !granterStaffId) {
        throw new Error('The owner must be seeded before a doctor: signing authority is granted BY somebody.');
      }
      const data = {
        role: account.role,
        fullName: account.fullName,
        active: true,
        clinicId,
        // A doctor must be able to sign a note, or the Documentation Pending
        // scenario below can never be cleared during UAT.
        //
        // This used to write five of the eight fields it needed and the UAT
        // doctor could not, in fact, sign anything — the second time that
        // defect shipped. There is now exactly ONE definition of
        // "credentialed" (src/core/credentialing.ts), tested against the
        // predicate itself, and no seed may hand-write these fields again.
        //
        // Attributed to the OWNER, who is created first in the same loop:
        // signing authority is granted BY somebody, and a credential with no
        // named granter is an assertion rather than a credential.
        ...(isDoctor
          ? credentialedClinicianFields({
              registrationNo: `MMC UAT-${account.key.toUpperCase()}`,
              grantedByStaffId: granterStaffId,
            })
          : {}),
      };
      const staff = existingStaff
        ? await tx.staff.update({ where: { id: existingStaff.id }, data })
        : await tx.staff.create({ data: { tenantId: TENANT_ID, userId: user.id, ...data } });
      return staff.id;
    });
  }

  // --- 3. Catalogue: medicines with deliberate stock positions ------------
  //
  // G4.5d6 — PCM125S is the syrup the dosage calculator needs.
  //
  // Without a medicine carrying concVolMl and strengthMg there is nothing on
  // staging to test the weight-based calculation against, and the paediatric
  // path — the one the calculator exists for — could only be reviewed by
  // reading the code. 125mg per 5ml is the standard paediatric paracetamol
  // suspension.
  const MEDICINES = [
    {
      code: 'PCM125S',
      name: 'Paracetamol 125mg/5ml Suspension',
      unit: 'ml',
      price: 8.5,
      strength: 125,
      concVolMl: 5,
      onHand: 30,
      min: 6,
      reference: '10-15MG/KG PER DOSE',
      // Age brackets, so the age-based path is testable too.
      brackets: [
        { ageFromMonths: 0, ageToMonths: 11, amount: '2.5', unit: 'ml', frequency: 'QID PRN' },
        { ageFromMonths: 12, ageToMonths: 35, amount: '5', unit: 'ml', frequency: 'QID PRN' },
        { ageFromMonths: 36, ageToMonths: 71, amount: '7.5', unit: 'ml', frequency: 'QID PRN' },
      ],
    },
    { code: 'PCM500', name: 'Paracetamol 500mg', unit: 'tablet', price: 0.3, strength: 500, onHand: 480, min: 50 },
    { code: 'AMX500', name: 'Amoxicillin 500mg', unit: 'capsule', price: 0.8, strength: 500, onHand: 240, min: 40 },
    // LOW: on hand is above zero but at/below the reorder threshold.
    { code: 'CTZ10', name: 'Cetirizine 10mg', unit: 'tablet', price: 0.25, strength: 10, onHand: 18, min: 20 },
    // INSUFFICIENT: fewer on hand than a normal course needs.
    { code: 'IBU400', name: 'Ibuprofen 400mg', unit: 'tablet', price: 0.35, strength: 400, onHand: 4, min: 30 },
    // OUT OF STOCK.
    { code: 'ORS01', name: 'ORS Sachets', unit: 'sachet', price: 1.2, strength: null, onHand: 0, min: 25 },
    { code: 'OMP20', name: 'Omeprazole 20mg', unit: 'capsule', price: 0.9, strength: 20, onHand: 150, min: 30 },
  ];

  const itemIds: Record<string, string> = {};
  for (const med of MEDICINES) {
    itemIds[med.code] = await scoped(async (tx) => {
      const existing = await tx.item.findFirst({ where: { code: med.code } });
      const item =
        existing ??
        (await tx.item.create({
          data: {
            tenantId: TENANT_ID,
            code: med.code,
            name: med.name,
            category: 'Medicine',
            unitOfMeasure: med.unit,
            doseUnitDefault: med.unit,
            frequencyDefault: 'TDS',
            durationDefault: '5',
            strengthMg: med.strength ?? undefined,
            concVolMl: med.concVolMl ?? undefined,
            prescriptionReference: med.reference ?? undefined,
            sellPrice: med.price,
            active: true,
          },
        }));
      // Age brackets are part of the medicine's definition, not stock.
      for (const bracket of med.brackets ?? []) {
        const already = await tx.itemAgeDosage.findFirst({
          where: { itemId: item.id, ageFromMonths: bracket.ageFromMonths },
        });
        if (!already) {
          await tx.itemAgeDosage.create({
            data: { tenantId: TENANT_ID, itemId: item.id, ...bracket },
          });
        }
      }
      await tx.stockLevel.upsert({
        where: { tenantId_clinicId_itemId: { tenantId: TENANT_ID, clinicId, itemId: item.id } },
        create: { tenantId: TENANT_ID, clinicId, itemId: item.id, quantityOnHand: med.onHand, minThreshold: med.min },
        update: { quantityOnHand: med.onHand, minThreshold: med.min },
      });
      return item.id;
    });
  }

  // --- 4. Services and a panel --------------------------------------------
  const SERVICES = [
    { name: 'General Consultation', orderType: 'STANDARD_SERVICE' as const, price: 35, minutes: 15 },
    { name: 'Wound Dressing', orderType: 'TASK_ORDER' as const, price: 25, minutes: 20 },
    { name: 'Full Blood Count', orderType: 'TASK_ORDER' as const, price: 45, minutes: 10 },
    { name: 'Nebuliser Therapy', orderType: 'TASK_ORDER' as const, price: 30, minutes: 20 },
  ];
  await scoped(async (tx) => {
    for (const svc of SERVICES) {
      const existing = await tx.serviceCatalog.findFirst({ where: { name: svc.name } });
      if (!existing) {
        await tx.serviceCatalog.create({
          data: {
            tenantId: TENANT_ID,
            name: svc.name,
            orderType: svc.orderType,
            durationMinutesDefault: svc.minutes,
            price: svc.price,
            active: true,
          },
        });
      }
    }
  });

  const panelId = await scoped(async (tx) => {
    const existing = await tx.panelClinic.findFirst({ where: { name: 'UAT Panel Sdn Bhd (Synthetic)' } });
    if (existing) return existing.id;
    const panel = await tx.panelClinic.create({
      data: { tenantId: TENANT_ID, name: 'UAT Panel Sdn Bhd (Synthetic)', code: 'UATPANEL', active: true },
    });
    return panel.id;
  });

  // --- 5. The UAT scenarios ----------------------------------------------
  let patientSeq = 0;
  let visitSeq = 0;

  async function scenario(spec: {
    name: string;
    complaint: string;
    queueStatus: string;
    waitedMinutes: number;
    doctorDone: boolean;
    signedNote: boolean;
    panel?: boolean;
    meds?: Array<{ code: string; quantity: number; status?: string; supplyMode?: string | null }>;
    vitals?: boolean;
    diagnosis?: boolean;
  }) {
    patientSeq += 1;
    visitSeq += 1;
    const seq = patientSeq;
    return scoped(async (tx) => {
      // Idempotent: re-running the seed against an already-seeded staging
      // database must be a no-op, not a unique-constraint crash.
      const already = await tx.patient.findFirst({
        where: { identifierValue: nric(seq) },
        select: { id: true, visits: { select: { id: true, visitNumber: true }, take: 1 } },
      });
      if (already) {
        return {
          visitId: already.visits[0]?.id ?? '',
          patientId: already.id,
          visitNumber: already.visits[0]?.visitNumber ?? '(existing)',
        };
      }
      const patient = await tx.patient.create({
        data: {
          tenantId: TENANT_ID,
          name: spec.name,
          identifierType: 'NRIC',
          identifierValue: nric(seq),
          phone: '+60 12-000 0000',
          gender: seq % 2 === 0 ? 'MALE' : 'FEMALE',
          dob: new Date(1985, (seq * 3) % 12, ((seq * 7) % 27) + 1),
        },
      });
      const checkIn = minutesAgo(spec.waitedMinutes);
      const visit = await tx.visit.create({
        data: {
          tenantId: TENANT_ID,
          clinicId,
          patientId: patient.id,
          staffId: staffIds.doctor,
          visitNumber: `UAT-${String(1000 + visitSeq)}`,
          billingType: spec.panel ? 'UAT Panel Sdn Bhd (Synthetic)' : 'Self-pay',
          panelClinicId: spec.panel ? panelId : null,
          panelVerificationStatus: spec.panel ? 'VERIFIED' : null,
          panelCoverageType: spec.panel ? 'UNLIMITED' : null,
          classification: 'FOLLOW_UP_NO_CONSULTATION',
          presentingComplaint: spec.complaint,
          checkInAt: checkIn,
          ...(spec.doctorDone
            ? { doctorCompletedAt: new Date(), doctorCompletedByStaffId: staffIds.doctor }
            : {}),
        },
      });
      await tx.queueTicket.create({
        data: {
          tenantId: TENANT_ID,
          clinicId,
          visitId: visit.id,
          ticketNumber: 100 + visitSeq,
          displayNumber: `W${String(100 + visitSeq)}`,
          queueType: 'WALK_IN',
          status: spec.queueStatus as never,
          createdAt: checkIn,
        },
      });

      if (spec.vitals) {
        await tx.visitObservation.create({
          data: {
            tenantId: TENANT_ID,
            clinicId,
            visitId: visit.id,
            recordedByStaffId: staffIds.doctor,
            // `visit_observations_recorder_identity_check` is all-or-nothing:
            // a row with a recorder must carry the name and role snapshot too.
            recorderNameSnapshot: 'Dr UAT Doctor (Synthetic)',
            recorderRoleSnapshot: 'DOCTOR_RESIDENT',
            recordedAt: checkIn,
            bpSystolic: 128,
            bpDiastolic: 82,
            pulse: 78,
            temperature: 37.4,
            weight: 68.5,
            height: 168,
            spo2: 98,
          },
        });
      }

      if (spec.signedNote) {
        await tx.clinicalNote.create({
          data: {
            tenantId: TENANT_ID,
            visitId: visit.id,
            notes: '<p>Synthetic UAT note. Impression: URTI. Plan: symptomatic treatment, review in 48h.</p>',
            noteLanguage: 'EN',
            noteType: 'DOCTOR_NARRATIVE',
            status: 'SIGNED',
            signedAt: new Date(),
            signedByStaffId: staffIds.doctor,
            signerNameSnapshot: 'Dr UAT Doctor (Synthetic)',
            signerRoleSnapshot: 'DOCTOR_RESIDENT',
            authorStaffId: staffIds.doctor,
            authorNameSnapshot: 'Dr UAT Doctor (Synthetic)',
            authorRoleSnapshot: 'DOCTOR_RESIDENT',
            legacyAuthorUnknown: false,
          },
        });
      } else if (spec.doctorDone) {
        // Documentation Pending: the doctor finished but the narrative is a
        // DRAFT, which is exactly what D-096 blocks visit completion on.
        await tx.clinicalNote.create({
          data: {
            tenantId: TENANT_ID,
            visitId: visit.id,
            notes: '<p>Synthetic UAT draft — not signed yet.</p>',
            noteLanguage: 'EN',
            noteType: 'DOCTOR_NARRATIVE',
            status: 'DRAFT',
            authorStaffId: staffIds.doctor,
            authorNameSnapshot: 'Dr UAT Doctor (Synthetic)',
            authorRoleSnapshot: 'DOCTOR_RESIDENT',
            legacyAuthorUnknown: false,
          },
        });
      }

      for (const med of spec.meds ?? []) {
        await tx.prescription.create({
          data: {
            tenantId: TENANT_ID,
            visitId: visit.id,
            itemId: itemIds[med.code],
            prescribedByStaffId: staffIds.doctor,
            amount: '1',
            unit: MEDICINES.find((m) => m.code === med.code)?.unit ?? 'tablet',
            frequency: 'TDS',
            durationDays: 5,
            quantity: med.quantity,
            supplyMode: (med.supplyMode === undefined ? 'ONSITE_DISPENSE' : med.supplyMode) as never,
            status: (med.status ?? 'ORDERED') as never,
            ...(med.status === 'DISPENSED'
              ? { dispensedAt: new Date(), dispensedByStaffId: staffIds.frontdesk }
              : {}),
          },
        });
      }
      return { visitId: visit.id, patientId: patient.id, visitNumber: visit.visitNumber };
    });
  }

  const created: Array<{ label: string; visitNumber: string; patient: string }> = [];
  const add = async (label: string, patient: string, spec: Parameters<typeof scenario>[0]) => {
    const r = await scenario(spec);
    created.push({ label, visitNumber: r.visitNumber, patient });
  };

  await add('Active consultation + vitals + multiple medications', 'Aisyah Ujian', {
    name: 'Aisyah Ujian (Synthetic)',
    complaint: 'Fever and productive cough for 3 days',
    queueStatus: 'IN_CONSULTATION',
    waitedMinutes: 20,
    doctorDone: false,
    signedNote: false,
    vitals: true,
    meds: [
      { code: 'PCM500', quantity: 15 },
      { code: 'AMX500', quantity: 15 },
      { code: 'CTZ10', quantity: 10 },
    ],
  });

  await add('Ready for Dispensary — adequate / low / insufficient / out-of-stock mix', 'Bakri Ujian', {
    name: 'Bakri Ujian (Synthetic)',
    complaint: 'Sore throat, body aches',
    queueStatus: 'READY_FOR_DISPENSARY',
    waitedMinutes: 55,
    doctorDone: true,
    signedNote: true,
    vitals: true,
    meds: [
      { code: 'PCM500', quantity: 15 },
      { code: 'CTZ10', quantity: 12 },
      { code: 'IBU400', quantity: 30 },
      { code: 'ORS01', quantity: 6 },
      { code: 'OMP20', quantity: 6, supplyMode: null },
    ],
  });

  await add('Ready for Dispensary — single item, drives Payment routing', 'Chandran Ujian', {
    name: 'Chandran Ujian (Synthetic)',
    complaint: 'Follow-up hypertension review',
    queueStatus: 'READY_FOR_DISPENSARY',
    waitedMinutes: 32,
    doctorDone: true,
    signedNote: true,
    vitals: true,
    meds: [{ code: 'PCM500', quantity: 10 }],
  });

  await add('Ready for Payment — self-pay balance outstanding', 'Devi Ujian', {
    name: 'Devi Ujian (Synthetic)',
    complaint: 'Allergic rhinitis',
    queueStatus: 'READY_FOR_PAYMENT',
    waitedMinutes: 68,
    doctorDone: true,
    signedNote: true,
    vitals: true,
    meds: [{ code: 'CTZ10', quantity: 10, status: 'DISPENSED' }],
  });

  await add('Panel patient — zero patient responsibility', 'Faridah Ujian', {
    name: 'Faridah Ujian (Synthetic)',
    complaint: 'Panel screening visit',
    queueStatus: 'READY_FOR_PAYMENT',
    waitedMinutes: 74,
    doctorDone: true,
    signedNote: true,
    panel: true,
    vitals: true,
    meds: [{ code: 'PCM500', quantity: 10, status: 'DISPENSED' }],
  });

  await add('Documentation Pending — doctor done, note unsigned', 'Gopal Ujian', {
    name: 'Gopal Ujian (Synthetic)',
    complaint: 'Lower back pain',
    queueStatus: 'READY_FOR_PAYMENT',
    waitedMinutes: 41,
    doctorDone: true,
    signedNote: false,
    vitals: true,
    meds: [{ code: 'PCM500', quantity: 10, status: 'DISPENSED' }],
  });

  await add('Eligible Complete Visit — nothing outstanding', 'Hafiz Ujian', {
    name: 'Hafiz Ujian (Synthetic)',
    complaint: 'Medical certificate review',
    queueStatus: 'READY_FOR_PAYMENT',
    waitedMinutes: 88,
    doctorDone: true,
    signedNote: true,
    vitals: true,
    meds: [],
  });

  await add('Waiting — front desk starting point', 'Intan Ujian', {
    name: 'Intan Ujian (Synthetic)',
    complaint: 'Cough and cold',
    queueStatus: 'WAITING',
    waitedMinutes: 8,
    doctorDone: false,
    signedNote: false,
  });

  // --- 6. Invoices, generated by the APPLICATION ------------------------
  //
  // Deliberately not hand-written. Responsibility splitting, panel markup and
  // consultation tariffs are the pricing engine's job, and a seed that wrote
  // invoice rows itself would be a second, silently diverging implementation
  // of the billing rules. So the payment-stage visits get their invoice from
  // the same endpoints the front desk uses.
  //
  // Optional: set STAGING_SEED_API to the API base URL. Without it the visits
  // simply arrive at Billing Review unbilled, which is a legitimate — and
  // testable — starting state.
  const apiBase = process.env.STAGING_SEED_API;
  if (apiBase) {
    const login = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `frontdesk@${DOMAIN}`, password }),
    });
    const session = (await login.json()) as { accessToken?: string; staff?: { id: string } };
    if (session.accessToken) {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      };
      const payable = await scoped((tx) =>
        tx.queueTicket.findMany({
          where: { status: 'READY_FOR_PAYMENT' as never },
          select: { visitId: true },
        }),
      );
      for (const { visitId } of payable) {
        try {
          const made = await fetch(`${apiBase}/invoices`, {
            method: 'POST',
            headers,
            // createdByStaffId is required: invoice creation is attributed to
            // the staff member raising it, not defaulted server-side.
            body: JSON.stringify({ visitId, createdByStaffId: session.staff?.id }),
          });
          const invoice = (await made.json()) as { id?: string };
          if (invoice.id) {
            await fetch(`${apiBase}/invoices/${invoice.id}/ensure-consultation`, {
              method: 'POST',
              headers,
              body: JSON.stringify({}),
            });
          }
        } catch (error) {
          // A seed must not fail because one optional convenience step did —
          // but it must not hide the reason either.
          console.log(`  invoice for ${visitId}: ${(error as Error).message.slice(0, 80)}`);
        }
      }
      console.log(`\ninvoices generated for ${payable.length} payment-stage visit(s) via the API`);
    }
  } else {
    console.log('\nSTAGING_SEED_API not set — payment-stage visits start unbilled (still testable).');
  }

  // --- Report -------------------------------------------------------------
  console.log('\n=== KUWICK staging UAT seed complete ===');
  console.log(`tenant   : Kuwick UAT Staging (Synthetic)  [${TENANT_SLUG}]`);
  console.log(`clinic   : ${CLINIC_NAME}`);
  console.log('\nsynthetic logins (all share one password):');
  for (const a of ROLES) console.log(`  ${a.role.padEnd(28)} ${a.email}`);
  console.log(`\n  password: ${password}`);
  if (!process.env.STAGING_SEED_PASSWORD) {
    console.log('  (generated — set STAGING_SEED_PASSWORD to choose your own)');
  }
  console.log('\nUAT scenarios:');
  for (const c of created) console.log(`  ${c.visitNumber}  ${c.patient.padEnd(18)} ${c.label}`);
  console.log('\nstock positions:');
  for (const m of MEDICINES) {
    const state = m.onHand === 0 ? 'OUT OF STOCK' : m.onHand <= m.min ? 'LOW' : 'ADEQUATE';
    console.log(`  ${m.name.padEnd(22)} on hand ${String(m.onHand).padStart(4)}  min ${String(m.min).padStart(3)}  ${state}`);
  }
  console.log('');
}

main()
  .catch((error) => {
    console.error(`\n${(error as Error).message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
