import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/*
 * THE HOLIDAY STARTING LIST (new-clinic UAT #2, 1 November 2026): the state
 * chosen is remembered for the next visit (item 64).
 */
describe('public holiday starting list (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
    tenantId = crypto.randomUUID();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Holiday Presets Tenant' } }));
    owner = (await createOwnerAndBearer(prisma, tenantId)).bearer;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('remembers the state the holidays were loaded for', async () => {
    const list = await request(server()).get('/public-holidays/presets?year=2026&state=Selangor').set('Authorization', owner).expect(200);
    const dates = (list.body.holidays as { date: string }[]).slice(0, 2).map((row) => row.date);
    await request(server()).post('/public-holidays/presets').set('Authorization', owner).send({ year: 2026, state: 'Selangor', dates }).expect(201);
    const remembered = await request(server()).get('/global-settings/hr.holidayState').set('Authorization', owner).expect(200);
    expect(remembered.body).toEqual({ state: 'Selangor' });
  });
});
