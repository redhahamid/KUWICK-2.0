import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * EXTRA PAY IS ENTERED ONE ITEM AT A TIME, AND STAYS ONE ITEM AT A TIME.
 *
 * The grid's "Other income" cell used to fold everything typed into a single
 * hand-keyed Allowance line — one figure, one statutory treatment — which is
 * how a January with a director's fee, a locum fee and an allowance could not
 * be matched to the real payroll. The cell now opens the month's items. This
 * proves the server side of that: two items become two rows and two lines,
 * each with its own treatment; the cell's figure is exactly their sum; a
 * second amount of the same item edits the line rather than doubling it; and
 * every row says which cell counts it and where it came from.
 */
jest.setTimeout(120_000);

describe('the month’s items, one line each (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let clinicId: string;
  let staffId: string;
  let runId: string;

  const JOINED = '2026-01-01';
  const PERIOD = '2026-01';
  const server = () => app.getHttpServer();
  const get = (path: string) => request(server()).get(path).set('Authorization', owner);
  const input = (body: Record<string, unknown>) =>
    request(server()).post('/workforce/payroll/inputs').set('Authorization', owner).send({ staffId, period: `${PERIOD}-01`, ...body });
  const calculate = () => request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', owner).expect(200);
  const journeyRow = async () => {
    const journey = (await get(`/workforce/payroll/runs/${runId}/journey`).expect(200)).body;
    return (journey.pay.rows as { staffId: string; otherIncome: string; otherDeductions: string; grossPay: string; items: { componentCode: string; label: string; amount: string; source: string }[] }[]).find(
      (row) => row.staffId === staffId,
    )!;
  };
  const lines = async () =>
    (await get(`/workforce/payroll/inputs?period=${PERIOD}-01&staffId=${staffId}`).expect(200)).body as {
      id: string;
      componentCode: string;
      itemName: string;
      amount: string;
      bucket: string;
      column: string;
      origin: string;
      sourceLink: string | null;
      editable: boolean;
    }[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Items Tenant' } }));
    owner = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'KLINIK HIJRAA BANGI' }).expect(201)).body.id;
    const employer = await request(server())
      .post('/workforce/legal-employers')
      .set('Authorization', owner)
      .send({ name: 'Hijraa Bangi Sdn Bhd', epfEmployerNo: 'EPF-HB-2' })
      .expect(201);
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', owner).expect(201);

    const created = await request(server())
      .post('/workforce/employees')
      .set('Authorization', owner)
      .send({
        fullName: 'Hijraa Doktor',
        role: Role.DOCTOR_RESIDENT,
        clinicId,
        position: 'Medical Officer',
        employmentType: 'PERMANENT',
        startDate: JOINED,
        dateOfBirth: '1990-05-05',
        epfNumber: 'E-778899',
        socsoNumber: 'S-778899',
        bankName: 'Maybank',
        bankAccountNo: '512345678902',
      })
      .expect(201);
    staffId = created.body.staff.id;
    await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', owner)
      .send({
        effectiveFrom: JOINED,
        epfMembership: 'MALAYSIAN_CITIZEN',
        lindungParticipation: 'NOT_PARTICIPATING',
        restDayOfWeek: 0,
        taxResidence: 'RESIDENT',
        pcbCategory: 'CATEGORY_1',
        reason: 'At hire',
      })
      .expect(201);
    await request(server()).patch(`/workforce/employees/${staffId}/legal-employer`).set('Authorization', owner).send({ legalEmployerId: employer.body.id }).expect(200);
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', owner)
      .send({ amount: '8000.00', basis: 'MONTHLY', effectiveFrom: JOINED, reason: 'Starting salary' })
      .expect(201);

    runId = (await request(server()).post('/workforce/payroll/runs').set('Authorization', owner).send({ period: PERIOD, clinicId }).expect(201)).body.id;
    await calculate();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('turns two items into two lines, each its own item, and the cell into exactly their sum', async () => {
    await input({ componentCode: 'DIRECTOR_FEE', amount: '2000.00', reason: 'Board meeting, January' }).expect(201);
    await input({ componentCode: 'LOCUM_FEE', amount: '900.00', earnedPeriod: '2025-12-01', reason: 'Three December sessions' }).expect(201);
    await input({ componentCode: 'ADVANCE_RECOVERY', amount: '150.00', reason: 'Salary advance, second of three' }).expect(201);
    await calculate();

    const row = await journeyRow();
    const manual = row.items.filter((item) => item.source === 'MANUAL').map((item) => [item.componentCode, item.amount]).sort();
    expect(manual).toEqual([
      ['ADVANCE_RECOVERY', '150.00'],
      ['DIRECTOR_FEE', '2000.00'],
      ['LOCUM_FEE', '900.00'],
    ]);
    // THE CELL IS THE SUM OF THE LINES IT COUNTS — and only those.
    expect(row.otherIncome).toBe('2900.00');
    expect(row.otherDeductions).toBe('150.00');
    expect(row.grossPay).toBe('10900.00');

    // And the register itemises them separately, under their own names.
    const register = (await get(`/workforce/payroll/runs/${runId}/reports/register`).expect(200)).body;
    const mine = (register.rows as { staffId: string; components: { code: string; label: string }[] }[]).find((r) => r.staffId === staffId)!;
    const codes = mine.components.map((component) => component.code);
    expect(codes).toEqual(expect.arrayContaining(['DIRECTOR_FEE', 'LOCUM_FEE', 'ADVANCE_RECOVERY']));
    expect(codes.filter((code) => code === 'DIRECTOR_FEE')).toHaveLength(1);
    // Arrears say which month they were earned in, on the payslip's own lines; a line for this month says nothing extra.
    const payslip = await withTenantContext(prisma, tenantId, (tx) => tx.payrollLine.findFirst({ where: { payrollRunId: runId, staffId } }));
    const frozen = JSON.stringify(payslip?.breakdown ?? {});
    expect(frozen).toMatch(/Locum fee \(December 2025\)/);
    expect(frozen).not.toMatch(/Director.s fee \(/);
  });

  it('says which cell counts each row and where it came from', async () => {
    const rows = await lines();
    const by = (code: string) => rows.find((row) => row.componentCode === code)!;
    expect(by('DIRECTOR_FEE')).toMatchObject({ bucket: 'OTHER_INCOME', column: 'Other income', itemName: "Director's fee", origin: 'Entered by Test Owner', sourceLink: null, editable: true });
    expect(by('LOCUM_FEE')).toMatchObject({ bucket: 'OTHER_INCOME', itemName: 'Locum fee' });
    expect(by('ADVANCE_RECOVERY')).toMatchObject({ bucket: 'DEDUCTION', column: 'Other' });
    // Nothing counted twice: the lines under "Other income" sum to the cell.
    const counted = rows.filter((row) => row.bucket === 'OTHER_INCOME').reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0);
    expect(counted).toBe(290000);
  });

  it('edits the line when the same item is sent again, rather than adding a second one', async () => {
    await input({ componentCode: 'DIRECTOR_FEE', amount: '2500.00', reason: 'Corrected after the board minutes' }).expect(201);
    await calculate();
    const rows = await lines();
    expect(rows.filter((row) => row.componentCode === 'DIRECTOR_FEE')).toHaveLength(1);
    expect(rows.find((row) => row.componentCode === 'DIRECTOR_FEE')!.amount).toBe('2500.00');
    expect((await journeyRow()).otherIncome).toBe('3400.00');
  });

  it('removes a line and the cell follows', async () => {
    const rows = await lines();
    const locum = rows.find((row) => row.componentCode === 'LOCUM_FEE')!;
    await request(server()).delete(`/workforce/payroll/inputs/${locum.id}`).set('Authorization', owner).expect(200);
    await calculate();
    expect((await journeyRow()).otherIncome).toBe('2500.00');
    expect((await lines()).some((row) => row.componentCode === 'LOCUM_FEE')).toBe(false);
  });

  it('refuses an item that is not in Payroll items, naming it', async () => {
    const refused = await input({ componentCode: 'BOD_FEE', amount: '100.00' }).expect(400);
    expect(String(refused.body.message)).toContain('BOD_FEE');
  });
});
