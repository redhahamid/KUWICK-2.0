import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SupplierInvoiceStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from './admin-actor';
import { recordAudit } from './admin-audit';
import { fromCents, toCents } from './money';
import {
  computeSupplierInvoiceBalance,
  payableAgeBucket,
  rollUpPayables,
  supplierExposure,
} from './supplier-payables';
import {
  RecordSupplierInvoiceDto,
  RecordSupplierPaymentDto,
  UpdateSupplierInvoiceDto,
  UpdateSupplierTermsDto,
} from './dto/supplier-payable.dto';

/**
 * ACCOUNTS PAYABLE.
 *
 * The gap the clinic's stock workbooks made undeniable: Kuwick tracked what was
 * ordered and what was received, and then stopped. "What do we owe suppliers"
 * had no answer in the system at all, so the clinic runs a payable listing with
 * one sheet per supplier — thirty of them — whose own roll-up sums the payment
 * DATE column instead of the balance column
 * (`docs/STOCK_LEGACY_WORKFLOW_AUDIT.md` §5, finding S-1).
 *
 * Three rules, all of them things the spreadsheet cannot do:
 *
 *  1. WHAT HAS BEEN PAID IS DERIVED from allocated payments, never typed onto
 *     an invoice. A paid figure a person can edit is a figure that will
 *     eventually disagree with the bank.
 *  2. A PAYMENT MUST SAY WHICH INVOICES IT SETTLED, and the allocations must
 *     equal it exactly. Same rule as a panel remittance.
 *  3. NO TERM MEANS NO DUE DATE. An invoice on a supplier whose terms nobody
 *     recorded is not "due in 30 days"; it is undated, counted separately, and
 *     named on screen.
 */
@Injectable()
export class SupplierPayablesService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  // -------------------------------------------------------------------------
  // READ
  // -------------------------------------------------------------------------

  /**
   * THE ANSWER TO "WHAT DO WE OWE", by supplier.
   *
   * One row per supplier with an open balance, plus the four attention figures
   * the clinic actually operates on: overdue, due this week, disputed, and
   * undated. Every one comes from `rollUpPayables` — the same function the
   * per-invoice screen uses, summed.
   */
  async summary(params: { asOf?: string } = {}) {
    await requirePermission(this.rawPrisma, 'finance.view');
    const asOf = params.asOf ? new Date(`${params.asOf}T23:59:59.999Z`) : new Date();

    const suppliers = await this.prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        active: true,
        paymentTermDays: true,
        creditLimitAmount: true,
        deliverySlaDays: true,
        accountReference: true,
        notes: true,
        invoices: {
          select: {
            totalAmount: true,
            status: true,
            dueDate: true,
            allocations: { select: { amount: true } },
          },
        },
      },
    });

    const rows = suppliers.map((supplier) => {
      const facts = supplier.invoices.map((invoice) => ({
        totalAmount: invoice.totalAmount,
        allocatedAmount: invoice.allocations.reduce((sum, a) => sum + Number(a.amount), 0),
        status: invoice.status,
        dueDate: invoice.dueDate,
      }));
      const roll = rollUpPayables(facts, asOf);
      const exposure = supplierExposure(roll.outstandingCents, supplier.creditLimitAmount);
      return {
        supplierId: supplier.id,
        supplierName: supplier.name,
        active: supplier.active,
        paymentTermDays: supplier.paymentTermDays,
        deliverySlaDays: supplier.deliverySlaDays,
        accountReference: supplier.accountReference,
        notes: supplier.notes,
        invoices: roll.invoices,
        billed: fromCents(roll.totalCents),
        paid: fromCents(roll.paidCents),
        outstanding: fromCents(roll.outstandingCents),
        overdue: fromCents(roll.overdueCents),
        overdueInvoices: roll.overdueInvoices,
        dueThisWeek: fromCents(roll.dueThisWeekCents),
        dueThisWeekInvoices: roll.dueThisWeekInvoices,
        disputed: fromCents(roll.disputedCents),
        disputedInvoices: roll.disputedInvoices,
        undated: fromCents(roll.undatedCents),
        undatedInvoices: roll.undatedInvoices,
        creditLimit: exposure.creditLimitCents === null ? null : fromCents(exposure.creditLimitCents),
        creditUtilisation: exposure.utilisation,
        overCreditLimit: exposure.overLimit,
        creditHeadroom: exposure.headroomCents === null ? null : fromCents(exposure.headroomCents),
      };
    });

    const group = rollUpPayables(
      suppliers.flatMap((supplier) =>
        supplier.invoices.map((invoice) => ({
          totalAmount: invoice.totalAmount,
          allocatedAmount: invoice.allocations.reduce((sum, a) => sum + Number(a.amount), 0),
          status: invoice.status,
          dueDate: invoice.dueDate,
        })),
      ),
      asOf,
    );

    return {
      asOf: asOf.toISOString().slice(0, 10),
      totals: {
        suppliers: rows.filter((row) => row.outstanding > 0).length,
        invoices: group.invoices,
        billed: fromCents(group.totalCents),
        paid: fromCents(group.paidCents),
        outstanding: fromCents(group.outstandingCents),
        overdue: fromCents(group.overdueCents),
        overdueInvoices: group.overdueInvoices,
        dueThisWeek: fromCents(group.dueThisWeekCents),
        dueThisWeekInvoices: group.dueThisWeekInvoices,
        disputed: fromCents(group.disputedCents),
        undated: fromCents(group.undatedCents),
        undatedInvoices: group.undatedInvoices,
      },
      /** Suppliers whose terms nobody has recorded — the fixable half of `undated`. */
      suppliersWithoutTerms: rows
        .filter((row) => row.active && row.paymentTermDays === null && row.outstanding > 0)
        .map((row) => row.supplierName),
      overLimit: rows.filter((row) => row.overCreditLimit).map((row) => row.supplierName),
      bySupplier: rows.sort((a, b) => b.outstanding - a.outstanding),
    };
  }

  /** Every invoice, with what is still owed on it and how overdue that is. */
  async invoices(params: { supplierId?: string; status?: SupplierInvoiceStatus; asOf?: string } = {}) {
    await requirePermission(this.rawPrisma, 'finance.view');
    const asOf = params.asOf ? new Date(`${params.asOf}T23:59:59.999Z`) : new Date();

    const invoices = await this.prisma.supplierInvoice.findMany({
      where: {
        ...(params.supplierId ? { supplierId: params.supplierId } : {}),
        ...(params.status ? { status: params.status } : {}),
      },
      orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'asc' }],
      include: {
        supplier: { select: { id: true, name: true, paymentTermDays: true } },
        allocations: { select: { amount: true } },
        recordedBy: { select: { fullName: true } },
        goodsReceivedNote: {
          select: {
            id: true,
            receivedAt: true,
            purchaseOrder: { select: { id: true, orderedAt: true } },
            lines: { select: { quantityReceived: true, unitCost: true } },
          },
        },
      },
    });

    return invoices.map((invoice) => {
      const allocated = invoice.allocations.reduce((sum, a) => sum + Number(a.amount), 0);
      const balance = computeSupplierInvoiceBalance(
        {
          totalAmount: invoice.totalAmount,
          allocatedAmount: allocated,
          status: invoice.status,
          dueDate: invoice.dueDate,
        },
        asOf,
      );

      // THREE-WAY MATCH, which the spreadsheet cannot do at all: what the
      // delivery was worth against what the invoice asks for. Only computable
      // where the goods receipt carries unit costs, so it is NULL rather than
      // zero when it cannot be checked.
      const grnLines = invoice.goodsReceivedNote?.lines ?? [];
      const priced = grnLines.filter((line) => line.unitCost !== null);
      const receivedValueCents =
        invoice.goodsReceivedNote === null || priced.length === 0
          ? null
          : priced.reduce((sum, line) => sum + toCents(line.unitCost as Prisma.Decimal) * line.quantityReceived, 0);

      return {
        id: invoice.id,
        supplierId: invoice.supplier.id,
        supplierName: invoice.supplier.name,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        paymentTermDays: invoice.supplier.paymentTermDays,
        total: Number(invoice.totalAmount),
        tax: invoice.taxAmount === null ? null : Number(invoice.taxAmount),
        paid: fromCents(balance.paidCents),
        outstanding: fromCents(balance.balanceCents),
        overpaid: fromCents(balance.overpaidCents),
        status: invoice.status,
        disputeReason: invoice.disputeReason,
        settled: balance.settled,
        overdue: balance.overdue,
        daysUntilDue: balance.daysUntilDue,
        ageBucket: payableAgeBucket(balance.daysUntilDue),
        goodsReceivedNoteId: invoice.goodsReceivedNoteId,
        purchaseOrderId: invoice.purchaseOrderId,
        receivedAt: invoice.goodsReceivedNote?.receivedAt ?? null,
        // A purchase order has no human-facing number in this schema, so the
        // link is the id and the date it was placed — enough to open it.
        purchaseOrderOrderedAt: invoice.goodsReceivedNote?.purchaseOrder?.orderedAt ?? null,
        /** What the goods receipt was worth. NULL when it cannot be checked. */
        receivedValue: receivedValueCents === null ? null : fromCents(receivedValueCents),
        /** Invoice minus delivery. NULL when unmatched; non-zero is a question. */
        matchVariance:
          receivedValueCents === null ? null : fromCents(toCents(invoice.totalAmount) - receivedValueCents),
        documentUrl: invoice.documentUrl,
        notes: invoice.notes,
        recordedBy: invoice.recordedBy.fullName,
        createdAt: invoice.createdAt,
      };
    });
  }

  /** Payments made, and what each one settled. */
  async payments(params: { supplierId?: string } = {}) {
    await requirePermission(this.rawPrisma, 'finance.view');
    const payments = await this.prisma.supplierPayment.findMany({
      where: params.supplierId ? { supplierId: params.supplierId } : {},
      orderBy: { paidAt: 'desc' },
      include: {
        supplier: { select: { name: true } },
        recordedBy: { select: { fullName: true } },
        allocations: {
          select: { amount: true, invoice: { select: { id: true, invoiceNumber: true } } },
        },
      },
    });
    return payments.map((payment) => ({
      id: payment.id,
      supplierId: payment.supplierId,
      supplierName: payment.supplier.name,
      paidAt: payment.paidAt,
      amount: Number(payment.amount),
      method: payment.method,
      reference: payment.reference,
      notes: payment.notes,
      recordedBy: payment.recordedBy.fullName,
      settled: payment.allocations.map((a) => ({
        supplierInvoiceId: a.invoice.id,
        invoiceNumber: a.invoice.invoiceNumber,
        amount: Number(a.amount),
      })),
    }));
  }

  // -------------------------------------------------------------------------
  // WRITE
  // -------------------------------------------------------------------------

  async recordInvoice(dto: RecordSupplierInvoiceDto) {
    return withAdminTx(this.rawPrisma, 'supplierInvoice.manage', async (tx, actor) => {
      const supplier = await tx.supplier.findUnique({
        where: { id: dto.supplierId },
        select: { id: true, name: true, paymentTermDays: true, active: true },
      });
      if (!supplier) throw new NotFoundException('Supplier not found');

      const duplicate = await tx.supplierInvoice.findFirst({
        where: { supplierId: dto.supplierId, invoiceNumber: dto.invoiceNumber },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException(
          `${supplier.name} invoice ${dto.invoiceNumber} has already been entered. Entering it twice is how a supplier gets paid twice.`,
        );
      }

      const invoiceDate = new Date(`${dto.invoiceDate.slice(0, 10)}T00:00:00.000Z`);
      // DERIVED AND STORED. A term change next year must not silently move when
      // last year's invoices were due. NULL when there is no term — this system
      // does not assume thirty days.
      const dueDate = dto.dueDate
        ? new Date(`${dto.dueDate.slice(0, 10)}T00:00:00.000Z`)
        : supplier.paymentTermDays === null
          ? null
          : new Date(invoiceDate.getTime() + supplier.paymentTermDays * 86400000);

      if (dto.goodsReceivedNoteId) {
        const grn = await tx.goodsReceivedNote.findUnique({
          where: { id: dto.goodsReceivedNoteId },
          select: { id: true, purchaseOrder: { select: { supplierId: true, id: true } } },
        });
        if (!grn) throw new NotFoundException('Goods receipt not found');
        if (grn.purchaseOrder.supplierId !== dto.supplierId) {
          throw new BadRequestException('That goods receipt belongs to a different supplier.');
        }
      }

      const invoice = await tx.supplierInvoice.create({
        data: {
          tenantId: currentTenantId(),
          supplierId: dto.supplierId,
          invoiceNumber: dto.invoiceNumber,
          invoiceDate,
          dueDate,
          totalAmount: dto.totalAmount,
          taxAmount: dto.taxAmount ?? null,
          goodsReceivedNoteId: dto.goodsReceivedNoteId ?? null,
          purchaseOrderId: dto.purchaseOrderId ?? null,
          documentUrl: dto.documentUrl ?? null,
          notes: dto.notes ?? null,
          recordedByStaffId: actor.id,
        },
      });

      await recordAudit(tx, actor, {
        action: 'supplierInvoice.recorded',
        entityType: 'SupplierInvoice',
        entityId: invoice.id,
        after: {
          supplier: supplier.name,
          invoiceNumber: dto.invoiceNumber,
          total: dto.totalAmount,
          dueDate: dueDate?.toISOString().slice(0, 10) ?? null,
        },
        source: 'finance.payables',
      });

      return {
        ...invoice,
        /** Named so the screen can say WHY there is no due date. */
        dueDateUnknownReason:
          dueDate === null ? `No payment term is configured for ${supplier.name}.` : null,
      };
    });
  }

  async updateInvoice(id: string, dto: UpdateSupplierInvoiceDto) {
    return withAdminTx(this.rawPrisma, 'supplierInvoice.manage', async (tx, actor) => {
      const before = await tx.supplierInvoice.findUnique({
        where: { id },
        select: { id: true, status: true, invoiceNumber: true, allocations: { select: { amount: true } } },
      });
      if (!before) throw new NotFoundException('Supplier invoice not found');

      if (dto.status === SupplierInvoiceStatus.DISPUTED && !dto.disputeReason?.trim()) {
        throw new BadRequestException('A disputed invoice has to say what the dispute is.');
      }
      // PAID is derived, never declared: an invoice is paid when the allocations
      // cover it, and letting somebody set the status by hand is exactly how the
      // spreadsheet's paid column drifted from its bank statement.
      if (dto.status === SupplierInvoiceStatus.PAID) {
        throw new BadRequestException(
          'PAID is derived from the payments allocated to this invoice. Record a payment instead.',
        );
      }
      if (dto.status === SupplierInvoiceStatus.CANCELLED && before.allocations.length > 0) {
        throw new ConflictException(
          'This invoice has payments allocated against it. Reverse those before cancelling it.',
        );
      }

      const updated = await tx.supplierInvoice.update({
        where: { id },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.status === SupplierInvoiceStatus.DISPUTED ? { disputeReason: dto.disputeReason } : {}),
          ...(dto.status && dto.status !== SupplierInvoiceStatus.DISPUTED ? { disputeReason: null } : {}),
          ...(dto.dueDate ? { dueDate: new Date(`${dto.dueDate.slice(0, 10)}T00:00:00.000Z`) } : {}),
          ...(dto.goodsReceivedNoteId ? { goodsReceivedNoteId: dto.goodsReceivedNoteId } : {}),
          ...(dto.documentUrl ? { documentUrl: dto.documentUrl } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
      });

      await recordAudit(tx, actor, {
        action: 'supplierInvoice.updated',
        entityType: 'SupplierInvoice',
        entityId: id,
        before: { status: before.status },
        after: { status: updated.status },
        reason: dto.disputeReason,
        source: 'finance.payables',
      });

      return updated;
    });
  }

  /**
   * MONEY LEAVING THE CLINIC, allocated to the invoices it settles.
   *
   * The allocations must equal the payment exactly. The clinic's spreadsheet
   * has no such check, which is how a payment against the wrong supplier sheet
   * goes unnoticed for a quarter.
   */
  async recordPayment(dto: RecordSupplierPaymentDto) {
    return withAdminTx(this.rawPrisma, 'supplierPayment.record', async (tx, actor) => {
      const supplier = await tx.supplier.findUnique({
        where: { id: dto.supplierId },
        select: { id: true, name: true },
      });
      if (!supplier) throw new NotFoundException('Supplier not found');
      if (dto.allocations.length === 0) {
        throw new BadRequestException('A payment has to say which invoices it settles.');
      }

      const amountCents = toCents(dto.amount);
      const allocatedCents = dto.allocations.reduce((sum, a) => sum + toCents(a.amount), 0);
      if (allocatedCents !== amountCents) {
        throw new BadRequestException(
          `Allocations total ${fromCents(allocatedCents)} but the payment is ${fromCents(amountCents)}. They must match exactly.`,
        );
      }

      const ids = dto.allocations.map((a) => a.supplierInvoiceId);
      if (new Set(ids).size !== ids.length) {
        throw new BadRequestException('The same invoice appears twice in this payment.');
      }

      const invoices = await tx.supplierInvoice.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          supplierId: true,
          invoiceNumber: true,
          totalAmount: true,
          status: true,
          allocations: { select: { amount: true } },
        },
      });
      if (invoices.length !== ids.length) throw new NotFoundException('One of those invoices does not exist.');

      for (const allocation of dto.allocations) {
        const invoice = invoices.find((i) => i.id === allocation.supplierInvoiceId)!;
        if (invoice.supplierId !== dto.supplierId) {
          throw new BadRequestException(
            `Invoice ${invoice.invoiceNumber} belongs to a different supplier.`,
          );
        }
        if (invoice.status === SupplierInvoiceStatus.CANCELLED) {
          throw new BadRequestException(`Invoice ${invoice.invoiceNumber} was cancelled.`);
        }
        const already = invoice.allocations.reduce((sum, a) => sum + Number(a.amount), 0);
        const balance = computeSupplierInvoiceBalance({
          totalAmount: invoice.totalAmount,
          allocatedAmount: already,
          status: invoice.status,
        });
        if (toCents(allocation.amount) > balance.balanceCents) {
          throw new BadRequestException(
            `Invoice ${invoice.invoiceNumber} only has ${fromCents(balance.balanceCents)} outstanding — paying ${allocation.amount} against it would overpay.`,
          );
        }
      }

      const payment = await tx.supplierPayment.create({
        data: {
          tenantId: currentTenantId(),
          supplierId: dto.supplierId,
          paidAt: new Date(`${dto.paidAt.slice(0, 10)}T00:00:00.000Z`),
          amount: dto.amount,
          method: dto.method ?? null,
          reference: dto.reference ?? null,
          notes: dto.notes ?? null,
          recordedByStaffId: actor.id,
          allocations: {
            create: dto.allocations.map((a) => ({
              tenantId: currentTenantId(),
              supplierInvoiceId: a.supplierInvoiceId,
              amount: a.amount,
            })),
          },
        },
        include: { allocations: true },
      });

      // Re-derive each invoice's status FROM ITS ALLOCATIONS rather than
      // incrementing a column: a duplicate payment is then impossible to create
      // by double-clicking, because the total is a sum of records.
      const settled: string[] = [];
      for (const invoice of invoices) {
        const allocations = await tx.supplierPaymentAllocation.aggregate({
          where: { supplierInvoiceId: invoice.id },
          _sum: { amount: true },
        });
        const balance = computeSupplierInvoiceBalance({
          totalAmount: invoice.totalAmount,
          allocatedAmount: allocations._sum.amount ?? 0,
          status: invoice.status,
        });
        if (balance.settled && invoice.status !== SupplierInvoiceStatus.PAID) {
          await tx.supplierInvoice.update({
            where: { id: invoice.id },
            data: { status: SupplierInvoiceStatus.PAID },
          });
          settled.push(invoice.invoiceNumber);
        }
      }

      await recordAudit(tx, actor, {
        action: 'supplierPayment.recorded',
        entityType: 'SupplierPayment',
        entityId: payment.id,
        after: {
          supplier: supplier.name,
          amount: dto.amount,
          paidAt: dto.paidAt.slice(0, 10),
          reference: dto.reference ?? null,
          invoices: dto.allocations.length,
        },
        source: 'finance.payables',
      });

      return { ...payment, settledInvoices: settled };
    });
  }

  /** The supplier's commercial terms — out of prose, into fields. */
  async updateTerms(supplierId: string, dto: UpdateSupplierTermsDto) {
    return withAdminTx(this.rawPrisma, 'supplierInvoice.manage', async (tx, actor) => {
      const before = await tx.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true, name: true, paymentTermDays: true, creditLimitAmount: true, deliverySlaDays: true },
      });
      if (!before) throw new NotFoundException('Supplier not found');

      const updated = await tx.supplier.update({
        where: { id: supplierId },
        data: {
          ...(dto.paymentTermDays !== undefined ? { paymentTermDays: dto.paymentTermDays } : {}),
          ...(dto.creditLimitAmount !== undefined ? { creditLimitAmount: dto.creditLimitAmount } : {}),
          ...(dto.deliverySlaDays !== undefined ? { deliverySlaDays: dto.deliverySlaDays } : {}),
          ...(dto.accountReference !== undefined ? { accountReference: dto.accountReference } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });

      await recordAudit(tx, actor, {
        action: 'supplier.termsUpdated',
        entityType: 'Supplier',
        entityId: supplierId,
        before: {
          paymentTermDays: before.paymentTermDays,
          creditLimit: before.creditLimitAmount === null ? null : Number(before.creditLimitAmount),
          deliverySlaDays: before.deliverySlaDays,
        },
        after: {
          paymentTermDays: updated.paymentTermDays,
          creditLimit: updated.creditLimitAmount === null ? null : Number(updated.creditLimitAmount),
          deliverySlaDays: updated.deliverySlaDays,
        },
        source: 'finance.payables',
      });

      // Existing invoices keep the due date they were entered with — it is a
      // snapshot, deliberately. What changes is what happens NEXT.
      return { ...updated, existingInvoiceDueDatesUnchanged: true };
    });
  }
}
