import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { branchContext, requireActor, withTenantTx } from './clinical-actor';
import { assertBranchAccess, assertCanPerformBilling } from './clinical-authorization';
import { isValidTimeOfDay } from './consultation-tariff';
import { UpsertConsultationTariffRuleDto } from './dto/upsert-consultation-tariff-rule.dto';

/**
 * G4.5d3c-3b2 (D-094) — the smallest Clinic Management configuration the
 * consultation charge needs: which consultation SERVICE applies at which
 * time of day, for which kind of visit, in which branch.
 *
 * Deliberately NOT a pricing table. The rule selects the ServiceCatalog
 * record; the approved resolver prices it (specific panel price → cash +
 * panel service markup → cash), so a panel's consultation price lives in
 * PanelPriceOverride where every other panel price already lives. One
 * pricing truth, not two.
 *
 * Configuring the clinic's money is a financial-tier action: OWNER_ADMIN and
 * FINANCE_STAFF, the same tier as discounts (D-093). Branch access is
 * enforced against the rule's own clinic.
 */
@Injectable()
export class ConsultationTariffService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** Any active staff member with branch access may READ the configuration. */
  async findAll(clinicId?: string) {
    await withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      if (clinicId) {
        assertBranchAccess(actor, clinicId, await branchContext(tx, actor));
      }
    });
    return this.prisma.consultationTariffRule.findMany({
      where: clinicId ? { clinicId } : {},
      include: {
        serviceCatalog: { select: { id: true, name: true, price: true, active: true } },
        clinic: { select: { id: true, name: true } },
      },
      orderBy: [{ clinicId: 'asc' }, { startTime: 'asc' }],
    });
  }

  async create(dto: UpsertConsultationTariffRuleDto) {
    const actor = await this.authorise(dto.clinicId);
    await this.assertConfigurationValid(dto);
    return this.prisma.consultationTariffRule.create({
      data: {
        tenantId: currentTenantId(),
        clinicId: dto.clinicId,
        name: dto.name.trim(),
        active: dto.active ?? true,
        classification: dto.classification,
        startTime: dto.startTime,
        endTime: dto.endTime,
        serviceCatalogId: dto.serviceCatalogId,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      },
      include: { serviceCatalog: { select: { id: true, name: true, price: true, active: true } } },
    });
  }

  async update(id: string, dto: UpsertConsultationTariffRuleDto) {
    const existing = await this.prisma.consultationTariffRule.findUnique({
      where: { id },
      select: { id: true, clinicId: true },
    });
    if (!existing) {
      throw new NotFoundException('Consultation tariff rule not found');
    }
    // Authorised against BOTH branches: a rule cannot be moved into a branch
    // the actor may not configure, nor out of one they may not touch.
    await this.authorise(existing.clinicId);
    await this.authorise(dto.clinicId);
    await this.assertConfigurationValid(dto);
    return this.prisma.consultationTariffRule.update({
      where: { id },
      data: {
        clinicId: dto.clinicId,
        name: dto.name.trim(),
        active: dto.active ?? true,
        classification: dto.classification,
        startTime: dto.startTime,
        endTime: dto.endTime,
        serviceCatalogId: dto.serviceCatalogId,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      },
      include: { serviceCatalog: { select: { id: true, name: true, price: true, active: true } } },
    });
  }

  /**
   * Deactivation, not deletion: a rule is referenced by the invoice lines it
   * produced, and their history must keep answering "which tariff charged
   * this". Existing charges are never affected either way.
   */
  async deactivate(id: string) {
    const existing = await this.prisma.consultationTariffRule.findUnique({
      where: { id },
      select: { id: true, clinicId: true },
    });
    if (!existing) {
      throw new NotFoundException('Consultation tariff rule not found');
    }
    await this.authorise(existing.clinicId);
    return this.prisma.consultationTariffRule.update({ where: { id }, data: { active: false } });
  }

  private async authorise(clinicId: string) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      // Configuring what the clinic charges is financial-tier work.
      assertCanPerformBilling(actor, 'APPLY_DISCOUNT');
      assertBranchAccess(actor, clinicId, await branchContext(tx, actor));
      return actor;
    });
  }

  /** Fails closed on every combination the matcher could not act on. */
  private async assertConfigurationValid(dto: UpsertConsultationTariffRuleDto) {
    if (!isValidTimeOfDay(dto.startTime) || !isValidTimeOfDay(dto.endTime)) {
      throw new BadRequestException('Times must be a 24-hour HH:MM value, for example 08:00 or 22:59.');
    }
    if (dto.startTime === dto.endTime) {
      throw new BadRequestException('The start and end of a time band cannot be identical.');
    }
    if (dto.effectiveFrom && dto.effectiveTo && new Date(dto.effectiveFrom) > new Date(dto.effectiveTo)) {
      throw new BadRequestException('The effective-from date cannot be after the effective-to date.');
    }
    const clinic = await this.prisma.clinic.findUnique({ where: { id: dto.clinicId }, select: { id: true } });
    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }
    const service = await this.prisma.serviceCatalog.findUnique({
      where: { id: dto.serviceCatalogId },
      select: { id: true, active: true },
    });
    if (!service) {
      throw new NotFoundException('Consultation service not found');
    }
    if (!service.active) {
      throw new BadRequestException('That consultation service is inactive. Activate it before using it in a tariff.');
    }
  }
}
