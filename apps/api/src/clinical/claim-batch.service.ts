import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClaimBatchStatus, ClaimLineStatus, InvoiceStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateClaimBatchDto } from './dto/create-claim-batch.dto';
import { SubmitClaimBatchDto } from './dto/submit-claim-batch.dto';
import { RecordClaimLinePaymentDto } from './dto/record-claim-line-payment.dto';

const BATCH_INCLUDE = { lines: { include: { invoice: true } } } as const;

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
        claimBatchLine: null,
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
      where: { invoiceId: { in: dto.invoiceIds } },
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

    for (const invoice of invoices) {
      await this.prisma.claimBatchLine.create({
        data: {
          tenantId,
          claimBatchId: batch.id,
          invoiceId: invoice.id,
          claimedAmount: invoice.panelCoveredAmount,
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
  // with days-since-submission for reconciliation follow-up.
  async listOutstanding() {
    const batches = await this.prisma.claimBatch.findMany({
      where: { status: { in: [ClaimBatchStatus.SUBMITTED, ClaimBatchStatus.PARTIALLY_PAID] } },
      include: { lines: true, panelClinic: true },
      orderBy: { submittedAt: 'asc' },
    });
    return batches.map((batch) => {
      const claimedTotal = batch.lines.reduce((sum, line) => sum + Number(line.claimedAmount), 0);
      const paidTotal = batch.lines.reduce((sum, line) => sum + Number(line.paidAmount ?? 0), 0);
      const daysOutstanding = batch.submittedAt
        ? Math.floor((Date.now() - batch.submittedAt.getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      return { ...batch, claimedTotal, paidTotal, outstandingAmount: claimedTotal - paidTotal, daysOutstanding };
    });
  }
}
