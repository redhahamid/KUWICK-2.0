import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { AddDiagnosisDto } from './dto/add-diagnosis.dto';

@Injectable()
export class DiagnosisService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  // Backs the visit's diagnosis picker's search box — the catalog itself
  // has no dedicated admin screen this phase.
  searchCatalog(query?: string) {
    return this.prisma.diagnosisCatalog.findMany({
      where: {
        active: true,
        name: query ? { contains: query, mode: 'insensitive' } : undefined,
      },
      orderBy: { name: 'asc' },
      take: 20,
    });
  }

  findByVisitId(visitId: string) {
    return this.prisma.diagnosis.findMany({
      where: { visitId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Resolves an existing catalog entry, or creates one on the fly when the
  // doctor types a diagnosis that isn't in the catalog yet — the catalog
  // has no separate admin CRUD screen this phase (Clinical 2b plan). Either
  // way, the resulting Diagnosis snapshots code/name so a later catalog
  // rename can't rewrite this visit's historical record.
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
        create: { tenantId, name: dto.name, code: dto.code },
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
        code: catalogEntry.code,
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
