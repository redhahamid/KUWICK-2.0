import { Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { SaveClaimPolicyDto } from './dto/save-claim-policy.dto';

/**
 * HOW THE CLINIC PRICES AND POLICES CLAIMS — the mileage rate and whether a
 * receipt is required. One row per clinic, made with its defaults the first
 * time anybody asks, so a portal that prices a journey never finds nothing.
 *
 * The rate is copied onto each mileage claim when it is sent (`mileageRate`),
 * so changing it here reprices tomorrow's claims and none of yesterday's.
 */
export const DEFAULT_MILEAGE_RATE_RM = '0.60';

@Injectable()
export class ClaimPolicyService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** The policy in force, read by anybody signed in (the portal prices with it). */
  async current() {
    const row = await this.ensure();
    return {
      mileageRatePerKm: row.mileageRatePerKm.toFixed(2),
      receiptRequired: row.receiptRequired,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** The same, for the Settings screen — behind `hr.view`. */
  async read() {
    await requirePermission(this.rawPrisma, 'hr.view');
    return this.current();
  }

  async save(dto: SaveClaimPolicyDto) {
    return withAdminTx(this.rawPrisma, 'settings.manage', async (tx, actor) => {
      const before = await this.ensure();
      const saved = await tx.claimPolicy.update({
        where: { tenantId: currentTenantId() },
        data: {
          ...(dto.mileageRatePerKm !== undefined ? { mileageRatePerKm: dto.mileageRatePerKm } : {}),
          ...(dto.receiptRequired !== undefined ? { receiptRequired: dto.receiptRequired } : {}),
          updatedByStaffId: actor.id,
        },
      });
      await recordAudit(tx, actor, {
        action: 'claimPolicy.saved',
        entityType: 'ClaimPolicy',
        entityId: saved.id,
        before: { mileageRatePerKm: before.mileageRatePerKm.toFixed(2), receiptRequired: before.receiptRequired },
        after: { mileageRatePerKm: saved.mileageRatePerKm.toFixed(2), receiptRequired: saved.receiptRequired },
        reason: dto.reason,
        source: 'hr.claims',
      });
      return {
        mileageRatePerKm: saved.mileageRatePerKm.toFixed(2),
        receiptRequired: saved.receiptRequired,
        updatedAt: saved.updatedAt.toISOString(),
      };
    });
  }

  private async ensure() {
    const tenantId = currentTenantId();
    const existing = await this.prisma.claimPolicy.findUnique({ where: { tenantId } });
    if (existing) return existing;
    return this.prisma.claimPolicy.create({ data: { tenantId } });
  }
}
