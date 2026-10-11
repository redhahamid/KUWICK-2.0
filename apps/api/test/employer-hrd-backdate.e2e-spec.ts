import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * HRD REGISTRATION, BACK-DATED (UAT, 10 October 2026): "Hijraa Sdn Bhd is
 * recorded from 1 Sep 2026; recording from 1 Jan 2026 is refused." A date
 * before the record in force corrects its start or inserts an earlier
 * version, logged with a reason; an approved month inside the period that
 * would change refuses it, named.
 */
describe('HRD registration dated earlier (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let ownerStaffId: string;
  let employerId: string;

  const record = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/workforce/legal-employers/${employerId}/statutory-profile`).set('Authorization', bearer).send(body);
  const timeline = () =>
    withTenantContext(prisma, tenantId, (tx) =>
      tx.legalEmployerStatutoryProfile.findMany({ where: { legalEmployerId: employerId }, orderBy: { effectiveFrom: 'asc' } }),
    ).then((rows) =>
      rows.map((row) => [row.hrdRegistration, row.effectiveFrom.toISOString().slice(0, 10), row.effectiveTo?.toISOString().slice(0, 10) ?? null]),
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'HRD Backdate Tenant' } }));
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;
    ownerStaffId = owner.staffId;
    employerId = (await request(app.getHttpServer()).post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Demo Backdate Sdn Bhd' }).expect(201)).body.id;
    await record({ effectiveFrom: '2026-09-01', hrdRegistration: 'MANDATORY_SECTION_14', reason: 'Registered' }).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('corrects the start of the record to an earlier date, with a reason', async () => {
    const unexplained = await record({ effectiveFrom: '2026-01-01', hrdRegistration: 'MANDATORY_SECTION_14' }).expect(400);
    expect(unexplained.body.message).toMatch(/Say why/);
    await record({ effectiveFrom: '2026-01-01', hrdRegistration: 'MANDATORY_SECTION_14', reason: 'Registered since January; September was the date we entered it' }).expect(201);
    expect(await timeline()).toEqual([['MANDATORY_SECTION_14', '2026-01-01', null]]);
    const audits = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.findMany({ where: { action: 'legalEmployerStatutory.recorded' } }),
    );
    expect(audits.map((row) => JSON.stringify(row)).join(' ')).toMatch(/Corrected the start of HRD registration MANDATORY_SECTION_14 from 2026-09-01 to 2026-01-01: Registered since January/);
  });

  it('inserts an earlier version of a different class, ending where the next begins', async () => {
    await record({ effectiveFrom: '2025-07-01', hrdRegistration: 'NOT_REGISTERED', reason: 'Below the headcount until January' }).expect(201);
    expect(await timeline()).toEqual([
      ['NOT_REGISTERED', '2025-07-01', '2025-12-31'],
      ['MANDATORY_SECTION_14', '2026-01-01', null],
    ]);
  });

  it('refuses, naming the month, when an approved month would be levied differently', async () => {
    await withTenantContext(prisma, tenantId, async (tx) => {
      const run = await tx.payrollRun.create({
        data: { tenantId, period: new Date('2025-08-01T00:00:00.000Z'), status: 'CALCULATED', legalEmployerId: employerId, createdByStaffId: ownerStaffId },
      });
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'APPROVED' } });
    });
    const refused = await record({ effectiveFrom: '2025-07-15', hrdRegistration: 'OPTIONAL_SECTION_15', reason: 'Opted in mid-July' }).expect(409);
    expect(refused.body.message).toMatch(/Aug 2025 is approved for Demo Backdate Sdn Bhd/);
    expect(await timeline()).toEqual([
      ['NOT_REGISTERED', '2025-07-01', '2025-12-31'],
      ['MANDATORY_SECTION_14', '2026-01-01', null],
    ]);
  });
});
