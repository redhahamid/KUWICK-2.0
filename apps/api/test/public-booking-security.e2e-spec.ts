import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';

// §2–§3 of the pre-merge hardening pass: the UNAUTHENTICATED surface, tested
// the way an attacker would use it — wrong slugs, other tenants' uuids,
// forged tokens, probing for oracles. Negative tests, deliberately: the
// happy path already has its own coverage.
//
// Fixtures are built directly in the database (two full tenants, each with a
// published page), and NOTHING here authenticates: every request below is
// exactly what any stranger on the internet can send.
//
// NO cleanup — bookings write append-only appointment_events that cannot be
// deleted (that is their point), so their parents cannot be either.
// kuwick_test is disposable and every id is a fresh uuid.
describe('Public booking surface security (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  // Tenant A — the clinic under test.
  let tenantA: string;
  let slugA: string;
  let clinicA: string;
  let doctorA: string;
  let serviceA: string; // bookable
  let hiddenServiceA: string; // bookable: false — must never surface
  let inactiveServiceA: string; // active: false — must never surface

  // Tenant B — the neighbour whose data must stay invisible.
  let tenantB: string;
  let slugB: string;
  let serviceB: string; // bookable in B, must not be reachable via A

  // A Wednesday well inside the booking window; the seeded roster covers
  // Wednesdays 09:00–17:00 clinic time (Asia/Kuala_Lumpur, the default), so
  // 01:30Z = 09:30 local is a real grid slot.
  const DAY = '2026-08-26';
  const SLOT_START = '2026-08-26T01:30:00.000Z';
  const SLOT_END = '2026-08-26T02:00:00.000Z';

  async function seedTenant(name: string): Promise<{
    tenantId: string;
    slug: string;
    clinicId: string;
    doctorId: string;
    serviceId: string;
  }> {
    const tenantId = randomId();
    const slug = `sec-${randomId().slice(0, 8)}`;
    return withTenantContext(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name } });
      const clinic = await tx.clinic.create({ data: { tenantId, name: `${name} Clinic` } });
      const doctor = await tx.staff.create({
        data: { tenantId, role: Role.DOCTOR_RESIDENT, fullName: `Dr ${name}`, clinicId: clinic.id },
      });
      const service = await tx.serviceCatalog.create({
        data: {
          tenantId,
          name: `${name} Consultation`,
          durationMinutesDefault: 30,
          bookable: true,
          price: 60,
          priceDisplay: 'HIDDEN',
        },
      });
      await tx.doctorServiceQualification.create({
        data: { tenantId, staffId: doctor.id, serviceId: service.id },
      });
      await tx.doctorSchedule.create({
        data: {
          tenantId,
          clinicId: clinic.id,
          staffId: doctor.id,
          dayOfWeek: 3, // Wednesday
          startTime: new Date('1970-01-01T09:00:00.000Z'),
          endTime: new Date('1970-01-01T17:00:00.000Z'),
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        },
      });
      await tx.clinicBookingPage.create({
        data: {
          tenantId,
          clinicId: clinic.id,
          slug,
          displayName: `${name} Booking`,
          active: true,
          allowPatientReschedule: true,
          allowPatientCancel: true,
          patientChangeCutoffHours: 4,
        },
      });
      return { tenantId, slug, clinicId: clinic.id, doctorId: doctor.id, serviceId: service.id };
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    const a = await seedTenant('SecA');
    tenantA = a.tenantId;
    slugA = a.slug;
    clinicA = a.clinicId;
    doctorA = a.doctorId;
    serviceA = a.serviceId;

    const b = await seedTenant('SecB');
    tenantB = b.tenantId;
    slugB = b.slug;
    serviceB = b.serviceId;

    [hiddenServiceA, inactiveServiceA] = await withTenantContext(prisma, tenantA, async (tx) => {
      const hidden = await tx.serviceCatalog.create({
        data: { tenantId: tenantA, name: 'Unpublished Procedure', durationMinutesDefault: 30, bookable: false },
      });
      const inactive = await tx.serviceCatalog.create({
        data: { tenantId: tenantA, name: 'Retired Service', durationMinutesDefault: 30, bookable: true, active: false },
      });
      return [hidden.id, inactive.id];
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  function book(slug: string, overrides: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post(`/public/booking/${slug}/book`)
      .send({
        serviceId: serviceA,
        staffId: doctorA,
        scheduledStart: SLOT_START,
        scheduledEnd: SLOT_END,
        name: 'Siti Aminah',
        phone: '0123456789',
        ...overrides,
      });
  }

  // ── the page itself ───────────────────────────────────────────────────────

  it('an unknown slug and an unpublished page return the SAME 404, so slugs cannot be enumerated', async () => {
    const unknown = await request(app.getHttpServer()).get(`/public/booking/never-existed-${randomId().slice(0, 8)}`).expect(404);

    await withTenantContext(prisma, tenantB, (tx) =>
      tx.clinicBookingPage.updateMany({ where: { tenantId: tenantB }, data: { active: false } }),
    );
    const unpublished = await request(app.getHttpServer()).get(`/public/booking/${slugB}`).expect(404);
    await withTenantContext(prisma, tenantB, (tx) =>
      tx.clinicBookingPage.updateMany({ where: { tenantId: tenantB }, data: { active: true } }),
    );

    expect(unpublished.body.message).toBe(unknown.body.message);
  });

  it('the page exposes only display fields — no tenant id, no clinic id, no internal flags', async () => {
    const res = await request(app.getHttpServer()).get(`/public/booking/${slugA}`).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['clinic', 'form', 'selectedServiceId', 'services']);
    // Final-UAT: `address` and `phone` are DELIBERATE additions — the
    // confirmation card's Directions and WhatsApp-us buttons need the
    // branch's published contact facts, the same ones the clinic already
    // prints on letterheads and speaks in patient messages. Still no ids,
    // no internal flags.
    expect(Object.keys(res.body.clinic).sort()).toEqual([
      'address', 'displayName', 'introText', 'language', 'logoUrl', 'phone', 'slug', 'timeZone',
    ]);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(tenantA);
    expect(body).not.toContain(clinicA);
  });

  it('non-bookable and inactive services do not appear on the page', async () => {
    const res = await request(app.getHttpServer()).get(`/public/booking/${slugA}`).expect(200);
    const names = res.body.services.map((s: { name: string }) => s.name);
    expect(names).toContain('SecA Consultation');
    expect(names).not.toContain('Unpublished Procedure');
    expect(names).not.toContain('Retired Service');
  });

  it('a HIDDEN price is not sent to the browser at all', async () => {
    const res = await request(app.getHttpServer()).get(`/public/booking/${slugA}`).expect(200);
    const service = res.body.services.find((s: { id: string }) => s.id === serviceA);
    expect(service.price).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('"60"');
  });

  // ── providers and form fields ─────────────────────────────────────────────

  it('providers are named only for services the page offers — a hidden service uuid gets a 404, not a doctor list', async () => {
    const ok = await request(app.getHttpServer())
      .get(`/public/booking/${slugA}/providers?serviceId=${serviceA}`)
      .expect(200);
    expect(ok.body).toHaveLength(1);
    // Phase 6 added professionalType — the patient-facing "Doctor" word on
    // the provider card. Deliberately public; nothing else joined it.
    expect(Object.keys(ok.body[0]).sort()).toEqual([
      'calendarColor',
      'fullName',
      'id',
      'professionalType',
    ]);

    await request(app.getHttpServer())
      .get(`/public/booking/${slugA}/providers?serviceId=${hiddenServiceA}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/public/booking/${slugA}/providers?serviceId=${inactiveServiceA}`)
      .expect(404);
  });

  it("tenant B's service uuid is a 404 under tenant A's slug — for providers, form fields and availability alike", async () => {
    await request(app.getHttpServer())
      .get(`/public/booking/${slugA}/providers?serviceId=${serviceB}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/public/booking/${slugA}/form-fields?serviceId=${serviceB}`)
      .expect(404);
    // Availability must be an oracle for NOTHING: the response for tenant
    // B's real service uuid is byte-identical to the response for a uuid
    // that has never existed anywhere.
    const foreign = await request(app.getHttpServer())
      .get(`/public/booking/${slugA}/availability?serviceId=${serviceB}&date=${DAY}`)
      .expect(200);
    const nonsense = await request(app.getHttpServer())
      .get(`/public/booking/${slugA}/availability?serviceId=${randomId()}&date=${DAY}`)
      .expect(200);
    expect(foreign.body.slots).toEqual([]);
    expect(foreign.body).toEqual(nonsense.body);
  });

  it('slots carry start, end and the provider — nothing about other patients', async () => {
    const res = await request(app.getHttpServer())
      .get(`/public/booking/${slugA}/availability?serviceId=${serviceA}&date=${DAY}`)
      .expect(200);
    expect(res.body.slots.length).toBeGreaterThan(0);
    for (const slot of res.body.slots) {
      expect(Object.keys(slot).sort()).toEqual(['end', 'staffId', 'start']);
    }
  });

  // ── booking, and the oracles it must not be ──────────────────────────────

  it('booking with an existing NRIC and booking with a fresh one return IDENTICAL response shapes — no enumeration oracle', async () => {
    const nric = '880505105678';
    await withTenantContext(prisma, tenantA, (tx) =>
      tx.patient.create({
        data: { tenantId: tenantA, identifierType: 'NRIC', identifierValue: nric, name: 'Existing Patient' },
      }),
    );

    const matched = await book(slugA, { identifier: nric, name: 'Existing Patient' }).expect(201);
    const fresh = await book(slugA, {
      identifier: '990909105432',
      name: 'Brand New Patient',
      scheduledStart: '2026-08-26T02:00:00.000Z',
      scheduledEnd: '2026-08-26T02:30:00.000Z',
    }).expect(201);

    expect(Object.keys(matched.body).sort()).toEqual(Object.keys(fresh.body).sort());
    expect(matched.body.message).toBe(fresh.body.message);
    // The response never echoes the identifier, and never says whether it
    // was recognised.
    for (const body of [JSON.stringify(matched.body), JSON.stringify(fresh.body)]) {
      expect(body).not.toContain(nric);
      expect(body).not.toContain('990909105432');
      expect(body.toLowerCase()).not.toContain('registered');
      expect(body.toLowerCase()).not.toContain('existing');
    }
    // And the match result is recorded for STAFF, not revealed to the caller.
    expect(JSON.stringify(matched.body)).not.toContain('MATCHED');
  });

  it("booking tenant B's service through tenant A's page is refused, and tenant B gains no appointment", async () => {
    const before = await withTenantContext(prisma, tenantB, (tx) => tx.appointment.count({ where: { tenantId: tenantB } }));
    const res = await book(slugA, { serviceId: serviceB, staffId: undefined });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const after = await withTenantContext(prisma, tenantB, (tx) => tx.appointment.count({ where: { tenantId: tenantB } }));
    expect(after).toBe(before);
  });

  it("booking tenant B's doctor through tenant A's page is refused", async () => {
    const doctorB = await withTenantContext(prisma, tenantB, (tx) =>
      tx.staff.findFirstOrThrow({ where: { tenantId: tenantB, role: Role.DOCTOR_RESIDENT } }),
    );
    const res = await book(slugA, { staffId: doctorB.id });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('an off-grid time and a wrong-length booking are both refused', async () => {
    const offGrid = await book(slugA, {
      scheduledStart: '2026-08-26T01:37:00.000Z',
      scheduledEnd: '2026-08-26T02:07:00.000Z',
    });
    expect(offGrid.status).toBe(400);

    const tooLong = await book(slugA, {
      scheduledStart: '2026-08-26T02:30:00.000Z',
      scheduledEnd: '2026-08-26T09:00:00.000Z',
    });
    expect(tooLong.status).toBe(400);
  });

  // ── the manage token ──────────────────────────────────────────────────────

  it('the manage token is 32 bytes of crypto randomness, not an id: the appointment uuid does not work as one', async () => {
    const booked = await book(slugA, {
      name: 'Token Test Patient',
      scheduledStart: '2026-08-26T03:00:00.000Z',
      scheduledEnd: '2026-08-26T03:30:00.000Z',
    }).expect(201);
    const token: string = booked.body.manageToken;
    // 32 random bytes base64url-encoded = 43 chars, no padding.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const appointment = await withTenantContext(prisma, tenantA, (tx) =>
      tx.appointment.findFirstOrThrow({ where: { manageToken: token }, select: { id: true } }),
    );
    await request(app.getHttpServer())
      .get(`/public/booking/${slugA}/manage/${appointment.id}`)
      .expect(404);
  });

  it('a forged token 404s, and a real token under the WRONG clinic slug 404s the same way', async () => {
    const booked = await book(slugA, {
      name: 'Cross Slug Patient',
      scheduledStart: '2026-08-26T03:30:00.000Z',
      scheduledEnd: '2026-08-26T04:00:00.000Z',
    }).expect(201);
    const token: string = booked.body.manageToken;

    const forged = await request(app.getHttpServer())
      .get(`/public/booking/${slugA}/manage/${'A'.repeat(43)}`)
      .expect(404);
    const wrongSlug = await request(app.getHttpServer())
      .get(`/public/booking/${slugB}/manage/${token}`)
      .expect(404);
    expect(wrongSlug.body.message).toBe(forged.body.message);
  });

  it('a bare token with no tenant context reaches NOTHING at the database level', async () => {
    const booked = await book(slugA, {
      name: 'RLS Token Patient',
      scheduledStart: '2026-08-26T04:00:00.000Z',
      scheduledEnd: '2026-08-26T04:30:00.000Z',
    }).expect(201);
    // The raw client with app.tenant_id never set — what a hypothetical
    // slug-less lookup would run as. RLS filters the row out entirely.
    const row = await prisma.appointment.findFirst({ where: { manageToken: booked.body.manageToken } });
    expect(row).toBeNull();
  });

  it('the manage view names the patient and nothing else about them — no phone, no NRIC, no ids, no other appointments', async () => {
    const nric = '770707105678';
    const booked = await book(slugA, {
      name: 'Manage View Patient',
      identifier: nric,
      phone: '0198887777',
      scheduledStart: '2026-08-26T04:30:00.000Z',
      scheduledEnd: '2026-08-26T05:00:00.000Z',
    }).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/public/booking/${slugA}/manage/${booked.body.manageToken}`)
      .expect(200);

    // Phase 7 added the change-request surface: the policy words, THIS
    // appointment's own pending requests, and the clinic's last decision.
    // Nothing about any other patient or booking joined the response.
    expect(Object.keys(res.body).sort()).toEqual([
      'appointment', 'can', 'clinic', 'confirmationMessage', 'cutoffHours',
      'lastDecision', 'pendingRequests', 'policy',
    ]);
    expect(Object.keys(res.body.appointment).sort()).toEqual([
      'answers', 'bookingFeeAmount', 'note', 'patientName', 'paymentStatus',
      'postInstructions', 'preInstructions', 'providerName', 'scheduledEnd',
      'scheduledStart', 'serviceName', 'status',
    ]);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(nric);
    expect(body).not.toContain('0198887777');
    expect(body).not.toContain(tenantA);
    expect(body).not.toContain(doctorA);
  });

  it('rescheduling rotates the token: the old link can never move the appointment again', async () => {
    const booked = await book(slugA, {
      name: 'Reschedule Patient',
      scheduledStart: '2026-08-26T05:00:00.000Z',
      scheduledEnd: '2026-08-26T05:30:00.000Z',
    }).expect(201);
    const oldToken: string = booked.body.manageToken;

    const moved = await request(app.getHttpServer())
      .patch(`/public/booking/${slugA}/manage/${oldToken}/reschedule`)
      .send({ scheduledStart: '2026-08-26T05:30:00.000Z', scheduledEnd: '2026-08-26T06:00:00.000Z' })
      .expect(200);
    const newToken: string = moved.body.manageToken;
    expect(newToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken).not.toBe(oldToken);

    // The old link still OPENS (the patient sees their cancelled booking and
    // is not left staring at a dead page), but it can change nothing.
    const oldView = await request(app.getHttpServer())
      .get(`/public/booking/${slugA}/manage/${oldToken}`)
      .expect(200);
    expect(oldView.body.appointment.status).toBe('CANCELLED');
    expect(oldView.body.can).toEqual({ reschedule: false, cancel: false });

    await request(app.getHttpServer())
      .patch(`/public/booking/${slugA}/manage/${oldToken}/reschedule`)
      .send({ scheduledStart: '2026-08-26T06:00:00.000Z', scheduledEnd: '2026-08-26T06:30:00.000Z' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/public/booking/${slugA}/manage/${oldToken}/cancel`)
      .send({})
      .expect(400);

    // The NEW link is live.
    const newView = await request(app.getHttpServer())
      .get(`/public/booking/${slugA}/manage/${newToken}`)
      .expect(200);
    expect(newView.body.appointment.status).toBe('CONFIRMED');
  });

  it('when the clinic disallows online cancellation, a valid token is still refused with 403', async () => {
    const booked = await book(slugA, {
      name: 'No Cancel Patient',
      scheduledStart: '2026-08-26T06:30:00.000Z',
      scheduledEnd: '2026-08-26T07:00:00.000Z',
    }).expect(201);

    await withTenantContext(prisma, tenantA, (tx) =>
      tx.clinicBookingPage.updateMany({ where: { tenantId: tenantA }, data: { allowPatientCancel: false } }),
    );
    try {
      await request(app.getHttpServer())
        .patch(`/public/booking/${slugA}/manage/${booked.body.manageToken}/cancel`)
        .send({})
        .expect(403);
    } finally {
      await withTenantContext(prisma, tenantA, (tx) =>
        tx.clinicBookingPage.updateMany({ where: { tenantId: tenantA }, data: { allowPatientCancel: true } }),
      );
    }
  });

  it('inside the cutoff window, changes are refused and the patient is told to ring', async () => {
    // A slot ~2 hours from "now" would be inside the 4-hour cutoff — but the
    // engine also refuses short-notice bookings, so build the appointment
    // directly: a CONFIRMED row starting in 2 hours with a known token.
    const soonStart = new Date(Date.now() + 2 * 3600 * 1000);
    const soonEnd = new Date(soonStart.getTime() + 30 * 60 * 1000);
    const token = `cut${randomId().replace(/-/g, '')}`.padEnd(43, 'x').slice(0, 43);
    await withTenantContext(prisma, tenantA, async (tx) => {
      const patient = await tx.patient.create({
        data: { tenantId: tenantA, identifierType: 'NRIC', identifierValue: `CUT${randomId().slice(0, 9)}`, name: 'Cutoff Patient' },
      });
      await tx.appointment.create({
        data: {
          tenantId: tenantA,
          clinicId: clinicA,
          patientId: patient.id,
          staffId: doctorA,
          serviceId: serviceA,
          source: 'ONLINE_PORTAL',
          status: 'CONFIRMED',
          scheduledStart: soonStart,
          scheduledEnd: soonEnd,
          manageToken: token,
        },
      });
    });

    const view = await request(app.getHttpServer())
      .get(`/public/booking/${slugA}/manage/${token}`)
      .expect(200);
    expect(view.body.can).toEqual({ reschedule: false, cancel: false });

    const refused = await request(app.getHttpServer())
      .patch(`/public/booking/${slugA}/manage/${token}/cancel`)
      .send({})
      .expect(400);
    expect(refused.body.message).toContain('ring the clinic');
  });
});

// Appended below the main describe so it can reuse nothing: the STAFF surface
// must not hand the patient's credential to every signed-in browser.
describe('Manage token is never exposed to staff reads (e2e)', () => {
  it('appointment list, by-id and detail responses all omit manageToken', async () => {
    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('../src/app.module');
    const { ValidationPipe } = await import('@nestjs/common');
    const request = (await import('supertest')).default;
    const { createOwnerAndBearer } = await import('./auth');

    const prisma = createTestPrismaClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    try {
      const tenantId = randomId();
      const token = `stf${randomId().replace(/-/g, '')}`.padEnd(43, 'y').slice(0, 43);
      let appointmentId = '';
      await withTenantContext(prisma, tenantId, async (tx) => {
        await tx.tenant.create({ data: { id: tenantId, name: 'Token Redaction Tenant' } });
        const clinic = await tx.clinic.create({ data: { tenantId, name: 'Redact Clinic' } });
        const patient = await tx.patient.create({
          data: { tenantId, identifierType: 'NRIC', identifierValue: `RED${randomId().slice(0, 9)}`, name: 'Redact Patient' },
        });
        const staff = await tx.staff.create({ data: { tenantId, role: Role.DOCTOR_RESIDENT, fullName: 'Dr Redact' } });
        const service = await tx.serviceCatalog.create({
          data: { tenantId, name: 'Redact Service', durationMinutesDefault: 30 },
        });
        const appointment = await tx.appointment.create({
          data: {
            tenantId,
            clinicId: clinic.id,
            patientId: patient.id,
            staffId: staff.id,
            serviceId: service.id,
            source: 'ONLINE_PORTAL',
            status: 'CONFIRMED',
            scheduledStart: new Date('2026-08-27T01:00:00Z'),
            scheduledEnd: new Date('2026-08-27T01:30:00Z'),
            manageToken: token,
          },
        });
        appointmentId = appointment.id;
      });
      const { bearer } = await createOwnerAndBearer(prisma, tenantId);

      const list = await request(app.getHttpServer())
        .get('/appointments')
        .set('Authorization', bearer)
        .expect(200);
      const byId = await request(app.getHttpServer())
        .get(`/appointments/${appointmentId}`)
        .set('Authorization', bearer)
        .expect(200);
      const detail = await request(app.getHttpServer())
        .get(`/appointments/${appointmentId}/detail`)
        .set('Authorization', bearer)
        .expect(200);

      for (const body of [list.body, byId.body, detail.body]) {
        const text = JSON.stringify(body);
        expect(text).not.toContain(token);
        expect(text).not.toContain('manageToken');
      }
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  });
});
