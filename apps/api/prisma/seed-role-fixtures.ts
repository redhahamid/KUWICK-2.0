import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient, SystemRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';

config({ path: join(__dirname, '..', '.env') });

/**
 * TASK 1 — the four fixtures the role boundaries are demonstrated with.
 *
 *   Dr A   DOCTOR + OWNER      the doctor who owns the clinic
 *   Dr B   DOCTOR              an ordinary doctor
 *   Ms X   CLINICAL_STAFF      vitals and allergies, no notes
 *   Ms Y   ADMINISTRATOR       demographics and billing, no clinical anything
 *
 * SYNTHETIC ONLY, and idempotent — upserted on email, safe to re-run.
 * Guarded: it refuses to run against anything but a local database, because
 * it creates logins with a known password.
 */
const PASSWORD = 'DevLocal!2026';
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

interface Fixture {
  email: string;
  fullName: string;
  legacyRole: 'DOCTOR_RESIDENT' | 'FRONT_DESK_CLINICAL_STAFF' | 'OWNER_ADMIN' | 'FINANCE_STAFF';
  roles: SystemRole[];
  credentialed: boolean;
  /** Distinct per doctor. A fixture for testing identity cannot share one. */
  registrationNo?: string;
}

const FIXTURES: Fixture[] = [
  {
    email: 'dr.a@smoke-test-clinic.test',
    fullName: 'Dr A Owner-Doctor',
    legacyRole: 'OWNER_ADMIN',
    roles: ['DOCTOR', 'OWNER'],
    credentialed: true,
    registrationNo: 'MMC 90001',
  },
  {
    email: 'dr.b@smoke-test-clinic.test',
    fullName: 'Dr B Resident',
    legacyRole: 'DOCTOR_RESIDENT',
    roles: ['DOCTOR'],
    credentialed: true,
    registrationNo: 'MMC 90002',
  },
  {
    email: 'ms.x@smoke-test-clinic.test',
    fullName: 'Ms X Clinical',
    legacyRole: 'FRONT_DESK_CLINICAL_STAFF',
    roles: ['CLINICAL_STAFF'],
    credentialed: false,
  },
  {
    email: 'ms.y@smoke-test-clinic.test',
    fullName: 'Ms Y Administrator',
    legacyRole: 'FINANCE_STAFF',
    roles: ['ADMINISTRATOR'],
    credentialed: false,
  },
];

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error('Refusing to seed logins against a non-local database.');
  }
  if (process.env.KUWICK_ALLOW_FIXTURES !== 'yes') {
    throw new Error('Set KUWICK_ALLOW_FIXTURES=yes to seed role fixtures.');
  }

  // `tenants` is not tenant-scoped, but RLS still needs the bypass here.
  const tenant = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_tenant_scope', 'true', true)`);
    return tx.tenant.findFirst({ select: { id: true, name: true } });
  });
  if (!tenant) throw new Error('No tenant.');

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenant.id);
    const clinic = await tx.clinic.findFirst({ where: { tenantId: tenant.id }, select: { id: true } });
    if (!clinic) throw new Error('No clinic.');

    // The granter. Attribution on a role assignment is not optional, so the
    // seed names an existing owner rather than inventing an actor.
    const granter = await tx.staff.findFirst({
      where: { role: 'OWNER_ADMIN', active: true },
      select: { id: true },
    });
    if (!granter) throw new Error('No owner to attribute the grants to.');

    console.log(`\nRole fixtures — tenant "${tenant.name}"`);
    console.log('='.repeat(70));

    for (const fixture of FIXTURES) {
      const user = await tx.user.upsert({
        where: { tenantId_email: { tenantId: tenant.id, email: fixture.email } },
        update: { passwordHash, status: 'active' },
        create: { tenantId: tenant.id, email: fixture.email, passwordHash, status: 'active' },
        select: { id: true },
      });

      // ALL EIGHT FIELDS, or the fixture is lying about itself.
      //
      // This block used to write six of them and print "credentialed", leaving
      // professionalType at its NON_CLINICAL default — so the two doctors it
      // advertised as able to sign could not sign, and a boundary check run
      // against them would have proved the credential gate held for the wrong
      // reason. `isCredentialedClinician` requires an active MEDICAL_DOCTOR
      // identity on top of the six signing fields, and so does
      // `canSignClinicalNotes`; a fixture that satisfies neither cannot
      // exercise either.
      const credentials = fixture.credentialed
        ? {
            professionalType: 'MEDICAL_DOCTOR' as const,
            professionalActive: true,
            medicalRegistrationNo: fixture.registrationNo ?? null,
            professionalVerifiedAt: new Date(),
            professionalVerifiedByStaffId: granter.id,
            canSignClinicalNotes: true,
            clinicalSigningEnabledAt: new Date(),
            clinicalSigningEnabledByStaffId: granter.id,
          }
        : {
            professionalType: 'NON_CLINICAL' as const,
            professionalActive: false,
            medicalRegistrationNo: null,
            professionalVerifiedAt: null,
            professionalVerifiedByStaffId: null,
            canSignClinicalNotes: false,
            clinicalSigningEnabledAt: null,
            clinicalSigningEnabledByStaffId: null,
          };

      const existing = await tx.staff.findFirst({ where: { userId: user.id }, select: { id: true } });
      const staff = existing
        ? await tx.staff.update({
            where: { id: existing.id },
            data: { fullName: fixture.fullName, role: fixture.legacyRole, active: true, ...credentials },
            select: { id: true },
          })
        : await tx.staff.create({
            data: {
              tenantId: tenant.id,
              clinicId: clinic.id,
              userId: user.id,
              fullName: fixture.fullName,
              role: fixture.legacyRole,
              active: true,
              ...credentials,
            },
            select: { id: true },
          });

      // Replace the assignment set outright: the fixture states the whole
      // truth about this person, and a stale extra role would quietly widen
      // the very boundary these fixtures exist to demonstrate.
      await tx.staffRoleAssignment.deleteMany({ where: { staffId: staff.id } });
      for (const role of fixture.roles) {
        await tx.staffRoleAssignment.create({
          data: { tenantId: tenant.id, staffId: staff.id, role, assignedByStaffId: granter.id },
        });
      }

      console.log(
        `  ${fixture.fullName.padEnd(22)} ${fixture.roles.join(' + ').padEnd(18)} ` +
          `${fixture.credentialed ? 'credentialed' : 'no registration'}  ${fixture.email}`,
      );
    }
  });

  console.log(`\n  password for all four: ${PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
