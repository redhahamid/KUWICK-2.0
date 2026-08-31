import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * THE STOCK OPERATING MODEL, against a real PostgreSQL.
 *
 * Four things the clinic's own workbooks do that Kuwick could not
 * (`docs/STOCK_LEGACY_WORKFLOW_AUDIT.md`):
 *
 *   - ask for an item that does not exist yet, and have somebody APPROVE it —
 *     with a duplicate check, which the five-column sheet has never had
 *   - activate an item when stock ARRIVES, not when it is ordered
 *   - pay `MIN(unit price, bonus price)` — a real supplier pricing rule
 *   - record the price change AT GOODS-IN, with who and when
 */
describe('Stock: the operating model behind the workbooks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let supplierId: string;

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
      tx.tenant.create({ data: { id: tenantId, name: 'Stock Model Tenant' } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    const clinic = await request(app.getHttpServer())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Stock Model Clinic' })
      .expect(201);
    clinicId = clinic.body.id;
    const supplier = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', bearer)
      .send({ name: 'Model Pharma' })
      .expect(201);
    supplierId = supplier.body.id;
  });

  const raise = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/new-item-requests').set('Authorization', bearer).send(body);

  it('takes a request through approval into a catalogue entry that is NOT yet usable', async () => {
    const raised = await raise({
      requestedName: 'Semaglutide 0.25mg pen',
      reason: 'Two patients started on it at the hospital and we cannot continue their treatment.',
      packSizeNote: '1 pen = 4 doses',
      suggestedSupplierId: supplierId,
    }).expect(201);
    expect(raised.body.status).toBe('PENDING');
    expect(raised.body.possibleDuplicate).toBeNull();

    const approved = await request(app.getHttpServer())
      .patch(`/new-item-requests/${raised.body.id}/approve`)
      .set('Authorization', bearer)
      .send({ sellPrice: '420.00', cost: '315.00', unitOfMeasure: 'Pen', category: 'Weight Management' })
      .expect(200);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.note).toMatch(/NOT usable yet/i);

    // The item exists, and cannot be used. That is the whole point: ordering is
    // a promise, arriving is a fact.
    const item = await withTenantContext(prisma, tenantId, (tx) =>
      tx.item.findUnique({ where: { id: approved.body.itemId } }),
    );
    expect(item!.active).toBe(false);
    expect(item!.awaitingFirstReceipt).toBe(true);
    expect(item!.activatedAt).toBeNull();
    expect(Number(item!.sellPrice)).toBe(420);

    // Its opening price is the first row of a history, not a value with no past.
    const history = await request(app.getHttpServer())
      .get(`/new-item-requests/items/${approved.body.itemId}/price-history`)
      .set('Authorization', bearer)
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].source).toBe('NEW_ITEM_REQUEST');
    expect(history.body[0].newCost).toBe(315);
    expect(history.body[0].changedBy).toBeTruthy();
  });

  it('refuses to create a second entry for a medicine the catalogue already has', async () => {
    await request(app.getHttpServer())
      .post('/items')
      .set('Authorization', bearer)
      .send({ name: 'Amoxicillin 500mg Capsule', sellPrice: 0.8 })
      .expect(201);

    const raised = await raise({
      requestedName: 'amoxicillin 250mg caps',
      reason: 'The paediatric dose is not in the catalogue and we keep writing it by hand.',
    }).expect(201);
    // Flagged at REQUEST time, which is the cheapest moment to catch it.
    expect(raised.body.possibleDuplicate).not.toBeNull();

    // And refused at approval, until somebody deliberately says otherwise.
    await request(app.getHttpServer())
      .patch(`/new-item-requests/${raised.body.id}/approve`)
      .set('Authorization', bearer)
      .send({ sellPrice: '0.80' })
      .expect(409);

    const forced = await request(app.getHttpServer())
      .patch(`/new-item-requests/${raised.body.id}/approve`)
      .set('Authorization', bearer)
      .send({ sellPrice: '0.80', acknowledgeDuplicate: true, decisionNote: 'Different strength, kept separate.' })
      .expect(200);
    expect(forced.body.status).toBe('APPROVED');
  });

  it('a rejection has to say why, and a decided request cannot be decided twice', async () => {
    const raised = await raise({
      requestedName: 'Something we do not stock',
      reason: 'A representative left samples and asked whether we would carry it.',
    }).expect(201);

    await request(app.getHttpServer())
      .patch(`/new-item-requests/${raised.body.id}/reject`)
      .set('Authorization', bearer)
      .send({ decisionNote: 'no' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/new-item-requests/${raised.body.id}/reject`)
      .set('Authorization', bearer)
      .send({ decisionNote: 'Not on any panel formulary; patients would pay privately for all of it.' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/new-item-requests/${raised.body.id}/approve`)
      .set('Authorization', bearer)
      .send({ sellPrice: '10.00' })
      .expect(409);
  });

  it('pays MIN(unit, bonus), and an absent promotion is not a promotion of zero', async () => {
    const item = await request(app.getHttpServer())
      .post('/items')
      .set('Authorization', bearer)
      .send({ name: 'Promo Test Item', sellPrice: 12 })
      .expect(201);

    const po = await request(app.getHttpServer())
      .post('/purchase-orders')
      .set('Authorization', bearer)
      .send({
        clinicId,
        supplierId,
        lines: [{ itemId: item.body.id, orderedQuantity: 90, unitCost: 6.84, bonusUnitCost: 5.8 }],
      })
      .expect(201);

    // Received with no explicit cost: the effective ordered price applies, and
    // that is the promotion, not the list price.
    await request(app.getHttpServer())
      .post(`/purchase-orders/${po.body.id}/receive`)
      .set('Authorization', bearer)
      .send({ clinicId, lines: [{ purchaseOrderLineId: po.body.lines[0].id, quantityReceived: 90 }] })
      .expect(201);

    const stored = await withTenantContext(prisma, tenantId, (tx) =>
      tx.item.findUnique({ where: { id: item.body.id }, select: { cost: true } }),
    );
    expect(Number(stored!.cost)).toBe(5.8);
  });

  it('captures the price change at goods-in, with who and when, and cannot be edited afterwards', async () => {
    const item = await request(app.getHttpServer())
      .post('/items')
      .set('Authorization', bearer)
      .send({ name: 'Cost Movement Item', sellPrice: 12, cost: 4.0 })
      .expect(201);

    const po = await request(app.getHttpServer())
      .post('/purchase-orders')
      .set('Authorization', bearer)
      .send({ clinicId, supplierId, lines: [{ itemId: item.body.id, orderedQuantity: 10, unitCost: 4.0 }] })
      .expect(201);

    // Arrives at a different price from the one ordered — which is the case the
    // clinic's "old price / new price" columns exist for.
    await request(app.getHttpServer())
      .post(`/purchase-orders/${po.body.id}/receive`)
      .set('Authorization', bearer)
      .send({
        clinicId,
        lines: [{ purchaseOrderLineId: po.body.lines[0].id, quantityReceived: 10, unitCost: 4.6 }],
      })
      .expect(201);

    const history = await request(app.getHttpServer())
      .get(`/new-item-requests/items/${item.body.id}/price-history`)
      .set('Authorization', bearer)
      .expect(200);
    const atReceipt = history.body.find((h: { source: string }) => h.source === 'GOODS_RECEIPT');
    expect(atReceipt.previousCost).toBe(4);
    expect(atReceipt.newCost).toBe(4.6);
    expect(atReceipt.receivedAt).toBeTruthy();

    const stored = await withTenantContext(prisma, tenantId, (tx) =>
      tx.item.findUnique({ where: { id: item.body.id }, select: { cost: true } }),
    );
    expect(Number(stored!.cost)).toBe(4.6);

    // A price history somebody can edit is a history that will be edited to
    // match whatever number is under dispute.
    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.$executeRawUnsafe(`UPDATE item_price_changes SET new_cost = 1 WHERE id = '${atReceipt.id}'`),
      ),
    ).rejects.toThrow(/append-only|permission denied/i);
  });

  it('activates an approved item the moment its first delivery arrives', async () => {
    const raised = await raise({
      requestedName: 'Activation Test Medicine',
      reason: 'Needed for a new clinic service starting next month.',
    }).expect(201);
    const approved = await request(app.getHttpServer())
      .patch(`/new-item-requests/${raised.body.id}/approve`)
      .set('Authorization', bearer)
      .send({ sellPrice: '25.00', cost: '18.00' })
      .expect(200);

    const po = await request(app.getHttpServer())
      .post('/purchase-orders')
      .set('Authorization', bearer)
      .send({ clinicId, supplierId, lines: [{ itemId: approved.body.itemId, orderedQuantity: 5, unitCost: 18 }] })
      .expect(201);

    // Still not usable while it is only on order.
    let item = await withTenantContext(prisma, tenantId, (tx) =>
      tx.item.findUnique({ where: { id: approved.body.itemId } }),
    );
    expect(item!.active).toBe(false);

    const received = await request(app.getHttpServer())
      .post(`/purchase-orders/${po.body.id}/receive`)
      .set('Authorization', bearer)
      .send({ clinicId, lines: [{ purchaseOrderLineId: po.body.lines[0].id, quantityReceived: 5 }] })
      .expect(201);
    expect(received.body.activatedItemIds).toContain(approved.body.itemId);

    item = await withTenantContext(prisma, tenantId, (tx) =>
      tx.item.findUnique({ where: { id: approved.body.itemId } }),
    );
    expect(item!.active).toBe(true);
    expect(item!.awaitingFirstReceipt).toBe(false);
    expect(item!.activatedAt).not.toBeNull();
  });
});
