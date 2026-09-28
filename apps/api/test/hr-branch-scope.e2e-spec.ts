import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

/**
 * THE BRANCH FILTER REACHES ATTENDANCE, AND EVERY HR READ BESIDE IT.
 *
 * With an empty branch selected, the Attendance screen still showed a doctor
 * from another branch and counted her as "1 on leave". The board behind the
 * HR landing page and the rail (`/workforce/today`) filtered its punches by
 * branch and then counted the whole tenant's leave, claims and correction
 * requests; the timesheet and the corrections queue took whatever branch a
 * request named and read the whole tenant when it named none; the leave
 * balances, the locum lists, the incentive runs and two of the reports had
 * the same shape. It is the hole `authorization-scope.e2e-spec.ts` closed on
 * the leave and claims queues, one screen along: the ACTION was authorised
 * and the BRANCH was not.
 *
 * Every read below now goes through the actor's scope. A branch outside it
 * is refused rather than answered empty, naming none means the branches the
 * account holds and never every branch there is, and a row reaches its branch
 * through the PERSON — which is how payroll already decides whose month a
 * branch is running.
 */
jest.setTimeout(120_000);

const KL = 'Asia/Kuala_Lumpur';
/** The date the board calls today: the clinic's, not the container's. */
const clinicToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: KL, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (isoDate: string, days: number) =>
  new Date(new Date(`${isoDate}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

type Named = { name?: string; staffName?: string; staff?: { fullName?: string } };
const names = (rows: Named[]) => rows.map((row) => row.name ?? row.staffName ?? row.staff?.fullName ?? '?').sort();

describe('the branch on the attendance board and the HR reads beside it (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let ownerStaffId: string;
  let clinicA: string;
  let clinicB: string;
  /** A clinic manager whose home branch is A: holds `hr.view`, and only branch A. */
  let managerA: string;
  /** The same, with `hr.payroll.view` granted directly — so a refusal on the locum payable is about the BRANCH, not the permission. */
  let payrollManagerA: string;
  let inA: string;
  let inB: string;
  let employerId: string;
  const today = clinicToday();
  const week = `from=${shift(today, -1)}&to=${shift(today, 1)}`;

  const server = () => app.getHttpServer();
  const get = (path: string, as?: string) => request(server()).get(path).set('Authorization', as ?? owner);
  /** One row per transaction: the test helper's transaction has Prisma's five-second budget. */
  const row = <T>(write: (tx: Prisma.TransactionClient) => Promise<T>) => withTenantContext(prisma, tenantId, write);

  /** One person per branch, with one of everything the board and the reads count. */
  async function person(name: string, clinicId: string) {
    const created = await request(server())
      .post('/workforce/employees')
      .set('Authorization', owner)
      .send({
        fullName: name,
        role: Role.FRONT_DESK_CLINICAL_STAFF,
        clinicId,
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        startDate: '2025-01-01',
        dateOfBirth: '1990-01-01',
      })
      .expect(201);
    const staffId = created.body.staff.id as string;

    // Approved leave covering today, and one still waiting for a decision.
    const leave = await request(server())
      .post('/leave-requests')
      .set('Authorization', owner)
      .send({ staffId, leaveType: 'ANNUAL', startDate: shift(today, -1), endDate: shift(today, 1), reason: 'Away this week' })
      .expect(201);
    await request(server()).patch(`/leave-requests/${leave.body.id}/approve`).set('Authorization', owner).send({}).expect(200);
    await request(server())
      .post('/leave-requests')
      .set('Authorization', owner)
      .send({ staffId, leaveType: 'ANNUAL', startDate: shift(today, 30), endDate: shift(today, 31), reason: 'Next month' })
      .expect(201);

    // A claim waiting for a decision, and one decided — the report lists decided claims only.
    await request(server())
      .post('/workforce/claims')
      .set('Authorization', owner)
      .send({ staffId, category: 'TRAVEL', amountClaimed: '80.00', claimDate: today, description: `Mileage for ${name}` })
      .expect(201);
    const decided = await request(server())
      .post('/workforce/claims')
      .set('Authorization', owner)
      .send({ staffId, category: 'TRAVEL', amountClaimed: '50.00', claimDate: today, description: `Parking for ${name}` })
      .expect(201);
    const decision = await request(server())
      .post(`/workforce/claims/${decided.body.id}/decide`)
      .set('Authorization', owner)
      .send({ decision: 'APPROVED', amountApproved: '50.00', paymentRoute: 'FINANCE' });
    expect([200, 201]).toContain(decision.status);

    // On the floor today with a correction waiting; a locum session this
    // month; an incentive run for the branch; a year-to-date month.
    const record = await row((tx) =>
      tx.attendanceRecord.create({
        data: { tenantId, staffId, clinicId, workDate: new Date(`${today}T00:00:00.000Z`), clockInAt: new Date(), status: 'PRESENT' },
      }),
    );
    await row((tx) =>
      tx.attendanceCorrectionRequest.create({
        data: { tenantId, staffId, attendanceRecordId: record.id, reason: 'Forgot to clock out yesterday' },
      }),
    );
    await row((tx) =>
      tx.locumSession.create({
        data: {
          tenantId,
          clinicId,
          staffId,
          sessionDate: new Date(`${today}T00:00:00.000Z`),
          sessionFee: '300.00',
          status: 'COMPLETED',
          createdByStaffId: ownerStaffId,
        },
      }),
    );
    await row((tx) =>
      tx.incentiveRun.create({
        data: { tenantId, clinicId, period: new Date('2026-08-01T00:00:00.000Z'), createdByStaffId: ownerStaffId },
      }),
    );
    await row((tx) =>
      tx.employeeYtd.create({
        data: { tenantId, legalEmployerId: employerId, staffId, taxYear: 2026, month: 1, grossCents: 300_000, createdByStaffId: ownerStaffId },
      }),
    );
    return staffId;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await row((tx) => tx.tenant.create({ data: { id: tenantId, name: 'Attendance Scope Tenant' } }));
    const account = await createOwnerAndBearer(prisma, tenantId);
    owner = account.bearer;
    ownerStaffId = account.staffId;

    clinicA = (await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'Branch A' }).expect(201)).body.id;
    clinicB = (await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'Branch B' }).expect(201)).body.id;

    const manager = await row((tx) =>
      tx.staff.create({ data: { tenantId, role: Role.CLINIC_MANAGER, fullName: 'Branch A Manager', clinicId: clinicA } }),
    );
    const payrollManager = await row((tx) =>
      tx.staff.create({ data: { tenantId, role: Role.CLINIC_MANAGER, fullName: 'Branch A Payroll Manager', clinicId: clinicA } }),
    );
    await row((tx) =>
      tx.staffPermissionGrant.create({
        data: { tenantId, staffId: payrollManager.id, permission: 'hr.payroll.view', grantedByStaffId: ownerStaffId, reason: 'Runs branch A payroll' },
      }),
    );
    managerA = bearerFor(tenantId, manager.id, Role.CLINIC_MANAGER);
    payrollManagerA = bearerFor(tenantId, payrollManager.id, Role.CLINIC_MANAGER);
    employerId = (await row((tx) => tx.legalEmployer.create({ data: { tenantId, name: 'Klinik Scope Sdn Bhd' } }))).id;

    inA = await person('Person A', clinicA);
    inB = await person('Person B', clinicB);
    // Both on the group's one company, so its employee count is a question of branch.
    for (const staffId of [inA, inB]) {
      await request(server())
        .patch(`/workforce/employees/${staffId}/legal-employer`)
        .set('Authorization', owner)
        .send({ legalEmployerId: employerId })
        .expect(200);
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  // -------------------------------------------------------------------------
  describe('the board behind the landing page and the rail', () => {
    it('counts the named branch only: on leave, on duty, waiting leave, claims and corrections', async () => {
      const board = (await get(`/workforce/today?clinicId=${clinicA}`).expect(200)).body;
      expect(names(board.onLeave)).toEqual(['Person A']);
      expect(names(board.onDuty)).toEqual(['Person A']);
      expect(board.pendingLeaveApprovals).toBe(1);
      expect(board.pendingClaims).toBe(1);
      expect(board.pendingAttendanceCorrections).toBe(1);
    });

    it('still answers for every branch the account holds when none is named', async () => {
      // Non-vacuous the other way: both people really are there, so the case
      // above is a filter working and not an empty database.
      const board = (await get('/workforce/today').expect(200)).body;
      expect(names(board.onLeave)).toEqual(['Person A', 'Person B']);
      expect(names(board.onDuty)).toEqual(['Person A', 'Person B']);
      expect(board.pendingLeaveApprovals).toBe(2);
      expect(board.pendingClaims).toBe(2);
      expect(board.pendingAttendanceCorrections).toBe(2);
    });

    it('REFUSES a branch the account does not hold, and narrows to its own when none is named', async () => {
      await get(`/workforce/today?clinicId=${clinicB}`, managerA).expect(403);
      const own = (await get('/workforce/today', managerA).expect(200)).body;
      expect(names(own.onLeave)).toEqual(['Person A']);
      expect(own.pendingLeaveApprovals).toBe(1);
      expect(own.pendingClaims).toBe(1);
      expect(own.pendingAttendanceCorrections).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('the timesheet and the corrections queue', () => {
    const day = `from=${today}&to=${today}`;

    it('list the named branch’s people', async () => {
      const sheet = (await get(`/workforce/attendance/timesheet?${day}&clinicId=${clinicA}`).expect(200)).body;
      expect(names(sheet.staff)).toEqual(['Person A']);
      const queue = (await get(`/workforce/attendance/corrections?clinicId=${clinicA}`).expect(200)).body;
      expect(names(queue)).toEqual(['Person A']);
    });

    it('REFUSE a branch the account does not hold, rather than answering empty', async () => {
      // An empty answer for a branch you may not see is indistinguishable
      // from "nobody punched", which is how a scope hole hides.
      await get(`/workforce/attendance/timesheet?${day}&clinicId=${clinicB}`, managerA).expect(403);
      await get(`/workforce/attendance/corrections?clinicId=${clinicB}`, managerA).expect(403);
    });

    it('do not hand a branch-scoped account the other branch by leaving the branch off', async () => {
      const sheet = (await get(`/workforce/attendance/timesheet?${day}`, managerA).expect(200)).body;
      expect(names(sheet.staff)).toEqual(['Person A']);
      const queue = (await get('/workforce/attendance/corrections', managerA).expect(200)).body;
      expect(names(queue)).toEqual(['Person A']);
    });

    /*
     * THROUGH THE PERSON. A punch HR entered while the wrong branch was
     * selected carries that branch on the record; it is still Person B's day,
     * and Person B works at branch B — which is where payroll will look for it.
     */
    it('reach the branch through the person, not through where a punch was stamped', async () => {
      await row((tx) => tx.attendanceRecord.updateMany({ where: { staffId: inB }, data: { clinicId: clinicA } }));
      const sheetA = (await get(`/workforce/attendance/timesheet?${day}&clinicId=${clinicA}`).expect(200)).body;
      expect(names(sheetA.staff)).toEqual(['Person A']);
      const sheetB = (await get(`/workforce/attendance/timesheet?${day}&clinicId=${clinicB}`).expect(200)).body;
      expect(names(sheetB.staff)).toEqual(['Person B']);
    });
  });

  // -------------------------------------------------------------------------
  describe('leave balances, locum sessions and incentive runs', () => {
    it('answer for the named branch, and refuse one the account does not hold', async () => {
      const balances = (await get(`/workforce/leave/balances?clinicId=${clinicA}&year=2026`).expect(200)).body;
      expect(names(balances.employees)).toEqual(['Person A']);
      await get(`/workforce/leave/balances?clinicId=${clinicB}&year=2026`, managerA).expect(403);
      const ownBalances = (await get('/workforce/leave/balances?year=2026', managerA).expect(200)).body;
      expect(names(ownBalances.employees)).toEqual(['Person A']);

      const sessions = (await get(`/workforce/locum/sessions?clinicId=${clinicA}`).expect(200)).body;
      expect(names(sessions)).toEqual(['Person A']);
      await get(`/workforce/locum/sessions?clinicId=${clinicB}`, managerA).expect(403);
      expect(names((await get('/workforce/locum/sessions', managerA).expect(200)).body)).toEqual(['Person A']);

      const payable = (await get(`/workforce/locum/payable?${week}&clinicId=${clinicA}`).expect(200)).body;
      expect(names(payable.people)).toEqual(['Person A']);
      await get(`/workforce/locum/payable?${week}&clinicId=${clinicB}`, payrollManagerA).expect(403);
      expect(names((await get(`/workforce/locum/payable?${week}`, payrollManagerA).expect(200)).body.people)).toEqual(['Person A']);

      const runs = (await get(`/workforce/incentives/runs?clinicId=${clinicA}`).expect(200)).body;
      expect(runs.map((run: { clinicName: string }) => run.clinicName)).toEqual(['Branch A']);
      await get(`/workforce/incentives/runs?clinicId=${clinicB}`, managerA).expect(403);
      const ownRuns = (await get('/workforce/incentives/runs', managerA).expect(200)).body;
      expect(ownRuns.map((run: { clinicName: string }) => run.clinicName)).toEqual(['Branch A']);
    });
  });

  // -------------------------------------------------------------------------
  /*
   * NO "REFUSED BRANCH" CASE HERE, ON PURPOSE. `hr.payroll.export.reports`
   * belongs to the OWNER role alone, which also holds `settings.manage`, and
   * it is not individually grantable — so every account that can read these
   * two reports administers every branch. The branch on them is the filter
   * above the screen, applied through the same scope as everything else.
   */
  describe('the claims report and the year-to-date report', () => {
    it('list the named branch only', async () => {
      const claims = (await get(`/workforce/payroll/reports/claims?${week}&clinicId=${clinicA}`).expect(200)).body;
      expect(names(claims.rows)).toEqual(['Person A']);
      const ytd = (await get(`/workforce/payroll/reports/ytd?year=2026&clinicId=${clinicA}`).expect(200)).body;
      expect(names(ytd.rows)).toEqual(['Person A']);
    });

    it('still list every branch the account holds when none is named', async () => {
      expect(names((await get(`/workforce/payroll/reports/claims?${week}`).expect(200)).body.rows)).toEqual(['Person A', 'Person B']);
      expect(names((await get('/workforce/payroll/reports/ytd?year=2026').expect(200)).body.rows)).toEqual(['Person A', 'Person B']);
    });
  });

  // -------------------------------------------------------------------------
  // The employing companies, in Settings: the count on each card is of the
  // branch being looked at, because a manager of one branch reading "12
  // employees" on a company with 4 at their branch is reading the group.
  describe('the employing companies', () => {
    const count = (body: { name: string; employeeCount: number }[]) => body.find((row) => row.name === 'Klinik Scope Sdn Bhd')!.employeeCount;

    beforeAll(async () => {
      // Somebody who has LEFT branch A: on the company's books once, not employed by it now, so not counted.
      const left = await request(server())
        .post('/workforce/employees')
        .set('Authorization', owner)
        .send({ fullName: 'Person C (left)', role: Role.FRONT_DESK_CLINICAL_STAFF, clinicId: clinicA, position: 'Clinic Assistant', employmentType: 'PERMANENT', startDate: '2025-01-01', dateOfBirth: '1990-01-01' })
        .expect(201);
      const leftId = left.body.staff.id as string;
      await request(server()).patch(`/workforce/employees/${leftId}/legal-employer`).set('Authorization', owner).send({ legalEmployerId: employerId }).expect(200);
      const resigned = await request(server()).post(`/workforce/employees/${leftId}`).set('Authorization', owner).send({ employmentStatus: 'RESIGNED', endDate: '2026-06-30' });
      expect([200, 201]).toContain(resigned.status);
    });

    it('count the people the company employs now at the named branch — not the whole group, and not somebody who left', async () => {
      expect(count((await get(`/workforce/legal-employers?clinicId=${clinicA}`).expect(200)).body)).toBe(1);
      expect(count((await get('/workforce/legal-employers').expect(200)).body)).toBe(2);
    });

    it('count only the branch the account holds when none is named, and REFUSE one it does not', async () => {
      expect(count((await get('/workforce/legal-employers', managerA).expect(200)).body)).toBe(1);
      await get(`/workforce/legal-employers?clinicId=${clinicB}`, managerA).expect(403);
    });
  });
});
