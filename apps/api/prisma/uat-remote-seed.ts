import { AppointmentStatus, PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// ═══════════════════════════════════════════════════════════════════════════
// REMOTE UAT SEED — the synthetic "Kuwick UAT Staging" tenant, and only it.
//
// This script exists to populate the LIVE Railway UAT database with enough
// synthetic clinical data to exercise the appointment product end to end:
// five doctors, four bookable services, a fortnight of roster in every shift
// state, 15–25 appointments in mixed statuses, and a live public page.
//
// It is written to be run ON PURPOSE, from the Railway API service's own
// shell, against that service's own DATABASE_URL. Because a database with
// real clinics in it is one wrong WHERE clause away from a disaster, the
// script is built around refusals:
//
//   1. It REFUSES to run at all unless ALLOW_REMOTE_UAT_SEED=true — so it
//      can never fire from a deploy hook, a migration, app startup, or an
//      absent-minded `npx tsx`.
//   2. It takes DATABASE_URL only from the environment it runs in — no
//      dotenv, no fallback, no flag to point it somewhere else. Where you
//      run it is what it seeds, and it prints that target (redacted) first.
//   3. It locates the tenant DYNAMICALLY by its exact display name,
//      "Kuwick UAT Staging (Synthetic)", and ABORTS on zero matches, on
//      more than one match, and on any match whose name does not carry
//      both "UAT" and "Synthetic". No UUID appears in this file.
//   4. Every write runs inside ONE transaction whose `app.tenant_id` GUC is
//      pinned to the matched tenant — under this schema's FORCE row-level
//      security that makes rows of any other tenant unreadable and
//      unwritable for the duration, so even a bug here cannot leak across.
//      (If the connecting role happens to bypass RLS, the script says so
//      and still scopes every single query by tenantId explicitly.)
//   5. It never DELETEs anything. Existing rows are matched by natural keys
//      (doctor name, service name, patient NRIC, identical shift, the
//      appointment marker below) and reused or updated, so re-running it
//      converges instead of multiplying data. The second run is a no-op.
//
// Appointments carry sourceDetail 'uat-remote-seed' as their idempotency
// marker; if any exist the whole appointment block is skipped.
//
//   ALLOW_REMOTE_UAT_SEED=true npx tsx prisma/uat-remote-seed.ts
// ═══════════════════════════════════════════════════════════════════════════

const EXPECTED_TENANT = 'Kuwick UAT Staging (Synthetic)';
const MARKER = 'uat-remote-seed';

// ── refusal 1: the explicit human intent flag ───────────────────────────────
if (process.env.ALLOW_REMOTE_UAT_SEED !== 'true') {
  console.error(
    'REFUSED: this script writes to a remote database and only runs when a\n' +
      'human states that intent explicitly:\n\n' +
      '  ALLOW_REMOTE_UAT_SEED=true npx tsx prisma/uat-remote-seed.ts\n',
  );
  process.exit(1);
}

// ── refusal 2: the target is the environment's own, and it is announced ─────
const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'REFUSED: DATABASE_URL is not set. This script deliberately loads no\n' +
      '.env file — it seeds exactly the database of the environment it is\n' +
      'run in (the Railway API service shell), nothing else.',
  );
  process.exit(1);
}
try {
  const parsed = new URL(url);
  console.log(
    `Target database: ${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname} (role: ${parsed.username || '?'})`,
  );
} catch {
  console.error('REFUSED: DATABASE_URL is not a parseable URL.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// ── clinic wall-clock helpers ───────────────────────────────────────────────
// Everything is laid out relative to TODAY in the clinic's timezone. The
// script asserts the clinic really is Asia/Kuala_Lumpur (fixed UTC+8, no
// DST) before using this arithmetic, and aborts rather than seed a roster
// whose hours would be wrong.
const KL_OFFSET_MS = 8 * 3600_000;
const todayKL = () => new Date(Date.now() + KL_OFFSET_MS).toISOString().slice(0, 10);
const addDays = (ymd: string, days: number) =>
  new Date(new Date(`${ymd}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const kl = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00.000+08:00`);
const wall = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const dow = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0=Sun

type Tx = Prisma.TransactionClient;

// Statuses that do NOT occupy a slot per the appointments_no_overlap
// exclusion constraint; everything else does, COMPLETED and REQUESTED
// included.
const NON_OCCUPYING: AppointmentStatus[] = ['CANCELLED', 'RESCHEDULED', 'NO_SHOW', 'WAITLIST'];

async function main() {
  // ── discovery: find the synthetic tenant, and only look ──────────────────
  // The tenants table's RLS policy opens for reads under the same
  // bypass GUC the login path uses (transaction-local, read-only here).
  const discovery = await prisma.$transaction(async (tx: Tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const matches = await tx.tenant.findMany({
      where: { name: EXPECTED_TENANT },
      select: { id: true, name: true },
    });
    const totalTenants = await tx.tenant.count();
    return { matches, totalTenants };
  });

  if (discovery.matches.length === 0) {
    throw new Error(
      `ABORT: no tenant named exactly "${EXPECTED_TENANT}" exists here ` +
        `(${discovery.totalTenants} tenant(s) present). Nothing was written.`,
    );
  }
  if (discovery.matches.length > 1) {
    throw new Error(
      `ABORT: ${discovery.matches.length} tenants share the name "${EXPECTED_TENANT}" — ` +
        'ambiguous target. Nothing was written.',
    );
  }
  const tenant = discovery.matches[0];
  if (!/synthetic/i.test(tenant.name) || !/uat/i.test(tenant.name)) {
    throw new Error(
      `ABORT: matched tenant "${tenant.name}" does not clearly identify as ` +
        'synthetic UAT. Nothing was written.',
    );
  }
  console.log(
    `Matched synthetic tenant "${tenant.name}" — 1 of ${discovery.totalTenants} tenant(s) in this database; the other ${discovery.totalTenants - 1} will be untouchable for the whole run.`,
  );

  const TENANT = tenant.id;
  const anchor = todayKL();
  const day = (offset: number) => addDays(anchor, offset);
  console.log(`Clinic wall-clock anchor (today, UTC+8): ${anchor}`);

  // ── every write, one tenant-pinned transaction ───────────────────────────
  const report = await prisma.$transaction(
    async (tx: Tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT}, true)`;

      // With the GUC pinned and NO bypass, FORCE RLS confines this whole
      // transaction to the synthetic tenant. Prove which regime applies:
      // an RLS-confined connection can see exactly one row of `tenants`.
      const visibleTenants = await tx.tenant.count();
      if (visibleTenants === 1) {
        console.log('RLS confinement: ACTIVE — other tenants are physically out of reach.');
      } else {
        console.log(
          `RLS confinement: NOT active for this role (${visibleTenants} tenants visible) — ` +
            'relying on the explicit tenantId scoping every query below carries.',
        );
      }
      const self = await tx.tenant.findFirst({ where: { id: TENANT } });
      if (!self || self.name !== EXPECTED_TENANT) {
        throw new Error('ABORT: tenant re-verification inside the write transaction failed.');
      }

      const clinics = await tx.clinic.findMany({ where: { tenantId: TENANT } });
      if (clinics.length !== 1) {
        throw new Error(
          `ABORT: the synthetic tenant has ${clinics.length} clinics — this script ` +
            'expects exactly one and will not guess. Nothing was written.',
        );
      }
      const clinic = clinics[0];
      if (clinic.timezone !== 'Asia/Kuala_Lumpur') {
        throw new Error(
          `ABORT: clinic timezone is "${clinic.timezone}", not Asia/Kuala_Lumpur — ` +
            'the roster arithmetic below would be wrong. Nothing was written.',
        );
      }
      const CLINIC = clinic.id;
      console.log(`Clinic: "${clinic.name}" (timezone ${clinic.timezone})`);

      const countAll = async () => ({
        doctors: await tx.staff.count({ where: { tenantId: TENANT, role: 'DOCTOR_RESIDENT' } }),
        services: await tx.serviceCatalog.count({ where: { tenantId: TENANT } }),
        bookableServices: await tx.serviceCatalog.count({
          where: { tenantId: TENANT, bookable: true, active: true },
        }),
        weeklyPatternRows: await tx.doctorSchedule.count({ where: { tenantId: TENANT } }),
        shifts: await tx.providerShift.count({ where: { tenantId: TENANT } }),
        patients: await tx.patient.count({ where: { tenantId: TENANT } }),
        appointments: await tx.appointment.count({ where: { tenantId: TENANT } }),
        seededAppointments: await tx.appointment.count({
          where: { tenantId: TENANT, sourceDetail: MARKER },
        }),
        bookingPageActive: await tx.clinicBookingPage.count({
          where: { tenantId: TENANT, clinicId: CLINIC, active: true },
        }),
      });
      const before = await countAll();

      // ── doctors: matched by name, updated in place, never duplicated ─────
      const upsertDoctor = async (
        fullName: string,
        mode: 'FIXED_WEEKLY' | 'ROSTER_LINKED',
        color: string,
      ) => {
        const existing = await tx.staff.findFirst({ where: { tenantId: TENANT, fullName } });
        if (existing) {
          await tx.staff.update({
            where: { id: existing.id },
            data: { appointmentScheduleMode: mode, calendarColor: color, clinicId: CLINIC, active: true },
          });
          return existing;
        }
        return tx.staff.create({
          data: {
            tenantId: TENANT,
            role: 'DOCTOR_RESIDENT',
            fullName,
            clinicId: CLINIC,
            appointmentScheduleMode: mode,
            calendarColor: color,
          },
        });
      };
      const aisyah = await upsertDoctor('Dr. Nurul Aisyah binti Hamid', 'ROSTER_LINKED', '#4f9d69');
      const farid = await upsertDoctor('Dr. Farid Iskandar bin Zulkifli', 'FIXED_WEEKLY', '#5b7db1');
      const chong = await upsertDoctor('Dr. Chong Wei Ling', 'FIXED_WEEKLY', '#b1665b');
      const alexandria = await upsertDoctor(
        'Dr. Alexandria Wong Mei Xuan-Constantinopoulos',
        'FIXED_WEEKLY',
        '#5bb1a4',
      );
      const priya = await upsertDoctor('Dr. Priyadarshini a/p Raghavan', 'ROSTER_LINKED', '#8a5bb1');

      // ── services: matched by name, updated in place ──────────────────────
      const upsertService = async (name: string, data: Record<string, unknown>) => {
        const existing = await tx.serviceCatalog.findFirst({ where: { tenantId: TENANT, name } });
        if (existing) {
          await tx.serviceCatalog.update({ where: { id: existing.id }, data });
          return existing;
        }
        return tx.serviceCatalog.create({ data: { tenantId: TENANT, name, ...data } as never });
      };
      const consult = await upsertService('GP Consultation', {
        durationMinutesDefault: 15,
        bookable: true,
        active: true,
        price: 45,
        priceDisplay: 'EXACT',
        bookingPaymentRule: 'NONE',
        bookingDescription: 'Konsultasi doktor umum — general practitioner consultation.',
        bookingSlug: 'gp-consultation',
        category: 'Consultation',
      });
      const scaling = await upsertService('Dental Scaling & Polishing', {
        durationMinutesDefault: 30,
        bookable: true,
        active: true,
        price: 120,
        priceDisplay: 'FROM',
        bookingFee: 50,
        bookingPaymentRule: 'DEPOSIT',
        depositAmount: 50,
        bookingDescription: 'Cuci gigi & gilap. Deposit RM50 diperlukan untuk tempahan.',
        preInstructions: 'Sila tiba 10 minit awal. Please arrive 10 minutes early.',
        bookingSlug: 'dental-scaling',
        category: 'Dental',
      });
      const screening = await upsertService('Executive Health Screening', {
        durationMinutesDefault: 60,
        bookable: true,
        active: true,
        price: 388,
        priceDisplay: 'HIDDEN',
        requiresApproval: true,
        bookingDescription: 'Pemeriksaan kesihatan menyeluruh. The clinic confirms every request.',
        preInstructions: 'Berpuasa 8 jam sebelum temujanji. Fast for 8 hours beforehand.',
        postInstructions: 'Keputusan dalam 3 hari bekerja — results within 3 working days.',
        bookingSlug: 'health-screening',
        category: 'Screening',
      });
      const review = await upsertService('Density Follow-up Review', {
        durationMinutesDefault: 30,
        bookable: true,
        active: true,
        price: 60,
        priceDisplay: 'EXACT',
        bookingPaymentRule: 'NONE',
        bookingDescription: 'Semakan susulan — follow-up review appointment.',
        bookingSlug: 'density-follow-up-review',
        category: 'Consultation',
      });
      await upsertService('Ultrasound (retired)', {
        durationMinutesDefault: 30,
        bookable: true,
        active: false,
        price: 150,
        category: 'Imaging',
      });

      // Who performs what. Consultation and the follow-up review are broad;
      // dental and screening are the narrow examples the brief asks for.
      const performs: [string, string][] = [];
      for (const doc of [aisyah, farid, chong, alexandria, priya]) performs.push([doc.id, consult.id]);
      for (const doc of [aisyah, farid, priya]) performs.push([doc.id, review.id]);
      for (const doc of [chong, alexandria]) performs.push([doc.id, scaling.id]);
      for (const doc of [aisyah, farid]) performs.push([doc.id, screening.id]);
      for (const [staffId, serviceId] of performs) {
        await tx.doctorServiceQualification.upsert({
          where: { tenantId_staffId_serviceId: { tenantId: TENANT, staffId, serviceId } },
          update: {},
          create: { tenantId: TENANT, staffId, serviceId },
        });
      }

      // ── weekly patterns for the FIXED_WEEKLY doctors ─────────────────────
      // Created only for a doctor who has NONE (a tester's edits are theirs
      // to keep, and this script deletes nothing — so it cannot "reset" a
      // pattern, only supply a missing one).
      const weeklyPlan: Record<string, [number, string, string][]> = {
        [farid.id]: [
          // split shift — morning and late afternoon, lunch closed, Mon–Fri
          ...[1, 2, 3, 4, 5].flatMap((d): [number, string, string][] => [
            [d, '09:00', '13:00'],
            [d, '14:30', '18:00'],
          ]),
          [6, '09:00', '12:30'],
        ],
        [chong.id]: [1, 3, 5].map((d): [number, string, string] => [d, '10:00', '20:00']),
        [alexandria.id]: [2, 4].map((d): [number, string, string] => [d, '08:30', '12:30']),
      };
      let weeklyCreated = 0;
      for (const [staffId, rows] of Object.entries(weeklyPlan)) {
        const has = await tx.doctorSchedule.count({ where: { tenantId: TENANT, staffId } });
        if (has > 0) continue;
        for (const [dayOfWeek, start, end] of rows) {
          await tx.doctorSchedule.create({
            data: {
              tenantId: TENANT,
              clinicId: CLINIC,
              staffId,
              dayOfWeek,
              startTime: wall(start),
              endTime: wall(end),
              effectiveFrom: new Date(`${day(-60)}T00:00:00Z`),
            },
          });
          weeklyCreated += 1;
        }
      }

      // ── roster shifts around the current period ──────────────────────────
      // Aisyah (roster-linked): mornings through the fortnight, one evening,
      // ONE overnight, an OFF day and approved LEAVE. Priya: weekend LOCUM
      // cover and a BLOCKED morning. Each planned row is created only if no
      // identical row exists AND nothing already overlaps that doctor's
      // span — an existing hand-made roster is reused, not fought.
      type PlannedShift = {
        staffId: string;
        date: string;
        start: string;
        endDate: string;
        end: string;
        type: 'WORKING' | 'OFF' | 'LEAVE' | 'BLOCKED' | 'LOCUM';
        note?: string;
      };
      const plannedShifts: PlannedShift[] = [];
      for (let offset = -2; offset <= 12; offset += 1) {
        if (offset === 4 || offset === 5) continue; // OFF / LEAVE below
        plannedShifts.push({ staffId: aisyah.id, date: day(offset), start: '08:00', endDate: day(offset), end: '13:00', type: 'WORKING' });
      }
      plannedShifts.push(
        { staffId: aisyah.id, date: day(1), start: '14:00', endDate: day(1), end: '19:00', type: 'WORKING' },
        { staffId: aisyah.id, date: day(2), start: '22:00', endDate: day(3), end: '06:00', type: 'WORKING', note: 'Night cover' },
        { staffId: aisyah.id, date: day(4), start: '09:00', endDate: day(4), end: '17:00', type: 'OFF' },
        { staffId: aisyah.id, date: day(5), start: '09:00', endDate: day(5), end: '17:00', type: 'LEAVE', note: 'Annual leave (approved)' },
      );
      // Priya's BLOCKED band goes on a weekday so it can never share a span
      // with her weekend LOCUM cover (same doctor, and the overlap guard
      // below would silently drop whichever came second).
      const blockedDay = (() => {
        for (let offset = 2; offset <= 8; offset += 1) {
          const d = dow(day(offset));
          if (d >= 1 && d <= 5) return day(offset);
        }
        return day(2); // unreachable: seven consecutive days hold a weekday
      })();
      plannedShifts.push({ staffId: priya.id, date: blockedDay, start: '09:00', endDate: blockedDay, end: '13:00', type: 'BLOCKED', note: 'CME morning' });
      for (let offset = 0; offset <= 9; offset += 1) {
        const d = dow(day(offset));
        if (d === 6) plannedShifts.push({ staffId: priya.id, date: day(offset), start: '09:00', endDate: day(offset), end: '17:00', type: 'LOCUM', note: 'Weekend locum' });
        if (d === 0) plannedShifts.push({ staffId: priya.id, date: day(offset), start: '09:00', endDate: day(offset), end: '13:00', type: 'LOCUM', note: 'Weekend locum' });
      }
      let shiftsCreated = 0;
      let shiftsReused = 0;
      for (const plan of plannedShifts) {
        const startsAt = kl(plan.date, plan.start);
        const endsAt = kl(plan.endDate, plan.end);
        const clash = await tx.providerShift.findFirst({
          where: {
            tenantId: TENANT,
            staffId: plan.staffId,
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
          },
        });
        if (clash) {
          shiftsReused += 1; // identical or hand-made — either way, keep it
          continue;
        }
        await tx.providerShift.create({
          data: {
            tenantId: TENANT,
            clinicId: CLINIC,
            staffId: plan.staffId,
            shiftDate: new Date(`${plan.date}T00:00:00Z`),
            startsAt,
            endsAt,
            shiftType: plan.type,
            note: plan.note,
          },
        });
        shiftsCreated += 1;
      }

      // ── synthetic patients, matched by their reserved-format NRIC ────────
      const PATIENT_NAMES = [
        'Siti Aminah binti Yusof', 'Tan Mei Chen', 'Muhammad Danish bin Abdullah',
        'Kavitha a/p Suppiah', 'Lee Jia Hui', 'Nurul Izzah binti Rahman',
        'Rajesh a/l Kumar', 'Wong Kar Mun', 'Ahmad Firdaus bin Ismail',
        'Chen Xiao Ling', 'Fatimah binti Omar', 'Suresh a/l Maniam',
        'Lim Boon Keng', 'Aisha binti Zainuddin', 'Darren Loh Wei Jian',
        'Meera a/p Sivakumar', 'Hakim bin Jamaludin', 'Grace Tan Li Ying',
      ];
      const patients: { id: string }[] = [];
      for (let i = 0; i < PATIENT_NAMES.length; i += 1) {
        const identifier = `9002${String(10 + i)}08${String(6000 + i)}`;
        const found = await tx.patient.findFirst({
          where: { tenantId: TENANT, identifierValue: identifier },
        });
        patients.push(
          found ??
            (await tx.patient.create({
              data: {
                tenantId: TENANT,
                identifierType: 'NRIC',
                identifierValue: identifier,
                name: PATIENT_NAMES[i],
                phone: `01${String(34567810 + i * 7)}`,
              },
            })),
        );
      }

      // ── the appointments, guarded by their marker ────────────────────────
      let appointmentsCreated = 0;
      let appointmentsSkippedOverlap = 0;
      if (before.seededAppointments > 0) {
        console.log(
          `Appointments: ${before.seededAppointments} rows already carry sourceDetail "${MARKER}" — block skipped (idempotent re-run).`,
        );
      } else {
        let seq = 0;
        const book = async (
          date: string,
          staffId: string,
          serviceId: string,
          start: string,
          minutes: number,
          status: string,
          extra: Record<string, unknown> = {},
        ) => {
          const patient = patients[seq % patients.length];
          seq += 1;
          const scheduledStart = kl(date, start);
          const scheduledEnd = new Date(scheduledStart.getTime() + minutes * 60_000);
          // The DB's no-overlap exclusion treats everything outside
          // CANCELLED/RESCHEDULED/NO_SHOW/WAITLIST as occupying; anything a
          // tester already booked in this span wins and the row is skipped.
          if (!['CANCELLED', 'NO_SHOW'].includes(status)) {
            const clash = await tx.appointment.count({
              where: {
                tenantId: TENANT,
                staffId,
                status: { notIn: NON_OCCUPYING },
                scheduledStart: { lt: scheduledEnd },
                scheduledEnd: { gt: scheduledStart },
              },
            });
            if (clash > 0) {
              appointmentsSkippedOverlap += 1;
              return;
            }
          }
          await tx.appointment.create({
            data: {
              tenantId: TENANT,
              clinicId: CLINIC,
              patientId: patient.id,
              staffId,
              serviceId,
              source: seq % 3 === 0 ? 'ONLINE_PORTAL' : 'FRONT_DESK',
              sourceDetail: MARKER,
              status: status as never,
              scheduledStart,
              scheduledEnd,
              manageToken: `ur${String(seq).padStart(3, '0')}${'z'.repeat(38)}`,
              ...extra,
            } as never,
          });
          appointmentsCreated += 1;
        };
        const cancelled = {
          cancellationReason: 'PATIENT_REQUEST',
          cancelReason: 'Patient called to cancel',
          cancelledAt: new Date(),
        };

        // The recent past: work that HAPPENED (and one that didn't).
        await book(day(-2), aisyah.id, consult.id, '08:30', 15, 'COMPLETED');
        await book(day(-2), aisyah.id, consult.id, '09:00', 15, 'COMPLETED');
        await book(day(-1), aisyah.id, consult.id, '08:30', 15, 'COMPLETED');
        await book(day(-1), aisyah.id, consult.id, '10:00', 15, 'NO_SHOW');
        await book(day(-1), aisyah.id, consult.id, '11:00', 15, 'CANCELLED', cancelled);
        // Today: done, here, and still to come.
        await book(day(0), aisyah.id, consult.id, '08:15', 15, 'COMPLETED');
        await book(day(0), aisyah.id, consult.id, '09:30', 15, 'ARRIVED');
        await book(day(0), aisyah.id, consult.id, '11:30', 15, 'CONFIRMED');
        // The days ahead — inside the roster laid down above.
        await book(day(1), aisyah.id, consult.id, '08:30', 15, 'CONFIRMED');
        await book(day(1), aisyah.id, screening.id, '10:00', 60, 'REQUESTED', {
          patientNote: 'First screening — fasting since midnight',
        });
        await book(day(1), aisyah.id, consult.id, '14:30', 15, 'CONFIRMED');
        await book(day(2), aisyah.id, consult.id, '09:00', 15, 'CONFIRMED');
        await book(day(2), aisyah.id, consult.id, '23:00', 15, 'CONFIRMED', {
          notes: 'Night cover — fever, called ahead',
        });
        await book(day(3), aisyah.id, review.id, '08:30', 30, 'CONFIRMED');
        await book(day(6), aisyah.id, consult.id, '09:30', 15, 'CONFIRMED');
        await book(day(7), aisyah.id, review.id, '08:45', 30, 'CONFIRMED');
        await book(day(8), aisyah.id, screening.id, '10:30', 60, 'CONFIRMED');
        await book(day(9), aisyah.id, consult.id, '09:15', 15, 'CONFIRMED');

        // Weekday-shaped extras, each on the first day ahead that fits the
        // doctor's own pattern (so every booking sits inside real hours
        // whatever today's weekday is).
        const firstAhead = (fits: (d: number) => boolean) => {
          for (let offset = 1; offset <= 9; offset += 1) {
            if (fits(dow(day(offset)))) return day(offset);
          }
          return null;
        };
        const chongDay = firstAhead((d) => d === 1 || d === 3 || d === 5);
        if (chongDay) {
          await book(chongDay, chong.id, scaling.id, '14:00', 30, 'CONFIRMED', {
            bookingFeeAmount: 50,
            bookingFeePaidAt: new Date(),
            paymentStatus: 'PAID',
          });
          await book(chongDay, chong.id, scaling.id, '15:00', 30, 'CONFIRMED', {
            bookingFeeAmount: 50,
            paymentStatus: 'PENDING',
          });
        }
        const alexandriaDay = firstAhead((d) => d === 2 || d === 4);
        if (alexandriaDay) {
          await book(alexandriaDay, alexandria.id, scaling.id, '09:00', 30, 'CONFIRMED', {
            bookingFeeAmount: 50,
            bookingFeePaidAt: new Date(),
            paymentStatus: 'PAID',
          });
        }
        const faridDay = firstAhead((d) => d >= 1 && d <= 5);
        if (faridDay) {
          await book(faridDay, farid.id, consult.id, '09:30', 15, 'CONFIRMED');
          await book(faridDay, farid.id, consult.id, '15:30', 15, 'CONFIRMED');
        }
        const locumDay = firstAhead((d) => d === 6 || d === 0);
        if (locumDay) {
          await book(locumDay, priya.id, consult.id, '10:00', 15, 'CONFIRMED');
        }
      }

      // ── the public page: live, branded, policies on ──────────────────────
      // Update-in-place keeps whatever slug the page already answers on
      // (links in the wild must not break); only a page that does not exist
      // yet gets the default slug.
      const brand = {
        displayName: 'Klinik Hijraa Bangi',
        introText:
          'Selamat datang ke Klinik Hijraa Bangi. Tempah temujanji anda di bawah — welcome, book your appointment below.',
        confirmationMessage:
          'Sila tiba 10 minit lebih awal dan bawa kad pengenalan. Please arrive 10 minutes early and bring your IC.',
        active: true,
        allowPatientReschedule: true,
        allowPatientCancel: true,
        patientChangeCutoffHours: 4,
      };
      const page = await tx.clinicBookingPage.findFirst({
        where: { tenantId: TENANT, clinicId: CLINIC },
      });
      let pageSlug: string;
      if (page) {
        await tx.clinicBookingPage.update({ where: { id: page.id }, data: brand });
        pageSlug = page.slug;
      } else {
        const created = await tx.clinicBookingPage.create({
          data: {
            tenantId: TENANT,
            clinicId: CLINIC,
            slug: 'uat-clinic',
            language: 'en',
            requirePhone: true,
            requireEmail: false,
            requireNric: false,
            showReasonField: true,
            ...brand,
          },
        });
        pageSlug = created.slug;
      }

      const after = await countAll();
      return {
        before,
        after,
        weeklyCreated,
        shiftsCreated,
        shiftsReused,
        appointmentsCreated,
        appointmentsSkippedOverlap,
        pageSlug,
      };
    },
    { timeout: 300_000, maxWait: 30_000 },
  );

  console.log('\n── uat-remote-seed result ──');
  console.log('counts before:', JSON.stringify(report.before));
  console.log('counts after: ', JSON.stringify(report.after));
  console.log(
    `created: ${report.weeklyCreated} weekly pattern rows, ${report.shiftsCreated} shifts ` +
      `(${report.shiftsReused} existing spans reused), ${report.appointmentsCreated} appointments ` +
      `(${report.appointmentsSkippedOverlap} skipped for existing bookings in the same span).`,
  );
  console.log(`public booking page: /book/${report.pageSlug} — live.`);
  console.log('deleted: nothing (this script contains no delete).');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
