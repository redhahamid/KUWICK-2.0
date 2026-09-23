import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * A RECORD THAT SHOULD NEVER HAVE EXISTED CAN GO.
 *
 * The directory said there is no delete, and for anybody who was paid that is
 * right. But a wrong entry, a duplicate and a hire who never turned up were
 * left in the list for good, counting against payroll readiness every month.
 *
 * The line is the books: a line on an approved run keeps the record, by name
 * and with the months. Having worked here keeps it too — attendance, leave, a
 * claim — because those rows are the evidence, and the exit for a person who
 * was here is mark-as-resigned.
 */
jest.setTimeout(120_000);

describe('deleting an employee record (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let ownerStaffId: string;
  let clinicId: string;
  let legalEmployerId: string;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Delete Tenant' } }));
    const account = await createOwnerAndBearer(prisma, tenantId);
    owner = account.bearer;
    ownerStaffId = account.staffId;
    clinicId = (await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'KLINIK HIJRAA BANGI' }).expect(201)).body.id;
    legalEmployerId = (
      await request(server()).post('/workforce/legal-employers').set('Authorization', owner).send({ name: 'Hijraa Bangi Sdn Bhd', epfEmployerNo: 'EPF-X-1' }).expect(201)
    ).body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', owner).expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  /** Somebody added through the form, complete enough to be paid. */
  async function hire(name: string, login?: { email: string; password: string }) {
    const created = await request(server())
      .post('/workforce/employees')
      .set('Authorization', owner)
      .send({
        fullName: name,
        role: Role.FRONT_DESK_CLINICAL_STAFF,
        clinicId,
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        startDate: '2026-01-01',
        dateOfBirth: '1994-03-08',
        bankName: 'Maybank',
        bankAccountNo: '512345678901',
        ...(login ? { loginEmail: login.email, loginPassword: login.password } : {}),
      })
      .expect(201);
    const staffId = created.body.staff.id as string;
    await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', owner)
      .send({ effectiveFrom: '2026-01-01', epfMembership: 'MALAYSIAN_CITIZEN', lindungParticipation: 'NOT_PARTICIPATING', restDayOfWeek: 0, taxResidence: 'RESIDENT', pcbCategory: 'CATEGORY_1', reason: 'At hire' })
      .expect(201);
    await request(server()).patch(`/workforce/employees/${staffId}/legal-employer`).set('Authorization', owner).send({ legalEmployerId }).expect(200);
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', owner)
      .send({ amount: '2800.00', basis: 'MONTHLY', effectiveFrom: '2026-01-01', reason: 'Starting salary' })
      .expect(201);
    return staffId;
  }

  it('deletes a duplicate that was never paid, with everything hung off it, and the login', async () => {
    const staffId = await hire('Duplicate Entry', { email: 'duplicate@delete-uat.kuwick.invalid', password: 'Never-Used!1' });
    const userId = (await withTenantContext(prisma, tenantId, (tx) => tx.staff.findUniqueOrThrow({ where: { id: staffId } }))).userId;
    expect(userId).toBeTruthy();

    const res = await request(server()).delete(`/workforce/employees/${staffId}`).set('Authorization', owner).send({ reason: 'Entered twice' }).expect(200);
    expect(res.body).toMatchObject({ deleted: true, staffId });

    await request(server()).get(`/workforce/employees/${staffId}/record`).set('Authorization', owner).expect(404);
    const left = await withTenantContext(prisma, tenantId, async (tx) => ({
      staff: await tx.staff.count({ where: { id: staffId } }),
      profile: await tx.employeeProfile.count({ where: { staffId } }),
      salary: await tx.employeeSalary.count({ where: { staffId } }),
      standing: await tx.employeeStatutoryClassification.count({ where: { staffId } }),
      user: await tx.user.count({ where: { id: userId! } }),
    }));
    expect(left).toEqual({ staff: 0, profile: 0, salary: 0, standing: 0, user: 0 });

    const audit = await withTenantContext(prisma, tenantId, (tx) => tx.auditLog.findFirst({ where: { entityType: 'Staff', entityId: staffId, action: 'employee.deleted' } }));
    expect((audit?.before as { fullName: string; hadLogin: boolean })).toMatchObject({ fullName: 'Duplicate Entry', hadLogin: true });
  });

  it('takes their line out of a draft and refoots it, so the month is not one person short in silence', async () => {
    const keep = await hire('Keeps Working');
    const wrong = await hire('Wrong Entry');
    const runId = (
      await request(server()).post('/workforce/payroll/runs').set('Authorization', owner).send({ period: '2026-01', clinicId }).expect(201)
    ).body.id as string;
    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', owner).expect(200);
    const before = await request(server()).get(`/workforce/payroll/runs/${runId}`).set('Authorization', owner).expect(200);
    expect(before.body.employeeCount).toBe(2);

    await request(server()).delete(`/workforce/employees/${wrong}`).set('Authorization', owner).expect(200);

    const after = await request(server()).get(`/workforce/payroll/runs/${runId}`).set('Authorization', owner).expect(200);
    expect(after.body.employeeCount).toBe(1);
    expect(after.body.lines.map((line: { staffId: string }) => line.staffId)).toEqual([keep]);
    // The header foots on the line that is left: one RM2,800 salary, net below it.
    expect(Number(after.body.grossTotal)).toBe(2800);
    expect(Number(after.body.netTotal)).toBeLessThan(2800);
    expect(Number(after.body.deductionTotal)).toBeCloseTo(2800 - Number(after.body.netTotal), 2);
  });

  it('refuses anybody an approved run has paid, naming the month', async () => {
    const paid = await hire('Was Paid');
    const runId = (
      await request(server()).post('/workforce/payroll/runs').set('Authorization', owner).send({ period: '2026-02', clinicId }).expect(201)
    ).body.id as string;
    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', owner).expect(200);
    await request(server()).patch(`/workforce/payroll/runs/${runId}/approve`).set('Authorization', owner).expect(200);

    const refused = await request(server()).delete(`/workforce/employees/${paid}`).set('Authorization', owner).expect(409);
    expect(String(refused.body.message)).toContain('approved payroll line');
    expect(String(refused.body.message)).toContain('2026-02');
    expect(String(refused.body.message)).toContain('Mark them as resigned');
    await request(server()).get(`/workforce/employees/${paid}/record`).set('Authorization', owner).expect(200);
  });

  it('refuses anybody who worked here, and says what the exit is', async () => {
    const worked = await hire('Did Work');
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.leaveRequest.create({
        data: {
          tenantId,
          staffId: worked,
          leaveType: 'ANNUAL',
          startDate: new Date('2026-03-02T00:00:00.000Z'),
          endDate: new Date('2026-03-02T00:00:00.000Z'),
          status: 'PENDING',
        },
      }),
    );
    const refused = await request(server()).delete(`/workforce/employees/${worked}`).set('Authorization', owner).expect(409);
    expect(String(refused.body.message)).toContain('leave request');
    expect(String(refused.body.message)).toContain('Mark them as resigned');
  });

  it('will not let you delete yourself', async () => {
    await request(server()).delete(`/workforce/employees/${ownerStaffId}`).set('Authorization', owner).expect(400);
  });
});
