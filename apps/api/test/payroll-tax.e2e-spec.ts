import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * TP1 AND TP3 CHANGE A MONTH'S TAX — and the same ringgit never arrives twice.
 *
 * The engine carried the LP slots from HASiL's own specification since it was
 * transcribed (Exhibit 5 includes a TP1 month); these are the records that
 * fill them. The proofs that matter:
 *   - a recorded TP1 REDUCES the month's computed PCB, and the payslip's note
 *     says the deduction was applied;
 *   - the applied LP lands in the approved month's year-to-date, so the next
 *     month's cumulative ∑LP carries it;
 *   - a TP3 shifts the whole cumulative position — a mid-year joiner is not
 *     taxed as though January onwards paid nothing;
 *   - the double-count guards refuse pre-employment "opening months" (that
 *     money belongs on TP3) and TP3 for somebody employed here all year;
 *   - a month an approved run covers is frozen against late TP1.
 */
describe('TP1 / TP3 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Tax Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;

    const clinic = await request(app.getHttpServer())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Tax Clinic' })
      .expect(201);
    clinicId = clinic.body.id;

    const employer = await request(app.getHttpServer())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      .send({ name: 'Tax Employer Sdn Bhd' })
      .expect(201);
    legalEmployerId = employer.body.id;
    await request(app.getHttpServer())
      .post(`/workforce/legal-employers/${legalEmployerId}/statutory-profile`)
      .set('Authorization', bearer)
      .send({ effectiveFrom: '2024-01-01', hrdRegistration: 'NOT_REGISTERED', reason: 'Below headcount' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/workforce/pay-components/seed')
      .set('Authorization', bearer)
      .expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function makeEmployee(name: string, salary: string, startDate: string): Promise<string> {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId },
      }),
    );
    await request(app.getHttpServer())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: `T-${Math.floor(Math.random() * 100000)}`,
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate,
        dateOfBirth: '1990-02-02',
        bankName: 'Maybank',
        bankAccountNo: '512345678901',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/workforce/employees/${staff.id}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: startDate,
        epfMembership: 'MALAYSIAN_CITIZEN',
        taxResidence: 'RESIDENT',
        pcbCategory: 'CATEGORY_1',
        qualifyingChildren: 0,
        restDayOfWeek: 0,
        lindungParticipation: 'NOT_PARTICIPATING',
        reason: 'Recorded at hire',
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/workforce/employees/${staff.id}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/workforce/employees/${staff.id}/salary`)
      .set('Authorization', bearer)
      .send({ amount: salary, basis: 'MONTHLY', effectiveFrom: startDate, reason: 'Starting salary' })
      .expect(201);
    return staff.id;
  }

  async function calculatedRun(period: string) {
    const run = await request(app.getHttpServer())
      .post('/workforce/payroll/runs')
      .set('Authorization', bearer)
      .send({ period, clinicId })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
      .set('Authorization', bearer)
      .expect(200);
    return run.body.id as string;
  }

  async function lineFor(runId: string, staffId: string) {
    const detail = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}`)
      .set('Authorization', bearer)
      .expect(200);
    return detail.body.lines.find((line: { staffId: string }) => line.staffId === staffId);
  }

  describe('TP1', () => {
    let staffId: string;

    it('a recorded TP1 reduces the month it belongs to, visibly', async () => {
      staffId = await makeEmployee('Tp1 Person', '8000.00', '2024-01-01');

      // January without a TP1: the baseline computed figure.
      const withoutRun = await calculatedRun('2026-01');
      const withoutLine = await lineFor(withoutRun, staffId);
      const pcbWithout = Number(withoutLine.pcb);
      expect(pcbWithout).toBeGreaterThan(0);

      // Record RM2,000 of approved deductions for January, itemised.
      await request(app.getHttpServer())
        .post(`/workforce/employees/${staffId}/tp1`)
        .set('Authorization', bearer)
        .send({
          period: '2026-01',
          deductionsCents: 200000,
          items: [
            { label: 'Medical treatment for parents', amountCents: 150000 },
            { label: 'Lifestyle — books', amountCents: 50000 },
          ],
          receivedDate: '2026-01-05',
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${withoutRun}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      const withLine = await lineFor(withoutRun, staffId);
      const pcbWith = Number(withLine.pcb);
      expect(pcbWith).toBeLessThan(pcbWithout);
      // The payslip's own note says the deduction was applied.
      expect(withLine.breakdown.statutoryNotes.pcb).toMatch(/TP1 deductions/);
    });

    it('a form that does not add up is refused', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workforce/employees/${staffId}/tp1`)
        .set('Authorization', bearer)
        .send({
          period: '2026-02',
          deductionsCents: 100000,
          items: [{ label: 'Books', amountCents: 60000 }],
        })
        .expect(409);
      expect(res.body.message).toMatch(/does not add up/);
    });

    it('the applied LP lands in the approved month’s year-to-date', async () => {
      const runId = (
        await request(app.getHttpServer())
          .get('/workforce/payroll/runs?year=2026')
          .set('Authorization', bearer)
          .expect(200)
      ).body.find((row: { period: string }) => row.period === '2026-01').id as string;
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${runId}/approve`)
        .set('Authorization', bearer)
        .send({ acknowledgeStatutoryGap: true })
        .expect(200);

      const ytd = await withTenantContext(prisma, tenantId, (tx) =>
        tx.employeeYtd.findFirst({ where: { staffId, taxYear: 2026, month: 1 } }),
      );
      expect(ytd?.deductionsCents).toBe(200000);
    });

    it('a month an approved run covers is frozen against late TP1', async () => {
      const res = await request(app.getHttpServer())
        .post(`/workforce/employees/${staffId}/tp1`)
        .set('Authorization', bearer)
        .send({ period: '2026-01', deductionsCents: 50000 })
        .expect(409);
      expect(res.body.message).toMatch(/correction/);
    });
  });

  describe('TP3', () => {
    it('shifts the cumulative position for a mid-year joiner', async () => {
      // Two identical joiners on 1 July; one declares previous employment.
      const withTp3 = await makeEmployee('Joiner With Tp3', '8000.00', '2026-07-01');
      const withoutTp3 = await makeEmployee('Joiner Without Tp3', '8000.00', '2026-07-01');

      await request(app.getHttpServer())
        .post(`/workforce/employees/${withTp3}/tp3`)
        .set('Authorization', bearer)
        .send({
          taxYear: 2026,
          previousEmployerName: 'Former Employer Sdn Bhd',
          employmentFrom: '2026-01-01',
          employmentTo: '2026-06-15',
          grossCents: 4800000, // six months at RM8,000
          epfCents: 528000,
          mtdPaidCents: 250000,
          source: 'Borang TP3 dated 3 July 2026',
        })
        .expect(201);

      const runId = await calculatedRun('2026-07');
      const lineWith = await lineFor(runId, withTp3);
      const lineWithout = await lineFor(runId, withoutTp3);

      // Both compute; the declared history changes the figure. With six months
      // of pay already behind them, the annualised income is higher and the
      // MTD already paid offsets it — either way the two must differ, because
      // the cumulative method is the whole point.
      expect(lineWith.pcb).not.toBeNull();
      expect(lineWithout.pcb).not.toBeNull();
      expect(Number(lineWith.pcb)).not.toBe(Number(lineWithout.pcb));
    });

    it('refuses TP3 for somebody employed here all year — that history is this employer’s', async () => {
      const longTimer = await makeEmployee('Here All Year', '5000.00', '2024-03-01');
      const res = await request(app.getHttpServer())
        .post(`/workforce/employees/${longTimer}/tp3`)
        .set('Authorization', bearer)
        .send({
          taxYear: 2026,
          previousEmployerName: 'Somewhere Else',
          grossCents: 100000,
          epfCents: 11000,
          mtdPaidCents: 5000,
          source: 'Borang TP3 dated 1 August 2026',
        })
        .expect(409);
      expect(res.body.message).toMatch(/started on 2024-03-01/);
    });

    it('refuses an opening-balance month before the employment started — that money belongs on TP3', async () => {
      const joiner = await makeEmployee('May Joiner', '6000.00', '2026-05-01');
      const res = await request(app.getHttpServer())
        .post('/workforce/payroll/ytd-opening')
        .set('Authorization', bearer)
        .send({
          legalEmployerId,
          source: 'Previous system payslips',
          months: [
            {
              staffId: joiner,
              taxYear: 2026,
              month: 3,
              grossCents: 600000,
              pcbCents: 20000,
              epfEmployeeCents: 66000,
            },
          ],
        })
        .expect(400);
      expect(res.body.message).toMatch(/Form TP3/);
    });
  });
});
