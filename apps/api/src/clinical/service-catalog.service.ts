import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
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
        ...(term ? { name: { contains: term, mode: 'insensitive' as const } } : {}),
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
