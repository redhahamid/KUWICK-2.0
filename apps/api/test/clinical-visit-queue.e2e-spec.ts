import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';

// Covers the Clinical 1a Phase 1 acceptance points: Add to Daily Queue
// creates a Visit + QueueTicket together, the queue state machine
// (WAITING -> IN_CONSULTATION -> DISPENSARY_PAYMENT -> COMPLETED, or
// Cancelled from WAITING) enforces its guards, and AppointmentService's
// arrived() auto-creates a queue ticket (docs/PRODUCT_REQUIREMENTS.md §6).
describe('Clinical: Visit and QueueTicket (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let clinicId: string;
  let patientId: string;
  let staffId: string;

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
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Clinical Test Tenant' } }),
    );

    const clinic = await request(app.getHttpServer())
      .post('/clinics')
      .set('x-tenant-id', tenantId)
      .send({ name: 'Clinical Test Clinic' })
      .expect(201);
    clinicId = clinic.body.id;

    const patient = await request(app.getHttpServer())
      .post('/patients')
      .set('x-tenant-id', tenantId)
      .send({ identifierType: 'NRIC', identifierValue: '900101015005', name: 'Queue Test Patient' })
      .expect(201);
    patientId = patient.body.id;

    const staff = await request(app.getHttpServer())
      .post('/staff')
      .set('x-tenant-id', tenantId)
      .send({ role: 'DOCTOR_RESIDENT', fullName: 'Dr. Queue Test' })
      .expect(201);
    staffId = staff.body.id;
  });

  afterEach(async () => {
    await withTenantContext(prisma, tenantId, async (tx) => {
      await tx.queueTicket.deleteMany({ where: { tenantId } });
      await tx.visit.deleteMany({ where: { tenantId } });
      await tx.appointment.deleteMany({ where: { tenantId } });
      await tx.doctorServiceQualification.deleteMany({ where: { tenantId } });
      await tx.slotCapacityConfig.deleteMany({ where: { tenantId } });
      await tx.doctorSchedule.deleteMany({ where: { tenantId } });
      await tx.serviceCatalog.deleteMany({ where: { tenantId } });
      await tx.staff.deleteMany({ where: { tenantId } });
      await tx.patient.deleteMany({ where: { tenantId } });
      await tx.clinic.deleteMany({ where: { tenantId } });
      await tx.tenant.deleteMany({ where: { id: tenantId } });
    });
  });

  it('Add to Daily Queue creates a Visit and a WAITING ticket, then walks the full lifecycle', async () => {
    const added = await request(app.getHttpServer())
      .post('/queue-tickets')
      .set('x-tenant-id', tenantId)
      .send({ clinicId, patientId, staffId, billingType: 'Self-pay', presentingComplaint: 'Fever' })
      .expect(201);

    expect(added.body.status).toBe('WAITING');
    expect(added.body.ticketNumber).toBe(1);
    expect(added.body.visit.visitNumber).toMatch(/^V-\d{6}$/);

    const ticketId = added.body.id;

    await request(app.getHttpServer())
      .patch(`/queue-tickets/${ticketId}/arrived`)
      .set('x-tenant-id', tenantId)
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('IN_CONSULTATION'));

    // Cannot mark arrived twice.
    await request(app.getHttpServer())
      .patch(`/queue-tickets/${ticketId}/arrived`)
      .set('x-tenant-id', tenantId)
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/queue-tickets/${ticketId}/move-to-dispensary`)
      .set('x-tenant-id', tenantId)
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('DISPENSARY_PAYMENT'));

    await request(app.getHttpServer())
      .patch(`/queue-tickets/${ticketId}/complete`)
      .set('x-tenant-id', tenantId)
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('COMPLETED'));

    const visit = await request(app.getHttpServer())
      .get(`/visits/${added.body.visit.id}`)
      .set('x-tenant-id', tenantId)
      .expect(200);
    expect(visit.body.checkOutAt).not.toBeNull();
  });

  it('ticket numbers count up per clinic per day, and Cancel is only valid before completion', async () => {
    const first = await request(app.getHttpServer())
      .post('/queue-tickets')
      .set('x-tenant-id', tenantId)
      .send({ clinicId, patientId, staffId, billingType: 'Self-pay' })
      .expect(201);
    expect(first.body.ticketNumber).toBe(1);

    const second = await request(app.getHttpServer())
      .post('/queue-tickets')
      .set('x-tenant-id', tenantId)
      .send({ clinicId, patientId, staffId, billingType: 'Self-pay' })
      .expect(201);
    expect(second.body.ticketNumber).toBe(2);

    await request(app.getHttpServer())
      .patch(`/queue-tickets/${second.body.id}/cancel`)
      .set('x-tenant-id', tenantId)
      .send({ cancelReason: 'Patient left' })
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('CANCELLED'));

    // Cannot cancel an already-cancelled ticket.
    await request(app.getHttpServer())
      .patch(`/queue-tickets/${second.body.id}/cancel`)
      .set('x-tenant-id', tenantId)
      .expect(400);
  });

  it("AppointmentService.arrived() auto-creates a queue ticket (PRODUCT_REQUIREMENTS.md §6)", async () => {
    const service = await request(app.getHttpServer())
      .post('/services')
      .set('x-tenant-id', tenantId)
      .send({ name: 'Consultation', durationMinutesDefault: 30 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/doctor-service-qualifications')
      .set('x-tenant-id', tenantId)
      .send({ staffId, serviceId: service.body.id })
      .expect(201);
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.doctorSchedule.create({
        data: {
          tenantId,
          clinicId,
          staffId,
          dayOfWeek: new Date('2026-08-05T00:00:00.000Z').getUTCDay(),
          startTime: new Date('1970-01-01T09:00:00.000Z'),
          endTime: new Date('1970-01-01T17:00:00.000Z'),
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        },
      }),
    );

    const appointment = await request(app.getHttpServer())
      .post('/appointments')
      .set('x-tenant-id', tenantId)
      .send({
        clinicId,
        patientId,
        staffId,
        serviceId: service.body.id,
        source: 'FRONT_DESK',
        scheduledStart: '2026-08-05T09:00:00.000Z',
        scheduledEnd: '2026-08-05T09:30:00.000Z',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/appointments/${appointment.body.id}/arrived`)
      .set('x-tenant-id', tenantId)
      .expect(200);

    const tickets = await request(app.getHttpServer())
      .get(`/queue-tickets?clinicId=${clinicId}`)
      .set('x-tenant-id', tenantId)
      .expect(200);
    expect(tickets.body).toHaveLength(1);
    expect(tickets.body[0].visit.patient.id).toBe(patientId);
  });
});
