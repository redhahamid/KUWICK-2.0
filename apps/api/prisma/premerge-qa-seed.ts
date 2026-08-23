import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: join(__dirname, '..', '.env') });

// PRE-MERGE QA (§6) — a Klinik Hijraa-shaped week, seeded once, idempotent.
//
// Six providers across BOTH schedule modes, split and overnight shifts,
// approved leave, four services spanning every price-display and payment
// rule, a busy Wednesday of ~18 appointments in every live status, a
// waitlist, and the public page rebranded to read like the clinic it is
// modelled on. Everything hangs off marker names prefixed "QA·" so re-runs
// find their own rows instead of duplicating them.
//
// Runs as the migration owner (kuwick_dev), which BYPASSES RLS — seeding
// only. The application never runs this way (prisma.service.ts refuses).

const TENANT = 'ffffffff-0000-4000-8000-000000000001';
// The staging seed GENERATES the UAT clinic's id, so it differs per database.
// Resolved at startup rather than hardcoded — a fixed uuid here is why this
// script used to fail with a Staff FK violation on any machine that was not
// the one it was written on.
let CLINIC = '';

// The busy day: Wednesday 26 August 2026, Asia/Kuala_Lumpur (UTC+8).
const kl = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00.000+08:00`);
const wall = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const BUSY = '2026-08-26';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

type Doc = { id: string };

async function upsertDoctor(fullName: string, mode: 'FIXED_WEEKLY' | 'ROSTER_LINKED', color: string): Promise<Doc> {
  const existing = await prisma.staff.findFirst({ where: { tenantId: TENANT, fullName } });
  if (existing) {
    await prisma.staff.update({
      where: { id: existing.id },
      data: { appointmentScheduleMode: mode, calendarColor: color, clinicId: CLINIC, active: true },
    });
    return existing;
  }
  return prisma.staff.create({
    data: {
      tenantId: TENANT,
      role: 'DOCTOR_RESIDENT',
      fullName,
      clinicId: CLINIC,
      appointmentScheduleMode: mode,
      calendarColor: color,
    },
  });
}

async function upsertService(
  name: string,
  data: Record<string, unknown>,
): Promise<{ id: string }> {
  const existing = await prisma.serviceCatalog.findFirst({ where: { tenantId: TENANT, name } });
  if (existing) {
    await prisma.serviceCatalog.update({ where: { id: existing.id }, data });
    return existing;
  }
  return prisma.serviceCatalog.create({ data: { tenantId: TENANT, name, ...data } as never });
}

async function main() {
  const uatClinic = await prisma.clinic.findFirst({ where: { tenantId: TENANT } });
  if (!uatClinic) {
    throw new Error('The UAT tenant has no clinic — run prisma/seed-staging-uat.ts first.');
  }
  CLINIC = uatClinic.id;

  // ── providers ─────────────────────────────────────────────────────────────
  const aisyah = await upsertDoctor('Dr. Nurul Aisyah binti Hamid', 'ROSTER_LINKED', '#2F8B57');
  const farid = await upsertDoctor('Dr. Farid Iskandar bin Zulkifli', 'FIXED_WEEKLY', '#2E7BC4');
  const chong = await upsertDoctor('Dr. Chong Wei Ling', 'FIXED_WEEKLY', '#B4506B');
  const priya = await upsertDoctor('Dr. Priyadarshini a/p Raghavan', 'ROSTER_LINKED', '#7A4FBF');
  const hafiz = await upsertDoctor('Dr. Hafiz Danial bin Roslan', 'FIXED_WEEKLY', '#A96A12');
  const alexandria = await upsertDoctor(
    'Dr. Alexandria Wong Mei Xuan-Constantinopoulos',
    'FIXED_WEEKLY',
    '#0F6B78',
  );
  const doctors = [aisyah, farid, chong, priya, hafiz, alexandria];

  // ── services ──────────────────────────────────────────────────────────────
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
    bookingSlug: 'health-screening',
    category: 'Screening',
  });
  await upsertService('Physiotherapy Follow-up (internal)', {
    durationMinutesDefault: 20,
    bookable: false,
    active: true,
    price: 80,
    category: 'Physio',
  });
  await upsertService('Ultrasound (retired)', {
    durationMinutesDefault: 30,
    bookable: true,
    active: false,
    price: 150,
    category: 'Imaging',
  });
  const services = [consult, scaling, screening];

  // every doctor performs consultation; dental/screening are narrower
  for (const doc of doctors) {
    for (const service of services) {
      if (service.id === scaling.id && ![chong.id, alexandria.id].includes(doc.id)) continue;
      if (service.id === screening.id && ![aisyah.id, farid.id, hafiz.id].includes(doc.id)) continue;
      await prisma.doctorServiceQualification.upsert({
        where: { tenantId_staffId_serviceId: { tenantId: TENANT, staffId: doc.id, serviceId: service.id } },
        update: {},
        create: { tenantId: TENANT, staffId: doc.id, serviceId: service.id },
      });
    }
  }

  // ── fixed weekly rosters ──────────────────────────────────────────────────
  await prisma.doctorSchedule.deleteMany({
    where: { tenantId: TENANT, staffId: { in: [farid.id, chong.id, hafiz.id, alexandria.id] } },
  });
  const weekly = async (staffId: string, dayOfWeek: number, start: string, end: string) =>
    prisma.doctorSchedule.create({
      data: {
        tenantId: TENANT,
        clinicId: CLINIC,
        staffId,
        dayOfWeek,
        startTime: wall(start),
        endTime: wall(end),
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      },
    });
  for (const day of [1, 2, 3, 4, 5]) {
    // Farid: SPLIT shift — morning and evening, lunch closed.
    await weekly(farid.id, day, '09:00', '13:00');
    await weekly(farid.id, day, '14:30', '18:00');
  }
  await weekly(farid.id, 6, '09:00', '12:30');
  for (const day of [1, 3, 5]) await weekly(chong.id, day, '10:00', '20:00');
  for (const day of [1, 2, 3, 4, 5]) await weekly(hafiz.id, day, '09:00', '17:00');
  for (const day of [2, 4]) await weekly(alexandria.id, day, '08:30', '12:30');

  // ── monthly roster shifts (Aisyah + locum Priya) ─────────────────────────
  await prisma.providerShift.deleteMany({
    where: { tenantId: TENANT, staffId: { in: [aisyah.id, priya.id] } },
  });
  const shift = async (
    staffId: string,
    date: string,
    start: string,
    endDate: string,
    end: string,
    type: 'WORKING' | 'OFF' | 'LEAVE' | 'BLOCKED' | 'LOCUM' = 'WORKING',
    note?: string,
  ) =>
    prisma.providerShift.create({
      data: {
        tenantId: TENANT,
        clinicId: CLINIC,
        staffId,
        shiftDate: new Date(`${date}T00:00:00Z`),
        startsAt: kl(date, start),
        endsAt: kl(endDate, end),
        shiftType: type,
        note,
      },
    });
  // Aisyah's fortnight around the busy day: mornings, an evening, ONE
  // overnight (Wed 22:00 → Thu 06:00), an OFF day and APPROVED LEAVE.
  await shift(aisyah.id, '2026-08-24', '08:00', '2026-08-24', '13:00');
  await shift(aisyah.id, '2026-08-25', '14:00', '2026-08-25', '19:00');
  await shift(aisyah.id, '2026-08-26', '08:00', '2026-08-26', '13:00');
  await shift(aisyah.id, '2026-08-26', '22:00', '2026-08-27', '06:00', 'WORKING', 'Night cover');
  // OFF and LEAVE still carry a span — the roster draws the band and the
  // engine refuses inside it; zero-length rows are refused by the DB.
  await shift(aisyah.id, '2026-08-27', '09:00', '2026-08-27', '17:00', 'OFF');
  await shift(aisyah.id, '2026-08-28', '09:00', '2026-08-28', '17:00', 'LEAVE', 'Annual leave (approved)');
  await shift(aisyah.id, '2026-08-29', '08:00', '2026-08-29', '13:00');
  await shift(aisyah.id, '2026-08-31', '08:00', '2026-08-31', '13:00');
  await shift(aisyah.id, '2026-09-01', '08:00', '2026-09-01', '13:00');
  await shift(aisyah.id, '2026-09-02', '08:00', '2026-09-02', '13:00');
  // Priya covers weekends as a locum.
  await shift(priya.id, '2026-08-29', '09:00', '2026-08-29', '17:00', 'LOCUM', 'Weekend locum');
  await shift(priya.id, '2026-08-30', '09:00', '2026-08-30', '13:00', 'LOCUM');
  // A BLOCKED band — in the building, not bookable (V3 §12 wants every shift
  // state visible on the acceptance board).
  await shift(priya.id, '2026-08-26', '09:00', '2026-08-26', '13:00', 'BLOCKED', 'CME morning');

  // Hafiz: approved leave ON the busy day (whole day).
  await prisma.scheduleException.deleteMany({ where: { tenantId: TENANT, staffId: hafiz.id } });
  await prisma.scheduleException.create({
    data: {
      tenantId: TENANT,
      clinicId: CLINIC,
      staffId: hafiz.id,
      date: new Date(`${BUSY}T00:00:00Z`),
      reason: 'Annual leave (approved)',
    },
  });

  // ── the busy Wednesday ────────────────────────────────────────────────────
  const priorQa = await prisma.appointment.findMany({
    where: { tenantId: TENANT, sourceDetail: 'premerge-qa' },
    select: { id: true },
  });
  if (priorQa.length === 0) {
    const patients: { id: string }[] = [];
    const NAMES = [
      'Siti Aminah binti Yusof', 'Tan Mei Chen', 'Muhammad Danish bin Abdullah',
      'Kavitha a/p Suppiah', 'Lee Jia Hui', 'Nurul Izzah binti Rahman',
      'Rajesh a/l Kumar', 'Wong Kar Mun', 'Ahmad Firdaus bin Ismail',
      'Chen Xiao Ling', 'Fatimah binti Omar', 'Suresh a/l Maniam',
      'Lim Boon Keng', 'Aisha binti Zainuddin',
    ];
    for (let i = 0; i < NAMES.length; i += 1) {
      const identifier = `9001${String(10 + i)}14${String(5000 + i)}`;
      const found = await prisma.patient.findFirst({ where: { tenantId: TENANT, identifierValue: identifier } });
      patients.push(
        found ??
          (await prisma.patient.create({
            data: {
              tenantId: TENANT,
              identifierType: 'NRIC',
              identifierValue: identifier,
              name: NAMES[i],
              phone: `01${String(23456780 + i * 7)}`,
            },
          })),
      );
    }

    let seq = 0;
    const book = async (
      staffId: string,
      serviceId: string,
      start: string,
      minutes: number,
      status: string,
      extra: Record<string, unknown> = {},
    ) => {
      const patient = patients[seq % patients.length];
      seq += 1;
      const scheduledStart = kl(BUSY, start);
      return prisma.appointment.create({
        data: {
          tenantId: TENANT,
          clinicId: CLINIC,
          patientId: patient.id,
          staffId,
          serviceId,
          source: seq % 3 === 0 ? 'ONLINE_PORTAL' : 'FRONT_DESK',
          sourceDetail: 'premerge-qa',
          status: status as never,
          scheduledStart,
          scheduledEnd: new Date(scheduledStart.getTime() + minutes * 60_000),
          manageToken: `qa${String(seq).padStart(3, '0')}${'x'.repeat(38)}`,
          ...extra,
        } as never,
      });
    };

    // Aisyah's morning: five consults, one screening.
    await book(aisyah.id, consult.id, '08:00', 15, 'COMPLETED');
    await book(aisyah.id, consult.id, '08:15', 15, 'COMPLETED');
    await book(aisyah.id, consult.id, '09:00', 15, 'CONFIRMED');
    await book(aisyah.id, screening.id, '10:00', 60, 'CONFIRMED', {
      patientNote: 'Follow-up screening — fasting since midnight',
    });
    await book(aisyah.id, consult.id, '11:30', 15, 'REQUESTED');
    // Night shift: an overnight consult.
    await book(aisyah.id, consult.id, '23:00', 15, 'CONFIRMED', { notes: 'Night cover — fever, walk-in call ahead' });

    // Farid: split-shift day, morning + evening.
    await book(farid.id, consult.id, '09:00', 15, 'ARRIVED');
    await book(farid.id, consult.id, '09:30', 15, 'CONFIRMED');
    await book(farid.id, screening.id, '10:30', 60, 'CONFIRMED');
    await book(farid.id, consult.id, '15:00', 15, 'CONFIRMED');
    await book(farid.id, consult.id, '16:00', 15, 'NO_SHOW');

    // Chong: dental afternoon.
    await book(chong.id, scaling.id, '11:00', 30, 'CONFIRMED', {
      bookingFeeAmount: 50,
      bookingFeePaidAt: new Date(),
      paymentStatus: 'PAID',
    });
    await book(chong.id, scaling.id, '14:00', 30, 'CONFIRMED', {
      bookingFeeAmount: 50,
      paymentStatus: 'PENDING',
    });
    await book(chong.id, consult.id, '17:00', 15, 'CANCELLED', {
      cancellationReason: 'PATIENT_REQUEST',
      cancelReason: 'Patient called to cancel — clashing school pickup',
      cancelledAt: new Date(),
    });

    // Alexandria (the long name): a tight morning pair.
    await book(alexandria.id, consult.id, '08:30', 15, 'CONFIRMED');
    await book(alexandria.id, scaling.id, '09:00', 30, 'CONFIRMED');

    // A reschedule pair: original cancelled with the link, replacement live.
    const original = await book(farid.id, consult.id, '10:00', 15, 'CANCELLED', {
      cancellationReason: 'RESCHEDULED',
      cancelReason: 'Moved to the afternoon at the patient’s request',
      cancelledAt: new Date(),
    });
    await book(farid.id, consult.id, '15:30', 15, 'CONFIRMED', {
      rescheduledFromId: original.id,
    });

    // Waitlist: two entries, one with a preferred doctor.
    await prisma.waitlistEntry.createMany({
      data: [
        {
          tenantId: TENANT,
          clinicId: CLINIC,
          patientId: patients[12].id,
          serviceId: screening.id,
          preferredStaffId: aisyah.id,
          preferredDaypart: 'MORNING',
          note: 'Any weekday morning — school run after 12',
        },
        {
          tenantId: TENANT,
          clinicId: CLINIC,
          patientId: patients[13].id,
          serviceId: scaling.id,
          earliestDate: new Date('2026-08-27T00:00:00Z'),
          note: 'Prefers Dr Chong if possible',
        },
      ],
    });
  }

  // ── the rest of the month (V3.1 §7) ──────────────────────────────────────
  // The busy Wednesday proves density; the MONTH view needs distribution —
  // singles and pairs across the fortnight, all inside hours the seeded
  // roster really works, so every one of these is bookable truth. Guarded by
  // its own marker so re-runs on an existing database add it exactly once
  // (the diary is append-only, test data included).
  const priorMonthQa = await prisma.appointment.count({
    where: { tenantId: TENANT, sourceDetail: 'premerge-qa-month' },
  });
  if (priorMonthQa === 0) {
    const patientByIndex = async (i: number) => {
      const identifier = `9001${String(10 + i)}14${String(5000 + i)}`;
      const row = await prisma.patient.findFirst({
        where: { tenantId: TENANT, identifierValue: identifier },
      });
      if (!row) throw new Error('QA patients missing — the busy-Wednesday block must seed first.');
      return row;
    };
    let monthSeq = 0;
    const bookOn = async (
      day: string,
      staffId: string,
      serviceId: string,
      start: string,
      minutes: number,
      status = 'CONFIRMED',
    ) => {
      const patient = await patientByIndex(monthSeq % 14);
      monthSeq += 1;
      const scheduledStart = kl(day, start);
      await prisma.appointment.create({
        data: {
          tenantId: TENANT,
          clinicId: CLINIC,
          patientId: patient.id,
          staffId,
          serviceId,
          source: monthSeq % 2 === 0 ? 'ONLINE_PORTAL' : 'FRONT_DESK',
          sourceDetail: 'premerge-qa-month',
          status: status as never,
          scheduledStart,
          scheduledEnd: new Date(scheduledStart.getTime() + minutes * 60_000),
          manageToken: `qm${String(monthSeq).padStart(3, '0')}${'y'.repeat(38)}`,
        } as never,
      });
    };
    // Mon 24 — one booking (aisyah 08:00–13:00).
    await bookOn('2026-08-24', aisyah.id, consult.id, '08:30', 15);
    // Tue 25 — a pair in aisyah's evening block (14:00–19:00).
    await bookOn('2026-08-25', aisyah.id, consult.id, '14:30', 15);
    await bookOn('2026-08-25', aisyah.id, screening.id, '16:00', 60);
    // Thu 27 — one with Alexandria (weekly Thu 08:30–12:30).
    await bookOn('2026-08-27', alexandria.id, scaling.id, '09:00', 30);
    // Fri 28 — a pair with Chong (weekly Fri 10:00–20:00).
    await bookOn('2026-08-28', chong.id, consult.id, '11:00', 15);
    await bookOn('2026-08-28', chong.id, scaling.id, '15:00', 30, 'REQUESTED');
    // Sat 29 — aisyah's morning plus the weekend locum.
    await bookOn('2026-08-29', aisyah.id, consult.id, '08:30', 15);
    await bookOn('2026-08-29', priya.id, consult.id, '10:00', 15);
    // Mon 31 — one booking.
    await bookOn('2026-08-31', aisyah.id, consult.id, '09:00', 15);
    // Into September, so the next month is not a cliff.
    await bookOn('2026-09-01', aisyah.id, consult.id, '08:30', 15);
    await bookOn('2026-09-02', aisyah.id, screening.id, '09:00', 60);
  }

  // ── QA hygiene: the e2e suite's throwaway names ──────────────────────────
  // Playwright books patients named "Public 1755…" / "Manage 1755…"; their
  // appointments are real and stay (append-only applies to test data too),
  // but the NAMES read as debris in screenshots. Renamed — an UPDATE, nothing
  // deleted — to realistic synthetic names. Each suite run mints fresh unique
  // names, so this never collides with a future run's assertions.
  const throwaway = await prisma.patient.findMany({
    where: { tenantId: TENANT, OR: [{ name: { startsWith: 'Public ' } }, { name: { startsWith: 'Manage ' } }] },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  const REALISTIC = [
    'Aina Sofea binti Roslan', 'Darren Loh Wei Jian', 'Meera a/p Sivakumar',
    'Hakim bin Jamaludin', 'Grace Tan Li Ying', 'Arjun a/l Prakash',
    'Nabila binti Shukri', 'Ethan Ng Kai Wen',
  ];
  for (let i = 0; i < throwaway.length; i += 1) {
    await prisma.patient.update({
      where: { id: throwaway[i].id },
      data: { name: REALISTIC[i % REALISTIC.length] },
    });
  }

  // ── the public page, rebranded ───────────────────────────────────────────
  // UPSERT, not update: on a fresh database no page exists yet (the author's
  // machine had one created through the UI, which is why updateMany was
  // enough there and a silent no-op everywhere else — the public flow then
  // 404'd on /book/uat-clinic).
  const brandData = {
    displayName: 'Klinik Hijraa Bangi',
    introText:
      'Selamat datang ke Klinik Hijraa Bangi. Tempah temujanji anda di bawah — welcome, book your appointment below.',
    active: true,
    allowPatientReschedule: true,
    allowPatientCancel: true,
    patientChangeCutoffHours: 4,
  };
  const existingPage = await prisma.clinicBookingPage.findFirst({
    where: { tenantId: TENANT, clinicId: CLINIC },
  });
  if (existingPage) {
    await prisma.clinicBookingPage.update({ where: { id: existingPage.id }, data: brandData });
  } else {
    await prisma.clinicBookingPage.create({
      data: {
        tenantId: TENANT,
        clinicId: CLINIC,
        slug: 'uat-clinic',
        language: 'en',
        requirePhone: true,
        requireEmail: false,
        requireNric: false,
        showReasonField: true,
        ...brandData,
      },
    });
  }

  const counts = {
    doctors: doctors.length,
    services: await prisma.serviceCatalog.count({ where: { tenantId: TENANT } }),
    shifts: await prisma.providerShift.count({ where: { tenantId: TENANT } }),
    weekly: await prisma.doctorSchedule.count({ where: { tenantId: TENANT } }),
    qaAppointments: await prisma.appointment.count({ where: { tenantId: TENANT, sourceDetail: 'premerge-qa' } }),
    qaMonthSpread: await prisma.appointment.count({ where: { tenantId: TENANT, sourceDetail: 'premerge-qa-month' } }),
    waitlist: await prisma.waitlistEntry.count({ where: { tenantId: TENANT } }),
  };
  console.log('premerge-qa-seed:', JSON.stringify(counts));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
