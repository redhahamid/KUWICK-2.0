import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

/**
 * WAVE 2 — the stock ledger, against a real PostgreSQL.
 *
 * The four rules these prove, each of which the owner brief states and each of
 * which is impossible to verify without a database:
 *
 *   1. A transfer moves stock in TWO steps — out at send, in at receive — so
 *      goods in transit are on neither shelf.
 *   2. The SENDER cannot decide what the receiver counted, and a difference
 *      needs a reason.
 *   3. Counting changes NO live stock. A stock take posts once, at approval.
 *   4. The person who counted cannot approve their own count.
 */
describe('Stock: transfers and stock takes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let ownerStaffId: string;
  let branchA: string;
  let branchB: string;
  let itemId: string;

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

  // No afterEach cleanup — `stock_movements` is append-only and enforced.
  // Every test uses a fresh random tenant; kuwick_test is disposable.

  beforeEach(async () => {
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Stock Tenant' } }));
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;
    ownerStaffId = owner.staffId;

    const a = await request(app.getHttpServer()).post('/clinics').set('Authorization', bearer).send({ name: 'Branch A' }).expect(201);
    const b = await request(app.getHttpServer()).post('/clinics').set('Authorization', bearer).send({ name: 'Branch B' }).expect(201);
    branchA = a.body.id;
    branchB = b.body.id;

    const item = await request(app.getHttpServer())
      .post('/items')
      .set('Authorization', bearer)
      .send({ name: 'Amoxicillin 500mg', sellPrice: 2.5, cost: 1.2 })
      .expect(201);
    itemId = item.body.id;

    // 100 units on Branch A's shelf.
    await request(app.getHttpServer())
      .post('/stock/quick-add')
      .set('Authorization', bearer)
      .send({ clinicId: branchA, itemId, quantity: 100 })
      .expect(201);
  });

  async function levelAt(clinicId: string): Promise<number> {
    const level = await withTenantContext(prisma, tenantId, (tx) =>
      tx.stockLevel.findFirst({ where: { clinicId, itemId } }),
    );
    return level?.quantityOnHand ?? 0;
  }

  // -------------------------------------------------------------------------
  describe('transfers', () => {
    it('moves stock in two steps: out at send, in at receive', async () => {
      const transfer = await request(app.getHttpServer())
        .post('/stock-admin/transfers')
        .set('Authorization', bearer)
        .send({ fromClinicId: branchA, toClinicId: branchB, lines: [{ itemId, quantity: 30 }] })
        .expect(201);

      // A draft moves nothing.
      expect(await levelAt(branchA)).toBe(100);
      expect(await levelAt(branchB)).toBe(0);

      await request(app.getHttpServer())
        .patch(`/stock-admin/transfers/${transfer.body.id}/send`)
        .set('Authorization', bearer)
        .expect(200);

      // IN TRANSIT: gone from A, not yet at B. This is the state that a
      // single-step implementation cannot represent.
      expect(await levelAt(branchA)).toBe(70);
      expect(await levelAt(branchB)).toBe(0);

      await request(app.getHttpServer())
        .patch(`/stock-admin/transfers/${transfer.body.id}/receive`)
        .set('Authorization', bearer)
        .send({ lines: [{ lineId: transfer.body.lines[0].id, quantityReceived: 30 }] })
        .expect(200)
        .expect((res) => expect(res.body.status).toBe('RECEIVED'));

      expect(await levelAt(branchA)).toBe(70);
      expect(await levelAt(branchB)).toBe(30);
    });

    it('refuses a short receipt with no explanation, and records the discrepancy when given one', async () => {
      const transfer = await request(app.getHttpServer())
        .post('/stock-admin/transfers')
        .set('Authorization', bearer)
        .send({ fromClinicId: branchA, toClinicId: branchB, lines: [{ itemId, quantity: 30 }] })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/stock-admin/transfers/${transfer.body.id}/send`)
        .set('Authorization', bearer)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/stock-admin/transfers/${transfer.body.id}/receive`)
        .set('Authorization', bearer)
        .send({ lines: [{ lineId: transfer.body.lines[0].id, quantityReceived: 28 }] })
        .expect(400);

      await request(app.getHttpServer())
        .patch(`/stock-admin/transfers/${transfer.body.id}/receive`)
        .set('Authorization', bearer)
        .send({
          lines: [
            { lineId: transfer.body.lines[0].id, quantityReceived: 28, discrepancyReason: 'Two strips crushed in transit' },
          ],
        })
        .expect(200)
        .expect((res) => expect(res.body.status).toBe('RECEIVED_WITH_DISCREPANCY'));

      // THE MISSING TWO STAY MISSING. They left A and never reached B; putting
      // them back would hide exactly the loss this workflow surfaces.
      expect(await levelAt(branchA)).toBe(70);
      expect(await levelAt(branchB)).toBe(28);

      const list = await request(app.getHttpServer())
        .get(`/stock-admin/transfers?clinicId=${branchA}`)
        .set('Authorization', bearer)
        .expect(200);
      expect(list.body[0].discrepancyCount).toBe(1);
      expect(list.body[0].lines[0].discrepancy).toBe(-2);
      // And the SENDER's number is untouched — that is the rule.
      expect(list.body[0].lines[0].quantitySent).toBe(30);
    });

    it('refuses a transfer to the same branch, at the database as well as the service', async () => {
      await request(app.getHttpServer())
        .post('/stock-admin/transfers')
        .set('Authorization', bearer)
        .send({ fromClinicId: branchA, toClinicId: branchA, lines: [{ itemId, quantity: 5 }] })
        .expect(400);

      await expect(
        withTenantContext(prisma, tenantId, (tx) =>
          tx.stockTransfer.create({
            data: {
              tenantId,
              transferNumber: 'TRF-SNEAKY',
              fromClinicId: branchA,
              toClinicId: branchA,
              createdByStaffId: ownerStaffId,
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it('cannot be sent twice', async () => {
      const transfer = await request(app.getHttpServer())
        .post('/stock-admin/transfers')
        .set('Authorization', bearer)
        .send({ fromClinicId: branchA, toClinicId: branchB, lines: [{ itemId, quantity: 10 }] })
        .expect(201);
      await request(app.getHttpServer()).patch(`/stock-admin/transfers/${transfer.body.id}/send`).set('Authorization', bearer).expect(200);
      await request(app.getHttpServer()).patch(`/stock-admin/transfers/${transfer.body.id}/send`).set('Authorization', bearer).expect(409);
      expect(await levelAt(branchA)).toBe(90);
    });
  });

  // -------------------------------------------------------------------------
  describe('stock takes', () => {
    async function counterBearer(): Promise<{ staffId: string; bearer: string }> {
      const staff = await withTenantContext(prisma, tenantId, async (tx) => {
        const created = await tx.staff.create({
          data: { tenantId, role: Role.STOCK_STAFF, fullName: 'Stock Counter', clinicId: branchA },
        });
        return created;
      });
      return { staffId: staff.id, bearer: bearerFor(tenantId, staff.id, Role.STOCK_STAFF) };
    }

    it('counting changes NO live stock — the correction posts once, at approval', async () => {
      const counter = await counterBearer();

      const take = await request(app.getHttpServer())
        .post('/stock-admin/stock-takes')
        .set('Authorization', counter.bearer)
        .send({ clinicId: branchA, name: 'August count' })
        .expect(201);
      const lineId = take.body.lines[0].id;

      await request(app.getHttpServer())
        .patch(`/stock-admin/stock-takes/${take.body.id}/counts`)
        .set('Authorization', counter.bearer)
        .send({ counts: [{ lineId, quantity: 94, varianceReason: 'Six missing from the shelf' }] })
        .expect(200);

      // THE RULE: a typed count is not a stock change.
      expect(await levelAt(branchA)).toBe(100);

      await request(app.getHttpServer())
        .patch(`/stock-admin/stock-takes/${take.body.id}/submit`)
        .set('Authorization', counter.bearer)
        .expect(200);
      expect(await levelAt(branchA)).toBe(100);

      // A stock clerk may count and submit, but may NOT approve.
      await request(app.getHttpServer())
        .patch(`/stock-admin/stock-takes/${take.body.id}/approve`)
        .set('Authorization', counter.bearer)
        .send({})
        .expect(403);
      expect(await levelAt(branchA)).toBe(100);

      await request(app.getHttpServer())
        .patch(`/stock-admin/stock-takes/${take.body.id}/approve`)
        .set('Authorization', bearer)
        .send({})
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('POSTED');
          // 6 units × RM1.20 cost, written off.
          expect(Number(res.body.varianceValue)).toBeCloseTo(-7.2, 2);
        });

      expect(await levelAt(branchA)).toBe(94);

      // And the correction is on the same ledger as everything else.
      const movements = await withTenantContext(prisma, tenantId, (tx) =>
        tx.stockMovement.findMany({ where: { tenantId, movementType: 'STOCK_TAKE' } }),
      );
      expect(movements).toHaveLength(1);
      expect(movements[0].quantityDelta).toBe(-6);
      expect(movements[0].adjustmentReason).toBe('COUNT_CORRECTION');
      expect(movements[0].referenceId).toBe(take.body.id);
    });

    it('refuses approval by the person who submitted the count', async () => {
      const take = await request(app.getHttpServer())
        .post('/stock-admin/stock-takes')
        .set('Authorization', bearer)
        .send({ clinicId: branchA, name: 'Owner counts and tries to approve' })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/stock-admin/stock-takes/${take.body.id}/counts`)
        .set('Authorization', bearer)
        .send({ counts: [{ lineId: take.body.lines[0].id, quantity: 90 }] })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/stock-admin/stock-takes/${take.body.id}/submit`)
        .set('Authorization', bearer)
        .expect(200);

      // Even an OWNER, who holds the permission, cannot sign off their own sheet.
      await request(app.getHttpServer())
        .patch(`/stock-admin/stock-takes/${take.body.id}/approve`)
        .set('Authorization', bearer)
        .send({})
        .expect(403);
      expect(await levelAt(branchA)).toBe(100);
    });

    it('refuses to submit a sheet with uncounted lines', async () => {
      await request(app.getHttpServer())
        .post('/items')
        .set('Authorization', bearer)
        .send({ name: 'Second Item', sellPrice: 5 })
        .expect(201)
        .then((res) =>
          request(app.getHttpServer())
            .post('/stock/quick-add')
            .set('Authorization', bearer)
            .send({ clinicId: branchA, itemId: res.body.id, quantity: 10 })
            .expect(201),
        );

      const take = await request(app.getHttpServer())
        .post('/stock-admin/stock-takes')
        .set('Authorization', bearer)
        .send({ clinicId: branchA, name: 'Half a count' })
        .expect(201);
      expect(take.body.lines.length).toBe(2);

      await request(app.getHttpServer())
        .patch(`/stock-admin/stock-takes/${take.body.id}/counts`)
        .set('Authorization', bearer)
        .send({ counts: [{ lineId: take.body.lines[0].id, quantity: 100 }] })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/stock-admin/stock-takes/${take.body.id}/submit`)
        .set('Authorization', bearer)
        .expect(400);
    });

    it('refuses a second open take at the same branch', async () => {
      await request(app.getHttpServer())
        .post('/stock-admin/stock-takes')
        .set('Authorization', bearer)
        .send({ clinicId: branchA, name: 'First' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/stock-admin/stock-takes')
        .set('Authorization', bearer)
        .send({ clinicId: branchA, name: 'Second' })
        .expect(409);
    });
  });

  // -------------------------------------------------------------------------
  describe('adjustments and the ledger', () => {
    it('records a structured reason, an actor, and a before/after audit row', async () => {
      await request(app.getHttpServer())
        .post('/stock-admin/adjustments')
        .set('Authorization', bearer)
        .send({ clinicId: branchA, itemId, quantityDelta: -4, reason: 'EXPIRED', notes: 'Four bottles past expiry, disposed' })
        .expect(201)
        .expect((res) => {
          expect(res.body.quantityBefore).toBe(100);
          expect(res.body.quantityAfter).toBe(96);
        });

      const movement = await withTenantContext(prisma, tenantId, (tx) =>
        tx.stockMovement.findFirst({ where: { tenantId, movementType: 'EXPIRY' } }),
      );
      expect(movement?.adjustmentReason).toBe('EXPIRED');
      expect(movement?.createdByStaffId).toBe(ownerStaffId);

      const audit = await withTenantContext(prisma, tenantId, (tx) =>
        tx.auditLog.findMany({ where: { tenantId, action: 'stock.adjusted' } }),
      );
      expect(audit).toHaveLength(1);
      expect(audit[0].before).toMatchObject({ quantityOnHand: 100 });
      expect(audit[0].after).toMatchObject({ quantityOnHand: 96, delta: -4, reason: 'EXPIRED' });
    });

    it('the movement ledger cannot be edited or deleted', async () => {
      const movement = await withTenantContext(prisma, tenantId, (tx) =>
        tx.stockMovement.findFirst({ where: { tenantId } }),
      );
      // TWO layers, and the outer one answers first: the application role has
      // no UPDATE privilege on this table at all (provision-app-role.sql), so
      // the statement is refused before the trigger is reached. Either message
      // is the guarantee holding.
      await expect(
        withTenantContext(prisma, tenantId, (tx) =>
          tx.$executeRawUnsafe(`UPDATE stock_movements SET quantity_delta = 9999 WHERE id = '${movement!.id}'`),
        ),
      ).rejects.toThrow(/permission denied|append-only/);

      // Through Prisma's own API, which is how application code would do it.
      await expect(
        withTenantContext(prisma, tenantId, (tx) =>
          tx.stockMovement.update({ where: { id: movement!.id }, data: { quantityDelta: 9999 } }),
        ),
      ).rejects.toThrow();
      await expect(
        withTenantContext(prisma, tenantId, (tx) =>
          tx.$executeRawUnsafe(`DELETE FROM stock_movements WHERE id = '${movement!.id}'`),
        ),
      ).rejects.toThrow(/permission denied|append-only/);
    });

    it('the derived level always equals the sum of its movements', async () => {
      // The invariant that makes "stock is derived from an auditable ledger"
      // a true statement rather than a comment.
      await request(app.getHttpServer())
        .post('/stock-admin/adjustments')
        .set('Authorization', bearer)
        .send({ clinicId: branchA, itemId, quantityDelta: 15, reason: 'COUNT_CORRECTION' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/stock-admin/adjustments')
        .set('Authorization', bearer)
        .send({ clinicId: branchA, itemId, quantityDelta: -3, reason: 'WASTAGE' })
        .expect(201);

      const [level, sum] = await withTenantContext(prisma, tenantId, async (tx) => [
        await tx.stockLevel.findFirst({ where: { clinicId: branchA, itemId } }),
        await tx.stockMovement.aggregate({ where: { clinicId: branchA, itemId }, _sum: { quantityDelta: true } }),
      ]);
      expect(level!.quantityOnHand).toBe(sum._sum.quantityDelta);
      expect(level!.quantityOnHand).toBe(112);
    });

    it('reports exceptions with stated thresholds', async () => {
      await request(app.getHttpServer())
        .post('/stock-admin/adjustments')
        .set('Authorization', bearer)
        .send({ clinicId: branchA, itemId, quantityDelta: -150, reason: 'DATA_ENTRY_ERROR', notes: 'Deliberate negative for the test' })
        .expect(201);

      const exceptions = await request(app.getHttpServer())
        .get(`/stock-admin/exceptions?clinicId=${branchA}`)
        .set('Authorization', bearer)
        .expect(200);
      expect(exceptions.body.negativeStock).toBe(1);
      expect(exceptions.body.thresholds.slowMovingDays).toBe(90);

      const rows = await request(app.getHttpServer())
        .get(`/stock-admin/exceptions/negative?clinicId=${branchA}`)
        .set('Authorization', bearer)
        .expect(200);
      expect(rows.body[0].quantityOnHand).toBe(-50);
    });

    it('values stock at cost and labels potential selling value as not profit', async () => {
      const valuation = await request(app.getHttpServer())
        .get(`/stock-admin/valuation?clinicId=${branchA}`)
        .set('Authorization', bearer)
        .expect(200);
      expect(valuation.body.costingMethod).toBe('STANDARD_COST');
      expect(valuation.body.totalCostValue).toBeCloseTo(120, 2);
      expect(valuation.body.totalPotentialSelfPayValue).toBeCloseTo(250, 2);
      expect(valuation.body.potentialValueNote).toMatch(/not profit/i);
    });
  });
});
