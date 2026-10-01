import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * WHO A PAYROLL ITEM IS FOR.
 *
 * An item with a column of its own gave that column to everybody, so a
 * director's fee sat as an empty box on the nurse's row every month. The item
 * now names its people, and this proves the server keeps to one list:
 *
 *  - the list is refused on an item the run derives, and an empty list is
 *    refused outright;
 *  - naming people is audience, not treatment: saved in place, no version;
 *  - the journey gives the column to the named people alone, a stranger's
 *    earlier line stays paid in Other income, and the drawer agrees;
 *  - a new line for a stranger is refused;
 *  - the month start carries the item for its people alone.
 */
jest.setTimeout(180_000);

type Line = { id: string; staffId: string; componentCode: string; amount: string; bucket: string; column: string };
type Cell = { amount: string; entered: string | null; editable: boolean; carried: boolean; inputId: string | null };
type Journey = {
  pay: {
    columns: { code: string; name: string; carryForward: boolean; appliesTo: string }[];
    rows: { staffId: string; otherIncome: string; columns: Record<string, Cell> }[];
    totals: { otherIncome: string; columns: Record<string, string> };
  };
};

describe('who a payroll item is for (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let clinicId: string;
  let doctor: string;
  let nurse: string;
  let january: string;

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
      appliesTo: row.appliesTo,
      appliesToStaffIds: row.appliesToStaffIds,
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
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Audience Tenant' } }));
    owner = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await post('/clinics', { name: 'KLINIK HIJRAA BANGI' }).expect(201)).body.id;
    const employer = await post('/workforce/legal-employers', { name: 'Hijraa Bangi Sdn Bhd', epfEmployerNo: 'EPF-HB-4' }).expect(201);
    await post('/workforce/pay-components/seed', {}).expect(201);
    doctor = await hire('Hijraa Doktor', Role.DOCTOR_RESIDENT, '990201', employer.body.id);
    nurse = await hire('Hijraa Jururawat', Role.FRONT_DESK_CLINICAL_STAFF, '990202', employer.body.id);

    january = (await startRun('2026-01').expect(201)).body.id;
    await calculate(january);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('refuses a list on an item the run derives, an empty list, and a stranger to the clinic', async () => {
    const overtime = await saveItem('OVERTIME', { appliesTo: 'SELECTED', appliesToStaffIds: [doctor] }, 400);
    expect(String(overtime.body.message)).toMatch(/worked out from the records/);
    const nobody = await saveItem('DIRECTOR_FEE', { appliesTo: 'SELECTED', appliesToStaffIds: [] }, 400);
    expect(String(nobody.body.message)).toMatch(/Pick at least one employee/);
    const stranger = await saveItem('DIRECTOR_FEE', { appliesTo: 'SELECTED', appliesToStaffIds: [randomId()] }, 400);
    expect(String(stranger.body.message)).toMatch(/not on this clinic/);
    // Every seeded item is for everybody until somebody decides otherwise.
    expect(await component('DIRECTOR_FEE')).toMatchObject({ appliesTo: 'EVERYONE', appliesToStaffIds: [], appliesToStaff: [], audienceEditable: true });
    expect(await component('OVERTIME')).toMatchObject({ audienceEditable: false });
  });

  it('names the people an item is for, in place, and says who they are by name', async () => {
    // The nurse's line was keyed while the item was still for everybody.
    await input(nurse, '2026-01', { componentCode: 'DIRECTOR_FEE', amount: '500.00' }).expect(201);

    await saveItem('DIRECTOR_FEE', { gridColumn: true, carryForward: true, appliesTo: 'SELECTED', appliesToStaffIds: [doctor, doctor] }, 201);
    const fee = await component('DIRECTOR_FEE');
    // Audience, not treatment: the same version, no date, no reason.
    expect(fee).toMatchObject({ version: 1, appliesTo: 'SELECTED', appliesToStaffIds: [doctor], gridColumn: true, carryForward: true });
    expect(fee.appliesToStaff).toEqual([{ staffId: doctor, fullName: 'Hijraa Doktor', active: true }]);
  });

  it('gives the column to its people alone, keeps a stranger’s earlier line in Other income, and refuses a new one', async () => {
    await input(doctor, '2026-01', { componentCode: 'DIRECTOR_FEE', amount: '2000.00', reason: 'Board meeting, January' }).expect(201);
    const refused = await input(nurse, '2026-01', { componentCode: 'DIRECTOR_FEE', amount: '600.00' }).expect(400);
    expect(String(refused.body.message)).toMatch(/for selected employees only, and Hijraa Jururawat is not one of them/);
    await calculate(january);

    const data = await journey(january);
    expect(data.pay.columns.find((column) => column.code === 'DIRECTOR_FEE')).toMatchObject({ appliesTo: 'SELECTED' });
    const doctorRow = data.pay.rows.find((row) => row.staffId === doctor)!;
    const nurseRow = data.pay.rows.find((row) => row.staffId === nurse)!;
    expect(doctorRow.columns.DIRECTOR_FEE).toMatchObject({ amount: '2000.00', entered: '2000.00', editable: true });
    expect(nurseRow.columns.DIRECTOR_FEE).toBeUndefined();
    // Still paid, in the cell the drawer counts it in.
    expect(nurseRow.otherIncome).toBe('500.00');
    expect(doctorRow.otherIncome).toBe('0.00');
    expect(data.pay.totals.columns.DIRECTOR_FEE).toBe('2000.00');
    expect(data.pay.totals.otherIncome).toBe('500.00');
    expect(await line(nurse, '2026-01', 'DIRECTOR_FEE')).toMatchObject({ bucket: 'OTHER_INCOME', column: 'Other income', amount: '500.00' });
    expect(await line(doctor, '2026-01', 'DIRECTOR_FEE')).toMatchObject({ bucket: 'OWN_COLUMN', column: "Director's fee" });
  });

  it('carries the item into the next month for its people alone', async () => {
    const started = await startRun('2026-02').expect(201);
    expect(started.body.carried).toEqual({ from: 'January 2026', carried: 1, skipped: 0, people: 1, repeated: false });
    expect(await line(doctor, '2026-02', 'DIRECTOR_FEE')).toMatchObject({ amount: '2000.00' });
    expect(await line(nurse, '2026-02', 'DIRECTOR_FEE')).toBeUndefined();
  });
});
