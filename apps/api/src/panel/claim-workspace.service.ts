import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ClaimLineStatus, PanelClaimStatus, Prisma } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import {
  AgingBucket,
  accumulateAging,
  computeClaimBalance,
  daysBetween,
  emptyAging,
  rollUpClaims,
} from '../finance/financial-invariants';
import { fromCents, toCents } from '../finance/money';
import { AdjudicateClaimDto } from './dto/adjudicate-claim.dto';
import { SubmitBatchDto } from './dto/submit-batch.dto';
import { WriteOffClaimDto } from './dto/write-off-claim.dto';
import { RecordRemittanceDto } from './dto/record-remittance.dto';
import { ResubmitClaimDto } from './dto/resubmit-claim.dto';

/**
 * THE PANEL CLAIM WORKSPACE.
 *
 * WHAT IT IS NOT: an integration. No panel in the owner's list — PMCare,
 * MiCare, AIA, TNB Healthcare, Health Connect, Compumed, eMAS, Red Alert,
 * MedKad, Mednefit, PERKESO — exposes an API Kuwick can submit to (D-031).
 * Staff open each portal and key the claim in by hand, and nothing in this
 * module says otherwise: "Submitted" records that a PERSON submitted it, with
 * the method, the date and the reference they were given back.
 *
 * WHAT IT IS: the four questions the module exists to answer, in the order the
 * brief puts them —
 *
 *   What has not been submitted?
 *   What was rejected, and what are we doing about it?
 *   What money is still outstanding?
 *   Does it reconcile?
 *
 * THE ARITHMETIC IS NOT HERE. Every receivable figure comes from
 * `financial-invariants.computeClaimBalance`, the same pure function the
 * finance dashboard and the invariant tests use — so the panel screen and the
 * finance screen cannot report different outstanding totals.
 */
@Injectable()
export class ClaimWorkspaceService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * `ClaimLineStatus` from `PanelClaimStatus`.
   *
   * The old five-value status is read by existing code (reports, the current
   * claims page). Rather than migrate every reader at once, the two are kept
   * in step HERE — one writer, so they cannot disagree, and the old column can
   * be retired later when its last reader is gone.
   */
  private static legacyStatusOf(status: PanelClaimStatus): ClaimLineStatus {
    switch (status) {
      case 'PAID':
      case 'PARTIALLY_PAID':
        return ClaimLineStatus.PAID;
      case 'APPROVED':
      case 'ACKNOWLEDGED':
        return ClaimLineStatus.ACCEPTED;
      case 'PARTIALLY_APPROVED':
        return ClaimLineStatus.DEDUCTED;
      case 'REJECTED':
      case 'RESUBMISSION_REQUIRED':
      case 'WRITTEN_OFF':
        return ClaimLineStatus.REJECTED;
      default:
        return ClaimLineStatus.PENDING;
    }
  }

  private async logEvent(
    tx: AdminTx,
    input: {
      claimLineId: string;
      eventType: string;
      fromStatus?: PanelClaimStatus | null;
      toStatus?: PanelClaimStatus | null;
      amount?: Prisma.Decimal | number | string | null;
      reason?: string | null;
      reference?: string | null;
      actorStaffId: string;
    },
  ) {
    await tx.claimEvent.create({
      data: {
        tenantId: currentTenantId(),
        claimBatchLineId: input.claimLineId,
        eventType: input.eventType,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        amount: (input.amount ?? null) as never,
        reason: input.reason ?? null,
        reference: input.reference ?? null,
        actorStaffId: input.actorStaffId,
      },
    });
  }

  // ==========================================================================
  // QUESTION 1 — what has not been submitted?
  // ==========================================================================

  /**
   * Claims sitting in a batch that nobody has sent, plus the ones that cannot
   * be sent because something is missing.
   *
   * READINESS IS CHECKED, NOT ASSUMED. Each panel's `documentRequirements` and
   * `requiresItemisation` decide what "complete" means for that panel, and a
   * claim missing something is listed with what is absent — so the staff member
   * fixes it before opening the portal rather than after being rejected.
   */
  async submissionQueue(panelClinicId?: string) {
    await requirePermission(this.rawPrisma, 'panel.view');

    const lines = await this.prisma.claimBatchLine.findMany({
      where: {
        claimStatus: { in: ['BATCHED', 'READY', 'NEEDS_INFORMATION'] },
        ...(panelClinicId ? { claimBatch: { panelClinicId } } : {}),
      },
      include: {
        claimBatch: { include: { panelClinic: true } },
        invoice: {
          include: {
            visit: {
              select: {
                visitNumber: true,
                createdAt: true,
                clinic: { select: { name: true } },
                patient: { select: { name: true, identifierValue: true } },
                staff: { select: { fullName: true } },
                diagnoses: { where: { recordStatus: 'ACTIVE' }, select: { name: true }, take: 3 },
              },
            },
            lines: { where: { cancelledAt: null }, select: { id: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return lines.map((line) => {
      const panel = line.claimBatch.panelClinic;
      const visit = line.invoice.visit;
      const missing: string[] = [];
      if (!visit?.patient?.identifierValue) missing.push('Patient IC / passport number');
      if (panel.requiresItemisation && line.invoice.lines.length === 0) {
        missing.push('Itemised bill lines (this panel requires itemisation)');
      }
      if ((visit?.diagnoses?.length ?? 0) === 0) missing.push('Diagnosis');
      if (!visit?.staff?.fullName) missing.push('Attending doctor');

      const balance = computeClaimBalance({
        claimedAmount: line.claimedAmount,
        feeAmount: line.feeAmount,
        approvedAmount: line.approvedAmount,
        rejectedAmount: line.rejectedAmount,
        receivedAmount: line.paidAmount,
        writtenOffAmount: line.writtenOffAmount,
      });

      return {
        claimLineId: line.id,
        batchId: line.claimBatchId,
        batchNumber: line.claimBatch.batchNumber,
        panelClinicId: panel.id,
        panelName: panel.name,
        payerName: panel.payerName,
        portalUrl: panel.portalUrl,
        submissionMethod: panel.submissionMethod,
        documentRequirements: panel.documentRequirements,
        invoiceId: line.invoiceId,
        invoiceNumber: line.invoice.invoiceNumber,
        visitNumber: visit?.visitNumber ?? null,
        serviceDate: visit?.createdAt ?? null,
        clinicName: visit?.clinic?.name ?? null,
        patientName: visit?.patient?.name ?? null,
        patientIdentifier: visit?.patient?.identifierValue ?? null,
        doctorName: visit?.staff?.fullName ?? null,
        diagnoses: visit?.diagnoses?.map((diagnosis) => diagnosis.name) ?? [],
        claimedAmount: Number(line.claimedAmount),
        feeAmount: Number(line.feeAmount),
        expectedReceivable: fromCents(balance.expectedReceivableCents),
        status: line.claimStatus,
        ready: missing.length === 0,
        missing,
      };
    });
  }

  /**
   * Mark a batch submitted.
   *
   * Records who submitted it, by what method, on what date, and with what
   * reference the portal gave back. It does NOT submit anything, and the
   * wording of every message here says so.
   */
  async markBatchSubmitted(batchId: string, dto: SubmitBatchDto) {
    return withAdminTx(this.rawPrisma, 'panel.claim.submit', async (tx, actor) => {
      const batch = await tx.claimBatch.findUnique({
        where: { id: batchId },
        include: {
          lines: { select: { id: true, claimStatus: true } },
          panelClinic: { select: { paymentTermDays: true } },
        },
      });
      if (!batch) throw new NotFoundException('Claim batch not found');
      if (batch.submittedAt) {
        throw new ConflictException('This batch has already been marked submitted.');
      }

      const submittedAt = dto.submittedAt ? new Date(dto.submittedAt) : new Date();
      const dueDate = batch.panelClinic.paymentTermDays
        ? new Date(submittedAt.getTime() + batch.panelClinic.paymentTermDays * 86400000)
        : null;

      await tx.claimBatch.update({
        where: { id: batchId },
        data: {
          status: 'SUBMITTED',
          submittedAt,
          submissionMethod: dto.submissionMethod,
          submissionReference: dto.submissionReference ?? null,
        },
      });

      for (const line of batch.lines) {
        await tx.claimBatchLine.update({
          where: { id: line.id },
          data: {
            claimStatus: PanelClaimStatus.SUBMITTED,
            submittedAt,
            dueDate,
            ...(dto.panelClaimNumbers?.[line.id] ? { panelClaimNo: dto.panelClaimNumbers[line.id] } : {}),
          },
        });
        await this.logEvent(tx, {
          claimLineId: line.id,
          eventType: 'SUBMITTED',
          fromStatus: line.claimStatus,
          toStatus: PanelClaimStatus.SUBMITTED,
          reason: `Submitted by ${actor.fullName} via ${dto.submissionMethod}`,
          reference: dto.submissionReference ?? null,
          actorStaffId: actor.id,
        });
      }

      await recordAudit(tx, actor, {
        action: 'panel.claim.statusChanged',
        entityType: 'ClaimBatch',
        entityId: batchId,
        before: { status: batch.status, submittedAt: null },
        after: {
          status: 'SUBMITTED',
          submittedAt,
          method: dto.submissionMethod,
          reference: dto.submissionReference,
          lineCount: batch.lines.length,
        },
        source: 'panel.submission',
      });

      return { batchId, submittedAt, dueDate, lines: batch.lines.length };
    });
  }

  // ==========================================================================
  // QUESTION 2 — what did the panel say?
  // ==========================================================================

  /**
   * Record adjudication: what the panel approved and what it refused.
   *
   * THE RULE: approved + rejected must not exceed what was claimed. A panel
   * that "approves" more than was asked for is a typo, and letting it through
   * silently inflates a receivable that will never be collected.
   *
   * Recording adjudication does NOT record money. `approvedAmount` is a
   * promise; a `PanelRemittance` is a payment. The gap between them is the
   * whole point of the outstanding report.
   */
  async adjudicate(claimLineId: string, dto: AdjudicateClaimDto) {
    return withAdminTx(this.rawPrisma, 'panel.claim.manage', async (tx, actor) => {
      const line = await tx.claimBatchLine.findUnique({
        where: { id: claimLineId },
        select: {
          id: true,
          claimStatus: true,
          claimedAmount: true,
          feeAmount: true,
          approvedAmount: true,
          rejectedAmount: true,
          paidAmount: true,
          writtenOffAmount: true,
        },
      });
      if (!line) throw new NotFoundException('Claim not found');
      if (line.claimStatus === PanelClaimStatus.WRITTEN_OFF || line.claimStatus === PanelClaimStatus.CLOSED) {
        throw new ConflictException(`A ${line.claimStatus.toLowerCase()} claim cannot be adjudicated.`);
      }

      const expectedCents = toCents(line.claimedAmount) + toCents(line.feeAmount);
      const approvedCents = toCents(dto.approvedAmount);
      const rejectedCents = toCents(dto.rejectedAmount ?? 0);

      if (approvedCents + rejectedCents > expectedCents) {
        throw new BadRequestException(
          `Approved (${dto.approvedAmount}) plus rejected (${dto.rejectedAmount ?? 0}) exceeds the ${fromCents(expectedCents)} claimed.`,
        );
      }
      if (rejectedCents > 0 && !dto.rejectionReason?.trim()) {
        throw new BadRequestException('A rejected amount needs the panel’s reason.');
      }

      const status: PanelClaimStatus =
        approvedCents === 0
          ? PanelClaimStatus.REJECTED
          : approvedCents < expectedCents
            ? PanelClaimStatus.PARTIALLY_APPROVED
            : PanelClaimStatus.APPROVED;

      const updated = await tx.claimBatchLine.update({
        where: { id: claimLineId },
        data: {
          claimStatus: status,
          status: ClaimWorkspaceService.legacyStatusOf(status),
          approvedAmount: dto.approvedAmount,
          rejectedAmount: dto.rejectedAmount ?? 0,
          rejectionReason: dto.rejectionReason ?? null,
          adjudicatedAt: dto.adjudicatedAt ? new Date(dto.adjudicatedAt) : new Date(),
          deductionReason: dto.rejectionReason ?? null,
          ...(dto.panelClaimNo ? { panelClaimNo: dto.panelClaimNo } : {}),
        },
      });

      await this.logEvent(tx, {
        claimLineId,
        eventType: 'ADJUDICATED',
        fromStatus: line.claimStatus,
        toStatus: status,
        amount: dto.approvedAmount,
        reason: dto.rejectionReason ?? null,
        reference: dto.panelClaimNo ?? null,
        actorStaffId: actor.id,
      });

      await recordAudit(tx, actor, {
        action: 'panel.claim.financialEdit',
        entityType: 'ClaimBatchLine',
        entityId: claimLineId,
        before: {
          claimStatus: line.claimStatus,
          approvedAmount: line.approvedAmount === null ? null : String(line.approvedAmount),
          rejectedAmount: line.rejectedAmount === null ? null : String(line.rejectedAmount),
        },
        after: {
          claimStatus: status,
          approvedAmount: dto.approvedAmount,
          rejectedAmount: dto.rejectedAmount ?? 0,
        },
        reason: dto.rejectionReason ?? null,
        source: 'panel.adjudication',
      });

      return updated;
    });
  }

  /**
   * THE EXCESS / RESUBMISSION WORKFLOW.
   *
   * The owner's real process, which today lives in a spreadsheet: a rejected
   * claim is re-claimed under a NEW claim number. This creates that new claim,
   * links it to the original with `supersedesLineId`, and marks the original
   * RESUBMITTED → the original stops being chased, the replacement starts being
   * chased, and neither is counted twice.
   *
   * A panel configured with `resubmitAsNewClaim = false` corrects in place
   * instead, and this refuses rather than inventing a claim their portal will
   * not recognise.
   */
  async resubmit(claimLineId: string, dto: ResubmitClaimDto) {
    return withAdminTx(this.rawPrisma, 'panel.claim.manage', async (tx, actor) => {
      const original = await tx.claimBatchLine.findUnique({
        where: { id: claimLineId },
        include: { claimBatch: { include: { panelClinic: true } } },
      });
      if (!original) throw new NotFoundException('Claim not found');
      if (!original.claimBatch.panelClinic.resubmitAsNewClaim) {
        throw new BadRequestException(
          `${original.claimBatch.panelClinic.name} corrects a rejected claim in place rather than re-claiming under a new number. Update the original instead.`,
        );
      }
      const alreadyReplaced = await tx.claimBatchLine.findFirst({
        where: { supersedesLineId: claimLineId },
        select: { id: true },
      });
      if (alreadyReplaced) {
        throw new ConflictException('This claim has already been re-claimed.');
      }

      // The replacement rides in its own batch, so the resubmission has its own
      // submission date and reference — which is what the panel's portal
      // actually issues.
      const batchCount = await tx.claimBatch.count();
      const batch = await tx.claimBatch.create({
        data: {
          tenantId: currentTenantId(),
          panelClinicId: original.claimBatch.panelClinicId,
          batchNumber: `CLAIM-${String(batchCount + 1).padStart(6, '0')}`,
          createdByStaffId: actor.id,
        },
      });

      const replacementAmountCents =
        dto.claimedAmount !== undefined
          ? toCents(dto.claimedAmount)
          : // Default: what the panel refused. Re-claiming the whole original
            // when only part was rejected would double-claim the approved half.
            toCents(original.rejectedAmount ?? original.claimedAmount);

      const replacement = await tx.claimBatchLine.create({
        data: {
          tenantId: currentTenantId(),
          claimBatchId: batch.id,
          invoiceId: original.invoiceId,
          claimedAmount: fromCents(replacementAmountCents),
          feeAmount: original.feeAmount,
          claimStatus: PanelClaimStatus.READY,
          supersedesLineId: original.id,
          responsibleStaffId: dto.responsibleStaffId ?? actor.id,
          remarks: dto.reason,
        },
      });

      await tx.claimBatchLine.update({
        where: { id: claimLineId },
        data: {
          claimStatus: PanelClaimStatus.RESUBMITTED,
          status: ClaimLineStatus.REJECTED,
          resolvedAt: new Date(),
          resolutionNote: `Re-claimed under ${batch.batchNumber}`,
        },
      });

      await this.logEvent(tx, {
        claimLineId,
        eventType: 'RESUBMITTED',
        fromStatus: original.claimStatus,
        toStatus: PanelClaimStatus.RESUBMITTED,
        amount: fromCents(replacementAmountCents),
        reason: dto.reason,
        reference: batch.batchNumber,
        actorStaffId: actor.id,
      });
      await this.logEvent(tx, {
        claimLineId: replacement.id,
        eventType: 'CREATED_AS_REPLACEMENT',
        toStatus: PanelClaimStatus.READY,
        amount: fromCents(replacementAmountCents),
        reason: dto.reason,
        reference: original.panelClaimNo ?? null,
        actorStaffId: actor.id,
      });

      await recordAudit(tx, actor, {
        action: 'panel.claim.statusChanged',
        entityType: 'ClaimBatchLine',
        entityId: claimLineId,
        before: { claimStatus: original.claimStatus },
        after: {
          claimStatus: PanelClaimStatus.RESUBMITTED,
          replacementLineId: replacement.id,
          replacementBatch: batch.batchNumber,
          amount: fromCents(replacementAmountCents),
        },
        reason: dto.reason,
        source: 'panel.resubmission',
      });

      return { original: claimLineId, replacementLineId: replacement.id, batchNumber: batch.batchNumber };
    });
  }

  /** Abandon a receivable. Permission-gated, reason-mandatory, and on the timeline. */
  async writeOff(claimLineId: string, dto: WriteOffClaimDto) {
    return withAdminTx(this.rawPrisma, 'panel.writeOff', async (tx, actor) => {
      const line = await tx.claimBatchLine.findUnique({
        where: { id: claimLineId },
        select: {
          id: true,
          claimStatus: true,
          claimedAmount: true,
          feeAmount: true,
          approvedAmount: true,
          paidAmount: true,
          writtenOffAmount: true,
        },
      });
      if (!line) throw new NotFoundException('Claim not found');
      if (line.writtenOffAmount) {
        throw new ConflictException('This claim has already been written off.');
      }

      const balance = computeClaimBalance({
        claimedAmount: line.claimedAmount,
        feeAmount: line.feeAmount,
        approvedAmount: line.approvedAmount,
        receivedAmount: line.paidAmount,
      });
      const amountCents = dto.amount === undefined ? balance.outstandingCents : toCents(dto.amount);
      if (amountCents <= 0) {
        throw new BadRequestException('There is nothing outstanding to write off.');
      }
      if (amountCents > balance.outstandingCents) {
        throw new BadRequestException(
          `Cannot write off ${fromCents(amountCents)} — only ${fromCents(balance.outstandingCents)} is outstanding.`,
        );
      }

      const updated = await tx.claimBatchLine.update({
        where: { id: claimLineId },
        data: {
          writtenOffAmount: fromCents(amountCents),
          writtenOffAt: new Date(),
          writtenOffByStaffId: actor.id,
          writeOffReason: dto.reason,
          claimStatus: PanelClaimStatus.WRITTEN_OFF,
          status: ClaimLineStatus.REJECTED,
          resolvedAt: new Date(),
          resolutionNote: dto.reason,
        },
      });

      await this.logEvent(tx, {
        claimLineId,
        eventType: 'WRITTEN_OFF',
        fromStatus: line.claimStatus,
        toStatus: PanelClaimStatus.WRITTEN_OFF,
        amount: fromCents(amountCents),
        reason: dto.reason,
        actorStaffId: actor.id,
      });

      await recordAudit(tx, actor, {
        action: 'panel.writeOff',
        entityType: 'ClaimBatchLine',
        entityId: claimLineId,
        before: { claimStatus: line.claimStatus, outstanding: fromCents(balance.outstandingCents) },
        after: { claimStatus: PanelClaimStatus.WRITTEN_OFF, writtenOff: fromCents(amountCents) },
        reason: dto.reason,
        source: 'panel.writeOff',
      });

      return updated;
    });
  }

  // ==========================================================================
  // QUESTION 3 — where is the money?
  // ==========================================================================

  /**
   * Record a remittance and allocate it to claims.
   *
   * A panel's payment rarely matches a submission: one transfer settles
   * fourteen claims from three batches, less a deduction on two. The
   * allocation is explicit, and the sum of allocations is checked against the
   * net — a remittance that does not add up is refused here rather than
   * discovered in a reconciliation three weeks later.
   */
  async recordRemittance(dto: RecordRemittanceDto) {
    return withAdminTx(this.rawPrisma, 'panel.receipt.record', async (tx, actor) => {
      const grossCents = toCents(dto.grossAmount);
      const withheldCents = toCents(dto.withheldAmount ?? 0);
      const netCents = grossCents - withheldCents;
      if (netCents < 0) {
        throw new BadRequestException('The amount withheld cannot exceed the gross payment.');
      }

      const allocatedCents = dto.allocations.reduce((total, allocation) => total + toCents(allocation.amount), 0);
      if (allocatedCents !== netCents) {
        throw new BadRequestException(
          `The allocations total ${fromCents(allocatedCents)} but the net payment is ${fromCents(netCents)}. A remittance must be fully allocated.`,
        );
      }

      const lineIds = dto.allocations.map((allocation) => allocation.claimLineId);
      const lines = await tx.claimBatchLine.findMany({
        where: { id: { in: lineIds } },
        include: { claimBatch: { select: { panelClinicId: true } } },
      });
      if (lines.length !== new Set(lineIds).size) {
        throw new NotFoundException('One of those claims does not exist.');
      }
      const wrongPanel = lines.find((line) => line.claimBatch.panelClinicId !== dto.panelClinicId);
      if (wrongPanel) {
        throw new BadRequestException('A claim in this remittance belongs to a different panel.');
      }

      const remittance = await tx.panelRemittance.create({
        data: {
          tenantId: currentTenantId(),
          panelClinicId: dto.panelClinicId,
          remittanceRef: dto.remittanceRef ?? null,
          receivedAt: new Date(`${dto.receivedAt}T00:00:00.000Z`),
          grossAmount: dto.grossAmount,
          withheldAmount: dto.withheldAmount ?? 0,
          netAmount: fromCents(netCents),
          notes: dto.notes ?? null,
          recordedByStaffId: actor.id,
          allocations: {
            create: dto.allocations.map((allocation) => ({
              tenantId: currentTenantId(),
              claimBatchLineId: allocation.claimLineId,
              amount: allocation.amount,
            })),
          },
        },
        include: { allocations: true },
      });

      // Re-derive each claim's received total FROM ITS ALLOCATIONS rather than
      // incrementing a column: a duplicate receipt is then impossible to create
      // by double-clicking, because the total is a sum of records.
      for (const line of lines) {
        const received = await tx.panelRemittanceAllocation.aggregate({
          where: { claimBatchLineId: line.id },
          _sum: { amount: true },
        });
        const receivedCents = toCents(received._sum.amount ?? 0);
        const balance = computeClaimBalance({
          claimedAmount: line.claimedAmount,
          feeAmount: line.feeAmount,
          approvedAmount: line.approvedAmount,
          receivedAmount: fromCents(receivedCents),
          writtenOffAmount: line.writtenOffAmount,
        });
        const status = balance.outstandingCents === 0 ? PanelClaimStatus.PAID : PanelClaimStatus.PARTIALLY_PAID;

        await tx.claimBatchLine.update({
          where: { id: line.id },
          data: {
            paidAmount: fromCents(receivedCents),
            claimStatus: status,
            status: ClaimWorkspaceService.legacyStatusOf(status),
            ...(status === PanelClaimStatus.PAID ? { resolvedAt: new Date() } : {}),
          },
        });

        await this.logEvent(tx, {
          claimLineId: line.id,
          eventType: 'PAYMENT_RECEIVED',
          fromStatus: line.claimStatus,
          toStatus: status,
          amount: dto.allocations.find((allocation) => allocation.claimLineId === line.id)?.amount ?? null,
          reference: dto.remittanceRef ?? null,
          actorStaffId: actor.id,
        });
      }

      await recordAudit(tx, actor, {
        action: 'panel.receipt.recorded',
        entityType: 'PanelRemittance',
        entityId: remittance.id,
        after: {
          panelClinicId: dto.panelClinicId,
          gross: dto.grossAmount,
          withheld: dto.withheldAmount ?? 0,
          net: fromCents(netCents),
          claims: lineIds.length,
          reference: dto.remittanceRef,
        },
        source: 'panel.remittances',
      });

      return remittance;
    });
  }

  // ==========================================================================
  // QUESTION 4 — does it reconcile?
  // ==========================================================================

  /**
   * The reconciliation the owner brief demands, and the arithmetic that makes
   * it a reconciliation rather than a list of numbers:
   *
   *   expected receivable = claimed + fee
   *   received + outstanding + rejected + written off = expected
   *
   * Every figure comes from `rollUpClaims`, which is `computeClaimBalance`
   * summed — the same function the individual claim screen uses. There is no
   * second formula anywhere.
   */
  async reconciliation(params: { panelClinicId?: string; from?: string; to?: string; asOf?: string }) {
    await requirePermission(this.rawPrisma, 'panel.view');
    const asOf = params.asOf ? new Date(`${params.asOf}T23:59:59.999Z`) : new Date();

    const lines = await this.prisma.claimBatchLine.findMany({
      where: {
        ...(params.panelClinicId ? { claimBatch: { panelClinicId: params.panelClinicId } } : {}),
        ...(params.from || params.to
          ? {
              createdAt: {
                ...(params.from ? { gte: new Date(`${params.from}T00:00:00.000Z`) } : {}),
                ...(params.to ? { lt: new Date(new Date(`${params.to}T00:00:00.000Z`).getTime() + 86400000) } : {}),
              },
            }
          : {}),
      },
      include: {
        claimBatch: { include: { panelClinic: { select: { id: true, name: true, paymentTermDays: true } } } },
      },
    });

    const roll = rollUpClaims(
      lines.map((line) => ({
        claimedAmount: line.claimedAmount,
        feeAmount: line.feeAmount,
        approvedAmount: line.approvedAmount,
        rejectedAmount: line.rejectedAmount,
        receivedAmount: line.paidAmount,
        writtenOffAmount: line.writtenOffAmount,
      })),
    );

    const aging: Record<AgingBucket, number> = emptyAging();
    const byPanel = new Map<
      string,
      {
        name: string;
        claimedCents: number;
        receivedCents: number;
        outstandingCents: number;
        count: number;
        overdue: number;
        turnaroundDays: number[];
      }
    >();

    for (const line of lines) {
      const balance = computeClaimBalance({
        claimedAmount: line.claimedAmount,
        feeAmount: line.feeAmount,
        approvedAmount: line.approvedAmount,
        rejectedAmount: line.rejectedAmount,
        receivedAmount: line.paidAmount,
        writtenOffAmount: line.writtenOffAmount,
      });

      const panel = line.claimBatch.panelClinic;
      const bucket = byPanel.get(panel.id) ?? {
        name: panel.name,
        claimedCents: 0,
        receivedCents: 0,
        outstandingCents: 0,
        count: 0,
        overdue: 0,
        turnaroundDays: [],
      };
      bucket.claimedCents += balance.expectedReceivableCents;
      bucket.receivedCents += balance.receivedCents;
      bucket.outstandingCents += balance.outstandingCents;
      bucket.count += 1;

      if (balance.outstandingCents > 0) {
        // Aged from SUBMISSION, not from the service date: the clock a panel is
        // judged against starts when the claim reached them.
        const from = line.submittedAt ?? line.createdAt;
        accumulateAging(aging, daysBetween(from, asOf), balance.outstandingCents);
        if (line.dueDate && line.dueDate < asOf) bucket.overdue += 1;
      }
      if (line.submittedAt && line.adjudicatedAt) {
        bucket.turnaroundDays.push(daysBetween(line.submittedAt, line.adjudicatedAt));
      }
      byPanel.set(panel.id, bucket);
    }

    return {
      asOf: asOf.toISOString().slice(0, 10),
      totals: {
        claims: roll.count,
        claimed: fromCents(roll.claimedCents),
        fees: fromCents(roll.feeCents),
        expectedReceivable: fromCents(roll.expectedReceivableCents),
        approved: fromCents(roll.approvedCents),
        rejected: fromCents(roll.rejectedCents),
        received: fromCents(roll.receivedCents),
        writtenOff: fromCents(roll.writtenOffCents),
        outstanding: fromCents(roll.outstandingCents),
      },
      // The check, computed and returned rather than assumed. If this is ever
      // false the dashboard says so instead of showing numbers that do not add
      // up.
      reconciles:
        roll.receivedCents + roll.outstandingCents + roll.rejectedCents + roll.writtenOffCents ===
        roll.expectedReceivableCents,
      aging: {
        current: fromCents(aging.CURRENT),
        d31_60: fromCents(aging.D31_60),
        d61_90: fromCents(aging.D61_90),
        d90_plus: fromCents(aging.D90_PLUS),
      },
      byPanel: [...byPanel.entries()]
        .map(([id, bucket]) => ({
          panelClinicId: id,
          panelName: bucket.name,
          claims: bucket.count,
          expectedReceivable: fromCents(bucket.claimedCents),
          received: fromCents(bucket.receivedCents),
          outstanding: fromCents(bucket.outstandingCents),
          collectionRate:
            bucket.claimedCents === 0 ? null : Math.round((bucket.receivedCents / bucket.claimedCents) * 1000) / 10,
          overdueClaims: bucket.overdue,
          averageTurnaroundDays:
            bucket.turnaroundDays.length === 0
              ? null
              : Math.round(bucket.turnaroundDays.reduce((a, b) => a + b, 0) / bucket.turnaroundDays.length),
        }))
        .sort((a, b) => b.outstanding - a.outstanding),
    };
  }

  /**
   * THE WORK QUEUE — rejected, part-approved and overdue claims that somebody
   * has to do something about. The replacement for the Google Sheet.
   */
  async workQueue(params: { panelClinicId?: string; includeResolved?: boolean }) {
    await requirePermission(this.rawPrisma, 'panel.view');
    const now = new Date();

    const lines = await this.prisma.claimBatchLine.findMany({
      where: {
        ...(params.panelClinicId ? { claimBatch: { panelClinicId: params.panelClinicId } } : {}),
        ...(params.includeResolved ? {} : { resolvedAt: null }),
        OR: [
          { claimStatus: { in: ['REJECTED', 'PARTIALLY_APPROVED', 'RESUBMISSION_REQUIRED', 'NEEDS_INFORMATION'] } },
          {
            AND: [
              { dueDate: { lt: now } },
              { claimStatus: { in: ['SUBMITTED', 'ACKNOWLEDGED', 'APPROVED', 'PARTIALLY_PAID'] } },
            ],
          },
        ],
      },
      include: {
        claimBatch: {
          include: {
            panelClinic: { select: { id: true, name: true, paymentTermDays: true, claimFeeType: true, claimFeeValue: true } },
          },
        },
        invoice: {
          select: {
            invoiceNumber: true,
            visit: {
              select: { visitNumber: true, createdAt: true, patient: { select: { name: true, identifierValue: true } } },
            },
          },
        },
        responsible: { select: { fullName: true } },
        /**
         * BOTH ENDS OF THE RE-CLAIM CHAIN.
         *
         * The Google Sheet this replaces carries an ORIGINAL claim number and a
         * REPLACEMENT claim number in adjacent columns, and the argument with a
         * panel six months later is conducted in exactly those two references.
         * Reading only one direction meant a resubmitted claim could show what
         * replaced it but never what it replaced.
         */
        supersededBy: {
          select: {
            id: true,
            panelClaimNo: true,
            claimStatus: true,
            submittedAt: true,
            createdAt: true,
            claimBatch: { select: { batchNumber: true } },
          },
        },
        supersedes: {
          select: {
            id: true,
            panelClaimNo: true,
            claimStatus: true,
            rejectionReason: true,
            claimBatch: { select: { batchNumber: true } },
          },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });

    return lines.map((line) => {
      const balance = computeClaimBalance({
        claimedAmount: line.claimedAmount,
        feeAmount: line.feeAmount,
        approvedAmount: line.approvedAmount,
        rejectedAmount: line.rejectedAmount,
        receivedAmount: line.paidAmount,
        writtenOffAmount: line.writtenOffAmount,
      });
      const ageFrom = line.submittedAt ?? line.createdAt;
      return {
        claimLineId: line.id,
        panelClinicId: line.claimBatch.panelClinic.id,
        panelName: line.claimBatch.panelClinic.name,
        batchNumber: line.claimBatch.batchNumber,
        panelClaimNo: line.panelClaimNo,
        invoiceNumber: line.invoice.invoiceNumber,
        visitNumber: line.invoice.visit?.visitNumber ?? null,
        serviceDate: line.invoice.visit?.createdAt ?? null,
        patientName: line.invoice.visit?.patient?.name ?? null,
        patientIdentifier: line.invoice.visit?.patient?.identifierValue ?? null,
        status: line.claimStatus,
        submittedAt: line.submittedAt,
        dueDate: line.dueDate,
        overdue: line.dueDate !== null && line.dueDate < now,
        ageDays: daysBetween(ageFrom, now),
        claimedAmount: Number(line.claimedAmount),
        feeAmount: Number(line.feeAmount),
        expectedReceivable: fromCents(balance.expectedReceivableCents),
        approvedAmount: line.approvedAmount === null ? null : Number(line.approvedAmount),
        rejectedAmount: line.rejectedAmount === null ? null : Number(line.rejectedAmount),
        receivedAmount: line.paidAmount === null ? null : Number(line.paidAmount),
        outstanding: fromCents(balance.outstandingCents),
        rejectionReason: line.rejectionReason,
        responsible: line.responsible?.fullName ?? null,
        // The panel's own term, so the due date on this row can be read as a
        // consequence of something rather than as a date somebody typed.
        paymentTermDays: line.claimBatch.panelClinic.paymentTermDays,
        resolved: line.resolvedAt !== null,
        resolvedAt: line.resolvedAt,
        resolutionNote: line.resolutionNote,
        replacement:
          line.supersededBy.length > 0
            ? {
                claimLineId: line.supersededBy[0].id,
                batchNumber: line.supersededBy[0].claimBatch.batchNumber,
                panelClaimNo: line.supersededBy[0].panelClaimNo,
                status: line.supersededBy[0].claimStatus,
                // WHEN it went back out. `submittedAt` when the replacement has
                // actually been sent; NULL while it is only prepared — the
                // distinction this whole module exists to keep.
                resubmittedAt: line.supersededBy[0].submittedAt,
                raisedAt: line.supersededBy[0].createdAt,
              }
            : null,
        /** The claim THIS one replaces, when it is itself a re-claim. */
        supersedes:
          line.supersedes !== null
            ? {
                claimLineId: line.supersedes.id,
                batchNumber: line.supersedes.claimBatch.batchNumber,
                panelClaimNo: line.supersedes.panelClaimNo,
                status: line.supersedes.claimStatus,
                rejectionReason: line.supersedes.rejectionReason,
              }
            : null,
      };
    });
  }

  /** One claim's full timeline — what happened, when, and who did it. */
  async timeline(claimLineId: string) {
    await requirePermission(this.rawPrisma, 'panel.view');
    const events = await this.prisma.claimEvent.findMany({
      where: { claimBatchLineId: claimLineId },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { fullName: true } } },
    });
    return events.map((event) => ({
      id: event.id,
      at: event.createdAt,
      type: event.eventType,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      amount: event.amount === null ? null : Number(event.amount),
      reason: event.reason,
      reference: event.reference,
      by: event.actor?.fullName ?? null,
    }));
  }
}
