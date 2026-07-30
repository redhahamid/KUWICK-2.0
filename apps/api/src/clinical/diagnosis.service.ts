import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DiagnosisCategory } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { AddDiagnosisDto } from './dto/add-diagnosis.dto';
import { CreateCustomDiagnosisDto } from './dto/create-custom-diagnosis.dto';
import { BulkActivateCatalogDto } from './dto/bulk-activate-catalog.dto';

@Injectable()
export class DiagnosisService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  // Backs the visit's diagnosis picker's search box. D-027 (docs/DECISIONS.md):
  // Custom/Summarize/Full filters which catalog category is searched, not
  // how the added-diagnosis list displays.
  searchCatalog(query?: string, category?: DiagnosisCategory) {
    return this.prisma.diagnosisCatalog.findMany({
      where: {
        active: true,
        category,
        name: query ? { contains: query, mode: 'insensitive' } : undefined,
      },
      orderBy: { name: 'asc' },
      take: 20,
    });
  }

  // The Diagnoses Directory admin screen: list + counts per category.
  listCatalog(category?: DiagnosisCategory) {
    return this.prisma.diagnosisCatalog.findMany({
      where: { category },
      orderBy: { name: 'asc' },
    });
  }

  async catalogCounts() {
    const [summarizeTotal, summarizeActive, fullTotal, fullActive] = await Promise.all([
      this.prisma.diagnosisCatalog.count({ where: { category: DiagnosisCategory.SUMMARIZE } }),
      this.prisma.diagnosisCatalog.count({ where: { category: DiagnosisCategory.SUMMARIZE, active: true } }),
      this.prisma.diagnosisCatalog.count({ where: { category: DiagnosisCategory.FULL } }),
      this.prisma.diagnosisCatalog.count({ where: { category: DiagnosisCategory.FULL, active: true } }),
    ]);
    return { summarize: { total: summarizeTotal, active: summarizeActive }, full: { total: fullTotal, active: fullActive } };
  }

  createCustom(dto: CreateCustomDiagnosisDto) {
    const tenantId = currentTenantId();
    return this.prisma.diagnosisCatalog.create({
      data: { tenantId, name: dto.name, icd10Code: dto.icd10Code, category: DiagnosisCategory.CUSTOM },
    });
  }

  async setCatalogActive(id: string, active: boolean) {
    const entry = await this.prisma.diagnosisCatalog.findUnique({ where: { id } });
    if (!entry) {
      throw new NotFoundException('Diagnosis catalog entry not found');
    }
    return this.prisma.diagnosisCatalog.update({ where: { id }, data: { active } });
  }

  // Bulk-activate/deactivate an entire global category (Summarize or Full)
  // in one action, matching the audited "Bulk Activate Global Categories"
  // toggle cards.
  async bulkActivateCategory(category: DiagnosisCategory, dto: BulkActivateCatalogDto) {
    await this.prisma.diagnosisCatalog.updateMany({
      where: { category },
      data: { active: dto.active },
    });
  }

  findByVisitId(visitId: string) {
    return this.prisma.diagnosis.findMany({
      where: { visitId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Resolves an existing catalog entry, or creates one on the fly when the
  // doctor types a diagnosis that isn't in the catalog yet (added as
  // CUSTOM). Either way, the resulting Diagnosis snapshots icd10Code/name
  // so a later catalog rename can't rewrite this visit's historical record.
  async addToVisit(dto: AddDiagnosisDto) {
    const tenantId = currentTenantId();

    let catalogEntry;
    if (dto.diagnosisCatalogId) {
      catalogEntry = await this.prisma.diagnosisCatalog.findUnique({ where: { id: dto.diagnosisCatalogId } });
      if (!catalogEntry) {
        throw new NotFoundException('Diagnosis catalog entry not found');
      }
    } else if (dto.name) {
      catalogEntry = await this.prisma.diagnosisCatalog.upsert({
        where: { tenantId_name: { tenantId, name: dto.name } },
        create: { tenantId, name: dto.name, icd10Code: dto.icd10Code, category: DiagnosisCategory.CUSTOM },
        update: {},
      });
    } else {
      throw new BadRequestException('Either diagnosisCatalogId or name is required');
    }

    return this.prisma.diagnosis.create({
      data: {
        tenantId,
        visitId: dto.visitId,
        diagnosisCatalogId: catalogEntry.id,
        icd10Code: catalogEntry.icd10Code,
        name: catalogEntry.name,
      },
    });
  }

  async remove(id: string) {
    const diagnosis = await this.prisma.diagnosis.findUnique({ where: { id } });
    if (!diagnosis) {
      throw new NotFoundException('Diagnosis not found');
    }
    await this.prisma.diagnosis.delete({ where: { id } });
  }
}
