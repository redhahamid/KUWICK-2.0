import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreatePanelPriceOverrideDto } from './dto/create-panel-price-override.dto';
import { CreatePanelExclusionDto } from './dto/create-panel-exclusion.dto';

function assertExactlyOneTarget(itemId?: string, serviceCatalogId?: string) {
  if ((itemId && serviceCatalogId) || (!itemId && !serviceCatalogId)) {
    throw new BadRequestException('Provide exactly one of itemId or serviceCatalogId');
  }
}

// Clinical Operations, Phase A8. Per-panel price overrides + coverage
// exclusions, settled together per owner request — both are keyed the same
// way (panel + exactly one of item/service) and edited from the same Panel
// detail screen.
@Injectable()
export class PanelPricingService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  findOverrides(panelClinicId: string) {
    return this.prisma.panelPriceOverride.findMany({
      where: { panelClinicId },
      include: { item: true, serviceCatalog: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createOverride(panelClinicId: string, dto: CreatePanelPriceOverrideDto) {
    assertExactlyOneTarget(dto.itemId, dto.serviceCatalogId);
    return this.prisma.panelPriceOverride.create({
      data: {
        tenantId: currentTenantId(),
        panelClinicId,
        itemId: dto.itemId,
        serviceCatalogId: dto.serviceCatalogId,
        overridePrice: dto.overridePrice,
      },
    });
  }

  async removeOverride(panelClinicId: string, id: string) {
    const override = await this.prisma.panelPriceOverride.findUnique({ where: { id } });
    if (!override || override.panelClinicId !== panelClinicId) {
      throw new NotFoundException('Price override not found');
    }
    await this.prisma.panelPriceOverride.delete({ where: { id } });
  }

  findExclusions(panelClinicId: string) {
    return this.prisma.panelExclusion.findMany({
      where: { panelClinicId },
      include: { item: true, serviceCatalog: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createExclusion(panelClinicId: string, dto: CreatePanelExclusionDto) {
    assertExactlyOneTarget(dto.itemId, dto.serviceCatalogId);
    return this.prisma.panelExclusion.create({
      data: {
        tenantId: currentTenantId(),
        panelClinicId,
        itemId: dto.itemId,
        serviceCatalogId: dto.serviceCatalogId,
        reason: dto.reason,
      },
    });
  }

  async removeExclusion(panelClinicId: string, id: string) {
    const exclusion = await this.prisma.panelExclusion.findUnique({ where: { id } });
    if (!exclusion || exclusion.panelClinicId !== panelClinicId) {
      throw new NotFoundException('Exclusion not found');
    }
    await this.prisma.panelExclusion.delete({ where: { id } });
  }
}
