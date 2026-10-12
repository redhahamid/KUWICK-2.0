import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * IMPORT A MONTH'S ITEMS FROM A CSV (UAT, 10 October 2026): one upload per
 * past month, every row checked before anything is saved, a second upload
 * replacing the first, unpaid leave in days priced by the run, draft months
 * only. Demo people only.
 */
/**
 * FINAL PAY AFTER LEAVING (UAT, 12 October 2026). No. 48 left on 21 Feb 2026;
 * her February overtime (paid a month in arrears) and night incentive are
 * paid in the March 2026 run. A leaver is in a later run ONLY for lines keyed
 * by hand or imported: no salary, no proration, statutory worked out on those
 * lines. Demo people only.
 */
describe('final pay after leaving (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let marchRun: string;
  const ids: Record<string, string> = {};

  const server = () => app.getHttpServer();
  const importInto = (runId: string, rows: Record<string, string>[], commit = false) =>
    request(server()).post(`/workforce/payroll/runs/${runId}/items-import`).set('Authorization', bearer).send({ rows, commit, fileName: 'mar-2026.csv' });

  const hire = async (key: string, employeeNo: string, startDate: string, status = 'ACTIVE', endDate?: string) => {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: `Demo ${key}`, clinicId, active: !endDate } }),
    );
    ids[key] = staff.id;
    await request(server())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({
        employeeNo,
        position: 'Nurse',
        employmentType: 'PERMANENT',
        employmentStatus: status,
        startDate,
        ...(endDate ? { endDate } : {}),
        dateOfBirth: '1994-04-04',
        bankName: 'Maybank',
        bankAccountNo: '512345678901',
      })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staff.id}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: startDate,
        epfMembership: 'MALAYSIAN_CITIZEN',
        taxResidence: 'RESIDENT',
        pcbCategory: 'CATEGORY_1',
        qualifyingChildren: 0,
        restDayOfWeek: 0,
        lindungParticipation: 'NOT_PARTICIPATING',
        reason: 'Recorded at hire',
      })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staff.id}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '3100.00', basis: 'MONTHLY', effectiveFrom: startDate, reason: 'Starting salary' })
      .expect(201);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Final Pay Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Final Pay Clinic' }).expect(201)).body.id;
    const employerId = (await request(server()).post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Final Pay Sdn Bhd' }).expect(201)).body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
    // As at this clinic: overtime is paid a month in arrears.
    await request(server()).patch('/workforce/pay-components/OVERTIME/pay-date').set('Authorization', bearer).send({ payDay: 15, paidInArrears: true }).expect(200);

    await hire('stays', 'EM-1', '2024-01-01');
    await hire('leaver', '48', '2024-01-01', 'RESIGNED', '2026-02-21');
    await hire('leftEarlier', 'EM-3', '2024-01-01', 'RESIGNED', '2025-12-31');
    await hire('leftFebNothing', 'EM-4', '2024-01-01', 'RESIGNED', '2026-02-05');
    for (const staffId of Object.values(ids)) {
      await request(server()).patch(`/workforce/employees/${staffId}/legal-employer`).set('Authorization', bearer).send({ legalEmployerId: employerId }).expect(200);
    }
    marchRun = (await request(server()).post('/workforce/payroll/runs').set('Authorization', bearer).send({ period: '2026-03', clinicId }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('accepts a leaver’s arrears and earned-in lines in a later month, and refuses deductions and later months', async () => {
    const preview = (
      await importInto(marchRun, [
        { employeeNo: '48', itemCode: 'OVERTIME', amount: '300.00' },
        { employeeNo: '48', itemCode: 'NIGHT_INCENTIVE', amount: '200.00', earnedIn: '2026-02' },
        { employeeNo: '48', itemCode: 'ADVANCE_RECOVERY', amount: '50.00' },
        { employeeNo: '48', itemCode: 'ALLOWANCE', amount: '80.00', earnedIn: '2026-03' },
        { employeeNo: '48', itemCode: 'UNPAID_LEAVE_DAYS', amount: '1' },
      ]).expect(201)
    ).body;
    const rows = preview.rows as { ok: boolean; problems: string[]; finalPay?: string; earnedIn?: string | null }[];
    expect(rows[0]).toMatchObject({ ok: true, finalPay: 'Final pay (left 21 Feb 2026)', earnedIn: '2026-02' });
    expect(rows[1]).toMatchObject({ ok: true, earnedIn: '2026-02' });
    expect(rows[2].problems.join(' ')).toMatch(/left on 21 Feb 2026\. Only final payments .* not deductions/);
    expect(rows[3].problems.join(' ')).toMatch(/nothing can be earned in March 2026/);
    expect(rows[4].problems.join(' ')).toMatch(/not deductions/);

    const done = (
      await importInto(
        marchRun,
        [
          { employeeNo: '48', itemCode: 'OVERTIME', amount: '300.00' },
          { employeeNo: '48', itemCode: 'NIGHT_INCENTIVE', amount: '200.00', earnedIn: '2026-02' },
        ],
        true,
      ).expect(201)
    ).body;
    expect(done.committed).toBe(true);
    expect(done.added).toBe(2);
  });

  it('pays only those lines in March: no salary, statutory worked out, named as final pay', async () => {
    await request(server()).patch(`/workforce/payroll/runs/${marchRun}/calculate`).set('Authorization', bearer).expect(200);
    const lines = await withTenantContext(prisma, tenantId, (tx) => tx.payrollLine.findMany({ where: { payrollRunId: marchRun } }));
    const leaverLine = lines.find((line) => line.staffId === ids.leaver)!;
    expect(Number(leaverLine.basicSalary)).toBe(0);
    expect(Number(leaverLine.grossPay)).toBe(500);
    expect(leaverLine.socsoEmployee).not.toBeNull();
    expect(lines.map((line) => line.staffId).sort()).toEqual([ids.stays, ids.leaver].sort());

    const exceptions = (await request(server()).get(`/workforce/payroll/runs/${marchRun}/exceptions`).set('Authorization', bearer).expect(200)).body
      .exceptions as { code: string; staffId: string; cause: string; severity: string }[];
    const finalPay = exceptions.filter((row) => row.code === 'FINAL_PAY');
    expect(finalPay).toEqual([expect.objectContaining({ staffId: ids.leaver, severity: 'INFO' })]);
    expect(finalPay[0].cause).toMatch(/^Final pay \(left 21 Feb 2026\): only the items keyed or imported/);
    expect(exceptions.filter((row) => row.staffId === ids.leaver && row.severity === 'BLOCKING')).toEqual([]);

    const journey = (await request(server()).get(`/workforce/payroll/runs/${marchRun}/journey`).set('Authorization', bearer).expect(200)).body;
    const row = (journey.pay.rows as { staffId: string; finalPay: string | null }[]).find((r) => r.staffId === ids.leaver);
    expect(row?.finalPay).toBe('Final pay (left 21 Feb 2026)');
    // Left in February with nothing keyed: offered, not paid. Left in December: neither.
    const candidates = (journey.employees.finalPayCandidates as { staffId: string; label: string }[]).map((c) => [c.staffId, c.label]);
    expect(candidates).toEqual([[ids.leftFebNothing, 'Final pay (left 5 Feb 2026)']]);
  });

  it('takes a final payment typed on the grid, and refuses a deduction there too', async () => {
    const add = (componentCode: string) =>
      request(server()).post('/workforce/payroll/inputs').set('Authorization', bearer).send({ staffId: ids.leftFebNothing, period: '2026-03-01', componentCode, amount: '120.00' });
    expect((await add('UNIFORM').expect(400)).body.message).toMatch(/not deductions/);
    await add('LEAVE_PAYOUT').expect(201);
    await request(server()).patch(`/workforce/payroll/runs/${marchRun}/calculate`).set('Authorization', bearer).expect(200);
    const line = await withTenantContext(prisma, tenantId, (tx) => tx.payrollLine.findFirst({ where: { payrollRunId: marchRun, staffId: ids.leftFebNothing } }));
    expect(Number(line?.basicSalary)).toBe(0);
    expect(Number(line?.grossPay)).toBe(120);
  });
});
