import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ClaimTypeSetting } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { SaveClaimPolicyDto } from './dto/save-claim-policy.dto';
import { SaveClaimTypeDto } from './dto/save-claim-type.dto';
import { claimKinds, defaultClaimKinds } from './claim-types';

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

  /** The policy in force, read by anybody signed in (the portal prices with it), with the clinic's claim types. */
  async current() {
    const row = await this.ensure();
    const policy = { mileageRatePerKm: row.mileageRatePerKm.toFixed(2), receiptRequired: row.receiptRequired };
    const types = claimKinds(await this.prisma.claimTypeSetting.findMany({ orderBy: { sortOrder: 'asc' } }), policy);
    return {
      ...policy,
      updatedAt: row.updatedAt.toISOString(),
      types: types.filter((type) => type.active),
    };
  }

  /**
   * THE CLINIC'S CLAIM TYPES, for Settings (Section E). The defaults are
   * written the first time Settings opens them, so each has an id to edit.
   */
  async types() {
    await requirePermission(this.rawPrisma, 'hr.view');
    return (await this.storedTypes()).map(describeClaimType);
  }

  async saveType(id: string | null, dto: SaveClaimTypeDto) {
    await this.storedTypes();
    return withAdminTx(this.rawPrisma, 'settings.manage', async (tx, actor) => {
      const before = id ? await tx.claimTypeSetting.findUnique({ where: { id } }) : null;
      if (id && !before) throw new NotFoundException('Claim type not found');
      const name = dto.name.trim().replace(/\s+/g, ' ');
      if (!name) throw new BadRequestException('Give the claim type a name.');
      const code = before?.code ?? dto.code;
      if (!code) throw new BadRequestException('Give the claim type a code, e.g. PARKING.');
      const unit = dto.unit === undefined ? (before?.unit ?? null) : dto.unit;
      if (unit && !(dto.ratePerUnit ?? before?.ratePerUnit)) throw new BadRequestException(`Give the rate per ${unit.toLowerCase()}.`);
      if (!before && (await tx.claimTypeSetting.findFirst({ where: { code } }))) {
        throw new ConflictException(`There is already a claim type with the code ${code}.`);
      }
      const data = {
        code,
        name,
        unit,
        ratePerUnit: unit ? (dto.ratePerUnit ?? before?.ratePerUnit ?? null) : null,
        dailyUnitCap: unit ? (dto.dailyUnitCap === undefined ? (before?.dailyUnitCap ?? null) : dto.dailyUnitCap) : null,
        receiptRequired: dto.receiptRequired ?? before?.receiptRequired ?? true,
        active: dto.active ?? before?.active ?? true,
      };
      const saved = before
        ? await tx.claimTypeSetting.update({ where: { id: before.id }, data })
        : await tx.claimTypeSetting.create({ data: { ...data, tenantId: currentTenantId(), sortOrder: 100 } });
      await recordAudit(tx, actor, {
        action: 'claimPolicy.saved',
        entityType: 'ClaimTypeSetting',
        entityId: saved.id,
        before: before ? describeClaimType(before) : undefined,
        after: describeClaimType(saved),
        source: 'hr.claims',
      });
      return describeClaimType(saved);
    });
  }

  private async storedTypes(): Promise<ClaimTypeSetting[]> {
    const rows = await this.prisma.claimTypeSetting.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    if (rows.length > 0) return rows;
    const row = await this.ensure();
    const defaults = defaultClaimKinds({ mileageRatePerKm: row.mileageRatePerKm.toFixed(2), receiptRequired: row.receiptRequired });
    await this.prisma.claimTypeSetting.createMany({
      data: defaults.map((kind, index) => ({ ...kind, tenantId: currentTenantId(), sortOrder: index })),
      skipDuplicates: true,
    });
    return this.prisma.claimTypeSetting.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
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

/** What Settings shows of a claim type. */
function describeClaimType(row: ClaimTypeSetting) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    unit: row.unit,
    ratePerUnit: row.ratePerUnit === null ? null : Number(row.ratePerUnit),
    dailyUnitCap: row.dailyUnitCap === null ? null : Number(row.dailyUnitCap),
    receiptRequired: row.receiptRequired,
    active: row.active,
  };
}
