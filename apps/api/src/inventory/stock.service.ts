import { Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { SetStockMinThresholdDto } from './dto/set-stock-min-threshold.dto';

@Injectable()
export class StockService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  listLevels(clinicId?: string) {
    return this.prisma.stockLevel.findMany({
      where: { clinicId },
      include: { item: true },
      orderBy: { item: { name: 'asc' } },
    });
  }

  // No column-to-column comparison in the `where` clause (Prisma can't
  // express quantityOnHand < minThreshold directly) — filtered in app code
  // instead of a raw query, since a raw query bypasses the tenant-scoping
  // extension's RLS session-variable setup (docs/CODING_STANDARDS.md §6).
  // Fine at Phase-1 data volume; a materialized view is the Phase-2 answer
  // if this ever needs to scale (docs/DATABASE_ARCHITECTURE.md §8).
  async listLowStock(clinicId?: string) {
    const levels = await this.listLevels(clinicId);
    return levels.filter((level) => level.quantityOnHand < level.minThreshold);
  }

  // Negative stock is allowed, not blocked (docs/DECISIONS.md D-020) — this
  // is the reconciliation surface admin uses to find and fix it. Unlike
  // low-stock (column-vs-column), this is column-vs-literal, so Prisma can
  // express it directly without an app-code filter.
  listNegativeStock(clinicId?: string) {
    return this.prisma.stockLevel.findMany({
      where: { clinicId, quantityOnHand: { lt: 0 } },
      include: { item: true },
      orderBy: { quantityOnHand: 'asc' },
    });
  }

  listBatches(clinicId?: string, itemId?: string) {
    return this.prisma.stockBatch.findMany({
      where: { clinicId, itemId },
      orderBy: { expiryDate: 'asc' },
    });
  }

  listMovements(clinicId?: string, itemId?: string) {
    return this.prisma.stockMovement.findMany({
      where: { clinicId, itemId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Configures a branch's tracking row for an item (its low-stock
  // threshold) — never changes quantityOnHand itself; that only ever moves
  // through GoodsReceivingService's StockMovement ledger writes.
  setMinThreshold(dto: SetStockMinThresholdDto) {
    const tenantId = currentTenantId();
    return this.prisma.stockLevel.upsert({
      where: {
        tenantId_clinicId_itemId: { tenantId, clinicId: dto.clinicId, itemId: dto.itemId },
      },
      create: { tenantId, clinicId: dto.clinicId, itemId: dto.itemId, minThreshold: dto.minThreshold },
      update: { minThreshold: dto.minThreshold },
    });
  }
}
