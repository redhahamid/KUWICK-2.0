import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';

// Full HTTP-level proof that a caller can never see another tenant's data
// through the real API — complements rls-enforcement.e2e-spec.ts, which
// proves the same thing one layer down, directly against Postgres.
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    tenantA = randomId();
    tenantB = randomId();
    await withTenantContext(prisma, tenantA, (tx) =>
      tx.tenant.create({ data: { id: tenantA, name: 'Tenant A' } }),
    );
    await withTenantContext(prisma, tenantB, (tx) =>
      tx.tenant.create({ data: { id: tenantB, name: 'Tenant B' } }),
    );
  });

  afterEach(async () => {
    // Deleting the tenant row is enough: every other table in these tests
    // has an ON DELETE RESTRICT foreign key to tenants, so child rows are
    // deleted first via a broad per-tenant cleanup, then the tenant itself.
    for (const tenantId of [tenantA, tenantB]) {
      await withTenantContext(prisma, tenantId, async (tx) => {
        await tx.item.deleteMany({ where: { tenantId } });
        await tx.appointment.deleteMany({ where: { tenantId } });
        await tx.doctorServiceQualification.deleteMany({ where: { tenantId } });
        await tx.slotCapacityConfig.deleteMany({ where: { tenantId } });
        await tx.doctorSchedule.deleteMany({ where: { tenantId } });
        await tx.service.deleteMany({ where: { tenantId } });
        await tx.staff.deleteMany({ where: { tenantId } });
        await tx.patient.deleteMany({ where: { tenantId } });
        await tx.clinic.deleteMany({ where: { tenantId } });
        await tx.tenant.deleteMany({ where: { id: tenantId } });
      });
    }
  });

  it('rejects a request with no x-tenant-id header', async () => {
    await request(app.getHttpServer()).get('/staff').expect(400);
  });

  it('rejects a request carrying an unknown tenant id', async () => {
    await request(app.getHttpServer()).get('/staff').set('x-tenant-id', randomId()).expect(401);
  });

  it("a tenant cannot see another tenant's staff, by list or by direct id", async () => {
    const created = await request(app.getHttpServer())
      .post('/staff')
      .set('x-tenant-id', tenantA)
      .send({ role: 'DOCTOR_RESIDENT', fullName: 'Dr. Isolation Test' })
      .expect(201);

    const listAsA = await request(app.getHttpServer())
      .get('/staff')
      .set('x-tenant-id', tenantA)
      .expect(200);
    expect(listAsA.body).toHaveLength(1);

    const listAsB = await request(app.getHttpServer())
      .get('/staff')
      .set('x-tenant-id', tenantB)
      .expect(200);
    expect(listAsB.body).toEqual([]);

    // Not just filtered out of a list — a direct-by-id lookup against
    // another tenant's real id must 404, not leak the record.
    await request(app.getHttpServer())
      .get(`/staff/${created.body.id}`)
      .set('x-tenant-id', tenantB)
      .expect(404);
  });

  it("a tenant cannot see another tenant's appointments, even with matching filters", async () => {
    const fixture = await seedBookableDoctor(prisma, tenantA);

    const appointment = await request(app.getHttpServer())
      .post('/appointments')
      .set('x-tenant-id', tenantA)
      .send({
        clinicId: fixture.clinicId,
        patientId: fixture.patientId,
        staffId: fixture.staffId,
        serviceId: fixture.serviceId,
        source: 'FRONT_DESK',
        scheduledStart: '2026-08-05T09:00:00.000Z',
        scheduledEnd: '2026-08-05T09:30:00.000Z',
      })
      .expect(201);

    const listAsA = await request(app.getHttpServer())
      .get('/appointments')
      .set('x-tenant-id', tenantA)
      .expect(200);
    expect(listAsA.body).toHaveLength(1);

    // Tenant B queries with the SAME staffId/clinicId/serviceId values —
    // if isolation depended on the app remembering to add a WHERE clause,
    // this is exactly the query shape that would leak tenant A's row.
    const listAsB = await request(app.getHttpServer())
      .get(`/appointments?staffId=${fixture.staffId}&clinicId=${fixture.clinicId}`)
      .set('x-tenant-id', tenantB)
      .expect(200);
    expect(listAsB.body).toEqual([]);

    await request(app.getHttpServer())
      .get(`/appointments/${appointment.body.id}`)
      .set('x-tenant-id', tenantB)
      .expect(404);
  });

  it("a tenant cannot see another tenant's items, by list or by direct id", async () => {
    const created = await request(app.getHttpServer())
      .post('/items')
      .set('x-tenant-id', tenantA)
      .send({ name: 'Isolation Test Item', sellPrice: 12.5 })
      .expect(201);

    const listAsB = await request(app.getHttpServer())
      .get('/items')
      .set('x-tenant-id', tenantB)
      .expect(200);
    expect(listAsB.body).toEqual([]);

    await request(app.getHttpServer())
      .get(`/items/${created.body.id}`)
      .set('x-tenant-id', tenantB)
      .expect(404);
  });
});

interface BookableDoctorFixture {
  clinicId: string;
  patientId: string;
  staffId: string;
  serviceId: string;
}

// Sets up everything a POST /appointments call needs — clinic and patient
// created directly (no Core API for them yet), staff/service/schedule/
// qualification through the real tenant-scoped Prisma client, matching
// what the app itself would write.
async function seedBookableDoctor(prisma: PrismaClient, tenantId: string): Promise<BookableDoctorFixture> {
  return withTenantContext(prisma, tenantId, async (tx) => {
    const clinic = await tx.clinic.create({ data: { tenantId, name: 'Isolation Test Clinic' } });
    const patient = await tx.patient.create({
      data: {
        tenantId,
        identifierType: 'NRIC',
        identifierValue: randomId().replace(/-/g, '').slice(0, 12),
        name: 'Isolation Test Patient',
      },
    });
    const staff = await tx.staff.create({
      data: { tenantId, role: Role.DOCTOR_RESIDENT, fullName: 'Dr. Isolation Fixture' },
    });
    const service = await tx.service.create({
      data: { tenantId, name: 'Isolation Test Service', durationMinutesDefault: 30 },
    });
    await tx.doctorSchedule.create({
      data: {
        tenantId,
        clinicId: clinic.id,
        staffId: staff.id,
        dayOfWeek: new Date('2026-08-05T00:00:00.000Z').getUTCDay(),
        startTime: new Date('1970-01-01T09:00:00.000Z'),
        endTime: new Date('1970-01-01T12:00:00.000Z'),
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    await tx.doctorServiceQualification.create({
      data: { tenantId, staffId: staff.id, serviceId: service.id },
    });

    return { clinicId: clinic.id, patientId: patient.id, staffId: staff.id, serviceId: service.id };
  });
}
