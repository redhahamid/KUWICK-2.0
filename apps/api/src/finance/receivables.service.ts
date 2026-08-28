import { Inject, Injectable } from '@nestjs/common';
import { CreditNoteStatus, InvoiceStatus, PaymentKind } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission } from './admin-actor';
import {
  AgingBucket,
  accumulateAging,
  computePatientBalance,
  daysBetween,
  emptyAging,
} from './financial-invariants';
import { fromCents } from './money';

/**
 * OUTSTANDING RECEIVABLES — who owes the clinic money, and for how long.
 *
 * Owner brief §6E requires three receivables to be kept apart:
 *   PATIENT      — this module
 *   PANEL        — the panel module, chased through the CLAIM
 *   CORPORATE    — inter-company, which follows the same shape as panel
 *
 * They are separated because they are chased differently, by different people,
 * with different escalation. Adding them into one "outstanding" figure is how
 * a clinic ends up phoning a patient about money a panel owes.
 *
 * The arithmetic is `financial-invariants.computePatientBalance` — the same
 * function the invoice screen uses, so the total on the dashboard and the
 * total on the invoice can never disagree.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async patientReceivables(params: { clinicId?: string; asOf?: string; includeSettled?: boolean }) {
    const actor = await requirePermission(this.rawPrisma, 'finance.view');
    const clinicId = params.clinicId ?? actor.clinicId ?? undefined;
    const asOf = params.asOf ? new Date(`${params.asOf}T23:59:59.999Z`) : new Date();

    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { not: InvoiceStatus.CANCELLED },
        createdAt: { lte: asOf },
        ...(clinicId ? { visit: { clinicId } } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        createdAt: true,
        status: true,
        totalAmount: true,
        patientResponsibilityAmount: true,
        panelResponsibilityAmount: true,
        visit: {
          select: {
            visitNumber: true,
            clinicId: true,
            clinic: { select: { name: true } },
            patient: { select: { id: true, name: true, phone: true } },
            panelClinic: { select: { name: true } },
          },
        },
        payments: { select: { kind: true, amount: true, reversedAt: true, receivedAt: true } },
        creditNotes: { select: { status: true, totalAmount: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const aging: Record<AgingBucket, number> = emptyAging();
    // How MANY invoices sit in each bucket, alongside how much. The dashboard
    // needs both: the amount is what gets chased, the count is what decides
    // whether a bucket is clean. Counted here rather than re-derived on the
    // client, so there is one bucket rule and not two.
    const agingCounts: Record<AgingBucket, number> = emptyAging();
    const rows = [];
    let unresolvedCount = 0;

    for (const invoice of invoices) {
      // An invoice whose split was never computed cannot be aged: we do not
      // know what the patient owes. It is counted and surfaced as a data
      // problem rather than folded in at either extreme.
      if (invoice.patientResponsibilityAmount === null) {
        unresolvedCount += 1;
        continue;
      }

      const balance = computePatientBalance({
        patientResponsibility: invoice.patientResponsibilityAmount,
        payments: invoice.payments.map((payment) => ({
          kind: payment.kind === PaymentKind.REFUND ? 'REFUND' : 'PAYMENT',
          amount: payment.amount,
          reversedAt: payment.reversedAt,
        })),
        creditNotes: invoice.creditNotes.map((note) => ({
          status: note.status as CreditNoteStatus,
          totalAmount: note.totalAmount,
        })),
      });

      if (balance.balanceCents === 0 && !params.includeSettled) continue;

      const ageDays = daysBetween(invoice.createdAt, asOf);
      accumulateAging(aging, ageDays, balance.balanceCents);
      accumulateAging(agingCounts, ageDays, 1);

      const lastPayment = invoice.payments
        .filter((payment) => !payment.reversedAt)
        .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0];

      rows.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.createdAt,
        ageDays,
        clinicName: invoice.visit?.clinic?.name ?? null,
        visitNumber: invoice.visit?.visitNumber ?? null,
        patientId: invoice.visit?.patient?.id ?? null,
        patientName: invoice.visit?.patient?.name ?? null,
        patientPhone: invoice.visit?.patient?.phone ?? null,
        panelName: invoice.visit?.panelClinic?.name ?? null,
        invoiceTotal: Number(invoice.totalAmount),
        patientResponsibility: Number(invoice.patientResponsibilityAmount),
        panelResponsibility:
          invoice.panelResponsibilityAmount === null ? null : Number(invoice.panelResponsibilityAmount),
        received: fromCents(balance.netReceivedCents),
        credited: fromCents(balance.creditedCents),
        balance: fromCents(balance.balanceCents),
        lastPaymentAt: lastPayment?.receivedAt ?? null,
      });
    }

    return {
      asOf: asOf.toISOString().slice(0, 10),
      totalOutstanding: fromCents(rows.reduce((total, row) => total + Math.round(row.balance * 100), 0)),
      invoiceCount: rows.length,
      unresolvedCount,
      aging: {
        current: fromCents(aging.CURRENT),
        d31_60: fromCents(aging.D31_60),
        d61_90: fromCents(aging.D61_90),
        d90_plus: fromCents(aging.D90_PLUS),
      },
      agingCounts: {
        current: agingCounts.CURRENT,
        d31_60: agingCounts.D31_60,
        d61_90: agingCounts.D61_90,
        d90_plus: agingCounts.D90_PLUS,
      },
      rows: rows.sort((a, b) => b.ageDays - a.ageDays),
    };
  }

  /**
   * THE PAYMENT REPORT — money movements in a period.
   *
   * Distinct from the sales report on purpose: this buckets by the date money
   * MOVED, the sales report buckets by the date a bill was RAISED, and a
   * clinic where those two are the same number every month is a clinic where
   * nobody has ever paid late.
   */
  async paymentReport(params: { clinicId?: string; from: string; to: string }) {
    const actor = await requirePermission(this.rawPrisma, 'finance.view');
    const clinicId = params.clinicId ?? actor.clinicId ?? undefined;
    const from = new Date(`${params.from}T00:00:00.000Z`);
    const to = new Date(new Date(`${params.to}T00:00:00.000Z`).getTime() + 86400000);

    const payments = await this.prisma.payment.findMany({
      where: { ...(clinicId ? { clinicId } : {}), receivedAt: { gte: from, lt: to } },
      orderBy: { receivedAt: 'desc' },
      include: {
        receivedBy: { select: { fullName: true } },
        clinic: { select: { name: true } },
        invoice: {
          select: {
            invoiceNumber: true,
            createdAt: true,
            totalAmount: true,
            visit: { select: { visitNumber: true, patient: { select: { name: true } } } },
          },
        },
      },
    });

    const byTender = new Map<string, { amountCents: number; count: number }>();
    let receivedCents = 0;
    let refundedCents = 0;

    for (const payment of payments) {
      if (payment.reversedAt) continue;
      const cents = Math.round(Number(payment.amount) * 100);
      if (payment.kind === PaymentKind.REFUND) refundedCents += cents;
      else receivedCents += cents;
      const bucket = byTender.get(payment.tender) ?? { amountCents: 0, count: 0 };
      bucket.amountCents += payment.kind === PaymentKind.REFUND ? -cents : cents;
      bucket.count += 1;
      byTender.set(payment.tender, bucket);
    }

    return {
      from: params.from,
      to: params.to,
      grossReceived: fromCents(receivedCents),
      refunded: fromCents(refundedCents),
      netReceived: fromCents(receivedCents - refundedCents),
      count: payments.length,
      byTender: [...byTender.entries()]
        .map(([tender, bucket]) => ({ tender, amount: fromCents(bucket.amountCents), count: bucket.count }))
        .sort((a, b) => b.amount - a.amount),
      rows: payments.map((payment) => ({
        id: payment.id,
        receivedAt: payment.receivedAt,
        kind: payment.kind,
        tender: payment.tender,
        methodLabel: payment.methodLabel,
        amount: Number(payment.amount),
        referenceNo: payment.referenceNo,
        receivedBy: payment.receivedBy?.fullName ?? null,
        clinicName: payment.clinic?.name ?? null,
        invoiceNumber: payment.invoice?.invoiceNumber ?? null,
        // The two dates side by side: this is the whole point of separating
        // payment from invoice, made visible in one row.
        invoiceDate: payment.invoice?.createdAt ?? null,
        invoiceTotal: payment.invoice ? Number(payment.invoice.totalAmount) : null,
        patientName: payment.invoice?.visit?.patient?.name ?? null,
        visitNumber: payment.invoice?.visit?.visitNumber ?? null,
        reversed: payment.reversedAt !== null,
        reversalReason: payment.reversalReason,
      })),
    };
  }
}
