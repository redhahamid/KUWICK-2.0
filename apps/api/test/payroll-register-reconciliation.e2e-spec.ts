import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * THE REGISTER RECONCILES — AND SO DOES EVERY SURFACE BUILT ON IT.
 *
 * The owner's verdict on the previous build was that their payroll spreadsheet
 * was easier to understand than Kuwick. A spreadsheet has one property this
 * product had to earn back: every row adds up left to right, and the bottom
 * row is the sum of the rows above it. If either fails, nobody trusts any of
 * it, and no amount of design makes up for that.
 *
 * The register, the employee drawer, the Review summary and the Approve screen
 * are now four renderings of ONE server answer — `GET
 * /workforce/payroll/runs/:id/journey`. That is a design claim, and this is
 * what makes it a checked one:
 *
 *   1. every ROW adds up left to right, through the columns the register draws
 *   2. every TOTAL is the sum of its own column, not of a different one
 *   3. the totals agree with the RUN's own stored figures
 *   4. the grouped columns equal the components they group
 *   5. a scheme that was not worked out is COUNTED, never summed as nil
 *
 * These are asserted over the HTTP surface rather than against the service,
 * because a guarantee that only holds in a unit test is not one the browser
 * gets.
 */
describe('payroll register reconciliation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let clinicId: string;
  let legalEmployerId: string;
  let owner: string;

  const PERIOD = '2026-08-01';
  const server = () => app.getHttpServer();

  /** Money comes back as fixed-2 strings. Compare in cents, never in floats. */
  const cents = (value: string | null) => (value === null ? null : Math.round(Number(value) * 100));

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
      .set('Authorization', owner)
      .send({
        employeeNo: `E-${Math.floor(Math.random() * 1_000_000)}`,
        position: 'Clinic Assistant',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1990-06-15',
      })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staff.id}/statutory-classification`)
      .set('Authorization', owner)
      .send({
        effectiveFrom: '2020-01-01',
        epfMembership: 'MALAYSIAN_CITIZEN',
        lindungParticipation: 'NOT_PARTICIPATING',
        pcbApplicable: false,
        reason: 'Recorded at hire',
      })
      .expect(201);
    await request(server())
      .patch(`/workforce/employees/${staff.id}/legal-employer`)
      .set('Authorization', owner)
      .send({ legalEmployerId })
      .expect(200);
    await request(server())
      .post(`/workforce/employees/${staff.id}/salary`)
      .set('Authorization', owner)
      .send({ amount: salary, basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);
    return staff.id;
  }

  /**
   * SOMEBODY THE ENGINE REFUSES TO GUESS FOR. An election under Borang KWSP
   * 17A away from the Third Schedule's own rate is an instrument this system
   * holds no document for, so EPF is refused — while SOCSO and EIS, which
   * turn on age, are worked out as usual. One scheme unknown on a person the
   * run still pays, and a run exception with a cause behind it.
   */
  async function employeeWithRefusedEpf(name: string, salary: string) {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId } }),
    );
    await request(server())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', owner)
      .send({
        employeeNo: `E-${Math.floor(Math.random() * 1_000_000)}`,
        position: 'Clinic Assistant',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1988-03-02',
      })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staff.id}/statutory-classification`)
      .set('Authorization', owner)
      .send({
        effectiveFrom: '2020-01-01',
        epfMembership: 'MALAYSIAN_CITIZEN',
        // Part A prints 11% for a citizen under 60.
        epfEmployeeRate: 9,
        lindungParticipation: 'NOT_PARTICIPATING',
        pcbApplicable: false,
        reason: 'Recorded at hire',
      })
      .expect(201);
    await request(server())
      .patch(`/workforce/employees/${staff.id}/legal-employer`)
      .set('Authorization', owner)
      .send({ legalEmployerId })
      .expect(200);
    await request(server())
      .post(`/workforce/employees/${staff.id}/salary`)
      .set('Authorization', owner)
      .send({ amount: salary, basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);
    return staff.id;
  }

  const addInput = (staffId: string, componentCode: string, amount: string) =>
    request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', owner)
      .send({ staffId, period: PERIOD, componentCode, amount, kind: 'ADDITIONAL' })
      .expect(201);

  async function journey() {
    const run = await request(server())
      .post('/workforce/payroll/runs')
      .set('Authorization', owner)
      .send({ period: PERIOD, clinicId })
      .expect(201);
    await request(server())
      .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
      .set('Authorization', owner)
      .expect(200);
    const detail = await request(server())
      .get(`/workforce/payroll/runs/${run.body.id}`)
      .set('Authorization', owner)
      .expect(200);
    const view = await request(server())
      .get(`/workforce/payroll/runs/${run.body.id}/journey`)
      .set('Authorization', owner)
      .expect(200);
    return { runId: run.body.id as string, detail: detail.body, view: view.body };
  }

  beforeEach(async () => {
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Register Reconciliation Tenant' } }),
    );
    const created = await createOwnerAndBearer(prisma, tenantId);
    owner = created.bearer;

    const clinic = await request(server())
      .post('/clinics')
      .set('Authorization', owner)
      .send({ name: 'Branch A' })
      .expect(201);
    clinicId = clinic.body.id;
    const employer = await request(server())
      .post('/workforce/legal-employers')
      .set('Authorization', owner)
      .send({ name: `Reconciliation Employer ${randomId().slice(0, 8)}` })
      .expect(201);
    legalEmployerId = employer.body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', owner).expect(201);

    // A month with something in every column the register opens with, because
    // a register that only ever shows Basic proves nothing about whether it
    // adds up.
    const a = await employee('Nurul Hidayah', '3200.00');
    const b = await employee('Kavitha Menon', '3100.00');
    const c = await employee('Lim Wei Chen', '2750.00');
    await addInput(a, 'ALLOWANCE', '250.00');
    await addInput(b, 'COMMISSION', '420.00');
    await addInput(b, 'BONUS', '500.00');
    await addInput(c, 'CLAIM_REIMBURSEMENT', '145.60');
  });

  // -------------------------------------------------------------------------
  it('makes every row add up left to right, through the columns the register draws', async () => {
    const { view } = await journey();
    expect(view.pay.rows.length).toBeGreaterThan(0);

    /*
     * THE REGISTER'S OWN ARITHMETIC.
     *
     * Basic − Unpaid leave + Additional + Overtime + Incentive = Gross.
     *
     * Unpaid leave is SUBTRACTED and sits to the LEFT of Gross because
     * `grossPay` already nets it — s.18A makes an incomplete month's wages
     * smaller, it does not take a deduction from them. The column sat after
     * Gross once and the register visibly failed to foot.
     *
     * Compared as labelled rows rather than in a loop of bare assertions, so a
     * failure names the person instead of printing two numbers.
     */
    const acrossTheRow = view.pay.rows.map((row: Record<string, string | null>) => ({
      name: row.name,
      earningsReachGross:
        cents(row.basicSalary)! -
        cents(row.unpaidLeaveDeduction)! +
        cents(row.additionalEarnings)! +
        cents(row.overtimePay)! +
        cents(row.incentive)! ===
        cents(row.grossPay),
      // And what the person is actually paid is gross less what came off.
      grossLessDeductionsIsNet: cents(row.grossPay)! - cents(row.deductionTotal)! === cents(row.netPay),
    }));
    expect(acrossTheRow).toEqual(
      view.pay.rows.map((row: Record<string, string | null>) => ({
        name: row.name,
        earningsReachGross: true,
        grossLessDeductionsIsNet: true,
      })),
    );
  });

  it('groups Additional and SOCSO/EIS out of their own components, never out of a subtraction', async () => {
    const { view } = await journey();
    const grouped = view.pay.rows.map((row: Record<string, string | null>) => ({
      name: row.name,
      // "Additional" is allowances plus whatever else reached gross.
      additional: cents(row.additionalEarnings) === cents(row.allowances)! + cents(row.otherEarnings)!,
      // "Incentive" is the incentives and the bonus, which move together.
      incentive: cents(row.incentive) === cents(row.incentives)! + cents(row.bonus)!,
      // SOCSO/EIS is the pair — and NULL if either is unknown, because a
      // half-answer under a heading claiming both is a smaller number than the
      // clinic owes, printed as though it were the whole one.
      socsoEis:
        row.socsoEmployee === null || row.eisEmployee === null
          ? row.socsoEis === null
          : cents(row.socsoEis) === cents(row.socsoEmployee)! + cents(row.eisEmployee)!,
    }));
    expect(grouped).toEqual(
      view.pay.rows.map((row: Record<string, string | null>) => ({
        name: row.name,
        additional: true,
        incentive: true,
        socsoEis: true,
      })),
    );
  });

  it('foots every total on its own column, and on the run the register belongs to', async () => {
    const { detail, view } = await journey();
    const totals = view.pay.totals;
    const sum = (pick: (row: Record<string, string | null>) => string | null) =>
      view.pay.rows.reduce((acc: number, row: Record<string, string | null>) => acc + (cents(pick(row)) ?? 0), 0);

    /*
     * A COLUMN'S TOTAL IS THAT COLUMN'S SUM. This is the failure the register
     * carried for a while and nobody could see: the summary row's cells are
     * POSITIONAL, so a column that appears or disappears slides every figure
     * after it one place — putting PCB's total under NET PAY. It looks
     * plausible, which is what makes it dangerous. The screen now derives its
     * columns and its totals from ONE list; these are the figures that list
     * indexes into.
     */
    const footings: Record<string, number | null> = {};
    const expected: Record<string, number | null> = {};
    for (const [key, pick] of [
      ['basic', (r: Record<string, string | null>) => r.basicSalary],
      ['unpaidLeave', (r: Record<string, string | null>) => r.unpaidLeaveDeduction],
      ['allowances', (r: Record<string, string | null>) => r.allowances],
      ['overtime', (r: Record<string, string | null>) => r.overtimePay],
      ['incentive', (r: Record<string, string | null>) => r.incentive],
      ['otherEarnings', (r: Record<string, string | null>) => r.otherEarnings],
      ['additionalEarnings', (r: Record<string, string | null>) => r.additionalEarnings],
      ['gross', (r: Record<string, string | null>) => r.grossPay],
      ['net', (r: Record<string, string | null>) => r.netPay],
      ['deductions', (r: Record<string, string | null>) => r.deductionTotal],
      ['employerCost', (r: Record<string, string | null>) => r.employerCost],
      ['employerContributions', (r: Record<string, string | null>) => r.employerContributions],
      ['epfEmployee', (r: Record<string, string | null>) => r.epfEmployee],
      ['socsoEmployee', (r: Record<string, string | null>) => r.socsoEmployee],
      ['eisEmployee', (r: Record<string, string | null>) => r.eisEmployee],
      ['pcb', (r: Record<string, string | null>) => r.pcb],
    ] as const) {
      footings[key] = cents(totals[key]);
      expected[key] = sum(pick);
    }
    // One comparison, so a failure names every column that is out rather than
    // stopping at the first.
    expect(footings).toEqual(expected);

    // AND THE RUN AGREES. The register is a view of a stored run; if the two
    // disagree the run was not produced by the current calculation, and the
    // service says so rather than tidying it up.
    expect(totals.addsUp).toBe(true);
    expect(totals.discrepancy).toBeNull();
    expect(cents(totals.gross)).toBe(Math.round(Number(detail.grossTotal) * 100));
    expect(cents(totals.net)).toBe(Math.round(Number(detail.netTotal) * 100));
    expect(cents(totals.deductions)).toBe(Math.round(Number(detail.deductionTotal) * 100));
    expect(cents(totals.employerCost)).toBe(Math.round(Number(detail.employerCostTotal) * 100));

    // The month header's fourth figure. It was `employerCost - gross` worked
    // out in a browser until this existed — a payroll subtraction done by a
    // screen.
    expect(cents(totals.employerContributions)).toBe(cents(totals.employerCost)! - cents(totals.gross)!);
  });

  it('carries the drawer and the register on ONE row, so they cannot disagree', async () => {
    const { view } = await journey();
    for (const row of view.pay.rows) {
      // The drawer itemises `items`; the register draws the columns. Both are
      // fields of this same object — there is no second fetch to drift from.
      expect(Array.isArray(row.items)).toBe(true);
      // And the person's readiness travels with their money, so a status chip
      // beside a name is not a join the browser has to get right.
      expect(['READY', 'NEEDS_ATTENTION', 'NEEDS_SETUP']).toContain(row.state);
      expect(typeof row.blockers).toBe('number');
      expect(typeof row.warnings).toBe('number');
    }
  });

  it('counts a statutory figure that was not worked out instead of summing it as nil', async () => {
    /*
     * A clinic with no date of birth on somebody cannot have their SOCSO
     * worked out. The honest answer is "not worked out", and it must stay
     * null all the way to the cell: rendered as 0.00 it tells a clinic it owes
     * nothing, which is the one wrong answer that gets acted on.
     */
    const { view } = await journey();
    const unknown = view.pay.rows.filter(
      (row: Record<string, unknown>) =>
        row.epfEmployee === null || row.socsoEmployee === null || row.eisEmployee === null,
    );
    expect(view.pay.totals.statutoryNotCalculated).toBe(unknown.length);

    // The sum is over what was actually worked out — never over a null read
    // as zero.
    const known = view.pay.rows.filter((row: Record<string, unknown>) => row.statutoryEmployee !== null);
    expect(cents(view.pay.totals.statutoryEmployee)).toBe(
      known.reduce((acc: number, row: Record<string, string | null>) => acc + cents(row.statutoryEmployee)!, 0),
    );
  });

  it('counts the people each scheme’s own total leaves out, so a short column is not read as the answer', async () => {
    /*
     * `statutoryNotCalculated` counts the people whose THREE schemes could not
     * be added together — it cannot say which one was missing, and the
     * register foots EPF, SOCSO and EIS in columns of their own. A count of 3
     * printed under EPF when it was SOCSO that was unknown is a wrong answer
     * with a number attached, so each scheme carries its own count.
     *
     * An elected EPF share is the real case: an election under Borang KWSP 17A
     * away from the Third Schedule's own rate is an instrument this system
     * holds no document for, so EPF is refused rather than approximated —
     * while SOCSO and EIS, which turn on age, are worked out as usual. One
     * scheme unknown, two known, on the same person.
     */
    await employeeWithRefusedEpf('Tan Mei Ling', '2900.00');

    const { view } = await journey();
    const rows = view.pay.rows as Record<string, string | null>[];
    const missing = (field: string) => rows.filter((row) => row[field] === null).length;
    const totals = view.pay.totals;

    /*
     * THE CASE IS REAL BEFORE ANYTHING IS ASSERTED ABOUT THE COUNTS. Without
     * it the whole test passes on 0 === 0 and proves nothing — and it is the
     * ONE unknown scheme beside two known ones that makes a per-scheme count
     * say something a single `statutoryNotCalculated` cannot.
     */
    expect({ rows: rows.length, epf: missing('epfEmployee'), socso: missing('socsoEmployee'), eis: missing('eisEmployee') }).toEqual({
      rows: 4,
      epf: 1,
      socso: 0,
      eis: 0,
    });

    expect({
      epf: totals.epfNotCalculated,
      socso: totals.socsoNotCalculated,
      eis: totals.eisNotCalculated,
    }).toEqual({
      epf: missing('epfEmployee'),
      socso: missing('socsoEmployee'),
      eis: missing('eisEmployee'),
    });

    // And each column's figure is the sum over the people it DOES cover —
    // the unknown row skipped, never added as nil.
    for (const field of ['epfEmployee', 'socsoEmployee', 'eisEmployee'] as const) {
      expect({ field, total: cents(totals[field]) }).toEqual({
        field,
        total: rows.reduce((acc, row) => acc + (cents(row[field]) ?? 0), 0),
      });
    }
  });

  it('gives a row the reason for the thing its own status counts, not for something else', async () => {
    /*
     * THE CHIP AND THE REASON HAVE TO BE ABOUT THE SAME THING.
     *
     * `blockers` and `warnings` count the RUN'S exception rows. The reason
     * under them used to come from the employee's READINESS — a different
     * source entirely — so a person whose RECORD is complete but whose MONTH
     * raised an exception got a status chip with nothing behind it: a screen
     * saying "look at this" and refusing to say at what. The register prints
     * the reason on the row now rather than hiding it in a hover, which made
     * the empty one visible.
     *
     * The fixture is that exact shape, and nothing weaker will do: somebody
     * READY on their own record who clocked in and never clocked out. Their
     * readiness has nothing to say; the month does.
     */
    const halfPunched = await employee('Tan Mei Ling', '2900.00');
    await request(server())
      .post('/workforce/attendance/clock')
      .set('Authorization', owner)
      .send({ staffId: halfPunched, clinicId, at: '2026-08-03T01:00:00.000Z', source: 'MANUAL' })
      .expect(201);

    const { view } = await journey();
    const rows = view.pay.rows as Record<string, string | null | number>[];
    const flagged = rows.filter((row) => Number(row.blockers) > 0 || Number(row.warnings) > 0);

    // Non-vacuous, and the RIGHT shape: flagged by the month, ready on the record.
    expect(flagged.map((row) => ({ name: row.name, state: row.state, warnings: row.warnings }))).toEqual([
      { name: 'Tan Mei Ling', state: 'READY', warnings: 1 },
    ]);

    // So the row says what the month found, in the words the attention list
    // uses for it — not the silence the employee's own record has to offer.
    const causes = (view.review.attention as { what: string }[]).map((item) => item.what);
    expect(flagged[0].reason).toBe('1 day has no clock-in or clock-out.');
    expect(causes).toContain(flagged[0].reason);

    // A clean row still says nothing, because nothing is wrong with it.
    for (const row of rows.filter((r) => Number(r.blockers) === 0 && Number(r.warnings) === 0)) {
      expect({ name: row.name, reason: row.reason }).toEqual({ name: row.name, reason: null });
    }
  });

  it('keeps the approved month frozen, and the register reads the snapshot', async () => {
    const { runId, view } = await journey();
    const before = view.pay.totals;

    await request(server())
      .patch(`/workforce/payroll/runs/${runId}/approve`)
      .set('Authorization', owner)
      .send({ acknowledgeStatutoryGap: true })
      .expect(200);

    const after = await request(server())
      .get(`/workforce/payroll/runs/${runId}/journey`)
      .set('Authorization', owner)
      .expect(200);

    // APPROVAL CHANGES THE STATUS, NOT THE FIGURES. A month that reads
    // differently after it is signed off is a month nobody can stand behind.
    expect(after.body.run.status).toBe('APPROVED');
    const keys = ['gross', 'net', 'deductions', 'employerCost', 'employerContributions'] as const;
    expect(Object.fromEntries(keys.map((key) => [key, after.body.pay.totals[key]]))).toEqual(
      Object.fromEntries(keys.map((key) => [key, before[key]])),
    );
    expect(after.body.pay.totals.addsUp).toBe(true);
  });
});
