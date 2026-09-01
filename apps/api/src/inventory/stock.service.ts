import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { StockMovementType } from '@prisma/client';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { PrismaService } from '../core/prisma.service';
import { requireScope } from '../finance/admin-actor';
import { SetStockMinThresholdDto } from './dto/set-stock-min-threshold.dto';
import { QuickAddStockDto } from './dto/quick-add-stock.dto';
import { StockTakeDto } from './dto/stock-take.dto';
import { LedgerTx, postMovement } from '../stock/stock-ledger';
import { batchExposure } from './batch-exposure';

@Injectable()
export class StockService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /*
   * AUTHORISE, THEN SCOPE.
   *
   * This service had no authorisation call of any kind. Six reads passed
   * `clinicId` from the query string into Prisma — `where: { clinicId }` with
   * undefined means NO filter, so leaving the parameter off read every
   * branch's stock — and three WRITES took the branch from the request body,
   * so a stock take, an adjustment or a quick-add could be posted into a
   * branch the account had nothing to do with.
   */
  private async readScope() {
    const { scope } = await requireScope(this.rawPrisma, 'stock.view');
    return scope;
  }

  private async writeScope() {
    const { scope } = await requireScope(this.rawPrisma, 'stock.adjust');
    return scope;
  }

  async listLevels(clinicId?: string) {
    const scope = await this.readScope();
    return this.prisma.stockLevel.findMany({
      where: { ...scope.where(clinicId) },
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
  async listNegativeStock(clinicId?: string) {
    const scope = await this.readScope();
    return this.prisma.stockLevel.findMany({
      where: { ...scope.where(clinicId), quantityOnHand: { lt: 0 } },
      include: { item: true },
      orderBy: { quantityOnHand: 'asc' },
    });
  }

  async listBatches(clinicId?: string, itemId?: string) {
    const scope = await this.readScope();
    return this.prisma.stockBatch.findMany({
      where: { ...scope.where(clinicId), itemId },
      orderBy: { expiryDate: 'asc' },
    });
  }

  /**
   * Near-expiry surface (D-043) — batches whose expiry falls within the window
   * or has already passed.
   *
   * `quantity` on a batch is the quantity RECEIVED and is never decremented,
   * because Kuwick does not attribute a dispense to a batch. This method used
   * to filter on `quantity > 0` and call the result "batches with stock still
   * on hand", which it is not: a batch dispensed to nothing still appeared, at
   * its full received quantity. Batches of an item the clinic no longer holds
   * are now excluded — that much is certain without batch attribution — and
   * both figures are returned rather than one standing in for the other. See
   * `batch-exposure.ts`.
   */
  async listNearExpiry(clinicId?: string, withinDays = 90) {
    const scope = await this.readScope();
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
    const levels = await this.prisma.stockLevel.findMany({
      where: {
        clinicId,
        itemId: { in: [...new Set(batches.map((batch) => batch.itemId))] },
      },
      select: { itemId: true, clinicId: true, quantityOnHand: true },
    });
    const onHandOf = new Map(levels.map((level) => [`${level.clinicId}:${level.itemId}`, level.quantityOnHand]));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return batches
      .map((batch) => {
        const exposure = batchExposure({
          receivedQuantity: batch.quantity,
          itemOnHand: onHandOf.get(`${batch.clinicId}:${batch.itemId}`) ?? 0,
        });
        return {
          ...batch,
          /** What arrived in this batch. NOT what is left — nothing tracks that. */
          receivedQuantity: exposure.receivedQuantity,
          /** What the clinic holds of this item now, across all batches. */
          itemOnHand: exposure.itemOnHand,
          /** The most of this batch that can still be on the shelf. */
          atRiskQuantity: exposure.atRiskCeiling,
          fullyConsumed: exposure.fullyConsumed,
          daysToExpiry: Math.ceil((batch.expiryDate!.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
        };
      })
      .filter((row) => !row.fullyConsumed);
  }

  // Stock take (D-043) — physical count vs system. Each variance writes an
  // ADJUSTMENT movement (the ledger stays the single source of quantity
  // change, same rule as every other flow) and sets the StockLevel to the
  // counted quantity. Items counted equal to system are recorded as
  // zero-variance results but write nothing.
  async performStockTake(dto: StockTakeDto) {
    // The branch comes from the request body, so it is validated against
    // what this account may actually write to before anything is posted.
    const scope = await this.writeScope();
    dto = { ...dto, clinicId: scope.require(dto.clinicId) };
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

      // WAVE 2 — THIS NO LONGER WRITES STOCK.
      //
      // It used to adjust the live level the instant somebody typed a count,
      // which is precisely what the owner brief forbids: "Do NOT change live
      // stock simply because someone typed a count before approval." A count
      // is now recorded against a StockTake and posted to the ledger only when
      // a SECOND person approves the variance (see StockTakeService).
      //
      // The endpoint survives as a read-only variance PREVIEW so that any
      // client still calling it gets an honest answer — the variances it would
      // produce — rather than a silent 404 or, worse, a silent write.
      results.push({
        itemId: count.itemId,
        itemName: item.name,
        systemQuantity,
        countedQuantity: count.countedQuantity,
        variance: count.countedQuantity - systemQuantity,
      });
    }

    return {
      clinicId: dto.clinicId,
      countedItems: results.length,
      // Nothing is adjusted here any more — kept in the response shape so an
      // existing client does not break, and always zero so it cannot be
      // mistaken for work that happened.
      adjustedItems: 0,
      posted: false,
      note: 'Preview only. A stock take is posted to the ledger through Stock ▸ Stock Take, after a second person approves the variance.',
      results,
    };
  }

  async listMovements(clinicId?: string, itemId?: string) {
    const scope = await this.readScope();
    return this.prisma.stockMovement.findMany({
      where: { ...scope.where(clinicId), itemId },
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
    // The branch comes from the request body, so it is validated against
    // what this account may actually write to before anything is posted.
    const scope = await this.writeScope();
    dto = { ...dto, clinicId: scope.require(dto.clinicId) };
    const tenantId = currentTenantId();
    const item = await this.prisma.item.findUnique({ where: { id: dto.itemId }, select: { id: true } });
    if (!item) throw new NotFoundException('Item not found');

    // WAVE 2 — through the ONE ledger writer. `postMovement` locks the level
    // row before it reads, so two concurrent adjustments cannot both see 10 and
    // both write 9; the old read-then-upsert could.
    await postMovement(this.prisma as never as LedgerTx, {
      tenantId,
      clinicId: dto.clinicId,
      itemId: dto.itemId,
      quantityDelta: dto.quantityDelta,
      movementType: StockMovementType.ADJUSTMENT,
      referenceType: 'InventoryQuickAdjust',
      notes: dto.reason,
    });

    return this.prisma.stockLevel.findUnique({
      where: { tenantId_clinicId_itemId: { tenantId, clinicId: dto.clinicId, itemId: dto.itemId } },
    });
  }

  async quickAdd(dto: QuickAddStockDto) {
    // The branch comes from the request body, so it is validated against
    // what this account may actually write to before anything is posted.
    const scope = await this.writeScope();
    dto = { ...dto, clinicId: scope.require(dto.clinicId) };
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

    await postMovement(this.prisma as never as LedgerTx, {
      tenantId,
      clinicId: dto.clinicId,
      itemId: dto.itemId,
      batchId: batch.id,
      quantityDelta: dto.quantity,
      movementType: StockMovementType.GOODS_RECEIVED,
      referenceType: 'QuickStockIn',
      referenceId: batch.id,
      createdByStaffId: dto.addedByStaffId ?? null,
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
