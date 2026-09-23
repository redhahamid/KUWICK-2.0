import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * A NEW BRANCH, HIRING FROM 1 JANUARY, PAYING JANUARY.
 *
 * The whole journey a clinic actually starts with, end to end, because every
 * part of it worked on its own and the whole of it did not. Staff joined on
 * 1 January; the Add employee form wrote their standing from that date with
 * only the EPF Part on it; and there was then no way to put LINDUNG or the
 * rest day onto that row. January reported three blocked, no employees and
 * RM0.00 in every column, and the screen's own advice — correct that row —
 * pointed at a control that did not exist.
 *
 * So what this proves is not a unit of behaviour, it is that the month comes
 * out: every employee ready, nobody left out, and figures a clinic could file.
 */
describe('a new branch paying its first January (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let clinicId: string;
  let legalEmployerId: string;

  const JOINED = '2026-01-01';
  const PERIOD = '2026-01';
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Hijraa Tenant' } }),
    );
    owner = (await createOwnerAndBearer(prisma, tenantId)).bearer;

    // A BRANCH WITH NOTHING IN IT, which is where a clinic starts.
    const clinic = await request(server())
      .post('/clinics')
      .set('Authorization', owner)
      .send({ name: 'KLINIK HIJRAA BANGI' })
      .expect(201);
    clinicId = clinic.body.id;

    const employer = await request(server())
      .post('/workforce/legal-employers')
      .set('Authorization', owner)
      .send({ name: 'Hijraa Bangi Sdn Bhd', epfEmployerNo: 'EPF-HB-1' })
      .expect(201);
    legalEmployerId = employer.body.id;

    // What a clinic does once, in Payroll settings, before its first month:
    // without a component catalogue a payslip line has nothing to say it is
    // liable to, and the run refuses rather than guess.
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', owner).expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  /**
   * An employee exactly as the Add employee form leaves them: created, put on
   * the company, given a salary, and a statutory standing FROM THE JOIN DATE
   * carrying only what that form asks for. Everything the run also needs —
   * LINDUNG, the rest day — is deliberately absent, because that is the state
   * a clinic is in after using the screens.
   */
  async function addedThroughTheForm(name: string, salary: string) {
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
        dateOfBirth: '1994-03-08',
        epfNumber: `E-${Math.floor(Math.random() * 1000000)}`,
        socsoNumber: `S-${Math.floor(Math.random() * 1000000)}`,
        bankName: 'Maybank',
        bankAccountNo: '512345678901',
      })
      .expect(201);
    const staffId = created.body.staff.id as string;

    await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', owner)
      .send({ effectiveFrom: JOINED, epfMembership: 'MALAYSIAN_CITIZEN', reason: 'Recorded when the employee was added' })
      .expect(201);

    await request(server())
      .patch(`/workforce/employees/${staffId}/legal-employer`)
      .set('Authorization', owner)
      .send({ legalEmployerId })
      .expect(200);

    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', owner)
      .send({ amount: salary, basis: 'MONTHLY', effectiveFrom: JOINED, reason: 'Starting salary' })
      .expect(201);

    return staffId;
  }

  type ReadinessRow = {
    staffId: string;
    name: string;
    readiness: { ready: boolean; blockersOutstanding: number; items: { key: string; done: boolean; detail: string }[] };
  };

  const readiness = async (): Promise<{ summary: { total: number; withBlockers: number }; employees: ReadinessRow[] }> =>
    (await request(server())
      .get(`/workforce/payroll/readiness?period=${PERIOD}&clinicId=${clinicId}`)
      .set('Authorization', owner)
      .expect(200)).body;

  let staffIds: string[] = [];

  it('starts where the screens leave a clinic: everybody blocked on the rest day', async () => {
    staffIds = [
      await addedThroughTheForm('Hijraa Amirah', '2800.00'),
      await addedThroughTheForm('Hijraa Farhan', '3200.00'),
      await addedThroughTheForm('Hijraa Nabila', '2500.00'),
    ];

    const before = await readiness();
    expect(before.summary.total).toBe(3);
    expect(before.summary.withBlockers).toBe(3);
    // Named, because this is the blocker the screens had no field for.
    for (const row of before.employees) {
      expect(row.readiness.ready).toBe(false);
      expect(row.readiness.items.find((item) => item.key === 'restDay')!.done).toBe(false);
    }
  });

  /**
   * THE ONE MOVE THAT WAS IMPOSSIBLE. Each of these statements is dated at a
   * row that already exists, which is a correction of that row — not a second
   * version starting the same day, and not a version starting this month that
   * would leave January unanswered.
   */
  it('lets January itself be completed, on the standing that is already there', async () => {
    for (const staffId of staffIds) {
      await request(server())
        .post(`/workforce/employees/${staffId}/statutory-classification`)
        .set('Authorization', owner)
        .send({
          effectiveFrom: JOINED,
          lindungParticipation: 'NOT_PARTICIPATING',
          restDayOfWeek: 0,
          taxResidence: 'RESIDENT',
          pcbCategory: 'CATEGORY_1',
          reason: 'Completing what the Add employee form did not ask for',
        })
        .expect(201);

      // One standing, still starting on the join date. A second row dated the
      // same day would have no days in it; a row dated later would leave
      // January without an answer at all.
      const rows = (
        await request(server())
          .get(`/workforce/employees/${staffId}/statutory-classification`)
          .set('Authorization', owner)
          .expect(200)
      ).body;
      expect(rows).toHaveLength(1);
      expect(rows[0].effectiveFrom).toBe(JOINED);
      expect(rows[0].lindungParticipation).toBe('NOT_PARTICIPATING');
      expect(rows[0].restDayOfWeek).toBe(0);
      // And what the form did record is still there.
      expect(rows[0].epfMembership).toBe('MALAYSIAN_CITIZEN');
    }

    const after = await readiness();
    expect(after.summary.withBlockers).toBe(0);
    for (const row of after.employees) {
      expect(row.readiness.ready).toBe(true);
      expect(row.readiness.blockersOutstanding).toBe(0);
    }
  });

  it('runs January with everybody in it and nobody left out', async () => {
    const run = await request(server())
      .post('/workforce/payroll/runs')
      .set('Authorization', owner)
      .send({ period: PERIOD, clinicId })
      .expect(201);
    const runId = run.body.id as string;

    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', owner).expect(200);

    const journey = (
      await request(server()).get(`/workforce/payroll/runs/${runId}/journey`).set('Authorization', owner).expect(200)
    ).body;

    /*
     * THE GATE THE SCREEN PUTS ON "Continue to review", in the screen's own
     * terms: no row with a blocker, and nobody the run left out of the month
     * altogether. Either one disables the button, and the second is the one a
     * grid can hide by simply not drawing a row.
     */
    const rows = journey.pay.rows as { name: string; blockers: number; net: string }[];
    const leftOut = (journey.employees.rows as { includedInRun: boolean; state: string; name: string }[]).filter(
      (row) => !row.includedInRun && row.state !== 'READY',
    );
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.blockers > 0)).toEqual([]);
    expect(leftOut).toEqual([]);

    // AND REAL FIGURES, not a month of RM0.00: three people paid, everybody's
    // net below their gross because the statutory deductions actually ran.
    const totals = journey.pay.totals as Record<string, string | number>;
    expect(Number(totals.gross)).toBeCloseTo(8500, 2);
    expect(Number(totals.epfEmployee)).toBeGreaterThan(0);
    expect(Number(totals.socsoEmployee)).toBeGreaterThan(0);
    expect(Number(totals.eisEmployee)).toBeGreaterThan(0);
    expect(Number(totals.net)).toBeGreaterThan(0);
    expect(Number(totals.net)).toBeLessThan(Number(totals.gross));
    // Nobody's scheme came out unknown: a column that foots on silence is the
    // RM0.00 month wearing a total.
    expect(totals.statutoryNotCalculated).toBe(0);
    expect(totals.pcbMissing).toBe(0);
    expect(totals.lindungNotDetermined).toBe(0);
  });
});
