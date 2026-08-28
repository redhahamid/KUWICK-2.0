import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

/**
 * WAVE 1 — the financial model, against a real PostgreSQL.
 *
 * What these prove that a unit test cannot:
 *   - the append-only TRIGGER on `payments` actually refuses an UPDATE and a
 *     DELETE, for the migration-running role as well as the app role
 *   - RLS keeps one tenant's payments and closings invisible to another
 *   - the day-end lock is enforced by the SERVER, not by a disabled button
 *   - a partial payment, a second payment and a refund produce exactly the
 *     balance the invariant module says they should, through the HTTP API
 */
describe('Finance: payments, refunds and day-end closing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let ownerStaffId: string;
  let clinicId: string;
  let patientId: string;

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
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Finance Tenant' } }));
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;
    ownerStaffId = owner.staffId;

    const clinic = await request(app.getHttpServer())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Finance Clinic' })
      .expect(201);
    clinicId = clinic.body.id;

    const patient = await withTenantContext(prisma, tenantId, (tx) =>
      tx.patient.create({
        data: { tenantId, name: 'Test Patient', phone: '0123456789', identifierType: 'NRIC', identifierValue: `9001010${Math.floor(Math.random() * 90000) + 10000}` },
      }),
    );
    patientId = patient.id;
  });

  // NO afterEach cleanup, deliberately — the same convention as
  // clinical-visit-queue.e2e-spec.ts. `payments` is append-only and REFUSES
  // deletion by anybody, which is the point of the table, so its parents
  // (invoices, visits, patients, clinics) cannot be deleted either.
  // kuwick_test is disposable (CODING_STANDARDS.md §5) and every test uses a
  // fresh random tenant, so leftover rows collide with nothing.

  /** A self-pay visit with one RM100 line, ready to be paid. */
  async function makeInvoice(total = 100): Promise<string> {
    const invoice = await withTenantContext(prisma, tenantId, async (tx) => {
      const visit = await tx.visit.create({
        data: {
          tenantId,
          clinicId,
          patientId,
          visitNumber: `V-${Math.floor(Math.random() * 1_000_000)}`,
          billingType: 'SELF_PAY',
          registeredByStaffId: ownerStaffId,
        },
      });
      const created = await tx.invoice.create({
        data: {
          tenantId,
          visitId: visit.id,
          invoiceNumber: `INV-${Math.floor(Math.random() * 1_000_000)}`,
          createdByStaffId: ownerStaffId,
          totalAmount: total,
          subtotalAmount: total,
          patientResponsibilityAmount: total,
          panelResponsibilityAmount: 0,
        },
      });
      await tx.invoiceLine.create({
        data: { tenantId, invoiceId: created.id, description: 'Consultation', quantity: 1, unitPrice: total, amount: total },
      });
      return created;
    });
    return invoice.id;
  }

  // -------------------------------------------------------------------------
  it('records a partial payment, leaves the balance outstanding, and settles on the second', async () => {
    const invoiceId = await makeInvoice(100);

    await request(app.getHttpServer())
      .post(`/finance/invoices/${invoiceId}/payments`)
      .set('Authorization', bearer)
      .send({ amount: '40.00', tender: 'CASH' })
      .expect(201);

    let position = await request(app.getHttpServer())
      .get(`/finance/invoices/${invoiceId}/position`)
      .set('Authorization', bearer)
      .expect(200);
    expect(position.body.netReceived).toBe(40);
    expect(position.body.balance).toBe(60);
    expect(position.body.settled).toBe(false);
    expect(position.body.invoice.status).toBe('UNPAID');

    await request(app.getHttpServer())
      .post(`/finance/invoices/${invoiceId}/payments`)
      .set('Authorization', bearer)
      .send({ amount: '60.00', tender: 'CARD' })
      .expect(201);

    position = await request(app.getHttpServer())
      .get(`/finance/invoices/${invoiceId}/position`)
      .set('Authorization', bearer)
      .expect(200);
    expect(position.body.balance).toBe(0);
    expect(position.body.settled).toBe(true);
    expect(position.body.invoice.status).toBe('PAID');
    expect(position.body.payments).toHaveLength(2);
  });

  it('refuses an over-collection unless it is explicitly confirmed', async () => {
    const invoiceId = await makeInvoice(100);

    await request(app.getHttpServer())
      .post(`/finance/invoices/${invoiceId}/payments`)
      .set('Authorization', bearer)
      .send({ amount: '150.00', tender: 'CASH' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/finance/invoices/${invoiceId}/payments`)
      .set('Authorization', bearer)
      .send({ amount: '150.00', tender: 'CASH', allowOverpayment: true })
      .expect(201);

    const position = await request(app.getHttpServer())
      .get(`/finance/invoices/${invoiceId}/position`)
      .set('Authorization', bearer)
      .expect(200);
    expect(position.body.overpaid).toBe(50);
    expect(position.body.balance).toBe(0);
  });

  it('reopens the balance when money is refunded, and refuses a refund larger than what was taken', async () => {
    const invoiceId = await makeInvoice(100);
    await request(app.getHttpServer())
      .post(`/finance/invoices/${invoiceId}/payments`)
      .set('Authorization', bearer)
      .send({ amount: '100.00', tender: 'CASH' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/finance/invoices/${invoiceId}/payments`)
      .set('Authorization', bearer)
      .send({ amount: '250.00', tender: 'CASH', kind: 'REFUND' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/finance/invoices/${invoiceId}/payments`)
      .set('Authorization', bearer)
      .send({ amount: '25.00', tender: 'CASH', kind: 'REFUND' })
      .expect(201);

    const position = await request(app.getHttpServer())
      .get(`/finance/invoices/${invoiceId}/position`)
      .set('Authorization', bearer)
      .expect(200);
    expect(position.body.netReceived).toBe(75);
    expect(position.body.balance).toBe(25);
    expect(position.body.invoice.status).toBe('UNPAID');
  });

  it('a payment cannot be edited or deleted — the table refuses it', async () => {
    const invoiceId = await makeInvoice(100);
    const created = await request(app.getHttpServer())
      .post(`/finance/invoices/${invoiceId}/payments`)
      .set('Authorization', bearer)
      .send({ amount: '100.00', tender: 'CASH' })
      .expect(201);
    const paymentId = created.body.id;

    // Separate transactions: the first refusal aborts its own, and a second
    // statement inside it would fail with "transaction is aborted" rather than
    // with the message this test is checking for.
    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.$executeRawUnsafe(`UPDATE payments SET amount = 1 WHERE id = '${paymentId}'`),
      ),
    ).rejects.toThrow(/append-only/);

    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.$executeRawUnsafe(`DELETE FROM payments WHERE id = '${paymentId}'`),
      ),
    ).rejects.toThrow(/permission denied|append-only/);

    // And through Prisma's own API, which is how application code would do it.
    await expect(
      withTenantContext(prisma, tenantId, (tx) => tx.payment.deleteMany({ where: { id: paymentId } })),
    ).rejects.toThrow();
  });

  it('reverses a payment as a new row, leaving both facts on the record', async () => {
    const invoiceId = await makeInvoice(100);
    const created = await request(app.getHttpServer())
      .post(`/finance/invoices/${invoiceId}/payments`)
      .set('Authorization', bearer)
      .send({ amount: '100.00', tender: 'CASH' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/finance/payments/${created.body.id}/reverse`)
      .set('Authorization', bearer)
      .send({ reason: 'Wrong patient charged at the counter' })
      .expect(201);

    const position = await request(app.getHttpServer())
      .get(`/finance/invoices/${invoiceId}/position`)
      .set('Authorization', bearer)
      .expect(200);
    // Both rows survive; NEITHER counts. A reversal says the record was
    // wrong — it is not a refund, which is money genuinely handed back and
    // does count.
    expect(position.body.payments).toHaveLength(2);
    expect(position.body.netReceived).toBe(0);
    expect(position.body.balance).toBe(100);
    expect(position.body.invoice.status).toBe('UNPAID');

    const audit = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.findMany({ where: { tenantId, action: 'payment.reversed' } }),
    );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].after)).toContain('Wrong patient charged');
  });

  // -------------------------------------------------------------------------
  describe('day-end closing', () => {
    const today = new Date().toISOString().slice(0, 10);

    it('expects what the ledger holds, refuses an unexplained variance, and locks the day', async () => {
      const invoiceId = await makeInvoice(100);
      await request(app.getHttpServer())
        .post(`/finance/invoices/${invoiceId}/payments`)
        .set('Authorization', bearer)
        .send({ amount: '100.00', tender: 'CASH' })
        .expect(201);

      const view = await request(app.getHttpServer())
        .get(`/finance/day-end?date=${today}&clinicId=${clinicId}`)
        .set('Authorization', bearer)
        .expect(200);
      expect(view.body.expected.cash).toBe(100);
      expect(view.body.status).toBe('OPEN');
      // Nobody has counted, so there is no variance yet — NULL, not zero.
      expect(view.body.variance).toBeNull();

      // A short drawer with no explanation cannot be signed off.
      await request(app.getHttpServer())
        .post(`/finance/day-end/count?date=${today}&clinicId=${clinicId}`)
        .set('Authorization', bearer)
        .send({ cash: '90.00' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/finance/day-end/close?date=${today}&clinicId=${clinicId}`)
        .set('Authorization', bearer)
        .send({})
        .expect(400);

      await request(app.getHttpServer())
        .post(`/finance/day-end/close?date=${today}&clinicId=${clinicId}`)
        .set('Authorization', bearer)
        .send({ varianceReason: 'RM10 float taken for petty cash, receipt attached' })
        .expect(201);

      const closed = await request(app.getHttpServer())
        .get(`/finance/day-end?date=${today}&clinicId=${clinicId}`)
        .set('Authorization', bearer)
        .expect(200);
      expect(closed.body.status).toBe('CLOSED');
      expect(closed.body.variance).toBe(-10);
      expect(closed.body.frozen).toBe(true);
    });

    it('refuses a payment into a closed day, and accepts it once the day is reopened', async () => {
      const invoiceId = await makeInvoice(100);
      await request(app.getHttpServer())
        .post(`/finance/day-end/count?date=${today}&clinicId=${clinicId}`)
        .set('Authorization', bearer)
        .send({ cash: '0.00' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/finance/day-end/close?date=${today}&clinicId=${clinicId}`)
        .set('Authorization', bearer)
        .send({})
        .expect(201);

      await request(app.getHttpServer())
        .post(`/finance/invoices/${invoiceId}/payments`)
        .set('Authorization', bearer)
        .send({ amount: '100.00', tender: 'CASH' })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/finance/day-end/reopen?date=${today}&clinicId=${clinicId}`)
        .set('Authorization', bearer)
        .send({ reason: 'A cash payment was recorded on the wrong day' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/finance/invoices/${invoiceId}/payments`)
        .set('Authorization', bearer)
        .send({ amount: '100.00', tender: 'CASH' })
        .expect(201);
    });

    it('refuses to reopen a day for an account without the permission', async () => {
      const counter = await withTenantContext(prisma, tenantId, async (tx) => {
        const staff = await tx.staff.create({
          data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Counter Staff', clinicId },
        });
        await tx.staffRoleAssignment.create({
          data: { tenantId, staffId: staff.id, role: 'ADMINISTRATOR', assignedByStaffId: ownerStaffId },
        });
        return staff;
      });
      const counterBearer = bearerFor(tenantId, counter.id, Role.FRONT_DESK_CLINICAL_STAFF);

      // The counter may count and close…
      await request(app.getHttpServer())
        .post(`/finance/day-end/count?date=${today}&clinicId=${clinicId}`)
        .set('Authorization', counterBearer)
        .send({ cash: '0.00' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/finance/day-end/close?date=${today}&clinicId=${clinicId}`)
        .set('Authorization', counterBearer)
        .send({})
        .expect(201);
      // …and may not reopen.
      await request(app.getHttpServer())
        .post(`/finance/day-end/reopen?date=${today}&clinicId=${clinicId}`)
        .set('Authorization', counterBearer)
        .send({ reason: 'I would like to change yesterday' })
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  it('keeps one tenant’s payments and closings invisible to another', async () => {
    const invoiceId = await makeInvoice(100);
    await request(app.getHttpServer())
      .post(`/finance/invoices/${invoiceId}/payments`)
      .set('Authorization', bearer)
      .send({ amount: '100.00', tender: 'CASH' })
      .expect(201);

    const otherTenantId = randomId();
    await withTenantContext(prisma, otherTenantId, (tx) =>
      tx.tenant.create({ data: { id: otherTenantId, name: 'Other Tenant' } }),
    );
    const other = await createOwnerAndBearer(prisma, otherTenantId);

    // Same invoice id, different tenant: RLS makes the row not exist.
    await request(app.getHttpServer())
      .get(`/finance/invoices/${invoiceId}/position`)
      .set('Authorization', other.bearer)
      .expect(404);

    const rows = await withTenantContext(prisma, otherTenantId, (tx) => tx.payment.findMany({}));
    expect(rows).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  it('credits an invoice without touching what was billed, and only once approved', async () => {
    const invoiceId = await makeInvoice(100);
    const line = await withTenantContext(prisma, tenantId, (tx) =>
      tx.invoiceLine.findFirst({ where: { invoiceId } }),
    );

    const note = await request(app.getHttpServer())
      .post('/finance/credit-notes')
      .set('Authorization', bearer)
      .send({
        invoiceId,
        reason: 'Procedure was not performed after all',
        lines: [{ invoiceLineId: line!.id, description: 'Consultation reversed', amount: '40.00' }],
      })
      .expect(201);
    expect(note.body.status).toBe('DRAFT');

    // A DRAFT reduces nothing.
    let position = await request(app.getHttpServer())
      .get(`/finance/invoices/${invoiceId}/position`)
      .set('Authorization', bearer)
      .expect(200);
    expect(position.body.balance).toBe(100);
    expect(position.body.invoice.totalAmount).toBe(100);

    await request(app.getHttpServer())
      .patch(`/finance/credit-notes/${note.body.id}/approve`)
      .set('Authorization', bearer)
      .expect(200);

    position = await request(app.getHttpServer())
      .get(`/finance/invoices/${invoiceId}/position`)
      .set('Authorization', bearer)
      .expect(200);
    expect(position.body.credited).toBe(40);
    expect(position.body.balance).toBe(60);
    // The invoice itself is untouched — that is the whole point.
    expect(position.body.invoice.totalAmount).toBe(100);
  });

  it('refuses a credit note larger than the invoice', async () => {
    const invoiceId = await makeInvoice(100);
    await request(app.getHttpServer())
      .post('/finance/credit-notes')
      .set('Authorization', bearer)
      .send({
        invoiceId,
        reason: 'Attempting to credit more than was billed',
        lines: [{ description: 'Too much', amount: '250.00' }],
      })
      .expect(400);
  });
});
