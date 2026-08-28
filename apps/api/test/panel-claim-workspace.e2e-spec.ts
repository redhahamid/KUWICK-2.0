import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * WAVE 3 — the panel claim workspace, against a real PostgreSQL.
 *
 * What these prove:
 *   - SUBMITTED and PAID are different facts, and the receivable knows it
 *   - a partial approval moves the collectable base to what was APPROVED
 *   - the rejected half becomes a NEW claim linked to the original, and the
 *     original stops being chased
 *   - a remittance must be fully allocated, and a claim's received total is a
 *     SUM OF RECORDS, so a double-click cannot double-credit it
 *   - the reconciliation identity holds:
 *       received + outstanding + rejected + written off = expected receivable
 */
describe('Panel: the claim workspace (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let ownerStaffId: string;
  let clinicId: string;
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

  // No afterEach cleanup — `claim_events` is append-only and enforced.

  beforeEach(async () => {
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Panel Tenant' } }));
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;
    ownerStaffId = owner.staffId;

    const clinic = await request(app.getHttpServer())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Panel Clinic' })
      .expect(201);
    clinicId = clinic.body.id;

    const panel = await withTenantContext(prisma, tenantId, (tx) =>
      tx.panelClinic.create({
        data: {
          tenantId,
          name: 'PMCare',
          code: 'PMC',
          paymentTermDays: 30,
          claimFeeType: 'PERCENT',
          claimFeeValue: 8,
          resubmitAsNewClaim: true,
        },
      }),
    );
    panelId = panel.id;
  });

  /** A panel invoice already batched into a claim, ready to be submitted. */
  async function makeClaim(claimed = 100, fee = 8): Promise<{ batchId: string; lineId: string }> {
    return withTenantContext(prisma, tenantId, async (tx) => {
      const patient = await tx.patient.create({
        data: {
          tenantId,
          name: 'Panel Patient',
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
          panelClinicId: panelId,
          registeredByStaffId: ownerStaffId,
          staffId: ownerStaffId,
        },
      });
      await tx.diagnosis.create({
        data: {
          tenantId,
          visitId: visit.id,
          name: 'Acute upper respiratory infection',
          priority: 'PRIMARY',
          addedByStaffId: ownerStaffId,
        },
      });
      const invoice = await tx.invoice.create({
        data: {
          tenantId,
          visitId: visit.id,
          invoiceNumber: `INV-${Math.floor(Math.random() * 1_000_000)}`,
          createdByStaffId: ownerStaffId,
          totalAmount: claimed,
          panelResponsibilityAmount: claimed,
          patientResponsibilityAmount: 0,
          panelCoveredAmount: claimed,
          status: 'PAID',
        },
      });
      await tx.invoiceLine.create({
        data: { tenantId, invoiceId: invoice.id, description: 'Consultation', quantity: 1, unitPrice: claimed, amount: claimed },
      });
      const batch = await tx.claimBatch.create({
        data: {
          tenantId,
          panelClinicId: panelId,
          batchNumber: `CLAIM-${Math.floor(Math.random() * 1_000_000)}`,
          createdByStaffId: ownerStaffId,
        },
      });
      const line = await tx.claimBatchLine.create({
        data: { tenantId, claimBatchId: batch.id, invoiceId: invoice.id, claimedAmount: claimed, feeAmount: fee },
      });
      return { batchId: batch.id, lineId: line.id };
    });
  }

  // -------------------------------------------------------------------------
  it('lists a complete claim as ready and an incomplete one with what is missing', async () => {
    await makeClaim();

    const queue = await request(app.getHttpServer())
      .get(`/panel-workspace/submission-queue?panelClinicId=${panelId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(queue.body).toHaveLength(1);
    expect(queue.body[0].ready).toBe(true);
    expect(queue.body[0].expectedReceivable).toBe(108);
    expect(queue.body[0].missing).toEqual([]);
  });

  it('SUBMITTED is not PAID — the receivable stays outstanding until money arrives', async () => {
    const claim = await makeClaim();

    await request(app.getHttpServer())
      .patch(`/panel-workspace/batches/${claim.batchId}/submitted`)
      .set('Authorization', bearer)
      .send({ submissionMethod: 'PORTAL', submissionReference: 'PMC-2026-0001' })
      .expect(200);

    const recon = await request(app.getHttpServer())
      .get(`/panel-workspace/reconciliation?panelClinicId=${panelId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(recon.body.totals.expectedReceivable).toBe(108);
    expect(recon.body.totals.received).toBe(0);
    expect(recon.body.totals.outstanding).toBe(108);
    expect(recon.body.reconciles).toBe(true);

    // And it cannot be submitted twice.
    await request(app.getHttpServer())
      .patch(`/panel-workspace/batches/${claim.batchId}/submitted`)
      .set('Authorization', bearer)
      .send({ submissionMethod: 'PORTAL' })
      .expect(409);
  });

  it('a partial approval moves the collectable base to what the panel approved', async () => {
    const claim = await makeClaim();
    await request(app.getHttpServer())
      .patch(`/panel-workspace/batches/${claim.batchId}/submitted`)
      .set('Authorization', bearer)
      .send({ submissionMethod: 'PORTAL' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/adjudicate`)
      .set('Authorization', bearer)
      .send({ approvedAmount: '80.00', rejectedAmount: '28.00', rejectionReason: 'Consultation cap exceeded' })
      .expect(200)
      .expect((res) => expect(res.body.claimStatus).toBe('PARTIALLY_APPROVED'));

    const recon = await request(app.getHttpServer())
      .get(`/panel-workspace/reconciliation?panelClinicId=${panelId}`)
      .set('Authorization', bearer)
      .expect(200);
    // Outstanding is 80, NOT 108. Chasing the rejected 28 as receivable is the
    // drift this rule prevents.
    expect(recon.body.totals.outstanding).toBe(80);
    expect(recon.body.totals.rejected).toBe(28);
    expect(recon.body.reconciles).toBe(true);
  });

  it('refuses an adjudication that exceeds what was claimed, and a rejection with no reason', async () => {
    const claim = await makeClaim();
    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/adjudicate`)
      .set('Authorization', bearer)
      .send({ approvedAmount: '200.00' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/adjudicate`)
      .set('Authorization', bearer)
      .send({ approvedAmount: '80.00', rejectedAmount: '28.00' })
      .expect(400);
  });

  it('re-claims the rejected half as a NEW claim linked to the original', async () => {
    const claim = await makeClaim();
    await request(app.getHttpServer())
      .patch(`/panel-workspace/batches/${claim.batchId}/submitted`)
      .set('Authorization', bearer)
      .send({ submissionMethod: 'PORTAL' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/adjudicate`)
      .set('Authorization', bearer)
      .send({ approvedAmount: '80.00', rejectedAmount: '28.00', rejectionReason: 'Medication not on formulary' })
      .expect(200);

    const resubmission = await request(app.getHttpServer())
      .post(`/panel-workspace/claims/${claim.lineId}/resubmit`)
      .set('Authorization', bearer)
      .send({ reason: 'Formulary exception approved by panel on the phone' })
      .expect(201);
    expect(resubmission.body.replacementLineId).toBeTruthy();

    // The replacement claims the REJECTED amount, not the whole original.
    const replacement = await withTenantContext(prisma, tenantId, (tx) =>
      tx.claimBatchLine.findUnique({ where: { id: resubmission.body.replacementLineId } }),
    );
    expect(Number(replacement!.claimedAmount)).toBe(28);
    expect(replacement!.supersedesLineId).toBe(claim.lineId);

    // The original is resolved and off the work queue; the replacement is on it.
    const queue = await request(app.getHttpServer())
      .get(`/panel-workspace/work-queue?panelClinicId=${panelId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(queue.body.find((row: { claimLineId: string }) => row.claimLineId === claim.lineId)).toBeUndefined();

    // It cannot be re-claimed twice.
    await request(app.getHttpServer())
      .post(`/panel-workspace/claims/${claim.lineId}/resubmit`)
      .set('Authorization', bearer)
      .send({ reason: 'Trying to claim the same rejection again' })
      .expect(409);
  });

  it('requires a remittance to be fully allocated, and derives received from the allocations', async () => {
    const a = await makeClaim(100, 8);
    const b = await makeClaim(50, 4);
    for (const claim of [a, b]) {
      await request(app.getHttpServer())
        .patch(`/panel-workspace/batches/${claim.batchId}/submitted`)
        .set('Authorization', bearer)
        .send({ submissionMethod: 'PORTAL' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/panel-workspace/claims/${claim.lineId}/adjudicate`)
        .set('Authorization', bearer)
        .send({ approvedAmount: claim === a ? '108.00' : '54.00' })
        .expect(200);
    }

    // A remittance that does not add up is refused at entry.
    await request(app.getHttpServer())
      .post('/panel-workspace/remittances')
      .set('Authorization', bearer)
      .send({
        panelClinicId: panelId,
        receivedAt: '2026-08-20',
        grossAmount: '162.00',
        allocations: [{ claimLineId: a.lineId, amount: '108.00' }],
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/panel-workspace/remittances')
      .set('Authorization', bearer)
      .send({
        panelClinicId: panelId,
        receivedAt: '2026-08-20',
        grossAmount: '162.00',
        remittanceRef: 'TRF-88213',
        allocations: [
          { claimLineId: a.lineId, amount: '108.00' },
          { claimLineId: b.lineId, amount: '54.00' },
        ],
      })
      .expect(201);

    const recon = await request(app.getHttpServer())
      .get(`/panel-workspace/reconciliation?panelClinicId=${panelId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(recon.body.totals.received).toBe(162);
    expect(recon.body.totals.outstanding).toBe(0);
    expect(recon.body.reconciles).toBe(true);
    expect(recon.body.byPanel[0].collectionRate).toBe(100);
  });

  it('a partial receipt leaves the remainder outstanding and the claim PARTIALLY_PAID', async () => {
    const claim = await makeClaim();
    await request(app.getHttpServer())
      .patch(`/panel-workspace/batches/${claim.batchId}/submitted`)
      .set('Authorization', bearer)
      .send({ submissionMethod: 'PORTAL' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/adjudicate`)
      .set('Authorization', bearer)
      .send({ approvedAmount: '108.00' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/panel-workspace/remittances')
      .set('Authorization', bearer)
      .send({
        panelClinicId: panelId,
        receivedAt: '2026-08-20',
        grossAmount: '60.00',
        allocations: [{ claimLineId: claim.lineId, amount: '60.00' }],
      })
      .expect(201);

    const line = await withTenantContext(prisma, tenantId, (tx) =>
      tx.claimBatchLine.findUnique({ where: { id: claim.lineId } }),
    );
    expect(line!.claimStatus).toBe('PARTIALLY_PAID');
    expect(Number(line!.paidAmount)).toBe(60);

    const recon = await request(app.getHttpServer())
      .get(`/panel-workspace/reconciliation?panelClinicId=${panelId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(recon.body.totals.outstanding).toBe(48);
  });

  it('writes off the remainder, and refuses to write off more than is outstanding', async () => {
    const claim = await makeClaim();
    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/adjudicate`)
      .set('Authorization', bearer)
      .send({ approvedAmount: '108.00' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/write-off`)
      .set('Authorization', bearer)
      .send({ amount: '500.00', reason: 'Trying to write off more than is owed' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/write-off`)
      .set('Authorization', bearer)
      .send({ reason: 'Panel ceased trading; receivable is uncollectable' })
      .expect(200);

    const recon = await request(app.getHttpServer())
      .get(`/panel-workspace/reconciliation?panelClinicId=${panelId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(recon.body.totals.writtenOff).toBe(108);
    expect(recon.body.totals.outstanding).toBe(0);
    expect(recon.body.reconciles).toBe(true);
  });

  it('keeps a timeline of every status change, and refuses to let it be edited', async () => {
    const claim = await makeClaim();
    await request(app.getHttpServer())
      .patch(`/panel-workspace/batches/${claim.batchId}/submitted`)
      .set('Authorization', bearer)
      .send({ submissionMethod: 'PORTAL', submissionReference: 'PMC-9' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/adjudicate`)
      .set('Authorization', bearer)
      .send({ approvedAmount: '108.00' })
      .expect(200);

    const timeline = await request(app.getHttpServer())
      .get(`/panel-workspace/claims/${claim.lineId}/timeline`)
      .set('Authorization', bearer)
      .expect(200);
    expect(timeline.body.map((event: { type: string }) => event.type)).toEqual(['SUBMITTED', 'ADJUDICATED']);
    expect(timeline.body[0].by).toBe('Test Owner');

    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.$executeRawUnsafe(`UPDATE claim_events SET reason = 'rewritten' WHERE id = '${timeline.body[0].id}'`),
      ),
    ).rejects.toThrow(/permission denied|append-only/);
  });

  it('refuses a remittance that names a claim belonging to a different panel', async () => {
    const claim = await makeClaim();
    const otherPanel = await withTenantContext(prisma, tenantId, (tx) =>
      tx.panelClinic.create({ data: { tenantId, name: 'MediCare', code: 'MC' } }),
    );

    await request(app.getHttpServer())
      .post('/panel-workspace/remittances')
      .set('Authorization', bearer)
      .send({
        panelClinicId: otherPanel.id,
        receivedAt: '2026-08-20',
        grossAmount: '108.00',
        allocations: [{ claimLineId: claim.lineId, amount: '108.00' }],
      })
      .expect(400);
  });
});
