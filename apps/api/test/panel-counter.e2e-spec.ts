import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * WHAT THE COUNTER REMEMBERS, AND WHAT IT REFUSES (N-5).
 *
 * Kuwick 1.0 remembered the panel a patient came in on and 2.0 did not — a
 * regression nobody logged, paid for at the busiest moment of the day.
 *
 * What these prove:
 *   - registering a panel visit remembers the panel, employer, card and
 *     relationship, and the next visit is offered them
 *   - a self-pay visit does NOT blank that memory
 *   - a remembered panel that has been turned off is reported as such, not
 *     silently dropped
 *   - an employer from a DIFFERENT panel is refused — the money bug this
 *     check exists for
 *   - the pre-fill is a suggestion: the visit still starts unverified
 *   - the setting defaults ON and can be turned off
 */
describe('Panel: what the counter remembers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let patientId: string;
  let doctorId: string;
  let panelId: string;
  let otherPanelId: string;

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
      tx.tenant.create({ data: { id: tenantId, name: 'Counter Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;

    const built = await withTenantContext(prisma, tenantId, async (tx) => {
      const clinic = await tx.clinic.create({ data: { tenantId, name: 'Contoh Clinic' } });
      // `POST /visits` requires an attending clinician, and only a doctor may
      // be one (`isEligibleAttendingDoctor`). The test owner is an
      // OWNER_ADMIN with no professional identity, so the fixture needs a
      // resident alongside them.
      const doctor = await tx.staff.create({
        data: { tenantId, role: 'DOCTOR_RESIDENT', fullName: 'Dr Contoh', clinicId: clinic.id },
      });
      const patient = await tx.patient.create({
        data: {
          tenantId,
          name: 'Pesakit Contoh',
          identifierType: 'NRIC',
          identifierValue: `90010${Math.floor(Math.random() * 900000) + 100000}`,
        },
      });
      const panel = await tx.panelClinic.create({
        data: { tenantId, name: 'Contoh TPA', paymentTermDays: 30, feeTreatment: 'NO_FEE' },
      });
      const other = await tx.panelClinic.create({
        data: { tenantId, name: 'Contoh Insurer', feeTreatment: 'NO_FEE' },
      });
      return {
        clinicId: clinic.id,
        doctorId: doctor.id,
        patientId: patient.id,
        panelId: panel.id,
        otherId: other.id,
      };
    });
    clinicId = built.clinicId;
    doctorId = built.doctorId;
    patientId = built.patientId;
    panelId = built.panelId;
    otherPanelId = built.otherId;
  });

  const addEmployer = (body: object, id = panelId) =>
    request(app.getHttpServer())
      .post(`/panel-workspace/panels/${id}/employers`)
      .set('Authorization', bearer)
      .send(body);

  const register = (body: object) =>
    request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', bearer)
      // `POST /visits` requires an attending clinician even though the service
      // treats it as optional (D-082) — a pre-existing mismatch between that
      // DTO and `CreateVisitInput`, not something this piece changes.
      .send({ clinicId, patientId, staffId: doctorId, billingType: 'Panel', ...body });

  const prefill = () =>
    request(app.getHttpServer())
      .get(`/panel-workspace/counter-prefill/${patientId}`)
      .set('Authorization', bearer);

  it('offers nothing for a patient who has never been on a panel', async () => {
    const offered = await prefill().expect(200);
    expect(offered.body.panelClinicId).toBeNull();
    expect(offered.body.employerId).toBeNull();
    expect(offered.body.memberReference).toBeNull();
    // The setting is ON by default — the behaviour Kuwick 1.0 had.
    expect(offered.body.autoSelectLastPanel).toBe(true);
  });

  it('remembers the panel, employer, card number and relationship', async () => {
    const employer = await addEmployer({ name: 'Syarikat Contoh' }).expect(201);
    await register({
      panelClinicId: panelId,
      panelEmployerId: employer.body.id,
      panelRelationship: 'CHILD',
      panelMemberReference: 'MC-0012345',
    }).expect(201);

    const offered = await prefill().expect(200);
    expect(offered.body).toMatchObject({
      panelClinicId: panelId,
      panelName: 'Contoh TPA',
      panelActive: true,
      employerId: employer.body.id,
      employerName: 'Syarikat Contoh',
      memberReference: 'MC-0012345',
      relationship: 'CHILD',
    });
  });

  /**
   * A SUGGESTION, NOT A COMMITMENT. The remembered panel must not arrive
   * pre-verified: that would turn a convenience into an unchecked claim of
   * eligibility, which is the one thing D-092 exists to prevent.
   */
  it('still starts the visit unverified', async () => {
    await register({ panelClinicId: panelId, panelMemberReference: 'MC-1' }).expect(201);
    const visit = await withTenantContext(prisma, tenantId, (tx) =>
      tx.visit.findFirstOrThrow({ where: { patientId }, orderBy: { createdAt: 'desc' } }),
    );
    expect(visit.panelVerificationStatus).toBe('PENDING_VERIFICATION');
    expect(visit.panelVerifiedAt).toBeNull();
  });

  /**
   * A patient coming in self-pay has not stopped being on their panel. Blanking
   * the memory would make the counter forget it for no reason, and the card
   * would be re-typed next time.
   */
  it('does not forget the panel when the patient next comes in self-pay', async () => {
    await register({ panelClinicId: panelId, panelMemberReference: 'MC-1' }).expect(201);
    await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', bearer)
      .send({ clinicId, patientId, staffId: doctorId, billingType: 'Self-pay' })
      .expect(201);

    const offered = await prefill().expect(200);
    expect(offered.body.panelClinicId).toBe(panelId);
    expect(offered.body.memberReference).toBe('MC-1');
  });

  /**
   * Reported, not dropped. Omitting it would show a blank form and let somebody
   * conclude the patient was always self-pay.
   */
  it('reports a remembered panel that has since been turned off', async () => {
    await register({ panelClinicId: panelId }).expect(201);
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.panelClinic.update({ where: { id: panelId }, data: { active: false } }),
    );
    const offered = await prefill().expect(200);
    expect(offered.body.panelClinicId).toBe(panelId);
    expect(offered.body.panelActive).toBe(false);
  });

  /**
   * THE MONEY BUG THIS CHECK EXISTS FOR. Two ids that each exist can still be a
   * wrong pair, and since G-9 an employer carries its own payment term — so an
   * employer from a different panel would apply another agreement's term to
   * this claim. The due date would be wrong and nothing about the request would
   * look invalid.
   */
  it('refuses an employer that belongs to a different panel', async () => {
    const wrong = await addEmployer({ name: 'Syarikat Lain' }, otherPanelId).expect(201);
    const refused = await register({
      panelClinicId: panelId,
      panelEmployerId: wrong.body.id,
    }).expect(400);
    expect(refused.body.message).toContain('different panel');

    const visits = await withTenantContext(prisma, tenantId, (tx) =>
      tx.visit.findMany({ where: { patientId } }),
    );
    expect(visits).toEqual([]);
  });

  it('refuses an employer with no panel chosen at all', async () => {
    const employer = await addEmployer({ name: 'Syarikat Contoh' }).expect(201);
    const refused = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', bearer)
      .send({
        clinicId,
        patientId,
        staffId: doctorId,
        billingType: 'Self-pay',
        panelEmployerId: employer.body.id,
      })
      .expect(400);
    expect(refused.body.message).toContain('panel has to be chosen');
  });

  /**
   * Deactivating a company means "stop offering it at the counter", not "refuse
   * the visit in front of you" — the front desk may be registering a patient
   * whose employer was retired this morning.
   */
  it('still accepts an employer deactivated after the patient arrived', async () => {
    const employer = await addEmployer({ name: 'Syarikat Contoh' }).expect(201);
    await request(app.getHttpServer())
      .patch(`/panel-workspace/employers/${employer.body.id}`)
      .set('Authorization', bearer)
      .send({ active: false })
      .expect(200);

    await register({ panelClinicId: panelId, panelEmployerId: employer.body.id }).expect(201);
  });

  it('can be turned off, and says so', async () => {
    const off = await request(app.getHttpServer())
      .patch('/panel-workspace/settings/auto-select')
      .set('Authorization', bearer)
      .send({ enabled: false })
      .expect(200);
    expect(off.body.autoSelectLastPanel).toBe(false);

    await register({ panelClinicId: panelId, panelMemberReference: 'MC-1' }).expect(201);
    const offered = await prefill().expect(200);
    // The memory is still kept — only the pre-selecting is off, so turning it
    // back on does not lose what happened in between.
    expect(offered.body.autoSelectLastPanel).toBe(false);
    expect(offered.body.panelClinicId).toBe(panelId);
  });
});
