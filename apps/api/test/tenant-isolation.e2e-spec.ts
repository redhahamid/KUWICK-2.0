import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, upcomingWeekday, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

// The suites below book appointments, and booking refuses the past. A fixed
// Wednesday works right up until that Wednesday arrives; this one is always
// the next Wednesday at least a week out. See upcomingWeekday in ./test-db.
const BOOKING_DAY = upcomingWeekday(3);


// Full HTTP-level proof that a caller can never see another tenant's data
// through the real API — complements rls-enforcement.e2e-spec.ts, which
// proves the same thing one layer down, directly against Postgres.
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantA: string;
  let tenantB: string;
  let bearerA: string;
  let bearerB: string;

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
    bearerA = (await createOwnerAndBearer(prisma, tenantA)).bearer;
    bearerB = (await createOwnerAndBearer(prisma, tenantB)).bearer;
  });

  // NO afterEach cleanup, deliberately: a booked appointment carries
  // append-only appointment_events rows that CANNOT be deleted — by anyone,
  // which is the point — so the appointment (and everything the FK chain
  // reaches) cannot be deleted either. kuwick_test is disposable
  // (CODING_STANDARDS.md §5) and every test uses fresh random tenants, so
  // leftover rows collide with nothing.

  it('rejects a request with no Authorization header', async () => {
    await request(app.getHttpServer()).get('/staff').expect(401);
  });

  it('rejects a syntactically valid token signed for a tenant that does not exist', async () => {
    await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', bearerFor(randomId(), randomId()))
      .expect(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = bearerFor(tenantA, randomId()).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    await request(app.getHttpServer()).get('/staff').set('Authorization', forged).expect(401);
  });

  it("a tenant cannot see another tenant's staff, by list or by direct id", async () => {
    const created = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', bearerA)
      .send({ role: 'DOCTOR_RESIDENT', fullName: 'Dr. Isolation Test' })
      .expect(201);

    const listAsA = await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', bearerA)
      .expect(200);
    // Both tenants also carry the "Test Owner" row their bearer token acts
    // as, so assert membership rather than a bare count.
    expect(listAsA.body.map((s: { id: string }) => s.id)).toContain(created.body.id);

    const listAsB = await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', bearerB)
      .expect(200);
    expect(listAsB.body.map((s: { id: string }) => s.id)).not.toContain(created.body.id);
    expect(listAsB.body.every((s: { tenantId: string }) => s.tenantId === tenantB)).toBe(true);

    // Not just filtered out of a list — a direct-by-id lookup against
    // another tenant's real id must 404, not leak the record.
    await request(app.getHttpServer())
      .get(`/staff/${created.body.id}`)
      .set('Authorization', bearerB)
      .expect(404);
  });

  it("a tenant cannot see another tenant's appointments, even with matching filters", async () => {
    const fixture = await seedBookableDoctor(prisma, tenantA);

    const appointment = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', bearerA)
      .send({
        clinicId: fixture.clinicId,
        patientId: fixture.patientId,
        staffId: fixture.staffId,
        serviceId: fixture.serviceId,
        source: 'FRONT_DESK',
        scheduledStart: `${BOOKING_DAY}T01:30:00.000Z`,
        scheduledEnd: `${BOOKING_DAY}T02:00:00.000Z`,
      })
      .expect(201);

    const listAsA = await request(app.getHttpServer())
      .get('/appointments')
      .set('Authorization', bearerA)
      .expect(200);
    expect(listAsA.body).toHaveLength(1);

    // Tenant B queries with the SAME staffId/clinicId/serviceId values —
    // if isolation depended on the app remembering to add a WHERE clause,
    // this is exactly the query shape that would leak tenant A's row.
    const listAsB = await request(app.getHttpServer())
      .get(`/appointments?staffId=${fixture.staffId}&clinicId=${fixture.clinicId}`)
      .set('Authorization', bearerB)
      .expect(200);
    expect(listAsB.body).toEqual([]);

    await request(app.getHttpServer())
      .get(`/appointments/${appointment.body.id}`)
      .set('Authorization', bearerB)
      .expect(404);
  });

  it("a tenant cannot see another tenant's items, by list or by direct id", async () => {
    const created = await request(app.getHttpServer())
      .post('/items')
      .set('Authorization', bearerA)
      .send({ name: 'Isolation Test Item', sellPrice: 12.5 })
      .expect(201);

    const listAsB = await request(app.getHttpServer())
      .get('/items')
      .set('Authorization', bearerB)
      .expect(200);
    expect(listAsB.body).toEqual([]);

    await request(app.getHttpServer())
      .get(`/items/${created.body.id}`)
      .set('Authorization', bearerB)
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
    const service = await tx.serviceCatalog.create({
      // bookable defaults FALSE (nothing goes public by accident) — this
      // fixture opts in, as the Services screen would.
      data: { tenantId, name: 'Isolation Test Service', durationMinutesDefault: 30, bookable: true },
    });
    await tx.doctorSchedule.create({
      data: {
        tenantId,
        clinicId: clinic.id,
        staffId: staff.id,
        dayOfWeek: new Date(`${BOOKING_DAY}T00:00:00.000Z`).getUTCDay(),
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
