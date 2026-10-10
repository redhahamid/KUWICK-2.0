import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * WHEN EACH PAYROLL ITEM IS PAID (UAT, 10 October 2026).
 *
 * A run is paid on up to three dates of its own month: salary on the 30th, a
 * director's fee on the 1st, overtime, locum, housecall and claims on the
 * 15th; overtime, locum and the fee are a month in arrears, paid in the run
 * after the month they were earned. Which item goes on which date, and which
 * are in arrears, is the clinic's, set per item in Settings — payment, not
 * treatment, so it writes no version and asks for no reason, and it is
 * written on every version so whichever one a month resolves to says the
 * same.
 *
 * ITS OWN TENANTS: the treatment specs build on each other's versions.
 */
describe('when each payroll item is paid (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;

  const server = () => app.getHttpServer();
  const listOf = async (auth: string) =>
    (await request(server()).get('/workforce/pay-components').set('Authorization', auth).expect(200)).body as {
      components: Record<string, unknown>[];
      missingPresets: { code: string; name: string }[];
    };
  const find = async (code: string) => (await listOf(bearer)).components.find((row) => row.code === code)!;
  const versionsOf = (code: string) =>
    withTenantContext(prisma, tenantId, (tx) =>
      tx.payComponent.findMany({ where: { tenantId, code }, orderBy: { effectiveFrom: 'asc' } }),
    );
  const setPayDate = (code: string, body: Record<string, unknown>) =>
    request(server()).patch(`/workforce/pay-components/${code}/pay-date`).set('Authorization', bearer).send(body);
  const sendTreatment = (row: Record<string, unknown>, changes: Record<string, unknown>) =>
    request(server())
      .post('/workforce/pay-components')
      .set('Authorization', bearer)
      .send({
        code: row.code,
        name: row.name,
        type: row.type,
        category: row.category,
        includeIn: row.includeIn,
        pcbLiable: row.pcbLiable,
        epfLiable: row.epfLiable,
        socsoLiable: row.socsoLiable,
        eisLiable: row.eisLiable,
        hrdLiable: row.hrdLiable,
        includeInOrpBase: row.includeInOrpBase,
        includeInUnpaidLeaveBase: row.includeInUnpaidLeaveBase,
        additionalRemuneration: row.additionalRemuneration,
        prorated: row.prorated,
        employerSide: row.employerSide,
        active: row.active,
        ...changes,
      });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Pay Dates Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('starts every item on the 30th and none in arrears, and brings the clinic’s items with its table', async () => {
    const { components, missingPresets } = await listOf(bearer);
    expect(missingPresets).toEqual([]);
    expect(components.every((row) => row.payDay === 30 && row.paidInArrears === false)).toBe(true);

    const flags = (code: string) => {
      const row = components.find((item) => item.code === code)!;
      return [row.type, row.epfLiable, row.socsoLiable, row.eisLiable, row.pcbLiable, row.includeIn];
    };
    for (const code of ['NIGHT_INCENTIVE', 'MARKETING', 'PROCEDURE_INCENTIVE_BOD', 'PROCEDURE_INCENTIVE_RESIDENT', 'HOUSECALL']) {
      expect(flags(code)).toEqual(['ADDITION', true, true, true, true, 'GROSS_AND_NET']);
    }
    for (const code of ['PANEL_CLAIM', 'MEDICAL_CHECKUP_REFUND']) {
      expect(flags(code)).toEqual(['ADDITION', false, false, false, false, 'GROSS_AND_NET']);
    }
    for (const code of ['MEDICAL_CLAIM_RECOVERY', 'MEDICAL_CHECKUP_DEDUCTION']) {
      expect(flags(code)).toEqual(['DEDUCTION', false, false, false, false, 'NET_ONLY']);
    }
  });

  it('moves an item’s pay date on every version at once, with no reason and no new version', async () => {
    const overtime = await find('OVERTIME');
    await sendTreatment(overtime, {
      hrdLiable: !overtime.hrdLiable,
      effectiveFrom: '2027-01-01',
      reason: 'A second version, so the date has two rows to land on.',
    }).expect(201);
    expect(await versionsOf('OVERTIME')).toHaveLength(2);

    const res = await setPayDate('OVERTIME', { payDay: 15, paidInArrears: true }).expect(200);
    expect(res.body).toEqual({ code: 'OVERTIME', payDay: 15, paidInArrears: true });

    const versions = await versionsOf('OVERTIME');
    expect(versions).toHaveLength(2);
    // The column kept its first name: 1 is a month in arrears.
    expect(versions.map((row) => [row.payDay, row.payMonthOffset])).toEqual([[15, 1], [15, 1]]);
    expect(await find('OVERTIME')).toMatchObject({ payDay: 15, paidInArrears: true });

    // The day moves on its own; arrears stays as it was.
    await setPayDate('OVERTIME', { payDay: 16 }).expect(200);
    expect(await find('OVERTIME')).toMatchObject({ payDay: 16, paidInArrears: true });
  });

  it('keeps the date through a later change of treatment', async () => {
    await setPayDate('DIRECTOR_FEE', { payDay: 1, paidInArrears: true }).expect(200);
    const fee = await find('DIRECTOR_FEE');
    await sendTreatment(fee, {
      pcbLiable: !fee.pcbLiable,
      effectiveFrom: '2027-02-01',
      reason: 'A new version must not move the fee back to the 30th.',
    }).expect(201);
    const versions = await versionsOf('DIRECTOR_FEE');
    expect(versions).toHaveLength(2);
    expect(versions[1]).toMatchObject({ payDay: 1, payMonthOffset: 1 });
  });

  it('refuses a deduction, a day the calendar does not have, basic pay in arrears, and an item that is not there', async () => {
    const refused = await setPayDate('UNIFORM', { payDay: 15 }).expect(400);
    expect(refused.body.message).toMatch(/comes out of the salary payment/);
    await setPayDate('HOUSECALL', { payDay: 0 }).expect(400);
    await setPayDate('HOUSECALL', { payDay: 32 }).expect(400);
    const salary = await setPayDate('BASIC', { payDay: 30, paidInArrears: true }).expect(400);
    expect(salary.body.message).toMatch(/never paid a month in arrears/);
    await setPayDate('NOT_AN_ITEM', { payDay: 15 }).expect(404);
    expect(await find('HOUSECALL')).toMatchObject({ payDay: 30, paidInArrears: false });
  });

  it('does not offer a standard item again when the clinic made one by hand under its own code', async () => {
    const otherTenant = randomId();
    await withTenantContext(prisma, otherTenant, (tx) => tx.tenant.create({ data: { id: otherTenant, name: 'Hand-made Items Tenant' } }));
    const otherBearer = (await createOwnerAndBearer(prisma, otherTenant)).bearer;
    await request(server())
      .post('/workforce/pay-components')
      .set('Authorization', otherBearer)
      .send({ code: 'HOUSE_CALL', name: 'Housecall', type: 'ADDITION', category: 'REMUNERATION', epfLiable: true, socsoLiable: true, eisLiable: true })
      .expect(201);

    const before = await listOf(otherBearer);
    expect(before.missingPresets.map((preset) => preset.code)).not.toContain('HOUSECALL');
    expect(before.missingPresets.map((preset) => preset.code)).toContain('PANEL_CLAIM');

    await request(server()).post('/workforce/pay-components/seed').set('Authorization', otherBearer).expect(201);
    const after = await listOf(otherBearer);
    expect(after.components.filter((row) => String(row.name).toLowerCase() === 'housecall')).toHaveLength(1);
    expect(after.missingPresets).toEqual([]);
  });
});
