import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * RULE SETS REACH THE RUN (§6), AND RECURRING ITEMS REACH THE MONTH.
 *
 * Two people in August 2026: a front-desk clerk on RM3,000, whom the First
 * Schedule reaches, and a resident doctor on RM9,500, whom it does not. Two
 * clinic-rate rule sets: "Front desk" at RM20 an hour (below the Act's
 * RM23.08 for that wage) and RM250 a public-holiday shift (above it), and
 * "Doctors" at RM500 a public-holiday shift with no hourly rate. The clerk
 * also has a recurring housing allowance on their record.
 *
 * What has to be true: the clerk's hour is paid at the Act's figure and the
 * run BLOCKS naming the rule set; the clerk's holiday stands at RM250; the
 * doctor's holiday is RM500 as a company benefit with no "entitlement
 * unrecorded" question asked; the allowance arrives as a RECURRING input and
 * leaves again when the item is ended; Settings says who the rule set would
 * underpay before payroll does; and raising the rate clears the block.
 */
describe('Rule sets and recurring items in the payroll run (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let clerkId: string;
  let doctorId: string;
  let frontDeskPolicyId: string;
  let housingItemId: string;
  let runId: string;

  const http = () => request(app.getHttpServer());

  async function employ(staffId: string, employeeNo: string, position: string, salary: string) {
    await http()
      .post(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .send({
        employeeNo,
        position,
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1990-05-05',
        bankName: 'Maybank',
        bankAccountNo: '512345678901',
      })
      .expect(201);
    await http()
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: '2024-01-01',
        epfMembership: 'MALAYSIAN_CITIZEN',
        taxResidence: 'RESIDENT',
        pcbCategory: 'CATEGORY_1',
        qualifyingChildren: 0,
        restDayOfWeek: 0,
        lindungParticipation: 'NOT_PARTICIPATING',
        reason: 'Recorded at hire',
      })
      .expect(201);
    await http()
      .patch(`/workforce/employees/${staffId}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId })
      .expect(200);
    await http()
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: salary, basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);
  }

  async function worked(staffId: string, date: string, workedMinutes: number, overtimeMinutes = 0) {
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.attendanceRecord.create({
        data: {
          tenantId,
          staffId,
          clinicId,
          workDate: new Date(`${date}T00:00:00.000Z`),
          status: 'PRESENT',
          workedMinutes,
          overtimeMinutes,
          overtimeApproved: overtimeMinutes > 0,
        },
      }),
    );
  }

  async function calculate() {
    await http().patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
  }

  async function exceptionsFor(staffId: string) {
    const gate = await http().get(`/workforce/payroll/runs/${runId}/exceptions`).set('Authorization', bearer).expect(200);
    return (gate.body.exceptions as { code: string; severity: string; staffId: string | null; cause: string }[]).filter(
      (row) => row.staffId === staffId,
    );
  }

  async function inputsFor(staffId: string) {
    const res = await http()
      .get(`/workforce/payroll/inputs?period=2026-08&staffId=${staffId}`)
      .set('Authorization', bearer)
      .expect(200);
    return res.body as { componentCode: string; label: string | null; amount: string; source: string; kind: string }[];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Rule Set Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;

    clinicId = (await http().post('/clinics').set('Authorization', bearer).send({ name: 'Rule Set Clinic' }).expect(201)).body.id;
    legalEmployerId = (
      await http().post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Rule Set Sdn Bhd' }).expect(201)
    ).body.id;
    await http().post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);

    const [clerk, doctor] = await withTenantContext(prisma, tenantId, (tx) =>
      Promise.all([
        tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Front Desk Person', clinicId } }),
        tx.staff.create({ data: { tenantId, role: Role.DOCTOR_RESIDENT, fullName: 'Dr Resident Person', clinicId } }),
      ]),
    );
    clerkId = clerk.id;
    doctorId = doctor.id;
    await employ(clerkId, 'R-001', 'Clinic assistant', '3000.00');
    await employ(doctorId, 'R-002', 'Resident medical officer', '9500.00');

    // 31 August 2026 is a public holiday; both worked five hours of it. The
    // clerk also did two approved hours of overtime on a Wednesday.
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.publicHoliday.create({ data: { tenantId, date: new Date('2026-08-31T00:00:00.000Z'), name: 'Hari Kebangsaan' } }),
    );
    await worked(clerkId, '2026-08-12', 450, 120);
    await worked(clerkId, '2026-08-31', 300);
    await worked(doctorId, '2026-08-31', 300);

    housingItemId = (
      await http()
        .post(`/workforce/employees/${clerkId}/recurring-items`)
        .set('Authorization', bearer)
        .send({ componentCode: 'ALLOWANCE', label: 'Housing', amount: '200.00', effectiveFrom: '2026-01-01' })
        .expect(201)
    ).body.id;

    frontDeskPolicyId = (
      await http()
        .post('/workforce/payroll-policies')
        .set('Authorization', bearer)
        .send({
          name: 'Front desk',
          overtimeMode: 'CLINIC_RATE',
          clinicOvertimeHourly: '20.00',
          clinicPublicHolidayShift: '250.00',
          workforceCategory: 'ADMIN',
          // RM20 an hour is under the Act for the clerk on RM3,000. Storing it
          // is the clinic's to decide and Kuwick will, but not silently.
          belowActAcknowledged: true,
          belowActReason: 'Rate agreed in the front desk contracts',
        })
        .expect(201)
    ).body.id;
    await http()
      .post('/workforce/payroll-policies')
      .set('Authorization', bearer)
      .send({ name: 'Doctors', overtimeMode: 'CLINIC_RATE', clinicPublicHolidayShift: '500.00', workforceCategory: 'DOCTOR' })
      .expect(201);

    runId = (
      await http().post('/workforce/payroll/runs').set('Authorization', bearer).send({ period: '2026-08', clinicId }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('refuses a clinic-rate rule set with no amount, and a second rule set for the same group', async () => {
    await http()
      .post('/workforce/payroll-policies')
      .set('Authorization', bearer)
      .send({ name: 'Empty', overtimeMode: 'CLINIC_RATE' })
      .expect(400);
    await http()
      .post('/workforce/payroll-policies')
      .set('Authorization', bearer)
      .send({ name: 'Front desk again', overtimeMode: 'STATUTORY', workforceCategory: 'ADMIN' })
      .expect(409);
  });

  it('will not store a clinic rate under the Act for somebody it covers, unacknowledged', async () => {
    /*
     * A RM RATE IS UNDER THE ACT OR NOT DEPENDING ON WHOSE WAGE IT PRICES, so
     * this is assessed against the highest First Schedule wage the rule set
     * would cover — the Act's own figures rise with the wage, so that is the
     * employee a fixed amount fails first. Same acknowledgement as a
     * multiplier: the drawer has one rule, not two.
     */
    const held = await http()
      .post('/workforce/payroll-policies')
      .set('Authorization', bearer)
      .send({ id: frontDeskPolicyId, name: 'Front desk', overtimeMode: 'CLINIC_RATE', clinicOvertimeHourly: '5.00', workforceCategory: 'ADMIN' })
      .expect(400);
    expect(JSON.stringify(held.body.message)).toContain('BELOW');

    // And a rate that clears the Act needs nothing said about it at all.
    await http()
      .post('/workforce/payroll-policies')
      .set('Authorization', bearer)
      .send({ id: frontDeskPolicyId, name: 'Front desk', overtimeMode: 'CLINIC_RATE', clinicOvertimeHourly: '60.00', clinicPublicHolidayShift: '250.00', workforceCategory: 'ADMIN' })
      .expect(201);

    // Put it back for the tests that follow.
    await http()
      .post('/workforce/payroll-policies')
      .set('Authorization', bearer)
      .send({
        id: frontDeskPolicyId,
        name: 'Front desk',
        overtimeMode: 'CLINIC_RATE',
        clinicOvertimeHourly: '20.00',
        clinicPublicHolidayShift: '250.00',
        workforceCategory: 'ADMIN',
        belowActAcknowledged: true,
        belowActReason: 'Rate agreed in the front desk contracts',
      })
      .expect(201);
  });

  it('says in Settings who a clinic rate would underpay, before payroll does', async () => {
    const list = await http().get('/workforce/payroll-policies').set('Authorization', bearer).expect(200);
    const frontDesk = list.body.policies.find((row: { id: string }) => row.id === frontDeskPolicyId);
    expect(frontDesk.employeeCount).toBe(1);
    expect(frontDesk.appliesTo).toBe('Admin / front desk');
    expect(frontDesk.floor).toEqual({
      assessed: 1,
      below: [
        {
          staffId: clerkId,
          name: 'Front Desk Person',
          wages: '3000.00',
          // RM3,000 / 26 / 7.5 = RM15.38 an hour (rounded to the sen first), × 1.5 = RM23.07.
          shortfalls: ["An hour of overtime: RM20.00 against the Act's RM23.07."],
        },
      ],
    });
    const doctors = list.body.policies.find((row: { name: string }) => row.name === 'Doctors');
    expect(doctors.employeeCount).toBe(1);
    expect(doctors.floor).toEqual({ assessed: 0, below: [] });
  });

  it('pays the clerk’s hour at the clinic’s rate and names them in a warning', async () => {
    /*
     * THE ACT'S FIGURE IS NO LONGER SUBSTITUTED, AND THE RUN NO LONGER BLOCKS.
     *
     * Both were Kuwick overruling a decision that is the clinic's to take: an
     * employer may pay below the Act and owe the difference. Paying the Act's
     * figure instead put a number on the payslip that nobody in the clinic had
     * chosen, and blocking treated a deliberate choice as an error. What is
     * owed in return is that it is never silent — Settings marks the rule set
     * permanently, the payslip prints both rates, and this names the person.
     */
    await calculate();
    const own = await exceptionsFor(clerkId);
    const floor = own.find((row) => row.code === 'CLINIC_RATE_BELOW_STATUTORY');
    expect(floor?.severity).toBe('WARNING');
    expect(floor?.cause).toContain('"Front desk" rule set pays 1 day');
    // Money in the catalogue's sentences carries no RM prefix, as every other exception's does.
    expect(floor?.cause).toContain('at 40.00 where the Employment Act');
    expect(floor?.cause).toContain('requires 46.14');

    const inputs = await inputsFor(clerkId);
    const overtime = inputs.find((row) => row.label === 'Overtime');
    const holiday = inputs.find((row) => row.label === 'Public holiday pay');
    // Two hours at the clinic's RM20, not at the Act's RM15.38 × 1.5.
    expect(overtime?.amount).toBe('40.00');
    expect(overtime?.source).toBe('ATTENDANCE');
    // The holiday shift stands at the clinic's RM250: above the Act's two days (RM230.76).
    expect(holiday?.amount).toBe('250.00');
  });

  it('carries the recurring allowance into the month as a RECURRING input', async () => {
    const inputs = await inputsFor(clerkId);
    const housing = inputs.find((row) => row.source === 'RECURRING');
    expect(housing).toMatchObject({ componentCode: 'ALLOWANCE', label: 'Housing', amount: '200.00', kind: 'RECURRING' });
    const detail = await http().get(`/workforce/payroll/runs/${runId}`).set('Authorization', bearer).expect(200);
    const line = detail.body.lines.find((row: { staffId: string }) => row.staffId === clerkId);
    expect(Number(line.allowances)).toBe(200);
  });

  it('pays the doctor’s holiday at RM500 as a company benefit, and asks no entitlement question', async () => {
    const own = await exceptionsFor(doctorId);
    expect(own.map((row) => row.code)).not.toContain('OVERTIME_ENTITLEMENT_UNRECORDED');
    expect(own.map((row) => row.code)).not.toContain('CLINIC_RATE_BELOW_STATUTORY');
    const inputs = await inputsFor(doctorId);
    expect(inputs.find((row) => row.label === 'Public holiday pay')?.amount).toBe('500.00');
    const detail = await http().get(`/workforce/payroll/runs/${runId}`).set('Authorization', bearer).expect(200);
    const line = detail.body.lines.find((row: { staffId: string }) => row.staffId === doctorId);
    expect(Number(line.overtimePay)).toBe(500);
    expect(line.breakdown?.overtimePolicy).toMatchObject({ ruleSet: 'Doctors', how: 'CATEGORY', mode: 'CLINIC_RATE' });
  });

  it('clears the block once the rate is raised to the Act’s, and pays the clinic rate', async () => {
    await http()
      .post('/workforce/payroll-policies')
      .set('Authorization', bearer)
      .send({
        id: frontDeskPolicyId,
        name: 'Front desk',
        overtimeMode: 'CLINIC_RATE',
        clinicOvertimeHourly: '25.00',
        clinicPublicHolidayShift: '250.00',
        workforceCategory: 'ADMIN',
      })
      .expect(201);
    await calculate();
    const own = await exceptionsFor(clerkId);
    expect(own.map((row) => row.code)).not.toContain('CLINIC_RATE_BELOW_STATUTORY');
    const inputs = await inputsFor(clerkId);
    expect(inputs.find((row) => row.label === 'Overtime')?.amount).toBe('50.00');
  });

  it('stops paying a recurring item the month after it is ended', async () => {
    await http()
      .patch(`/workforce/employees/${clerkId}/recurring-items/${housingItemId}`)
      .set('Authorization', bearer)
      .send({ effectiveTo: '2026-07-31' })
      .expect(200);
    await calculate();
    const inputs = await inputsFor(clerkId);
    expect(inputs.some((row) => row.source === 'RECURRING')).toBe(false);
  });
});
