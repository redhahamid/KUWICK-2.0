import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { serviceSearchClauses } from './service-search';
import { CreateServiceDto, UpdateServiceDto } from './dto/create-service.dto';

import { DEFAULT_CATALOGUE_TAKE, MAX_CATALOGUE_TAKE } from '../inventory/item.service';

@Injectable()
export class ServiceCatalogService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  create(dto: CreateServiceDto) {
    return this.prisma.serviceCatalog.create({ data: { ...dto, tenantId: currentTenantId() } });
  }

  /**
   * G4.5d5b-1 — bounded and searchable, for the same reason as items, and
   * with the same boundary: only a SEARCH is capped. The services management
   * page still lists everything.
   */
  findAll(search?: string, take?: number, orderType?: string) {
    const term = search?.trim();
    return this.prisma.serviceCatalog.findMany({
      where: {
        // Name, CODE and category — see service-search.ts. This searched
        // `name` alone, so a procedure could not be found by the code printed
        // on the order form, while the two rails that filter in the browser
        // found it because their label reads "CODE — Name". One catalogue,
        // two surfaces, broken in opposite directions.
        ...(term ? { OR: serviceSearchClauses(term) } : {}),
        // Filtered by the SERVER: the orders rail used to fetch every service
        // and filter for TASK_ORDER in the browser, which means a bounded
        // search would silently return a page of the wrong kind.
        ...(orderType ? { orderType: orderType as never } : {}),
      },
      orderBy: { name: 'asc' },
      ...(term || take
        ? { take: Math.min(take ?? DEFAULT_CATALOGUE_TAKE, MAX_CATALOGUE_TAKE) }
        : {}),
    });
  }

  async findById(id: string) {
    const service = await this.prisma.serviceCatalog.findUnique({ where: { id } });
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    return service;
  }

  async update(id: string, dto: UpdateServiceDto) {
    await this.findById(id);
    return this.prisma.serviceCatalog.update({ where: { id }, data: dto });
  }
}
