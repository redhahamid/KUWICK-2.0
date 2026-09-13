/**
 * HR UAT SEED — the world the owner tests HR and payroll against (Piece 3g,
 * prompt §8).
 *
 *   KUWICK_ADMIN_UAT_SEED=yes \
 *   ADMIN_UAT_RESET_URL=postgresql://<owner>:<pass>@host:5432/<db> \
 *   npx tsx prisma/seed-hr-uat.ts
 *
 * Step 1 rebuilds the synthetic admin UAT tenant (`seed-admin-uat.ts`, run as
 * a child process — one company with every employer number filled, two
 * branches, eleven employees and a contractor, salaries, statutory standing,
 * bank accounts, recurring items, the Doctors rule set at RM500 a public-
 * holiday shift, the standard rule set on the Act). Set
 * KUWICK_HR_UAT_SKIP_BASE=yes to add the HR layer to a world already seeded.
 *
 * Step 2 completes what a real payroll month needs and gives the portal a
 * story: the contract executive's salary, tax standing for the three profiles
 * the base seed leaves blank on purpose, this year's public holidays, a
 * Mon–Fri roster for the portal test accounts, and the resident doctor's
 * leave, claims and medical benefit.
 *
 * Step 3 runs THE ENGINE, not a hand-built copy of it, over the last three
 * months for the Central branch — create, calculate, approve, prepare the
 * payment, record it paid on the 28th — through the API itself, signed in
 * as the owner (KUWICK_API_URL, default http://127.0.0.1:3000; the API must
 * be running against this database). So every figure the owner compares
 * with a real payslip is the figure the product computes, and the portal
 * has three paid months with PDFs. (In-process would need decorator
 * metadata that tsx does not emit.)
 *
 * Synthetic, like the base seed: invented names, `.invalid` accounts,
 * invented figures. The lunar-calendar public holidays are placeholders to
 * verify against the gazette (see docs/HR_UAT_CHECKLIST.md).
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { config } from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: join(__dirname, '..', '.env') });

const TENANT_NAME = 'Klinik Contoh (UAT)';
const DOMAIN = 'admin-uat.kuwick.invalid';
const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';
const CENTRAL = 'Contoh Central';
const TIME_ZONE = 'Asia/Kuala_Lumpur';
const API = (process.env.KUWICK_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');

/** The people the checklist signs in as, by the name the base seed gives them. */
const PEOPLE = {
  owner: 'Dr Aisyah Rahman',
  manager: 'Rohana Yusof',
  resident: 'Dr Meera Kaur',
  nurse: 'Puteri Balqis',
  stock: 'Hafiz Osman',
  counter: 'Nurul Hidayah',
  counter2: 'Siti Zaleha',
  panel: 'Wan Azman',
} as const;

/**
 * Malaysia's federal public holidays for the year. The fixed dates are
 * certain; the lunar ones (marked) are the customary dates and must be
 * checked against the gazette before real use — they are here so an
 * attendance record on a holiday is priced as one.
 */
const PUBLIC_HOLIDAYS_2026: { date: string; name: string }[] = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-02-17', name: 'Chinese New Year (placeholder date)' },
  { date: '2026-02-18', name: 'Chinese New Year, second day (placeholder date)' },
  { date: '2026-03-20', name: 'Hari Raya Aidilfitri (placeholder date)' },
  { date: '2026-03-21', name: 'Hari Raya Aidilfitri, second day (placeholder date)' },
  { date: '2026-05-01', name: 'Labour Day' },
  { date: '2026-05-27', name: 'Hari Raya Haji (placeholder date)' },
  { date: '2026-05-31', name: 'Wesak Day (placeholder date)' },
  { date: '2026-06-01', name: "Agong's Birthday" },
  { date: '2026-06-17', name: 'Awal Muharram (placeholder date)' },
  { date: '2026-08-25', name: 'Maulidur Rasul (placeholder date)' },
  { date: '2026-08-31', name: 'Merdeka Day' },
  { date: '2026-09-16', name: 'Malaysia Day' },
  { date: '2026-11-08', name: 'Deepavali (placeholder date)' },
  { date: '2026-12-25', name: 'Christmas Day' },
];

// --- dates, the base seed's way: the clinic-local date at UTC midnight -------

function todayKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function day(offset: number): Date {
  return new Date(new Date(`${todayKey()}T00:00:00.000Z`).getTime() + offset * 86400000);
}
/** `hour` is UTC on that date: 1 is 09:00 in Kuala Lumpur, as in the base seed. */
function at(offset: number, hour: number, minute = 0): Date {
  return new Date(day(offset).getTime() + hour * 3600000 + minute * 60000);
}
function monthStart(offset = 0): Date {
  const [y, m] = todayKey().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1));
}
function ym(date: Date): string {
  return date.toISOString().slice(0, 7);
}
function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type Tx = Prisma.TransactionClient;

async function login(email: string, password: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    throw new Error(`The API at ${API} is not reachable (${String(error)}). Start it against this database, then run the seed again.`);
  }
  if (!response.ok) throw new Error(`Login as ${email} failed: ${response.status}`);
  const body = (await response.json()) as { accessToken?: string };
  if (!body.accessToken) throw new Error('Login returned no access token.');
  return body.accessToken;
}

async function main() {
  if (process.env.KUWICK_ADMIN_UAT_SEED !== 'yes') {
    throw new Error('Refusing to run without KUWICK_ADMIN_UAT_SEED=yes — this seed rebuilds a whole tenant.');
  }
  const apiRoot = join(__dirname, '..');

  if (process.env.KUWICK_HR_UAT_SKIP_BASE !== 'yes') {
    console.log('HR UAT seed — step 1 of 3: the admin UAT world');
    execFileSync('npx', ['tsx', 'prisma/seed-admin-uat.ts'], { cwd: apiRoot, stdio: 'inherit', env: process.env });
  }

  const url = process.env.ADMIN_UAT_RESET_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL or ADMIN_UAT_RESET_URL is needed.');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  const tenant = await prisma.tenant.findFirst({ where: { name: TENANT_NAME } });
  if (!tenant) throw new Error(`The base world is not there: no tenant named ${TENANT_NAME}.`);
  const tenantId = tenant.id;

  const inTenant = <T>(fn: (tx: Tx) => Promise<T>) =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
        return fn(tx);
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

  console.log('HR UAT seed — step 2 of 3: what a real month needs, and the portal’s story');

  const { staff, central } = await inTenant(async (tx) => {
    const rows = await tx.staff.findMany({ where: { tenantId }, select: { id: true, fullName: true, clinicId: true } });
    const byName = new Map(rows.map((row) => [row.fullName, row]));
    const picked: Record<keyof typeof PEOPLE, { id: string; clinicId: string | null }> = {} as never;
    for (const [key, name] of Object.entries(PEOPLE) as [keyof typeof PEOPLE, string][]) {
      const row = byName.get(name);
      if (!row) throw new Error(`The base world has nobody called ${name}.`);
      picked[key] = { id: row.id, clinicId: row.clinicId };
    }
    const clinic = await tx.clinic.findFirst({ where: { tenantId, name: CENTRAL } });
    if (!clinic) throw new Error(`No branch called ${CENTRAL}.`);
    return { staff: picked, central: clinic.id };
  });

  const summary: string[] = [];

  await inTenant(async (tx) => {
    // The contract executive: on payroll from his start date. The base seed
    // leaves his salary blank to show an incomplete record; a paid month
    // cannot carry a blocking gap, so the record is completed here.
    const panel = await tx.employeeProfile.findUnique({ where: { staffId: staff.panel.id } });
    const panelSalaries = await tx.employeeSalary.count({ where: { staffId: staff.panel.id } });
    if (panel && panelSalaries === 0) {
      await tx.employeeSalary.create({
        data: {
          tenantId,
          staffId: staff.panel.id,
          basis: 'MONTHLY',
          amount: 3300,
          effectiveFrom: panel.startDate ?? day(-400),
          reason: 'Contract salary on appointment',
          createdByStaffId: staff.owner.id,
        },
      });
      summary.push('Wan Azman: RM3,300 a month from his start date (the base seed left it blank)');
    }

    // Tax standing for the three the base seed leaves unrecorded on purpose,
    // so PCB is computed rather than blocked. Single, resident, no children.
    const taxed = await tx.employeeStatutoryClassification.updateMany({
      where: { tenantId, staffId: { in: [staff.counter.id, staff.counter2.id, staff.stock.id] }, taxResidence: null },
      data: { taxResidence: 'RESIDENT', pcbCategory: 'CATEGORY_1', qualifyingChildren: 0 },
    });
    if (taxed.count > 0) summary.push(`${taxed.count} tax standings recorded (resident, category 1) so PCB is computed, not blocked`);

    // The branch's geofence for portal clock-ins and the claims policy —
    // Piece 3g. [A] The point is a placeholder in central Kuala Lumpur; the
    // owner replaces it with the clinic's own on Settings › Attendance &
    // leave policies. 150 m is the prompt's default radius.
    const fence = await tx.attendancePolicy.findFirst({ where: { tenantId, clinicId: central } });
    if (!fence) {
      await tx.attendancePolicy.create({
        data: { tenantId, clinicId: central, geofenceLat: 3.139, geofenceLng: 101.6869, geofenceRadiusMetres: 150, updatedByStaffId: staff.owner.id },
      });
      summary.push('Contoh Central: geofence 150 m around a placeholder point in Kuala Lumpur (replace in Settings)');
    } else if (fence.geofenceLat === null) {
      await tx.attendancePolicy.update({
        where: { id: fence.id },
        data: { geofenceLat: 3.139, geofenceLng: 101.6869, geofenceRadiusMetres: 150 },
      });
      summary.push('Contoh Central: geofence 150 m around a placeholder point in Kuala Lumpur (replace in Settings)');
    }
    if (!(await tx.claimPolicy.findUnique({ where: { tenantId } }))) {
      await tx.claimPolicy.create({ data: { tenantId, mileageRatePerKm: 0.6, receiptRequired: true, updatedByStaffId: staff.owner.id } });
      summary.push('Claims policy: RM0.60 a kilometre (placeholder), receipt required');
    }

    // Public holidays for the year.
    let holidays = 0;
    for (const holiday of PUBLIC_HOLIDAYS_2026) {
      const date = new Date(`${holiday.date}T00:00:00.000Z`);
      const exists = await tx.publicHoliday.findFirst({ where: { tenantId, date } });
      if (!exists) {
        await tx.publicHoliday.create({ data: { tenantId, date, name: holiday.name } });
        holidays += 1;
      }
    }
    summary.push(`${holidays} public holidays for ${todayKey().slice(0, 4)} (lunar dates are placeholders)`);

    // A Mon–Fri 09:00–18:00 roster for the current month, for the three
    // portal accounts that had none. The doctors already have theirs.
    let shifts = 0;
    const first = monthStart(0);
    const next = monthStart(1);
    const todayStart = day(0);
    for (const who of [staff.nurse, staff.stock, staff.counter]) {
      for (let date = new Date(first); date < next; date = new Date(date.getTime() + 86400000)) {
        const weekday = date.getUTCDay();
        if (weekday === 0 || weekday === 6) continue;
        const offset = Math.round((date.getTime() - todayStart.getTime()) / 86400000);
        const exists = await tx.providerShift.findFirst({ where: { tenantId, staffId: who.id, shiftDate: date } });
        if (exists) continue;
        await tx.providerShift.create({
          data: {
            tenantId,
            clinicId: who.clinicId ?? central,
            staffId: who.id,
            shiftDate: date,
            startsAt: at(offset, 1),
            endsAt: at(offset, 10),
            shiftType: 'WORKING',
          },
        });
        shifts += 1;
      }
    }
    summary.push(`${shifts} roster shifts this month for the nurse, the stock controller and the clinic assistant`);

    // The resident doctor's story, as the portal mockups tell it: a medical
    // day approved, an annual request waiting, an unpaid day last month; a
    // dental claim approved for this month's payroll and a meal paid with
    // last month's; a medical benefit part used.
    const meera = staff.resident.id;
    if ((await tx.leaveRequest.count({ where: { staffId: meera } })) === 0) {
      await tx.leaveRequest.create({
        data: {
          tenantId, staffId: meera, leaveType: 'MEDICAL', startDate: day(-4), endDate: day(-4),
          reason: 'MC — outside clinic', status: 'APPROVED', approvedByStaffId: staff.manager.id, approvedAt: at(-4, 3),
        },
      });
      await tx.leaveRequest.create({
        data: {
          tenantId, staffId: meera, leaveType: 'ANNUAL', startDate: day(9), endDate: day(11),
          reason: 'Family trip', status: 'PENDING',
        },
      });
      await tx.leaveRequest.create({
        data: {
          tenantId, staffId: meera, leaveType: 'UNPAID', startDate: day(-31), endDate: day(-31),
          reason: 'Personal', status: 'APPROVED', approvedByStaffId: staff.manager.id, approvedAt: at(-33, 3),
        },
      });
      summary.push('Dr Meera Kaur: one medical day approved, three annual days waiting, one unpaid day last month');
    }
    if ((await tx.staffClaim.count({ where: { staffId: meera } })) === 0) {
      await tx.staffClaim.create({
        data: {
          tenantId, clinicId: central, staffId: meera, category: 'MEDICAL', amountClaimed: 180, amountApproved: 180,
          claimDate: day(-7), description: 'Dental', status: 'APPROVED',
          submittedByStaffId: meera, submittedAt: at(-7, 9),
          decidedByStaffId: staff.manager.id, decidedAt: at(-6, 11),
          paymentRoute: 'PAYROLL', payoutStatus: 'PENDING', payrollPeriod: monthStart(0),
        },
      });
      await tx.staffClaim.create({
        data: {
          tenantId, clinicId: central, staffId: meera, category: 'MEAL', amountClaimed: 30, amountApproved: 30,
          claimDate: day(-23), description: 'Late shift', status: 'APPROVED',
          submittedByStaffId: meera, submittedAt: at(-23, 9),
          decidedByStaffId: staff.manager.id, decidedAt: at(-22, 11),
          paymentRoute: 'PAYROLL', payoutStatus: 'PENDING', payrollPeriod: monthStart(-1),
        },
      });
      summary.push('Dr Meera Kaur: a RM180 dental claim for this month’s payroll, a RM30 meal paid with last month’s');
    }
    const benefitYear = Number(todayKey().slice(0, 4));
    if (!(await tx.staffBenefitAccount.findFirst({ where: { staffId: meera, benefitYear } }))) {
      const account = await tx.staffBenefitAccount.create({ data: { tenantId, staffId: meera, benefitYear, allowance: 1000 } });
      await tx.staffBenefitMember.create({ data: { tenantId, accountId: account.id, name: PEOPLE.resident, relationship: 'SELF' } });
      await tx.staffBenefitUsage.create({
        data: { tenantId, accountId: account.id, usedAt: day(-7), amount: 380, notes: 'Dental, outside clinic', recordedByStaffId: staff.manager.id },
      });
      summary.push('Dr Meera Kaur: medical benefit RM1,000, RM380 used');
    }
  });

  console.log('HR UAT seed — step 3 of 3: three months through the engine, approved and paid');

  const token = await login(`owner@${DOMAIN}`, PASSWORD);
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 400)}`);
    return text ? (JSON.parse(text) as unknown) : null;
  };

  /*
   * THE CLINIC'S OWN STATUTORY TREATMENT, decided before a month is priced.
   *
   * Kuwick seeds a catalogue that reproduces what the old engine did, and says
   * of itself that no authority has checked it. THIS clinic contributes EPF on
   * basic pay only, counts an employee's own locum session as wages, and treats
   * mileage as a reimbursement rather than pay. All three are lawful choices a
   * clinic makes, all three differ from the seed, and none of them is shipped
   * as a default — the product must not hardcode one clinic's policy in place
   * of another's.
   *
   * So the demo world makes them the way an owner does: through the same
   * endpoint, dated, reasoned, and marked as the clinic's decision. Applied
   * BEFORE the three months below, so those months are priced under the
   * clinic's table rather than under Kuwick's guess.
   */
  const TREATMENT: { code: string; epf: boolean; socso: boolean; eis: boolean; pcb: boolean; why: string }[] = [
    { code: 'INCENTIVE', epf: false, socso: true, eis: true, pcb: true, why: 'Clinic policy: EPF is contributed on basic pay only.' },
    { code: 'COMMISSION', epf: false, socso: true, eis: true, pcb: true, why: 'Clinic policy: EPF is contributed on basic pay only.' },
    { code: 'ALLOWANCE', epf: false, socso: true, eis: true, pcb: true, why: 'Clinic policy: EPF is contributed on basic pay only.' },
    { code: 'ATTENDANCE_ALLOWANCE', epf: false, socso: true, eis: true, pcb: true, why: 'Clinic policy: EPF is contributed on basic pay only.' },
    { code: 'OVERTIME', epf: false, socso: true, eis: true, pcb: true, why: 'Clinic policy: EPF is contributed on basic pay only.' },
    { code: 'LOCUM_FEE', epf: false, socso: true, eis: true, pcb: true, why: "An employee's own locum session is wages, so SOCSO and EIS apply." },
    { code: 'DIRECTOR_FEE', epf: false, socso: false, eis: false, pcb: true, why: "A director's fee here is a fee, not employment income." },
    { code: 'MILEAGE', epf: false, socso: false, eis: false, pcb: false, why: 'Reimbursement of travel actually incurred, not pay.' },
  ];

  const treatmentFrom = ym(monthStart(-3)) + '-01';
  const catalogue = (await call('GET', '/workforce/pay-components')) as {
    components: (Record<string, unknown> & { code: string; epfLiable: boolean; socsoLiable: boolean; eisLiable: boolean; pcbLiable: boolean })[];
  };
  let decided = 0;
  for (const want of TREATMENT) {
    const row = catalogue.components.find((component) => component.code === want.code);
    if (!row) continue;
    // IDEMPOTENT, and it has to be: on a re-run the months below are already
    // approved, and a treatment change dated into an approved period is refused
    // — correctly. Nothing differs, so nothing is sent.
    const differs =
      row.epfLiable !== want.epf || row.socsoLiable !== want.socso || row.eisLiable !== want.eis || row.pcbLiable !== want.pcb;
    if (!differs) continue;
    await call('POST', '/workforce/pay-components', {
      ...row,
      epfLiable: want.epf,
      socsoLiable: want.socso,
      eisLiable: want.eis,
      pcbLiable: want.pcb,
      effectiveFrom: treatmentFrom,
      reason: want.why,
    });
    decided += 1;
  }
  summary.push(
    decided > 0
      ? `Statutory treatment: ${decided} component(s) set by the clinic from ${treatmentFrom}, each with its reason`
      : 'Statutory treatment: already as this clinic decided',
  );

  for (const offset of [-3, -2, -1]) {
    const period = monthStart(offset);
    const key = ym(period);
    const existing = await inTenant((tx) =>
      tx.payrollRun.findFirst({ where: { tenantId, period, clinicId: central, status: { not: 'CANCELLED' } } }),
    );
    let runId = existing?.id;
    if (existing && existing.status === 'PAID') {
      summary.push(`${key}: already paid`);
      continue;
    }
    if (!runId) {
      const created = (await call('POST', '/workforce/payroll/runs', { period: key, clinicId: central })) as { id: string };
      runId = created.id;
    }
    await call('PATCH', `/workforce/payroll/runs/${runId}/calculate`);
    const blocking = await inTenant((tx) =>
      tx.payrollException.findMany({
        where: { payrollRunId: runId as string, severity: 'BLOCKING', overriddenAt: null },
        include: { staff: { select: { fullName: true } } },
      }),
    );
    if (blocking.length > 0) {
      for (const row of blocking) console.error(`  ${key}: ${row.code} — ${row.staff?.fullName ?? 'run'}: ${row.cause}`);
      throw new Error(`${key} cannot be approved: ${blocking.length} blocking exception(s). The seed must complete the record instead.`);
    }
    await call('PATCH', `/workforce/payroll/runs/${runId}/approve`, { acknowledgeStatutoryGap: true });
    await call('POST', `/workforce/payroll/runs/${runId}/payment/prepare`);
    const paidOn = `${key}-28`;
    await call('POST', `/workforce/payroll/runs/${runId}/payment/record-paid`, { paymentDate: paidOn, reference: `UAT-${key}-CENTRAL` });
    const totals = await inTenant((tx) =>
      tx.payrollLine.aggregate({ where: { payrollRunId: runId as string }, _sum: { grossPay: true, netPay: true }, _count: true }),
    );
    summary.push(
      `${key}: ${totals._count} payslips, gross ${Number(totals._sum.grossPay ?? 0).toFixed(2)}, net ${Number(totals._sum.netPay ?? 0).toFixed(2)}, paid ${paidOn}`,
    );
  }

  await prisma.$disconnect();

  console.log('\nHR UAT seed complete.');
  for (const line of summary) console.log(`  ${line}`);
  console.log(`
  Test accounts (password: ${PASSWORD})
    owner            owner@${DOMAIN}      Dr Aisyah Rahman — runs and approves payroll
    clinic manager   manager@${DOMAIN}    Rohana Yusof — approves leave, claims and overtime
    doctor (portal)  resident@${DOMAIN}   Dr Meera Kaur — RM9,500, Doctors rule set
    nurse (portal)   nurse@${DOMAIN}      Puteri Balqis — RM3,400, statutory rule set
    staff (portal)   stock@${DOMAIN}      Hafiz Osman — RM2,900, within the First Schedule
  Checklist: docs/HR_UAT_CHECKLIST.md
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
