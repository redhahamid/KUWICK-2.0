import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * THE FIRST MONTH OF AN EMPLOYEE'S STANDING HAS TO BE REACHABLE.
 *
 * A clinic onboarding staff from 1 January records their standing from their
 * JOIN DATE — the Add employee form writes that row itself, and it carries
 * only what the form asked for. Everything it did not ask for (LINDUNG, the
 * rest day, the MTD category) then has to be added to that same row, because
 * there is no earlier date to record it from and a later date leaves January
 * unanswered.
 *
 * Recording a standing on a date that already has one used to be refused
 * outright, which left that row permanently uncorrectable and January
 * permanently unpayable.
 */
describe('the first statutory standing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let ownerStaffId: string;
  let clinicId: string;

  const JOINED = '2026-01-01';
  const server = () => app.getHttpServer();

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
      tx.tenant.create({ data: { id: tenantId, name: 'Standing Tenant' } }),
    );
    const account = await createOwnerAndBearer(prisma, tenantId);
    owner = account.bearer;
    ownerStaffId = account.staffId;
    const clinic = await request(server())
      .post('/clinics')
      .set('Authorization', owner)
      .send({ name: 'KLINIK HIJRAA BANGI' })
      .expect(201);
    clinicId = clinic.body.id;
  });

  /** An employee as the Add employee form leaves them: a standing from the join date. */
  async function joined(name: string) {
    const created = await request(server())
      .post('/workforce/employees')
      .set('Authorization', owner)
      .send({
        fullName: name,
        role: Role.FRONT_DESK_CLINICAL_STAFF,
        clinicId,
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        startDate: JOINED,
        dateOfBirth: '1990-06-15',
      })
      .expect(201);
    const staffId = created.body.staff.id as string;
    // What the form itself records: the Third Schedule part, from day one.
    await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', owner)
      .send({ effectiveFrom: JOINED, epfMembership: 'MALAYSIAN_CITIZEN', reason: 'Recorded when the employee was added' })
      .expect(201);
    return staffId;
  }

  const history = async (staffId: string) =>
    (await request(server()).get(`/workforce/employees/${staffId}/statutory-classification`).set('Authorization', owner).expect(200))
      .body as Record<string, unknown>[];

  // -------------------------------------------------------------------------
  it('corrects the row that already starts on that date instead of refusing it', async () => {
    const staffId = await joined('Hijraa One');

    await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', owner)
      .send({
        effectiveFrom: JOINED,
        lindungParticipation: 'NOT_PARTICIPATING',
        restDayOfWeek: 0,
        pcbCategory: 'CATEGORY_1',
        taxResidence: 'RESIDENT',
        reason: 'Completing what the Add employee form did not ask for',
      })
      .expect(201);

    // ONE row, still starting on the join date — not a second one, and not a
    // row dated later that leaves January unanswered.
    const rows = await history(staffId);
    expect(rows.map((row) => row.effectiveFrom)).toEqual([JOINED]);
    expect(rows[0]).toMatchObject({
      lindungParticipation: 'NOT_PARTICIPATING',
      restDayOfWeek: 0,
      pcbCategory: 'CATEGORY_1',
      // and what it already said is kept
      epfMembership: 'MALAYSIAN_CITIZEN',
    });
  });

  it('stores the date that was asked for, not the month the request happened to be made in', async () => {
    const staffId = await joined('Hijraa Two');
    await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', owner)
      .send({ effectiveFrom: JOINED, restDayOfWeek: 5, reason: 'Rest day is Friday' })
      .expect(201);

    const rows = await history(staffId);
    expect(rows.every((row) => row.effectiveFrom === JOINED)).toBe(true);
    expect(rows.some((row) => String(row.effectiveFrom).startsWith('2026-01'))).toBe(true);
  });

  it('persists the LINDUNG 24 JAM answer, both on the row and on the record the screen reads', async () => {
    const staffId = await joined('Hijraa Three');
    await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', owner)
      .send({ effectiveFrom: JOINED, lindungParticipation: 'NOT_PARTICIPATING', reason: 'Opted out through PERKESO' })
      .expect(201);

    const rows = await history(staffId);
    expect(rows[0].lindungParticipation).toBe('NOT_PARTICIPATING');

    // And the employee record — what the Statutory tab prints — agrees.
    const record = await request(server())
      .get(`/workforce/employees/${staffId}/record`)
      .set('Authorization', owner)
      .expect(200);
    expect(record.body.statutory.lindungParticipation).toBe('NOT_PARTICIPATING');
  });

  it('lets the rest day be set for the employee’s very first month', async () => {
    const staffId = await joined('Hijraa Four');
    await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', owner)
      .send({ effectiveFrom: JOINED, restDayOfWeek: 0, reason: 'Sunday' })
      .expect(201);

    const resolved = await request(server())
      .get(`/workforce/employees/${staffId}/statutory-classification/resolve?period=${JOINED}`)
      .set('Authorization', owner)
      .expect(200);
    expect(resolved.body.state).toBe('RESOLVED');
    expect(resolved.body.effectiveFrom).toBe(JOINED);
  });
  it('keeps what the row already said when the correction does not mention it', async () => {
    const staffId = await joined('Hijraa Five');
    await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', owner)
      .send({ effectiveFrom: JOINED, restDayOfWeek: 0, reason: 'Sunday' })
      .expect(201);

    // The EPF Part the Add employee form recorded is not mentioned here and
    // must not be blanked by a form that only asks about LINDUNG.
    await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', owner)
      .send({ effectiveFrom: JOINED, lindungParticipation: 'ENROLLED', reason: 'Enrolled' })
      .expect(201);

    const rows = await history(staffId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      epfMembership: 'MALAYSIAN_CITIZEN',
      restDayOfWeek: 0,
      lindungParticipation: 'ENROLLED',
    });
  });

  it('accepts the same statement twice instead of calling the second one a duplicate', async () => {
    const staffId = await joined('Hijraa Six');
    const body = { effectiveFrom: JOINED, lindungParticipation: 'NOT_PARTICIPATING', restDayOfWeek: 0, reason: 'Opted out through PERKESO' };

    await request(server()).post(`/workforce/employees/${staffId}/statutory-classification`).set('Authorization', owner).send(body).expect(201);
    // A screen that leaves people unsure whether it saved gets pressed twice.
    // The second press asks for the state that already holds, so it holds.
    await request(server()).post(`/workforce/employees/${staffId}/statutory-classification`).set('Authorization', owner).send(body).expect(201);

    const rows = await history(staffId);
    expect(rows).toHaveLength(1);
    expect(rows[0].lindungParticipation).toBe('NOT_PARTICIPATING');
  });

  it('still refuses to restate a month that has been approved and paid from', async () => {
    const staffId = await joined('Hijraa Seven');
    await withTenantContext(prisma, tenantId, async (tx) => {
      const run = await tx.payrollRun.create({
        data: { tenantId, period: new Date(`${JOINED}T00:00:00.000Z`), status: 'CALCULATED', createdByStaffId: ownerStaffId },
      });
      await tx.payrollLine.create({
        data: { tenantId, payrollRunId: run.id, staffId, employeeSnapshot: {}, basicSalary: '3000.00', grossPay: '3000.00', netPay: '2670.00' },
      });
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'APPROVED' } });
    });

    // What they were contributed in January is settled. Restating the row
    // would leave the approved run and the employee record disagreeing about
    // it, with no second version to show that anything moved.
    const refused = await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', owner)
      .send({ effectiveFrom: JOINED, lindungParticipation: 'NOT_PARTICIPATING', reason: 'Too late' })
      .expect(409);
    expect(String(refused.body.message)).toContain('approved payroll run');

    const rows = await history(staffId);
    expect(rows[0].lindungParticipation).toBeNull();
  });
});
