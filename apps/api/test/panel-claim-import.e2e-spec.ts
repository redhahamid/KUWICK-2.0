import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * THE PANEL CLAIM IMPORT (G-12), against a real PostgreSQL.
 *
 * The last production blocker for Panel: Kuwick cannot start empty on the day
 * the clinic switches over, because the workbook holds thousands of open claims
 * and a third of them are unpaid.
 *
 * What these prove:
 *   - a dry run does the whole job and writes nothing
 *   - the totals it reports are the ones the panel dashboard will show, so the
 *     comparison against the workbook actually means something
 *   - a file with any problem imports NOTHING, and reports every problem
 *   - re-running an imported file is a no-op, not a doubling of the receivable
 *   - an imported claim has no invoice, and the database says when that is
 *     allowed rather than the invariant being dropped
 *   - what an imported claim cannot do, it refuses to do
 */
describe('Panel: importing the claim workbook (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let panelId: string;
  let ownerStaffId: string;

  const HEADERS =
    'Claim No,Service Date,Patient Reference,Claimed Amount (RM),Fee Amount (RM),Status,Submitted Date,Adjudicated Date,Approved Amount (RM),Rejected Amount (RM),Rejection Reason,Paid Amount (RM),Paid Date,Remarks';

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
      tx.tenant.create({ data: { id: tenantId, name: 'Import Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;
    ownerStaffId = owner.staffId;

    const panel = await withTenantContext(prisma, tenantId, (tx) =>
      tx.panelClinic.create({
        data: {
          tenantId,
          name: 'LegacyCare',
          code: 'LGC',
          paymentTermDays: 30,
          claimFeeType: 'PERCENT',
          claimFeeValue: 8,
          feeTreatment: 'WITHHELD_FROM_CLAIM',
        },
      }),
    );
    panelId = panel.id;
  });

  const importClaims = (csv: string, extra: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/panel-workspace/import/claims')
      .set('Authorization', bearer)
      .send({ panelClinicId: panelId, csv, ...extra });

  /** Two open claims: RM100 and RM200, each with the panel's 8% fee. */
  const TWO_OPEN = [
    HEADERS,
    'LGC-001,2025-11-04,FILE-1,100.00,8.00,SUBMITTED,2025-11-06,,,,,,,',
    'LGC-002,2025-11-05,FILE-2,200.00,16.00,SUBMITTED,2025-11-06,,,,,,,',
  ].join('\n');

  // -------------------------------------------------------------------------
  it('a dry run does the whole job, reports the money, and writes nothing', async () => {
    const { body } = await importClaims(TWO_OPEN).expect(201);

    expect(body.dryRun).toBe(true);
    expect(body.importable).toBe(2);
    expect(body.problems).toEqual([]);
    // RM300 claimed, RM24 withheld → RM276 is what should arrive. This is the
    // figure the clinic compares against the workbook's own TOTAL row, and it
    // comes from the same computeClaimBalance the dashboard uses.
    expect(body.totals.claimed).toBe(300);
    expect(body.totals.fee).toBe(24);
    expect(body.totals.expectedReceivable).toBe(276);
    expect(body.totals.received).toBe(0);
    expect(body.totals.outstanding).toBe(276);

    const written = await withTenantContext(prisma, tenantId, (tx) => tx.claimBatchLine.count());
    expect(written).toBe(0);
  });

  it('a file with any problem imports NOTHING, even when told to commit', async () => {
    const broken = [
      HEADERS,
      'LGC-001,2025-11-04,FILE-1,100.00,8.00,SUBMITTED,2025-11-06,,,,,,,',
      'LGC-002,4/11/25,FILE-2,200.00,16.00,SUBMITTED,2025-11-06,,,,,,,',
      'LGC-003,2025-11-06,FILE-3,50.00,4.00,PAID,2025-11-07,2025-11-20,46.00,,,,,',
    ].join('\n');

    const { body } = await importClaims(broken, { commit: true }).expect(201);
    expect(body.dryRun).toBe(true);
    // Both problems at once: one pass through the spreadsheet, not two.
    expect(body.problems).toHaveLength(2);
    expect(body.problems.map((p: { line: number }) => p.line)).toEqual([3, 4]);

    const written = await withTenantContext(prisma, tenantId, (tx) => tx.claimBatchLine.count());
    expect(written).toBe(0);
  });

  it('commits the claims with no invoice, traceable to the import that brought them', async () => {
    const { body } = await importClaims(TWO_OPEN, {
      commit: true,
      fileName: '2025-panel-claims.csv',
      note: 'Cutover load',
    }).expect(201);

    expect(body.dryRun).toBe(false);
    expect(body.importBatchId).toBeTruthy();

    const lines = await withTenantContext(prisma, tenantId, (tx) =>
      tx.claimBatchLine.findMany({ orderBy: { panelClaimNo: 'asc' } }),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].invoiceId).toBeNull();
    expect(lines[0].importBatchId).toBe(body.importBatchId);
    expect(lines[0].legacyPatientReference).toBe('FILE-1');
    expect(lines[0].legacyServiceDate?.toISOString().slice(0, 10)).toBe('2025-11-04');
    // FROM THE PANEL, not the file: a treatment typed into a spreadsheet is a
    // second source of truth for something the configuration already owns.
    expect(lines[0].feeTreatment).toBe('WITHHELD_FROM_CLAIM');

    const batches = await request(app.getHttpServer())
      .get(`/panel-workspace/import/batches?panelClinicId=${panelId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(batches.body[0]).toMatchObject({
      fileName: '2025-panel-claims.csv',
      importedCount: 2,
      skippedCount: 0,
      claimedTotal: 300,
      expectedTotal: 276,
      outstandingTotal: 276,
      note: 'Cutover load',
    });
  });

  it('the imported money reaches the panel dashboard as the dry run said it would', async () => {
    await importClaims(TWO_OPEN, { commit: true }).expect(201);

    const recon = await request(app.getHttpServer())
      .get(`/panel-workspace/reconciliation?panelClinicId=${panelId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(recon.body.totals.claimed).toBe(300);
    expect(recon.body.totals.expectedReceivable).toBe(276);
    expect(recon.body.totals.outstanding).toBe(276);
    expect(recon.body.reconciles).toBe(true);
  });

  it('re-running the same file imports nothing rather than doubling the receivable', async () => {
    await importClaims(TWO_OPEN, { commit: true }).expect(201);

    const again = await importClaims(TWO_OPEN, { commit: true }).expect(201);
    expect(again.body.importable).toBe(0);
    expect(again.body.alreadyPresent).toBe(2);
    expect(again.body.importBatchId).toBeUndefined();

    const count = await withTenantContext(prisma, tenantId, (tx) => tx.claimBatchLine.count());
    expect(count).toBe(2);
  });

  it('imports only the new rows when a corrected file is re-uploaded', async () => {
    await importClaims(TWO_OPEN, { commit: true }).expect(201);

    const corrected = [TWO_OPEN, 'LGC-003,2025-11-08,FILE-3,50.00,4.00,SUBMITTED,2025-11-09,,,,,,,'].join('\n');
    const { body } = await importClaims(corrected, { commit: true }).expect(201);
    expect(body.importable).toBe(1);
    expect(body.alreadyPresent).toBe(2);
    expect(body.totals.claimed).toBe(50);

    const count = await withTenantContext(prisma, tenantId, (tx) => tx.claimBatchLine.count());
    expect(count).toBe(3);
  });

  it('carries a settled claim in with its money, so the outstanding figure is right on day one', async () => {
    const mixed = [
      HEADERS,
      'LGC-010,2025-10-02,FILE-10,120.00,9.60,PAID,2025-10-03,2025-10-14,110.40,,,110.40,2025-10-30,',
      'LGC-011,2025-10-18,FILE-11,220.00,17.60,PARTIALLY_PAID,2025-10-20,2025-11-02,180.00,22.40,Cap exceeded,120.00,2025-11-20,Balance chased',
    ].join('\n');

    const { body } = await importClaims(mixed, { commit: true }).expect(201);
    expect(body.totals.received).toBe(230.4);
    // 110.40 settled in full; 180 approved on the second with 120 received.
    expect(body.totals.outstanding).toBe(60);

    const recon = await request(app.getHttpServer())
      .get(`/panel-workspace/reconciliation?panelClinicId=${panelId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(recon.body.totals.received).toBe(230.4);
    expect(recon.body.totals.outstanding).toBe(60);
  });

  it('refuses to charge an imported claim to a patient, because there is no invoice to move it onto', async () => {
    const rejected = [
      HEADERS,
      'LGC-020,2025-09-02,FILE-20,90.00,7.20,REJECTED,2025-09-03,2025-09-20,0,82.80,Member limit exhausted,,,',
    ].join('\n');
    await importClaims(rejected, { commit: true }).expect(201);
    const [line] = await withTenantContext(prisma, tenantId, (tx) => tx.claimBatchLine.findMany());

    const response = await request(app.getHttpServer())
      .patch(`/panel-workspace/claims/${line.id}/charge-to-patient`)
      .set('Authorization', bearer)
      .send({ amount: '82.80', reason: 'Patient will self-pay' })
      .expect(400);
    expect(response.body.message).toMatch(/no Kuwick invoice/i);
  });

  it('the database refuses a claim with neither an invoice nor an import behind it', async () => {
    // The invariant was not dropped when the invoice became nullable. It was
    // stated precisely: a claim Kuwick raises has an invoice, and a claim
    // without one came from a named import.
    const batch = await withTenantContext(prisma, tenantId, (tx) =>
      tx.claimBatch.create({
        data: {
          tenantId,
          panelClinicId: panelId,
          batchNumber: `ORPHAN-${Date.now()}`,
          createdByStaffId: ownerStaffId,
        },
      }),
    );
    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.claimBatchLine.create({
          data: { tenantId, claimBatchId: batch.id, claimedAmount: 10, feeAmount: 0 },
        }),
      ),
    ).rejects.toThrow(/claim_batch_lines_invoice_or_import|constraint/i);
  });

  it('serves the template, and the template is a file the importer accepts', async () => {
    const template = await request(app.getHttpServer())
      .get('/panel-workspace/import/template')
      .set('Authorization', bearer)
      .expect(200);
    const csv = typeof template.body === 'string' ? template.body : template.text;

    const { body } = await importClaims(csv).expect(201);
    expect(body.problems).toEqual([]);
    expect(body.importable).toBe(3);
  });
});
