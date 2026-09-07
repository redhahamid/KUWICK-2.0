import { join } from 'node:path';
import { config } from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { isSyntheticTenantName } from '../src/core/synthetic-tenant';
import { credentialedClinicianFields } from '../src/core/credentialing';

config({ path: join(__dirname, '..', '.env') });

/**
 * HYBRID HR UAT — enough workforce history to test with, and no more.
 *
 * The staging world is a clinical/queue world: patients, visits, invoices and
 * a medicine catalogue. It has almost no workforce in it, so an owner opening
 * HR sees empty screens and cannot tell "nothing has happened yet" from
 * "nothing works".
 *
 * THIS IS AN AUGMENTATION, NOT A SEED. It never deletes, never resets, and
 * never rebuilds a tenant. Everything it writes is keyed so a second run
 * updates rather than duplicates, and it refuses outright against any database
 * holding a tenant that is not marked synthetic.
 *
 * AND IT DELIBERATELY LEAVES SEPTEMBER OPEN.
 *
 * August is complete — rostered, punched, one late arrival, one missing punch
 * resolved, approved overtime, approved leave, unpaid leave, a claim paid with
 * salary and a claim reimbursed by Finance. September is deliberately NOT
 * finished: a late arrival nobody has looked at, a missing punch nobody has
 * fixed, extra hours nobody has approved, a leave request waiting, a claim
 * waiting, a correction request waiting. Those decisions are the UAT. A world
 * where every decision is already made is a demonstration, not a test.
 *
 *   KUWICK_HR_UAT_AUGMENT=yes npx tsx prisma/augment-hr-uat.ts
 */

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

/** Whatever client the current call is writing through — the CLI's, or a test's. */
type Client = Pick<PrismaClient, '$transaction'>;

/** RFC 2606 reserves `.invalid`; nothing here can reach a real inbox. */
const DOMAIN = 'hr-uat.kuwick.invalid';
const PASSWORD = process.env.HR_UAT_PASSWORD ?? 'HrUat!2026';

/**
 * The people. Deliberately a MIX, because the shapes are what is being tested:
 * weekly-pattern staff and shift staff, an overnight nurse, a part-time locum
 * doctor, and people who are not providers at all.
 */
const PEOPLE = [
  { key: 'nurse', name: 'Nurul Hidayah (Synthetic)', role: 'FRONT_DESK_CLINICAL_STAFF', position: 'Staff Nurse', pattern: 'DAY', salary: '3200.00', login: true },
  { key: 'night', name: 'Siti Malam (Synthetic)', role: 'FRONT_DESK_CLINICAL_STAFF', position: 'Night Nurse', pattern: 'NIGHT', salary: '3600.00', login: true },
  { key: 'reception', name: 'Farah Kaunter (Synthetic)', role: 'FRONT_DESK_CLINICAL_STAFF', position: 'Receptionist', pattern: 'DAY', salary: '2400.00', login: true },
  { key: 'dispensary', name: 'Aziz Farmasi (Synthetic)', role: 'STOCK_STAFF', position: 'Dispensary Assistant', pattern: 'DAY', salary: '2600.00', login: false },
  { key: 'finance', name: 'Chandra Kewangan (Synthetic)', role: 'FINANCE_STAFF', position: 'Finance Executive', pattern: 'OFFICE', salary: '4200.00', login: false },
  { key: 'locum', name: 'Dr Lim Locum (Synthetic)', role: 'DOCTOR_LOCUM', position: 'Locum Doctor', pattern: 'PARTTIME', salary: null, registration: 'MMC UAT-LOCUM', login: false },
] as const;

type PersonKey = (typeof PEOPLE)[number]['key'];

async function scoped<T>(
  client: Client,
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (tx) => {
    // The bypass is needed because a few policies are written to require it,
    // and it cuts BOTH ways: with it on, a lookup that does not name the tenant
    // searches every tenant in the database. So every query below carries
    // `tenantId` explicitly — the guard keeps this to a one-tenant database in
    // practice, but "in practice" is not a constraint the queries can rely on,
    // and a test running against a shared database found exactly that.
    await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_tenant_scope', 'true', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
    return fn(tx);
  }, { timeout: 120_000 });
}

/**
 * Refuse to run anywhere this could touch a real clinic.
 *
 * Meant to be pointed at a REMOTE UAT box, so "is it localhost" proves
 * nothing. What proves something is that every tenant in the database is one a
 * seed in this repository invented.
 */
export interface AugmentEnvironment {
  nodeEnv?: string;
  flag?: string;
  databaseUrl?: string;
}

/**
 * WOULD IT REFUSE, AND WHY — as a pure decision.
 *
 * Separated from the database read so the refusals can be tested without a
 * database to be refused against, and so each one is a sentence somebody can
 * act on rather than a thrown string assembled at the call site.
 */
export function augmentationRefusals(env: AugmentEnvironment, tenants: { name: string }[]): string[] {
  const problems: string[] = [];
  if (env.nodeEnv === 'production') problems.push('NODE_ENV is production');
  if (env.flag !== 'yes') problems.push('KUWICK_HR_UAT_AUGMENT is not "yes"');
  if (!env.databaseUrl) problems.push('DATABASE_URL is not set');
  if (problems.length) return problems;

  if (tenants.length === 0) return ['No tenant here. Seed a UAT world first.'];
  const real = tenants.filter((t) => !isSyntheticTenantName(t.name));
  if (real.length > 0) {
    return [
      `${real.map((t) => `"${t.name}"`).join(', ')} ${real.length === 1 ? 'is' : 'are'} not marked synthetic. This looks like a real database.`,
    ];
  }
  if (tenants.length > 1) {
    return [`Refusing to guess: ${tenants.length} synthetic tenants here. Point DATABASE_URL at one at a time.`];
  }
  return [];
}

async function assertSafe(): Promise<{ tenantId: string; tenantName: string }> {
  const env: AugmentEnvironment = {
    nodeEnv: process.env.NODE_ENV,
    flag: process.env.KUWICK_HR_UAT_AUGMENT,
    databaseUrl: process.env.DATABASE_URL,
  };
  // The environment half can refuse before anything is read, so a run pointed
  // at the wrong database with the flag unset never opens a connection to it.
  const early = augmentationRefusals(env, [{ name: 'Placeholder (Synthetic)' }]);
  if (early.length) throw new Error(`Refusing to run:\n  - ${early.join('\n  - ')}`);

  const tenants = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_tenant_scope', 'true', true)`);
    return tx.$queryRawUnsafe<{ id: string; name: string }[]>(`SELECT id, name FROM tenants`);
  });
  const refusals = augmentationRefusals(env, tenants);
  if (refusals.length) throw new Error(`Refusing to run:\n  - ${refusals.join('\n  - ')}`);
  return { tenantId: tenants[0].id, tenantName: tenants[0].name };
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** A clinic wall-clock time on a date, in Malaysia (UTC+8). */
const at = (iso: string, hour: number, minute = 0) =>
  new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)), hour - 8, minute));

/** Weekdays of a month, as `YYYY-MM-DD`. */
function weekdays(year: number, month: number): string[] {
  const dates: string[] = [];
  for (let d = 1; d <= 31; d += 1) {
    const date = new Date(Date.UTC(year, month - 1, d));
    if (date.getUTCMonth() !== month - 1) break;
    const weekday = date.getUTCDay();
    if (weekday !== 0) dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * THE WORK ITSELF, over a client and a tenant somebody else chose.
 *
 * `assertSafe` decides WHERE this may run; this decides WHAT it writes. Keeping
 * them apart is what makes the idempotence claim testable: a test can prepare
 * its own synthetic tenant and run this twice, which it could not do through a
 * guard whose whole job is to refuse a database with more than one tenant in
 * it.
 */
export async function augmentHrUat(client: Client, tenantId: string): Promise<string[]> {
  const summary: string[] = [];

  const staffIds = await scoped(client, tenantId, async (tx) => {
    const clinic = await tx.clinic.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });
    if (!clinic) throw new Error('No clinic in this tenant. Seed a UAT world first.');

    // An owner to attribute credentials and approvals to. Any existing one
    // will do — this never creates a second.
    const owner = await tx.staff.findFirst({ where: { tenantId, role: 'OWNER_ADMIN' }, orderBy: { createdAt: 'asc' } });
    if (!owner) throw new Error('No owner in this tenant to attribute approvals to.');

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const ids: Record<string, string> = {};

    for (const person of PEOPLE) {
      // KEYED ON THE NAME, so a second run updates the same person rather than
      // minting a second Nurul.
      let staff = await tx.staff.findFirst({ where: { tenantId, fullName: person.name } });
      let userId = staff?.userId ?? null;

      if (person.login && !userId) {
        const email = `${person.key}@${DOMAIN}`;
        const existing = await tx.user.findFirst({ where: { tenantId, email } });
        userId =
          existing?.id ??
          (await tx.user.create({ data: { tenantId, email, passwordHash, status: 'active' } })).id;
      }

      const data = {
        role: person.role as never,
        fullName: person.name,
        active: true,
        clinicId: clinic.id,
        userId,
        ...('registration' in person && person.registration
          ? credentialedClinicianFields({ registrationNo: person.registration, grantedByStaffId: owner.id })
          : {}),
      };
      staff = staff
        ? await tx.staff.update({ where: { id: staff.id }, data })
        : await tx.staff.create({ data: { ...data, tenantId } });
      ids[person.key] = staff.id;

      await tx.employeeProfile.upsert({
        where: { staffId: staff.id },
        create: {
          tenantId,
          staffId: staff.id,
          employeeNo: `HR-${person.key.toUpperCase()}`,
          position: person.position,
          department: person.role === 'FINANCE_STAFF' ? 'Finance' : person.role === 'STOCK_STAFF' ? 'Pharmacy' : 'Clinical',
          employmentType: person.key === 'locum' ? 'LOCUM' : 'PERMANENT',
          employmentStatus: 'ACTIVE',
          startDate: day('2025-06-01'),
          identifierType: 'NRIC',
          // The reserved 000000-00-xxxx form every synthetic seed here uses.
          identifierValue: `000000-00-${1000 + PEOPLE.findIndex((p) => p.key === person.key)}`,
          dateOfBirth: day('1992-03-14'),
          phone: '+60 3-0000 0000',
          email: `${person.key}@${DOMAIN}`,
          bankName: 'Bank Ujian (Synthetic)',
          bankAccountNo: `000${1000 + PEOPLE.findIndex((p) => p.key === person.key)}`,
          bankAccountName: person.name,
        },
        update: { position: person.position, employmentStatus: 'ACTIVE' },
      });

      // SALARY IS EFFECTIVE-DATED. Written through its own table, from a real
      // date, because that is the one payroll resolves.
      if (person.salary) {
        const existing = await tx.employeeSalary.findFirst({
          where: { staffId: staff.id, effectiveFrom: day('2025-06-01') },
        });
        if (!existing) {
          await tx.employeeSalary.create({
            data: {
              tenantId,
              staffId: staff.id,
              basis: 'MONTHLY',
              amount: person.salary,
              effectiveFrom: day('2025-06-01'),
              reason: 'Synthetic UAT starting salary',
              createdByStaffId: owner.id,
            },
          });
        }
      }
    }

    summary.push(`${PEOPLE.length} synthetic employees (${PEOPLE.filter((p) => p.login).length} with a login)`);
    return { ids: ids as Record<PersonKey, string>, clinicId: clinic.id, ownerId: owner.id };
  });

  // -------------------------------------------------------------------------
  // ROSTER — August complete, September published.
  // -------------------------------------------------------------------------
  await scoped(client, tenantId, async (tx) => {
    let created = 0;
    for (const [year, month] of [[2026, 8], [2026, 9]] as const) {
      for (const date of weekdays(year, month)) {
        const isSaturday = new Date(`${date}T00:00:00.000Z`).getUTCDay() === 6;
        for (const person of PEOPLE) {
          // A PART-TIME LOCUM WORKS SOME DAYS, which is the point of having one.
          if (person.pattern === 'PARTTIME' && new Date(`${date}T00:00:00.000Z`).getUTCDay() % 3 !== 0) continue;
          // Office staff do not work Saturdays; clinical staff do a half day.
          if (person.pattern === 'OFFICE' && isSaturday) continue;

          const [startHour, endHour] =
            person.pattern === 'NIGHT'
              ? [23, 7]
              : isSaturday
                ? [8, 13]
                : person.pattern === 'OFFICE'
                  ? [9, 18]
                  : [8, 17];

          const shiftDate = day(date);
          const startsAt = at(date, startHour);
          // AN OVERNIGHT SHIFT ENDS THE NEXT MORNING — one shift, two instants.
          const endsAt = endHour <= startHour ? new Date(at(date, endHour).getTime() + 86400000) : at(date, endHour);

          const existing = await tx.providerShift.findFirst({
            where: { staffId: staffIds.ids[person.key], shiftDate, startsAt },
          });
          if (existing) continue;
          await tx.providerShift.create({
            data: {
              tenantId,
              clinicId: staffIds.clinicId,
              staffId: staffIds.ids[person.key],
              shiftDate,
              startsAt,
              endsAt,
              shiftType: 'WORKING',
              createdByStaffId: staffIds.ownerId,
            },
          });
          created += 1;
        }
      }
    }
    summary.push(`${created} roster shifts across August and September (idempotent — a second run adds none)`);
  });

  // -------------------------------------------------------------------------
  // AUGUST — a finished month, with the exceptions already resolved.
  // -------------------------------------------------------------------------
  await scoped(client, tenantId, async (tx) => {
    let punches = 0;
    for (const date of weekdays(2026, 8)) {
      for (const person of PEOPLE) {
        const shift = await tx.providerShift.findFirst({
          where: { staffId: staffIds.ids[person.key], shiftDate: day(date) },
        });
        if (!shift) continue;
        const existing = await tx.attendanceRecord.findFirst({
          where: { staffId: staffIds.ids[person.key], workDate: day(date) },
        });
        if (existing) continue;

        // ONE LATE ARRIVAL and ONE RESOLVED MISSING PUNCH in the whole month,
        // because a month where everybody is perfect tests nothing and a month
        // where nobody is tests nothing either.
        const late = person.key === 'reception' && date === '2026-08-11';
        const wasMissing = person.key === 'nurse' && date === '2026-08-19';
        const clockInAt = new Date(shift.startsAt.getTime() + (late ? 22 : -3) * 60000);
        const clockOutAt = new Date(shift.endsAt.getTime() + (person.key === 'night' && date === '2026-08-05' ? 65 : 4) * 60000);
        const workedMinutes = Math.round((clockOutAt.getTime() - clockInAt.getTime()) / 60000);

        await tx.attendanceRecord.create({
          data: {
            tenantId,
            staffId: staffIds.ids[person.key],
            clinicId: staffIds.clinicId,
            workDate: day(date),
            clockInAt,
            clockOutAt,
            scheduledStart: shift.startsAt,
            scheduledEnd: shift.endsAt,
            status: late ? 'LATE' : 'PRESENT',
            lateMinutes: late ? 17 : 0,
            earlyOutMinutes: 0,
            workedMinutes,
            // APPROVED overtime on the night nurse's long shift, and nothing
            // else — extra time is not overtime until somebody says so.
            overtimeMinutes: person.key === 'night' && date === '2026-08-05' ? 60 : 0,
            overtimeApproved: person.key === 'night' && date === '2026-08-05',
            overtimeApprovedByStaffId: person.key === 'night' && date === '2026-08-05' ? staffIds.ownerId : null,
            // A missing punch that a manager FIXED, with the original kept.
            ...(wasMissing
              ? {
                  correctedAt: at('2026-08-20', 9),
                  correctedByStaffId: staffIds.ownerId,
                  correctionReason: 'Correction requested by the employee: tablet was offline at closing.',
                  originalClockOutAt: null,
                }
              : {}),
          },
        });
        punches += 1;
      }
    }
    summary.push(`${punches} August attendance records — 1 late, 1 corrected missing punch, 1 approved overtime`);
  });

  // -------------------------------------------------------------------------
  // AUGUST leave and claims — decided.
  // -------------------------------------------------------------------------
  await scoped(client, tenantId, async (tx) => {
    const decided = [
      { key: 'nurse' as const, type: 'ANNUAL' as const, from: '2026-08-24', to: '2026-08-25', status: 'APPROVED' as const },
      { key: 'reception' as const, type: 'UNPAID' as const, from: '2026-08-13', to: '2026-08-13', status: 'APPROVED' as const },
    ];
    for (const row of decided) {
      const existing = await tx.leaveRequest.findFirst({
        where: { staffId: staffIds.ids[row.key], startDate: day(row.from) },
      });
      if (existing) continue;
      await tx.leaveRequest.create({
        data: {
          tenantId,
          staffId: staffIds.ids[row.key],
          leaveType: row.type,
          startDate: day(row.from),
          endDate: day(row.to),
          status: row.status,
          reason: row.type === 'UNPAID' ? 'Personal matter, unpaid.' : 'Family trip.',
          approvedByStaffId: staffIds.ownerId,
        },
      });
    }

    // TWO CLAIMS, TWO ROUTES — the invariant the product exists to hold is
    // that a claim paid through salary is never also reimbursed by Finance.
    const claims = [
      { key: 'nurse' as const, category: 'TRAINING' as const, amount: '180.00', date: '2026-08-07', route: 'PAYROLL' as const, description: 'Paediatric life-support refresher (synthetic).' },
      { key: 'dispensary' as const, category: 'TRAVEL' as const, amount: '64.50', date: '2026-08-18', route: 'FINANCE' as const, description: 'Taxi to the other branch for a stock transfer (synthetic).' },
    ];
    for (const claim of claims) {
      const existing = await tx.staffClaim.findFirst({
        where: { staffId: staffIds.ids[claim.key], claimDate: day(claim.date) },
      });
      if (existing) continue;
      await tx.staffClaim.create({
        data: {
          tenantId,
          clinicId: staffIds.clinicId,
          staffId: staffIds.ids[claim.key],
          category: claim.category,
          amountClaimed: claim.amount,
          amountApproved: claim.amount,
          claimDate: day(claim.date),
          description: claim.description,
          status: 'APPROVED',
          submittedByStaffId: staffIds.ids[claim.key],
          submittedAt: at(claim.date, 18),
          decidedByStaffId: staffIds.ownerId,
          decidedAt: at('2026-08-28', 10),
          paymentRoute: claim.route,
          payoutStatus: claim.route === 'FINANCE' ? 'PAID' : 'PENDING',
          ...(claim.route === 'FINANCE' ? { financeReference: 'SYNTH-REIMB-0001' } : {}),
        },
      });
    }
    summary.push('August: 2 decided leave requests (1 unpaid), 2 approved claims — one via payroll, one via Finance');
  });

  // -------------------------------------------------------------------------
  // SEPTEMBER — deliberately UNFINISHED. These are the owner's decisions.
  // -------------------------------------------------------------------------
  await scoped(client, tenantId, async (tx) => {
    const open: string[] = [];

    // Punches for the first half of the month, with three exceptions left open.
    for (const date of weekdays(2026, 9).filter((d) => d <= '2026-09-15')) {
      for (const person of PEOPLE) {
        const shift = await tx.providerShift.findFirst({
          where: { staffId: staffIds.ids[person.key], shiftDate: day(date) },
        });
        if (!shift) continue;
        const existing = await tx.attendanceRecord.findFirst({
          where: { staffId: staffIds.ids[person.key], workDate: day(date) },
        });
        if (existing) continue;

        const late = person.key === 'nurse' && date === '2026-09-08';
        const missing = person.key === 'reception' && date === '2026-09-09';
        const extra = person.key === 'night' && date === '2026-09-10';

        const clockInAt = new Date(shift.startsAt.getTime() + (late ? 24 : -2) * 60000);
        const clockOutAt = missing ? null : new Date(shift.endsAt.getTime() + (extra ? 70 : 3) * 60000);

        await tx.attendanceRecord.create({
          data: {
            tenantId,
            staffId: staffIds.ids[person.key],
            clinicId: staffIds.clinicId,
            workDate: day(date),
            clockInAt,
            clockOutAt,
            scheduledStart: shift.startsAt,
            scheduledEnd: shift.endsAt,
            status: missing ? 'MISSING_PUNCH' : late ? 'LATE' : 'PRESENT',
            lateMinutes: late ? 19 : 0,
            workedMinutes: clockOutAt ? Math.round((clockOutAt.getTime() - clockInAt.getTime()) / 60000) : null,
            // EXTRA TIME, RECORDED AND NOT APPROVED. The owner decides.
            overtimeMinutes: extra ? 60 : 0,
            overtimeApproved: false,
          },
        });
      }
    }
    open.push('1 late arrival, 1 missing punch, 1 unapproved extra hour');

    // A correction request nobody has decided.
    const missingRecord = await tx.attendanceRecord.findFirst({
      where: { staffId: staffIds.ids.reception, workDate: day('2026-09-09') },
    });
    if (missingRecord) {
      const existing = await tx.attendanceCorrectionRequest.findFirst({
        where: { attendanceRecordId: missingRecord.id },
      });
      if (!existing) {
        await tx.attendanceCorrectionRequest.create({
          data: {
            tenantId,
            attendanceRecordId: missingRecord.id,
            staffId: staffIds.ids.reception,
            requestedClockOutAt: missingRecord.scheduledEnd,
            reason: 'I forgot to clock out — the counter was busy at closing (synthetic).',
          },
        });
        open.push('1 attendance correction waiting');
      }
    }

    // Leave: one waiting, one already agreed for later this month.
    for (const row of [
      { key: 'dispensary' as const, type: 'ANNUAL' as const, from: '2026-09-24', to: '2026-09-26', status: 'PENDING' as const },
      { key: 'night' as const, type: 'ANNUAL' as const, from: '2026-09-18', to: '2026-09-18', status: 'APPROVED' as const },
    ]) {
      const existing = await tx.leaveRequest.findFirst({
        where: { staffId: staffIds.ids[row.key], startDate: day(row.from) },
      });
      if (existing) continue;
      await tx.leaveRequest.create({
        data: {
          tenantId,
          staffId: staffIds.ids[row.key],
          leaveType: row.type,
          startDate: day(row.from),
          endDate: day(row.to),
          status: row.status,
          reason: 'Synthetic UAT leave request.',
          ...(row.status === 'APPROVED' ? { approvedByStaffId: staffIds.ownerId } : {}),
        },
      });
    }
    open.push('1 leave request waiting, 1 approved for later this month');

    // A claim waiting for a decision — INCLUDING which route it is paid by.
    const pendingClaim = await tx.staffClaim.findFirst({
      where: { staffId: staffIds.ids.nurse, claimDate: day('2026-09-12') },
    });
    if (!pendingClaim) {
      await tx.staffClaim.create({
        data: {
          tenantId,
          clinicId: staffIds.clinicId,
          staffId: staffIds.ids.nurse,
          category: 'EQUIPMENT',
          amountClaimed: '96.00',
          claimDate: day('2026-09-12'),
          description: 'Replacement clinic shoes (synthetic).',
          status: 'SUBMITTED',
          submittedByStaffId: staffIds.ids.nurse,
          submittedAt: at('2026-09-12', 19),
        },
      });
      open.push('1 claim waiting, route not yet decided');
    }

    summary.push(`September left OPEN: ${open.join('; ')}`);
  });

  return summary;
}

async function main() {
  const { tenantId, tenantName } = await assertSafe();
  console.log(`HR UAT augmentation — ${tenantName}\n`);
  const summary = await augmentHrUat(prisma, tenantId);

  console.log('Added or confirmed:');
  for (const line of summary) console.log(`  ${line}`);
  console.log('');
  console.log('September is deliberately unfinished. Those decisions are the UAT.');
  console.log(`Sign in: ${PEOPLE.filter((p) => p.login).map((p) => `${p.key}@${DOMAIN}`).join(', ')}`);
  console.log(`Password: ${PASSWORD}`);
}

// Only when RUN, never when imported — a test importing `augmentHrUat` must not
// set a whole database going as a side effect of the import.
if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
