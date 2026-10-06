import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

/**
 * ADDING SEVERAL EMPLOYEES — one door, checked together, written together.
 *
 * The single form and the grid post the same rows to the same place. The
 * endpoint checks every row the way the four record endpoints would, names
 * the row and the cell for each problem, writes nothing on a check or on a
 * batch with a problem in it, and writes a clean batch through those same
 * four endpoints so the same refusals apply and the same audit rows are left.
 */
describe('Adding several employees through the intake (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let clinicA: string;
  let clinicB: string;
  let employerId: string;

  const server = () => app.getHttpServer();
  const row = <T>(fn: Parameters<typeof withTenantContext<T>>[2]) => withTenantContext(prisma, tenantId, fn);
  const intake = (body: Record<string, unknown>, who = owner) =>
    request(server()).post('/workforce/employees/intake').set('Authorization', who).send(body);
  const staffCount = () => row((tx) => tx.staff.count({ where: { tenantId } }));

  const person = (overrides: Record<string, unknown> = {}) => ({
    fullName: 'Demo Pekerja binti Contoh',
    role: Role.FRONT_DESK_CLINICAL_STAFF,
    clinicId: clinicA,
    legalEmployerId: employerId,
    startDate: '2026-01-01',
    identifierType: 'NRIC',
    identifierValue: '900101-14-5566',
    salary: { amount: '2500', basis: 'MONTHLY' },
    standing: { epfMembership: 'MALAYSIAN_CITIZEN', taxResidence: 'RESIDENT', pcbCategory: 'CATEGORY_1', restDayOfWeek: 0 },
    ...overrides,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await row((tx) => tx.tenant.create({ data: { id: tenantId, name: 'Klinik Ambil Ramai (Synthetic)' } }));
    owner = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicA = (await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'Ambil A' }).expect(201)).body.id;
    clinicB = (await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'Ambil B' }).expect(201)).body.id;
    employerId = (await row((tx) => tx.legalEmployer.create({ data: { tenantId, name: 'Klinik Ambil Sdn Bhd' } }))).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('checks every row, names the cell, and writes nothing on a check', async () => {
    const before = await staffCount();
    const result = await intake({
      rows: [
        // The IC says 1 January 1990; the typed date disagrees. The company is not on file.
        person({ dateOfBirth: '1991-01-01', legalEmployerId: '00000000-0000-4000-8000-000000000000' }),
        // Too short a name, and a role that is not an employee's.
        person({ fullName: 'D', role: 'PATIENT_PORTAL', identifierValue: '850505-10-5571' }),
        // The same IC as the first row, dashes or not.
        person({ fullName: 'Demo Kembar binti Contoh', identifierValue: '900101145566' }),
      ],
    }).expect(201);

    expect({ dryRun: result.body.dryRun, clean: result.body.clean, created: result.body.created, rowCount: result.body.rowCount }).toEqual({
      dryRun: true,
      clean: false,
      created: 0,
      rowCount: 3,
    });
    const fields = (index: number) => result.body.results[index].problems.map((problem: { field: string }) => problem.field).sort();
    expect(fields(0)).toEqual(['dateOfBirth', 'legalEmployerId']);
    expect(result.body.results[0].problems.find((p: { field: string }) => p.field === 'dateOfBirth').message).toMatch(/The IC says 1990-01-01/);
    expect(fields(1)).toEqual(['fullName', 'role']);
    expect(fields(2)).toEqual(['identifierValue']);
    expect(result.body.results[2].problems[0].message).toMatch(/another row of this batch/);
    expect(await staffCount()).toBe(before);
  });

  it('refuses the whole batch when one row is wrong, even when told to commit', async () => {
    const before = await staffCount();
    const result = await intake({ rows: [person(), person({ fullName: 'Demo Kedua bin Contoh', identifierValue: 'not-an-ic' })], commit: true }).expect(201);
    expect({ dryRun: result.body.dryRun, clean: result.body.clean, created: result.body.created }).toEqual({ dryRun: true, clean: false, created: 0 });
    expect(result.body.results[0].problems).toEqual([]);
    expect(result.body.results[1].problems[0].field).toBe('identifierValue');
    expect(await staffCount()).toBe(before);
  });

  it('writes a clean batch through the four doors, says what payroll still lacks, and leaves one audit row for the batch', async () => {
    const before = await staffCount();
    const result = await intake({
      rows: [
        person(),
        // No salary and no bank account: added all the same, and told so.
        person({ fullName: 'Demo Kedua bin Contoh', identifierValue: '850505-10-5571', salary: undefined }),
      ],
      commit: true,
    }).expect(201);

    expect({ dryRun: result.body.dryRun, clean: result.body.clean, created: result.body.created }).toEqual({ dryRun: false, clean: true, created: 2 });
    expect(await staffCount()).toBe(before + 2);
    const [first, second] = result.body.results;
    expect(first.staffId).toBeTruthy();
    expect(first.failedAt).toBeUndefined();
    expect(first.readiness.blocking).toEqual([]);
    expect(second.readiness.blocking).toEqual(['No salary in force — payroll leaves them out.']);
    expect(second.readiness.advisory).toContain('No bank account — they cannot be paid out.');

    // The record: the company, and the birth date the IC gave.
    const record = await request(server()).get(`/workforce/employees/${first.staffId}/record`).set('Authorization', owner).expect(200);
    expect(record.body.employment.legalEmployerId).toBe(employerId);
    expect(String(record.body.identity.dateOfBirth).slice(0, 10)).toBe('1990-01-01');
    expect(record.body.identity.gender).toBe('FEMALE');

    // The salary and the standing, dated from the start date, through their own tables.
    const salary = await row((tx) => tx.employeeSalary.findMany({ where: { staffId: first.staffId } }));
    expect(salary.map((s) => ({ amount: s.amount.toFixed(2), basis: s.basis, from: s.effectiveFrom.toISOString().slice(0, 10) }))).toEqual([
      { amount: '2500.00', basis: 'MONTHLY', from: '2026-01-01' },
    ]);
    const standing = await row((tx) => tx.employeeStatutoryClassification.findMany({ where: { staffId: first.staffId } }));
    expect(
      standing.map((s) => ({ epf: s.epfMembership, tax: s.taxResidence, pcb: s.pcbCategory, restDay: s.restDayOfWeek, from: s.effectiveFrom.toISOString().slice(0, 10) })),
    ).toEqual([{ epf: 'MALAYSIAN_CITIZEN', tax: 'RESIDENT', pcb: 'CATEGORY_1', restDay: 0, from: '2026-01-01' }]);
    expect(await row((tx) => tx.employeeSalary.count({ where: { staffId: second.staffId } }))).toBe(0);

    const audit = await row((tx) => tx.auditLog.findMany({ where: { tenantId, action: 'employee.intake' } }));
    expect(audit).toHaveLength(1);
    expect((audit[0].after as { rows: number; created: number }).rows).toBe(2);
    expect((audit[0].after as { rows: number; created: number }).created).toBe(2);
    // And the per-person rows each door leaves, as the single form leaves them.
    expect(await row((tx) => tx.auditLog.count({ where: { tenantId, action: 'employee.created', entityId: first.staffId } }))).toBe(1);
  });

  /*
   * EMPLOYEE NO. AND POSITION FROM THE SHEET (UAT, 6 October 2026). A position
   * that names a title on the clinic's list IS that title; other words are
   * kept as typed.
   */
  it('takes the employee number and the position, linking a position on the job title list to that title', async () => {
    const title = (await request(server()).post('/workforce/job-titles').set('Authorization', owner).send({ name: 'Staff Nurse' }).expect(201)).body;
    const result = await intake({
      rows: [
        person({ fullName: 'Demo Jawatan Satu', identifierValue: '910202-14-5563', employeeNo: 'KA-101', position: 'staff nurse' }),
        person({ fullName: 'Demo Jawatan Dua', identifierValue: '920303-14-5569', employeeNo: 'KA-102', position: 'Clinic Runner' }),
      ],
      commit: true,
    }).expect(201);
    expect(result.body.clean).toBe(true);
    const [linked, typed] = result.body.results as { staffId: string }[];
    const profileOf = (staffId: string) => row((tx) => tx.employeeProfile.findFirst({ where: { staffId } }));
    expect(await profileOf(linked.staffId)).toMatchObject({ employeeNo: 'KA-101', jobTitleId: title.id, position: 'Staff Nurse' });
    expect(await profileOf(typed.staffId)).toMatchObject({ employeeNo: 'KA-102', jobTitleId: null, position: 'Clinic Runner' });

    // The number is checked for uniqueness as before.
    const again = await intake({ rows: [person({ fullName: 'Demo Jawatan Tiga', identifierValue: '930404-14-5565', employeeNo: 'KA-101' })] }).expect(201);
    expect(again.body.results[0].problems).toEqual([{ field: 'employeeNo', message: 'Another employee already has this number.' }]);
  });

  it('keeps a branch manager to their branch, and an HR clerk out of the salary', async () => {
    const manager = await row((tx) => tx.staff.create({ data: { tenantId, role: Role.CLINIC_MANAGER, fullName: 'Pengurus A', clinicId: clinicA } }));
    const clerk = await row((tx) => tx.staff.create({ data: { tenantId, role: Role.HR_STAFF, fullName: 'Kerani HR', clinicId: clinicA } }));
    const managerA = bearerFor(tenantId, manager.id, Role.CLINIC_MANAGER);
    const clerkA = bearerFor(tenantId, clerk.id, Role.HR_STAFF);

    // No salary on this row: a clinic manager never records pay, and that refusal is tested on the clerk below.
    const elsewhere = await intake({ rows: [person({ fullName: 'Demo Cawangan B', identifierValue: '920202-08-5582', clinicId: clinicB, salary: undefined })], commit: true }, managerA).expect(201);
    expect(elsewhere.body.created).toBe(0);
    expect(elsewhere.body.results[0].problems).toEqual([{ field: 'clinicId', message: 'Not a branch this account manages.' }]);

    const withPay = await intake({ rows: [person({ fullName: 'Demo Kerani Tambah', identifierValue: '930303-06-5593' })] }, clerkA).expect(201);
    expect(withPay.body.results[0].problems.map((problem: { field: string }) => problem.field)).toEqual(['salary.amount']);
    // Without the salary the clerk's row is clean: hiring is theirs, pay is not.
    const withoutPay = await intake({ rows: [person({ fullName: 'Demo Kerani Tambah', identifierValue: '930303-06-5593', salary: undefined })] }, clerkA).expect(201);
    expect(withoutPay.body.results[0].problems).toEqual([]);

    // Somebody with no employee-record access at all is refused at the door.
    const stock = await row((tx) => tx.staff.create({ data: { tenantId, role: Role.STOCK_STAFF, fullName: 'Kerani Stok', clinicId: clinicA } }));
    await intake({ rows: [person()] }, bearerFor(tenantId, stock.id, Role.STOCK_STAFF)).expect(403);
  });
});
