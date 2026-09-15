import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * THE CLINIC MANAGER — UAT finding 2.
 *
 * The owner's clinic manager could not press Approve on a leave request. She
 * held `HR_STAFF`, which approves nothing on purpose — it models a records
 * clerk — while the seed's own documentation described her as approving leave,
 * claims and overtime. The job existed; it had no role.
 *
 * `CLINIC_MANAGER` is that job, and what it does NOT hold is the point of it:
 * no salary, nothing from payroll. This file is the boundary.
 */
describe('the clinic manager (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let manager: string;
  let clerk: string;
  let clinicId: string;
  let claimantId: string;
  let claimId: string;

  const server = () => app.getHttpServer();

  /*
   * WHAT THE BROWSER IS TOLD, which is a different question from what a token
   * can do — and the one this file was not asking.
   *
   * Every other test here mints a bearer that already carries CLINIC_MANAGER
   * and proves the endpoints behave. Staging then found the clinic manager
   * unable to press Approve, with all of those tests green: the role was right,
   * the account simply did not hold it, and nothing here would ever have
   * noticed because no test went near a real sign-in.
   *
   * The screen does not read the token. It reads `staff.permissions` from the
   * login payload (`useCan` in the web app) and disables what is not in it. So
   * the chain that actually decides whether the button is alive — hire someone
   * as a clinic manager, sign in as them, read the array — is tested here, end
   * to end, with nothing minted by hand.
   */
  const signInAs = async (role: Role, fullName: string) => {
    const email = `${crypto.randomUUID().slice(0, 8)}@manager-uat.kuwick.invalid`;
    const password = 'ManagerUat!2026';
    await request(server())
      .post('/workforce/employees')
      .set('Authorization', owner)
      .send({ fullName, role, clinicId, position: 'Clinic manager', loginEmail: email, loginPassword: password })
      .expect(201);
    const login = await request(server()).post('/auth/login').send({ email, password }).expect(201);
    return login.body.staff?.permissions as string[] | undefined;
  };

  const staffWithRole = async (role: Role, fullName: string) => {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role, fullName, clinicId } }),
    );
    // The role rides in the token, so the bearer has to be minted with it.
    return { id: staff.id, bearer: bearerFor(tenantId, staff.id, role) };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Manager Tenant' } }));
    owner = (await createOwnerAndBearer(prisma, tenantId)).bearer;

    const clinic = await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'Floor' }).expect(201);
    clinicId = clinic.body.id;

    manager = (await staffWithRole(Role.CLINIC_MANAGER, 'Rohana Yusof')).bearer;
    clerk = (await staffWithRole(Role.HR_STAFF, 'Records Clerk')).bearer;

    const claimant = await staffWithRole(Role.FRONT_DESK_CLINICAL_STAFF, 'Puteri Balqis');
    claimantId = claimant.id;
    await request(server())
      .post(`/workforce/employees/${claimantId}`)
      .set('Authorization', owner)
      .send({
        employeeNo: 'PB-1',
        position: 'Nurse',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1995-05-05',
      })
      .expect(201);

    const claim = await request(server())
      .post('/workforce/claims')
      .set('Authorization', owner)
      .send({ staffId: claimantId, category: 'MEDICAL', claimDate: '2026-09-02', amountClaimed: '180.00', description: 'Dental' })
      .expect(201);
    claimId = claim.body.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('what the job needs', () => {
    it('decides a staff expense claim, which used to take the payroll permission', async () => {
      const res = await request(server())
        .post(`/workforce/claims/${claimId}/decide`)
        .set('Authorization', manager)
        .send({ decision: 'APPROVED', amountApproved: '180.00', paymentRoute: 'PAYROLL' })
        .expect(201);
      expect(res.body.status).toBe('APPROVED');
    });

    it('opens HR and reads the timesheet', async () => {
      await request(server())
        .get('/workforce/attendance/timesheet?from=2026-09-01&to=2026-09-30')
        .set('Authorization', manager)
        .expect(200);
    });
  });

  describe('what the job must NOT reach — the reason the role exists', () => {
    it('cannot see what anybody earns', async () => {
      // `hr.salary.view` is withheld deliberately: somebody has to decide the
      // leave and the receipts every week, and that person does not have to
      // know the doctor's salary.
      await request(server()).get(`/workforce/employees/${claimantId}/salary`).set('Authorization', manager).expect(403);
    });

    it('cannot approve a payroll run', async () => {
      const run = await request(server())
        .post('/workforce/payroll/runs')
        .set('Authorization', owner)
        .send({ period: '2026-09', clinicId })
        .expect(201);
      await request(server())
        .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
        .set('Authorization', manager)
        .send({})
        .expect(403);
    });

    it('cannot settle a claim through Finance, because that is money leaving', async () => {
      // Deciding a receipt and paying it are different acts, and only the
      // first one moved to `hr.claim.approve`.
      await request(server())
        .post(`/workforce/claims/${claimId}/settle`)
        .set('Authorization', manager)
        .send({ financeReference: 'PV-2026-09-001' })
        .expect(403);
    });
  });

  describe('the records clerk is unchanged', () => {
    it('still approves nothing, which is what HR_STAFF is for', async () => {
      const second = await request(server())
        .post('/workforce/claims')
        .set('Authorization', owner)
        .send({ staffId: claimantId, category: 'MEAL', claimDate: '2026-09-03', amountClaimed: '40.00', description: 'Meal' })
        .expect(201);
      await request(server())
        .post(`/workforce/claims/${second.body.id}/decide`)
        .set('Authorization', clerk)
        .send({ decision: 'APPROVED', amountApproved: '40.00', paymentRoute: 'PAYROLL' })
        .expect(403);
    });
  });

  describe('the owner loses nothing', () => {
    it('still decides claims, because the split added a permission rather than moving one away', async () => {
      const third = await request(server())
        .post('/workforce/claims')
        .set('Authorization', owner)
        .send({ staffId: claimantId, category: 'TRAVEL', claimDate: '2026-09-04', amountClaimed: '25.00', description: 'Parking' })
        .expect(201);
      await request(server())
        .post(`/workforce/claims/${third.body.id}/decide`)
        .set('Authorization', owner)
        .send({ decision: 'REJECTED', reason: 'Not reimbursable.' })
        .expect(201);
    });
  });

  /*
   * THE GAP UAT FOUND, pinned so it cannot reopen quietly.
   */
  it('publishes the two approvals to the browser when somebody is hired as a clinic manager', async () => {
    const permissions = await signInAs(Role.CLINIC_MANAGER, 'Rohana Yusof Two');

    // Absent would mean "fall back and render everything", which is how a
    // stale session behaves — not what a fresh sign-in may do.
    expect(Array.isArray(permissions)).toBe(true);

    // These two are the Approve and Reject buttons on Leave and on Claims.
    expect(permissions).toContain('hr.leave.approve');
    expect(permissions).toContain('hr.claim.approve');
    expect(permissions).toContain('hr.view');

    // And the withholding is published too, so the screens that must stay shut
    // are shut before the click rather than after it.
    expect(permissions).not.toContain('hr.salary.view');
    expect(permissions).not.toContain('hr.payroll.view');
    expect(permissions).not.toContain('hr.payroll.approve');
  });

  it('publishes no approval at all to a records clerk, through the same door', async () => {
    const permissions = await signInAs(Role.HR_STAFF, 'Records Clerk Two');
    expect(permissions).toContain('hr.view');
    expect(permissions).not.toContain('hr.leave.approve');
    expect(permissions).not.toContain('hr.claim.approve');
  });
});
