import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateServiceDto } from './dto/create-service.dto';

@Injectable()
export class ServiceCatalogService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  create(dto: CreateServiceDto) {
    return this.prisma.serviceCatalog.create({ data: { ...dto, tenantId: currentTenantId() } });
  }

  findAll() {
    return this.prisma.serviceCatalog.findMany({ orderBy: { name: 'asc' } });
  }

  async findById(id: string) {
    const service = await this.prisma.serviceCatalog.findUnique({ where: { id } });
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    return service;
  }
}
