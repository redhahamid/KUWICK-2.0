import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

// Platform-admin tenant management (D-034) — deliberately cross-tenant
// (creating/onboarding new clinic businesses onto the SaaS), so this uses
// plain PrismaService, never TENANT_SCOPED_PRISMA. Guarded by
// PlatformAuthGuard, not TenantContextMiddleware.
//
// Every call sets app.bypass_tenant_scope first (migration
// 20260731280000): the tenants table's RLS policy normally requires
// id = app.tenant_id, which no platform-admin operation can satisfy (there
// is no single tenant being scoped to — that's the point of this service).
@Injectable()
export class PlatformTenantService {
  constructor(private readonly prisma: PrismaService) {}

  private async withBypass<T>(fn: (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      return fn(tx);
    });
  }

  create(dto: CreateTenantDto) {
    return this.withBypass((tx) => tx.tenant.create({ data: { name: dto.name, slug: dto.slug } }));
  }

  findAll() {
    return this.withBypass((tx) => tx.tenant.findMany({ orderBy: { createdAt: 'desc' } }));
  }

  async findById(id: string) {
    const tenant = await this.withBypass((tx) => tx.tenant.findUnique({ where: { id } }));
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto) {
    await this.findById(id);
    return this.withBypass((tx) => tx.tenant.update({ where: { id }, data: dto }));
  }
}
