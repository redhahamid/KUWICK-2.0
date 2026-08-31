import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * ACCOUNTS PAYABLE, against a real PostgreSQL.
 *
 * The gap these close: Kuwick could say what was ordered and what arrived, and
 * then had no answer at all to "what do we owe suppliers" — which is why the
 * clinic keeps a payable listing with one sheet per supplier, thirty of them,
 * whose own roll-up sums the payment-date column instead of the balance column.
 *
 * What these prove:
 *   - the outstanding figure is DERIVED from allocated payments, so it cannot
 *     be typed wrong or drift from the bank
 *   - a payment must say which invoices it settled, exactly
 *   - an invoice cannot be entered twice, and cannot be overpaid
 *   - no supplier term means NO due date — not an assumed thirty days
 *   - PAID is derived, never declared
 *   - a disputed invoice is held out of "what must I pay this week"
 */
describe('Finance: accounts payable (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let supplierId: string;
  let untermedSupplierId: string;

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
      tx.tenant.create({ data: { id: tenantId, name: 'Payables Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;

    const [withTerms, without] = await withTenantContext(prisma, tenantId, (tx) =>
      Promise.all([
        tx.supplier.create({
          data: { tenantId, name: 'Pharma Supply', paymentTermDays: 30, creditLimitAmount: 5000 },
        }),
        tx.supplier.create({ data: { tenantId, name: 'Unrecorded Terms Sdn Bhd' } }),
      ]),
    );
    supplierId = withTerms.id;
    untermedSupplierId = without.id;
  });

  const enter = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/finance/payables/invoices').set('Authorization', bearer).send(body);

  it('derives the due date from the supplier term — and refuses to invent one when there is none', async () => {
    const dated = await enter({
      supplierId,
      invoiceNumber: 'PS-1001',
      invoiceDate: '2026-08-01',
      totalAmount: '1250.00',
    }).expect(201);
    expect(String(dated.body.dueDate).slice(0, 10)).toBe('2026-08-31');
    expect(dated.body.dueDateUnknownReason).toBeNull();

    const undated = await enter({
      supplierId: untermedSupplierId,
      invoiceNumber: 'UT-1',
      invoiceDate: '2026-08-01',
      totalAmount: '400.00',
    }).expect(201);
    // Not "30 days by default" — the honest answer is that nobody has said.
    expect(undated.body.dueDate).toBeNull();
    expect(undated.body.dueDateUnknownReason).toMatch(/No payment term is configured/i);
  });

  it('refuses the same invoice number twice for the same supplier, and allows it across suppliers', async () => {
    await enter({ supplierId, invoiceNumber: 'INV-001', invoiceDate: '2026-08-01', totalAmount: '100.00' }).expect(201);
    // Entering it twice is how a supplier gets paid twice.
    await enter({ supplierId, invoiceNumber: 'INV-001', invoiceDate: '2026-08-01', totalAmount: '100.00' }).expect(409);
    // Two suppliers both issuing "INV-001" is ordinary and must not be rejected.
    await enter({
      supplierId: untermedSupplierId,
      invoiceNumber: 'INV-001',
      invoiceDate: '2026-08-01',
      totalAmount: '100.00',
    }).expect(201);
  });

  it('answers "what do we owe", and derives it from allocations rather than a typed column', async () => {
    const a = await enter({ supplierId, invoiceNumber: 'A-1', invoiceDate: '2026-07-01', totalAmount: '1000.00' });
    const b = await enter({ supplierId, invoiceNumber: 'A-2', invoiceDate: '2026-08-25', totalAmount: '500.00' });

    let payables = await request(app.getHttpServer())
      .get('/finance/payables?asOf=2026-08-31')
      .set('Authorization', bearer)
      .expect(200);
    expect(payables.body.totals.outstanding).toBe(1500);
    // A-1 was due 31 July on a 30-day term, so it is overdue on 31 August.
    expect(payables.body.totals.overdue).toBe(1000);
    // A-2 is due 24 September — neither overdue nor inside the next 7 days.
    expect(payables.body.totals.dueThisWeek).toBe(0);

    // One transfer settles both, partially.
    await request(app.getHttpServer())
      .post('/finance/payables/payments')
      .set('Authorization', bearer)
      .send({
        supplierId,
        paidAt: '2026-08-28',
        amount: '1200.00',
        method: 'Bank transfer',
        reference: 'FT26082800991',
        allocations: [
          { supplierInvoiceId: a.body.id, amount: '1000.00' },
          { supplierInvoiceId: b.body.id, amount: '200.00' },
        ],
      })
      .expect(201);

    payables = await request(app.getHttpServer())
      .get('/finance/payables?asOf=2026-08-31')
      .set('Authorization', bearer)
      .expect(200);
    expect(payables.body.totals.outstanding).toBe(300);
    expect(payables.body.totals.paid).toBe(1200);
    expect(payables.body.totals.overdue).toBe(0);

    // A-1 is settled and says so; nobody set that status by hand.
    const invoices = await request(app.getHttpServer())
      .get(`/finance/payables/invoices?supplierId=${supplierId}`)
      .set('Authorization', bearer)
      .expect(200);
    const settled = invoices.body.find((i: { invoiceNumber: string }) => i.invoiceNumber === 'A-1');
    expect(settled.status).toBe('PAID');
    expect(settled.outstanding).toBe(0);
    const partial = invoices.body.find((i: { invoiceNumber: string }) => i.invoiceNumber === 'A-2');
    expect(partial.status).toBe('OPEN');
    expect(partial.outstanding).toBe(300);
  });

  it('a payment must equal what it says it settled, and cannot overpay an invoice', async () => {
    const a = await enter({ supplierId, invoiceNumber: 'B-1', invoiceDate: '2026-08-01', totalAmount: '100.00' });

    await request(app.getHttpServer())
      .post('/finance/payables/payments')
      .set('Authorization', bearer)
      .send({
        supplierId,
        paidAt: '2026-08-28',
        amount: '100.00',
        allocations: [{ supplierInvoiceId: a.body.id, amount: '60.00' }],
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/finance/payables/payments')
      .set('Authorization', bearer)
      .send({
        supplierId,
        paidAt: '2026-08-28',
        amount: '140.00',
        allocations: [{ supplierInvoiceId: a.body.id, amount: '140.00' }],
      })
      .expect(400);

    // An invoice belonging to another supplier cannot be settled by this one.
    const other = await enter({
      supplierId: untermedSupplierId,
      invoiceNumber: 'C-1',
      invoiceDate: '2026-08-01',
      totalAmount: '50.00',
    });
    await request(app.getHttpServer())
      .post('/finance/payables/payments')
      .set('Authorization', bearer)
      .send({
        supplierId,
        paidAt: '2026-08-28',
        amount: '50.00',
        allocations: [{ supplierInvoiceId: other.body.id, amount: '50.00' }],
      })
      .expect(400);
  });

  it('PAID cannot be declared by hand — it is what the allocations say', async () => {
    const a = await enter({ supplierId, invoiceNumber: 'D-1', invoiceDate: '2026-08-01', totalAmount: '100.00' });
    await request(app.getHttpServer())
      .patch(`/finance/payables/invoices/${a.body.id}`)
      .set('Authorization', bearer)
      .send({ status: 'PAID' })
      .expect(400);
  });

  it('a disputed invoice is still owed, but is held out of overdue and due-this-week', async () => {
    const a = await enter({ supplierId, invoiceNumber: 'E-1', invoiceDate: '2026-05-01', totalAmount: '900.00' });

    // A dispute has to say what the dispute is.
    await request(app.getHttpServer())
      .patch(`/finance/payables/invoices/${a.body.id}`)
      .set('Authorization', bearer)
      .send({ status: 'DISPUTED' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/finance/payables/invoices/${a.body.id}`)
      .set('Authorization', bearer)
      .send({ status: 'DISPUTED', disputeReason: 'Charged for 4 boxes; 3 arrived.' })
      .expect(200);

    const payables = await request(app.getHttpServer())
      .get('/finance/payables?asOf=2026-08-31')
      .set('Authorization', bearer)
      .expect(200);
    // Still owed…
    expect(payables.body.totals.outstanding).toBe(900);
    // …but not in the pile a person is about to pay this week.
    expect(payables.body.totals.overdue).toBe(0);
    expect(payables.body.totals.disputed).toBe(900);
  });

  it('names the suppliers whose terms nobody recorded, instead of filing them under "not due"', async () => {
    await enter({
      supplierId: untermedSupplierId,
      invoiceNumber: 'F-1',
      invoiceDate: '2026-01-01',
      totalAmount: '750.00',
    }).expect(201);

    const payables = await request(app.getHttpServer())
      .get('/finance/payables?asOf=2026-08-31')
      .set('Authorization', bearer)
      .expect(200);
    expect(payables.body.totals.undated).toBe(750);
    expect(payables.body.totals.overdue).toBe(0);
    expect(payables.body.suppliersWithoutTerms).toContain('Unrecorded Terms Sdn Bhd');
  });

  it('warns when a supplier is over its credit limit, and never blocks on it', async () => {
    await enter({ supplierId, invoiceNumber: 'G-1', invoiceDate: '2026-08-01', totalAmount: '6000.00' }).expect(201);
    // Ordering more is still allowed — a clinic that cannot buy medication
    // because of a number in a config screen is worse off than one that is told.
    await enter({ supplierId, invoiceNumber: 'G-2', invoiceDate: '2026-08-02', totalAmount: '500.00' }).expect(201);

    const payables = await request(app.getHttpServer())
      .get('/finance/payables?asOf=2026-08-31')
      .set('Authorization', bearer)
      .expect(200);
    expect(payables.body.overLimit).toContain('Pharma Supply');
    const row = payables.body.bySupplier.find((r: { supplierName: string }) => r.supplierName === 'Pharma Supply');
    expect(row.overCreditLimit).toBe(true);
    expect(row.creditHeadroom).toBe(0);
  });

  it('changing a supplier term does not move when existing invoices were due', async () => {
    const a = await enter({ supplierId, invoiceNumber: 'H-1', invoiceDate: '2026-08-01', totalAmount: '100.00' });
    expect(String(a.body.dueDate).slice(0, 10)).toBe('2026-08-31');

    await request(app.getHttpServer())
      .patch(`/finance/payables/suppliers/${supplierId}/terms`)
      .set('Authorization', bearer)
      .send({ paymentTermDays: 60, creditLimitAmount: '20000.00' })
      .expect(200);

    const invoices = await request(app.getHttpServer())
      .get(`/finance/payables/invoices?supplierId=${supplierId}`)
      .set('Authorization', bearer)
      .expect(200);
    // The snapshot holds: last month's invoice was due on the terms in force
    // when it was entered, not on the ones agreed today.
    expect(String(invoices.body[0].dueDate).slice(0, 10)).toBe('2026-08-31');

    const next = await enter({
      supplierId,
      invoiceNumber: 'H-2',
      invoiceDate: '2026-08-01',
      totalAmount: '100.00',
    }).expect(201);
    expect(String(next.body.dueDate).slice(0, 10)).toBe('2026-09-30');
  });
});
