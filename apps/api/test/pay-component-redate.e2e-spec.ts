import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * MOVING A PLAN'S DATE, WITH NOTHING ELSE CHANGED.
 *
 * A clinic whose four statutory switches already say what it wants, and whose
 * only problem is the month its version starts in, had no way through. The date
 * rode along with a treatment change, so the only route was to save a flag at a
 * value nobody wanted and then correct it: two versions, and an audit log
 * recording a decision that was never made, to move one date.
 *
 * That is not hypothetical. An account holder's Allowance stood dated from
 * October while August was the month that needed pricing, and the switches were
 * already right.
 *
 * ITS OWN TENANT, deliberately. `pay-component-treatment.e2e-spec.ts` is
 * sequential by design — each test builds on the one before — so dates set here
 * would be read as decisions there.
 */
describe('re-dating a pay component version that has not started (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let bearer: string;

  const server = () => app.getHttpServer();

  const list = async () => {
    const res = await request(server()).get('/workforce/pay-components').set('Authorization', bearer).expect(200);
    return res.body.components as Record<string, unknown>[];
  };
  const find = async (code: string) => (await list()).find((row) => row.code === code)!;
  const historyOf = async (code: string) => {
    const res = await request(server())
      .get(`/workforce/pay-components/${code}/history`)
      .set('Authorization', bearer)
      .expect(200);
    return res.body.versions as Record<string, unknown>[];
  };
  const send = (row: Record<string, unknown>, changes: Record<string, unknown>) =>
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
  const dateOf = (row: Record<string, unknown>) => String(row.effectiveFrom).slice(0, 10);

  const PLANNED = '2027-03-01';
  const EARLIER = '2027-01-01';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    const tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Re-dating Tenant' } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('plans a treatment change well ahead, which is the version to be moved', async () => {
    const seeded = await find('ALLOWANCE');
    expect(dateOf(seeded)).toBe('1970-01-01');

    await send(seeded, {
      epfLiable: !seeded.epfLiable,
      effectiveFrom: PLANNED,
      reason: 'Planned ahead; the month is corrected below.',
    }).expect(201);

    const planned = await find('ALLOWANCE');
    expect(dateOf(planned)).toBe(PLANNED);
    expect(planned.epfLiable).toBe(!seeded.epfLiable);
  });

  it('moves it to an earlier month with the treatment untouched, and does not stack a second version', async () => {
    const before = await find('ALLOWANCE');
    const versionsBefore = (await historyOf('ALLOWANCE')).length;

    await send(before, { effectiveFrom: EARLIER, reason: 'The month was wrong; the treatment was not.' }).expect(201);

    const after = await find('ALLOWANCE');
    expect(dateOf(after)).toBe(EARLIER);
    // The SAME row moved. A third would mean the clinic decided twice.
    expect((await historyOf('ALLOWANCE')).length).toBe(versionsBefore);
    expect(after.version).toBe(before.version);
    for (const flag of ['epfLiable', 'socsoLiable', 'eisLiable', 'pcbLiable']) {
      expect(after[flag]).toBe(before[flag]);
    }
    expect(after.changeReason).toBe('The month was wrong; the treatment was not.');
  });

  it('refuses the move without a reason, because the reason is kept on the version', async () => {
    const row = await find('ALLOWANCE');
    await send(row, { effectiveFrom: '2027-02-01' }).expect(400);
    expect(dateOf(await find('ALLOWANCE'))).toBe(EARLIER);
  });

  it('leaves a version that is already in force exactly where it is', async () => {
    // BASIC stands as seeded, from the epoch: in force, and months were priced
    // under it. Its date is history, so asking to move it changes nothing.
    const row = await find('BASIC');
    expect(dateOf(row)).toBe('1970-01-01');
    await send(row, { effectiveFrom: '2027-06-01', reason: 'A version in force keeps its date.' }).expect(201);
    expect(dateOf(await find('BASIC'))).toBe('1970-01-01');
  });
});
