import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PanelClaimStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { computeClaimBalance } from '../finance/financial-invariants';
import { fromCents } from '../finance/money';
import type { RowProblem } from '../inventory/inventory-csv';
import { ParsedClaimRow, parseClaimImportCsv } from './claim-import-csv';
import { legacyStatusOf } from './claim-workspace.service';

export interface ClaimImportResult {
  /** TRUE when nothing was written — a dry run, or a file with problems. */
  dryRun: boolean;
  panelClinicId: string;
  panelName: string;
  /** The fee treatment every imported claim will be stamped with, and why. */
  feeTreatment: string;
  rowCount: number;
  /** Rows that would be created. */
  importable: number;
  /** Rows already present under this panel, which a re-run leaves alone. */
  alreadyPresent: number;
  problems: RowProblem[];
  /**
   * THE RECONCILIATION. Compare these against the workbook's own totals BEFORE
   * committing — that comparison is the only thing that proves the import is
   * right, and it is impossible to make afterwards.
   */
  totals: {
    claimed: number;
    fee: number;
    expectedReceivable: number;
    approved: number;
    rejected: number;
    received: number;
    outstanding: number;
  };
  /** Only on a committed run. */
  importBatchId?: string;
}

/**
 * THE PANEL CLAIM IMPORTER (G-12).
 *
 * The remaining production blocker for Panel: Kuwick cannot start empty on the
 * day the clinic switches over. The workbook holds thousands of open and
 * historical claims, a third of them unpaid, and every one is money somebody is
 * still owed.
 *
 * SIX SAFETY RULES, each of which exists because the alternative is a clinic
 * that cannot trust its own receivables:
 *
 *  1. **DRY RUN BY DEFAULT.** Nothing is written unless `commit` is passed.
 *     The dry run does the whole job — parse, validate, resolve, compute — and
 *     then throws the result away.
 *
 *  2. **ALL OR NOTHING.** A file with any problem imports nothing and reports
 *     every problem at once. A half-imported file is the worst outcome
 *     available: the clinic cannot tell which claims landed, and the obvious
 *     remedy — fix the file and re-upload — is the right one anyway.
 *
 *  3. **THE TOTALS ARE REPORTED BEFORE THE WRITE.** Claimed, fee, expected,
 *     received and outstanding, computed by the same `computeClaimBalance` the
 *     rest of the system uses. The person importing compares them against the
 *     workbook's own TOTAL row. An importer that cannot be checked against its
 *     source is a way of getting wrong numbers in faster.
 *
 *  4. **IDEMPOTENT.** A claim number already imported for this panel is
 *     skipped and counted, not created again. Re-running a file after fixing
 *     three rows imports three rows.
 *
 *  5. **NOTHING IS INVENTED.** The fee treatment comes from the panel's
 *     configuration, not from the file; a blank approved amount stays NULL,
 *     because "the panel has not said" is not "the panel refused it all"; and
 *     a date that could be read two ways is refused rather than chosen.
 *
 *  6. **EVERY IMPORTED CLAIM IS TRACEABLE.** It carries its import batch, and
 *     the batch carries the totals as they stood. An import can be identified,
 *     audited, and — because nothing else references those lines — removed as
 *     a set if it turns out to be wrong.
 */
@Injectable()
export class ClaimImportService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** What the clinic fills in. Served rather than described. */
  async template(): Promise<string> {
    await requirePermission(this.rawPrisma, 'panel.view');
    const { claimImportTemplate } = await import('./claim-import-csv');
    return claimImportTemplate();
  }

  async list(panelClinicId?: string) {
    await requirePermission(this.rawPrisma, 'panel.view');
    const batches = await this.prisma.claimImportBatch.findMany({
      where: { ...(panelClinicId ? { panelClinicId } : {}) },
      include: {
        panelClinic: { select: { name: true } },
        importedBy: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return batches.map((batch) => ({
      id: batch.id,
      panelClinicId: batch.panelClinicId,
      panelName: batch.panelClinic.name,
      fileName: batch.fileName,
      rowCount: batch.rowCount,
      importedCount: batch.importedCount,
      skippedCount: batch.skippedCount,
      claimedTotal: Number(batch.claimedTotal),
      expectedTotal: Number(batch.expectedTotal),
      receivedTotal: Number(batch.receivedTotal),
      outstandingTotal: Number(batch.outstandingTotal),
      note: batch.note,
      importedBy: batch.importedBy.fullName,
      importedAt: batch.createdAt,
    }));
  }

  async import(dto: {
    panelClinicId: string;
    csv: string;
    fileName?: string;
    note?: string;
    commit?: boolean;
  }): Promise<ClaimImportResult> {
    // The permission is the same one that raises a claim: importing history is
    // creating claims, and there is no lesser right that should allow it.
    return withAdminTx(this.rawPrisma, 'panel.claim.manage', async (tx, actor) => {
      const panel = await tx.panelClinic.findUnique({
        where: { id: dto.panelClinicId },
        select: { id: true, name: true, feeTreatment: true },
      });
      if (!panel) throw new NotFoundException('Panel not found');

      const parsed = parseClaimImportCsv(dto.csv);
      const problems: RowProblem[] = [...parsed.problems];

      // ALREADY IMPORTED? Checked against this panel's claims, by claim number.
      // Scoped to the panel because two panels can and do issue the same
      // number, and a global check would refuse a legitimate row.
      const existing = await tx.claimBatchLine.findMany({
        where: {
          claimBatch: { panelClinicId: panel.id },
          panelClaimNo: { in: parsed.rows.map((row) => row.claimNo) },
        },
        select: { panelClaimNo: true },
      });
      const alreadyPresent = new Set(existing.map((line) => line.panelClaimNo));
      const importable = parsed.rows.filter((row) => !alreadyPresent.has(row.claimNo));

      // The money, computed by the SAME function the claim screen uses, from
      // the panel's own configured fee treatment.
      const totals = this.reconcile(importable, panel.feeTreatment);

      const result: ClaimImportResult = {
        dryRun: !dto.commit || problems.length > 0,
        panelClinicId: panel.id,
        panelName: panel.name,
        feeTreatment: panel.feeTreatment,
        rowCount: parsed.rows.length + parsed.problems.length,
        importable: importable.length,
        alreadyPresent: parsed.rows.length - importable.length,
        problems,
        totals,
      };

      if (problems.length > 0 || !dto.commit) return result;
      if (importable.length === 0) {
        // Not an error: a re-run of a file already imported. Say so rather than
        // creating an empty batch that looks like a failed import later.
        return result;
      }

      const batch = await tx.claimBatch.create({
        data: {
          tenantId: currentTenantId(),
          panelClinicId: panel.id,
          batchNumber: `IMPORT-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36).toUpperCase()}`,
          createdByStaffId: actor.id,
          status: 'SUBMITTED',
          submittedAt: new Date(),
          submissionMethod: 'Imported from the previous system',
        },
      });

      const importBatch = await tx.claimImportBatch.create({
        data: {
          tenantId: currentTenantId(),
          panelClinicId: panel.id,
          fileName: dto.fileName ?? null,
          rowCount: result.rowCount,
          importedCount: importable.length,
          skippedCount: result.alreadyPresent,
          claimedTotal: totals.claimed,
          expectedTotal: totals.expectedReceivable,
          receivedTotal: totals.received,
          outstandingTotal: totals.outstanding,
          note: dto.note ?? null,
          importedByStaffId: actor.id,
        },
      });

      for (const row of importable) {
        const claimStatus = CLAIM_STATUS[row.status];
        await tx.claimBatchLine.create({
          data: {
            tenantId: currentTenantId(),
            claimBatchId: batch.id,
            // NO INVOICE. The visit happened in the system this replaces, and
            // fabricating one would put an invented bill in a patient record.
            invoiceId: null,
            importBatchId: importBatch.id,
            legacyServiceDate: new Date(`${row.serviceDate}T00:00:00.000Z`),
            legacyPatientReference: row.patientReference,
            claimedAmount: row.claimedAmount,
            feeAmount: row.feeAmount,
            // FROM THE PANEL, NOT THE FILE. A treatment typed into a
            // spreadsheet column is a second source of truth for something the
            // panel configuration already owns.
            feeTreatment: panel.feeTreatment,
            claimStatus,
            status: legacyStatusOf(claimStatus),
            panelClaimNo: row.claimNo,
            submittedAt: row.submittedDate ? new Date(`${row.submittedDate}T00:00:00.000Z`) : null,
            adjudicatedAt: row.adjudicatedDate ? new Date(`${row.adjudicatedDate}T00:00:00.000Z`) : null,
            approvedAmount: row.approvedAmount,
            rejectedAmount: row.rejectedAmount,
            rejectionReason: row.rejectionReason,
            paidAmount: row.paidAmount,
            resolvedAt:
              claimStatus === PanelClaimStatus.PAID || claimStatus === PanelClaimStatus.WRITTEN_OFF
                ? row.paidDate
                  ? new Date(`${row.paidDate}T00:00:00.000Z`)
                  : new Date()
                : null,
            writtenOffAmount: row.status === 'WRITTEN_OFF' ? row.claimedAmount : null,
            remarks: row.remarks,
          },
        });
      }

      await recordAudit(tx, actor, {
        action: 'panel.claimsImported',
        entityType: 'ClaimImportBatch',
        entityId: importBatch.id,
        after: {
          panel: panel.name,
          fileName: dto.fileName ?? null,
          imported: importable.length,
          skipped: result.alreadyPresent,
          claimed: totals.claimed,
          expected: totals.expectedReceivable,
          outstanding: totals.outstanding,
        },
        source: 'panel.claim-import',
      });

      return { ...result, dryRun: false, importBatchId: importBatch.id };
    });
  }

  /**
   * The totals, from `computeClaimBalance`. Never a second formula: the figure
   * the dry run shows must be the figure the panel dashboard shows tomorrow,
   * or the comparison against the workbook proves nothing.
   */
  private reconcile(rows: ParsedClaimRow[], feeTreatment: string) {
    let claimed = 0;
    let fee = 0;
    let expected = 0;
    let approved = 0;
    let rejected = 0;
    let received = 0;
    let outstanding = 0;

    for (const row of rows) {
      const balance = computeClaimBalance({
        claimedAmount: row.claimedAmount,
        feeAmount: row.feeAmount,
        feeTreatment: feeTreatment as never,
        approvedAmount: row.approvedAmount,
        rejectedAmount: row.rejectedAmount,
        receivedAmount: row.paidAmount,
        writtenOffAmount: row.status === 'WRITTEN_OFF' ? row.claimedAmount : null,
      });
      claimed += balance.claimedCents;
      fee += balance.feeCents;
      expected += balance.expectedReceivableCents;
      approved += balance.approvedCents;
      rejected += balance.rejectedCents;
      received += balance.receivedCents;
      outstanding += balance.outstandingCents;
    }

    return {
      claimed: fromCents(claimed),
      fee: fromCents(fee),
      expectedReceivable: fromCents(expected),
      approved: fromCents(approved),
      rejected: fromCents(rejected),
      received: fromCents(received),
      outstanding: fromCents(outstanding),
    };
  }
}

const CLAIM_STATUS: Record<string, PanelClaimStatus> = {
  SUBMITTED: PanelClaimStatus.SUBMITTED,
  PARTIALLY_PAID: PanelClaimStatus.PARTIALLY_PAID,
  PAID: PanelClaimStatus.PAID,
  REJECTED: PanelClaimStatus.REJECTED,
  WRITTEN_OFF: PanelClaimStatus.WRITTEN_OFF,
};

