import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockTransferStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, requireScope, resolveClinicId, withAdminTx, withScopedAdminTx } from '../finance/admin-actor';
import { BranchScope } from '../core/branch-scope';
import { recordAudit } from '../finance/admin-audit';
import { fromCents, toCents } from '../finance/money';
import { batchExposure, batchExposureValueCents } from '../inventory/batch-exposure';
import { movementTypeForReason, postMovement } from './stock-ledger';
import { AdjustStockDto } from './dto/adjust-stock.dto';

/** How many days without a movement makes an item "slow moving". Stated, not hidden. */
export const SLOW_MOVING_DAYS = 90;
/** How many days ahead counts as "near expiry". */
export const NEAR_EXPIRY_DAYS = 90;

/**
 * THE STOCK MODULE'S FIRST QUESTION: "What requires attention today?"
 *
 * Owner brief §10. Not "here is every field of every item" — a stock homepage
 * that lists 4,000 rows answers nothing. This service produces the EXCEPTIONS,
 * each with a stated threshold rather than a magic number buried in a query,
 * and each linking to the record that needs the work.
 */

/**
 * THE BRANCH CLAUSE FOR A RAW QUERY.
 *
 * These fragments used to read `clinicId ? AND clinic_id = ... : empty`, so an
 * account that named no branch got NO clause and read the whole tenant. The
 * scope decides now: a named branch it validated, otherwise the branches the
 * account may manage, and only a genuinely tenant-wide actor gets no clause.
 */
function branchClause(scope: BranchScope, requested: string | null | undefined, alias: string) {
  const ids = scope.sqlClinicIds(requested);
  if (ids === null) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.raw(`"${alias}"`)}."clinic_id" = ANY(${ids})`;
}

@Injectable()
export class StockAdminService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * Correct a stock quantity, with a reason and an audit record.
   *
   * The one path by which a human may change a level directly, and the reason
   * `stock.adjust` is a permission of its own rather than part of `stock.view`.
   * There is deliberately no browser `prompt()` password anywhere near it: the
   * gate is a server-side permission check, which is the only kind that works.
   */
  async adjust(dto: AdjustStockDto) {
    return withScopedAdminTx(this.rawPrisma, 'stock.adjust', async (tx, actor, scope) => {
      const clinicId = resolveClinicId(scope, dto.clinicId);
      const item = await tx.item.findUnique({ where: { id: dto.itemId }, select: { id: true, name: true, cost: true } });
      if (!item) throw new NotFoundException('Item not found');
      if (dto.quantityDelta === 0) {
        throw new BadRequestException('An adjustment of zero changes nothing.');
      }

      const result = await postMovement(tx, {
        tenantId: currentTenantId(),
        clinicId,
        itemId: dto.itemId,
        quantityDelta: dto.quantityDelta,
        movementType: movementTypeForReason(dto.reason),
        adjustmentReason: dto.reason,
        batchId: dto.batchId ?? null,
        referenceType: 'ManualAdjustment',
        createdByStaffId: actor.id,
        createdByUserId: actor.userId,
        notes: dto.notes ?? null,
      });

      await recordAudit(tx, actor, {
        action: 'stock.adjusted',
        entityType: 'StockLevel',
        entityId: `${clinicId}:${dto.itemId}`,
        before: { quantityOnHand: result.quantityBefore },
        after: {
          quantityOnHand: result.quantityAfter,
          delta: dto.quantityDelta,
          reason: dto.reason,
          itemName: item.name,
          movementId: result.movementId,
          valueImpact: fromCents(dto.quantityDelta * toCents(item.cost ?? 0)),
        },
        reason: dto.notes ?? dto.reason,
        source: 'stock.adjustments',
      });

      return { ...result, itemName: item.name };
    });
  }

  /**
   * THE EXCEPTION DASHBOARD.
   *
   * Every count here is a piece of work somebody has to do. Nothing is
   * included because it is interesting.
   */
  async exceptions(clinicIdInput?: string) {
    const { scope } = await requireScope(this.rawPrisma, 'stock.view');
    const clinicId = scope.assert(clinicIdInput);
    const now = new Date();
    const nearExpiryCutoff = new Date(now.getTime() + NEAR_EXPIRY_DAYS * 86400000);
    const slowCutoff = new Date(now.getTime() - SLOW_MOVING_DAYS * 86400000);
    const clinicFilter = scope.where(clinicId);

    const [negative, belowMinimum, expired, nearExpiry, unconfirmedTransfers, discrepancyTransfers, openTakes, pendingRequests] =
      await Promise.all([
        this.prisma.stockLevel.count({ where: { ...clinicFilter, quantityOnHand: { lt: 0 } } }),
        this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) AS count FROM "stock_levels" sl
          WHERE sl."quantity_on_hand" >= 0
            AND sl."min_threshold" > 0
            AND sl."quantity_on_hand" < sl."min_threshold"
            ${branchClause(scope, clinicId, "sl")}
        `,
        // BATCHES OF AN ITEM THE CLINIC STILL HOLDS.
        //
        // `quantity` on a batch is what was RECEIVED and never decrements —
        // nothing attributes a dispense to a batch. Counting `quantity > 0`
        // therefore counted batches that had been dispensed to nothing, and
        // put them on somebody's worklist. Joining to the on-hand level is the
        // one thing that is certain without batch attribution: hold none of the
        // item, and none of any batch of it remains. See batch-exposure.ts.
        this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) AS count FROM "stock_batches" b
          JOIN "stock_levels" sl
            ON sl."item_id" = b."item_id" AND sl."clinic_id" = b."clinic_id"
          WHERE b."quantity" > 0 AND sl."quantity_on_hand" > 0
            AND b."expiry_date" < ${now}
            ${branchClause(scope, clinicId, "b")}
        `,
        this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) AS count FROM "stock_batches" b
          JOIN "stock_levels" sl
            ON sl."item_id" = b."item_id" AND sl."clinic_id" = b."clinic_id"
          WHERE b."quantity" > 0 AND sl."quantity_on_hand" > 0
            AND b."expiry_date" >= ${now} AND b."expiry_date" <= ${nearExpiryCutoff}
            ${branchClause(scope, clinicId, "b")}
        `,
        this.prisma.stockTransfer.count({
          where: {
            status: StockTransferStatus.SENT,
            ...(clinicId ? { OR: [{ fromClinicId: clinicId }, { toClinicId: clinicId }] } : {}),
          },
        }),
        this.prisma.stockTransfer.count({
          where: {
            status: StockTransferStatus.RECEIVED_WITH_DISCREPANCY,
            ...(clinicId ? { OR: [{ fromClinicId: clinicId }, { toClinicId: clinicId }] } : {}),
          },
        }),
        this.prisma.stockTake.count({
          where: { ...clinicFilter, status: { in: ['COUNTING', 'IN_REVIEW'] } },
        }),
        this.prisma.procurementRequest.count({ where: { ...clinicFilter, status: 'PENDING' } }),
      ]);

    // Slow movers: stocked, valuable, and untouched for the stated window.
    const slowMovers = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM "stock_levels" sl
      WHERE sl."quantity_on_hand" > 0
        ${branchClause(scope, clinicId, "sl")}
        AND NOT EXISTS (
          SELECT 1 FROM "stock_movements" sm
          WHERE sm."item_id" = sl."item_id"
            AND sm."clinic_id" = sl."clinic_id"
            AND sm."movement_type" = 'DISPENSED'
            AND sm."created_at" >= ${slowCutoff}
        )
    `;

    return {
      clinicId: clinicId ?? null,
      thresholds: { slowMovingDays: SLOW_MOVING_DAYS, nearExpiryDays: NEAR_EXPIRY_DAYS },
      negativeStock: negative,
      belowMinimum: Number(belowMinimum[0]?.count ?? 0),
      expired: Number(expired[0]?.count ?? 0),
      nearExpiry: Number(nearExpiry[0]?.count ?? 0),
      unconfirmedTransfers,
      transferDiscrepancies: discrepancyTransfers,
      openStockTakes: openTakes,
      pendingRequests,
      slowMovers: Number(slowMovers[0]?.count ?? 0),
    };
  }

  /** The rows behind one exception tile. */
  async exceptionRows(kind: string, clinicIdInput?: string) {
    const { scope } = await requireScope(this.rawPrisma, 'stock.view');
    const clinicId = scope.assert(clinicIdInput);
    const now = new Date();
    const clinicFilter = scope.where(clinicId);

    const itemSelect = { select: { id: true, name: true, code: true, category: true, unitOfMeasure: true, cost: true, sellPrice: true } };
    const clinicSelect = { select: { name: true } };

    switch (kind) {
      case 'negative': {
        const rows = await this.prisma.stockLevel.findMany({
          where: { ...clinicFilter, quantityOnHand: { lt: 0 } },
          include: { item: itemSelect, clinic: clinicSelect },
          orderBy: { quantityOnHand: 'asc' },
        });
        return rows.map((row) => ({
          itemId: row.itemId,
          itemName: row.item.name,
          itemCode: row.item.code,
          category: row.item.category,
          clinicId: row.clinicId,
          clinicName: row.clinic.name,
          quantityOnHand: row.quantityOnHand,
          minThreshold: row.minThreshold,
          unit: row.item.unitOfMeasure,
        }));
      }
      case 'below-minimum': {
        const rows = await this.prisma.stockLevel.findMany({
          where: { ...clinicFilter, quantityOnHand: { gte: 0 }, minThreshold: { gt: 0 } },
          include: { item: itemSelect, clinic: clinicSelect },
        });
        return rows
          .filter((row) => row.quantityOnHand < row.minThreshold)
          .map((row) => ({
            itemId: row.itemId,
            itemName: row.item.name,
            itemCode: row.item.code,
            category: row.item.category,
            clinicId: row.clinicId,
            clinicName: row.clinic.name,
            quantityOnHand: row.quantityOnHand,
            minThreshold: row.minThreshold,
            shortfall: row.minThreshold - row.quantityOnHand,
            unit: row.item.unitOfMeasure,
          }))
          .sort((a, b) => b.shortfall - a.shortfall);
      }
      case 'expired':
      case 'near-expiry': {
        const cutoff = new Date(now.getTime() + NEAR_EXPIRY_DAYS * 86400000);
        const rows = await this.prisma.stockBatch.findMany({
          where: {
            ...clinicFilter,
            quantity: { gt: 0 },
            ...(kind === 'expired'
              ? { expiryDate: { lt: now } }
              : { expiryDate: { gte: now, lte: cutoff } }),
          },
          include: { item: itemSelect, clinic: clinicSelect },
          orderBy: { expiryDate: 'asc' },
        });
        const levels = await this.prisma.stockLevel.findMany({
          where: {
            ...clinicFilter,
            itemId: { in: [...new Set(rows.map((row) => row.itemId))] },
          },
          select: { itemId: true, clinicId: true, quantityOnHand: true },
        });
        const onHandOf = new Map(
          levels.map((level) => [`${level.clinicId}:${level.itemId}`, level.quantityOnHand]),
        );
        return rows
          .map((row) => {
            const exposure = batchExposure({
              receivedQuantity: row.quantity,
              itemOnHand: onHandOf.get(`${row.clinicId}:${row.itemId}`) ?? 0,
            });
            return {
              batchId: row.id,
              itemId: row.itemId,
              itemName: row.item.name,
              itemCode: row.item.code,
              clinicId: row.clinicId,
              clinicName: row.clinic.name,
              batchNumber: row.batchNumber,
              /** What arrived in this batch. NOT what is left — see below. */
              quantity: exposure.receivedQuantity,
              /** What the clinic holds of the item now, across every batch. */
              itemOnHand: exposure.itemOnHand,
              /**
               * The most of this batch that can still be on the shelf. Kuwick
               * does not attribute a dispense to a batch, so a per-batch
               * remainder does not exist; this is the ceiling, and it is
               * certain rather than inferred.
               */
              atRiskQuantity: exposure.atRiskCeiling,
              fullyConsumed: exposure.fullyConsumed,
              expiryDate: row.expiryDate,
              daysToExpiry:
                row.expiryDate === null
                  ? null
                  : Math.round((row.expiryDate.getTime() - now.getTime()) / 86400000),
              /** At the CEILING, never the received quantity — that charged a
               *  fully-dispensed batch to the report at its full cost. */
              valueAtCost: fromCents(
                batchExposureValueCents(exposure, toCents(row.item.cost ?? 0)),
              ),
            };
          })
          .filter((row) => !row.fullyConsumed);
      }
      case 'slow-moving': {
        const cutoff = new Date(now.getTime() - SLOW_MOVING_DAYS * 86400000);
        const rows = await this.prisma.$queryRaw<
          { item_id: string; clinic_id: string; quantity_on_hand: number; name: string; code: string | null; cost: string | null; last_dispensed: Date | null }[]
        >`
          SELECT sl."item_id", sl."clinic_id", sl."quantity_on_hand",
                 i."name", i."code", i."cost",
                 (SELECT MAX(sm."created_at") FROM "stock_movements" sm
                   WHERE sm."item_id" = sl."item_id" AND sm."clinic_id" = sl."clinic_id"
                     AND sm."movement_type" = 'DISPENSED') AS last_dispensed
          FROM "stock_levels" sl
          JOIN "items" i ON i."id" = sl."item_id"
          WHERE sl."quantity_on_hand" > 0
            ${branchClause(scope, clinicId, "sl")}
            AND NOT EXISTS (
              SELECT 1 FROM "stock_movements" sm
              WHERE sm."item_id" = sl."item_id" AND sm."clinic_id" = sl."clinic_id"
                AND sm."movement_type" = 'DISPENSED' AND sm."created_at" >= ${cutoff}
            )
          ORDER BY sl."quantity_on_hand" * COALESCE(i."cost", 0) DESC
          LIMIT 500
        `;
        return rows.map((row) => ({
          itemId: row.item_id,
          clinicId: row.clinic_id,
          itemName: row.name,
          itemCode: row.code,
          quantityOnHand: Number(row.quantity_on_hand),
          lastDispensedAt: row.last_dispensed,
          daysSinceDispense:
            row.last_dispensed === null
              ? null
              : Math.round((now.getTime() - new Date(row.last_dispensed).getTime()) / 86400000),
          valueAtCost: Number(row.cost ?? 0) * Number(row.quantity_on_hand),
        }));
      }
      default:
        throw new BadRequestException(`Unknown exception view: ${kind}`);
    }
  }

  /**
   * STOCK VALUE.
   *
   * Two numbers, and the second one is labelled honestly. Cost value is what
   * the stock cost. "Potential self-pay value" is what it would fetch if every
   * unit sold at the cash price — which is NOT profit, NOT revenue, and NOT a
   * forecast, and the field name says so everywhere it appears.
   *
   * COSTING METHODOLOGY: the item's CURRENT `cost` field, applied to the
   * quantity on hand. This is a simple standard-cost valuation. It is NOT
   * weighted average and NOT FIFO — neither is implemented, and reporting a
   * FIFO number computed from a standard cost would be a fabricated precision.
   */
  async valuation(clinicIdInput?: string) {
    const { scope } = await requireScope(this.rawPrisma, 'stock.view');
    const clinicId = scope.assert(clinicIdInput);

    const levels = await this.prisma.stockLevel.findMany({
      where: {
        ...(clinicId ? { clinicId } : {}),
        quantityOnHand: { gt: 0 },
      },
      include: {
        item: { select: { id: true, name: true, code: true, category: true, cost: true, sellPrice: true } },
        clinic: { select: { id: true, name: true } },
      },
    });

    let costCents = 0;
    let retailCents = 0;
    let unpricedItems = 0;
    const byCategory = new Map<string, { costCents: number; retailCents: number; items: number; units: number }>();
    const byClinic = new Map<string, { name: string; costCents: number; retailCents: number; items: number }>();

    for (const level of levels) {
      const lineCost = level.quantityOnHand * toCents(level.item.cost ?? 0);
      const lineRetail = level.quantityOnHand * toCents(level.item.sellPrice);
      if (level.item.cost === null) unpricedItems += 1;
      costCents += lineCost;
      retailCents += lineRetail;

      const category = level.item.category ?? 'Uncategorised';
      const categoryBucket = byCategory.get(category) ?? { costCents: 0, retailCents: 0, items: 0, units: 0 };
      categoryBucket.costCents += lineCost;
      categoryBucket.retailCents += lineRetail;
      categoryBucket.items += 1;
      categoryBucket.units += level.quantityOnHand;
      byCategory.set(category, categoryBucket);

      const clinicBucket = byClinic.get(level.clinicId) ?? {
        name: level.clinic.name,
        costCents: 0,
        retailCents: 0,
        items: 0,
      };
      clinicBucket.costCents += lineCost;
      clinicBucket.retailCents += lineRetail;
      clinicBucket.items += 1;
      byClinic.set(level.clinicId, clinicBucket);
    }

    return {
      costingMethod: 'STANDARD_COST',
      costingNote:
        'Valued at each item’s current cost price × quantity on hand. Weighted-average and FIFO costing are not implemented; this figure does not claim to be either.',
      totalCostValue: fromCents(costCents),
      totalPotentialSelfPayValue: fromCents(retailCents),
      potentialValueNote:
        'Potential self-pay value is what this stock would fetch if every unit sold at the cash price. It is not profit and not a forecast.',
      itemsValued: levels.length,
      itemsWithoutCost: unpricedItems,
      byCategory: [...byCategory.entries()]
        .map(([category, bucket]) => ({
          category,
          costValue: fromCents(bucket.costCents),
          potentialSelfPayValue: fromCents(bucket.retailCents),
          items: bucket.items,
          units: bucket.units,
        }))
        .sort((a, b) => b.costValue - a.costValue),
      byClinic: [...byClinic.entries()]
        .map(([id, bucket]) => ({
          clinicId: id,
          clinicName: bucket.name,
          costValue: fromCents(bucket.costCents),
          potentialSelfPayValue: fromCents(bucket.retailCents),
          items: bucket.items,
        }))
        .sort((a, b) => b.costValue - a.costValue),
    };
  }

  /** The movement ledger for one item at one branch — the drill-down. */
  async movements(params: { clinicId?: string; itemId?: string; from?: string; to?: string; limit?: number }) {
    const { scope } = await requireScope(this.rawPrisma, 'stock.view');
    const clinicId = scope.assert(params.clinicId);

    const movements = await this.prisma.stockMovement.findMany({
      where: {
        ...(clinicId ? { clinicId } : {}),
        ...(params.itemId ? { itemId: params.itemId } : {}),
        ...(params.from || params.to
          ? {
              createdAt: {
                ...(params.from ? { gte: new Date(`${params.from}T00:00:00.000Z`) } : {}),
                ...(params.to ? { lt: new Date(new Date(`${params.to}T00:00:00.000Z`).getTime() + 86400000) } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(params.limit ?? 200, 1000),
      include: {
        item: { select: { name: true, code: true, unitOfMeasure: true } },
        clinic: { select: { name: true } },
        createdByStaff: { select: { fullName: true } },
        batch: { select: { batchNumber: true, expiryDate: true } },
      },
    });

    return movements.map((movement) => ({
      id: movement.id,
      createdAt: movement.createdAt,
      clinicId: movement.clinicId,
      clinicName: movement.clinic.name,
      itemId: movement.itemId,
      itemName: movement.item.name,
      itemCode: movement.item.code,
      unit: movement.item.unitOfMeasure,
      movementType: movement.movementType,
      adjustmentReason: movement.adjustmentReason,
      quantityDelta: movement.quantityDelta,
      clinicalQuantity: movement.clinicalQuantity,
      referenceType: movement.referenceType,
      referenceId: movement.referenceId,
      batchNumber: movement.batch?.batchNumber ?? null,
      by: movement.createdByStaff?.fullName ?? null,
      notes: movement.notes,
    }));
  }
}
