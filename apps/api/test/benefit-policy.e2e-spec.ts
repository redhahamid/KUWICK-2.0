import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * THE MEDICAL BENEFIT, MINIMAL (Section F, 14 October 2026): a yearly limit
 * from the clinic's settings, pro-rated for a joiner by whole months with the
 * joining-month cut-off (decision 11), uses entered by hand, and the alert at
 * the clinic's level. Demo people only.
 */
describe('medical benefit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;

  const server = () => app.getHttpServer();
  const hire = async (fullName: string, startDate: string) =>
    (
      await request(server())
        .post('/workforce/employees')
        .set('Authorization', bearer)
        .send({ fullName, role: Role.FRONT_DESK_CLINICAL_STAFF, clinicId, employmentType: 'PERMANENT', employmentStatus: 'ACTIVE', startDate })
        .expect(201)
    ).body.staffId as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Benefit Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Benefit Clinic' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('sets up the year from the clinic limit, pro-rates a joiner, and warns when the balance runs low', async () => {
    await request(server()).post('/workforce/benefits/set-up').set('Authorization', bearer).send({ year: 2026, clinicId }).expect(400);
    await request(server())
      .put('/workforce/benefits/policy')
      .set('Authorization', bearer)
      .send({ yearlyLimit: '1200.00', joiningMonthCutoffDay: 15, alertBelowPercent: 20 })
      .expect(200);
    const longServing = await hire('Demo Staf Lama', '2024-03-01');
    const joiner = await hire('Demo Staf Baharu', '2026-04-20');

    const setUp = (await request(server()).post('/workforce/benefits/set-up').set('Authorization', bearer).send({ year: 2026, clinicId }).expect(201)).body;
    expect(setUp.created).toBe(2);
    // Pressing it again creates nothing more.
    expect((await request(server()).post('/workforce/benefits/set-up').set('Authorization', bearer).send({ year: 2026, clinicId }).expect(201)).body.created).toBe(0);

    const list = async () =>
      (await request(server()).get(`/workforce/benefits?year=2026&clinicId=${clinicId}`).set('Authorization', bearer).expect(200)).body.accounts as {
        id: string;
        staffId: string;
        allowance: number;
        alert: string | null;
      }[];
    const accounts = await list();
    const full = accounts.find((row) => row.staffId === longServing)!;
    // Joined 20 April, after the 15th: May to December, 8 months of RM1,200.
    expect(accounts.find((row) => row.staffId === joiner)!.allowance).toBe(800);
    expect(full.allowance).toBe(1200);

    await request(server())
      .post(`/workforce/benefits/${full.id}/usages`)
      .set('Authorization', bearer)
      .send({ usedAt: '2026-10-01', amount: '1000.00', notes: 'Klinik bill, demo' })
      .expect(201);
    expect((await list()).find((row) => row.staffId === longServing)!.alert).toBe('LOW');
  });
});
