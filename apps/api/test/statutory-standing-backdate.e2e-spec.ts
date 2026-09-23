import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * A STANDING CAN BE RECORDED FROM ANY PAST DATE, AND A WRONG ONE REMOVED.
 *
 * A clinic that recorded anything today could never enter a change that had
 * genuinely taken effect earlier in the year: "the current classification
 * starts on 2026-09-01, which is not before 2026-06-01". Mid-year migration
 * and back-entry are exactly that. SKBBK from June, recorded in September, is
 * an ordinary month.
 *
 * And two versions that only existed because a form once moved the date to
 * the current month could not be removed; they were history nobody had
 * written.
 */
jest.setTimeout(120_000);

describe('back-dating and deleting statutory standing versions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let ownerStaffId: string;
  let clinicId: string;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Backdate Tenant' } }));
    const account = await createOwnerAndBearer(prisma, tenantId);
    owner = account.bearer;
    ownerStaffId = account.staffId;
    clinicId = (await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'KLINIK HIJRAA BANGI' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const post = (staffId: string, body: Record<string, unknown>) =>
    request(server()).post(`/workforce/employees/${staffId}/statutory-classification`).set('Authorization', owner).send(body);
  const history = async (staffId: string) =>
    (await request(server()).get(`/workforce/employees/${staffId}/statutory-classification`).set('Authorization', owner).expect(200)).body as {
      id: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      lindungParticipation: string | null;
      restDayOfWeek: number | null;
      epfMembership: string | null;
    }[];
  const resolve = async (staffId: string, period: string) =>
    (await request(server()).get(`/workforce/employees/${staffId}/statutory-classification/resolve?period=${period}`).set('Authorization', owner).expect(200)).body as {
      state: string;
      effectiveFrom: string | null;
    };

  /** The two-row history the bug left behind: Jan–Aug, then Sep–now. */
  async function staffAdmin(name: string) {
    const created = await request(server())
      .post('/workforce/employees')
      .set('Authorization', owner)
      .send({ fullName: name, role: Role.FRONT_DESK_CLINICAL_STAFF, clinicId, position: 'Staff Admin', employmentType: 'PERMANENT', startDate: '2026-01-01', dateOfBirth: '1990-01-01' })
      .expect(201);
    const staffId = created.body.staff.id as string;
    await post(staffId, { effectiveFrom: '2026-01-01', epfMembership: 'MALAYSIAN_CITIZEN', restDayOfWeek: 0, reason: 'At hire' }).expect(201);
    await post(staffId, { effectiveFrom: '2026-09-01', lindungParticipation: 'NOT_PARTICIPATING', reason: 'The date the form proposed' }).expect(201);
    return staffId;
  }

  it('records a change from 1 June by splitting the row that covers it, and touches nothing after', async () => {
    const staffId = await staffAdmin('Staff Admin One');
    await post(staffId, { effectiveFrom: '2026-06-01', lindungParticipation: 'NOT_PARTICIPATING', reason: 'SKBBK opt-out filed in June' }).expect(201);

    const rows = (await history(staffId)).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    expect(rows.map((row) => [row.effectiveFrom, row.effectiveTo])).toEqual([
      ['2026-01-01', '2026-05-31'],
      ['2026-06-01', '2026-08-31'],
      ['2026-09-01', null],
    ]);
    // The earlier part keeps what it said; the new part carries it forward and
    // adds the fact; the September row is exactly as it was.
    expect(rows[0]).toMatchObject({ lindungParticipation: null, restDayOfWeek: 0, epfMembership: 'MALAYSIAN_CITIZEN' });
    expect(rows[1]).toMatchObject({ lindungParticipation: 'NOT_PARTICIPATING', restDayOfWeek: 0, epfMembership: 'MALAYSIAN_CITIZEN' });
    expect(rows[2]).toMatchObject({ lindungParticipation: 'NOT_PARTICIPATING' });

    expect(await resolve(staffId, '2026-05-01')).toMatchObject({ state: 'RESOLVED', effectiveFrom: '2026-01-01' });
    expect(await resolve(staffId, '2026-06-01')).toMatchObject({ state: 'RESOLVED', effectiveFrom: '2026-06-01' });
    expect(await resolve(staffId, '2026-09-01')).toMatchObject({ state: 'RESOLVED', effectiveFrom: '2026-09-01' });
  });

  it('refuses a back-dated change where a later month is already approved', async () => {
    const staffId = await staffAdmin('Staff Admin Two');
    await withTenantContext(prisma, tenantId, async (tx) => {
      const run = await tx.payrollRun.create({
        data: { tenantId, period: new Date('2026-07-01T00:00:00.000Z'), status: 'CALCULATED', createdByStaffId: ownerStaffId },
      });
      await tx.payrollLine.create({
        data: { tenantId, payrollRunId: run.id, staffId, employeeSnapshot: {}, basicSalary: '3000.00', grossPay: '3000.00', netPay: '2670.00' },
      });
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'APPROVED' } });
    });
    const refused = await post(staffId, { effectiveFrom: '2026-06-01', lindungParticipation: 'NOT_PARTICIPATING', reason: 'Too late' }).expect(409);
    expect(String(refused.body.message)).toContain('approved payroll run');
    expect((await history(staffId)).length).toBe(2);
  });

  it('records a date before the first version as a version that ends the day before it', async () => {
    const staffId = await staffAdmin('Staff Admin Three');
    await post(staffId, { effectiveFrom: '2025-11-01', epfMembership: 'MALAYSIAN_CITIZEN', restDayOfWeek: 5, reason: 'Migrated from the old system' }).expect(201);
    const rows = (await history(staffId)).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    expect(rows[0]).toMatchObject({ effectiveFrom: '2025-11-01', effectiveTo: '2025-12-31', restDayOfWeek: 5 });
    expect(rows[1]).toMatchObject({ effectiveFrom: '2026-01-01', effectiveTo: '2026-08-31', restDayOfWeek: 0 });
  });

  it('deletes the September row recorded in error, and January runs on to now', async () => {
    const staffId = await staffAdmin('Staff Admin Four');
    const september = (await history(staffId)).find((row) => row.effectiveFrom === '2026-09-01')!;

    const res = await request(server())
      .delete(`/workforce/employees/${staffId}/statutory-classification/${september.id}`)
      .set('Authorization', owner)
      .send({ reason: 'Only there because the form moved the date' })
      .expect(200);
    expect(res.body.extended).toMatchObject({ effectiveFrom: '2026-01-01', effectiveTo: null });

    const rows = await history(staffId);
    expect(rows.map((row) => [row.effectiveFrom, row.effectiveTo])).toEqual([['2026-01-01', null]]);
    expect(await resolve(staffId, '2026-09-01')).toMatchObject({ state: 'RESOLVED', effectiveFrom: '2026-01-01' });

    const audit = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.findFirst({ where: { entityType: 'EmployeeStatutoryClassification', entityId: september.id, action: 'employeeStatutoryClassification.deleted' } }),
    );
    expect(audit).not.toBeNull();
    expect((audit?.before as { effectiveFrom: string }).effectiveFrom).toBe('2026-09-01');
  });

  it('deletes a middle version and the one before it runs on to where the deleted one ran to', async () => {
    const staffId = await staffAdmin('Staff Admin Five');
    await post(staffId, { effectiveFrom: '2026-06-01', lindungParticipation: 'NOT_PARTICIPATING', reason: 'June' }).expect(201);
    const june = (await history(staffId)).find((row) => row.effectiveFrom === '2026-06-01')!;
    await request(server()).delete(`/workforce/employees/${staffId}/statutory-classification/${june.id}`).set('Authorization', owner).expect(200);
    const rows = (await history(staffId)).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    expect(rows.map((row) => [row.effectiveFrom, row.effectiveTo])).toEqual([
      ['2026-01-01', '2026-08-31'],
      ['2026-09-01', null],
    ]);
  });

  it('never deletes a version an approved month was worked out from', async () => {
    const staffId = await staffAdmin('Staff Admin Six');
    const september = (await history(staffId)).find((row) => row.effectiveFrom === '2026-09-01')!;
    await withTenantContext(prisma, tenantId, async (tx) => {
      const run = await tx.payrollRun.create({
        data: { tenantId, period: new Date('2026-09-01T00:00:00.000Z'), status: 'CALCULATED', createdByStaffId: ownerStaffId },
      });
      await tx.payrollLine.create({
        data: { tenantId, payrollRunId: run.id, staffId, employeeSnapshot: {}, basicSalary: '3000.00', grossPay: '3000.00', netPay: '2670.00' },
      });
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'APPROVED' } });
    });
    const refused = await request(server()).delete(`/workforce/employees/${staffId}/statutory-classification/${september.id}`).set('Authorization', owner).expect(409);
    expect(String(refused.body.message)).toContain('2026-09');
    expect((await history(staffId)).length).toBe(2);
  });
});
