import { Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from './tenant-scoped-prisma.provider';
import { currentTenantId } from './tenant-context';

// Generic per-tenant key/value config (docs/DATABASE_ARCHITECTURE.md §2) —
// first real consumer is the Queue Monitor's configurable running text
// (docs/PRODUCT_REQUIREMENTS.md §4), not a full Settings module yet.
@Injectable()
export class GlobalSettingService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  async get(key: string) {
    const setting = await this.prisma.globalSetting.findUnique({
      where: { tenantId_key: { tenantId: currentTenantId(), key } },
    });
    return setting?.value ?? null;
  }

  set(key: string, value: unknown) {
    const tenantId = currentTenantId();
    return this.prisma.globalSetting.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, value: value as never },
      update: { value: value as never },
    });
  }
}
