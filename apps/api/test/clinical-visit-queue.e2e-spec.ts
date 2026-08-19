import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

// Covers the Clinical 1a Phase 1 acceptance points: Add to Daily Queue
// creates a Visit + QueueTicket together, the queue state machine
// (WAITING -> IN_CONSULTATION -> DISPENSARY_PAYMENT -> COMPLETED, or
// Cancelled from WAITING) enforces its guards, and AppointmentService's
// arrived() auto-creates a queue ticket (docs/PRODUCT_REQUIREMENTS.md §6).
describe('Clinical: Visit and QueueTicket (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
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
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;

    const clinic = await request(app.getHttpServer())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Clinical Test Clinic' })
      .expect(201);
    clinicId = clinic.body.id;

    const patient = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', bearer)
      .send({ identifierType: 'NRIC', identifierValue: '900101015005', name: 'Queue Test Patient' })
      .expect(201);
    patientId = patient.body.id;

    const staff = await request(app.getHttpServer())
      .post('/staff')
      .set('Authorization', bearer)
      .send({ role: 'DOCTOR_RESIDENT', fullName: 'Dr. Queue Test' })
      .expect(201);
    staffId = staff.body.id;
  });

  // NO afterEach cleanup, deliberately: visits and appointments carry
  // append-only history (visit_workflow_events per D-083, appointment_events
  // per the a_history_anyone_can_rewrite migration) that CANNOT be deleted —
  // by anyone, which is the point — so their parents cannot be deleted
  // either. kuwick_test is disposable (CODING_STANDARDS.md §5) and every
  // test uses a fresh random tenant, so leftover rows collide with nothing.

  it('Add to Daily Queue creates a Visit and a WAITING ticket, then walks the full lifecycle', async () => {
    const added = await request(app.getHttpServer())
      .post('/queue-tickets')
      .set('Authorization', bearer)
      .send({ clinicId, patientId, staffId, billingType: 'Self-pay', presentingComplaint: 'Fever' })
      .expect(201);

    expect(added.body.status).toBe('WAITING');
    expect(added.body.ticketNumber).toBe(1);
    expect(added.body.visit.visitNumber).toMatch(/^V-\d{6}$/);

    const ticketId = added.body.id;

    await request(app.getHttpServer())
      .patch(`/queue-tickets/${ticketId}/arrived`)
      .set('Authorization', bearer)
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('IN_CONSULTATION'));

    // Marking arrived twice is a double-click, not an error (D-094): the
    // repeat succeeds, changes nothing, and records NO second
    // CONSULTATION_STARTED in the workflow history.
    await request(app.getHttpServer())
      .patch(`/queue-tickets/${ticketId}/arrived`)
      .set('Authorization', bearer)
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('IN_CONSULTATION'));
    const startEvents = await withTenantContext(prisma, tenantId, (tx) =>
      tx.visitWorkflowEvent.findMany({
        where: { tenantId, queueTicketId: ticketId, eventType: 'CONSULTATION_STARTED' },
      }),
    );
    expect(startEvents).toHaveLength(1);

    // D-086/D-087: the doctor finishes their part first — a CLINICAL act,
    // so it must be the doctor's own session (an OWNER_ADMIN is refused; the
    // owner is an administrator, not a clinician, unless given DOCTOR
    // explicitly). The destination is DERIVED: a bare visit with no
    // prescriptions and no invoice routes to the counter for billing review.
    const doctorBearer = bearerFor(tenantId, staffId, Role.DOCTOR_RESIDENT);
    await request(app.getHttpServer())
      .patch(`/visits/${added.body.visit.id}/complete-doctor-phase`)
      .set('Authorization', doctorBearer)
      .expect(200)
      // A bare visit has nothing downstream — no dispensing, no bill — so
      // the destination derives to NONE and the ticket stays where it is,
      // which is itself a completable state.
      .expect((res) => expect(res.body.destination).toBe('NONE'))
      .expect((res) => expect(res.body.queueStatus).toBe('IN_CONSULTATION'));

    await request(app.getHttpServer())
      .patch(`/queue-tickets/${ticketId}/complete`)
      .set('Authorization', bearer)
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('COMPLETED'));

    const visit = await request(app.getHttpServer())
      .get(`/visits/${added.body.visit.id}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(visit.body.checkOutAt).not.toBeNull();
  });

  it('ticket numbers count up per clinic per day, and Cancel is only valid before completion', async () => {
    const first = await request(app.getHttpServer())
      .post('/queue-tickets')
      .set('Authorization', bearer)
      .send({ clinicId, patientId, staffId, billingType: 'Self-pay' })
      .expect(201);
    expect(first.body.ticketNumber).toBe(1);

    const second = await request(app.getHttpServer())
      .post('/queue-tickets')
      .set('Authorization', bearer)
      .send({ clinicId, patientId, staffId, billingType: 'Self-pay' })
      .expect(201);
    expect(second.body.ticketNumber).toBe(2);

    await request(app.getHttpServer())
      .patch(`/queue-tickets/${second.body.id}/cancel`)
      .set('Authorization', bearer)
      .send({ cancelReason: 'Patient left' })
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('CANCELLED'));

    // Cancelling an already-cancelled ticket is idempotent: the repeat
    // succeeds, and critically records NO second cancellation event.
    await request(app.getHttpServer())
      .patch(`/queue-tickets/${second.body.id}/cancel`)
      .set('Authorization', bearer)
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('CANCELLED'));
    const cancelEvents = await withTenantContext(prisma, tenantId, (tx) =>
      tx.visitWorkflowEvent.findMany({
        where: { tenantId, queueTicketId: second.body.id, newStatus: 'CANCELLED' },
      }),
    );
    expect(cancelEvents).toHaveLength(1);
  });

  it("AppointmentService.arrived() auto-creates a queue ticket (PRODUCT_REQUIREMENTS.md §6)", async () => {
    const service = await request(app.getHttpServer())
      .post('/services')
      .set('Authorization', bearer)
      .send({ name: 'Consultation', durationMinutesDefault: 30 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/doctor-service-qualifications')
      .set('Authorization', bearer)
      .send({ staffId, serviceId: service.body.id })
      .expect(201);
    // ServiceCatalog.bookable defaults FALSE — nothing is bookable by
    // accident — and enabling it is only legal once a doctor is mapped,
    // which is why it happens after the qualification above.
    await request(app.getHttpServer())
      .patch(`/services/${service.body.id}/booking`)
      .set('Authorization', bearer)
      .send({ bookable: true })
      .expect(200);
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.doctorSchedule.create({
        data: {
          tenantId,
          clinicId,
          staffId,
          dayOfWeek: new Date('2026-08-26T00:00:00.000Z').getUTCDay(),
          startTime: new Date('1970-01-01T09:00:00.000Z'),
          endTime: new Date('1970-01-01T17:00:00.000Z'),
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        },
      }),
    );

    const appointment = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', bearer)
      .send({
        clinicId,
        patientId,
        staffId,
        serviceId: service.body.id,
        source: 'FRONT_DESK',
        scheduledStart: '2026-08-26T01:30:00.000Z',
        scheduledEnd: '2026-08-26T02:00:00.000Z',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/appointments/${appointment.body.id}/arrived`)
      .set('Authorization', bearer)
      .expect(200);

    const tickets = await request(app.getHttpServer())
      .get(`/queue-tickets?clinicId=${clinicId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(tickets.body).toHaveLength(1);
    expect(tickets.body[0].visit.patient.id).toBe(patientId);
  });
});
