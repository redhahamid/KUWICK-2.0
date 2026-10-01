import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * THE EPF BASIS DISCREPANCY IS ACKNOWLEDGED ONCE PER SELECTION, PER YEAR.
 *
 * An employer-selected basis below Kuwick's assessment is a policy decision,
 * not a monthly accident. It is raised as a warning the first time; once an
 * approver passes it with a reason, every later month on the same dated
 * selection carries a one-line INFO note instead — and the warning comes
 * back when the selection changes (a new dated row) or the year turns.
 */
describe('EPF basis discrepancy, acknowledged once per selection (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let bettyId: string;

  const server = () => app.getHttpServer();
  const JUNE = '2026-06';
  const JULY = '2026-07';
  const AUGUST = '2026-08';

  const exceptionsOf = async (runId: string) => {
    const res = await request(server()).get(`/workforce/payroll/runs/${runId}/exceptions`).set('Authorization', bearer).expect(200);
    return res.body.exceptions as { id: string; code: string; severity: string; overridable: boolean; cause: string; overriddenBy?: string | null }[];
  };
  const runMonth = async (period: string) => {
    const run = await request(server()).post('/workforce/payroll/runs').set('Authorization', bearer).send({ period, clinicId }).expect(201);
    await request(server()).patch(`/workforce/payroll/runs/${run.body.id}/calculate`).set('Authorization', bearer).expect(200);
    return run.body.id as string;
  };
  const recalc = (runId: string) => request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
  const recordBasis = (body: Record<string, unknown>) =>
    request(server()).post(`/workforce/employees/${bettyId}/contribution-basis`).set('Authorization', bearer).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Basis Acknowledgement Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Ack Branch' }).expect(201)).body.id;
    const employerId = (await request(server()).post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Ack Sdn Bhd' }).expect(201)).body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Acknowledged Betty', clinicId } }),
    );
    bettyId = staff.id;
    await request(server())
      .post(`/workforce/employees/${bettyId}`)
      .set('Authorization', bearer)
      .send({ employeeNo: 'AK-1', position: 'Clinic Assistant', employmentType: 'PERMANENT', employmentStatus: 'ACTIVE', startDate: '2024-01-01', dateOfBirth: '1993-03-03' })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${bettyId}/statutory-classification`)
      .set('Authorization', bearer)
      .send({ effectiveFrom: '2024-01-01', epfMembership: 'MALAYSIAN_CITIZEN', taxResidence: 'RESIDENT', pcbCategory: 'CATEGORY_1', qualifyingChildren: 0, restDayOfWeek: 0, lindungParticipation: 'NOT_PARTICIPATING', reason: 'Recorded at hire' })
      .expect(201);
    await request(server()).patch(`/workforce/employees/${bettyId}/legal-employer`).set('Authorization', bearer).send({ legalEmployerId: employerId }).expect(200);
    await request(server())
      .post(`/workforce/employees/${bettyId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '3000.00', basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);
    // A commission every month, which the selection below leaves out of EPF.
    for (const period of [JUNE, JULY, AUGUST]) {
      await request(server())
        .post('/workforce/payroll/inputs')
        .set('Authorization', bearer)
        .send({ staffId: bettyId, period, componentCode: 'COMMISSION', amount: '500.00', reason: 'Sales commission' })
        .expect(201);
    }
    await recordBasis({ scheme: 'EPF', mode: 'BASIC_ONLY', effectiveFrom: '2026-06-01', reason: 'Owner wants EPF on basic only' }).expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  let juneRunId: string;

  it('June: the discrepancy is a warning the approver can acknowledge', async () => {
    juneRunId = await runMonth(JUNE);
    const warning = (await exceptionsOf(juneRunId)).find((row) => row.code === 'EPF_BASIS_DISCREPANCY');
    expect(warning).toBeDefined();
    expect({ severity: warning!.severity, overridable: warning!.overridable }).toEqual({ severity: 'WARNING', overridable: true });

    await request(server())
      .patch(`/workforce/payroll/exceptions/${warning!.id}/override`)
      .set('Authorization', bearer)
      .send({ reason: 'Policy decided with the accountant for 2026' })
      .expect(200);

    // The acknowledgement is keyed by the selection and the year, not the month.
    const acks = await withTenantContext(prisma, tenantId, (tx) => tx.payrollWarningAcknowledgement.findMany({ where: { tenantId } }));
    expect(acks).toHaveLength(1);
    expect({ code: acks[0].code, year: acks[0].year, reason: acks[0].reason }).toEqual({ code: 'EPF_BASIS_DISCREPANCY', year: 2026, reason: 'Policy decided with the accountant for 2026' });
  });

  it('the same month recalculated, and the month after, carry a one-line note instead', async () => {
    await recalc(juneRunId);
    const june = await exceptionsOf(juneRunId);
    expect(june.find((row) => row.code === 'EPF_BASIS_DISCREPANCY')).toBeUndefined();
    const note = june.find((row) => row.code === 'EPF_BASIS_ACKNOWLEDGED')!;
    expect({ severity: note.severity, overridable: note.overridable }).toEqual({ severity: 'INFO', overridable: false });
    expect(note.cause).toMatch(/acknowledged for the year by Test Owner on \d{4}-\d{2}-\d{2}: “Policy decided with the accountant for 2026”/);

    const julyRunId = await runMonth(JULY);
    const july = await exceptionsOf(julyRunId);
    expect(july.map((row) => row.code)).toContain('EPF_BASIS_ACKNOWLEDGED');
    expect(july.map((row) => row.code)).not.toContain('EPF_BASIS_DISCREPANCY');
  });

  it('a changed selection asks again', async () => {
    // A different selection — basic plus the locum fee, the commission still outside — is a new dated row.
    await recordBasis({ scheme: 'EPF', mode: 'BASIC_PLUS_SELECTED', includedComponentCodes: ['LOCUM_FEE'], effectiveFrom: '2026-08-01', reason: 'Widened after the audit' }).expect(201);
    const augustRunId = await runMonth(AUGUST);
    const august = await exceptionsOf(augustRunId);
    expect(august.map((row) => row.code)).toContain('EPF_BASIS_DISCREPANCY');
    expect(august.map((row) => row.code)).not.toContain('EPF_BASIS_ACKNOWLEDGED');
  });
});
