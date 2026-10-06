import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * ADDITIONAL PCB EACH MONTH — recorded on the standing, added to the computed
 * figure, never to a hand-entered one.
 *
 * A CP38 direction from LHDN, or an employee asking for more tax to be
 * withheld, is a fact about the person from a date, so it lives on the dated
 * statutory standing beside the tax category. The run adds it to the MTD it
 * computed, carries it in the PCB line (so next month's year-to-date counts
 * it as tax already paid, which it is), and says so in the payslip note. A
 * PCB figure typed by hand is the month's whole figure and gets nothing added.
 */
describe('Additional PCB each month (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let employerId: string;
  let bettyId: string;
  let carlId: string;

  const server = () => app.getHttpServer();
  const JUNE = '2026-06';
  const JULY = '2026-07';

  const lineOf = async (runId: string, staffId: string) =>
    withTenantContext(prisma, tenantId, (tx) => tx.payrollLine.findFirst({ where: { payrollRunId: runId, staffId } }));
  const runMonth = async (period: string) => {
    const run = await request(server()).post('/workforce/payroll/runs').set('Authorization', bearer).send({ period, clinicId }).expect(201);
    await request(server()).patch(`/workforce/payroll/runs/${run.body.id}/calculate`).set('Authorization', bearer).expect(200);
    return run.body.id as string;
  };
  const standing = (staffId: string, body: Record<string, unknown>) =>
    request(server()).post(`/workforce/employees/${staffId}/statutory-classification`).set('Authorization', bearer).send(body);

  const hire = async (name: string, employeeNo: string) => {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId } }),
    );
    await request(server())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({ employeeNo, position: 'Clinic Assistant', employmentType: 'PERMANENT', employmentStatus: 'ACTIVE', startDate: '2024-01-01', dateOfBirth: '1993-03-03' })
      .expect(201);
    await request(server()).patch(`/workforce/employees/${staff.id}/legal-employer`).set('Authorization', bearer).send({ legalEmployerId: employerId }).expect(200);
    await request(server())
      .post(`/workforce/employees/${staff.id}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '4500.00', basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);
    return staff.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Additional PCB Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'PCB Branch' }).expect(201)).body.id;
    employerId = (await request(server()).post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'PCB Sdn Bhd' }).expect(201)).body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);

    // Betty: a full tax profile, so the run computes her MTD.
    bettyId = await hire('Additional Betty', 'AB-1');
    await standing(bettyId, {
      effectiveFrom: '2024-01-01',
      epfMembership: 'MALAYSIAN_CITIZEN',
      taxResidence: 'RESIDENT',
      pcbCategory: 'CATEGORY_1',
      qualifyingChildren: 0,
      restDayOfWeek: 0,
      lindungParticipation: 'NOT_PARTICIPATING',
      reason: 'Recorded at hire',
    }).expect(201);
    // Carl: no tax profile, so his PCB is whatever is typed for the month.
    carlId = await hire('Typed Carl', 'TC-1');
    await standing(carlId, {
      effectiveFrom: '2024-01-01',
      epfMembership: 'MALAYSIAN_CITIZEN',
      restDayOfWeek: 0,
      lindungParticipation: 'NOT_PARTICIPATING',
      additionalPcbCents: 10_000,
      additionalPcbNote: 'CP38 ref 2026/0001',
      reason: 'Recorded at hire',
    }).expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  let juneBetty: number;

  it('June: the computed MTD alone, with nothing extra recorded', async () => {
    const runId = await runMonth(JUNE);
    const line = await lineOf(runId, bettyId);
    expect(line).not.toBeNull();
    juneBetty = Number(line!.pcb);
    expect(juneBetty).toBeGreaterThanOrEqual(0);
  });

  it('July: RM100 recorded from 1 July rides on top of the computed figure, and the payslip says so', async () => {
    await standing(bettyId, {
      effectiveFrom: '2026-07-01',
      additionalPcbCents: 10_000,
      additionalPcbNote: 'At her request',
      reason: 'Employee asked for more tax to be withheld',
    }).expect(201);
    const runId = await runMonth(JULY);
    const line = await lineOf(runId, bettyId);
    expect(Number(line!.pcb)).toBeCloseTo(juneBetty + 100, 2);

    // The payslip note says what rode on top, and why.
    expect(JSON.stringify(line!.breakdown)).toMatch(/Includes RM100\.00 additional PCB each month, as recorded on the statutory standing \(At her request\)/);

    // And "How this was worked out" carries the two figures as lines of their
    // own, which add up to the PCB on the payslip (UAT, 5 October 2026).
    const working = (line!.breakdown as { workings?: { pcb?: Record<string, string | number | null> } }).workings?.pcb ?? {};
    expect(working['MTD worked out for this month']).toBe(`RM${juneBetty.toFixed(2)}`);
    expect(working['Additional PCB each month (statutory standing)']).toBe('RM100.00 · At her request');
    expect(working['PCB deducted this month']).toBe(`RM${(juneBetty + 100).toFixed(2)}`);

    // The standing's history carries the figure and the note, as recorded.
    const versions = await request(server()).get(`/workforce/employees/${bettyId}/statutory-classification`).set('Authorization', bearer).expect(200);
    const current = (versions.body as { current: boolean; additionalPcbCents: number; additionalPcbNote: string | null }[]).find((row) => row.current)!;
    expect({ cents: current.additionalPcbCents, note: current.additionalPcbNote }).toEqual({ cents: 10_000, note: 'At her request' });
  });

  it('a PCB figure typed by hand is the whole figure: nothing is added on top', async () => {
    await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({ staffId: carlId, period: JULY, componentCode: 'PCB', amount: '50.00', reason: 'Figure from the tax agent' })
      .expect(201);
    const run = await withTenantContext(prisma, tenantId, (tx) => tx.payrollRun.findFirst({ where: { clinicId, period: new Date('2026-07-01T00:00:00.000Z') } }));
    await request(server()).patch(`/workforce/payroll/runs/${run!.id}/calculate`).set('Authorization', bearer).expect(200);
    const line = await lineOf(run!.id, carlId);
    expect(Number(line!.pcb)).toBe(50);
  });

  it('refuses a negative or absurd figure', async () => {
    await standing(bettyId, { effectiveFrom: '2026-08-01', additionalPcbCents: -1, reason: 'Typo' }).expect(400);
    await standing(bettyId, { effectiveFrom: '2026-08-01', additionalPcbCents: 20_000_000, reason: 'Typo' }).expect(400);
  });

  /*
   * RECORDS CHANGED SINCE THE DRAFT WAS WORKED OUT (UAT, 5 October 2026): the
   * workspace names who changed and what, and stops once the month is worked
   * out again.
   */
  it('says when a record changed after the month was worked out, and stops saying it once worked out again', async () => {
    const runId = await runMonth('2026-08');
    type Journey = {
      recordsChanged: null | { employees: { staffId: string; name: string; what: string[] }[] };
      review: { gate: { canApprove: boolean; recordsChanged?: boolean; reason: string } };
    };
    const journey = async () =>
      (await request(server()).get(`/workforce/payroll/runs/${runId}/journey`).set('Authorization', bearer).expect(200)).body as Journey;
    expect((await journey()).recordsChanged).toBeNull();

    await standing(bettyId, { effectiveFrom: '2026-08-01', additionalPcbCents: 25_000, additionalPcbNote: 'CP38 ref 2026/9', reason: 'CP38 direction' }).expect(201);
    const stale = await journey();
    expect(stale.recordsChanged?.employees).toEqual([{ staffId: bettyId, name: 'Additional Betty', what: ['statutory standing'] }]);

    // And it BLOCKS approval until worked out again (UAT, 6 October 2026):
    // the gate says so in its own words, and the server refuses before any
    // approval is recorded.
    expect(stale.review.gate).toMatchObject({ canApprove: false, recordsChanged: true });
    expect(stale.review.gate.reason).toMatch(/Records changed since this month was worked out/);
    const refused = await request(server()).patch(`/workforce/payroll/runs/${runId}/approve`).set('Authorization', bearer).send({});
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/Records changed since this month was worked out \(Additional Betty: statutory standing\)\. Work it out again, then approve\./);
    const approvals = await withTenantContext(prisma, tenantId, (tx) => tx.payrollRunApproval.count({ where: { payrollRunId: runId } }));
    expect(approvals).toBe(0);

    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
    const fresh = await journey();
    expect(fresh.recordsChanged).toBeNull();
    expect(fresh.review.gate.recordsChanged).toBe(false);
  });
});
