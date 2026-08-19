import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppointmentStatus, PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { bearerFor, createOwnerAndBearer } from './auth';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';

// §4–§5 of the pre-merge hardening pass.
//
// §4 — the deposit's whole life: applied to the invoice once and only once,
// carried across a reschedule, released when the invoice it sat on is
// cancelled, never invented when nothing was paid. Kuwick has NO payment
// gateway (docs/APPOINTMENT_SCHEDULING.md §9–10): `bookingFeePaidAt` is
// written by whatever collects the money (today: nothing in this repo, one
// day: a gateway callback), so these tests set it directly — the tests are
// about what the money DOES once it is known to be paid. Webhook retry /
// duplicate-callback scenarios are therefore not applicable and deliberately
// absent rather than faked.
//
// §5 — check-in cannot mint duplicates: one appointment becomes at most one
// visit and one live ticket, even when two counters click together. The
// sequential double is refused by the status gate; the concurrent double is
// refused by the two atomic claims inside checkIn().
//
// NO cleanup (append-only history; disposable DB; fresh random tenants).
describe('Deposit lifecycle and check-in concurrency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let clinicId: string;
  let doctorId: string;
  let serviceId: string;
  let ownerBearer: string;
  let doctorBearer: string;
  let patientSeq = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: 'Deposit Lifecycle Tenant' } });
      const clinic = await tx.clinic.create({ data: { tenantId, name: 'Deposit Clinic' } });
      clinicId = clinic.id;
      const doctor = await tx.staff.create({
        data: { tenantId, role: Role.DOCTOR_RESIDENT, fullName: 'Dr Deposit', clinicId },
      });
      doctorId = doctor.id;
      const service = await tx.serviceCatalog.create({
        data: { tenantId, name: 'Deposit Consultation', durationMinutesDefault: 30, bookable: true, bookingFee: 50 },
      });
      serviceId = service.id;
      await tx.doctorServiceQualification.create({ data: { tenantId, staffId: doctorId, serviceId } });
      // A round-the-clock, all-week roster: the reschedule test goes through
      // the real validator, which insists the target is a rostered grid slot.
      for (let day = 0; day <= 6; day += 1) {
        await tx.doctorSchedule.create({
          data: {
            tenantId,
            clinicId,
            staffId: doctorId,
            dayOfWeek: day,
            startTime: new Date('1970-01-01T00:00:00.000Z'),
            endTime: new Date('1970-01-01T23:30:00.000Z'),
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          },
        });
      }
    });
    const owner = await createOwnerAndBearer(prisma, tenantId);
    ownerBearer = owner.bearer;
    doctorBearer = bearerFor(tenantId, doctorId, Role.DOCTOR_RESIDENT);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  /** A CONFIRMED appointment with a booking fee, optionally already paid. */
  async function seedAppointment(options: { feePaid: boolean; fee?: number } = { feePaid: false }) {
    patientSeq += 1;
    const seq = patientSeq; // captured NOW — parallel seeds must not share a closure
    return withTenantContext(prisma, tenantId, async (tx) => {
      const patient = await tx.patient.create({
        data: {
          tenantId,
          identifierType: 'NRIC',
          identifierValue: `DEP${String(seq).padStart(4, '0')}${randomId().slice(0, 5)}`,
          name: `Deposit Patient ${seq}`,
        },
      });
      const appointment = await tx.appointment.create({
        data: {
          tenantId,
          clinicId,
          patientId: patient.id,
          staffId: doctorId,
          serviceId,
          source: 'ONLINE_PORTAL',
          status: AppointmentStatus.CONFIRMED,
          // Its own hour per seed: appointments_no_overlap EXCLUDEs any two
          // live bookings of one doctor from sharing a moment.
          scheduledStart: new Date(Date.UTC(2026, 8, 2, seq, 0, 0)),
          scheduledEnd: new Date(Date.UTC(2026, 8, 2, seq, 30, 0)),
          bookingFeeAmount: options.fee ?? 50,
          // The DB refuses paid_at with a zero fee ("a payment that names no
          // amount is not a payment"), so a zero-fee seed is simply unpaid.
          bookingFeePaidAt: options.feePaid && (options.fee ?? 50) > 0 ? new Date() : null,
          paymentStatus:
            (options.fee ?? 50) === 0 ? 'NOT_REQUIRED' : options.feePaid ? 'PAID' : 'PENDING',
          manageToken: `dep${randomId().replace(/-/g, '')}`.slice(0, 43),
        },
      });
      return { appointmentId: appointment.id, patientId: patient.id };
    });
  }

  function checkInViaApi(appointmentId: string) {
    return request(app.getHttpServer())
      .patch(`/appointments/${appointmentId}/arrived`)
      .set('Authorization', ownerBearer);
  }

  function createInvoice(visitId: string) {
    return request(app.getHttpServer())
      .post('/invoices')
      .set('Authorization', doctorBearer)
      .send({ visitId, createdByStaffId: doctorId });
  }

  // ── §4 the deposit ────────────────────────────────────────────────────────

  it('a PAID booking fee is applied to the visit invoice exactly once, with a PAYMENT_CHANGED event', async () => {
    const { appointmentId } = await seedAppointment({ feePaid: true });
    const checkedIn = await checkInViaApi(appointmentId).expect(200);
    const visitId = checkedIn.body.visitId as string;

    const invoice = await createInvoice(visitId).expect(201);
    expect(String(invoice.body.patientPaidAmount)).toBe('50');

    const row = await withTenantContext(prisma, tenantId, (tx) =>
      tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } }),
    );
    expect(row.depositInvoiceId).toBe(invoice.body.id);

    const events = await withTenantContext(prisma, tenantId, (tx) =>
      tx.appointmentEvent.findMany({ where: { appointmentId, eventType: 'PAYMENT_CHANGED' } }),
    );
    expect(events).toHaveLength(1);

    // A SECOND invoice on the same visit gets nothing: the single-valued
    // link on the appointment is the double-application guard.
    const second = await createInvoice(visitId).expect(201);
    expect(String(second.body.patientPaidAmount)).toBe('0');
    const after = await withTenantContext(prisma, tenantId, (tx) =>
      tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } }),
    );
    expect(after.depositInvoiceId).toBe(invoice.body.id);
  });

  it('an UNPAID booking fee is never applied, and a zero-fee appointment writes no payment event', async () => {
    const unpaid = await seedAppointment({ feePaid: false });
    const visit1 = (await checkInViaApi(unpaid.appointmentId).expect(200)).body.visitId;
    const invoice1 = await createInvoice(visit1).expect(201);
    expect(String(invoice1.body.patientPaidAmount)).toBe('0');

    const zeroFee = await seedAppointment({ feePaid: true, fee: 0 });
    const visit2 = (await checkInViaApi(zeroFee.appointmentId).expect(200)).body.visitId;
    const invoice2 = await createInvoice(visit2).expect(201);
    expect(String(invoice2.body.patientPaidAmount)).toBe('0');
    const events = await withTenantContext(prisma, tenantId, (tx) =>
      tx.appointmentEvent.findMany({
        where: { appointmentId: zeroFee.appointmentId, eventType: 'PAYMENT_CHANGED' },
      }),
    );
    expect(events).toHaveLength(0);
  });

  it('cancelling the invoice RELEASES the deposit, and the replacement invoice receives it', async () => {
    const { appointmentId } = await seedAppointment({ feePaid: true });
    const visitId = (await checkInViaApi(appointmentId).expect(200)).body.visitId;

    const first = await createInvoice(visitId).expect(201);
    expect(String(first.body.patientPaidAmount)).toBe('50');

    await request(app.getHttpServer())
      .patch(`/invoices/${first.body.id}/cancel`)
      .set('Authorization', ownerBearer)
      .send({ cancelReason: 'Raised against the wrong items' })
      .expect(200);

    const released = await withTenantContext(prisma, tenantId, (tx) =>
      tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } }),
    );
    expect(released.depositInvoiceId).toBeNull();

    // The replacement invoice picks the deposit up again — the patient's
    // money follows the LIVE bill, not the mistake.
    const replacement = await createInvoice(visitId).expect(201);
    expect(String(replacement.body.patientPaidAmount)).toBe('50');
    const relinked = await withTenantContext(prisma, tenantId, (tx) =>
      tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } }),
    );
    expect(relinked.depositInvoiceId).toBe(replacement.body.id);

    // Applied → released → applied = three PAYMENT_CHANGED events. The
    // history tells the whole story; the live link tells the current truth.
    const events = await withTenantContext(prisma, tenantId, (tx) =>
      tx.appointmentEvent.findMany({
        where: { appointmentId, eventType: 'PAYMENT_CHANGED' },
        orderBy: { occurredAt: 'asc' },
      }),
    );
    expect(events).toHaveLength(3);
  });

  it('a staff reschedule carries the paid fee to the replacement, which then reconciles once', async () => {
    const { appointmentId } = await seedAppointment({ feePaid: true });

    const moved = await request(app.getHttpServer())
      .patch(`/appointments/${appointmentId}/reschedule`)
      .set('Authorization', ownerBearer)
      // Into the free half of its own hour — no other seed can collide.
      .send({
        scheduledStart: new Date(Date.UTC(2026, 8, 2, patientSeq, 30, 0)).toISOString(),
        scheduledEnd: new Date(Date.UTC(2026, 8, 2, patientSeq + 1, 0, 0)).toISOString(),
      })
      .expect(200);
    const replacementId = moved.body.id as string;
    expect(replacementId).not.toBe(appointmentId);

    const replacement = await withTenantContext(prisma, tenantId, (tx) =>
      tx.appointment.findUniqueOrThrow({ where: { id: replacementId } }),
    );
    expect(String(replacement.bookingFeeAmount)).toBe('50');
    expect(replacement.bookingFeePaidAt).not.toBeNull();
    expect(replacement.depositInvoiceId).toBeNull();

    // The ORIGINAL still carries its paid stamp too — but only the
    // REPLACEMENT is checked in, so only one invoice ever sees the money.
    const visitId = (await checkInViaApi(replacementId).expect(200)).body.visitId;
    const invoice = await createInvoice(visitId).expect(201);
    expect(String(invoice.body.patientPaidAmount)).toBe('50');
  });

  it('cancelling before any invoice leaves the paid fee intact on the appointment for the clinic to settle by hand', async () => {
    const { appointmentId } = await seedAppointment({ feePaid: true });
    await request(app.getHttpServer())
      .patch(`/appointments/${appointmentId}/cancel`)
      .set('Authorization', ownerBearer)
      .send({ reason: 'Patient called to cancel' })
      .expect(200);

    const row = await withTenantContext(prisma, tenantId, (tx) =>
      tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } }),
    );
    expect(row.status).toBe('CANCELLED');
    expect(row.bookingFeePaidAt).not.toBeNull();
    expect(row.depositInvoiceId).toBeNull();
  });

  // ── §5 check-in cannot mint duplicates ───────────────────────────────────

  it('a sequential second check-in is refused by the status gate', async () => {
    const { appointmentId } = await seedAppointment({ feePaid: false });
    await checkInViaApi(appointmentId).expect(200);
    const second = await checkInViaApi(appointmentId);
    expect(second.status).toBe(400);
  });

  it('TWO CONCURRENT check-ins from CONFIRMED produce exactly one visit and one live ticket', async () => {
    const { appointmentId, patientId } = await seedAppointment({ feePaid: false });

    const [a, b] = await Promise.all([checkInViaApi(appointmentId), checkInViaApi(appointmentId)]);
    const statuses = [a.status, b.status].sort();
    // One winner; the loser is told it lost (409) — or, if it raced past
    // the first claim before the winner committed, the status gate catches
    // it (400). Either refusal is correct; silence would not be.
    expect(statuses[0]).toBe(200);
    expect([400, 409]).toContain(statuses[1]);

    const visits = await withTenantContext(prisma, tenantId, (tx) =>
      tx.visit.findMany({ where: { patientId } }),
    );
    expect(visits).toHaveLength(1);
    const liveTickets = await withTenantContext(prisma, tenantId, (tx) =>
      tx.queueTicket.findMany({ where: { visitId: visits[0].id, status: { not: 'CANCELLED' } } }),
    );
    expect(liveTickets).toHaveLength(1);
  });

  it('TWO CONCURRENT check-ins from ARRIVED leave one live ticket; the duplicate is auto-cancelled with its reason recorded', async () => {
    const { appointmentId, patientId } = await seedAppointment({ feePaid: false });
    await request(app.getHttpServer())
      .patch(`/appointments/${appointmentId}/mark-arrived`)
      .set('Authorization', ownerBearer)
      .expect(200);

    const [a, b] = await Promise.all([checkInViaApi(appointmentId), checkInViaApi(appointmentId)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect([400, 409]).toContain(statuses[1]);

    const appointment = await withTenantContext(prisma, tenantId, (tx) =>
      tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } }),
    );
    expect(appointment.status).toBe('CHECKED_IN');
    expect(appointment.visitId).not.toBeNull();

    // However the race fell, the patient holds exactly ONE live ticket, and
    // any duplicate the loser minted is CANCELLED, visibly, with a reason.
    const tickets = await withTenantContext(prisma, tenantId, (tx) =>
      tx.queueTicket.findMany({ where: { visit: { patientId } } }),
    );
    const live = tickets.filter((t) => t.status !== 'CANCELLED');
    expect(live).toHaveLength(1);
    expect(live[0].visitId).toBe(appointment.visitId);
    for (const dup of tickets.filter((t) => t.status === 'CANCELLED')) {
      expect(dup.cancelReason).toContain('Duplicate check-in');
    }
  });

  it('TWO CONCURRENT walk-in registrations get DIFFERENT ticket numbers', async () => {
    // The other duplicate §5 forbids: count-plus-one numbering under
    // concurrency used to hand two different patients the same "A007".
    const [p1, p2] = await withTenantContext(prisma, tenantId, async (tx) => {
      const mk = (n: number) =>
        tx.patient.create({
          data: {
            tenantId,
            identifierType: 'NRIC',
            identifierValue: `WLK${randomId().slice(0, 9)}${n}`,
            name: `Walk-in Patient ${n}`,
          },
        });
      return [await mk(1), await mk(2)];
    });
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post('/queue-tickets')
        .set('Authorization', ownerBearer)
        .send({ clinicId, patientId: p1.id, staffId: doctorId, billingType: 'Self-pay' }),
      request(app.getHttpServer())
        .post('/queue-tickets')
        .set('Authorization', ownerBearer)
        .send({ clinicId, patientId: p2.id, staffId: doctorId, billingType: 'Self-pay' }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.displayNumber).not.toBe(b.body.displayNumber);
    expect(a.body.ticketNumber).not.toBe(b.body.ticketNumber);
  });

  it('check-in on a cancelled appointment is refused', async () => {
    const { appointmentId } = await seedAppointment({ feePaid: false });
    await request(app.getHttpServer())
      .patch(`/appointments/${appointmentId}/cancel`)
      .set('Authorization', ownerBearer)
      .send({ reason: 'Cancelled first' })
      .expect(200);
    const refused = await checkInViaApi(appointmentId);
    expect(refused.status).toBe(400);
  });
});
