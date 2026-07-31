import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClaimBatchStatus, ClaimLineStatus, InvoiceStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateClaimBatchDto } from './dto/create-claim-batch.dto';
import { SubmitClaimBatchDto } from './dto/submit-claim-batch.dto';
import { RecordClaimLinePaymentDto } from './dto/record-claim-line-payment.dto';

const BATCH_INCLUDE = { lines: { include: { invoice: true } } } as const;

// A line still "occupying" its invoice — an invoice can only be re-claimed
// once every prior line is REJECTED or DEDUCTED (D-041's resubmission
// workflow).
const ACTIVE_LINE_STATUSES: ClaimLineStatus[] = [
  ClaimLineStatus.PENDING,
  ClaimLineStatus.ACCEPTED,
  ClaimLineStatus.PAID,
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Clinical Operations, Phase 1e (Panel Claims Core). One status lifecycle
// for every panel (D-031) — batching has no fixed period, and "Submitted"
// records a method rather than branching per panel. Line-level status
// exists because a real batch commonly has some invoices accepted-and-paid
// and others rejected/deducted within the same submission.
@Injectable()
export class ClaimBatchService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  private async nextBatchNumber(): Promise<string> {
    const count = await this.prisma.claimBatch.count();
    return `CLAIM-${String(count + 1).padStart(6, '0')}`;
  }

  // Invoices a panel's claim batch can pull from: PAID, panel-covered
  // amount > 0, and not already claimed (D-029/D-031 — front desk's
  // eligibility check is external; this is purely "what's left to claim").
  findEligibleInvoices(panelClinicId: string) {
    return this.prisma.invoice.findMany({
      where: {
        status: InvoiceStatus.PAID,
        panelCoveredAmount: { gt: 0 },
        // D-041: an invoice is claimable while no line "occupies" it —
        // rejected/deducted prior claims don't block a resubmission.
        claimBatchLines: { none: { status: { in: ACTIVE_LINE_STATUSES } } },
        visit: { panelClinicId },
      },
      include: { visit: { include: { patient: true } } },
      orderBy: { paidAt: 'asc' },
    });
  }

  async createBatch(dto: CreateClaimBatchDto) {
    const tenantId = currentTenantId();
    const invoices = await this.prisma.invoice.findMany({
      where: { id: { in: dto.invoiceIds } },
      include: { visit: true },
    });
    if (invoices.length !== dto.invoiceIds.length) {
      throw new NotFoundException('One or more invoices not found');
    }
    for (const invoice of invoices) {
      if (invoice.status !== InvoiceStatus.PAID) {
        throw new BadRequestException(`Invoice ${invoice.invoiceNumber} is not PAID`);
      }
      if (invoice.visit.panelClinicId !== dto.panelClinicId) {
        throw new BadRequestException(`Invoice ${invoice.invoiceNumber} does not belong to this panel`);
      }
      if (Number(invoice.panelCoveredAmount) <= 0) {
        throw new BadRequestException(`Invoice ${invoice.invoiceNumber} has no panel-covered amount to claim`);
      }
    }
    const alreadyClaimed = await this.prisma.claimBatchLine.findMany({
      where: { invoiceId: { in: dto.invoiceIds }, status: { in: ACTIVE_LINE_STATUSES } },
    });
    if (alreadyClaimed.length > 0) {
      throw new BadRequestException('One or more invoices have already been claimed in another batch');
    }

    const batch = await this.prisma.claimBatch.create({
      data: {
        tenantId,
        panelClinicId: dto.panelClinicId,
        batchNumber: await this.nextBatchNumber(),
        createdByStaffId: dto.createdByStaffId,
      },
    });

    // D-041 — the panel's add-on fee, applied per line at batch creation
    // ("claim RM100 → claimed RM108"): receivable = claimed + fee.
    const feePercent = dto.feePercent ?? 0;
    for (const invoice of invoices) {
      await this.prisma.claimBatchLine.create({
        data: {
          tenantId,
          claimBatchId: batch.id,
          invoiceId: invoice.id,
          claimedAmount: invoice.panelCoveredAmount,
          feeAmount: round2((Number(invoice.panelCoveredAmount) * feePercent) / 100),
        },
      });
    }

    return this.findById(batch.id);
  }

  listByPanel(panelClinicId?: string) {
    return this.prisma.claimBatch.findMany({
      where: { panelClinicId },
      include: BATCH_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const batch = await this.prisma.claimBatch.findUnique({ where: { id }, include: BATCH_INCLUDE });
    if (!batch) {
      throw new NotFoundException('Claim batch not found');
    }
    return batch;
  }

  async submit(id: string, dto: SubmitClaimBatchDto) {
    const batch = await this.findById(id);
    if (batch.status !== ClaimBatchStatus.BATCHED) {
      throw new BadRequestException(`Cannot submit a batch in status ${batch.status}`);
    }
    return this.prisma.claimBatch.update({
      where: { id },
      data: {
        status: ClaimBatchStatus.SUBMITTED,
        submittedAt: new Date(),
        submissionMethod: dto.submissionMethod,
        submissionReference: dto.submissionReference,
      },
      include: BATCH_INCLUDE,
    });
  }

  // Records one line's outcome (accepted/rejected/deducted/paid) within an
  // already-submitted batch, then recomputes the batch's own status from
  // all its lines — PAID only once every line is PAID, PARTIALLY_PAID once
  // at least one is, matching §18's "a partial payment must correctly
  // reduce the outstanding balance without closing the claim".
  async recordLinePayment(batchId: string, lineId: string, dto: RecordClaimLinePaymentDto) {
    const batch = await this.findById(batchId);
    if (batch.status === ClaimBatchStatus.BATCHED) {
      throw new BadRequestException('Cannot record a payment on a batch that has not been submitted yet');
    }
    if (batch.status === ClaimBatchStatus.RECONCILED) {
      throw new BadRequestException('Cannot modify a reconciled batch');
    }
    const line = batch.lines.find((candidate) => candidate.id === lineId);
    if (!line) {
      throw new NotFoundException('Claim batch line not found on this batch');
    }

    await this.prisma.claimBatchLine.update({
      where: { id: lineId },
      data: {
        status: dto.status as ClaimLineStatus,
        paidAmount: dto.paidAmount,
        deductionReason: dto.deductionReason,
        remarks: dto.remarks,
      },
    });

    const refreshed = await this.findById(batchId);
    const allSettled = refreshed.lines.every((candidate) => candidate.status !== ClaimLineStatus.PENDING);
    const allPaid = refreshed.lines.every((candidate) => candidate.status === ClaimLineStatus.PAID);
    const anyPaid = refreshed.lines.some((candidate) => candidate.status === ClaimLineStatus.PAID);
    const nextStatus = allPaid
      ? ClaimBatchStatus.PAID
      : anyPaid || allSettled
        ? ClaimBatchStatus.PARTIALLY_PAID
        : refreshed.status;

    return this.prisma.claimBatch.update({
      where: { id: batchId },
      data: { status: nextStatus },
      include: BATCH_INCLUDE,
    });
  }

  async reconcile(id: string) {
    const batch = await this.findById(id);
    if (batch.status === ClaimBatchStatus.BATCHED) {
      throw new BadRequestException('Cannot reconcile a batch that has not been submitted');
    }
    return this.prisma.claimBatch.update({
      where: { id },
      data: { status: ClaimBatchStatus.RECONCILED, reconciledAt: new Date() },
      include: BATCH_INCLUDE,
    });
  }

  // Outstanding-aging surface (§3E/§12) — batches not yet fully closed out,
  // with days-since-submission for reconciliation follow-up. D-041:
  // receivable includes the add-on fee, and `overdue` is judged against the
  // panel's own payment term rather than a fixed bucket.
  async listOutstanding() {
    const batches = await this.prisma.claimBatch.findMany({
      where: { status: { in: [ClaimBatchStatus.SUBMITTED, ClaimBatchStatus.PARTIALLY_PAID] } },
      include: { lines: true, panelClinic: true },
      orderBy: { submittedAt: 'asc' },
    });
    return batches.map((batch) => {
      const claimedTotal = round2(batch.lines.reduce((sum, line) => sum + Number(line.claimedAmount), 0));
      const feeTotal = round2(batch.lines.reduce((sum, line) => sum + Number(line.feeAmount), 0));
      const paidTotal = round2(batch.lines.reduce((sum, line) => sum + Number(line.paidAmount ?? 0), 0));
      const daysOutstanding = batch.submittedAt
        ? Math.floor((Date.now() - batch.submittedAt.getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      const paymentTermDays = batch.panelClinic.paymentTermDays ?? null;
      return {
        ...batch,
        claimedTotal,
        feeTotal,
        paidTotal,
        outstandingAmount: round2(claimedTotal + feeTotal - paidTotal),
        daysOutstanding,
        paymentTermDays,
        overdue: paymentTermDays !== null && daysOutstanding > paymentTermDays,
      };
    });
  }

  // ------ Panel workbook upgrade (D-041) ------

  // Per-panel claim listing — the working view staff actually use day to
  // day, mirroring the owner's per-panel sheet: one row per claim with
  // service date / month / due-days-vs-term / claimed / fee / to-receive /
  // paid / receivable / remarks.
  async listLines(panelClinicId: string, month?: string) {
    const panel = await this.prisma.panelClinic.findUnique({ where: { id: panelClinicId } });
    if (!panel) {
      throw new NotFoundException('Panel not found');
    }
    const lines = await this.prisma.claimBatchLine.findMany({
      where: { claimBatch: { panelClinicId } },
      include: {
        claimBatch: true,
        invoice: { include: { visit: { include: { patient: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const termDays = panel.paymentTermDays ?? null;
    return lines
      .map((line) => {
        const serviceDate = line.invoice.paidAt ?? line.invoice.createdAt;
        const monthKey = serviceDate.toISOString().slice(0, 7);
        const claimed = Number(line.claimedAmount);
        const fee = Number(line.feeAmount);
        const paid = Number(line.paidAmount ?? 0);
        const submittedAt = line.claimBatch.submittedAt;
        const daysSinceSubmission = submittedAt
          ? Math.floor((Date.now() - submittedAt.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        return {
          id: line.id,
          claimBatchId: line.claimBatchId,
          batchNumber: line.claimBatch.batchNumber,
          batchStatus: line.claimBatch.status,
          submissionReference: line.claimBatch.submissionReference,
          status: line.status,
          serviceDate,
          monthKey,
          patientName: line.invoice.visit.patient.name,
          invoiceNumber: line.invoice.invoiceNumber,
          claimedAmount: claimed,
          feeAmount: fee,
          claimToReceive: round2(claimed + fee),
          paidAmount: paid,
          receivable: round2(claimed + fee - paid),
          remarks: line.remarks,
          deductionReason: line.deductionReason,
          daysSinceSubmission,
          paymentTermDays: termDays,
          overdue:
            termDays !== null &&
            daysSinceSubmission !== null &&
            daysSinceSubmission > termDays &&
            line.status !== ClaimLineStatus.PAID &&
            line.status !== ClaimLineStatus.REJECTED,
        };
      })
      .filter((line) => !month || line.monthKey === month);
  }

  // Yearly per-panel rollup — the owner's SUMMARY PANEL CLAIMS sheet:
  // claimed / fee / receivable / paid / outstanding per panel for a year.
  async getYearlySummary(year: number) {
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));
    const lines = await this.prisma.claimBatchLine.findMany({
      where: { createdAt: { gte: from, lt: to } },
      include: { claimBatch: { include: { panelClinic: true } } },
    });
    const byPanel = new Map<
      string,
      { panelName: string; claims: number; claimed: number; fee: number; paid: number }
    >();
    for (const line of lines) {
      const panel = line.claimBatch.panelClinic;
      const bucket = byPanel.get(panel.id) ?? { panelName: panel.name, claims: 0, claimed: 0, fee: 0, paid: 0 };
      bucket.claims += 1;
      bucket.claimed += Number(line.claimedAmount);
      bucket.fee += Number(line.feeAmount);
      bucket.paid += Number(line.paidAmount ?? 0);
      byPanel.set(panel.id, bucket);
    }
    return Array.from(byPanel.entries())
      .map(([panelClinicId, bucket]) => ({
        panelClinicId,
        panelName: bucket.panelName,
        claims: bucket.claims,
        claimedTotal: round2(bucket.claimed),
        feeTotal: round2(bucket.fee),
        receivableTotal: round2(bucket.claimed + bucket.fee),
        paidTotal: round2(bucket.paid),
        outstandingTotal: round2(bucket.claimed + bucket.fee - bucket.paid),
      }))
      .sort((a, b) => b.claimedTotal - a.claimedTotal);
  }
}
