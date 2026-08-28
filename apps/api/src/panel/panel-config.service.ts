import { Inject, Injectable, NotFoundException } from '@nestjs/common';
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
        },
      });

      const changed = diffOf(before as unknown as Record<string, unknown>, dto as Record<string, unknown>);
      await recordAudit(tx, actor, {
        action: 'panel.configured',
        entityType: 'PanelClinic',
        entityId: id,
        before: changed.before,
        after: changed.after,
        source: 'panel.configuration',
      });

      return updated;
    });
  }
}
