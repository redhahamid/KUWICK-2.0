import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentKind, PaymentTender } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { AdminTx, resolveClinicId, withAdminTx } from './admin-actor';
import { currentTenantId } from '../core/tenant-context';
import { recordAudit } from './admin-audit';
import { computePatientBalance } from './financial-invariants';
import { MoneyLike, fromCents, toCents } from './money';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { ReversePaymentDto } from './dto/reverse-payment.dto';

/**
 * THE PAYMENT SERVICE.
 *
 * What it replaces: `InvoiceService.pay()`, which recorded a settlement by
 * stamping four columns on the invoice row. That model could express exactly
 * one payment, of exactly the full outstanding amount, on exactly the day the
 * invoice was raised, and it could not express a refund at all.
 *
 * WHAT IT DOES NOT DO: it does not replace `InvoiceService.pay()`. That method
 * still exists, still enforces the billing-completeness checkpoint, and still
 * writes `patientPaidAmount`. It now ALSO calls in here, so that the same act
 * produces both the legacy columns every existing report reads and the ledger
 * row that makes partial payment possible. Retiring the columns is a later
 * step, after every reader has moved — the additive-first rule in the brief's
 * §9, applied to a column rather than a table.
 */
@Injectable()
export class PaymentService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * The canonical tender for a counter-chosen method string.
   *
   * ONE mapping, here. The alternative — each report bucketing free text its
   * own way — is how "Cash" and "CASH" become two lines in a day-end summary
   * that then does not add up to the total printed above it.
   */
  static tenderOf(method: string | null | undefined): PaymentTender {
    const key = (method ?? '').trim().toUpperCase().replace(/[\s_-]+/g, ' ');
    const table: Record<string, PaymentTender> = {
      CASH: PaymentTender.CASH,
      CARD: PaymentTender.CARD,
      'CREDIT CARD': PaymentTender.CARD,
      'DEBIT CARD': PaymentTender.CARD,
      QR: PaymentTender.QR,
      'DUITNOW QR': PaymentTender.QR,
      'QR PAY': PaymentTender.QR,
      EWALLET: PaymentTender.EWALLET,
      'E WALLET': PaymentTender.EWALLET,
      'TOUCH N GO': PaymentTender.EWALLET,
      GRABPAY: PaymentTender.EWALLET,
      BOOST: PaymentTender.EWALLET,
      'BANK TRANSFER': PaymentTender.BANK_TRANSFER,
      TRANSFER: PaymentTender.BANK_TRANSFER,
      CHEQUE: PaymentTender.CHEQUE,
      CHECK: PaymentTender.CHEQUE,
      PANEL: PaymentTender.PANEL,
    };
    return table[key] ?? PaymentTender.OTHER;
  }

  /**
   * The invoice's money position, computed from records rather than columns.
   *
   * This is the read every screen uses for "what does this patient still owe",
   * and it is the same arithmetic the invariant tests pin down.
   */
  async invoicePosition(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        taxAmount: true,
        patientResponsibilityAmount: true,
        panelResponsibilityAmount: true,
        patientPaidAmount: true,
        panelCoveredAmount: true,
        createdAt: true,
        paidAt: true,
        visit: { select: { id: true, clinicId: true, patientId: true, visitNumber: true } },
      },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const [payments, creditNotes] = await Promise.all([
      this.prisma.payment.findMany({
        where: { invoiceId },
        orderBy: { receivedAt: 'asc' },
        include: { receivedBy: { select: { id: true, fullName: true } } },
      }),
      this.prisma.creditNote.findMany({
        where: { invoiceId },
        select: { id: true, creditNoteNumber: true, status: true, totalAmount: true, reason: true, issuedAt: true },
      }),
    ]);

    // A NULL responsibility means the split was never computed (D-084). It is
    // reported as unresolved, never silently treated as "the patient owes the
    // whole total" or "the patient owes nothing" — both of which are wrong in
    // opposite and expensive directions.
    const responsibilityResolved = invoice.patientResponsibilityAmount !== null;
    const balance = computePatientBalance({
      patientResponsibility: invoice.patientResponsibilityAmount ?? 0,
      payments: payments.map((payment) => ({
        kind: payment.kind === PaymentKind.REFUND ? 'REFUND' : 'PAYMENT',
        amount: payment.amount,
        reversedAt: payment.reversedAt,
      })),
      creditNotes: creditNotes.map((note) => ({
        status: note.status as 'DRAFT' | 'ISSUED' | 'VOID',
        totalAmount: note.totalAmount,
      })),
    });

    return {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        totalAmount: Number(invoice.totalAmount),
        taxAmount: Number(invoice.taxAmount),
        patientResponsibility: responsibilityResolved ? Number(invoice.patientResponsibilityAmount) : null,
        panelResponsibility:
          invoice.panelResponsibilityAmount === null ? null : Number(invoice.panelResponsibilityAmount),
        createdAt: invoice.createdAt,
        paidAt: invoice.paidAt,
        visit: invoice.visit,
      },
      payments: payments.map((payment) => ({
        id: payment.id,
        kind: payment.kind,
        tender: payment.tender,
        methodLabel: payment.methodLabel,
        amount: Number(payment.amount),
        receivedAt: payment.receivedAt,
        referenceNo: payment.referenceNo,
        receivedBy: payment.receivedBy?.fullName ?? null,
        reversedAt: payment.reversedAt,
        reversesPaymentId: payment.reversesPaymentId,
        reversalReason: payment.reversalReason,
        notes: payment.notes,
      })),
      creditNotes,
      responsibilityResolved,
      netReceived: fromCents(balance.netReceivedCents),
      credited: fromCents(balance.creditedCents),
      balance: responsibilityResolved ? fromCents(balance.balanceCents) : null,
      overpaid: fromCents(balance.overpaidCents),
      settled: responsibilityResolved && balance.settled,
    };
  }

  /**
   * Record money moving.
   *
   * Refuses four things, each of which is a real way a counter gets it wrong:
   *   - a payment on an invoice whose split was never resolved (we do not know
   *     what the patient owes, so we cannot say this settles it)
   *   - a payment larger than what is still outstanding, unless the caller
   *     explicitly says an over-collection is intended
   *   - a refund larger than what has actually been received
   *   - any movement against an invoice inside a day that has been CLOSED
   */
  async record(invoiceId: string, dto: RecordPaymentDto) {
    return withAdminTx(this.rawPrisma, 'payment.record', async (tx, actor) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          id: true,
          status: true,
          patientResponsibilityAmount: true,
          visit: { select: { clinicId: true } },
        },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException('This invoice has been cancelled. Money cannot be taken against it.');
      }
      if (invoice.patientResponsibilityAmount === null) {
        throw new BadRequestException('Billing responsibility has not been confirmed.');
      }

      const clinicId = resolveClinicId(actor, invoice.visit.clinicId);
      const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();
      await this.assertDayIsOpen(tx, clinicId, receivedAt);

      const amountCents = toCents(dto.amount);
      if (amountCents <= 0) {
        throw new BadRequestException('A payment must be for a positive amount.');
      }

      const position = await this.positionInTx(tx, invoiceId, invoice.patientResponsibilityAmount);

      if (dto.kind === PaymentKind.REFUND) {
        if (amountCents > position.netReceivedCents) {
          throw new BadRequestException(
            `Cannot refund ${dto.amount} — only ${fromCents(position.netReceivedCents)} has been received on this invoice.`,
          );
        }
      } else if (amountCents > position.balanceCents && !dto.allowOverpayment) {
        throw new BadRequestException(
          `Payment of ${dto.amount} exceeds the ${fromCents(position.balanceCents)} outstanding. Confirm an over-collection if that is intended.`,
        );
      }

      const payment = await tx.payment.create({
        data: {
          tenantId: currentTenantId(),
          clinicId,
          invoiceId,
          kind: dto.kind ?? PaymentKind.PAYMENT,
          tender: dto.tender ?? PaymentService.tenderOf(dto.methodLabel),
          methodLabel: dto.methodLabel ?? null,
          amount: dto.amount,
          receivedAt,
          referenceNo: dto.referenceNo ?? null,
          receivedByStaffId: actor.id,
          notes: dto.notes ?? null,
        },
      });

      await recordAudit(tx, actor, {
        action: dto.kind === PaymentKind.REFUND ? 'refund.recorded' : 'payment.recorded',
        entityType: 'Payment',
        entityId: payment.id,
        after: {
          invoiceId,
          kind: payment.kind,
          tender: payment.tender,
          amount: String(payment.amount),
          receivedAt: payment.receivedAt,
          referenceNo: payment.referenceNo,
        },
        reason: dto.notes ?? null,
        source: 'finance.payments',
      });

      await this.syncInvoiceSettlement(tx, invoiceId, invoice.patientResponsibilityAmount);
      return payment;
    });
  }

  /**
   * Reverse a payment that should not have been recorded.
   *
   * NOT an edit and NOT a delete — the trigger on the table refuses both. A
   * reversal is a second row that points at the first and carries the reason,
   * and the original is stamped `reversedAt` so every aggregate stops counting
   * it. Both facts survive: the money was taken, and it was taken in error.
   */
  async reverse(paymentId: string, dto: ReversePaymentDto) {
    return withAdminTx(this.rawPrisma, 'payment.reverse', async (tx, actor) => {
      const original = await tx.payment.findUnique({
        where: { id: paymentId },
        select: {
          id: true,
          clinicId: true,
          invoiceId: true,
          kind: true,
          tender: true,
          methodLabel: true,
          amount: true,
          receivedAt: true,
          reversedAt: true,
          dayEndClosingId: true,
          invoice: { select: { patientResponsibilityAmount: true } },
        },
      });
      if (!original) throw new NotFoundException('Payment not found');
      if (original.reversedAt) {
        throw new BadRequestException('This payment has already been reversed.');
      }
      if (original.dayEndClosingId) {
        throw new BadRequestException(
          'This payment is inside a closed day. Reopen the day-end closing before reversing it.',
        );
      }

      // A REVERSAL IS NOT A REFUND, and the difference is the whole design.
      //
      // A refund is money genuinely handed back: it counts, it appears in the
      // day-end, and the patient's balance goes back up because the clinic
      // returned what it took. A reversal says the RECORD was wrong — the
      // money either never moved or was captured against the wrong invoice.
      //
      // So the pair CANCELS. The original is stamped `reversedAt`; the
      // reversal row is stamped `reversedAt` at insert too, and every
      // aggregate in `financial-invariants` already skips a reversed row. One
      // rule, applied to both halves, and no aggregate needs a second clause.
      // Both rows survive in full, linked and reasoned, which is what makes
      // the correction auditable instead of invisible.
      const now = new Date();
      const reversal = await tx.payment.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: original.clinicId,
          invoiceId: original.invoiceId,
          // The opposite direction, so the ledger READS correctly to a human
          // scanning it — a receipt reversed shows as money going the other
          // way — even though neither row counts.
          kind: original.kind === PaymentKind.PAYMENT ? PaymentKind.REFUND : PaymentKind.PAYMENT,
          tender: original.tender,
          methodLabel: original.methodLabel,
          amount: original.amount,
          receivedAt: now,
          receivedByStaffId: actor.id,
          reversesPaymentId: original.id,
          reversalReason: dto.reason,
          reversedAt: now,
          notes: dto.reason,
        },
      });

      await tx.payment.update({ where: { id: original.id }, data: { reversedAt: now } });

      await recordAudit(tx, actor, {
        action: 'payment.reversed',
        entityType: 'Payment',
        entityId: original.id,
        before: { amount: String(original.amount), tender: original.tender, reversedAt: null },
        after: { reversalPaymentId: reversal.id, reversedAt: now.toISOString() },
        reason: dto.reason,
        source: 'finance.payments',
      });

      await this.syncInvoiceSettlement(tx, original.invoiceId, original.invoice.patientResponsibilityAmount);
      return reversal;
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async positionInTx(tx: AdminTx, invoiceId: string, responsibility: unknown) {
    const [payments, creditNotes] = await Promise.all([
      tx.payment.findMany({ where: { invoiceId }, select: { kind: true, amount: true, reversedAt: true } }),
      tx.creditNote.findMany({ where: { invoiceId }, select: { status: true, totalAmount: true } }),
    ]);
    return computePatientBalance({
      patientResponsibility: responsibility as MoneyLike,
      payments: payments.map((payment) => ({
        kind: payment.kind === PaymentKind.REFUND ? 'REFUND' : 'PAYMENT',
        amount: payment.amount,
        reversedAt: payment.reversedAt,
      })),
      creditNotes: creditNotes.map((note) => ({
        status: note.status as 'DRAFT' | 'ISSUED' | 'VOID',
        totalAmount: note.totalAmount,
      })),
    });
  }

  /**
   * Keeps the legacy invoice columns telling the truth.
   *
   * `patientPaidAmount`, `status` and `paidAt` are read by a dozen existing
   * reports written before payments existed. Rather than rewrite all of them in
   * one go — the change most likely to break a number somebody relies on —
   * they are DERIVED from the ledger after every movement. One writer, and the
   * two representations cannot drift.
   */
  private async syncInvoiceSettlement(tx: AdminTx, invoiceId: string, responsibility: unknown) {
    const position = await this.positionInTx(tx, invoiceId, responsibility);
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { status: true, paidAt: true } });
    if (!invoice || invoice.status === InvoiceStatus.CANCELLED) return;

    const settled = position.settled;
    const latest = await tx.payment.findFirst({
      where: { invoiceId, reversedAt: null, kind: PaymentKind.PAYMENT },
      orderBy: { receivedAt: 'desc' },
      select: { receivedAt: true, methodLabel: true, tender: true },
    });

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        patientPaidAmount: fromCents(position.netReceivedCents),
        status: settled ? InvoiceStatus.PAID : InvoiceStatus.UNPAID,
        // An invoice that falls back to UNPAID (a refund reopened it) loses its
        // paid date, because it is no longer a fact.
        paidAt: settled ? (latest?.receivedAt ?? invoice.paidAt ?? new Date()) : null,
        paymentMethod: latest?.methodLabel ?? latest?.tender ?? null,
      },
    });
  }

  /**
   * Refuses to move money into a day that has already been signed off.
   *
   * The whole value of a day-end closing is that it is a statement about a
   * fixed set of transactions. A payment back-dated into a closed day makes
   * that statement retrospectively false, with nothing on the record to say so.
   */
  private async assertDayIsOpen(tx: AdminTx, clinicId: string, on: Date) {
    const businessDate = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate()));
    const closing = await tx.dayEndClosing.findFirst({
      where: { clinicId, businessDate, status: 'CLOSED' },
      select: { id: true, businessDate: true },
    });
    if (closing) {
      throw new BadRequestException(
        `${businessDate.toISOString().slice(0, 10)} has been closed for this branch. Reopen the day to record a payment against it.`,
      );
    }
  }
}
