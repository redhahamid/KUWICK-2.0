import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * OWN COLUMNS AND CARRY FORWARD.
 *
 * A clinic's habit is a spreadsheet: one column per kind of pay, last month's
 * figures already there, only the numbers change. Two switches under Payroll
 * items give it that — "own column" and "carry forward" — and this proves the
 * server side of both:
 *
 *  - the switches are refused on anything the run derives, and a column is
 *    refused on a deduction;
 *  - a switched-on item gets its own column in the journey, in Payroll items
 *    order, and its money leaves Other income so nothing is counted twice;
 *  - starting a month copies last month's hand-keyed lines for those items,
 *    marks them, moves an earned-in month on by one, and leaves a one-off
 *    late payment behind — exactly the rule the owner gave;
 *  - the run says so, per person, as an INFO row a reviewer reads;
 *  - an edit makes the line the person's own and keeps what the drawer keyed
 *    unless told to clear it;
 *  - a discarded and restarted month copies nothing twice, so a line
 *    somebody cleared on purpose stays cleared; and a line already keyed for
 *    the month is left alone.
 */
jest.setTimeout(180_000);

type Line = {
  id: string;
  staffId: string;
  componentCode: string;
  amount: string;
  bucket: string;
  column: string;
  origin: string;
  reason: string | null;
  earnedPeriod: string | null;
  carriedFromMonth: string | null;
  editable: boolean;
};
type Cell = { amount: string; entered: string | null; editable: boolean; carried: boolean; inputId: string | null };
type Journey = {
  pay: {
    columns: { code: string; name: string; carryForward: boolean }[];
    rows: { staffId: string; otherIncome: string; grossPay: string; columns: Record<string, Cell>; items: { componentCode: string; carried: boolean }[] }[];
    totals: { otherIncome: string; columns: Record<string, string> };
  };
  review: { attention: { code: string; severity: string; staffId: string | null; what: string }[] };
};

describe('own columns and carry forward (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let clinicId: string;
  let doctor: string;
  let nurse: string;
  let january: string;
  let february: string;

  const JOINED = '2025-12-01';
  const server = () => app.getHttpServer();
  const get = (path: string) => request(server()).get(path).set('Authorization', owner);
  const post = (path: string, body: Record<string, unknown>) => request(server()).post(path).set('Authorization', owner).send(body);
  const input = (staffId: string, period: string, body: Record<string, unknown>) =>
    post('/workforce/payroll/inputs', { staffId, period: `${period}-01`, ...body });
  const startRun = (period: string) => post('/workforce/payroll/runs', { period, clinicId });
  const calculate = (runId: string) => request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', owner).expect(200);
  const journey = async (runId: string) => (await get(`/workforce/payroll/runs/${runId}/journey`).expect(200)).body as Journey;
  const lines = async (staffId: string, period: string) =>
    (await get(`/workforce/payroll/inputs?period=${period}-01&staffId=${staffId}`).expect(200)).body as Line[];
  const line = async (staffId: string, period: string, code: string) => (await lines(staffId, period)).find((row) => row.componentCode === code);
  const components = async () => (await get('/workforce/pay-components').expect(200)).body.components as Record<string, unknown>[];
  const component = async (code: string) => (await components()).find((row) => row.code === code)!;
  /** Send an item back whole with something changed — the way the settings page saves a row. */
  const saveItem = async (code: string, changes: Record<string, unknown>, status: number) => {
    const row = await component(code);
    return post('/workforce/pay-components', {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      category: row.category,
      includeIn: row.includeIn,
      pcbLiable: row.pcbLiable,
      epfLiable: row.epfLiable,
      socsoLiable: row.socsoLiable,
      eisLiable: row.eisLiable,
      hrdLiable: row.hrdLiable,
      includeInOrpBase: row.includeInOrpBase,
      includeInUnpaidLeaveBase: row.includeInUnpaidLeaveBase,
      additionalRemuneration: row.additionalRemuneration,
      prorated: row.prorated,
      employerSide: row.employerSide,
      gridColumn: row.gridColumn,
      carryForward: row.carryForward,
      active: row.active,
      ...changes,
    }).expect(status);
  };

  const hire = async (fullName: string, role: Role, suffix: string, legalEmployerId: string) => {
    const created = await post('/workforce/employees', {
      fullName,
      role,
      clinicId,
      position: role === Role.DOCTOR_RESIDENT ? 'Medical Officer' : 'Staff nurse',
      employmentType: 'PERMANENT',
      startDate: JOINED,
      dateOfBirth: '1990-05-05',
      epfNumber: `E-${suffix}`,
      socsoNumber: `S-${suffix}`,
      bankName: 'Maybank',
      bankAccountNo: `5123456789${suffix.slice(-2)}`,
    }).expect(201);
    const staffId = created.body.staff.id as string;
    await post(`/workforce/employees/${staffId}/statutory-classification`, {
      effectiveFrom: JOINED,
      epfMembership: 'MALAYSIAN_CITIZEN',
      lindungParticipation: 'NOT_PARTICIPATING',
      restDayOfWeek: 0,
      taxResidence: 'RESIDENT',
      pcbCategory: 'CATEGORY_1',
      reason: 'At hire',
    }).expect(201);
    await request(server()).patch(`/workforce/employees/${staffId}/legal-employer`).set('Authorization', owner).send({ legalEmployerId }).expect(200);
    await post(`/workforce/employees/${staffId}/salary`, { amount: role === Role.DOCTOR_RESIDENT ? '8000.00' : '3200.00', basis: 'MONTHLY', effectiveFrom: JOINED, reason: 'Starting salary' }).expect(201);
    return staffId;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Carry Tenant' } }));
    owner = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await post('/clinics', { name: 'KLINIK HIJRAA BANGI' }).expect(201)).body.id;
    const employer = await post('/workforce/legal-employers', { name: 'Hijraa Bangi Sdn Bhd', epfEmployerNo: 'EPF-HB-3' }).expect(201);
    await post('/workforce/pay-components/seed', {}).expect(201);
    doctor = await hire('Hijraa Doktor', Role.DOCTOR_RESIDENT, '990101', employer.body.id);
    nurse = await hire('Hijraa Jururawat', Role.FRONT_DESK_CLINICAL_STAFF, '990102', employer.body.id);

    january = (await startRun('2026-01').expect(201)).body.id;
    await calculate(january);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('refuses a column or carry forward on an item the run derives, and a column on a deduction', async () => {
    const overtime = await saveItem('OVERTIME', { gridColumn: true }, 400);
    expect(String(overtime.body.message)).toMatch(/cannot have its own grid column or carry forward/);
    const basic = await saveItem('BASIC', { carryForward: true }, 400);
    expect(String(basic.body.message)).toMatch(/cannot have its own grid column or carry forward/);
    const deduction = await saveItem('ADVANCE_RECOVERY', { gridColumn: true }, 400);
    expect(String(deduction.body.message)).toMatch(/Only an addition can have its own column/);

    // Layout, not treatment: no date and no reason, saved in place.
    await saveItem('DIRECTOR_FEE', { gridColumn: true, carryForward: true }, 201);
    await saveItem('LOCUM_FEE', { gridColumn: true, carryForward: true }, 201);
    await saveItem('ALLOWANCE', { carryForward: true }, 201);
    expect(await component('DIRECTOR_FEE')).toMatchObject({ gridColumn: true, carryForward: true, handKeyed: true, version: 1 });
    expect(await component('ALLOWANCE')).toMatchObject({ gridColumn: false, carryForward: true, handKeyed: true });
    expect(await component('OVERTIME')).toMatchObject({ gridColumn: false, carryForward: false, handKeyed: false });
    expect(await component('ADVANCE_RECOVERY')).toMatchObject({ handKeyed: false });
  });

  it('gives a switched-on item its own column, in Payroll items order, and takes its money out of Other income', async () => {
    // January as the owner described it: a director's fee, last month's locum
    // sessions and an allowance for the doctor; for the nurse, a director's fee
    // and a locum fee earned two months back — a true one-off late payment.
    await input(doctor, '2026-01', { componentCode: 'DIRECTOR_FEE', amount: '2000.00', reason: 'Board meeting, January' }).expect(201);
    await input(doctor, '2026-01', { componentCode: 'LOCUM_FEE', amount: '900.00', earnedPeriod: '2025-12-01', reason: 'Three December sessions' }).expect(201);
    await input(doctor, '2026-01', { componentCode: 'ALLOWANCE', amount: '300.00' }).expect(201);
    await input(nurse, '2026-01', { componentCode: 'DIRECTOR_FEE', amount: '500.00' }).expect(201);
    await input(nurse, '2026-01', { componentCode: 'LOCUM_FEE', amount: '450.00', earnedPeriod: '2025-11-01', reason: 'November session paid late' }).expect(201);
    await calculate(january);

    const data = await journey(january);
    const settingsOrder = (await components()).filter((row) => row.gridColumn).map((row) => row.code);
    expect(data.pay.columns.map((column) => column.code)).toEqual(settingsOrder);
    expect(data.pay.columns.map((column) => column.code).sort()).toEqual(['DIRECTOR_FEE', 'LOCUM_FEE']);
    expect(data.pay.columns.find((column) => column.code === 'DIRECTOR_FEE')).toMatchObject({ name: "Director's fee", carryForward: true });

    const row = data.pay.rows.find((candidate) => candidate.staffId === doctor)!;
    expect(row.columns.DIRECTOR_FEE).toMatchObject({ amount: '2000.00', entered: '2000.00', editable: true, carried: false });
    expect(row.columns.LOCUM_FEE).toMatchObject({ amount: '900.00', entered: '900.00', editable: true, carried: false });
    expect(row.columns.DIRECTOR_FEE.inputId).toBe((await line(doctor, '2026-01', 'DIRECTOR_FEE'))!.id);
    // Other income is the allowance alone: the two own columns are not in it.
    expect(row.otherIncome).toBe('300.00');
    expect(row.grossPay).toBe('11200.00');
    expect(data.pay.totals.columns.DIRECTOR_FEE).toBe('2500.00');
    expect(data.pay.totals.columns.LOCUM_FEE).toBe('1350.00');
    expect(data.pay.totals.otherIncome).toBe('300.00');

    // The drawer agrees: the line sits under the column's own name.
    expect(await line(doctor, '2026-01', 'DIRECTOR_FEE')).toMatchObject({ bucket: 'OWN_COLUMN', column: "Director's fee" });
    expect(await line(doctor, '2026-01', 'ALLOWANCE')).toMatchObject({ bucket: 'OTHER_INCOME', column: 'Other income' });
  });

  it('starts February with January’s lines, moves an earned-in month on by one, and leaves a one-off late payment behind', async () => {
    // A derived line for a carried item is never copied: it reaches February
    // by its own route, or not at all.
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollInputEntry.create({
        data: {
          tenantId,
          clinicId,
          staffId: nurse,
          period: new Date('2026-01-01T00:00:00.000Z'),
          componentCode: 'ALLOWANCE',
          label: 'Housing',
          amount: '250.00',
          kind: 'RECURRING',
          source: 'RECURRING',
          sourceRecordId: randomId(),
          createdByStaffId: doctor,
        },
      }),
    );

    const started = await startRun('2026-02').expect(201);
    february = started.body.id;
    expect(started.body.carried).toEqual({ from: 'January 2026', carried: 4, skipped: 1, people: 2, repeated: false });

    const doctorLines = await lines(doctor, '2026-02');
    expect(doctorLines.map((row) => row.componentCode).sort()).toEqual(['ALLOWANCE', 'DIRECTOR_FEE', 'LOCUM_FEE']);
    // The arrears line moved on by one month; the plain line stayed plain.
    expect(doctorLines.find((row) => row.componentCode === 'LOCUM_FEE')).toMatchObject({
      amount: '900.00',
      earnedPeriod: '2026-01-01',
      reason: 'Carried from January 2026: Three December sessions',
      carriedFromMonth: '2026-01',
      origin: 'Carried from January 2026 when the month was started',
      editable: true,
    });
    expect(doctorLines.find((row) => row.componentCode === 'DIRECTOR_FEE')).toMatchObject({ amount: '2000.00', earnedPeriod: null, reason: 'Carried from January 2026: Board meeting, January', carriedFromMonth: '2026-01' });
    expect(doctorLines.find((row) => row.componentCode === 'ALLOWANCE')).toMatchObject({ amount: '300.00', reason: 'Carried from January 2026', carriedFromMonth: '2026-01' });

    const nurseLines = await lines(nurse, '2026-02');
    // The November session was a one-off late payment, and the recurring
    // housing line is not the month's to copy.
    expect(nurseLines.map((row) => row.componentCode)).toEqual(['DIRECTOR_FEE']);

    await calculate(february);
    const data = await journey(february);
    const row = data.pay.rows.find((candidate) => candidate.staffId === doctor)!;
    expect(row.columns.DIRECTOR_FEE).toMatchObject({ amount: '2000.00', entered: '2000.00', carried: true, editable: true });
    expect(row.items.filter((item) => item.carried).map((item) => item.componentCode).sort()).toEqual(['ALLOWANCE', 'DIRECTOR_FEE', 'LOCUM_FEE']);

    // The run says so, per person, without blocking anything.
    const info = data.review.attention.filter((item) => item.code === 'CARRIED_FORWARD_UNCHECKED');
    expect(info.map((item) => item.staffId).sort()).toEqual([doctor, nurse].sort());
    const mine = info.find((item) => item.staffId === doctor)!;
    expect(mine.severity).toBe('INFO');
    expect(mine.what).toMatch(/^3 lines were carried from January 2026 and have not been edited or cleared: /);
    expect(mine.what).toContain("Director's fee RM2000.00");
    expect(info.find((item) => item.staffId === nurse)!.what).toMatch(/^1 line was carried from January 2026 and has not been edited or cleared: /);
  });

  it('makes an edited line the person’s own, and keeps what the drawer keyed unless told to clear it', async () => {
    // The grid's cell sends the amount and nothing else.
    await input(doctor, '2026-02', { componentCode: 'DIRECTOR_FEE', amount: '2100.00' }).expect(201);
    expect(await line(doctor, '2026-02', 'DIRECTOR_FEE')).toMatchObject({
      amount: '2100.00',
      reason: 'Carried from January 2026: Board meeting, January',
      carriedFromMonth: null,
      origin: 'Entered by Test Owner',
    });
    // An explicit null clears; leaving the field out does not.
    await input(doctor, '2026-02', { componentCode: 'LOCUM_FEE', amount: '900.00', earnedPeriod: null, reason: null }).expect(201);
    expect(await line(doctor, '2026-02', 'LOCUM_FEE')).toMatchObject({ amount: '900.00', earnedPeriod: null, reason: null, carriedFromMonth: null });

    await calculate(february);
    const data = await journey(february);
    const mine = data.review.attention.find((item) => item.code === 'CARRIED_FORWARD_UNCHECKED' && item.staffId === doctor)!;
    expect(mine.what).toMatch(/^1 line was carried from January 2026/);
    expect(data.pay.rows.find((row) => row.staffId === doctor)!.columns.DIRECTOR_FEE).toMatchObject({ amount: '2100.00', carried: false });
  });

  it('copies nothing twice: a discarded and restarted month keeps a cleared line cleared', async () => {
    const allowance = (await line(doctor, '2026-02', 'ALLOWANCE'))!;
    await request(server()).delete(`/workforce/payroll/inputs/${allowance.id}`).set('Authorization', owner).expect(200);
    await request(server()).delete(`/workforce/payroll/runs/${february}`).set('Authorization', owner).expect(200);

    const restarted = await startRun('2026-02').expect(201);
    february = restarted.body.id;
    expect(restarted.body.carried).toMatchObject({ carried: 0, repeated: true });
    const doctorLines = await lines(doctor, '2026-02');
    expect(doctorLines.map((row) => row.componentCode).sort()).toEqual(['DIRECTOR_FEE', 'LOCUM_FEE']);
    expect(doctorLines.find((row) => row.componentCode === 'DIRECTOR_FEE')).toMatchObject({ amount: '2100.00', carriedFromMonth: null });
    await calculate(february);
  });

  it('leaves a line already keyed for the month alone, and does not stack the marker month on month', async () => {
    // March is keyed by hand for the doctor's fee before the month is started.
    await input(doctor, '2026-03', { componentCode: 'DIRECTOR_FEE', amount: '999.00', reason: 'Keyed ahead' }).expect(201);
    const started = await startRun('2026-03').expect(201);
    // Doctor: locum fee (earned January, the month before February) carried on;
    // director's fee already there. Nurse: February's untouched director's fee
    // carried again. Nothing skipped.
    expect(started.body.carried).toEqual({ from: 'February 2026', carried: 2, skipped: 0, people: 2, repeated: false });
    expect(await line(doctor, '2026-03', 'DIRECTOR_FEE')).toMatchObject({ amount: '999.00', reason: 'Keyed ahead', carriedFromMonth: null });
    expect(await line(doctor, '2026-03', 'LOCUM_FEE')).toMatchObject({ amount: '900.00', earnedPeriod: null, reason: 'Carried from February 2026', carriedFromMonth: '2026-02' });
    expect(await line(nurse, '2026-03', 'DIRECTOR_FEE')).toMatchObject({ amount: '500.00', reason: 'Carried from February 2026', carriedFromMonth: '2026-02' });
  });
});
