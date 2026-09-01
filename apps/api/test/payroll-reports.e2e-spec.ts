import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * PAYROLL REPORTS READ THE RUN, THEY DO NOT RECOMPUTE IT.
 *
 * A report that adds up salaries its own way is a second engine, and the two
 * disagree in the month somebody finally checks. These tests assert the
 * relationship rather than the numbers: every report total equals the run's
 * own total, nulls survive as nulls, and a provisional run says so on the
 * report as well as on the screen it came from.
 */
describe('payroll reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
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

  async function employee(name: string, salary: string) {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId } }),
    );
    await request(server())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: `E-${Math.floor(Math.random() * 1000000)}`,
        position: 'Clinic Assistant',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1990-06-15',
        pcbApplicable: false,
      })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staff.id}/salary`)
      .set('Authorization', bearer)
      .send({ amount: salary, basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);
    return staff.id;
  }

  async function runFor(period: string) {
    const run = await request(server())
      .post('/workforce/payroll/runs')
      .set('Authorization', bearer)
      .send({ period, clinicId })
      .expect(201);
    const calculated = await request(server())
      .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
      .set('Authorization', bearer)
      .expect(200);
    return { id: run.body.id as string, body: calculated.body };
  }

  const report = async (path: string) =>
    (await request(server()).get(path).set('Authorization', bearer).expect(200)).body;

  beforeEach(async () => {
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Reports Tenant' } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    const clinic = await request(server())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Branch A' })
      .expect(201);
    clinicId = clinic.body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
  });

  // -------------------------------------------------------------------------
  it('lists what exists AND what does not, so a missing report is visible rather than assumed', async () => {
    const catalogue = await report('/workforce/payroll/reports');
    expect(catalogue.available.map((r: { key: string }) => r.key)).toEqual([
      'PAYROLL_REGISTER',
      'EMPLOYER_COST',
      'STATUTORY_TOTALS',
      'VARIANCE',
      'CLAIMS',
    ]);
    // The named absences carry a reason, not a "coming soon".
    expect(catalogue.notAvailableYet.length).toBeGreaterThan(0);
    for (const missing of catalogue.notAvailableYet) {
      expect(missing.why.length).toBeGreaterThan(30);
    }
  });

  it('the register totals ARE the run totals, not a second sum of the same rows', async () => {
    await employee('Nurul Aina', '3000.00');
    await employee('Hafiz Osman', '2600.00');
    const run = await runFor('2026-08-01');

    const register = await report(`/workforce/payroll/runs/${run.id}/reports/register`);
    expect(register.rows).toHaveLength(2);
    expect(register.totals.netPay).toBe(Number(run.body.netTotal).toFixed(2));
    expect(register.totals.grossPay).toBe(Number(run.body.grossTotal).toFixed(2));
    expect(register.totals.employerCost).toBe(Number(run.body.employerCostTotal).toFixed(2));
    expect(register.totals.employees).toBe(run.body.employeeCount);

    // Every row can be opened. A total nobody can drill into is a number you
    // have to trust.
    for (const row of register.rows) {
      expect(row.drill).toMatch(/^\/admin\/hr\/employees\//);
    }

    /*
     * THE ROW ADDS UP LEFT TO RIGHT.
     *
     * A register showing a RM4,200 salary beside a RM4,064.52 gross, with the
     * unpaid-leave day that separates them not on the row, is a payslip that
     * does not add up — and nobody would find it by looking, because both
     * numbers are individually right.
     */
    for (const row of register.rows) {
      const earnings =
        Number(row.basicSalary) + Number(row.allowances) + Number(row.overtimePay) +
        Number(row.incentives) + Number(row.bonus) - Number(row.unpaidLeaveDeduction);
      expect(earnings).toBeCloseTo(Number(row.grossPay), 2);
    }

    // And every column foots, from the API rather than from the screen.
    for (const field of ['basicSalary', 'allowances', 'overtimePay', 'unpaidLeaveDeduction'] as const) {
      const summed = register.rows.reduce((total: number, row: Record<string, string>) => total + Number(row[field]), 0);
      expect(Number(register.totals[field])).toBeCloseTo(summed, 2);
    }
  });

  it('cost to the clinic is gross PLUS employer contributions, named separately from take-home pay', async () => {
    await employee('Nurul Aina', '3000.00');
    const run = await runFor('2026-08-01');
    const cost = await report(`/workforce/payroll/runs/${run.id}/reports/employer-cost`);

    expect(cost.byBranch).toHaveLength(1);
    expect(cost.byBranch[0].label).toBe('Branch A');
    expect(cost.total.employerCost).toBe(Number(run.body.employerCostTotal).toFixed(2));
    // Take-home pay is nowhere in this report's totals — that is the confusion
    // it exists to prevent.
    expect(cost.total).not.toHaveProperty('netPay');
  });

  /*
   * NULL SURVIVES. Summing an unknown statutory figure as zero is how a clinic
   * files a return for less than it owes and finds out from LHDN.
   */
  it('refuses to total a statutory scheme it could not work out, and says how many are missing', async () => {
    await employee('Nurul Aina', '3000.00');
    await employee('Hafiz Osman', '2600.00');
    const run = await runFor('2026-08-01');
    const statutory = await report(`/workforce/payroll/runs/${run.id}/reports/statutory`);

    const employer = statutory.byEmployer[0];
    const pcb = employer.schemes.find((s: { scheme: string }) => s.scheme === 'PCB');
    // Nobody in this fixture pays PCB, so it IS computable — as nil entered by
    // nobody, which the note has to be honest about.
    expect(pcb.note).toMatch(/does not work monthly tax out/i);

    // Whatever the state, a scheme is either fully totalled or null — never a
    // partial sum presented as a total.
    for (const scheme of employer.schemes) {
      if (scheme.notComputed > 0) {
        expect(scheme.total).toBeNull();
        expect(scheme.note).toMatch(/Not worked out for|missing for/i);
      } else {
        expect(scheme.total).not.toBeNull();
      }
    }

    expect(statutory.notASubmission).toMatch(/not a submission/i);
    expect(statutory.notASubmission).toMatch(/nothing here has been filed/i);
  });

  it('a provisional run says so ON the report, not only on the screen it came from', async () => {
    await employee('Nurul Aina', '3000.00');
    const run = await runFor('2026-08-01');
    for (const path of ['register', 'employer-cost', 'statutory', 'variance']) {
      const body = await report(`/workforce/payroll/runs/${run.id}/reports/${path}`);
      expect(body.provisional).toBe(true);
      expect(body.provisionalNote).toMatch(/have not been checked against KWSP/);
    }
  });

  describe('variance', () => {
    it('says there is nothing to compare with rather than showing a table of zeroes', async () => {
      await employee('Nurul Aina', '3000.00');
      const run = await runFor('2026-08-01');
      const variance = await report(`/workforce/payroll/runs/${run.id}/reports/variance`);
      expect(variance.comparedWith).toBeNull();
      expect(variance.rows).toEqual([]);
      expect(variance.note).toMatch(/first payroll run/);
    });

    it('every movement is current minus previous, and joiners and leavers are named', async () => {
      const staying = await employee('Nurul Aina', '3000.00');
      const leaving = await employee('Hafiz Osman', '2600.00');
      const july = await runFor('2026-07-01');
      expect(july.body.employeeCount).toBe(2);

      // Hafiz leaves; Nurul gets a rise from August.
      await withTenantContext(prisma, tenantId, (tx) =>
        tx.staff.update({ where: { id: leaving }, data: { active: false } }),
      );
      await request(server())
        .post(`/workforce/employees/${staying}/salary`)
        .set('Authorization', bearer)
        .send({ amount: '3400.00', basis: 'MONTHLY', effectiveFrom: '2026-08-01', reason: 'Annual review' })
        .expect(201);
      const august = await runFor('2026-08-01');

      const variance = await report(`/workforce/payroll/runs/${august.id}/reports/variance`);
      expect(variance.comparedWith.period).toBe('2026-07');

      const nurul = variance.rows.find((r: { staffId: string }) => r.staffId === staying);
      expect(nurul.state).toBe('BOTH');
      // THE MOVEMENT IS A SUBTRACTION. The mockup defect was a comparison
      // month carrying the current month's totals beside non-zero movements.
      expect(Number(nurul.movement)).toBeCloseTo(Number(nurul.current) - Number(nurul.previous), 2);
      expect(Number(nurul.movement)).toBeGreaterThan(0);

      // Somebody paid last month and not this one is NAMED, not silently gone.
      const hafiz = variance.rows.find((r: { staffId: string }) => r.staffId === leaving);
      expect(hafiz.state).toBe('LEFT');
      expect(hafiz.current).toBeNull();
      expect(Number(hafiz.movement)).toBeLessThan(0);
      expect(variance.totals.left).toBe(1);

      expect(Number(variance.totals.movement)).toBeCloseTo(
        Number(variance.totals.current) - Number(variance.totals.previous),
        2,
      );
    });
  });

  it('the claims report shows the route each approved claim was paid by, and proves none has two', async () => {
    const staffId = await employee('Nurul Aina', '3000.00');
    const claim = await request(server())
      .post('/workforce/claims')
      .set('Authorization', bearer)
      .send({
        staffId,
        category: 'TRAVEL',
        description: 'Taxi to the branch handover',
        amountClaimed: '48.00',
        claimDate: '2026-08-04',
      })
      .expect(201);
    await request(server())
      .post(`/workforce/claims/${claim.body.id}/decide`)
      .set('Authorization', bearer)
      .send({ decision: 'APPROVED', amountApproved: '48.00', paymentRoute: 'FINANCE', reason: 'Receipt attached' })
      .expect(201);

    const claims = await report('/workforce/payroll/reports/claims?from=2026-08-01&to=2026-08-31');
    expect(claims.rows).toHaveLength(1);
    // The range is the EXPENSE's own date. A claim incurred on 4 August and
    // approved in September is an August cost, and filtering by the decision
    // date would leave August looking cheaper than it was.
    expect(claims.rows[0].claimDate).toBe('2026-08-04');
    expect(claims.periodMeans).toMatch(/expenses incurred/);
    expect(claims.rows[0].route).toBe('FINANCE');
    expect(claims.rows[0].settled).toBe(false);
    expect(claims.totals.throughFinance).toBe('48.00');
    expect(claims.totals.throughPayroll).toBe('0.00');
    expect(claims.totals.awaitingPayment).toBe(1);
    expect(claims.doublePaymentCheck).toMatch(/exactly one payment route/);
  });
});
