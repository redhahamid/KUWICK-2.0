import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

// Covers the Inventory acceptance criterion PRODUCT_REQUIREMENTS.md §18
// gives (a partial goods-received entry must correctly reduce the
// outstanding PO quantity), the low-stock query the "same session"
// acceptance criterion depends on, and the negative-stock allowance +
// reconciliation report (docs/DECISIONS.md D-020).
describe('Inventory: goods-received receiving and stock rules (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;

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
      tx.tenant.create({ data: { id: tenantId, name: 'Inventory Test Tenant' } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    const clinic = await request(app.getHttpServer())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Inventory Test Clinic' })
      .expect(201);
    clinicId = clinic.body.id;
  });

  afterEach(async () => {
    await withTenantContext(prisma, tenantId, async (tx) => {
      await tx.goodsReceivedNoteLine.deleteMany({ where: { tenantId } });
      await tx.goodsReceivedNote.deleteMany({ where: { tenantId } });
      await tx.purchaseOrderLine.deleteMany({ where: { tenantId } });
      await tx.purchaseOrder.deleteMany({ where: { tenantId } });
      await tx.procurementRequest.deleteMany({ where: { tenantId } });
      await tx.stockMovement.deleteMany({ where: { tenantId } });
      await tx.stockBatch.deleteMany({ where: { tenantId } });
      await tx.stockLevel.deleteMany({ where: { tenantId } });
      await tx.item.deleteMany({ where: { tenantId } });
      await tx.supplier.deleteMany({ where: { tenantId } });
      await tx.clinic.deleteMany({ where: { tenantId } });
      await tx.staff.deleteMany({ where: { tenantId } });
      await tx.tenant.deleteMany({ where: { id: tenantId } });
    });
  });

  async function createItemAndSupplier() {
    const item = await request(app.getHttpServer())
      .post('/items')
      .set('Authorization', bearer)
      .send({ name: 'Paracetamol 500mg', sellPrice: 1.5 })
      .expect(201);
    const supplier = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', bearer)
      .send({ name: 'Test Pharma Supplier' })
      .expect(201);
    return { itemId: item.body.id as string, supplierId: supplier.body.id as string };
  }

  it('a partial goods-received entry reduces outstanding PO quantity without closing it, and full receipt closes it', async () => {
    const { itemId, supplierId } = await createItemAndSupplier();

    const po = await request(app.getHttpServer())
      .post('/purchase-orders')
      .set('Authorization', bearer)
      .send({ clinicId, supplierId, lines: [{ itemId, orderedQuantity: 10, unitCost: 2 }] })
      .expect(201);
    const lineId = po.body.lines[0].id;

    const firstReceive = await request(app.getHttpServer())
      .post(`/purchase-orders/${po.body.id}/receive`)
      .set('Authorization', bearer)
      .send({ clinicId, lines: [{ purchaseOrderLineId: lineId, quantityReceived: 4, batchNumber: 'B1' }] })
      .expect(201);
    expect(firstReceive.body.lines).toHaveLength(1);

    const poAfterFirst = await request(app.getHttpServer())
      .get(`/purchase-orders/${po.body.id}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(poAfterFirst.body.status).toBe('PARTIALLY_RECEIVED');
    expect(poAfterFirst.body.lines[0].receivedQuantity).toBe(4);

    let levels = await request(app.getHttpServer())
      .get(`/stock/levels?clinicId=${clinicId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(levels.body.find((l: { itemId: string }) => l.itemId === itemId).quantityOnHand).toBe(4);

    // Over-receiving beyond what's outstanding must be rejected, not
    // silently allowed to overshoot the ordered quantity.
    await request(app.getHttpServer())
      .post(`/purchase-orders/${po.body.id}/receive`)
      .set('Authorization', bearer)
      .send({ clinicId, lines: [{ purchaseOrderLineId: lineId, quantityReceived: 10 }] })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/purchase-orders/${po.body.id}/receive`)
      .set('Authorization', bearer)
      .send({ clinicId, lines: [{ purchaseOrderLineId: lineId, quantityReceived: 6, batchNumber: 'B2' }] })
      .expect(201);

    const poAfterFull = await request(app.getHttpServer())
      .get(`/purchase-orders/${po.body.id}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(poAfterFull.body.status).toBe('FULLY_RECEIVED');
    expect(poAfterFull.body.lines[0].receivedQuantity).toBe(10);

    levels = await request(app.getHttpServer())
      .get(`/stock/levels?clinicId=${clinicId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(levels.body.find((l: { itemId: string }) => l.itemId === itemId).quantityOnHand).toBe(10);
  });

  it('low-stock query returns only items below their configured minimum threshold, in the same session as receiving', async () => {
    const { itemId, supplierId } = await createItemAndSupplier();

    await request(app.getHttpServer())
      .post('/stock/min-threshold')
      .set('Authorization', bearer)
      .send({ clinicId, itemId, minThreshold: 5 })
      .expect(201);

    let lowStock = await request(app.getHttpServer())
      .get(`/stock/low-stock?clinicId=${clinicId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(lowStock.body.map((l: { itemId: string }) => l.itemId)).toContain(itemId);

    const po = await request(app.getHttpServer())
      .post('/purchase-orders')
      .set('Authorization', bearer)
      .send({ clinicId, supplierId, lines: [{ itemId, orderedQuantity: 5, unitCost: 2 }] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/purchase-orders/${po.body.id}/receive`)
      .set('Authorization', bearer)
      .send({ clinicId, lines: [{ purchaseOrderLineId: po.body.lines[0].id, quantityReceived: 5 }] })
      .expect(201);

    lowStock = await request(app.getHttpServer())
      .get(`/stock/low-stock?clinicId=${clinicId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(lowStock.body.map((l: { itemId: string }) => l.itemId)).not.toContain(itemId);
  });

  it('a stock level is allowed to go negative — dispensing must not block on system stock catching up (D-020)', async () => {
    const { itemId } = await createItemAndSupplier();

    const level = await withTenantContext(prisma, tenantId, (tx) =>
      tx.stockLevel.create({ data: { tenantId, clinicId, itemId, quantityOnHand: 0, minThreshold: 0 } }),
    );

    const updated = await withTenantContext(prisma, tenantId, (tx) =>
      tx.stockLevel.update({ where: { id: level.id }, data: { quantityOnHand: -1 } }),
    );
    expect(updated.quantityOnHand).toBe(-1);
  });

  it('the negative-stock report lists only rows below zero, for admin reconciliation', async () => {
    const { itemId } = await createItemAndSupplier();
    const { itemId: otherItemId } = await createItemAndSupplier();

    await withTenantContext(prisma, tenantId, (tx) =>
      tx.stockLevel.create({ data: { tenantId, clinicId, itemId, quantityOnHand: -3, minThreshold: 0 } }),
    );
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.stockLevel.create({ data: { tenantId, clinicId, itemId: otherItemId, quantityOnHand: 5, minThreshold: 0 } }),
    );

    const negativeStock = await request(app.getHttpServer())
      .get(`/stock/negative-stock?clinicId=${clinicId}`)
      .set('Authorization', bearer)
      .expect(200);

    const itemIds = negativeStock.body.map((level: { itemId: string }) => level.itemId);
    expect(itemIds).toContain(itemId);
    expect(itemIds).not.toContain(otherItemId);
  });
});
