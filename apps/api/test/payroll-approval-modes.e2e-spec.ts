import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

/**
 * WHO IS ALLOWED TO APPROVE PAYROLL.
 *
 * Separation of duties used to be a hard-coded rule with an undocumented
 * exception: the maker could not approve, unless they held `settings.manage`,
 * in which case they silently could. A group with a finance department and a
 * single-doctor clinic got the same rule and neither could see what it was.
 *
 * These tests drive all three modes through the HTTP surface, because a rule
 * that is only right in a unit test is a rule the server does not enforce.
 */
describe('payroll approval modes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let clinicId: string;
  let legalEmployerId: string;
  /** The account holder who runs the payroll. */
  let makerId: string;
  let maker: string;
  /** A second account holder, who did not run it. */
  let checkerId: string;
  let checker: string;
  /** A third, for dual approval. */
  let thirdId: string;
  let third: string;

  const PERIOD = '2026-08-01';
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

  async function accountHolder(name: string) {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.OWNER_ADMIN, fullName: name } }),
    );
    return { id: staff.id, bearer: bearerFor(tenantId, staff.id) };
  }

  async function employee(name: string, salary: string) {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId } }),
    );
    await request(server())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', maker)
      .send({
        employeeNo: `E-${Math.floor(Math.random() * 1000000)}`,
        position: 'Clinic Assistant',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1990-06-15',
      })
      .expect(201);
    // STATUTORY CLASSIFICATION IS A DATED RECORD, not a field on the employee
    // form: changing an EPF Part today used to change what an unapproved past
    // period computed.
    await request(server())
      .post(`/workforce/employees/${staff.id}/statutory-classification`)
      .set('Authorization', maker)
      .send({
        effectiveFrom: '2020-01-01',
        // Which Part of the EPF Third Schedule applies. Without it EPF is
        // unknown rather than nil, and an unknown blocks approval.
        epfMembership: 'MALAYSIAN_CITIZEN',
        // LINDUNG 24 JAM is voluntary for locals; unrecorded would block.
        lindungParticipation: 'NOT_PARTICIPATING',
        pcbApplicable: false,
        reason: 'Recorded at hire',
      })
      .expect(201);
    // The employing company. Statutory contributions are filed by an entity,
    // so an employee attached to none of them blocks approval.
    await request(server())
      .patch(`/workforce/employees/${staff.id}/legal-employer`)
      .set('Authorization', maker)
      .send({ legalEmployerId })
      .expect(200);
    await request(server())
      .post(`/workforce/employees/${staff.id}/salary`)
      .set('Authorization', maker)
      .send({ amount: salary, basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);
    return staff.id;
  }

  /** A calculated run, ready to approve, created by `maker`. */
  async function calculatedRun() {
    const run = await request(server())
      .post('/workforce/payroll/runs')
      .set('Authorization', maker)
      .send({ period: PERIOD, clinicId })
      .expect(201);
    await request(server())
      .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
      .set('Authorization', maker)
      .expect(200);
    return run.body.id as string;
  }

  const setMode = (
    body: { mode?: string; allowOwnerSelfApproval?: boolean },
    bearer = maker,
  ) => request(server()).put('/workforce/payroll/approval-policy').set('Authorization', bearer).send(body);

  const approve = (runId: string, bearer: string) =>
    request(server())
      .patch(`/workforce/payroll/runs/${runId}/approve`)
      .set('Authorization', bearer)
      .send({ acknowledgeStatutoryGap: true });

  beforeEach(async () => {
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Approval Modes Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    makerId = owner.staffId;
    maker = owner.bearer;

    const clinic = await request(server())
      .post('/clinics')
      .set('Authorization', maker)
      .send({ name: 'Branch A' })
      .expect(201);
    clinicId = clinic.body.id;
    const employer = await request(server())
      .post('/workforce/legal-employers')
      .set('Authorization', maker)
      .send({ name: `Approval Employer ${randomId().slice(0, 8)}` })
      .expect(201);
    legalEmployerId = employer.body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', maker).expect(201);

    const second = await accountHolder('Second Account Holder');
    checkerId = second.id;
    checker = second.bearer;
    const thirdHolder = await accountHolder('Third Account Holder');
    thirdId = thirdHolder.id;
    third = thirdHolder.bearer;

    await employee('Nurul Aina', '3000.00');
  });

  // -------------------------------------------------------------------------
  it('starts on the rule that was hard-coded before it was a setting, so upgrading changes nobody', async () => {
    const policy = await request(server())
      .get('/workforce/payroll/approval-policy')
      .set('Authorization', maker)
      .expect(200);
    expect(policy.body.mode).toBe('MAKER_CHECKER');
    expect(policy.body.allowOwnerSelfApproval).toBe(true);
    expect(policy.body.approvalsRequired).toBe(1);
    // The rule reads as a sentence, not a mode name.
    expect(policy.body.description).not.toMatch(/MAKER_CHECKER|maker|checker/i);
  });

  it('STANDARD lets the person who ran the payroll approve it', async () => {
    await setMode({ mode: 'STANDARD' }).expect(200);
    const runId = await calculatedRun();
    const approved = await approve(runId, maker).expect(200);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.approvalState).toMatchObject({ complete: true, given: 1, required: 1 });
  });

  it('MAKER_CHECKER with the owner allowance OFF refuses the person who ran it, and accepts a colleague', async () => {
    await setMode({ mode: 'MAKER_CHECKER', allowOwnerSelfApproval: false }).expect(200);
    const runId = await calculatedRun();

    const refused = await approve(runId, maker).expect(403);
    expect(refused.body.message).toMatch(/somebody other than the person who ran it/);
    // A refusal that does not say how to get past it is a dead end.
    expect(refused.body.message).toMatch(/Payroll settings/);

    const approved = await approve(runId, checker).expect(200);
    expect(approved.body.status).toBe('APPROVED');
  });

  it('MAKER_CHECKER with the owner allowance ON lets an account holder approve their own run, and records that it did', async () => {
    await setMode({ mode: 'MAKER_CHECKER', allowOwnerSelfApproval: true }).expect(200);
    const runId = await calculatedRun();
    await approve(runId, maker).expect(200);

    const rows = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollRunApproval.findMany({ where: { payrollRunId: runId } }),
    );
    expect(rows).toHaveLength(1);
    // The exemption is not silent any more: it is a column on the approval.
    expect(rows[0].usedOwnerSelfApproval).toBe(true);
    expect(rows[0].mode).toBe('MAKER_CHECKER');
  });

  describe('DUAL_APPROVAL', () => {
    beforeEach(async () => {
      await setMode({ mode: 'DUAL_APPROVAL', allowOwnerSelfApproval: false }).expect(200);
    });

    it('does NOT approve on one approval — the run stays open and says who is still needed', async () => {
      const runId = await calculatedRun();
      const first = await approve(runId, checker).expect(200);
      expect(first.body.status).toBe('CALCULATED');
      expect(first.body.approvalState).toMatchObject({ complete: false, given: 1, required: 2 });
      expect(first.body.approvalState.message).toMatch(/two approvals/);

      // Nothing locked, and no snapshot was taken for a run one person saw.
      const snapshots = await withTenantContext(prisma, tenantId, (tx) =>
        tx.payrollSnapshot.findMany({ where: { payrollRunId: runId } }),
      );
      expect(snapshots).toHaveLength(0);
    });

    it('approves on the second approval by a DIFFERENT person', async () => {
      const runId = await calculatedRun();
      await approve(runId, checker).expect(200);
      const second = await approve(runId, third).expect(200);
      expect(second.body.status).toBe('APPROVED');
      expect(second.body.approvalState).toMatchObject({ complete: true, given: 2, required: 2 });

      const rows = await withTenantContext(prisma, tenantId, (tx) =>
        tx.payrollRunApproval.findMany({ where: { payrollRunId: runId }, orderBy: { sequence: 'asc' } }),
      );
      expect(rows.map((r) => r.staffId)).toEqual([checkerId, thirdId]);
      // The run's own approver field names whoever COMPLETED it.
      const run = await withTenantContext(prisma, tenantId, (tx) =>
        tx.payrollRun.findFirstOrThrow({ where: { id: runId } }),
      );
      expect(run.approvedByStaffId).toBe(thirdId);
    });

    /*
     * THE ONE THAT MATTERS. Two approvals from one person is one approval, and
     * a rule that let it through would be theatre.
     */
    it('REFUSES the same person approving twice', async () => {
      const runId = await calculatedRun();
      await approve(runId, checker).expect(200);
      const again = await approve(runId, checker).expect(403);
      expect(again.body.message).toMatch(/already approved/);

      const run = await withTenantContext(prisma, tenantId, (tx) =>
        tx.payrollRun.findFirstOrThrow({ where: { id: runId } }),
      );
      expect(run.status).toBe('CALCULATED');
    });

    it('still refuses the person who ran it as either approver', async () => {
      const runId = await calculatedRun();
      await approve(runId, maker).expect(403);
      await approve(runId, checker).expect(200);
      await approve(runId, maker).expect(403);
    });
  });

  // -------------------------------------------------------------------------
  it('says out loud when the chosen rule cannot actually take effect', async () => {
    // Everybody who can approve payroll is an account holder, and account
    // holders are exempt — so this rule changes nothing, and the screen has to
    // say so rather than letting the clinic believe two people are checking.
    await setMode({ mode: 'DUAL_APPROVAL', allowOwnerSelfApproval: true }).expect(200);
    const policy = await request(server())
      .get('/workforce/payroll/approval-policy')
      .set('Authorization', maker)
      .expect(200);
    expect(policy.body.inert.length).toBeGreaterThan(0);
    expect(policy.body.inert.join(' ')).toMatch(/will not change who can approve/);

    // Turned off, the rule bites and there is nothing to warn about.
    await setMode({ allowOwnerSelfApproval: false }).expect(200);
    const honest = await request(server())
      .get('/workforce/payroll/approval-policy')
      .set('Authorization', maker)
      .expect(200);
    expect(honest.body.inert).toEqual([]);
    expect(honest.body.approvers.total).toBe(3);
  });

  it('names the limits of the rule rather than letting a clinic assume otherwise', async () => {
    const policy = await request(server())
      .get('/workforce/payroll/approval-policy')
      .set('Authorization', maker)
      .expect(200);
    const limits = (policy.body.limits as string[]).join(' ');
    expect(limits).toMatch(/Nobody is notified/);
    expect(limits).toMatch(/does not vary by amount/);
    expect(limits).toMatch(/Only an account holder can approve payroll/);
  });

  it('records the rule change with the rule it replaced', async () => {
    await setMode({ mode: 'DUAL_APPROVAL' }).expect(200);
    const audit = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.findMany({ where: { tenantId, action: 'payrollApprovalPolicy.changed' } }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].before).toMatchObject({ mode: 'MAKER_CHECKER' });
    expect(audit[0].after).toMatchObject({ mode: 'DUAL_APPROVAL' });
  });

  it('shows the run itself who has approved and whether this reader may', async () => {
    await setMode({ mode: 'DUAL_APPROVAL', allowOwnerSelfApproval: false }).expect(200);
    const runId = await calculatedRun();
    await approve(runId, checker).expect(200);

    // The person who ran it sees why they cannot approve, before pressing.
    const asMaker = await request(server())
      .get(`/workforce/payroll/runs/${runId}/journey`)
      .set('Authorization', maker)
      .expect(200);
    expect(asMaker.body.approval.required).toBe(2);
    expect(asMaker.body.approval.given).toHaveLength(1);
    expect(asMaker.body.approval.given[0].name).toBe('Second Account Holder');
    expect(asMaker.body.approval.youMayApprove).toBe(false);
    expect(asMaker.body.approval.whyNot).toMatch(/somebody other than the person who ran it/);

    // The third account holder sees a button that will actually work.
    const asThird = await request(server())
      .get(`/workforce/payroll/runs/${runId}/journey`)
      .set('Authorization', third)
      .expect(200);
    expect(asThird.body.approval.youMayApprove).toBe(true);
    expect(asThird.body.approval.completesTheRun).toBe(true);
  });

  it('clears the approvals when a run is reopened, so a correction is signed off again from the start', async () => {
    // THE CONTROL THIS PROTECTS. Approvals used to survive a reopen, and under
    // DUAL_APPROVAL the two existing sign-offs then counted toward the
    // CORRECTED run — so a payroll could be changed after approval and reach
    // APPROVED again with nobody having looked at the change. The second pair
    // of eyes was bypassed by the very workflow meant to preserve it.
    await setMode({ mode: 'DUAL_APPROVAL' }).expect(200);
    const runId = await calculatedRun();
    await approve(runId, maker).expect(200);
    const second = await accountHolder('Second Approver');
    await approve(runId, second.bearer).expect(200);

    const approvedRun = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollRun.findUniqueOrThrow({ where: { id: runId } }),
    );
    expect(approvedRun.status).toBe('APPROVED');

    await request(server())
      .patch(`/workforce/payroll/runs/${runId}/reopen`)
      .set('Authorization', maker)
      .send({ reason: 'An allowance was keyed against the wrong month' })
      .expect(200);

    const held = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollRunApproval.findMany({ where: { payrollRunId: runId } }),
    );
    expect(held).toHaveLength(0);

    // So the corrected run needs BOTH signatures again, not nought and not one.
    await request(server())
      .patch(`/workforce/payroll/runs/${runId}/calculate`)
      .set('Authorization', maker)
      .expect(200);
    const first = await approve(runId, maker).expect(200);
    expect(first.body.approvalState).toMatchObject({ complete: false, given: 1, required: 2 });
    const finished = await approve(runId, second.bearer).expect(200);
    expect(finished.body.approvalState).toMatchObject({ complete: true, given: 2, required: 2 });
  });
});
