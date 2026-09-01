import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DayEndStatus, InvoiceStatus, PaymentKind, PaymentTender } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, requirePermission, requireScope, resolveClinicId, withAdminTx, withScopedAdminTx } from './admin-actor';
import { recordAudit } from './admin-audit';
import { fromCents, toCents } from './money';
import { CountDayEndDto } from './dto/count-day-end.dto';
import { CloseDayEndDto } from './dto/close-day-end.dto';
import { ReopenDayEndDto } from './dto/reopen-day-end.dto';

/**
 * DAY-END CLOSING — a workflow, not a report. Owner brief §6B.
 *
 * The difference matters. A report can be re-run tomorrow and will say the
 * same thing. A closing records three facts that are unrecoverable afterwards:
 * what a named person counted in the drawer, what the system expected at that
 * moment, and what they said about the difference.
 *
 * THE FOUR TENDER BUCKETS are CASH, CARD, QR and OTHER. They are the four a
 * clinic can actually count independently at the end of a day: notes in a
 * drawer, a card terminal's settlement slip, a QR provider's daily total, and
 * everything else. E-wallet, bank transfer and cheque fold into OTHER because
 * nobody counts them separately at 9pm; PANEL folds into nothing at all,
 * because no money moved at the counter.
 */

const CASH = PaymentTender.CASH;
const CARD = PaymentTender.CARD;
const QR = PaymentTender.QR;

export type ExpectedTotals = {
  cashCents: number;
  cardCents: number;
  qrCents: number;
  otherCents: number;
  totalCents: number;
  paymentCount: number;
  refundCents: number;
};

/** Buckets a tender. One function, so no screen invents a fifth bucket. */
export function bucketOf(tender: PaymentTender): 'cash' | 'card' | 'qr' | 'other' | null {
  if (tender === CASH) return 'cash';
  if (tender === CARD) return 'card';
  if (tender === QR) return 'qr';
  // A PANEL "payment" is a settlement event with no money at the counter. It
  // must never appear in a drawer total that somebody is asked to physically
  // reconcile against.
  if (tender === PaymentTender.PANEL) return null;
  return 'other';
}

function utcDate(value: string | Date): Date {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : value;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayBounds(businessDate: Date) {
  const start = utcDate(businessDate);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

@Injectable()
export class DayEndService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * What the ledger says should be in the drawer.
   *
   * Computed from PAYMENTS, not from invoices. An invoice is what was billed;
   * a payment is what was taken, and only the second one is in the drawer.
   * Refunds are subtracted from their own bucket, because money handed back
   * came out of the same drawer it went into.
   */
  private async expectedFor(tx: AdminTx, clinicId: string, businessDate: Date): Promise<ExpectedTotals> {
    const { start, end } = dayBounds(businessDate);
    const payments = await tx.payment.findMany({
      where: { clinicId, receivedAt: { gte: start, lt: end }, reversedAt: null },
      select: { kind: true, tender: true, amount: true },
    });

    const totals: ExpectedTotals = {
      cashCents: 0,
      cardCents: 0,
      qrCents: 0,
      otherCents: 0,
      totalCents: 0,
      paymentCount: 0,
      refundCents: 0,
    };

    for (const payment of payments) {
      const bucket = bucketOf(payment.tender);
      if (!bucket) continue;
      const signed = (payment.kind === PaymentKind.REFUND ? -1 : 1) * toCents(payment.amount);
      if (bucket === 'cash') totals.cashCents += signed;
      else if (bucket === 'card') totals.cardCents += signed;
      else if (bucket === 'qr') totals.qrCents += signed;
      else totals.otherCents += signed;
      totals.totalCents += signed;
      totals.paymentCount += 1;
      if (payment.kind === PaymentKind.REFUND) totals.refundCents += toCents(payment.amount);
    }
    return totals;
  }

  /** The operational shape of the day, frozen alongside the money. */
  private async operationalFor(tx: AdminTx, clinicId: string, businessDate: Date) {
    const { start, end } = dayBounds(businessDate);
    const [invoiceCount, invoices, visits, panelInvoices] = await Promise.all([
      tx.invoice.count({ where: { visit: { clinicId }, createdAt: { gte: start, lt: end } } }),
      tx.invoice.findMany({
        where: { visit: { clinicId }, createdAt: { gte: start, lt: end }, status: { not: InvoiceStatus.CANCELLED } },
        select: {
          totalAmount: true,
          taxAmount: true,
          patientResponsibilityAmount: true,
          panelResponsibilityAmount: true,
        },
      }),
      tx.visit.count({ where: { clinicId, createdAt: { gte: start, lt: end } } }),
      tx.invoice.count({
        where: {
          visit: { clinicId },
          createdAt: { gte: start, lt: end },
          panelResponsibilityAmount: { gt: 0 },
        },
      }),
    ]);

    const billedCents = invoices.reduce((total, invoice) => total + toCents(invoice.totalAmount), 0);
    const taxCents = invoices.reduce((total, invoice) => total + toCents(invoice.taxAmount), 0);
    const panelCents = invoices.reduce((total, invoice) => total + toCents(invoice.panelResponsibilityAmount ?? 0), 0);
    const patientCents = invoices.reduce(
      (total, invoice) => total + toCents(invoice.patientResponsibilityAmount ?? 0),
      0,
    );

    return {
      invoiceCount,
      visitCount: visits,
      panelInvoiceCount: panelInvoices,
      billed: fromCents(billedCents),
      tax: fromCents(taxCents),
      panelPortion: fromCents(panelCents),
      patientPortion: fromCents(patientCents),
    };
  }

  /**
   * The day-end screen's read.
   *
   * While the day is OPEN this recomputes expected totals live, so a counter
   * refreshing at 8:55pm sees the payment taken at 8:54. Once CLOSED it
   * returns the FROZEN numbers, because a closing is a statement about a fixed
   * set of transactions, and re-deriving it would let a later correction
   * silently rewrite what somebody signed.
   */
  async view(clinicIdInput: string | undefined, dateInput: string) {
    const { scope } = await requireScope(this.rawPrisma, 'finance.view');
    const clinicId = resolveClinicId(scope, clinicIdInput);
    const businessDate = utcDate(dateInput);

    const closing = await this.prisma.dayEndClosing.findFirst({
      where: { clinicId, businessDate },
      include: {
        countedBy: { select: { id: true, fullName: true } },
        closedBy: { select: { id: true, fullName: true } },
        reopenedBy: { select: { id: true, fullName: true } },
      },
    });

    const frozen = closing?.status === DayEndStatus.CLOSED;
    const expected = frozen
      ? {
          cashCents: toCents(closing.expectedCash),
          cardCents: toCents(closing.expectedCard),
          qrCents: toCents(closing.expectedQr),
          otherCents: toCents(closing.expectedOther),
          totalCents: toCents(closing.expectedTotal),
          paymentCount: closing.paymentCount,
          // Filled from the day's payments below. A closed day was reporting
          // "Refunded RM0.00" directly above a movements table listing a
          // RM40 refund, because the frozen columns have no refund total to
          // read and this stood in a zero. Zero is a CLAIM — "no money was
          // handed back today" — and it was false.
          refundCents: 0,
        }
      : await this.expectedFor(this.prisma as unknown as AdminTx, clinicId, businessDate);

    const operational = frozen
      ? ((closing.snapshot as Record<string, unknown> | null)?.operational ?? null)
      : await this.operationalFor(this.prisma as unknown as AdminTx, clinicId, businessDate);

    const { start, end } = dayBounds(businessDate);
    const payments = await this.prisma.payment.findMany({
      where: { clinicId, receivedAt: { gte: start, lt: end } },
      orderBy: { receivedAt: 'asc' },
      include: {
        receivedBy: { select: { fullName: true } },
        invoice: { select: { invoiceNumber: true, visit: { select: { visitNumber: true } } } },
      },
    });

    /**
     * WHAT WAS HANDED BACK, on a closed day as much as an open one.
     *
     * Derived from the movements already loaded above rather than from a
     * frozen column, and that is safe for the one reason it would not be safe
     * for the expected totals: `payments` is append-only and a reversal is a
     * NEW row, so this set cannot change retrospectively. Reversed payments
     * are excluded on both sides, exactly as `expectedFor` excludes them.
     */
    if (frozen) {
      expected.refundCents = payments
        .filter((payment) => payment.kind === PaymentKind.REFUND && payment.reversedAt === null)
        .reduce((total, payment) => total + toCents(payment.amount), 0);
    }

    const countedTotalCents = closing
      ? toCents(closing.countedCash ?? 0) +
        toCents(closing.countedCard ?? 0) +
        toCents(closing.countedQr ?? 0) +
        toCents(closing.countedOther ?? 0)
      : 0;
    const anyCounted =
      closing !== null &&
      [closing.countedCash, closing.countedCard, closing.countedQr, closing.countedOther].some(
        (value) => value !== null,
      );

    return {
      clinicId,
      businessDate: businessDate.toISOString().slice(0, 10),
      status: closing?.status ?? DayEndStatus.OPEN,
      frozen,
      expected: {
        cash: fromCents(expected.cashCents),
        card: fromCents(expected.cardCents),
        qr: fromCents(expected.qrCents),
        other: fromCents(expected.otherCents),
        total: fromCents(expected.totalCents),
      },
      counted: closing
        ? {
            cash: closing.countedCash === null ? null : Number(closing.countedCash),
            card: closing.countedCard === null ? null : Number(closing.countedCard),
            qr: closing.countedQr === null ? null : Number(closing.countedQr),
            other: closing.countedOther === null ? null : Number(closing.countedOther),
            total: anyCounted ? fromCents(countedTotalCents) : null,
          }
        : { cash: null, card: null, qr: null, other: null, total: null },
      // Variance is only meaningful once somebody has counted. Before that it
      // is NULL, never zero — "not counted" and "counted and it matched" are
      // different states and only one of them is a day that can be closed.
      variance: anyCounted ? fromCents(countedTotalCents - expected.totalCents) : null,
      varianceReason: closing?.varianceReason ?? null,
      refunds: fromCents(expected.refundCents),
      paymentCount: expected.paymentCount,
      operational,
      countedBy: closing?.countedBy?.fullName ?? null,
      countedAt: closing?.countedAt ?? null,
      closedBy: closing?.closedBy?.fullName ?? null,
      closedAt: closing?.closedAt ?? null,
      reopenedBy: closing?.reopenedBy?.fullName ?? null,
      reopenedAt: closing?.reopenedAt ?? null,
      reopenReason: closing?.reopenReason ?? null,
      reopenCount: closing?.reopenCount ?? 0,
      payments: payments.map((payment) => ({
        id: payment.id,
        kind: payment.kind,
        tender: payment.tender,
        methodLabel: payment.methodLabel,
        amount: Number(payment.amount),
        receivedAt: payment.receivedAt,
        referenceNo: payment.referenceNo,
        receivedBy: payment.receivedBy?.fullName ?? null,
        invoiceNumber: payment.invoice?.invoiceNumber ?? null,
        visitNumber: payment.invoice?.visit?.visitNumber ?? null,
        reversed: payment.reversedAt !== null,
      })),
    };
  }

  /** Record what was physically counted. Repeatable until the day is closed. */
  async count(clinicIdInput: string | undefined, dateInput: string, dto: CountDayEndDto) {
    return withScopedAdminTx(this.rawPrisma, 'dayEnd.count', async (tx, actor, scope) => {
      const clinicId = resolveClinicId(scope, clinicIdInput);
      const businessDate = utcDate(dateInput);
      const existing = await tx.dayEndClosing.findFirst({ where: { clinicId, businessDate } });
      if (existing?.status === DayEndStatus.CLOSED) {
        throw new BadRequestException('This day has been closed. Reopen it before recording a new count.');
      }

      const expected = await this.expectedFor(tx, clinicId, businessDate);
      const countedCents =
        toCents(dto.cash ?? 0) + toCents(dto.card ?? 0) + toCents(dto.qr ?? 0) + toCents(dto.other ?? 0);
      const varianceCents = countedCents - expected.totalCents;

      const data = {
        status: DayEndStatus.COUNTED,
        expectedCash: fromCents(expected.cashCents),
        expectedCard: fromCents(expected.cardCents),
        expectedQr: fromCents(expected.qrCents),
        expectedOther: fromCents(expected.otherCents),
        expectedTotal: fromCents(expected.totalCents),
        countedCash: dto.cash ?? null,
        countedCard: dto.card ?? null,
        countedQr: dto.qr ?? null,
        countedOther: dto.other ?? null,
        varianceAmount: fromCents(varianceCents),
        varianceReason: dto.varianceReason ?? null,
        paymentCount: expected.paymentCount,
        countedByStaffId: actor.id,
        countedAt: new Date(),
      };

      const closing = existing
        ? await tx.dayEndClosing.update({ where: { id: existing.id }, data })
        : await tx.dayEndClosing.create({
            data: { ...data, tenantId: currentTenantId(), clinicId, businessDate },
          });

      await recordAudit(tx, actor, {
        action: 'dayEnd.counted',
        entityType: 'DayEndClosing',
        entityId: closing.id,
        before: existing
          ? { countedCash: existing.countedCash, countedCard: existing.countedCard, countedQr: existing.countedQr }
          : null,
        after: {
          businessDate: businessDate.toISOString().slice(0, 10),
          counted: { cash: dto.cash, card: dto.card, qr: dto.qr, other: dto.other },
          expectedTotal: fromCents(expected.totalCents),
          variance: fromCents(varianceCents),
        },
        reason: dto.varianceReason ?? null,
        source: 'finance.dayEnd',
      });

      return closing;
    });
  }

  /**
   * Sign the day off.
   *
   * Refuses two things:
   *   - closing a day nobody has counted (there is nothing to sign)
   *   - closing with an unexplained variance. A difference between the drawer
   *     and the ledger is the single most important thing a day-end produces,
   *     and letting it through silently is what makes the whole workflow
   *     decorative.
   */
  async close(clinicIdInput: string | undefined, dateInput: string, dto: CloseDayEndDto) {
    return withScopedAdminTx(this.rawPrisma, 'dayEnd.close', async (tx, actor, scope) => {
      const clinicId = resolveClinicId(scope, clinicIdInput);
      const businessDate = utcDate(dateInput);
      const closing = await tx.dayEndClosing.findFirst({ where: { clinicId, businessDate } });
      if (!closing) {
        throw new BadRequestException('Record the day’s count before closing it.');
      }
      if (closing.status === DayEndStatus.CLOSED) {
        throw new BadRequestException('This day is already closed.');
      }
      if (closing.countedAt === null) {
        throw new BadRequestException('Record the day’s count before closing it.');
      }

      const varianceCents = toCents(closing.varianceAmount ?? 0);
      const reason = dto.varianceReason ?? closing.varianceReason;
      if (varianceCents !== 0 && !reason?.trim()) {
        throw new BadRequestException(
          `The count differs from the ledger by ${fromCents(varianceCents)}. Explain the difference before closing.`,
        );
      }

      const operational = await this.operationalFor(tx, clinicId, businessDate);
      const { start, end } = dayBounds(businessDate);

      const updated = await tx.dayEndClosing.update({
        where: { id: closing.id },
        data: {
          status: DayEndStatus.CLOSED,
          varianceReason: reason ?? null,
          closedByStaffId: actor.id,
          closedAt: new Date(),
          invoiceCount: operational.invoiceCount,
          snapshot: { operational } as never,
        },
      });

      // Stamp the day's payments so they can no longer be reversed without
      // reopening. Write-once at the database level: the append-only trigger
      // refuses a second value, so a payment cannot be quietly re-attributed
      // to a different day.
      await tx.payment.updateMany({
        where: { clinicId, receivedAt: { gte: start, lt: end }, dayEndClosingId: null },
        data: { dayEndClosingId: closing.id },
      });

      await recordAudit(tx, actor, {
        action: 'dayEnd.closed',
        entityType: 'DayEndClosing',
        entityId: closing.id,
        before: { status: closing.status },
        after: {
          status: DayEndStatus.CLOSED,
          businessDate: businessDate.toISOString().slice(0, 10),
          expectedTotal: String(closing.expectedTotal),
          variance: String(closing.varianceAmount ?? 0),
        },
        reason: reason ?? null,
        source: 'finance.dayEnd',
      });

      return updated;
    });
  }

  /**
   * Reopen a closed day. Permission-gated, reason-mandatory, and counted.
   *
   * `reopenCount` exists so that a branch that reopens its days routinely is
   * visible as a pattern rather than as a series of individually reasonable
   * one-offs.
   */
  async reopen(clinicIdInput: string | undefined, dateInput: string, dto: ReopenDayEndDto) {
    return withScopedAdminTx(this.rawPrisma, 'dayEnd.reopen', async (tx, actor, scope) => {
      const clinicId = resolveClinicId(scope, clinicIdInput);
      const businessDate = utcDate(dateInput);
      const closing = await tx.dayEndClosing.findFirst({ where: { clinicId, businessDate } });
      if (!closing) throw new NotFoundException('No day-end closing for that date.');
      if (closing.status !== DayEndStatus.CLOSED) {
        throw new BadRequestException('This day is not closed.');
      }

      const updated = await tx.dayEndClosing.update({
        where: { id: closing.id },
        data: {
          status: DayEndStatus.COUNTED,
          reopenedByStaffId: actor.id,
          reopenedAt: new Date(),
          reopenReason: dto.reason,
          reopenCount: { increment: 1 },
        },
      });

      await recordAudit(tx, actor, {
        action: 'dayEnd.reopened',
        entityType: 'DayEndClosing',
        entityId: closing.id,
        before: {
          status: DayEndStatus.CLOSED,
          closedBy: closing.closedByStaffId,
          closedAt: closing.closedAt,
          expectedTotal: String(closing.expectedTotal),
        },
        after: { status: DayEndStatus.COUNTED, reopenCount: closing.reopenCount + 1 },
        reason: dto.reason,
        source: 'finance.dayEnd',
      });

      return updated;
    });
  }

  /** The month's closings — the finance homepage's "did every day reconcile" strip. */
  async listRange(clinicIdInput: string | undefined, from: string, to: string) {
    const { scope } = await requireScope(this.rawPrisma, 'finance.view');
    const clinicId = resolveClinicId(scope, clinicIdInput);
    const closings = await this.prisma.dayEndClosing.findMany({
      where: { clinicId, businessDate: { gte: utcDate(from), lte: utcDate(to) } },
      orderBy: { businessDate: 'desc' },
      include: { closedBy: { select: { fullName: true } }, countedBy: { select: { fullName: true } } },
    });
    return closings.map((closing) => ({
      id: closing.id,
      businessDate: closing.businessDate.toISOString().slice(0, 10),
      status: closing.status,
      expectedTotal: Number(closing.expectedTotal),
      variance: closing.varianceAmount === null ? null : Number(closing.varianceAmount),
      varianceReason: closing.varianceReason,
      countedBy: closing.countedBy?.fullName ?? null,
      closedBy: closing.closedBy?.fullName ?? null,
      closedAt: closing.closedAt,
      reopenCount: closing.reopenCount,
    }));
  }

  /**
   * The days that have NOT been closed and are no longer today.
   *
   * The finance module's first question — "did yesterday reconcile" — is
   * answered by this being empty.
   */
  async openDays(clinicIdInput: string | undefined, lookbackDays = 30) {
    const { scope } = await requireScope(this.rawPrisma, 'finance.view');
    const clinicId = resolveClinicId(scope, clinicIdInput);
    const today = utcDate(new Date());
    const since = new Date(today.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    // Days with money taken, and what has been closed. The gap between the two
    // is the work queue — a day nobody opened a closing for is exactly as
    // unreconciled as one left half-counted.
    const payments = await this.prisma.payment.groupBy({
      by: ['clinicId'],
      where: { clinicId, receivedAt: { gte: since, lt: today }, reversedAt: null },
      _count: true,
    });
    if (payments.length === 0) return [];

    const rows = await this.prisma.$queryRaw<{ business_date: Date; total: string; count: bigint }[]>`
      SELECT date_trunc('day', p."received_at")::date AS business_date,
             SUM(CASE WHEN p."kind" = 'REFUND' THEN -p."amount" ELSE p."amount" END) AS total,
             COUNT(*) AS count
      FROM "payments" p
      WHERE p."clinic_id" = ${clinicId}
        AND p."received_at" >= ${since}
        AND p."received_at" < ${today}
        AND p."reversed_at" IS NULL
        AND p."tender" <> 'PANEL'
      GROUP BY 1
      ORDER BY 1 DESC
    `;

    const closed = await this.prisma.dayEndClosing.findMany({
      where: { clinicId, businessDate: { gte: since, lt: today } },
      select: { businessDate: true, status: true },
    });
    const closedDates = new Set(
      closed.filter((row) => row.status === DayEndStatus.CLOSED).map((row) => row.businessDate.toISOString().slice(0, 10)),
    );
    const statusByDate = new Map(closed.map((row) => [row.businessDate.toISOString().slice(0, 10), row.status]));

    return rows
      .map((row) => ({
        businessDate: new Date(row.business_date).toISOString().slice(0, 10),
        expectedTotal: Number(row.total),
        paymentCount: Number(row.count),
        status: statusByDate.get(new Date(row.business_date).toISOString().slice(0, 10)) ?? DayEndStatus.OPEN,
      }))
      .filter((row) => !closedDates.has(row.businessDate));
  }
}
