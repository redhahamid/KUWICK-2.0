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
  computePatientBalance,
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
import { ChargeToPatientDto } from './dto/charge-to-patient.dto';
import { resolveResubmissionWindow, resolveTermWindow } from './payment-terms';

/**
 * The claim states where a re-claim is still the route out, and therefore the
 * only states where a re-claim deadline means anything. A RESUBMITTED claim has
 * already taken that route; a WRITTEN_OFF one has given it up.
 */
const NEEDS_RECLAIM: PanelClaimStatus[] = ['REJECTED', 'PARTIALLY_APPROVED', 'RESUBMISSION_REQUIRED'];

/**
 * The states where charging the patient is a legitimate route. A claim the
 * panel has not refused cannot be handed to the patient, and one already
 * resubmitted or written off has taken a different route out.
 */
const CHARGEABLE_TO_PATIENT: PanelClaimStatus[] = [
  'REJECTED',
  'PARTIALLY_APPROVED',
  'RESUBMISSION_REQUIRED',
];

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
        feeDirection: line.feeDirection,
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
          lines: {
            select: { id: true, claimStatus: true, invoice: { select: { paidAt: true, createdAt: true } } },
          },
          panelClinic: {
            select: {
              paymentTermDays: true,
              paymentTermMaxDays: true,
              paymentTermUnit: true,
              paymentTermAnchor: true,
              paymentTermVariesByPayer: true,
            },
          },
        },
      });
      if (!batch) throw new NotFoundException('Claim batch not found');
      if (batch.submittedAt) {
        throw new ConflictException('This batch has already been marked submitted.');
      }

      const submittedAt = dto.submittedAt ? new Date(dto.submittedAt) : new Date();
      // THE DUE DATE COMES FROM THE PANEL'S OWN TERM SHAPE, not from a bare
      // number of days added to today. A range term stores its FAR edge here,
      // because that is the date after which the panel is genuinely late; the
      // near edge is a chasing prompt, not a breach. A working-day term skips
      // weekends. A term that varies by the employer behind the claim resolves
      // to no date at all, so the claim is never called overdue on a rule
      // nobody has configured. See panel/payment-terms.ts.
      const panel = batch.panelClinic;
      const term = {
        nominalDays: panel.paymentTermDays,
        maxDays: panel.paymentTermMaxDays,
        unit: panel.paymentTermUnit,
        anchor: panel.paymentTermAnchor,
        variesByPayer: panel.paymentTermVariesByPayer,
      };

      await tx.claimBatch.update({
        where: { id: batchId },
        data: {
          status: 'SUBMITTED',
          submittedAt,
          submissionMethod: dto.submissionMethod,
          submissionReference: dto.submissionReference ?? null,
        },
      });

      let dueDate: Date | null = null;
      for (const line of batch.lines) {
        // Resolved per line, because a SERVICE_DATE or INVOICE_DATE anchor
        // makes the due date a property of the claim, not of the batch.
        const serviceDate = line.invoice.paidAt ?? line.invoice.createdAt;
        const window = resolveTermWindow(term, {
          submittedAt,
          serviceDate,
          invoiceDate: line.invoice.createdAt,
        });
        dueDate = window.dueBy;
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
          feeDirection: true,
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

      // Through the shared invariant, so the ceiling this validates against
      // moves with the panel's fee direction. Adding the fee on a panel that
      // withholds it would let somebody approve more than the claim can ever
      // pay, which is the inflation this check exists to stop.
      const expectedCents = computeClaimBalance({
        claimedAmount: line.claimedAmount,
        feeAmount: line.feeAmount,
        feeDirection: line.feeDirection,
      }).expectedReceivableCents;
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
          rejectionCategory: dto.rejectionCategory ?? null,
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
          feeDirection: true,
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
        feeDirection: line.feeDirection,
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

  /**
   * CHARGE A REJECTED CLAIM TO THE PATIENT INSTEAD (G-5).
   *
   * The fourth route out of a rejection, and the one the clinic actually uses:
   * the panel will not pay, so the patient does. In the workbook this is the
   * word "SELF PAY" typed into a column meant for dates, followed weeks later
   * by "QR PAYMENT 3/8/26" in another column, with nothing connecting the two
   * to the claim they came from.
   *
   * THIS IS NOT A WRITE-OFF, and the distinction is the whole point. A write-off
   * says the money is gone. This says the money is still coming, from somebody
   * else — so it must not land in a "written off" total that the owner reads as
   * losses.
   *
   * What it actually does is move the amount on the INVOICE, from the panel's
   * share to the patient's. That single move is what makes the patient
   * chaseable: `computePatientBalance` picks them up like any other debtor,
   * they appear in Finance ▸ Outstanding, and the counter can take payment
   * through the ordinary payment path. Nothing about panel receivables changes,
   * because the panel's rejection is already a fact.
   *
   * `panelCoveredAmount` is deliberately left alone: it is the historical claim
   * base, the number this claim was raised against, and rewriting it would make
   * the claim's own `claimedAmount` snapshot look wrong six months later.
   */
  async chargeToPatient(claimLineId: string, dto: ChargeToPatientDto) {
    return withAdminTx(this.rawPrisma, 'panel.writeOff', async (tx, actor) => {
      const line = await tx.claimBatchLine.findUnique({
        where: { id: claimLineId },
        select: {
          id: true,
          claimStatus: true,
          rejectedAmount: true,
          chargedToPatientAmount: true,
          invoiceId: true,
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              panelResponsibilityAmount: true,
              patientResponsibilityAmount: true,
            },
          },
        },
      });
      if (!line) throw new NotFoundException('Claim not found');
      if (line.chargedToPatientAmount) {
        throw new ConflictException('This claim has already been charged to the patient.');
      }
      if (!CHARGEABLE_TO_PATIENT.includes(line.claimStatus)) {
        throw new ConflictException(
          `Only a rejected or part-approved claim can be charged to the patient. This one is ${line.claimStatus.toLowerCase()}.`,
        );
      }

      const rejectedCents = toCents(line.rejectedAmount ?? 0);
      if (rejectedCents <= 0) {
        throw new BadRequestException('The panel has not rejected anything on this claim.');
      }
      const amountCents = dto.amount === undefined ? rejectedCents : toCents(dto.amount);
      if (amountCents <= 0) {
        throw new BadRequestException('The amount charged to the patient must be more than zero.');
      }
      if (amountCents > rejectedCents) {
        throw new BadRequestException(
          `Cannot charge ${fromCents(amountCents)} to the patient — the panel only rejected ${fromCents(rejectedCents)}.`,
        );
      }

      // The panel's share cannot go below zero, whatever was rejected: an
      // invoice that ends up owing a negative amount to a panel is a figure
      // nobody can act on.
      const panelCents = toCents(line.invoice.panelResponsibilityAmount ?? 0);
      if (amountCents > panelCents) {
        throw new BadRequestException(
          `Invoice ${line.invoice.invoiceNumber} only carries ${fromCents(panelCents)} of panel responsibility.`,
        );
      }

      const patientCents = toCents(line.invoice.patientResponsibilityAmount ?? 0);
      const newPatientCents = patientCents + amountCents;

      await tx.invoice.update({
        where: { id: line.invoice.id },
        data: {
          panelResponsibilityAmount: fromCents(panelCents - amountCents),
          patientResponsibilityAmount: fromCents(newPatientCents),
        },
      });

      // The invoice may have been settled when the patient owed nothing. It is
      // not settled now, and saying so is the point — a PAID invoice with a
      // balance is exactly the kind of quiet inconsistency this system exists
      // to avoid.
      const settlement = await this.patientSettlement(tx, line.invoice.id, newPatientCents);
      if (line.invoice.status !== 'CANCELLED') {
        await tx.invoice.update({
          where: { id: line.invoice.id },
          data: settlement.settled
            ? { status: 'PAID' }
            : { status: 'UNPAID', paidAt: null },
        });
      }

      const updated = await tx.claimBatchLine.update({
        where: { id: claimLineId },
        data: {
          chargedToPatientAmount: fromCents(amountCents),
          chargedToPatientAt: new Date(),
          chargedToPatientByStaffId: actor.id,
          claimStatus: PanelClaimStatus.CLOSED,
          resolvedAt: new Date(),
          resolutionNote: `Charged to the patient: ${dto.reason}`,
        },
      });

      await this.logEvent(tx, {
        claimLineId,
        eventType: 'CHARGED_TO_PATIENT',
        fromStatus: line.claimStatus,
        toStatus: PanelClaimStatus.CLOSED,
        amount: fromCents(amountCents),
        reason: dto.reason,
        reference: line.invoice.invoiceNumber,
        actorStaffId: actor.id,
      });

      await recordAudit(tx, actor, {
        action: 'panel.chargedToPatient',
        entityType: 'ClaimBatchLine',
        entityId: claimLineId,
        before: {
          claimStatus: line.claimStatus,
          invoicePanelShare: fromCents(panelCents),
          invoicePatientShare: fromCents(patientCents),
        },
        after: {
          claimStatus: PanelClaimStatus.CLOSED,
          chargedToPatient: fromCents(amountCents),
          invoicePanelShare: fromCents(panelCents - amountCents),
          invoicePatientShare: fromCents(newPatientCents),
        },
        reason: dto.reason,
        source: 'panel.chargeToPatient',
      });

      return {
        ...updated,
        invoiceNumber: line.invoice.invoiceNumber,
        patientNowOwes: fromCents(settlement.balanceCents),
      };
    });
  }

  /**
   * What the patient owes on an invoice, from its own payments and credit
   * notes. The shared invariant, not a second formula.
   */
  private async patientSettlement(tx: AdminTx, invoiceId: string, responsibilityCents: number) {
    const [payments, creditNotes] = await Promise.all([
      tx.payment.findMany({
        where: { invoiceId },
        select: { kind: true, amount: true, reversedAt: true },
      }),
      tx.creditNote.findMany({ where: { invoiceId }, select: { status: true, totalAmount: true } }),
    ]);
    return computePatientBalance({
      patientResponsibility: fromCents(responsibilityCents),
      payments: payments.map((p) => ({ kind: p.kind, amount: p.amount, reversedAt: p.reversedAt })),
      creditNotes: creditNotes.map((n) => ({ status: n.status, totalAmount: n.totalAmount })),
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
          // DATE-ONLY, from whatever valid ISO-8601 the caller sent.
          //
          // This used to concatenate `T00:00:00.000Z` onto the raw string,
          // which works for "2026-08-31" and produces `Invalid Date` for
          // "2026-08-31T06:52:48.000Z" — a value the DTO's own @IsISO8601()
          // accepts. The result was a 500 on a well-formed request. A receipt
          // is dated to the day it was banked, so the time is dropped rather
          // than trusted.
          receivedAt: new Date(`${dto.receivedAt.slice(0, 10)}T00:00:00.000Z`),
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
          feeDirection: line.feeDirection,
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
   *   expected receivable = claimed ± fee, per the panel's fee direction
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
        feeDirection: line.feeDirection,
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
        feeDirection: line.feeDirection,
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
        /**
         * Claims whose fee direction nobody has configured (G-1). Their fee is
         * excluded from `expectedReceivable` above rather than guessed, so a
         * non-zero count here means this figure is understated by that much
         * and the screen must say so.
         */
        unresolvedFeeDirection: roll.unresolvedFeeDirectionCount,
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
  /**
   * WHAT A PANEL STILL OWES — a different question from the work queue.
   *
   * The work queue is the PROBLEM queue: rejected, part-approved, needing
   * information, or overdue. A claim that a panel approved last week and will
   * pay next week is not a problem and is correctly absent from it.
   *
   * But it is exactly what somebody entering a remittance advice needs to see,
   * and building the receipt form on the work queue meant a payment could only
   * be allocated against claims that had already gone wrong. On the seeded
   * clinic that made RM145.80 of one panel's RM205.80 unreachable — the money
   * was owed, the claim was healthy, and there was no row to allocate it to.
   *
   * So this asks the question it means: every claim for this panel with an
   * outstanding balance, oldest first.
   */
  async awaitingPayment(params: { panelClinicId?: string }) {
    await requirePermission(this.rawPrisma, 'panel.view');
    const lines = await this.prisma.claimBatchLine.findMany({
      where: {
        ...(params.panelClinicId ? { claimBatch: { panelClinicId: params.panelClinicId } } : {}),
        // Submitted and not yet settled. A claim still being prepared has no
        // balance a panel could pay, and a written-off one is not owed.
        claimStatus: {
          in: ['SUBMITTED', 'ACKNOWLEDGED', 'APPROVED', 'PARTIALLY_APPROVED', 'PARTIALLY_PAID', 'RESUBMITTED'],
        },
      },
      include: {
        claimBatch: { include: { panelClinic: { select: { id: true, name: true } } } },
        invoice: {
          select: {
            invoiceNumber: true,
            visit: { select: { visitNumber: true, createdAt: true, patient: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });

    const now = new Date();
    return lines
      .map((line) => {
        const balance = computeClaimBalance({
          claimedAmount: line.claimedAmount,
          feeAmount: line.feeAmount,
          feeDirection: line.feeDirection,
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
          panelClaimNo: line.panelClaimNo,
          invoiceNumber: line.invoice.invoiceNumber,
          patientName: line.invoice.visit?.patient?.name ?? null,
          serviceDate: line.invoice.visit?.createdAt ?? null,
          status: line.claimStatus,
          dueDate: line.dueDate,
          overdue: line.dueDate ? line.dueDate < now : false,
          ageDays: Math.floor((now.getTime() - ageFrom.getTime()) / 86400000),
          claimedAmount: Number(line.claimedAmount),
          expectedReceivable: fromCents(balance.expectedReceivableCents),
          outstanding: fromCents(balance.outstandingCents),
        };
      })
      // Zero-balance rows would be noise in a form whose entire job is to
      // allocate money against a balance.
      .filter((row) => row.outstanding > 0);
  }

  async workQueue(params: { panelClinicId?: string; includeResolved?: boolean }) {
    await requirePermission(this.rawPrisma, 'panel.view');
    const now = new Date();

    /**
     * "INCLUDE RESOLVED" HAS TO MEAN SOMETHING.
     *
     * Dropping the `resolvedAt: null` filter was not enough on its own. A claim
     * that was rejected and then re-claimed ends up RESUBMITTED, and that status
     * appears in NEITHER branch of the work-state filter below — so the settled
     * original stayed invisible however the checkbox was set, and the columns
     * that exist to show a re-claim chain (original claim number, replacement,
     * resubmission date, resolved date) had nothing to draw.
     *
     * Ticking the box widens the states as well as lifting the filter: what a
     * person is asking is "what happened to that one", and the answer is always
     * a claim that has LEFT the work queue.
     */
    const settledStates: PanelClaimStatus[] = ['RESUBMITTED', 'WRITTEN_OFF', 'CLOSED', 'PAID'];
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
          ...(params.includeResolved
            ? [{ claimStatus: { in: settledStates } }, { resolvedAt: { not: null } }]
            : []),
        ],
      },
      include: {
        claimBatch: {
          include: {
            panelClinic: {
              select: {
                id: true,
                name: true,
                paymentTermDays: true,
                claimFeeType: true,
                claimFeeValue: true,
                resubmissionWindowDays: true,
                resubmitAsNewClaim: true,
              },
            },
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
        feeDirection: line.feeDirection,
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
        rejectionCategory: line.rejectionCategory,
        /** G-5 — already handed to the patient, and for how much. */
        chargedToPatient:
          line.chargedToPatientAmount === null ? null : Number(line.chargedToPatientAmount),
        chargedToPatientAt: line.chargedToPatientAt,
        // ---------------------------------------------------------------
        // THE RE-CLAIM DEADLINE (G-4).
        //
        // The clinic's excess register carries this as rule 5 of a procedure
        // typed into spreadsheet cells — "max 2 months from the previous
        // service date" — and nothing counts it down. Miss it and the claim
        // is gone. It is counted from the ORIGINAL SERVICE DATE, not from the
        // rejection, which is what makes it easy to lose: the clock has often
        // been running for weeks before the panel even says no.
        //
        // Only meaningful on a claim that still needs re-claiming, so it is
        // NULL elsewhere rather than a countdown on a settled row.
        // ---------------------------------------------------------------
        resubmission: NEEDS_RECLAIM.includes(line.claimStatus)
          ? (() => {
              const w = resolveResubmissionWindow(
                line.claimBatch.panelClinic.resubmissionWindowDays,
                line.invoice.visit?.createdAt ?? null,
                now,
              );
              return {
                deadline: w.deadline,
                daysRemaining: w.daysRemaining,
                expired: w.expired,
                known: w.resolved,
                reason: w.reason,
              };
            })()
          : null,
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
