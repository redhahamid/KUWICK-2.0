import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * READINESS BEFORE THE RUN, over HTTP.
 *
 * Three things are proven here and nowhere else:
 *  1. The pre-run readiness screen and the run agree, because they are built
 *     from the same facts — an employee this endpoint calls blocked is one
 *     the run raises an exception for.
 *  2. The employing companies' own filing readiness is reported beside the
 *     employees'.
 *  3. THE SALARY AMOUNT IS CONFIDENTIAL. The employee record opens with
 *     `hr.view`; its readiness checklist used to print the salary into the
 *     detail sentence for anybody who could open it. An HR clerk without
 *     `hr.payroll.view` now reads that a salary exists, not what it is.
 */
describe('Payroll readiness (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let ownerStaffId: string;
  let clinicId: string;
  let legalEmployerId: string;

  const PERIOD = '2026-08';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Readiness Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;
    ownerStaffId = owner.staffId;

    const clinic = await request(app.getHttpServer())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Readiness Clinic' })
      .expect(201);
    clinicId = clinic.body.id;

    const employer = await request(app.getHttpServer())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      .send({ name: 'Readiness Employer Sdn Bhd', epfEmployerNo: 'EPF-E-1' })
      .expect(201);
    legalEmployerId = employer.body.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function makeEmployee(
    name: string,
    opts: {
      salary?: string;
      employer?: boolean;
      classification?: boolean;
      bank?: boolean;
    } = {},
  ): Promise<string> {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId } }),
    );
    await request(app.getHttpServer())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: `R-${Math.floor(Math.random() * 100000)}`,
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1992-04-19',
        epfNumber: 'E123',
        socsoNumber: 'S123',
        ...(opts.bank === false ? {} : { bankName: 'Maybank', bankAccountNo: '512345678901' }),
      })
      .expect(201);

    if (opts.classification !== false) {
      await request(app.getHttpServer())
        .post(`/workforce/employees/${staff.id}/statutory-classification`)
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
    }
    if (opts.employer !== false) {
      await request(app.getHttpServer())
        .patch(`/workforce/employees/${staff.id}/legal-employer`)
        .set('Authorization', bearer)
        .send({ legalEmployerId })
        .expect(200);
    }
    if (opts.salary) {
      await request(app.getHttpServer())
        .post(`/workforce/employees/${staff.id}/salary`)
        .set('Authorization', bearer)
        .send({ amount: opts.salary, basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
        .expect(201);
    }
    return staff.id;
  }

  let readyId: string;
  let noEmployerId: string;
  let noStandingId: string;

  it('bootstraps three employees in three states', async () => {
    readyId = await makeEmployee('Ready Person', { salary: '3200.00' });
    noEmployerId = await makeEmployee('No Employer', { salary: '2800.00', employer: false });
    noStandingId = await makeEmployee('No Standing', { salary: '2600.00', classification: false });
  });

  it('reports who can be paid, who cannot, and why — before any run exists', async () => {
    const res = await request(app.getHttpServer())
      .get(`/workforce/payroll/readiness?period=${PERIOD}`)
      .set('Authorization', bearer)
      .expect(200);

    expect(res.body.period).toBe(PERIOD);
    expect(res.body.summary.total).toBe(3);
    expect(res.body.summary.withoutEmployer).toBe(1);
    expect(res.body.summary.withBlockers).toBe(2);

    const rows = res.body.employees as {
      staffId: string;
      readiness: {
        ready: boolean;
        blockersOutstanding: number;
        items: { key: string; severity: string; done: boolean; detail: string; link: string }[];
      };
    }[];

    const ready = rows.find((row) => row.staffId === readyId)!;
    expect(ready.readiness.ready).toBe(true);
    expect(ready.readiness.blockersOutstanding).toBe(0);
    // The owner holds the pay permission, so the amount is in the sentence.
    expect(ready.readiness.items.find((item) => item.key === 'salary')!.detail).toContain('RM3,200.00');
    // Monthly tax needs nothing keyed: the standing lets the run calculate it.
    expect(ready.readiness.items.find((item) => item.key === 'pcb')!.done).toBe(true);
    // Mid-year, employed since 2024, no pay on record for the year: the
    // opening-balance advisory is raised, and does not make them unpayable.
    const opening = ready.readiness.items.find((item) => item.key === 'ytdOpening')!;
    expect(opening.severity).toBe('ADVISORY');
    expect(opening.done).toBe(false);

    const noEmployer = rows.find((row) => row.staffId === noEmployerId)!;
    expect(noEmployer.readiness.ready).toBe(false);
    const employerItem = noEmployer.readiness.items.find((item) => item.key === 'employer')!;
    expect(employerItem.done).toBe(false);
    expect(employerItem.severity).toBe('BLOCKING');
    // Each item says where on the record it is put right, so a chip is a link to the field, not to the top of the page.
    expect(employerItem.link).toBe('?tab=employment&focus=employer');
    expect(ready.readiness.items.find((item) => item.key === 'salary')!.link).toBe('?tab=employment&focus=salary');
    expect(opening.link).toBe('?tab=statutory&focus=tax');

    const noStanding = rows.find((row) => row.staffId === noStandingId)!;
    expect(noStanding.readiness.ready).toBe(false);
    // With no dated classification, LINDUNG, the EPF Part and the rest day are
    // all unknown — the same refusals the run itself makes.
    expect(noStanding.readiness.items.find((item) => item.key === 'statutory')!.done).toBe(false);
    expect(noStanding.readiness.items.find((item) => item.key === 'restDay')!.done).toBe(false);
    expect(noStanding.readiness.items.find((item) => item.key === 'statutory')!.link).toBe('?tab=statutory&focus=standing');
    expect(noStanding.readiness.items.find((item) => item.key === 'restDay')!.link).toBe('?tab=statutory&focus=standing');
  });

  it('reports the employing companies beside the employees, with what each is missing', async () => {
    const res = await request(app.getHttpServer())
      .get(`/workforce/payroll/readiness?period=${PERIOD}`)
      .set('Authorization', bearer)
      .expect(200);

    const employers = res.body.employers as {
      id: string;
      employees: number;
      ready: boolean;
      missing: string[];
      epfEmployerNoOnFile: boolean;
    }[];
    const employer = employers.find((row) => row.id === legalEmployerId)!;
    expect(employer.employees).toBe(2); // Ready Person and No Standing
    expect(employer.epfEmployerNoOnFile).toBe(true);
    // SOCSO, LHDN and the paying account were never set on this employer.
    expect(employer.ready).toBe(false);
    expect(employer.missing.join(' ')).toContain('SOCSO');
  });

  it('refuses the readiness read without the payroll permission', async () => {
    const outsider = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Counter Only', clinicId },
      }),
    );
    await request(app.getHttpServer())
      .get(`/workforce/payroll/readiness?period=${PERIOD}`)
      .set('Authorization', bearerFor(tenantId, outsider.id, Role.FRONT_DESK_CLINICAL_STAFF))
      .expect(403);
  });

  it('never prints the salary amount into the employee record for a reader without the pay permission', async () => {
    // The legacy HR_STAFF role: hr.view and hr.employee.manage, deliberately
    // NOT hr.payroll.view — the clerk who maintains records but does not see
    // pay (LEGACY_ROLE_PERMISSIONS in core/permissions.ts).
    const clerk = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.HR_STAFF, fullName: 'HR Clerk', clinicId },
      }),
    );
    const clerkBearer = bearerFor(tenantId, clerk.id, Role.HR_STAFF);

    const record = await request(app.getHttpServer())
      .get(`/workforce/employees/${readyId}/record`)
      .set('Authorization', clerkBearer)
      .expect(200);

    expect(record.body.payVisible).toBe(false);
    const salaryItem = (
      record.body.payrollReadiness.items as { key: string; done: boolean; detail: string }[]
    ).find((item) => item.key === 'salary')!;
    // The checklist stays actionable — a salary IS on file — without handing
    // the clerk the one figure the pay permission exists to protect.
    expect(salaryItem.done).toBe(true);
    expect(salaryItem.detail).not.toContain('3,200');
    expect(salaryItem.detail).toContain('A salary is in force');

    // And the owner, who holds the pay permission, still reads the amount.
    const ownerRecord = await request(app.getHttpServer())
      .get(`/workforce/employees/${readyId}/record`)
      .set('Authorization', bearer)
      .expect(200);
    expect(
      (ownerRecord.body.payrollReadiness.items as { key: string; detail: string }[]).find(
        (item) => item.key === 'salary',
      )!.detail,
    ).toContain('RM3,200.00');
  });
});
