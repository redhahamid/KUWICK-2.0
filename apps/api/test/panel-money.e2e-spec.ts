import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * PANEL MONEY SEEN FROM FINANCE, against a real PostgreSQL.
 *
 * The three questions the panel work queue structurally cannot answer, because
 * two are about something MISSING and one is about money that has already left:
 *
 *   - what we billed a panel and never claimed (the clinic's own monthly
 *     reconciliation, done by hand against a spreadsheet today)
 *   - what the withheld admin fee costs (only askable since D-112)
 *   - where the fee rule and the banked money disagree — the standing version
 *     of the forensic pass that found two such payments in 2,640 workbook rows
 */
describe('Finance: panel money (e2e)', () => {
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

  beforeEach(async () => {
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Panel Money Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;
    ownerStaffId = owner.staffId;

    const clinic = await request(app.getHttpServer())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Panel Money Clinic' })
      .expect(201);
    clinicId = clinic.body.id;

    const panel = await withTenantContext(prisma, tenantId, (tx) =>
      tx.panelClinic.create({
        data: {
          tenantId,
          name: 'WithholdCare',
          code: 'WHC',
          paymentTermDays: 30,
          claimFeeType: 'PERCENT',
          claimFeeValue: 8,
          // The default established by the owner on 2026-08-31 (D-112): the fee
          // comes OUT of the payment, so RM100 claimed banks RM92.
          feeTreatment: 'WITHHELD_FROM_CLAIM',
        },
      }),
    );
    panelId = panel.id;
  });

  /** A settled panel invoice. `claim` false leaves it unclaimed on purpose. */
  async function panelInvoice(
    billed: number,
    opts: { claim?: boolean; claimed?: number; settledDaysAgo?: number } = {},
  ) {
    const settledAt = new Date(Date.now() - (opts.settledDaysAgo ?? 1) * 86_400_000);
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
      const invoice = await tx.invoice.create({
        data: {
          tenantId,
          visitId: visit.id,
          invoiceNumber: `INV-${Math.floor(Math.random() * 1_000_000)}`,
          createdByStaffId: ownerStaffId,
          totalAmount: billed,
          panelResponsibilityAmount: billed,
          patientResponsibilityAmount: 0,
          panelCoveredAmount: billed,
          status: 'PAID',
          paidAt: settledAt,
        },
      });
      if (opts.claim === false) return { invoiceId: invoice.id, lineId: null as string | null };

      const claimed = opts.claimed ?? billed;
      const batch = await tx.claimBatch.create({
        data: {
          tenantId,
          panelClinicId: panelId,
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
          feeAmount: Math.round(claimed * 8) / 100,
          feeTreatment: 'WITHHELD_FROM_CLAIM',
          status: 'PENDING',
        },
      });
      return { invoiceId: invoice.id, lineId: line.id };
    });
  }

  const position = () =>
    request(app.getHttpServer()).get('/finance/panel-money').set('Authorization', bearer).expect(200);

  // -------------------------------------------------------------------------
  it('finds money billed to a panel that was never claimed, and ages it from settlement', async () => {
    await panelInvoice(100, { claim: true, settledDaysAgo: 5 });
    await panelInvoice(145, { claim: false, settledDaysAgo: 70 });

    const { body } = await position();
    expect(body.billing.billed).toBe(245);
    expect(body.billing.claimed).toBe(100);
    expect(body.billing.unclaimed).toBe(145);
    expect(body.billing.unclaimedInvoices).toBe(1);
    // Aged from the day it became claimable, not from today's date.
    expect(body.billing.aging.d61_90).toBe(145);
    expect(body.billing.aging.current).toBe(0);

    const row = body.unclaimedInvoiceRows[0];
    expect(row.state).toBe('UNCLAIMED');
    expect(row.unclaimed).toBe(145);
    expect(row.ageDays).toBeGreaterThanOrEqual(69);
  });

  it('a claim raised for LESS than the invoice was billed leaves the difference unclaimed', async () => {
    await panelInvoice(200, { claim: true, claimed: 120 });

    const { body } = await position();
    expect(body.billing.billed).toBe(200);
    expect(body.billing.claimed).toBe(120);
    expect(body.billing.unclaimed).toBe(80);
    expect(body.unclaimedInvoiceRows[0].state).toBe('UNDER_CLAIMED');
  });

  it('a REJECTED claim frees its invoice, so the money returns to "never claimed" rather than vanishing', async () => {
    const claim = await panelInvoice(100, { claim: true });
    // Rejected outright — which is exactly what makes the invoice claimable
    // again in `ClaimBatchService`. Finance must agree with that, or the money
    // sits in the gap between two screens.
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.claimBatchLine.update({
        where: { id: claim.lineId! },
        data: { status: 'REJECTED', claimStatus: 'REJECTED', approvedAmount: 0, rejectedAmount: 92, adjudicatedAt: new Date() },
      }),
    );

    const { body } = await position();
    expect(body.billing.claimed).toBe(0);
    expect(body.billing.unclaimed).toBe(100);
  });

  it('the withheld fee is a COST — borne once paid, expected while still owed, never both', async () => {
    const paid = await panelInvoice(100, { claim: true });
    await panelInvoice(50, { claim: true });

    await withTenantContext(prisma, tenantId, (tx) =>
      tx.claimBatchLine.update({
        where: { id: paid.lineId! },
        // RM100 claimed, RM8 withheld, RM92 expected — and RM92 arrived.
        data: { claimStatus: 'PAID', status: 'PAID', approvedAmount: 92, paidAmount: 92, adjudicatedAt: new Date() },
      }),
    );

    const { body } = await position();
    expect(body.feeCost.borne).toBe(8);
    expect(body.feeCost.expected).toBe(4);
    expect(body.feeCost.unresolvedClaims).toBe(0);
    expect(body.feeEvidence.taken).toBe(1);
    expect(body.feeEvidence.pending).toBe(1);
  });

  it('a fee whose direction nobody configured is excluded from the cost AND counted, never assumed zero', async () => {
    const claim = await panelInvoice(100, { claim: true });
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.claimBatchLine.update({ where: { id: claim.lineId! }, data: { feeTreatment: 'UNCONFIGURED' } }),
    );

    const { body } = await position();
    expect(body.feeCost.borne).toBe(0);
    expect(body.feeCost.expected).toBe(0);
    expect(body.feeCost.unresolvedClaims).toBe(1);
    expect(body.feeCost.unresolvedFee).toBe(8);
  });

  it('finds a panel that did NOT take its fee — the workbook exception, without anybody looking', async () => {
    const claim = await panelInvoice(100, { claim: true });
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.claimBatchLine.update({
        where: { id: claim.lineId! },
        // The rule says RM92. The whole RM100 arrived.
        data: { claimStatus: 'PAID', status: 'PAID', approvedAmount: 100, paidAmount: 100, adjudicatedAt: new Date() },
      }),
    );

    const { body } = await position();
    expect(body.feeEvidence.notTaken).toBe(1);
    expect(body.feeEvidence.notTakenAmount).toBe(8);
    expect(body.exceptionRows).toHaveLength(1);
    expect(body.exceptionRows[0]).toMatchObject({
      state: 'NOT_TAKEN',
      claimed: 100,
      expected: 92,
      received: 100,
      difference: 8,
    });
    // And it costs the clinic nothing, because nothing was withheld... except
    // that the fee IS still recorded as borne, since the claim settled with
    // money. The two figures answer different questions and must not be mixed:
    // "what the rule says we spend" and "what actually happened".
    expect(body.feeCost.borne).toBe(8);
  });

  it('a claim closed with no money is NOT_PAID, and costs no fee at all', async () => {
    const claim = await panelInvoice(100, { claim: true });
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.claimBatchLine.update({
        where: { id: claim.lineId! },
        data: { claimStatus: 'REJECTED', status: 'REJECTED', approvedAmount: 0, rejectedAmount: 92, adjudicatedAt: new Date() },
      }),
    );

    const { body } = await position();
    expect(body.feeEvidence.notPaid).toBe(1);
    expect(body.feeCost.borne).toBe(0);
    expect(body.feeCost.expected).toBe(0);
  });

  it('a remittance keyed NET is not reported as a discrepancy, but one that kept MORE than the fees is', async () => {
    const keyedNet = await panelInvoice(100, { claim: true });
    const kepMore = await panelInvoice(100, { claim: true });

    await withTenantContext(prisma, tenantId, async (tx) => {
      // Keyed net: gross 92, nothing withheld. The normal, correct way.
      await tx.panelRemittance.create({
        data: {
          tenantId,
          panelClinicId: panelId,
          remittanceRef: 'NET-001',
          receivedAt: new Date(),
          grossAmount: 92,
          withheldAmount: 0,
          netAmount: 92,
          recordedByStaffId: ownerStaffId,
          allocations: { create: [{ tenantId, claimBatchLineId: keyedNet.lineId!, amount: 92 }] },
        },
      });
      // Keyed gross, and they kept RM20 where the fee is RM8.
      await tx.panelRemittance.create({
        data: {
          tenantId,
          panelClinicId: panelId,
          remittanceRef: 'GROSS-002',
          receivedAt: new Date(),
          grossAmount: 100,
          withheldAmount: 20,
          netAmount: 80,
          recordedByStaffId: ownerStaffId,
          allocations: { create: [{ tenantId, claimBatchLineId: kepMore.lineId!, amount: 80 }] },
        },
      });
    });

    const { body } = await position();
    expect(body.banked.remittances).toBe(2);
    expect(body.banked.net).toBe(172);
    expect(body.banked.unexplained).toBe(12);
    // ONE discrepancy, not two: the net-keyed payment has nothing to check.
    expect(body.banked.remittancesThatDisagree).toBe(1);
    const net = body.remittanceRows.find((row: { reference: string }) => row.reference === 'NET-001');
    expect(net.withholdingChecked).toBe(false);
  });

  it('scopes to the tenant: another clinic’s panel money is invisible', async () => {
    await panelInvoice(100, { claim: false });

    const otherTenant = randomId();
    await withTenantContext(prisma, otherTenant, (tx) =>
      tx.tenant.create({ data: { id: otherTenant, name: 'Other Tenant' } }),
    );
    const other = await createOwnerAndBearer(prisma, otherTenant);

    const { body } = await request(app.getHttpServer())
      .get('/finance/panel-money')
      .set('Authorization', other.bearer)
      .expect(200);
    expect(body.billing.billed).toBe(0);
    expect(body.billing.unclaimed).toBe(0);
  });
});
