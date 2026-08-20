import { AppointmentStatus, PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// ═══════════════════════════════════════════════════════════════════════════
// REMOTE UAT SEED — the synthetic "Kuwick UAT Staging" tenant, and only it.
//
// Populates a LIVE UAT database with enough synthetic clinical data to
// exercise the appointment product end to end: five doctors, four bookable
// services, a fortnight of roster in every shift state, ~24 appointments in
// mixed statuses, and a live public booking page.
//
// It is meant to be run ON PURPOSE, from the Railway API service's own shell,
// against that service's own DATABASE_URL. Because a database holding real
// clinics is one wrong WHERE clause from a disaster, this script is built out
// of refusals, and it refuses BEFORE it writes, never after:
//
//   TWO KEYS.  ALLOW_REMOTE_UAT_SEED=true alone performs a DRY RUN: the real
//     mutation transaction runs in full and is then deliberately rolled back,
//     so what you read in the plan is what the write would do — same code
//     path, not a simulation of one. Committing additionally requires
//     UAT_SEED_WRITE=true. The write key alone is refused.
//
//   FAIL CLOSED ON PRIVILEGE.  If the connected role is SUPERUSER or carries
//     BYPASSRLS — directly or through any role it is a member of — the script
//     ABORTS before touching an application table. On a remote database,
//     PostgreSQL row-level security must be an ENFORCED boundary; being
//     careful to write `where: { tenantId }` in application code is not the
//     same guarantee, and this script will not pretend it is.
//
//   PROVEN CONFINEMENT.  Every write runs inside ONE transaction whose
//     `app.tenant_id` GUC is pinned to the matched tenant. All ten tables it
//     touches are verified to carry ENABLE + FORCE row-level security first,
//     and the pinned transaction re-counts the tenants it can see: under
//     confinement that number is 1, whatever the database actually holds.
//
//   ONE EXACT TENANT.  Located dynamically by exact name — aborting on zero
//     matches, on more than one, on a name not carrying both "UAT" and
//     "Synthetic", on anything other than exactly one clinic, and on a clinic
//     timezone that is not Asia/Kuala_Lumpur. No UUID appears in this file.
//
//   NOTHING IS DESTROYED.  There is no delete, truncate or cleanup anywhere
//     in this file. Rows are matched by natural key (doctor name, service
//     name, patient NRIC, an identical shift span, the appointment marker)
//     and reused; an UPDATE is issued only for fields whose values genuinely
//     differ, so a second write run is a true no-op rather than a churn of
//     identical writes.
//
//   DRY RUN:  ALLOW_REMOTE_UAT_SEED=true npx tsx prisma/uat-remote-seed.ts
//   WRITE:    ALLOW_REMOTE_UAT_SEED=true UAT_SEED_WRITE=true \
//               npx tsx prisma/uat-remote-seed.ts
// ═══════════════════════════════════════════════════════════════════════════

const EXPECTED_TENANT = 'Kuwick UAT Staging (Synthetic)';
const EXPECTED_TIMEZONE = 'Asia/Kuala_Lumpur';
const MARKER = 'uat-remote-seed';
const DEFAULT_SLUG = 'uat-clinic';

/** Every table this script writes to. All must enforce RLS for the run. */
const WRITE_TABLES = [
  'tenants',
  'clinics',
  'staff',
  'service_catalog',
  'doctor_service_qualifications',
  'doctor_schedules',
  'provider_shifts',
  'patients',
  'appointments',
  'clinic_booking_pages',
] as const;

// ── the two keys ────────────────────────────────────────────────────────────
const ALLOW = process.env.ALLOW_REMOTE_UAT_SEED === 'true';
const WRITE = process.env.UAT_SEED_WRITE === 'true';

if (!ALLOW) {
  console.error(
    (WRITE
      ? 'REFUSED: UAT_SEED_WRITE=true was supplied without ALLOW_REMOTE_UAT_SEED=true.\n' +
        'The write key alone is never enough — both keys are required to commit.\n\n'
      : 'REFUSED: this script touches a remote database and only runs when a\n' +
        'human states that intent explicitly.\n\n') +
      '  DRY RUN (writes nothing):\n' +
      '    ALLOW_REMOTE_UAT_SEED=true npx tsx prisma/uat-remote-seed.ts\n\n' +
      '  REAL WRITE (both keys):\n' +
      '    ALLOW_REMOTE_UAT_SEED=true UAT_SEED_WRITE=true npx tsx prisma/uat-remote-seed.ts\n',
  );
  process.exit(1);
}

// ── the target is the environment's own, and it is announced ────────────────
const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'REFUSED: DATABASE_URL is not set. This script deliberately loads no .env\n' +
      'file — it works on exactly the database of the environment it is run in\n' +
      '(the Railway API service shell), and nowhere else.',
  );
  process.exit(1);
}
let target: { host: string; database: string; user: string };
try {
  const parsed = new URL(url);
  target = {
    host: `${parsed.hostname}:${parsed.port || '5432'}`,
    database: parsed.pathname.replace(/^\//, ''),
    user: parsed.username || '(from environment)',
  };
} catch {
  console.error('REFUSED: DATABASE_URL is not a parseable URL.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

// ── clinic wall-clock helpers ───────────────────────────────────────────────
// Everything is laid out relative to TODAY in the clinic's timezone. The
// clinic is asserted to be Asia/Kuala_Lumpur (fixed UTC+8, no DST) before any
// of this arithmetic is trusted.
const KL_OFFSET_MS = 8 * 3600_000;
const todayKL = () => new Date(Date.now() + KL_OFFSET_MS).toISOString().slice(0, 10);
const addDays = (ymd: string, days: number) =>
  new Date(new Date(`${ymd}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const kl = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00.000+08:00`);
const wall = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const dow = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0=Sun

type Tx = Prisma.TransactionClient;

/** Statuses that do NOT occupy a slot per `appointments_no_overlap`. */
const NON_OCCUPYING: AppointmentStatus[] = ['CANCELLED', 'RESCHEDULED', 'NO_SHOW', 'WAITLIST'];

/** Thrown to roll a completed dry-run transaction back. Never an error. */
class Rollback extends Error {
  constructor(readonly why: string) {
    super(why);
  }
}

/**
 * Which of `desired`'s fields the stored row does not already agree with.
 * An UPDATE that writes the values already present is not idempotence, it is
 * noise in `updated_at` and in every audit trail downstream — so a row is
 * only written when this returns something.
 */
function changedFields(current: Record<string, unknown>, desired: Record<string, unknown>): string[] {
  const changed: string[] = [];
  for (const [key, want] of Object.entries(desired)) {
    const have = current[key];
    if (have instanceof Prisma.Decimal) {
      if (!have.equals(new Prisma.Decimal(want as Prisma.Decimal.Value))) changed.push(key);
      continue;
    }
    if (have instanceof Date && want instanceof Date) {
      if (have.getTime() !== want.getTime()) changed.push(key);
      continue;
    }
    if (have !== want) changed.push(key);
  }
  return changed;
}

type Plan = {
  doctors: { created: number; updated: number; unchanged: number };
  services: { created: number; updated: number; unchanged: number };
  qualifications: { created: number; existing: number };
  weeklyPatterns: { created: number; skippedExisting: number };
  shifts: { created: number; skippedOverlap: number };
  patients: { created: number; existing: number };
  appointments: { created: number; skippedMarker: number; skippedOverlap: number };
  bookingPage: 'created' | 'updated' | 'unchanged';
  pageSlug: string;
};

type Counts = Record<string, number>;

async function main() {
  const mode = WRITE ? 'WRITE' : 'DRY RUN';
  if (WRITE) {
    console.log('');
    console.log('███████████████████████████████████████████████████████████████');
    console.log('██                                                           ██');
    console.log('██              REMOTE UAT SEED — WRITE MODE                 ██');
    console.log('██   both keys present; this run COMMITS if every check      ██');
    console.log('██   below passes. Any failed invariant aborts first.        ██');
    console.log('██                                                           ██');
    console.log('███████████████████████████████████████████████████████████████');
    console.log('');
  } else {
    console.log('\n── REMOTE UAT SEED — DRY RUN (no second key; nothing will be committed) ──\n');
  }

  // ── 1. PRIVILEGE PROBE, before any application table is read or written ──
  // `pg_has_role(..., 'USAGE')` catches privilege reached THROUGH a granted
  // role, not just flags on the login role itself.
  const [privilege] = await prisma.$queryRaw<
    {
      role: string;
      database: string;
      own_super: boolean;
      own_bypass: boolean;
      effective_super: boolean;
      effective_bypass: boolean;
    }[]
  >`
    SELECT current_user::text                                   AS role,
           current_database()::text                             AS database,
           COALESCE(bool_or(r.rolsuper)      FILTER (WHERE r.rolname = current_user), false) AS own_super,
           COALESCE(bool_or(r.rolbypassrls)  FILTER (WHERE r.rolname = current_user), false) AS own_bypass,
           COALESCE(bool_or(r.rolsuper), false)                 AS effective_super,
           COALESCE(bool_or(r.rolbypassrls), false)             AS effective_bypass
      FROM pg_roles r
     WHERE pg_has_role(current_user, r.oid, 'USAGE')
  `;

  console.log('── target ──');
  console.log(`  host/database      : ${target.host}/${target.database}`);
  console.log(`  connection user    : ${target.user}`);
  console.log(`  current_user       : ${privilege.role}`);
  console.log(`  current_database   : ${privilege.database}`);
  console.log(`  rolsuper           : ${privilege.own_super}${privilege.effective_super && !privilege.own_super ? ' (but reachable through a granted role: true)' : ''}`);
  console.log(`  rolbypassrls       : ${privilege.own_bypass}${privilege.effective_bypass && !privilege.own_bypass ? ' (but reachable through a granted role: true)' : ''}`);

  if (privilege.effective_super || privilege.effective_bypass) {
    throw new Error(
      `ABORT: the connected role "${privilege.role}" is ` +
        `${privilege.effective_super ? 'a SUPERUSER' : ''}` +
        `${privilege.effective_super && privilege.effective_bypass ? ' and ' : ''}` +
        `${privilege.effective_bypass ? 'able to BYPASS row-level security' : ''}` +
        '.\nRow-level security would not confine this run, so tenant isolation would\n' +
        'rest on application-level query filtering alone. For a remote database\n' +
        'that is not a boundary. Re-run as the non-privileged application role\n' +
        '(NOSUPERUSER NOBYPASSRLS). Nothing was read or written.',
    );
  }

  // ── 2. RLS must actually be armed on every table this run touches ────────
  const tableList = WRITE_TABLES.map((t) => `'${t}'`).join(', ');
  const rlsRows = await prisma.$queryRawUnsafe<
    { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
  >(
    `SELECT relname::text, relrowsecurity, relforcerowsecurity
       FROM pg_class
      WHERE relkind = 'r' AND relname IN (${tableList})`,
  );
  const unarmed = WRITE_TABLES.filter((name) => {
    const row = rlsRows.find((r) => r.relname === name);
    return !row || !row.relrowsecurity || !row.relforcerowsecurity;
  });
  if (unarmed.length > 0) {
    throw new Error(
      `ABORT: row-level security is not fully armed on: ${unarmed.join(', ')}.\n` +
        'Every table this seed writes must carry ENABLE + FORCE row level security\n' +
        'for tenant confinement to be enforceable. Nothing was written.',
    );
  }
  console.log(`  RLS on write path  : ENABLE + FORCE on all ${WRITE_TABLES.length} tables ✓`);

  // ── 3. DISCOVERY — read-only, and rolled back for good measure ───────────
  // The tenants table's policy opens for reads under the same bypass GUC the
  // login path uses; it is the only place this script sets it, it is set
  // transaction-locally, and this transaction is thrown away rather than
  // committed so it cannot possibly leave a write behind.
  let discovery: {
    matches: { id: string; name: string }[];
    totalTenants: number;
  } | null = null;
  try {
    await prisma.$transaction(async (tx: Tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      discovery = {
        matches: await tx.tenant.findMany({
          where: { name: EXPECTED_TENANT },
          select: { id: true, name: true },
        }),
        totalTenants: await tx.tenant.count(),
      };
      throw new Rollback('discovery is read-only');
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  if (!discovery) throw new Error('ABORT: tenant discovery produced no answer.');
  const found = discovery as { matches: { id: string; name: string }[]; totalTenants: number };

  if (found.matches.length === 0) {
    throw new Error(
      `ABORT: no tenant named exactly "${EXPECTED_TENANT}" exists in this database ` +
        `(${found.totalTenants} tenant(s) present). Nothing was written.`,
    );
  }
  if (found.matches.length > 1) {
    throw new Error(
      `ABORT: ${found.matches.length} tenants share the name "${EXPECTED_TENANT}" — ` +
        'the target is ambiguous. Nothing was written.',
    );
  }
  const tenant = found.matches[0];
  if (!/synthetic/i.test(tenant.name) || !/uat/i.test(tenant.name)) {
    throw new Error(
      `ABORT: matched tenant "${tenant.name}" does not clearly identify as synthetic UAT. ` +
        'Nothing was written.',
    );
  }
  const TENANT = tenant.id;
  const anchor = todayKL();
  const day = (offset: number) => addDays(anchor, offset);

  // ── 4. THE ONE WRITE TRANSACTION (committed only in WRITE mode) ──────────
  let outcome: { before: Counts; after: Counts; plan: Plan; visibleTenants: number } | null = null;
  try {
    await prisma.$transaction(
      async (tx: Tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT}, true)`;

        // Confinement, proven rather than assumed: with the GUC pinned and no
        // bypass set, a confined connection sees exactly one tenant row.
        const visibleTenants = await tx.tenant.count();
        if (visibleTenants !== 1) {
          throw new Error(
            `ABORT: app.tenant_id is pinned, yet ${visibleTenants} tenants are visible — ` +
              'row-level security is not confining this transaction. Nothing was written.',
          );
        }
        const self = await tx.tenant.findFirst({ where: { id: TENANT } });
        if (!self || self.name !== EXPECTED_TENANT) {
          throw new Error('ABORT: tenant re-verification inside the write transaction failed.');
        }

        const clinics = await tx.clinic.findMany({ where: { tenantId: TENANT } });
        if (clinics.length !== 1) {
          throw new Error(
            `ABORT: the synthetic tenant has ${clinics.length} clinics — this script expects ` +
              'exactly one and will not guess. Nothing was written.',
          );
        }
        const clinic = clinics[0];
        if (clinic.timezone !== EXPECTED_TIMEZONE) {
          throw new Error(
            `ABORT: clinic timezone is "${clinic.timezone}", not ${EXPECTED_TIMEZONE} — the ` +
              'roster arithmetic below would be wrong. Nothing was written.',
          );
        }
        const CLINIC = clinic.id;

        console.log('\n── matched, verified, and confined ──');
        console.log(`  tenant             : "${self.name}"`);
        console.log(`  tenant match count : 1 of ${found.totalTenants} tenant(s) in this database`);
        console.log(`  clinic             : "${clinic.name}"`);
        console.log(`  clinic timezone    : ${clinic.timezone}`);
        console.log(`  app.tenant_id      : PINNED for this transaction (transaction-local)`);
        console.log(
          `  RLS confinement    : ENFORCED — 1 tenant visible under the pin` +
            `${found.totalTenants > 1 ? `, ${found.totalTenants - 1} other tenant(s) unreachable` : ''}`,
        );
        console.log(`  wall-clock anchor  : ${anchor} (today, UTC+8)`);
        console.log(`  mode               : ${mode}\n`);

        const countAll = async (): Promise<Counts> => ({
          doctors: await tx.staff.count({ where: { tenantId: TENANT, role: 'DOCTOR_RESIDENT' } }),
          services: await tx.serviceCatalog.count({ where: { tenantId: TENANT } }),
          bookableServices: await tx.serviceCatalog.count({
            where: { tenantId: TENANT, bookable: true, active: true },
          }),
          qualifications: await tx.doctorServiceQualification.count({ where: { tenantId: TENANT } }),
          weeklyPatternRows: await tx.doctorSchedule.count({ where: { tenantId: TENANT } }),
          shifts: await tx.providerShift.count({ where: { tenantId: TENANT } }),
          patients: await tx.patient.count({ where: { tenantId: TENANT } }),
          appointments: await tx.appointment.count({ where: { tenantId: TENANT } }),
          seededAppointments: await tx.appointment.count({
            where: { tenantId: TENANT, sourceDetail: MARKER },
          }),
          bookingPagesActive: await tx.clinicBookingPage.count({
            where: { tenantId: TENANT, clinicId: CLINIC, active: true },
          }),
        });
        const before = await countAll();

        const plan: Plan = {
          doctors: { created: 0, updated: 0, unchanged: 0 },
          services: { created: 0, updated: 0, unchanged: 0 },
          qualifications: { created: 0, existing: 0 },
          weeklyPatterns: { created: 0, skippedExisting: 0 },
          shifts: { created: 0, skippedOverlap: 0 },
          patients: { created: 0, existing: 0 },
          appointments: { created: 0, skippedMarker: 0, skippedOverlap: 0 },
          bookingPage: 'unchanged',
          pageSlug: '',
        };

        // ── doctors: matched by name, updated only where values differ ─────
        const upsertDoctor = async (
          fullName: string,
          scheduleMode: 'FIXED_WEEKLY' | 'ROSTER_LINKED',
          color: string,
        ) => {
          const desired = {
            appointmentScheduleMode: scheduleMode,
            calendarColor: color,
            clinicId: CLINIC,
            active: true,
          };
          const existing = await tx.staff.findFirst({ where: { tenantId: TENANT, fullName } });
          if (existing) {
            const diff = changedFields(existing as unknown as Record<string, unknown>, desired);
            if (diff.length > 0) {
              await tx.staff.update({ where: { id: existing.id }, data: desired });
              plan.doctors.updated += 1;
            } else {
              plan.doctors.unchanged += 1;
            }
            return existing;
          }
          plan.doctors.created += 1;
          return tx.staff.create({
            data: { tenantId: TENANT, role: 'DOCTOR_RESIDENT', fullName, ...desired },
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

        // ── services: matched by name, updated only where values differ ────
        const upsertService = async (name: string, desired: Record<string, unknown>) => {
          const existing = await tx.serviceCatalog.findFirst({ where: { tenantId: TENANT, name } });
          if (existing) {
            const diff = changedFields(existing as unknown as Record<string, unknown>, desired);
            if (diff.length > 0) {
              await tx.serviceCatalog.update({ where: { id: existing.id }, data: desired });
              plan.services.updated += 1;
            } else {
              plan.services.unchanged += 1;
            }
            return existing;
          }
          plan.services.created += 1;
          return tx.serviceCatalog.create({ data: { tenantId: TENANT, name, ...desired } as never });
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

        // Who performs what: consultation and the follow-up review are broad;
        // dental and screening are the narrow examples the dataset wants.
        const performs: [string, string][] = [];
        for (const doc of [aisyah, farid, chong, alexandria, priya]) performs.push([doc.id, consult.id]);
        for (const doc of [aisyah, farid, priya]) performs.push([doc.id, review.id]);
        for (const doc of [chong, alexandria]) performs.push([doc.id, scaling.id]);
        for (const doc of [aisyah, farid]) performs.push([doc.id, screening.id]);
        for (const [staffId, serviceId] of performs) {
          const existing = await tx.doctorServiceQualification.findFirst({
            where: { tenantId: TENANT, staffId, serviceId },
          });
          if (existing) {
            plan.qualifications.existing += 1;
            continue;
          }
          await tx.doctorServiceQualification.create({
            data: { tenantId: TENANT, staffId, serviceId },
          });
          plan.qualifications.created += 1;
        }

        // ── weekly patterns, supplied only to a doctor who has none ────────
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
        for (const [staffId, rows] of Object.entries(weeklyPlan)) {
          const has = await tx.doctorSchedule.count({ where: { tenantId: TENANT, staffId } });
          if (has > 0) {
            plan.weeklyPatterns.skippedExisting += rows.length;
            continue;
          }
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
            plan.weeklyPatterns.created += 1;
          }
        }

        // ── roster shifts around the current period ────────────────────────
        // Aisyah (roster-linked): mornings through the fortnight, one evening,
        // ONE overnight, an OFF day and approved LEAVE. Priya: a BLOCKED
        // weekday morning and weekend LOCUM cover. Each row is created only
        // if nothing already overlaps that doctor's span, so a tester's own
        // roster is reused rather than fought.
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
        // The BLOCKED band goes on a weekday so it can never share a span with
        // Priya's weekend LOCUM cover (same doctor — the overlap guard would
        // otherwise silently drop whichever was planned second).
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
        for (const shift of plannedShifts) {
          const startsAt = kl(shift.date, shift.start);
          const endsAt = kl(shift.endDate, shift.end);
          const clash = await tx.providerShift.findFirst({
            where: {
              tenantId: TENANT,
              staffId: shift.staffId,
              startsAt: { lt: endsAt },
              endsAt: { gt: startsAt },
            },
          });
          if (clash) {
            plan.shifts.skippedOverlap += 1;
            continue;
          }
          await tx.providerShift.create({
            data: {
              tenantId: TENANT,
              clinicId: CLINIC,
              staffId: shift.staffId,
              shiftDate: new Date(`${shift.date}T00:00:00Z`),
              startsAt,
              endsAt,
              shiftType: shift.type,
              note: shift.note,
            },
          });
          plan.shifts.created += 1;
        }

        // ── synthetic patients, matched by reserved-format NRIC ────────────
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
          const known = await tx.patient.findFirst({
            where: { tenantId: TENANT, identifierValue: identifier },
          });
          if (known) {
            plan.patients.existing += 1;
            patients.push(known);
            continue;
          }
          plan.patients.created += 1;
          patients.push(
            await tx.patient.create({
              data: {
                tenantId: TENANT,
                identifierType: 'NRIC',
                identifierValue: identifier,
                name: PATIENT_NAMES[i],
                phone: `01${String(34567810 + i * 7)}`,
              },
            }),
          );
        }

        // ── appointments, guarded by their marker ──────────────────────────
        // No CHECKED_IN / IN_QUEUE rows: that state means a real Visit and a
        // real queue ticket exist and are linked. Fabricating the status
        // without the lifecycle would put a lie on the queue board — checking
        // a patient in through the UI is itself part of the UAT.
        if (before.seededAppointments > 0) {
          plan.appointments.skippedMarker = before.seededAppointments;
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
            // Anything a tester already booked into this span wins.
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
                plan.appointments.skippedOverlap += 1;
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
            plan.appointments.created += 1;
          };
          const cancelled = {
            cancellationReason: 'PATIENT_REQUEST',
            cancelReason: 'Patient called to cancel',
            cancelledAt: new Date(),
          };

          // The recent past: work that happened, and one that did not.
          await book(day(-2), aisyah.id, consult.id, '08:30', 15, 'COMPLETED');
          await book(day(-2), aisyah.id, consult.id, '09:00', 15, 'COMPLETED');
          await book(day(-1), aisyah.id, consult.id, '08:30', 15, 'COMPLETED');
          await book(day(-1), aisyah.id, consult.id, '10:00', 15, 'NO_SHOW');
          await book(day(-1), aisyah.id, consult.id, '11:00', 15, 'CANCELLED', cancelled);
          // Today: done, here, and still to come.
          await book(day(0), aisyah.id, consult.id, '08:15', 15, 'COMPLETED');
          await book(day(0), aisyah.id, consult.id, '09:30', 15, 'ARRIVED');
          await book(day(0), aisyah.id, consult.id, '11:30', 15, 'CONFIRMED');
          // The days ahead — all inside the roster laid down above.
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

          // Weekday-shaped extras, each on the first day ahead that fits that
          // doctor's own pattern, so every booking sits inside real hours
          // whatever weekday the run happens on.
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

        // ── the public page: live, branded, policies on ────────────────────
        // Update-in-place keeps whatever slug the page already answers on —
        // links in the wild must not break. Only a page that does not exist
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
        if (page) {
          const diff = changedFields(page as unknown as Record<string, unknown>, brand);
          if (diff.length > 0) {
            await tx.clinicBookingPage.update({ where: { id: page.id }, data: brand });
            plan.bookingPage = 'updated';
          }
          plan.pageSlug = page.slug;
        } else {
          const created = await tx.clinicBookingPage.create({
            data: {
              tenantId: TENANT,
              clinicId: CLINIC,
              slug: DEFAULT_SLUG,
              language: 'en',
              requirePhone: true,
              requireEmail: false,
              requireNric: false,
              showReasonField: true,
              ...brand,
            },
          });
          plan.bookingPage = 'created';
          plan.pageSlug = created.slug;
        }

        outcome = { before, after: await countAll(), plan, visibleTenants };

        if (!WRITE) {
          // The whole mutation path has now run for real inside this
          // transaction; discarding it is what makes the plan above a
          // measurement rather than a guess.
          throw new Rollback('dry run');
        }
      },
      { timeout: 300_000, maxWait: 30_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  if (!outcome) throw new Error('ABORT: the seed transaction produced no report.');
  const { before, after, plan } = outcome as {
    before: Counts;
    after: Counts;
    plan: Plan;
    visibleTenants: number;
  };

  const verb = WRITE ? 'written' : 'would be written';
  console.log(`── what ${WRITE ? 'was done' : 'this run would do'} ──`);
  console.log(`  doctors            : ${plan.doctors.created} created, ${plan.doctors.updated} updated, ${plan.doctors.unchanged} already correct`);
  console.log(`  services           : ${plan.services.created} created, ${plan.services.updated} updated, ${plan.services.unchanged} already correct`);
  console.log(`  qualifications     : ${plan.qualifications.created} created, ${plan.qualifications.existing} already present`);
  console.log(`  weekly patterns    : ${plan.weeklyPatterns.created} created, ${plan.weeklyPatterns.skippedExisting} skipped (doctor already has a pattern)`);
  console.log(`  roster shifts      : ${plan.shifts.created} created, ${plan.shifts.skippedOverlap} skipped (an existing shift already covers that span)`);
  console.log(`  patients           : ${plan.patients.created} created, ${plan.patients.existing} reused by NRIC`);
  console.log(
    `  appointments       : ${plan.appointments.created} created` +
      `${plan.appointments.skippedMarker > 0 ? `, block skipped — ${plan.appointments.skippedMarker} rows already carry sourceDetail "${MARKER}"` : ''}` +
      `${plan.appointments.skippedOverlap > 0 ? `, ${plan.appointments.skippedOverlap} skipped (an existing booking holds that span)` : ''}`,
  );
  console.log(`  booking page       : ${plan.bookingPage} — /book/${plan.pageSlug}`);
  console.log(`  deletes            : 0 (this script contains no delete, truncate or cleanup)`);

  console.log(`\n── counts (${verb}) ──`);
  const keys = Object.keys(before);
  const width = Math.max(...keys.map((k) => k.length));
  for (const key of keys) {
    const delta = after[key] - before[key];
    console.log(
      `  ${key.padEnd(width)} : ${String(before[key]).padStart(4)} → ${String(after[key]).padStart(4)}` +
        `${delta === 0 ? '' : `   (${delta > 0 ? '+' : ''}${delta})`}`,
    );
  }

  if (WRITE) {
    console.log('\nWRITE COMPLETE — the transaction above was committed.');
  } else {
    console.log(
      '\nDRY RUN COMPLETE — NOTHING WRITTEN.\n' +
        'The mutation transaction ran in full and was rolled back; the counts on the\n' +
        'right are what a write run would leave behind. To commit, re-run with the\n' +
        'second key:\n\n' +
        '  ALLOW_REMOTE_UAT_SEED=true UAT_SEED_WRITE=true npx tsx prisma/uat-remote-seed.ts\n',
    );
  }
}

main()
  .catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
