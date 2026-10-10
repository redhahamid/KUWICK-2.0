import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * THE EMPLOYER'S EPF BASIS FOR NEW STAFF, AND ONE BASIS FOR A WHOLE BRANCH
 * (UAT, 10 October 2026): "The clinic's EPF basis policy must be the default
 * for every new employee, including Add several and CSV import", and "Set EPF
 * basis for all staff in this branch" with a date and a reason. Demo people
 * only.
 */
describe('EPF basis: the employer default and a whole branch (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let employerId: string;
  const ids: Record<string, string> = {};

  const server = () => app.getHttpServer();
  const basesOf = (staffId: string) =>
    withTenantContext(prisma, tenantId, (tx) =>
      tx.employeeContributionBasis.findMany({ where: { staffId }, orderBy: { effectiveFrom: 'asc' } }),
    );
  const hireOne = async (key: string, employeeNo: string, startDate: string, endDate?: string) => {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: `Demo ${key}`, clinicId, active: !endDate } }),
    );
    ids[key] = staff.id;
    await request(server())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({
        employeeNo,
        position: 'Nurse',
        employmentType: 'PERMANENT',
        employmentStatus: endDate ? 'RESIGNED' : 'ACTIVE',
        startDate,
        ...(endDate ? { endDate } : {}),
        dateOfBirth: '1994-04-04',
      })
      .expect(201);
    await request(server()).patch(`/workforce/employees/${staff.id}/legal-employer`).set('Authorization', bearer).send({ legalEmployerId: employerId }).expect(200);
  };
  const branch = (body: Record<string, unknown>) =>
    request(server())
      .post('/workforce/employees/epf-basis-for-branch')
      .set('Authorization', bearer)
      .send({ clinicId, mode: 'BASIC_ONLY', effectiveFrom: '2026-01-01', reason: 'Clinic pays EPF on basic salary only', ...body });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'EPF Basis Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'EPF Basis Clinic' }).expect(201)).body.id;
    employerId = (await request(server()).post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'EPF Basis Sdn Bhd' }).expect(201)).body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
    // Hired BEFORE the employer had a default: no record of their own.
    await hireOne('before', 'EB-1', '2024-01-01');
    await hireOne('leftJan7', 'EB-2', '2024-01-01', '2026-01-07');
    await hireOne('leftDec', 'EB-3', '2024-01-01', '2025-12-31');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('gives a new employee the employer’s basis, one at a time and through Add several', async () => {
    await request(server())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      .send({ id: employerId, name: 'EPF Basis Sdn Bhd', defaultEpfBasis: 'BASIC_ONLY' })
      .expect(201);
    const listed = (await request(server()).get('/workforce/legal-employers').set('Authorization', bearer).expect(200)).body as { id: string; defaultEpfBasis: string }[];
    expect(listed.find((row) => row.id === employerId)?.defaultEpfBasis).toBe('BASIC_ONLY');

    await hireOne('single', 'EB-4', '2026-03-16');
    const single = await basesOf(ids.single);
    expect(single.map((row) => [row.mode, row.effectiveFrom.toISOString().slice(0, 10)])).toEqual([['BASIC_ONLY', '2026-03-16']]);
    expect(single[0].reason).toMatch(/Employer default for new staff/);

    const intake = await request(server())
      .post('/workforce/employees/intake')
      .set('Authorization', bearer)
      .send({
        commit: true,
        rows: [
          {
            fullName: 'Demo Pekerja binti Contoh',
            role: Role.FRONT_DESK_CLINICAL_STAFF,
            clinicId,
            legalEmployerId: employerId,
            startDate: '2026-02-01',
            identifierType: 'NRIC',
            identifierValue: '900101-14-5566',
            salary: { amount: '2500', basis: 'MONTHLY' },
            standing: { epfMembership: 'MALAYSIAN_CITIZEN', taxResidence: 'RESIDENT', pcbCategory: 'CATEGORY_1', restDayOfWeek: 0 },
          },
        ],
      })
      .expect(201);
    const added = intake.body.results[0].staffId as string;
    expect((await basesOf(added)).map((row) => row.mode)).toEqual(['BASIC_ONLY']);

    // Somebody already on the books keeps theirs: changed deliberately, below.
    expect(await basesOf(ids.before)).toEqual([]);
  });

  it('previews a whole branch, then gives everybody employed from the date their own record', async () => {
    const preview = (await branch({}).expect(201)).body;
    expect(preview.committed).toBe(false);
    const action = Object.fromEntries((preview.rows as { staffId: string; action: string }[]).map((row) => [row.staffId, row.action]));
    expect(action[ids.before]).toBe('CHANGE');
    expect(action[ids.leftJan7]).toBe('CHANGE');
    // Left before the date: not part of it.
    expect(action[ids.leftDec]).toBeUndefined();
    expect(await basesOf(ids.before)).toEqual([]);

    const done = (await branch({ commit: true }).expect(201)).body;
    expect(done.committed).toBe(true);
    for (const staffId of [ids.before, ids.leftJan7]) {
      const rows = await basesOf(staffId);
      expect(rows.map((row) => [row.mode, row.effectiveFrom.toISOString().slice(0, 10)])).toEqual([['BASIC_ONLY', '2026-01-01']]);
      expect(rows[0].reason).toMatch(/set for all staff in EPF Basis Clinic/);
    }
    // The single hire's later record from March was replaced by the branch's from January.
    expect((await basesOf(ids.single)).filter((row) => !(row.effectiveTo && row.effectiveTo < row.effectiveFrom)).map((row) => row.effectiveFrom.toISOString().slice(0, 10))).toEqual(['2026-01-01']);

    const again = (await branch({}).expect(201)).body;
    expect(again.changing).toBe(0);
    const audit = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.count({ where: { action: 'employeeContributionBasis.branchRecorded', entityId: clinicId } }),
    );
    expect(audit).toBe(1);
  });

  it('changes nobody when the date reaches somebody’s approved month', async () => {
    await withTenantContext(prisma, tenantId, async (tx) => {
      const run = await tx.payrollRun.create({
        data: { tenantId, clinicId, period: new Date('2026-02-01T00:00:00.000Z'), status: 'CALCULATED', legalEmployerId: employerId, createdByStaffId: ids.single },
      });
      await tx.payrollLine.create({ data: { tenantId, payrollRunId: run.id, staffId: ids.before, employeeSnapshot: {} } });
      await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'APPROVED' } });
    });
    const preview = (await branch({ mode: 'ALL_APPLICABLE' }).expect(201)).body;
    expect(preview.blocked).toBe(1);
    await branch({ mode: 'ALL_APPLICABLE', commit: true }).expect(409);
    expect((await basesOf(ids.leftJan7)).map((row) => row.mode)).toEqual(['BASIC_ONLY']);
  });
});
