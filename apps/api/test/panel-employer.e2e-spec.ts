import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * THE EMPLOYERS BEHIND A PANEL (N-5), and G-9, against a real PostgreSQL.
 *
 * Owner answer, 2026-11-03: the employer is "a real list per panel, with
 * quick-add at the counter", not free text — because free text cannot answer
 * "what did we bill for Company X", and because a per-employer payment term
 * needs somewhere to live.
 *
 * What these prove:
 *   - a quick-add needs nothing but a name
 *   - one company cannot become three rows through spelling
 *   - an employer belongs to ONE panel, so the same name on two panels is two
 *     agreements and both are allowed
 *   - a range term with its edges the wrong way round is refused, not stored
 *   - an employer is deactivated, never deleted
 *   - **G-9**: a panel whose term "varies by company" gives a claim a real due
 *     date once the company's term is recorded — and still none before that
 *   - the employer's term beats the panel's, and a submitted claim keeps the
 *     due date it was sent under
 *   - tenants cannot see each other's employers
 */
describe('Panel: the employers behind a panel (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let panelId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Employer Tenant' } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    const panel = await withTenantContext(prisma, tenantId, (tx) =>
      tx.panelClinic.create({
        data: { tenantId, name: 'Contoh TPA', paymentTermDays: 30, feeTreatment: 'NO_FEE' },
      }),
    );
    panelId = panel.id;
  });

  const list = (id = panelId, query = '') =>
    request(app.getHttpServer())
      .get(`/panel-workspace/panels/${id}/employers${query}`)
      .set('Authorization', bearer);

  const add = (body: object, id = panelId) =>
    request(app.getHttpServer())
      .post(`/panel-workspace/panels/${id}/employers`)
      .set('Authorization', bearer)
      .send(body);

  const edit = (employerId: string, body: object) =>
    request(app.getHttpServer())
      .patch(`/panel-workspace/employers/${employerId}`)
      .set('Authorization', bearer)
      .send(body);

  /**
   * THE QUICK-ADD. Somebody mid-registration types a company name and moves on;
   * asking them for a payment term they do not know would be answered with a
   * guess, and a guessed term decides when that company's claims are chased.
   */
  it('adds an employer from a name alone, with no term', async () => {
    const created = await add({ name: 'Syarikat Contoh Sdn Bhd' }).expect(201);
    expect(created.body.name).toBe('Syarikat Contoh Sdn Bhd');
    expect(created.body.paymentTermDays).toBeNull();

    const rows = await list().expect(200);
    expect(rows.body).toHaveLength(1);
    expect(rows.body[0].hasOwnTerm).toBe(false);
  });

  it('trims the name and stores the code', async () => {
    const created = await add({ name: '  Syarikat Contoh  ', code: ' SC-01 ' }).expect(201);
    expect(created.body.name).toBe('Syarikat Contoh');
    expect(created.body.code).toBe('SC-01');
  });

  /**
   * ONE COMPANY, NOT THREE STRINGS. As free text, "Contoh Sdn Bhd", "CONTOH
   * SDN BHD" and "contoh  sdn  bhd" are three rows in every report and three
   * terms to configure. The unique index alone would let all three in — only
   * case and spacing differ — so the service compares them itself.
   */
  it('refuses the same company spelled differently', async () => {
    await add({ name: 'Contoh Sdn Bhd' }).expect(201);
    for (const spelling of ['CONTOH SDN BHD', 'contoh sdn bhd', '  Contoh   Sdn   Bhd  ']) {
      const again = await add({ name: spelling }).expect(400);
      expect(again.body.message).toContain('already on this panel');
    }
    expect((await list().expect(200)).body).toHaveLength(1);
  });

  it('refuses a rename onto another employer on the same panel', async () => {
    await add({ name: 'Contoh One' }).expect(201);
    const two = await add({ name: 'Contoh Two' }).expect(201);
    const clash = await edit(two.body.id, { name: 'contoh one' }).expect(400);
    expect(clash.body.message).toContain('already on this panel');
    // Renaming to a different spelling of ITS OWN name is fine, not a clash.
    await edit(two.body.id, { name: 'Contoh  Two' }).expect(200);
  });

  /**
   * The same company reached through two TPAs is two agreements, with two terms
   * and two sets of claim numbers. Merging them would give one due date to two
   * contracts.
   */
  it('allows the same company on two different panels', async () => {
    const other = await withTenantContext(prisma, tenantId, (tx) =>
      tx.panelClinic.create({ data: { tenantId, name: 'Contoh Insurer', feeTreatment: 'NO_FEE' } }),
    );
    await add({ name: 'Syarikat Contoh' }).expect(201);
    await add({ name: 'Syarikat Contoh' }, other.id).expect(201);

    expect((await list().expect(200)).body).toHaveLength(1);
    expect((await list(other.id).expect(200)).body).toHaveLength(1);
  });

  /**
   * A range whose far edge is nearer than its near edge would produce a due
   * date EARLIER than the chase date — the claim would read as overdue on the
   * day it was sent.
   */
  it('refuses a range term with its edges the wrong way round', async () => {
    const bad = await add({ name: 'Contoh', paymentTermDays: 60, paymentTermMaxDays: 30 }).expect(400);
    expect(bad.body.message).toContain('cannot be shorter');
    expect((await list().expect(200)).body).toHaveLength(0);
  });

  it('refuses a longest term with no usual term beside it', async () => {
    const bad = await add({ name: 'Contoh', paymentTermMaxDays: 90 }).expect(400);
    expect(bad.body.message).toContain('needs a usual term');
  });

  /**
   * DEACTIVATED, NEVER DELETED. A claim already raised references its employer,
   * and "who was this billed to" must keep an answer long after the clinic
   * stopped seeing that company.
   */
  it('hides a deactivated employer from the counter but keeps it findable', async () => {
    const created = await add({ name: 'Contoh Retired' }).expect(201);
    await edit(created.body.id, { active: false }).expect(200);

    expect((await list().expect(200)).body).toHaveLength(0);
    const all = await list(panelId, '?includeInactive=true').expect(200);
    expect(all.body).toHaveLength(1);
    expect(all.body[0].active).toBe(false);
  });

  it('records who added and who changed an employer', async () => {
    const created = await add({ name: 'Contoh', paymentTermDays: 45 }).expect(201);
    await edit(created.body.id, { paymentTermDays: 90 }).expect(200);
    const audits = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { action: { in: ['panel.employerCreated', 'panel.employerUpdated'] } },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(audits.map((row) => row.action)).toEqual([
      'panel.employerCreated',
      'panel.employerUpdated',
    ]);
    for (const row of audits) {
      expect((row.after as { _actor?: { staffId?: string } })._actor?.staffId).toBeTruthy();
    }
  });

  // -------------------------------------------------------------------------
  // G-9, END TO END.
  //
  // One panel in the clinic's workbook states its payment term as `VARY BASED
  // ON COMPANY`. Kuwick could record only THAT it varies, so every claim on
  // that panel resolved to no due date at all and could never be called
  // overdue — correct, and it left a whole panel's receivable unchaseable.
  // These two cases are the before and the after.
  // -------------------------------------------------------------------------
  describe('a panel whose term varies by company (G-9)', () => {
    let clinicId: string;
    let ownerStaffId: string;
    let varyingPanelId: string;

    beforeEach(async () => {
      const clinic = await withTenantContext(prisma, tenantId, (tx) =>
        tx.clinic.create({ data: { tenantId, name: 'Contoh Clinic' } }),
      );
      clinicId = clinic.id;
      const staff = await withTenantContext(prisma, tenantId, (tx) =>
        tx.staff.findFirstOrThrow({ where: { tenantId } }),
      );
      ownerStaffId = staff.id;
      const panel = await withTenantContext(prisma, tenantId, (tx) =>
        tx.panelClinic.create({
          data: {
            tenantId,
            name: 'Contoh TPA (varies)',
            // The indicative number the workbook carries beside the words.
            paymentTermDays: 30,
            paymentTermVariesByPayer: true,
            feeTreatment: 'NO_FEE',
          },
        }),
      );
      varyingPanelId = panel.id;
    });

    /** Build a submitted claim for this panel, optionally for an employer. */
    async function submitClaimFor(employerId: string | null) {
      const { batchId } = await withTenantContext(prisma, tenantId, async (tx) => {
        const patient = await tx.patient.create({
          data: {
            tenantId,
            name: 'Pesakit Contoh',
            identifierType: 'NRIC',
            identifierValue: `90010${Math.floor(Math.random() * 900000) + 100000}`,
          },
        });
        const visit = await tx.visit.create({
          data: {
            tenantId,
            clinicId,
            patientId: patient.id,
            visitNumber: `V-${Math.floor(Math.random() * 1_000_000)}`,
            billingType: 'PANEL',
            panelClinicId: varyingPanelId,
            panelEmployerId: employerId,
            panelRelationship: 'SELF',
            registeredByStaffId: ownerStaffId,
            staffId: ownerStaffId,
          },
        });
        const invoice = await tx.invoice.create({
          data: {
            tenantId,
            visitId: visit.id,
            invoiceNumber: `INV-${Math.floor(Math.random() * 1_000_000)}`,
            createdByStaffId: ownerStaffId,
            totalAmount: 100,
            panelResponsibilityAmount: 100,
            patientResponsibilityAmount: 0,
            panelCoveredAmount: 100,
            status: 'PAID',
          },
        });
        const batch = await tx.claimBatch.create({
          data: {
            tenantId,
            panelClinicId: varyingPanelId,
            batchNumber: `CLAIM-${Math.floor(Math.random() * 1_000_000)}`,
            createdByStaffId: ownerStaffId,
          },
        });
        await tx.claimBatchLine.create({
          data: {
            tenantId,
            claimBatchId: batch.id,
            invoiceId: invoice.id,
            claimedAmount: 100,
            feeAmount: 0,
            feeTreatment: 'NO_FEE',
          },
        });
        return { batchId: batch.id };
      });

      await request(app.getHttpServer())
        .patch(`/panel-workspace/batches/${batchId}/submitted`)
        .set('Authorization', bearer)
        .send({ submissionMethod: 'PORTAL', submittedAt: '2026-01-01' })
        .expect(200);

      return withTenantContext(prisma, tenantId, (tx) =>
        tx.claimBatchLine.findFirstOrThrow({ where: { claimBatchId: batchId } }),
      );
    }

    /** BEFORE: nobody knows the company, so Kuwick invents no due date. */
    it('gives a claim no due date while the company is unknown', async () => {
      const line = await submitClaimFor(null);
      expect(line.dueDate).toBeNull();
    });

    /**
     * AFTER: the company is recorded and so is its term, so the claim has a
     * real due date — computed from the EMPLOYER's 90 days, not from the
     * panel's indicative 30.
     */
    it('gives a claim a real due date once the company\u2019s term is recorded', async () => {
      const employer = await add({ name: 'Syarikat Contoh', paymentTermDays: 90 }, varyingPanelId)
        .expect(201)
        .then((response) => response.body);

      const line = await submitClaimFor(employer.id);
      expect(line.dueDate).not.toBeNull();
      expect(line.dueDate!.toISOString().slice(0, 10)).toBe('2026-04-01');
    });

    /**
     * Knowing WHICH company it is does not tell us what they agreed. This is
     * the case easiest to get wrong by quietly falling back to the panel's own
     * indicative number.
     */
    it('still gives no due date when the company is known but its term is not', async () => {
      const employer = await add({ name: 'Syarikat Tanpa Terma' }, varyingPanelId)
        .expect(201)
        .then((response) => response.body);

      const line = await submitClaimFor(employer.id);
      expect(line.dueDate).toBeNull();
    });

    /**
     * And the employer's term beats a panel that HAS a usable term of its own —
     * if somebody recorded that this company pays in 90 days, that is the
     * agreement this claim is under.
     */
    it('lets the employer\u2019s term beat a panel with a term of its own', async () => {
      await withTenantContext(prisma, tenantId, (tx) =>
        tx.panelClinic.update({
          where: { id: varyingPanelId },
          data: { paymentTermVariesByPayer: false, paymentTermDays: 30 },
        }),
      );
      const employer = await add({ name: 'Syarikat Lambat', paymentTermDays: 90 }, varyingPanelId)
        .expect(201)
        .then((response) => response.body);

      const withEmployer = await submitClaimFor(employer.id);
      expect(withEmployer.dueDate!.toISOString().slice(0, 10)).toBe('2026-04-01');

      // A claim on the same panel with no employer still takes the panel's 30.
      const withoutEmployer = await submitClaimFor(null);
      expect(withoutEmployer.dueDate!.toISOString().slice(0, 10)).toBe('2026-01-31');
    });

    /**
     * A SUBMITTED CLAIM KEEPS THE DUE DATE IT WENT OUT UNDER. `dueDate` is a
     * snapshot, for the same reason `feeTreatment` is (D-112): renegotiating a
     * term must not rewrite the arithmetic of a claim already with the panel
     * and already being argued about.
     */
    it('does not move a submitted claim\u2019s due date when the term is renegotiated', async () => {
      const employer = await add({ name: 'Syarikat Contoh', paymentTermDays: 90 }, varyingPanelId)
        .expect(201)
        .then((response) => response.body);
      const line = await submitClaimFor(employer.id);
      expect(line.dueDate!.toISOString().slice(0, 10)).toBe('2026-04-01');

      await edit(employer.id, { paymentTermDays: 150 }).expect(200);

      const after = await withTenantContext(prisma, tenantId, (tx) =>
        tx.claimBatchLine.findUniqueOrThrow({ where: { id: line.id } }),
      );
      expect(after.dueDate!.toISOString().slice(0, 10)).toBe('2026-04-01');
    });
  });

  it('cannot see another tenant\u2019s employers', async () => {
    await add({ name: 'Mine' }).expect(201);

    const otherTenant = randomId();
    await withTenantContext(prisma, otherTenant, (tx) =>
      tx.tenant.create({ data: { id: otherTenant, name: 'Other Tenant' } }),
    );
    const otherOwner = await createOwnerAndBearer(prisma, otherTenant);

    const seen = await request(app.getHttpServer())
      .get(`/panel-workspace/panels/${panelId}/employers`)
      .set('Authorization', otherOwner.bearer)
      .expect(200);
    expect(seen.body).toEqual([]);
  });
});
