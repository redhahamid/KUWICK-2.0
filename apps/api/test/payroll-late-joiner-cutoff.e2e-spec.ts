import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * LATE JOINERS PAID THE NEXT MONTH (UAT, 10 October 2026): "the old payroll
 * paid a 27 Apr joiner's April days in the May run." Off by default: the
 * joiner is paid in April. With a cut-off on the 25th, April's run leaves them
 * out and May's adds April's 4 of 30 days to basic: 1,800 + 240 = 2,040. An
 * April that already paid them is not paid again. Demo person only.
 */
describe('a late joiner paid in the next month (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let ruleSetId: string;
  let joinerId: string;

  const http = () => request(app.getHttpServer());
  const ruleSet = (body: Record<string, unknown>) => http().post('/workforce/payroll-policies').set('Authorization', bearer).send(body);

  const runIds: Record<string, string> = {};
  const workOut = async (period: string) => {
    runIds[period] ??= (await http().post('/workforce/payroll/runs').set('Authorization', bearer).send({ period, clinicId }).expect(201)).body.id;
    const runId = runIds[period];
    const calculated = await http().patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer);
    expect([calculated.status, calculated.status === 200 ? '' : calculated.body.message]).toEqual([200, '']);
    const line = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollLine.findFirst({ where: { payrollRunId: runId, staffId: joinerId }, select: { basicSalary: true } }),
    );
    const exceptions = (await http().get(`/workforce/payroll/runs/${runId}/exceptions`).set('Authorization', bearer).expect(200)).body
      .exceptions as { code: string; staffId: string | null; cause: string; consequence: string }[];
    return {
      basic: line ? Number(line.basicSalary) : null,
      raised: (code: string) => exceptions.filter((row) => row.staffId === joinerId && row.code === code),
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Late Joiner Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await http().post('/clinics').set('Authorization', bearer).send({ name: 'Late Joiner Clinic' }).expect(201)).body.id;
    legalEmployerId = (await http().post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Late Joiner Sdn Bhd' }).expect(201)).body.id;
    await http().post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
    ruleSetId = (await ruleSet({ name: 'Everybody', isDefault: true }).expect(201)).body.id;

    const row = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Demo Late Joiner', clinicId } }),
    );
    joinerId = row.id;
    await http()
      .post(`/workforce/employees/${joinerId}`)
      .set('Authorization', bearer)
      .send({ employeeNo: 'LJ-1', position: 'Clinic assistant', employmentType: 'PERMANENT', employmentStatus: 'ACTIVE', startDate: '2026-04-27', dateOfBirth: '1995-03-03' })
      .expect(201);
    await http()
      .post(`/workforce/employees/${joinerId}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: '2026-04-27',
        epfMembership: 'MALAYSIAN_CITIZEN',
        taxResidence: 'RESIDENT',
        pcbCategory: 'CATEGORY_1',
        qualifyingChildren: 0,
        restDayOfWeek: 0,
        lindungParticipation: 'NOT_PARTICIPATING',
        reason: 'Recorded at hire',
      })
      .expect(201);
    await http().patch(`/workforce/employees/${joinerId}/legal-employer`).set('Authorization', bearer).send({ legalEmployerId }).expect(200);
    await http()
      .post(`/workforce/employees/${joinerId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '1800.00', basis: 'MONTHLY', effectiveFrom: '2026-04-27', reason: 'Starting salary' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('pays a late joiner in the month they start unless the rule set has a cut-off', async () => {
    const listed = (await http().get('/workforce/payroll-policies').set('Authorization', bearer).expect(200)).body;
    const rows = (Array.isArray(listed) ? listed : listed.policies ?? listed.items) as { id: string; lateJoinerCutoffDay: number | null }[];
    expect(rows.find((row) => row.id === ruleSetId)?.lateJoinerCutoffDay).toBeNull();
    const april = await workOut('2026-04');
    expect(april.basic).toBe(240);
    expect(april.raised('JOINED_AFTER_CUTOFF')).toEqual([]);
    const may = await workOut('2026-05');
    expect(may.basic).toBe(1800);
  });

  it('with a cut-off on the 25th, leaves them out of April and adds April’s days to May', async () => {
    await ruleSet({ id: ruleSetId, name: 'Everybody', isDefault: true, lateJoinerCutoffDay: 31 }).expect(400);
    await ruleSet({ id: ruleSetId, name: 'Everybody', isDefault: true, lateJoinerCutoffDay: 25 }).expect(201);

    const april = await workOut('2026-04');
    expect(april.basic).toBeNull();
    const [left] = april.raised('JOINED_AFTER_CUTOFF');
    expect(left.cause).toBe('They started on 2026-04-27, after the 25th cut-off in their rule set.');

    const may = await workOut('2026-05');
    expect(may.basic).toBe(2040);
    const [added] = may.raised('LATE_JOINER_DAYS_ADDED');
    expect(added.cause).toBe('Started 2026-04-27, after the 25th cut-off: April 2026\'s days, RM240.00, are added to basic pay this month.');
  });

  it('does not pay April’s days again when April already paid them', async () => {
    await ruleSet({ id: ruleSetId, name: 'Everybody', isDefault: true, lateJoinerCutoffDay: null }).expect(201);
    expect((await workOut('2026-04')).basic).toBe(240);
    await withTenantContext(prisma, tenantId, (tx) => tx.payrollRun.update({ where: { id: runIds['2026-04'] }, data: { status: 'APPROVED' } }));
    await ruleSet({ id: ruleSetId, name: 'Everybody', isDefault: true, lateJoinerCutoffDay: 25 }).expect(201);

    const may = await workOut('2026-05');
    expect(may.basic).toBe(1800);
    expect(may.raised('LATE_JOINER_DAYS_ADDED')).toEqual([]);
  });
});
