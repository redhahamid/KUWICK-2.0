import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

/**
 * CAN THIS ACCOUNT REACH THAT BRANCH?
 *
 * The Stage 2.5 audit found sixteen call sites that took a branch id from the
 * caller and passed it into Prisma unchecked, and three services with no
 * authorisation call of any kind. `requirePermission` authorised the ACTION;
 * nothing authorised the BRANCH. A staff member scoped to one branch could
 * append `?clinicId=<the other one>` and read it.
 *
 * These are NEGATIVE tests: each one asserts a refusal, against a real
 * database, a real signed token and the real RLS role. A unit test with a
 * stubbed scope cannot prove any of this — the whole failure mode was that
 * the check was absent from the wiring rather than wrong in the logic.
 */
describe('branch authorization (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;

  /** The account holder: administers every branch. */
  let owner: string;
  /** Scoped to branch A only. */
  let branchAStaff: string;
  let clinicA: string;
  let clinicB: string;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Scope Tenant' } }),
    );
    owner = (await createOwnerAndBearer(prisma, tenantId)).bearer;

    const a = await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'Branch A' }).expect(201);
    const b = await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'Branch B' }).expect(201);
    clinicA = a.body.id;
    clinicB = b.body.id;

    // A front-desk account whose home branch is A. It holds the VIEW
    // permissions below; what it does not hold is any claim on branch B.
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Branch A Front Desk', clinicId: clinicA },
      }),
    );
    branchAStaff = bearerFor(tenantId, staff.id, Role.FRONT_DESK_CLINICAL_STAFF);
  });

  // -------------------------------------------------------------------------
  describe('a branch-scoped account cannot read another branch', () => {
    it('REFUSES a reports request that names a branch it does not hold', async () => {
      const refused = await request(server())
        .get(`/reports/sales?from=2026-01-01&to=2026-12-31&clinicId=${clinicB}`)
        .set('Authorization', branchAStaff);
      // Either not authorised for the action at all, or not for that branch.
      // What must NOT happen is a 200 carrying branch B's revenue.
      expect(refused.status).toBeGreaterThanOrEqual(400);
    });

    it('REFUSES an attendance request that names a branch it does not hold', async () => {
      // The canonical timesheet — real punches against the roster. The old
      // visit-derived `/attendance` this used to call was retired: two screens
      // labelled attendance, answering different questions from different
      // tables, is how they come to disagree.
      const refused = await request(server())
        .get(`/workforce/attendance/timesheet?from=2026-08-01&to=2026-08-31&clinicId=${clinicB}`)
        .set('Authorization', branchAStaff);
      expect(refused.status).toBeGreaterThanOrEqual(400);
    });

    it('REFUSES a stock read that names a branch it does not hold', async () => {
      const refused = await request(server())
        .get(`/stock/levels?clinicId=${clinicB}`)
        .set('Authorization', branchAStaff);
      expect(refused.status).toBeGreaterThanOrEqual(400);
    });

    /*
     * THE WRITE PATH. Reading another branch is a leak; writing to one is a
     * corruption — stock posted into a branch that never held it.
     */
    it('REFUSES a stock adjustment posted into a branch it does not hold', async () => {
      const refused = await request(server())
        .post('/stock/adjust')
        .set('Authorization', branchAStaff)
        .send({ clinicId: clinicB, itemId: randomId(), quantity: 5, reason: 'Should never post' });
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(refused.status).not.toBe(201);
    });
  });

  describe('the account holder administers every branch', () => {
    it('may name either branch', async () => {
      for (const clinicId of [clinicA, clinicB]) {
        await request(server())
          .get(`/workforce/attendance/timesheet?from=2026-08-01&to=2026-08-31&clinicId=${clinicId}`)
          .set('Authorization', owner)
          .expect(200);
      }
    });

    it('reading with no branch named returns every branch it may manage', async () => {
      await request(server())
        .get('/workforce/attendance/timesheet?from=2026-08-01&to=2026-08-31')
        .set('Authorization', owner)
        .expect(200);
    });
  });

  /*
   * "ALL BRANCHES" MEANS ALL BRANCHES THIS ACTOR MAY MANAGE.
   *
   * The dangerous shape was an omitted parameter reading as "no filter", which
   * handed a scoped account the whole tenant. Leaving the parameter off must
   * narrow to the actor's own branches, not widen to everybody's.
   */
  describe('omitting the branch does not widen the answer', () => {
    it('does not hand a branch-scoped account the whole tenant', async () => {
      const response = await request(server())
        .get('/stock/levels')
        .set('Authorization', branchAStaff);
      if (response.status === 200) {
        const rows = response.body as { clinicId: string }[];
        // Whatever came back is branch A's, never branch B's.
        expect(rows.every((row) => row.clinicId !== clinicB)).toBe(true);
      } else {
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    });
  });

  // -------------------------------------------------------------------------
  /*
   * THE LEAVE QUEUE AND THE CLAIMS QUEUE ARE BRANCH READS TOO.
   *
   * Both listed the whole tenant: leave filtered on `staffId` and `status` and
   * nothing else, claims checked the permission and then read every row. The
   * branch filter above them did nothing, so a clinic that had just created an
   * empty branch and switched to it was shown other branches' staff on those
   * two screens while Employees, Attendance, Payroll and Reports all correctly
   * showed nothing. Both reach their branch through the PERSON — a leave
   * request has no branch column at all, and a claim's is nullable and left
   * null by the ordinary create — so that is where the scope belongs.
   */
  describe('the leave and claims queues answer for one branch', () => {
    let inA: string;
    let inB: string;
    /*
     * A CLINIC MANAGER, HOME BRANCH A. The front-desk account above does not
     * hold `hr.view` at all, so a refusal to it proves the permission and says
     * nothing about the SCOPE — which is what these cases are about. This
     * account may open HR, and may open it only for branch A.
     */
    let branchAManager: string;

    const person = async (name: string, clinicId: string) => {
      // Through the endpoint, because a claim needs an EMPLOYMENT record and a
      // bare staff row has none — `create` answers 404 for one.
      const created = await request(server())
        .post('/workforce/employees')
        .set('Authorization', owner)
        .send({
          fullName: name,
          role: Role.FRONT_DESK_CLINICAL_STAFF,
          clinicId,
          position: 'Clinic Assistant',
          startDate: '2024-01-01',
        })
        .expect(201);
      const staff = { id: created.body.staff.id as string };
      await request(server())
        .post('/leave-requests')
        .set('Authorization', owner)
        .send({ staffId: staff.id, leaveType: 'ANNUAL', startDate: '2026-09-10', endDate: '2026-09-11' })
        .expect(201);
      await request(server())
        .post('/workforce/claims')
        .set('Authorization', owner)
        .send({
          staffId: staff.id,
          category: 'TRAVEL',
          amountClaimed: '80.00',
          claimDate: '2026-09-10',
          description: `Mileage for ${name}`,
        })
        .expect(201);
      return staff.id;
    };

    const namesOn = async (path: string, clinicId?: string) => {
      const query = clinicId ? `${path}${path.includes('?') ? '&' : '?'}clinicId=${clinicId}` : path;
      const answer = await request(server()).get(query).set('Authorization', owner).expect(200);
      return (answer.body as Record<string, unknown>[])
        .map((row) => (row.staffName as string) ?? ((row.staff as { fullName?: string } | undefined)?.fullName ?? '?'))
        .sort();
    };

    beforeEach(async () => {
      inA = await person('Leave Person A', clinicA);
      inB = await person('Leave Person B', clinicB);
      const manager = await withTenantContext(prisma, tenantId, (tx) =>
        tx.staff.create({
          data: { tenantId, role: Role.CLINIC_MANAGER, fullName: 'Branch A Manager', clinicId: clinicA },
        }),
      );
      branchAManager = bearerFor(tenantId, manager.id, Role.CLINIC_MANAGER);
    });

    it('lists only the named branch, on both queues', async () => {
      expect(await namesOn('/leave-requests', clinicA)).toEqual(['Leave Person A']);
      expect(await namesOn('/leave-requests', clinicB)).toEqual(['Leave Person B']);
      expect(await namesOn('/workforce/claims', clinicA)).toEqual(['Leave Person A']);
      expect(await namesOn('/workforce/claims', clinicB)).toEqual(['Leave Person B']);
    });

    it('still answers for every branch the account holds when none is named', async () => {
      // Non-vacuous the other way: the rows really are both there, so the
      // case above is a filter working and not an empty database.
      expect(await namesOn('/leave-requests')).toEqual(['Leave Person A', 'Leave Person B']);
      expect(await namesOn('/workforce/claims')).toEqual(['Leave Person A', 'Leave Person B']);
      expect({ inA: Boolean(inA), inB: Boolean(inB) }).toEqual({ inA: true, inB: true });
    });

    it('REFUSES a branch the account does not hold, rather than answering empty', async () => {
      // An empty answer for a branch you may not see is indistinguishable
      // from "that branch has no leave", which is how a scope hole hides.
      await request(server())
        .get(`/leave-requests?clinicId=${clinicB}`)
        .set('Authorization', branchAManager)
        .expect(403);
      await request(server())
        .get(`/workforce/claims?clinicId=${clinicB}`)
        .set('Authorization', branchAManager)
        .expect(403);
      // And it is the BRANCH being refused, not the module: its own branch answers.
      await request(server())
        .get(`/leave-requests?clinicId=${clinicA}`)
        .set('Authorization', branchAManager)
        .expect(200);
      await request(server())
        .get(`/workforce/claims?clinicId=${clinicA}`)
        .set('Authorization', branchAManager)
        .expect(200);
    });

    it('does not hand a branch-scoped account the other branch by leaving the branch off', async () => {
      const leave = await request(server()).get('/leave-requests').set('Authorization', branchAManager).expect(200);
      const claims = await request(server()).get('/workforce/claims').set('Authorization', branchAManager).expect(200);
      expect((leave.body as { staff?: { fullName?: string } }[]).map((row) => row.staff?.fullName)).toEqual([
        'Leave Person A',
      ]);
      expect((claims.body as { staffName: string }[]).map((row) => row.staffName)).toEqual(['Leave Person A']);
    });
  });

  describe('payroll authority is not granted by an action permission', () => {
    it('REFUSES approval from an account without the approve permission', async () => {
      const run = await request(server())
        .post('/workforce/payroll/runs')
        .set('Authorization', owner)
        .send({ period: '2026-08-01', clinicId: clinicA })
        .expect(201);

      const refused = await request(server())
        .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
        .set('Authorization', branchAStaff)
        .send({ acknowledgeStatutoryGap: true });
      expect(refused.status).toBe(403);
    });
  });

  describe('salary is confidential to accounts that may read pay', () => {
    it('does not expose salary or bank details on the ordinary HR read', async () => {
      const staff = await withTenantContext(prisma, tenantId, (tx) =>
        tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Paid Person', clinicId: clinicA } }),
      );
      await request(server())
        .post(`/workforce/employees/${staff.id}`)
        .set('Authorization', owner)
        .send({ employeeNo: 'E-1', position: 'Nurse', employmentStatus: 'ACTIVE', startDate: '2024-01-01', dateOfBirth: '1990-01-01' })
        .expect(201);
      await request(server())
        .post(`/workforce/employees/${staff.id}/salary`)
        .set('Authorization', owner)
        .send({ amount: '4000', basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
        .expect(201);

      const ordinary = await request(server())
        .get(`/workforce/employees/${staff.id}`)
        .set('Authorization', owner)
        .expect(200);
      expect(ordinary.body.basicSalary).toBeUndefined();
      expect(ordinary.body.bankAccountNo).toBeUndefined();

      // And the pay-gated read is refused outright to an account without it.
      const refused = await request(server())
        .get(`/workforce/employees/${staff.id}/payroll-detail`)
        .set('Authorization', branchAStaff);
      expect(refused.status).toBe(403);
    });
  });
});
