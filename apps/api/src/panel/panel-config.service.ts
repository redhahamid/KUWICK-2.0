import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PanelFeeTreatment, Prisma } from '@prisma/client';
import { currentTenantId } from '../core/tenant-context';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { diffOf, recordAudit } from '../finance/admin-audit';
import { UpsertPanelConfigDto } from './dto/upsert-panel-config.dto';

/**
 * A panel's OPERATIONAL configuration.
 *
 * Deliberately separate from `PanelClinicService`, which owns the commercial
 * terms (per-visit limit, claim fee, markups) and is already wired into
 * pricing. This is the workspace's half: where the portal is, how claims go
 * out, what has to be in hand first, and who to ring. Splitting them keeps the
 * pricing path — which every invoice depends on — out of the blast radius of
 * an admin editing a phone number.
 */
@Injectable()
export class PanelConfigService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async list() {
    await requirePermission(this.rawPrisma, 'panel.view');
    const panels = await this.prisma.panelClinic.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { claimBatches: true, visits: true, priceOverrides: true, exclusions: true } },
        feeTerms: { orderBy: { effectiveFrom: 'desc' }, take: 10 },
      },
    });
    return panels.map((panel) => ({
      id: panel.id,
      name: panel.name,
      code: panel.code,
      payerName: panel.payerName,
      active: panel.active,
      portalUrl: panel.portalUrl,
      submissionMethod: panel.submissionMethod,
      documentRequirements: panel.documentRequirements,
      requiresItemisation: panel.requiresItemisation,
      resubmitAsNewClaim: panel.resubmitAsNewClaim,
      claimNumberFormat: panel.claimNumberFormat,
      paymentTermDays: panel.paymentTermDays,
      paymentTermMaxDays: panel.paymentTermMaxDays,
      paymentTermUnit: panel.paymentTermUnit,
      paymentTermAnchor: panel.paymentTermAnchor,
      paymentTermVariesByPayer: panel.paymentTermVariesByPayer,
      resubmissionWindowDays: panel.resubmissionWindowDays,
      feeTreatment: panel.feeTreatment,
      /** The effective-dated history behind the current treatment. */
      feeTerms: panel.feeTerms.map((term) => ({
        effectiveFrom: term.effectiveFrom.toISOString().slice(0, 10),
        feeTreatment: term.feeTreatment,
        feeType: term.feeType,
        feeValue: term.feeValue === null ? null : Number(term.feeValue),
        note: term.note,
      })),
      /**
       * TRUE when this panel charges a fee but nobody has said which way it
       * moves. Every receivable on the panel is then computed WITHOUT the fee
       * and flagged, so this is the row an owner has to come and fix.
       */
      /**
       * TRUE when this panel charges a fee and nobody has established how it is
       * treated. Every receivable on the panel is then computed WITHOUT the
       * fee, so this is the row an owner has to come and answer.
       */
      feeTreatmentUnresolved: panel.feeTreatment === 'UNCONFIGURED',
      claimFeeType: panel.claimFeeType,
      claimFeeValue: panel.claimFeeValue === null ? null : Number(panel.claimFeeValue),
      limitAmount: panel.limitAmount === null ? null : Number(panel.limitAmount),
      inventoryMarkupAmount:
        panel.inventoryMarkupAmount === null ? null : Number(panel.inventoryMarkupAmount),
      serviceMarkupAmount: panel.serviceMarkupAmount === null ? null : Number(panel.serviceMarkupAmount),
      panelShareTaxable: panel.panelShareTaxable,
      contactName: panel.contactName,
      contactPhone: panel.contactPhone,
      contactEmail: panel.contactEmail,
      accountReference: panel.accountReference,
      notes: panel.notes,
      batches: panel._count.claimBatches,
      visits: panel._count.visits,
      priceOverrides: panel._count.priceOverrides,
      exclusions: panel._count.exclusions,
    }));
  }

  async update(id: string, dto: UpsertPanelConfigDto) {
    return withAdminTx(this.rawPrisma, 'panel.configure', async (tx, actor) => {
      const before = await tx.panelClinic.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Panel not found');

      const updated = await tx.panelClinic.update({
        where: { id },
        data: {
          payerName: dto.payerName,
          portalUrl: dto.portalUrl,
          submissionMethod: dto.submissionMethod,
          documentRequirements: dto.documentRequirements,
          requiresItemisation: dto.requiresItemisation,
          resubmitAsNewClaim: dto.resubmitAsNewClaim,
          claimNumberFormat: dto.claimNumberFormat,
          contactName: dto.contactName,
          contactPhone: dto.contactPhone,
          contactEmail: dto.contactEmail,
          accountReference: dto.accountReference,
          notes: dto.notes,
          panelShareTaxable: dto.panelShareTaxable,
          paymentTermDays: dto.paymentTermDays,
          paymentTermMaxDays: dto.paymentTermMaxDays,
          paymentTermUnit: dto.paymentTermUnit,
          paymentTermAnchor: dto.paymentTermAnchor,
          paymentTermVariesByPayer: dto.paymentTermVariesByPayer,
          resubmissionWindowDays: dto.resubmissionWindowDays,
        },
      });

      // ---------------------------------------------------------------------
      // THE FEE TERM IS EFFECTIVE-DATED (owner requirement, 2026-08-31).
      //
      // Writing a term does three things, in one transaction so they cannot
      // disagree:
      //
      //   1. records the term in the panel's HISTORY, which is authoritative;
      //   2. mirrors the CURRENT term onto `PanelClinic`, so the read sites that
      //      need "what is it today" do not each resolve a date range — the same
      //      convention as `Invoice.patientPaidAmount` mirroring the payment
      //      ledger;
      //   3. re-stamps claims NOBODY HAS SENT YET.
      //
      // On (3): `ClaimBatchLine.feeTreatment` is a snapshot, so a claim already
      // submitted keeps the arithmetic it was raised under. That is the whole
      // point of snapshotting, and it is what makes an effective-dated history
      // safe to edit at all — a correction to the terms cannot reach back into
      // a claim that is already with the panel. A claim still sitting in
      // BATCHED has been sent to nobody, so it takes the corrected fact. The
      // fee AMOUNT is never re-stamped: that is a price, and prices stay as
      // billed.
      //
      // Re-stamping only happens for a term effective TODAY OR EARLIER. A term
      // agreed for next month must not change what an unsent claim is worth
      // this month.
      // ---------------------------------------------------------------------
      let restamped = 0;
      let feeTermRecorded: { effectiveFrom: string; feeTreatment: PanelFeeTreatment } | null = null;

      const wantsFeeTerm =
        dto.feeTreatment !== undefined ||
        dto.claimFeeType !== undefined ||
        dto.claimFeeValue !== undefined;

      if (wantsFeeTerm) {
        const today = new Date();
        const effectiveFrom = new Date(
          `${(dto.feeEffectiveFrom ?? today.toISOString()).slice(0, 10)}T00:00:00.000Z`,
        );
        const treatment = dto.feeTreatment ?? before.feeTreatment;
        const feeType = dto.claimFeeType ?? before.claimFeeType;
        const feeValue =
          dto.claimFeeValue !== undefined
            ? new Prisma.Decimal(dto.claimFeeValue)
            : before.claimFeeValue;

        // A treatment that says there is no fee must not carry one, or the two
        // halves of the same term contradict each other.
        if (treatment === PanelFeeTreatment.NO_FEE && Number(feeValue ?? 0) > 0) {
          throw new BadRequestException(
            'NO_FEE means this panel charges nothing. Clear the fee value, or choose how the fee is treated.',
          );
        }

        await tx.panelFeeTerm.upsert({
          where: {
            tenantId_panelClinicId_effectiveFrom: {
              tenantId: currentTenantId(),
              panelClinicId: id,
              effectiveFrom,
            },
          },
          create: {
            tenantId: currentTenantId(),
            panelClinicId: id,
            effectiveFrom,
            feeTreatment: treatment,
            feeType: feeType ?? null,
            feeValue: feeValue ?? null,
            note: dto.feeTermNote ?? null,
            recordedByStaffId: actor.id,
          },
          update: {
            feeTreatment: treatment,
            feeType: feeType ?? null,
            feeValue: feeValue ?? null,
            note: dto.feeTermNote ?? null,
            recordedByStaffId: actor.id,
          },
        });
        feeTermRecorded = {
          effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
          feeTreatment: treatment,
        };

        // Mirror the term IN FORCE TODAY, which is not necessarily the one just
        // written — a term dated next month leaves today's mirror alone.
        const current = await tx.panelFeeTerm.findFirst({
          where: { panelClinicId: id, effectiveFrom: { lte: new Date(`${today.toISOString().slice(0, 10)}T00:00:00.000Z`) } },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (current) {
          await tx.panelClinic.update({
            where: { id },
            data: {
              feeTreatment: current.feeTreatment,
              claimFeeType: current.feeType,
              claimFeeValue: current.feeValue,
            },
          });
          if (current.feeTreatment !== before.feeTreatment) {
            const result = await tx.claimBatchLine.updateMany({
              where: {
                claimStatus: { in: ['READY', 'NEEDS_INFORMATION', 'BATCHED'] },
                claimBatch: { panelClinicId: id, status: 'BATCHED' },
              },
              data: { feeTreatment: current.feeTreatment },
            });
            restamped = result.count;
          }
        }

        await recordAudit(tx, actor, {
          action: 'panel.feeTermRecorded',
          entityType: 'PanelClinic',
          entityId: id,
          before: {
            feeTreatment: before.feeTreatment,
            claimFeeType: before.claimFeeType,
            claimFeeValue: before.claimFeeValue === null ? null : Number(before.claimFeeValue),
          },
          after: {
            effectiveFrom: feeTermRecorded.effectiveFrom,
            feeTreatment: treatment,
            claimFeeType: feeType,
            claimFeeValue: feeValue === null || feeValue === undefined ? null : Number(feeValue),
          },
          reason: dto.feeTermNote,
          source: 'panel.configuration',
        });
      }

      const changed = diffOf(before as unknown as Record<string, unknown>, dto as Record<string, unknown>);
      await recordAudit(tx, actor, {
        action: 'panel.configured',
        entityType: 'PanelClinic',
        entityId: id,
        before: changed.before,
        after: changed.after,
        source: 'panel.configuration',
      });

      if (restamped > 0) {
        await recordAudit(tx, actor, {
          action: 'panel.feeTreatmentRestamped',
          entityType: 'PanelClinic',
          entityId: id,
          before: { feeTreatment: before.feeTreatment },
          after: { feeTreatment: dto.feeTreatment, unsentClaimsRestamped: restamped },
          source: 'panel.configuration',
        });
      }

      return { ...updated, unsentClaimsRestamped: restamped, feeTermRecorded };
    });
  }
}
