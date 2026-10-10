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
describe('importing a month’s items (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let runId: string;
  const ids: Record<string, string> = {};

  const server = () => app.getHttpServer();
  const post = (rows: Record<string, string>[], commit = false) =>
    request(server())
      .post(`/workforce/payroll/runs/${runId}/items-import`)
      .set('Authorization', bearer)
      .send({ rows, commit, fileName: 'jan-2026.csv' });
  const imported = () =>
    withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollInputEntry.findMany({
        where: { period: new Date('2026-01-01T00:00:00.000Z'), source: 'IMPORT' },
        orderBy: [{ staffId: 'asc' }, { componentCode: 'asc' }],
      }),
    );

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
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Items Import Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Items Import Clinic' }).expect(201)).body.id;
    await request(server()).post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Items Import Sdn Bhd' }).expect(201);
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);

    await hire('stays', 'EM-1', '2024-01-01');
    await hire('leftJan7', 'EM-2', '2024-01-01', 'RESIGNED', '2026-01-07');
    await hire('startsAug', 'EM-3', '2026-08-17');
    runId = (await request(server()).post('/workforce/payroll/runs').set('Authorization', bearer).send({ period: '2026-01', clinicId }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lists the codes a file may use: the clinic’s items, without basic pay, PCB or unpaid leave in ringgit, plus UNPAID_LEAVE_DAYS', async () => {
    const codes = ((await request(server()).get('/workforce/payroll/items-import/codes').set('Authorization', bearer).expect(200)).body.codes as { code: string }[]).map(
      (row) => row.code,
    );
    expect(codes).toEqual(expect.arrayContaining(['OVERTIME', 'ALLOWANCE', 'BONUS', 'UNIFORM', 'UNPAID_LEAVE_DAYS']));
    expect(codes).not.toEqual(expect.arrayContaining(['BASIC']));
    expect(codes).not.toContain('PCB');
    expect(codes).not.toContain('UNPAID_LEAVE');
  });

  it('checks every row and saves nothing while any row fails', async () => {
    const preview = (
      await post(
        [
          { employeeNo: 'EM-1', itemCode: 'OVERTIME', amount: '250.00' },
          { employeeNo: 'EM-9', itemCode: 'ALLOWANCE', amount: '100' },
          { employeeNo: 'EM-3', itemCode: 'ALLOWANCE', amount: '100' },
          { employeeNo: 'EM-1', itemCode: 'NOPE', amount: '100' },
          { employeeNo: 'EM-1', itemCode: 'ALLOWANCE', amount: '-5' },
          { employeeNo: 'EM-1', itemCode: 'BASIC', amount: '100' },
          { employeeNo: 'EM-2', itemCode: 'BONUS', amount: '500', pcbType: 'normal' },
          { employeeNo: 'EM-1', itemCode: 'OVERTIME', amount: '10' },
          { employeeNo: 'EM-1', itemCode: 'ALLOWANCE', amount: '100', earnedIn: '2026-02' },
        ],
        true,
      ).expect(201)
    ).body;
    expect(preview.committed).toBe(false);
    expect(preview.passed).toBe(1);
    const problems = (preview.rows as { problems: string[] }[]).map((row) => row.problems.join(' '));
    expect(problems[0]).toBe('');
    expect(problems[1]).toMatch(/No employee has Employee No\. EM-9/);
    expect(problems[2]).toMatch(/not in January 2026’s run/);
    expect(problems[3]).toMatch(/"NOPE" is not an item in Payroll items/);
    expect(problems[4]).toMatch(/not an amount/);
    expect(problems[5]).toMatch(/Basic pay comes from the salary record/);
    expect(problems[6]).toMatch(/additional remuneration for PCB in Payroll items, and this row says normal/);
    expect(problems[7]).toMatch(/Row 1 already has Overtime/);
    expect(problems[8]).toMatch(/after January 2026/);
    expect(await imported()).toEqual([]);
  });

  it('adds every line once all pass; the run pays them like typed lines, and prices unpaid days', async () => {
    const committed = (
      await post(
        [
          { employeeNo: 'EM-1', itemCode: 'OVERTIME', amount: '250.00', note: 'From the old payroll' },
          { employeeNo: 'em-1', itemCode: 'allowance', amount: 'RM 1,000.50', earnedIn: '2025-12', pcbType: 'normal' },
          { employeeNo: 'EM-1', itemCode: 'UNPAID_LEAVE_DAYS', amount: '2' },
          { employeeNo: 'EM-2', itemCode: 'BONUS', amount: '500', pcbType: 'additional' },
        ],
        true,
      ).expect(201)
    ).body;
    expect(committed).toMatchObject({ committed: true, passed: 4, failed: 0, added: 4, replaced: 0 });

    const rows = await imported();
    expect(rows.map((row) => [row.staffId === ids.stays ? 'EM-1' : 'EM-2', row.componentCode, row.amount.toString(), row.earnedPeriod?.toISOString().slice(0, 7) ?? null])).toEqual(
      expect.arrayContaining([
        ['EM-1', 'OVERTIME', '250', null],
        ['EM-1', 'ALLOWANCE', '1000.5', '2025-12'],
        ['EM-1', 'UNPAID_LEAVE', '0', null],
        ['EM-2', 'BONUS', '500', null],
      ]),
    );

    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
    const lines = await withTenantContext(prisma, tenantId, (tx) => tx.payrollLine.findMany({ where: { payrollRunId: runId } }));
    const stays = lines.find((line) => line.staffId === ids.stays)!;
    expect(Number(stays.overtimePay)).toBe(250);
    // RM3,100 over 31 days is RM100 a day: two days is RM200.
    expect(Number(stays.unpaidLeaveDeduction)).toBe(200);
    const priced = (await imported()).find((row) => row.componentCode === 'UNPAID_LEAVE')!;
    expect(Number(priced.amount)).toBe(200);
    expect(priced.label).toBe('Unpaid leave · 2 days at RM100.00');
  });

  it('replaces the month’s earlier import on a second upload, and logs both', async () => {
    const again = (await post([{ employeeNo: 'EM-1', itemCode: 'ALLOWANCE', amount: '150' }], true).expect(201)).body;
    expect(again).toMatchObject({ committed: true, added: 1, replaced: 4, previousImport: 4 });
    const rows = await imported();
    expect(rows.map((row) => [row.componentCode, row.amount.toString()])).toEqual([['ALLOWANCE', '150']]);
    const audit = await withTenantContext(prisma, tenantId, (tx) => tx.auditLog.count({ where: { action: 'payrollInput.imported', entityId: runId } }));
    expect(audit).toBe(2);
  });

  it('refuses a line already typed in on the grid, rather than paying it twice', async () => {
    await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({ staffId: ids.stays, period: '2026-01-01', componentCode: 'COMMISSION', amount: '80.00' })
      .expect(201);
    const preview = (await post([{ employeeNo: 'EM-1', itemCode: 'COMMISSION', amount: '90' }]).expect(201)).body;
    expect(preview.rows[0].problems.join(' ')).toMatch(/already has Commission typed in on the grid/);
  });

  it('refuses an approved month', async () => {
    await withTenantContext(prisma, tenantId, (tx) => tx.payrollRun.update({ where: { id: runId }, data: { status: 'APPROVED' } }));
    await post([{ employeeNo: 'EM-1', itemCode: 'ALLOWANCE', amount: '150' }], true).expect(409);
  });
});
