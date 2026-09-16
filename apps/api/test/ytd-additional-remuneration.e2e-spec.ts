import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * THE FLAG WAS OBEYED FOR ONE MONTH AND FORGOTTEN FOR THE OTHER ELEVEN.
 *
 * LHDN taxes ADDITIONAL remuneration by a different part of the MTD method from
 * normal monthly pay, and the method is cumulative — so the year has to carry
 * the two totals apart. A component carries the clinic's own
 * `additionalRemuneration` flag, and the calculation has always split the tax
 * base by it correctly.
 *
 * It never wrote the split down. So when a run was approved, the year-to-date
 * row was filled from `bonus + incentives` — two hardcoded columns — and
 * anything ELSE the clinic marked as additional remuneration was taxed properly
 * in its own month and then vanished from the year. Every month afterwards
 * computed on a year that was missing it.
 *
 * Found by tracing the field rather than by a payslip being wrong, which is why
 * it was found before the account holder's UAT rather than during it.
 *
 * Aisyah is on RM4,000 and receives a RM3,000 long-service award in January —
 * a component this clinic created and marked additional, which is neither Bonus
 * nor Incentive and so fell through exactly the gap described.
 */
describe('the year remembers what was additional remuneration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let awardedId: string;
  let plainId: string;

  const http = () => request(app.getHttpServer());

  const employ = async (name: string, employeeNo: string): Promise<string> => {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId } }),
    );
    await http()
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({
        employeeNo,
        position: 'Clinic assistant',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate: '2026-01-01',
        dateOfBirth: '1991-04-04',
        bankName: 'Maybank',
        bankAccountNo: '512345678901',
      })
      .expect(201);
    await http()
      .post(`/workforce/employees/${staff.id}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: '2026-01-01',
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
      .patch(`/workforce/employees/${staff.id}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId })
      .expect(200);
    await http()
      .post(`/workforce/employees/${staff.id}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '4000.00', basis: 'MONTHLY', effectiveFrom: '2026-01-01', reason: 'Starting salary' })
      .expect(201);
    return staff.id;
  };

  const ytdFor = async (staffId: string, month: number) =>
    withTenantContext(prisma, tenantId, (tx) => tx.employeeYtd.findFirst({ where: { staffId, taxYear: 2026, month } }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'YTD Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await http().post('/clinics').set('Authorization', bearer).send({ name: 'YTD Clinic' }).expect(201)).body.id;
    legalEmployerId = (
      await http().post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'YTD Sdn Bhd' }).expect(201)
    ).body.id;
    await http()
      .post(`/workforce/legal-employers/${legalEmployerId}/statutory-profile`)
      .set('Authorization', bearer)
      .send({ effectiveFrom: '2026-01-01', hrdRegistration: 'NOT_REGISTERED', reason: 'Below headcount' })
      .expect(201);
    await http().post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);

    // The clinic's own component: additional remuneration for tax, and neither
    // Bonus nor Incentive — which is the whole point.
    await http()
      .post('/workforce/pay-components')
      .set('Authorization', bearer)
      .send({
        code: 'LONG_SERVICE_AWARD',
        name: 'Long service award',
        type: 'ADDITION',
        category: 'REMUNERATION',
        includeIn: 'GROSS_AND_NET',
        pcbLiable: true,
        epfLiable: true,
        socsoLiable: true,
        eisLiable: true,
        additionalRemuneration: true,
      })
      .expect(201);

    awardedId = await employ('Aisyah Anugerah', 'Y-001');
    plainId = await employ('Bakri Biasa', 'Y-002');

    await http()
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({
        staffId: awardedId,
        period: '2026-01-01',
        componentCode: 'LONG_SERVICE_AWARD',
        amount: '3000.00',
        kind: 'ADDITIONAL',
        reason: 'Ten years',
      })
      .expect(201);
    // A plain allowance for the other employee, to prove the fix does not
    // simply push everything into the additional column.
    await http()
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({
        staffId: plainId,
        period: '2026-01-01',
        componentCode: 'ALLOWANCE',
        amount: '3000.00',
        kind: 'RECURRING',
        reason: 'Monthly allowance',
      })
      .expect(201);

    const runId = (
      await http().post('/workforce/payroll/runs').set('Authorization', bearer).send({ period: '2026-01', clinicId }).expect(201)
    ).body.id;
    await http().patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
    await http()
      .patch(`/workforce/payroll/runs/${runId}/approve`)
      .set('Authorization', bearer)
      .send({ acknowledgeStatutoryGap: true })
      .expect(200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('carries a clinic component marked additional into the year, not zero', async () => {
    // This was 0 before: `bonus + incentives` are both nil, and the award is
    // neither. The whole RM3,000 fell out of the year.
    const ytd = await ytdFor(awardedId, 1);
    expect(ytd?.additionalRemunerationCents).toBe(300000);
  });

  it('leaves an ordinary allowance out of it, which is the other half of being right', async () => {
    // Same money, same month, no flag. A fix that simply counted everything
    // would pass the test above and be just as wrong.
    const ytd = await ytdFor(plainId, 1);
    expect(ytd?.additionalRemunerationCents).toBe(0);
  });

  it('still records the month’s gross in full, because the employee was paid it', async () => {
    // RM4,000 salary + RM3,000 award. Splitting the tax base never changes what
    // the person received.
    const ytd = await ytdFor(awardedId, 1);
    expect(ytd?.grossCents).toBe(700000);
  });

  it('writes the tax base in both halves on the run, so the year has something to read', async () => {
    const line = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollLine.findFirst({ where: { staffId: awardedId } }),
    );
    const bases = ((line?.breakdown ?? {}) as { bases?: { pcbNormalCents?: number; pcbAdditionalCents?: number } }).bases;
    expect(bases?.pcbAdditionalCents).toBe(300000);
    expect(bases?.pcbNormalCents).toBe(400000);
  });
});
