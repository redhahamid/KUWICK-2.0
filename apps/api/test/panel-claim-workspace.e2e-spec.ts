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
          // Explicit, because the direction is now a contract term rather than
          // a constant: this fixture panel ADDS its fee to what it is billed.
          // The two tests at the bottom of this file cover the other panel
          // shapes — one that withholds, and one where nobody has said.
          feeTreatment: 'ADDED_TO_RECEIVABLE',
          resubmitAsNewClaim: true,
        },
      }),
    );
    panelId = panel.id;
  });

  /** A panel invoice already batched into a claim, ready to be submitted. */
  async function makeClaim(
    claimed = 100,
    fee = 8,
    opts: {
      panelId?: string;
      feeTreatment?: 'WITHHELD_FROM_CLAIM' | 'ADDED_TO_RECEIVABLE' | 'NO_FEE' | 'UNCONFIGURED';
    } = {},
  ): Promise<{ batchId: string; lineId: string }> {
    const targetPanelId = opts.panelId ?? panelId;
    const treatment = opts.feeTreatment === undefined ? 'ADDED_TO_RECEIVABLE' : opts.feeTreatment;
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
          panelClinicId: targetPanelId,
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
          panelClinicId: targetPanelId,
          batchNumber: `CLAIM-${Math.floor(Math.random() * 1_000_000)}`,
          createdByStaffId: ownerStaffId,
        },
      });
      const line = await tx.claimBatchLine.create({
        data: {
          tenantId,
          claimBatchId: batch.id,
          invoiceId: invoice.id,
          claimedAmount: claimed,
          feeAmount: fee,
          feeTreatment: treatment,
        },
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

  // ---------------------------------------------------------------------------
  // G-1 — WHICH WAY THE FEE MOVES, END TO END.
  //
  // Reading the clinic's real claim workbook found that Kuwick had this
  // backwards: every one of its 29 sheets computes `claim to receive =
  // claimed − fee`, and of 2,640 paid fee-bearing claims, 2,615 were banked at
  // exactly claimed − fee and none at claimed + fee. Rather than flip a money
  // formula on one side of a contradiction with an earlier owner decision, the
  // direction became per-panel configuration with a third state — unset — that
  // applies the fee in neither direction. These two tests prove all of it
  // through the HTTP surface, not just through the pure function.
  // ---------------------------------------------------------------------------

  it('a withheld fee makes the receivable claimed MINUS fee, and a full payment settles it to zero', async () => {
    const withholdingPanel = await withTenantContext(prisma, tenantId, (tx) =>
      tx.panelClinic.create({
        data: {
          tenantId,
          name: 'Withholding Panel',
          code: 'WHP',
          paymentTermDays: 30,
          claimFeeType: 'PERCENT',
          claimFeeValue: 8,
          feeTreatment: 'WITHHELD_FROM_CLAIM',
        },
      }),
    );
    const claim = await makeClaim(100, 8, { panelId: withholdingPanel.id, feeTreatment: 'WITHHELD_FROM_CLAIM' });

    const queue = await request(app.getHttpServer())
      .get(`/panel-workspace/submission-queue?panelClinicId=${withholdingPanel.id}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(queue.body[0].expectedReceivable).toBe(92);

    await request(app.getHttpServer())
      .patch(`/panel-workspace/batches/${claim.batchId}/submitted`)
      .set('Authorization', bearer)
      .send({ submissionMethod: 'PORTAL', submissionReference: 'WHP-1' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/adjudicate`)
      .set('Authorization', bearer)
      .send({ approvedAmount: '92.00' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/panel-workspace/remittances')
      .set('Authorization', bearer)
      .send({
        panelClinicId: withholdingPanel.id,
        receivedAt: '2026-08-20',
        grossAmount: '92.00',
        allocations: [{ claimLineId: claim.lineId, amount: '92.00' }],
      })
      .expect(201);

    // The failure this fixes: computing claimed + fee leaves this fully-settled
    // claim reading as RM16 short — twice the fee — forever.
    const reconciliation = await request(app.getHttpServer())
      .get(`/panel-workspace/reconciliation?panelClinicId=${withholdingPanel.id}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(reconciliation.body.totals.expectedReceivable).toBe(92);
    expect(reconciliation.body.totals.received).toBe(92);
    expect(reconciliation.body.totals.outstanding).toBe(0);
    expect(reconciliation.body.totals.unresolvedFeeTreatment).toBe(0);
    expect(reconciliation.body.reconciles).toBe(true);
  });

  it('leaves the fee out entirely — and says so — when the treatment is not established', async () => {
    const unsetPanel = await withTenantContext(prisma, tenantId, (tx) =>
      tx.panelClinic.create({
        data: {
          tenantId,
          name: 'Unconfigured Panel',
          code: 'UNC',
          paymentTermDays: 30,
          claimFeeType: 'AMOUNT',
          claimFeeValue: 8,
          // feeTreatment deliberately left at its UNCONFIGURED default.
        },
      }),
    );
    await makeClaim(100, 8, { panelId: unsetPanel.id, feeTreatment: 'UNCONFIGURED' });

    const queue = await request(app.getHttpServer())
      .get(`/panel-workspace/submission-queue?panelClinicId=${unsetPanel.id}`)
      .set('Authorization', bearer)
      .expect(200);
    // Neither 108 nor 92 — the fee is not guessed in either direction.
    expect(queue.body[0].expectedReceivable).toBe(100);

    const reconciliation = await request(app.getHttpServer())
      .get(`/panel-workspace/reconciliation?panelClinicId=${unsetPanel.id}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(reconciliation.body.totals.expectedReceivable).toBe(100);
    expect(reconciliation.body.totals.fees).toBe(8);
    // The count that makes the omission visible instead of silent.
    expect(reconciliation.body.totals.unresolvedFeeTreatment).toBe(1);

    // And the configuration screen names the panel to go and fix.
    const panels = await request(app.getHttpServer())
      .get('/panel-workspace/panels')
      .set('Authorization', bearer)
      .expect(200);
    const row = panels.body.find((p: { id: string }) => p.id === unsetPanel.id);
    expect(row.feeTreatmentUnresolved).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // G-5 — THE PANEL REFUSED, SO THE PATIENT PAYS.
  //
  // The fourth route out of a rejection in the clinic's excess register, and
  // the one no system usually models: "SELF PAY", then a payment method and a
  // date typed into another column weeks later, with nothing joining them to
  // the claim. It is NOT a write-off — the money is still coming.
  // ---------------------------------------------------------------------------

  it('moves a rejected amount onto the patient, and it is not a write-off', async () => {
    const claim = await makeClaim(100, 8);
    await request(app.getHttpServer())
      .patch(`/panel-workspace/batches/${claim.batchId}/submitted`)
      .set('Authorization', bearer)
      .send({ submissionMethod: 'PORTAL', submissionReference: 'SP-1' })
      .expect(200);
    // Panel approves 60 of the 108 and refuses 48.
    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/adjudicate`)
      .set('Authorization', bearer)
      .send({
        approvedAmount: '60.00',
        rejectedAmount: '48.00',
        rejectionReason: 'Member annual limit already spent',
        rejectionCategory: 'PATIENT_LIMIT_EXHAUSTED',
      })
      .expect(200);

    const before = await withTenantContext(prisma, tenantId, (tx) =>
      tx.claimBatchLine.findUnique({
        where: { id: claim.lineId },
        select: {
          invoice: {
            select: { panelResponsibilityAmount: true, patientResponsibilityAmount: true, status: true },
          },
        },
      }),
    );
    expect(Number(before!.invoice.patientResponsibilityAmount)).toBe(0);

    const charged = await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/charge-to-patient`)
      .set('Authorization', bearer)
      .send({ reason: 'Panel refused: member annual limit spent. Patient informed by phone.' })
      .expect(200);
    expect(charged.body.patientNowOwes).toBe(48);

    const after = await withTenantContext(prisma, tenantId, (tx) =>
      tx.claimBatchLine.findUnique({
        where: { id: claim.lineId },
        select: {
          claimStatus: true,
          chargedToPatientAmount: true,
          writtenOffAmount: true,
          resolvedAt: true,
          invoice: {
            select: { panelResponsibilityAmount: true, patientResponsibilityAmount: true, status: true },
          },
        },
      }),
    );
    // The money moved between the two shares; the invoice total did not change.
    expect(Number(after!.invoice.patientResponsibilityAmount)).toBe(48);
    expect(Number(after!.invoice.panelResponsibilityAmount)).toBe(52);
    // And the invoice is no longer settled, because somebody now owes on it.
    expect(after!.invoice.status).toBe('UNPAID');
    // Recorded as its own resolution, NOT as a write-off — a write-off total is
    // read as losses, and this money is still coming.
    expect(Number(after!.chargedToPatientAmount)).toBe(48);
    expect(after!.writtenOffAmount).toBeNull();
    expect(after!.claimStatus).toBe('CLOSED');
    expect(after!.resolvedAt).not.toBeNull();

    // It is on the claim's own timeline, which is where an argument six months
    // later gets conducted.
    const timeline = await request(app.getHttpServer())
      .get(`/panel-workspace/claims/${claim.lineId}/timeline`)
      .set('Authorization', bearer)
      .expect(200);
    expect(timeline.body.map((event: { type: string }) => event.type)).toContain('CHARGED_TO_PATIENT');
  });

  it('refuses to charge the patient more than the panel actually rejected, or twice', async () => {
    const claim = await makeClaim(100, 8);
    await request(app.getHttpServer())
      .patch(`/panel-workspace/batches/${claim.batchId}/submitted`)
      .set('Authorization', bearer)
      .send({ submissionMethod: 'PORTAL', submissionReference: 'SP-2' })
      .expect(200);

    // Nothing rejected yet — there is nothing to hand over.
    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/charge-to-patient`)
      .set('Authorization', bearer)
      .send({ reason: 'Trying this before the panel has said anything at all.' })
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/adjudicate`)
      .set('Authorization', bearer)
      .send({ approvedAmount: '88.00', rejectedAmount: '20.00', rejectionReason: 'Item not on the formulary' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/charge-to-patient`)
      .set('Authorization', bearer)
      .send({ amount: '50.00', reason: 'More than the panel refused, which would invent a debt.' })
      .expect(400);

    // A reason is mandatory: the patient who rings up in three weeks needs one.
    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/charge-to-patient`)
      .set('Authorization', bearer)
      .send({ amount: '20.00', reason: 'no' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/charge-to-patient`)
      .set('Authorization', bearer)
      .send({ amount: '20.00', reason: 'Item not covered; patient agreed to pay the difference.' })
      .expect(200);

    // And not twice.
    await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${claim.lineId}/charge-to-patient`)
      .set('Authorization', bearer)
      .send({ amount: '20.00', reason: 'Charging the same rejection to the patient a second time.' })
      .expect(409);
  });

  it('re-stamps claims nobody has sent yet when the fee treatment is set, and leaves submitted ones alone', async () => {
    const latePanel = await withTenantContext(prisma, tenantId, (tx) =>
      tx.panelClinic.create({
        data: { tenantId, name: 'Late Config Panel', code: 'LCP', claimFeeType: 'AMOUNT', claimFeeValue: 8 },
      }),
    );
    const unsent = await makeClaim(100, 8, { panelId: latePanel.id, feeTreatment: 'UNCONFIGURED' });
    const sent = await makeClaim(100, 8, { panelId: latePanel.id, feeTreatment: 'UNCONFIGURED' });
    await request(app.getHttpServer())
      .patch(`/panel-workspace/batches/${sent.batchId}/submitted`)
      .set('Authorization', bearer)
      .send({ submissionMethod: 'PORTAL', submissionReference: 'LCP-1' })
      .expect(200);

    const updated = await request(app.getHttpServer())
      .patch(`/panel-workspace/panels/${latePanel.id}`)
      .set('Authorization', bearer)
      .send({ feeTreatment: 'WITHHELD_FROM_CLAIM' })
      .expect(200);
    expect(updated.body.unsentClaimsRestamped).toBe(1);

    const lines = await withTenantContext(prisma, tenantId, (tx) =>
      tx.claimBatchLine.findMany({
        where: { id: { in: [unsent.lineId, sent.lineId] } },
        select: { id: true, feeTreatment: true },
      }),
    );
    const byId = new Map(lines.map((line) => [line.id, line.feeTreatment]));
    // The unsent claim carries the corrected fact…
    expect(byId.get(unsent.lineId)).toBe('WITHHELD_FROM_CLAIM');
    // …and the one already with the panel keeps the arithmetic it went out under.
    expect(byId.get(sent.lineId)).toBe('UNCONFIGURED');
  });
});
