import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { StockMovementType } from '@prisma/client';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { SetStockMinThresholdDto } from './dto/set-stock-min-threshold.dto';
import { QuickAddStockDto } from './dto/quick-add-stock.dto';
import { StockTakeDto } from './dto/stock-take.dto';

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

  // Near-expiry surface (D-043) — batches with stock still on hand whose
  // expiry falls within the window (or has already passed). The expiry
  // data has been captured since Task #62's quick-add / GRN flows; this is
  // the report that finally surfaces it.
  async listNearExpiry(clinicId?: string, withinDays = 90) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + withinDays);
    const batches = await this.prisma.stockBatch.findMany({
      where: {
        clinicId,
        quantity: { gt: 0 },
        expiryDate: { not: null, lte: cutoff },
      },
      include: { item: true, clinic: true, supplier: true },
      orderBy: { expiryDate: 'asc' },
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return batches.map((batch) => ({
      ...batch,
      daysToExpiry: Math.ceil((batch.expiryDate!.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
    }));
  }

  // Stock take (D-043) — physical count vs system. Each variance writes an
  // ADJUSTMENT movement (the ledger stays the single source of quantity
  // change, same rule as every other flow) and sets the StockLevel to the
  // counted quantity. Items counted equal to system are recorded as
  // zero-variance results but write nothing.
  async performStockTake(dto: StockTakeDto) {
    const tenantId = currentTenantId();
    const results: {
      itemId: string;
      itemName: string;
      systemQuantity: number;
      countedQuantity: number;
      variance: number;
    }[] = [];

    for (const count of dto.counts) {
      const level = await this.prisma.stockLevel.findUnique({
        where: { tenantId_clinicId_itemId: { tenantId, clinicId: dto.clinicId, itemId: count.itemId } },
        include: { item: true },
      });
      const item = level?.item ?? (await this.prisma.item.findUnique({ where: { id: count.itemId } }));
      if (!item) continue;
      const systemQuantity = level?.quantityOnHand ?? 0;
      const variance = count.countedQuantity - systemQuantity;

      if (variance !== 0) {
        await this.prisma.stockMovement.create({
          data: {
            tenantId,
            clinicId: dto.clinicId,
            itemId: count.itemId,
            movementType: StockMovementType.ADJUSTMENT,
            quantityDelta: variance,
            referenceType: 'StockTake',
            createdByUserId: dto.countedByStaffId,
          },
        });
        await this.prisma.stockLevel.upsert({
          where: { tenantId_clinicId_itemId: { tenantId, clinicId: dto.clinicId, itemId: count.itemId } },
          create: { tenantId, clinicId: dto.clinicId, itemId: count.itemId, quantityOnHand: count.countedQuantity },
          update: { quantityOnHand: count.countedQuantity },
        });
      }

      results.push({
        itemId: count.itemId,
        itemName: item.name,
        systemQuantity,
        countedQuantity: count.countedQuantity,
        variance,
      });
    }

    return {
      clinicId: dto.clinicId,
      countedItems: results.length,
      adjustedItems: results.filter((row) => row.variance !== 0).length,
      results,
    };
  }

  listMovements(clinicId?: string, itemId?: string) {
    return this.prisma.stockMovement.findMany({
      where: { clinicId, itemId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // "Inventory In" quick modal (Task #62) — records incoming stock without
  // a formal Purchase Order/GRN (e.g. free samples, walk-in supplier drop-
  // off, manual correction). Mirrors GoodsReceivingService's batch +
  // movement + stock-level writes, just without a PO/GRN to link against;
  // referenceType/referenceId point at the batch itself so the movement
  // ledger still has a traceable source.
  /**
   * THE QUICK +/− ON THE INVENTORY LIST — a correction, recorded as one.
   *
   * Deliberately NOT `quickAdd`. That writes a StockBatch and a GOODS_RECEIVED
   * movement, which asserts stock arrived from a supplier; doing that with no
   * supplier, no batch number and no expiry produces receipts nobody can
   * reconcile and batches with no expiry date polluting the near-expiry
   * screen. Somebody tapping + because the shelf says 41 and the screen says
   * 40 is correcting the record, and ADJUSTMENT is the entry that says so —
   * the same movement type the stock-take writes, for the same reason.
   *
   * The balance is allowed to go negative, unchanged from D-020: front-line
   * staff dispense before the system catches up, and admin reconciles from
   * GET /stock/negative-stock rather than being blocked at the shelf.
   *
   * One transaction. A movement without the level it justifies is a ledger
   * that does not add up, and the ledger is the thing being protected here.
   */
  async adjust(dto: AdjustStockDto) {
    const tenantId = currentTenantId();
    const item = await this.prisma.item.findUnique({ where: { id: dto.itemId }, select: { id: true } });
    if (!item) throw new NotFoundException('Item not found');

    return this.prisma.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          tenantId,
          clinicId: dto.clinicId,
          itemId: dto.itemId,
          movementType: StockMovementType.ADJUSTMENT,
          quantityDelta: dto.quantityDelta,
          referenceType: 'InventoryQuickAdjust',
          notes: dto.reason,
        },
      });

      return tx.stockLevel.upsert({
        where: { tenantId_clinicId_itemId: { tenantId, clinicId: dto.clinicId, itemId: dto.itemId } },
        create: {
          tenantId,
          clinicId: dto.clinicId,
          itemId: dto.itemId,
          quantityOnHand: dto.quantityDelta,
        },
        update: { quantityOnHand: { increment: dto.quantityDelta } },
      });
    });
  }

  async quickAdd(dto: QuickAddStockDto) {
    const tenantId = currentTenantId();

    const batch = await this.prisma.stockBatch.create({
      data: {
        tenantId,
        clinicId: dto.clinicId,
        itemId: dto.itemId,
        quantity: dto.quantity,
        batchNumber: dto.batchNumber,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        receivedDate: new Date(),
        supplierId: dto.supplierId,
        addedByStaffId: dto.addedByStaffId,
      },
    });

    await this.prisma.stockMovement.create({
      data: {
        tenantId,
        clinicId: dto.clinicId,
        itemId: dto.itemId,
        batchId: batch.id,
        movementType: StockMovementType.GOODS_RECEIVED,
        quantityDelta: dto.quantity,
        referenceType: 'QuickStockIn',
        referenceId: batch.id,
      },
    });

    await this.prisma.stockLevel.upsert({
      where: {
        tenantId_clinicId_itemId: { tenantId, clinicId: dto.clinicId, itemId: dto.itemId },
      },
      create: {
        tenantId,
        clinicId: dto.clinicId,
        itemId: dto.itemId,
        quantityOnHand: dto.quantity,
      },
      update: { quantityOnHand: { increment: dto.quantity } },
    });

    return batch;
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
