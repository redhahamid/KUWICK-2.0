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
/**
 * A PAYROLL ITEM'S TREATMENT DATED EARLIER (UAT, 11 October 2026): "Turning
 * SOCSO off for ALLOWANCE from Jan 2026 is refused: the current version
 * starts on 2026-10-01, which is not before 2026-01-01." The HRD rule: a
 * version's start may be corrected, or a change dated earlier, while no
 * approved month of ANY branch lies in the period priced differently.
 */
describe('a payroll item treatment dated earlier (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let bearer: string;
  let tenantId: string;
  let ownerStaffId: string;

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

  const timeline = async () =>
    (await withTenantContext(prisma, tenantId, (tx) => tx.payComponent.findMany({ where: { code: 'ALLOWANCE' }, orderBy: { effectiveFrom: 'asc' } }))).map(
      (row) => [isoDay(row.effectiveFrom), row.effectiveTo ? isoDay(row.effectiveTo) : null, row.socsoLiable, row.eisLiable],
    );
  const isoDay = (date: Date) => date.toISOString().slice(0, 10);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Item Backdate Tenant' } }));
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;
    ownerStaffId = owner.staffId;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
    // As on staging: SOCSO switched off for allowances from 1 October 2026.
    const allowance = await find('ALLOWANCE');
    expect(allowance.socsoLiable).toBe(true);
    await send(allowance, { socsoLiable: false, effectiveFrom: '2026-10-01', reason: 'Allowance is not SOCSO wages here' }).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('corrects the start of the version in force to January, with a reason, and logs it', async () => {
    const open = await find('ALLOWANCE');
    await send(open, { effectiveFrom: '2026-01-01' }).expect(400);
    await send(open, { effectiveFrom: '2026-01-01', reason: 'SOCSO was off from January; October is when we entered it' }).expect(201);
    expect(await timeline()).toEqual([
      ['1970-01-01', '2025-12-31', true, true],
      ['2026-01-01', null, false, true],
    ]);
    const audits = await withTenantContext(prisma, tenantId, (tx) => tx.auditLog.findMany({ where: { action: 'payComponent.startCorrected' } }));
    expect(audits.map((row) => JSON.stringify(row)).join(' ')).toMatch(/Corrected the start of ALLOWANCE v2 from 2026-10-01 to 2026-01-01: SOCSO was off from January/);
  });

  it('dates a different change earlier: a version from that date, and every later version takes it', async () => {
    const open = await find('ALLOWANCE');
    await send(open, { eisLiable: false, effectiveFrom: '2025-07-01', reason: 'EIS off from July 2025' }).expect(201);
    expect(await timeline()).toEqual([
      ['1970-01-01', '2025-06-30', true, true],
      ['2025-07-01', '2025-12-31', true, false],
      ['2026-01-01', null, false, false],
    ]);
  });

  it('refuses, naming the month and branch, when any branch has an approved month in the period', async () => {
    const other = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Demo Other Branch' }).expect(201)).body.id as string;
    await withTenantContext(prisma, tenantId, async (tx) => {
      const run = await tx.payrollRun.create({
        data: { tenantId, clinicId: other, period: new Date('2025-08-01T00:00:00.000Z'), status: 'CALCULATED', createdByStaffId: ownerStaffId },
      });
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'APPROVED' } });
    });
    const before = await timeline();
    const open = await find('ALLOWANCE');
    const refused = await send(open, { socsoLiable: true, effectiveFrom: '2025-03-01', reason: 'Trying to reach an approved month' }).expect(409);
    expect(refused.body.message).toMatch(/Aug 2025 \(Demo Other Branch\) is approved/);
    // Moving the start back past an earlier version would swallow it: named, refused.
    const swallowing = await send(open, { effectiveFrom: '2025-02-01', reason: 'Trying to move past a version' }).expect(400);
    expect(swallowing.body.message).toMatch(/starts on 2025-07-01, inside that period/);
    expect(await timeline()).toEqual(before);
  });
});
