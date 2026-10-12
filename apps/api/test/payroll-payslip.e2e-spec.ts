import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * THE PAYSLIP COMES FROM THE APPROVED SNAPSHOT AND NOWHERE ELSE.
 *
 * The headline proof: approve a run, reopen it, move the salary and
 * recalculate — the run's own lines now carry candidate figures — and the
 * payslip STILL shows exactly what was approved, because it is composed from
 * the frozen snapshot. A slip drawn from the lines at that moment would show
 * unapproved money under an approved letterhead, which is the defect this
 * service exists to prevent.
 */
describe('Payroll payslips (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let staffId: string;
  let runId: string;

  const PERIOD = '2026-07';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Payslip Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;

    const clinic = await request(app.getHttpServer())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Payslip Clinic' })
      .expect(201);
    clinicId = clinic.body.id;

    const employer = await request(app.getHttpServer())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      .send({ name: 'Payslip Employer Sdn Bhd', registrationNo: '202601012345', epfEmployerNo: 'EPF-EMP-9' })
      .expect(201);
    legalEmployerId = employer.body.id;

    await request(app.getHttpServer())
      .post('/workforce/pay-components/seed')
      .set('Authorization', bearer)
      .expect(201);

    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Payslip Person', clinicId },
      }),
    );
    staffId = staff.id;
    await request(app.getHttpServer())
      .post(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: 'PS-001',
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1992-04-19',
        epfNumber: 'EPF-123',
        socsoNumber: 'SOCSO-456',
        bankName: 'Maybank',
        bankAccountNo: '512345678901',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: '2024-01-01',
        epfMembership: 'MALAYSIAN_CITIZEN',
        taxResidence: 'RESIDENT',
        pcbCategory: 'CATEGORY_1',
        qualifyingChildren: 0,
        restDayOfWeek: 0,
        lindungParticipation: 'ENROLLED',
        reason: 'Recorded at hire',
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/workforce/employees/${staffId}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '3200.00', basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);

    const run = await request(app.getHttpServer())
      .post('/workforce/payroll/runs')
      .set('Authorization', bearer)
      .send({ period: PERIOD, clinicId })
      .expect(201);
    runId = run.body.id;
    await request(app.getHttpServer())
      .patch(`/workforce/payroll/runs/${runId}/calculate`)
      .set('Authorization', bearer)
      .expect(200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('refuses a payslip for a run nobody has approved', async () => {
    const res = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/payslips`)
      .set('Authorization', bearer)
      .expect(409);
    expect(res.body.message).toMatch(/never been approved/);
  });

  let approvedNet: number;
  let approvedLindung: number;

  it('issues an itemised payslip from the approved snapshot', async () => {
    await request(app.getHttpServer())
      .patch(`/workforce/payroll/runs/${runId}/approve`)
      .set('Authorization', bearer)
      .send({ acknowledgeStatutoryGap: true })
      .expect(200);

    const list = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/payslips`)
      .set('Authorization', bearer)
      .expect(200);
    expect(list.body.verdict).toBe('VERIFIED');
    expect(list.body.payslips).toHaveLength(1);
    expect(list.body.payslips[0].itemised).toBe(true);

    const slip = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/payslips/${staffId}`)
      .set('Authorization', bearer)
      .expect(200);

    // Identity and employer, frozen name plus labelled current details.
    expect(slip.body.employer.name).toBe('Payslip Employer Sdn Bhd');
    expect(slip.body.employee.employeeNo).toBe('PS-001');
    expect(slip.body.employee.epfNumber).toBe('EPF-123');
    expect(slip.body.employee.identifiersAsAt).toBe('CURRENT');

    // Itemised earnings from the snapshot's own component lines.
    expect(slip.body.itemised).toBe(true);
    const basic = slip.body.earnings.find((row: { code: string }) => row.code === 'BASIC');
    expect(basic.amountCents).toBe(320000);

    // Every statutory row present — LINDUNG included, it comes out of pay.
    const keys = slip.body.statutoryDeductions.map((row: { key: string }) => row.key);
    expect(keys).toEqual(['EPF', 'SOCSO', 'EIS', 'LINDUNG', 'PCB']);
    const lindung = slip.body.statutoryDeductions.find((row: { key: string }) => row.key === 'LINDUNG');
    expect(lindung.amountCents).toBeGreaterThan(0);
    approvedLindung = lindung.amountCents;

    // The slip's own arithmetic: frozen gross less frozen deductions is the
    // frozen net, asserted by the payload rather than trusted.
    expect(slip.body.figures.adds).toBe(true);
    approvedNet = slip.body.figures.netCents;

    // Year to date carries the month approval just wrote.
    expect(slip.body.ytd.months).toBe(1);
    expect(slip.body.ytd.grossCents).toBe(slip.body.figures.grossCents);

    // Provenance: the schedules that produced the figures, by edition.
    const schemes = slip.body.schedules.map((row: { scheme: string }) => row.scheme);
    expect(schemes).toContain('EPF');
    expect(schemes).toContain('LINDUNG');
  });

  it('keeps issuing the APPROVED figures after a reopen moves the live lines', async () => {
    await request(app.getHttpServer())
      .patch(`/workforce/payroll/runs/${runId}/reopen`)
      .set('Authorization', bearer)
      .send({ reason: 'Salary was recorded wrongly' })
      .expect(200);
    // A backdated rise: the candidate recalculation will carry RM4,000.
    await request(app.getHttpServer())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '4000.00', basis: 'MONTHLY', effectiveFrom: '2026-07-01', reason: 'Correction' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/workforce/payroll/runs/${runId}/calculate`)
      .set('Authorization', bearer)
      .expect(200);

    // The run's own lines now say RM4,000 —
    const detail = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(Number(detail.body.lines[0].basicSalary)).toBe(4000);

    // — and the payslip still says exactly what was approved.
    const slip = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/payslips/${staffId}`)
      .set('Authorization', bearer)
      .expect(200);
    const basic = slip.body.earnings.find((row: { code: string }) => row.code === 'BASIC');
    expect(basic.amountCents).toBe(320000);
    expect(slip.body.figures.netCents).toBe(approvedNet);
    expect(slip.body.revision.version).toBe(1);
    expect(slip.body.revision.reopenedSinceApproval).toBe(true);
  });

  it('marks revision 1 superseded once the correction is approved, and issues revision 2', async () => {
    await request(app.getHttpServer())
      .patch(`/workforce/payroll/runs/${runId}/approve`)
      .set('Authorization', bearer)
      .send({ acknowledgeStatutoryGap: true })
      .expect(200);

    const revised = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/payslips/${staffId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(revised.body.revision.version).toBe(2);
    expect(revised.body.revision.superseded).toBe(false);
    const basic = revised.body.earnings.find((row: { code: string }) => row.code === 'BASIC');
    expect(basic.amountCents).toBe(400000);

    const original = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/payslips/${staffId}?version=1`)
      .set('Authorization', bearer)
      .expect(200);
    expect(original.body.revision.superseded).toBe(true);
    expect(original.body.figures.netCents).toBe(approvedNet);
    const originalLindung = original.body.statutoryDeductions.find(
      (row: { key: string }) => row.key === 'LINDUNG',
    );
    expect(originalLindung.amountCents).toBe(approvedLindung);
  });

  it('produces a PDF and leaves an audit trail of the download', async () => {
    const res = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/payslips/${staffId}/pdf`)
      .set('Authorization', bearer)
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('payslip-2026-07');
    expect(res.body.length ?? res.body.byteLength ?? 0).toBeGreaterThan(1000);

    const audit = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.findMany({ where: { tenantId, action: 'payrollPayslip.downloaded' } }),
    );
    expect(audit).toHaveLength(1);
    expect(((audit[0].after ?? {}) as { staffId?: string }).staffId).toBe(staffId);
  });

  it('prints the employer logo, the account it was paid to by its last four digits, and the year to date', async () => {
    // UAT, 12 October 2026. A 1×1 PNG stands in for the clinic's logo.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await request(app.getHttpServer())
      .post(`/workforce/legal-employers/${legalEmployerId}/logo`)
      .set('Authorization', bearer)
      .attach('file', Buffer.from('not an image'), { filename: 'logo.png', contentType: 'image/png' })
      .expect(400);
    const uploaded = await request(app.getHttpServer())
      .post(`/workforce/legal-employers/${legalEmployerId}/logo`)
      .set('Authorization', bearer)
      .attach('file', png, { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    expect(uploaded.body.logoMediaId).toBeTruthy();
    await request(app.getHttpServer()).get(`/workforce/legal-employers/${legalEmployerId}/logo`).set('Authorization', bearer).expect(200);

    const slip = (await request(app.getHttpServer()).get(`/workforce/payroll/runs/${runId}/payslips/${staffId}`).set('Authorization', bearer).expect(200)).body;
    expect(slip.employer.logoMediaId).toBe(uploaded.body.logoMediaId);
    expect(slip.employer.name).toBe('Payslip Employer Sdn Bhd');
    expect(slip.employee.bankName).toBe('Maybank');
    expect(slip.employee.bankAccountLastFour).toBe('8901');
    expect(JSON.stringify(slip)).not.toContain('512345678901');

    const pdf = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/payslips/${staffId}/pdf`)
      .set('Authorization', bearer)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const bytes = pdf.body as Buffer;
    expect(bytes.toString('latin1')).toContain('/Subtype /Image');

    await request(app.getHttpServer()).delete(`/workforce/legal-employers/${legalEmployerId}/logo`).set('Authorization', bearer).expect(200);
    await request(app.getHttpServer()).get(`/workforce/legal-employers/${legalEmployerId}/logo`).set('Authorization', bearer).expect(404);
  });

  it('lets the employee download their own payslip once the run is PAID, and nobody else', async () => {
    const employeeBearer = bearerFor(tenantId, staffId, Role.FRONT_DESK_CLINICAL_STAFF);
    // Approved is not paid: the portal waits for the money to have gone out.
    await request(app.getHttpServer()).get(`/me/payslips/${runId}/pdf`).set('Authorization', employeeBearer).expect(404);

    await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollRun.update({
        where: { id: runId },
        data: { status: 'PAID', paymentDate: new Date('2026-07-28T00:00:00.000Z') },
      }),
    );

    const res = await request(app.getHttpServer())
      .get(`/me/payslips/${runId}/pdf`)
      .set('Authorization', employeeBearer)
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('payslip-2026-07');
    expect(res.body.length ?? res.body.byteLength ?? 0).toBeGreaterThan(1000);

    const list = await request(app.getHttpServer()).get('/me/payslips').set('Authorization', employeeBearer).expect(200);
    expect(list.body).toEqual([expect.objectContaining({ runId, runStatus: 'PAID' })]);

    const other = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Somebody Else', clinicId },
      }),
    );
    await request(app.getHttpServer())
      .get(`/me/payslips/${runId}/pdf`)
      .set('Authorization', bearerFor(tenantId, other.id, Role.FRONT_DESK_CLINICAL_STAFF))
      .expect(404);

    const audit = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.findMany({ where: { tenantId, action: 'payrollPayslip.downloaded' }, orderBy: { createdAt: 'asc' } }),
    );
    // Two downloads by the owner (the PDF test and the logo test), then the employee's own.
    expect(audit).toHaveLength(3);
    expect(((audit[2].after ?? {}) as { self?: boolean }).self).toBe(true);
  });

  it('refuses the payslip surface to an account without the payroll permission', async () => {
    const outsider = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'No Payroll', clinicId },
      }),
    );
    const outsiderBearer = bearerFor(tenantId, outsider.id, Role.FRONT_DESK_CLINICAL_STAFF);
    await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/payslips`)
      .set('Authorization', outsiderBearer)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/payslips/${staffId}/pdf`)
      .set('Authorization', outsiderBearer)
      .expect(403);
  });
});
