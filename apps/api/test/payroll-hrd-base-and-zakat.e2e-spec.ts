import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * TWO EMPLOYER SETTINGS (UAT, 10 October 2026).
 *
 * The HRD levy is worked out on basic salary only unless the employer chooses
 * basic plus fixed allowances: 1% of RM8,000 is RM80.00, and with a RM500
 * fixed allowance on the second basis RM85.00.
 *
 * January, so the month's tax is a full year's estimate and there is PCB
 * for the zakat to come off: a first payroll later in the year with no
 * earlier months on record spreads the year thin enough to owe none.
 *
 * Zakat goes through payroll only where the employer turns it on. Off — the
 * default — a Zakat item cannot be added; on, the month's zakat comes off net
 * pay and off the month's PCB; turned off again with the item still on
 * record, the month stops rather than quietly not paying it.
 */
describe('HRD levy base and zakat through payroll (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let staffId: string;
  let runId: string;

  const http = () => request(app.getHttpServer());
  const employer = (body: Record<string, unknown>) =>
    http().post('/workforce/legal-employers').set('Authorization', bearer).send({ id: legalEmployerId, name: 'Levy Sdn Bhd', ...body }).expect(201);
  const workOut = async () => {
    await http().patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
    const line = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollLine.findFirstOrThrow({ where: { payrollRunId: runId, staffId }, select: { hrdLevy: true, netPay: true, pcb: true } }),
    );
    const exceptions = (await http().get(`/workforce/payroll/runs/${runId}/exceptions`).set('Authorization', bearer).expect(200)).body
      .exceptions as { code: string; severity: string; cause: string }[];
    return { levy: Number(line.hrdLevy), net: Number(line.netPay), pcb: Number(line.pcb), exceptions };
  };
  const addZakat = () =>
    http()
      .post(`/workforce/employees/${staffId}/recurring-items`)
      .set('Authorization', bearer)
      .send({ componentCode: 'ZAKAT', amount: '100.00', effectiveFrom: '2026-01-01', note: 'Monthly zakat, as the employee asked' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Levy Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await http().post('/clinics').set('Authorization', bearer).send({ name: 'Levy Clinic' }).expect(201)).body.id;
    legalEmployerId = (await http().post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Levy Sdn Bhd' }).expect(201)).body.id;
    await http()
      .post(`/workforce/legal-employers/${legalEmployerId}/statutory-profile`)
      .set('Authorization', bearer)
      .send({ effectiveFrom: '2024-01-01', hrdRegistration: 'MANDATORY_SECTION_14', reason: 'Registered' })
      .expect(201);
    await http().post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);

    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Demo Pharmacist', clinicId } }),
    );
    staffId = staff.id;
    await http()
      .post(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .send({ employeeNo: 'LV-1', position: 'Pharmacist', employmentType: 'PERMANENT', employmentStatus: 'ACTIVE', startDate: '2024-01-01', dateOfBirth: '1990-01-01' })
      .expect(201);
    await http()
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: '2024-01-01',
        epfMembership: 'MALAYSIAN_CITIZEN',
        taxResidence: 'RESIDENT',
        pcbCategory: 'CATEGORY_1',
        qualifyingChildren: 0,
        restDayOfWeek: 0,
        lindungParticipation: 'NOT_PARTICIPATING',
        reason: 'Recorded at hire',
      })
      .expect(201);
    await http().patch(`/workforce/employees/${staffId}/legal-employer`).set('Authorization', bearer).send({ legalEmployerId }).expect(200);
    await http()
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '8000.00', basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);
    await http()
      .post(`/workforce/employees/${staffId}/recurring-items`)
      .set('Authorization', bearer)
      .send({ componentCode: 'ALLOWANCE', amount: '500.00', effectiveFrom: '2024-01-01', note: 'Fixed allowance' })
      .expect(201);
    runId = (await http().post('/workforce/payroll/runs').set('Authorization', bearer).send({ period: '2026-01', clinicId }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('starts every employer on basic salary only for the levy, and with zakat off', async () => {
    const listed = (await http().get('/workforce/legal-employers').set('Authorization', bearer).expect(200)).body as {
      id: string;
      hrdLevyBase: string;
      zakatThroughPayroll: boolean;
    }[];
    expect(listed.find((row) => row.id === legalEmployerId)).toMatchObject({ hrdLevyBase: 'BASIC_ONLY', zakatThroughPayroll: false });
    expect((await workOut()).levy).toBe(80);
  });

  it('adds the fixed allowance when the employer chooses basic plus fixed allowances', async () => {
    await employer({ hrdLevyBase: 'BASIC_PLUS_FIXED_ALLOWANCES' });
    expect((await workOut()).levy).toBe(85);
    await employer({ hrdLevyBase: 'BASIC_ONLY' });
    expect((await workOut()).levy).toBe(80);
  });

  it('refuses a Zakat item while the employer does not deduct zakat', async () => {
    const refused = await addZakat().expect(400);
    expect(refused.body.message).toMatch(/does not deduct zakat through payroll/);
  });

  it('takes the month’s zakat from net pay and from the month’s PCB once it is on', async () => {
    const before = await workOut();
    await employer({ zakatThroughPayroll: true });
    await addZakat().expect(201);
    const after = await workOut();
    // Off the PCB ringgit for ringgit, while there is PCB to take it from.
    expect(before.pcb).toBeGreaterThan(100);
    expect(after.pcb).toBeCloseTo(before.pcb - 100, 2);
    // So net pay is unchanged: RM100 more withheld as zakat, RM100 less as PCB.
    expect(after.net).toBeCloseTo(before.net, 2);
    expect(after.exceptions.some((row) => row.code === 'ZAKAT_THROUGH_PAYROLL_OFF')).toBe(false);
  });

  it('stops the month when zakat is turned off with an item still on record', async () => {
    await employer({ zakatThroughPayroll: false });
    const month = await workOut();
    const [held] = month.exceptions.filter((row) => row.code === 'ZAKAT_THROUGH_PAYROLL_OFF');
    expect(held).toMatchObject({ severity: 'BLOCKING' });
    expect(held.cause).toBe('RM100.00 of zakat is on their record for this month, but Levy Sdn Bhd does not deduct zakat through payroll.');
    // Not taken: the PCB is back to what it was without it.
    expect(month.pcb).toBeGreaterThan(100);
    const approve = await http().patch(`/workforce/payroll/runs/${runId}/approve`).set('Authorization', bearer).send({ acknowledgeStatutoryGap: true });
    expect(approve.status).toBe(400);
  });
});
