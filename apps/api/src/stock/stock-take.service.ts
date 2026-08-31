import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { StockAdjustmentReason, StockMovementType, StockTakeStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, requirePermission, resolveClinicId, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { fromCents, toCents } from '../finance/money';
import { postMovement } from './stock-ledger';
import { CreateStockTakeDto } from './dto/create-stock-take.dto';
import { RecordCountDto } from './dto/record-count.dto';
import { ReviewStockTakeDto } from './dto/review-stock-take.dto';
import { effectiveCount, lineVariance, summariseStockTake } from './stock-variance';

/**
 * STOCK TAKE — the cycle, with the one rule that makes it worth having.
 *
 * OWNER BRIEF §3G: "Do NOT change live stock simply because someone typed a
 * count before approval."
 *
 * So counting writes to `StockTakeLine.countedQuantity` and to nothing else.
 * Live stock changes exactly once, at POST, as ordinary `StockMovement` rows
 * with a STOCK_TAKE type and this take as their reference — on the same ledger
 * as every other movement, readable the same way, and correctable the same
 * way (with a compensating movement, since the ledger is append-only).
 *
 * SEPARATION OF DUTIES: the person who counted cannot approve their own count.
 * `stockTake.manage` counts; `stockTake.approve` posts; STOCK_STAFF holds the
 * first and not the second. The service checks the person as well as the
 * permission, because a clinic where one individual holds both must still not
 * be able to approve a sheet they filled in themselves.
 */
@Injectable()
export class StockTakeService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  private async nextNumber(tx: AdminTx): Promise<string> {
    const count = await tx.stockTake.count();
    return `ST-${String(count + 1).padStart(6, '0')}`;
  }

  /**
   * Open a take and generate its count sheet.
   *
   * `systemQuantity` is FROZEN here. The variance is measured against what the
   * counter was told, not against a number that moved while they were on the
   * shelf — otherwise a dispense during the count reads as a counting error.
   */
  async create(dto: CreateStockTakeDto) {
    return withAdminTx(this.rawPrisma, 'stockTake.manage', async (tx, actor) => {
      const clinicId = resolveClinicId(actor, dto.clinicId);

      const open = await tx.stockTake.findFirst({
        where: { clinicId, status: { in: [StockTakeStatus.DRAFT, StockTakeStatus.COUNTING, StockTakeStatus.IN_REVIEW] } },
        select: { id: true, takeNumber: true },
      });
      if (open) {
        throw new ConflictException(
          `Stock take ${open.takeNumber} is still open at this branch. Two overlapping counts against the same shelf produce two different truths.`,
        );
      }

      const levels = await tx.stockLevel.findMany({
        where: {
          clinicId,
          ...(dto.itemIds?.length ? { itemId: { in: dto.itemIds } } : {}),
          ...(dto.category ? { item: { category: dto.category } } : {}),
          item: { active: true, ...(dto.category ? { category: dto.category } : {}) },
        },
        select: { itemId: true, quantityOnHand: true, item: { select: { cost: true } } },
      });
      if (levels.length === 0) {
        throw new BadRequestException('There is nothing to count for that selection.');
      }

      const take = await tx.stockTake.create({
        data: {
          tenantId: currentTenantId(),
          clinicId,
          takeNumber: await this.nextNumber(tx),
          name: dto.name,
          location: dto.location ?? null,
          notes: dto.notes ?? null,
          status: StockTakeStatus.COUNTING,
          createdByStaffId: actor.id,
          lines: {
            create: levels.map((level) => ({
              tenantId: currentTenantId(),
              itemId: level.itemId,
              systemQuantity: level.quantityOnHand,
              unitCost: level.item.cost,
            })),
          },
          ...(dto.counterStaffIds?.length
            ? {
                counters: {
                  create: dto.counterStaffIds.map((staffId) => ({
                    tenantId: currentTenantId(),
                    staffId,
                    location: dto.location ?? null,
                  })),
                },
              }
            : {}),
        },
        include: { lines: true, counters: true },
      });
      return take;
    });
  }

  /** Record counts. Repeatable while the take is COUNTING; touches no stock. */
  async recordCounts(id: string, dto: RecordCountDto) {
    return withAdminTx(this.rawPrisma, 'stockTake.manage', async (tx, actor) => {
      const take = await tx.stockTake.findUnique({ where: { id }, select: { id: true, status: true, clinicId: true } });
      if (!take) throw new NotFoundException('Stock take not found');
      if (take.status !== StockTakeStatus.COUNTING) {
        throw new ConflictException(`A ${take.status.toLowerCase()} stock take cannot be counted into.`);
      }
      resolveClinicId(actor, take.clinicId);

      const lineIds = dto.counts.map((count) => count.lineId);
      const lines = await tx.stockTakeLine.findMany({
        where: { id: { in: lineIds }, stockTakeId: id },
        select: { id: true, countedQuantity: true },
      });
      if (lines.length !== new Set(lineIds).size) {
        throw new BadRequestException('One of those lines does not belong to this stock take.');
      }
      const alreadyCounted = new Set(lines.filter((line) => line.countedQuantity !== null).map((line) => line.id));

      for (const count of dto.counts) {
        const isRecount = alreadyCounted.has(count.lineId);
        await tx.stockTakeLine.update({
          where: { id: count.lineId },
          data: isRecount
            ? {
                // A SECOND count does not overwrite the first. Both survive, so
                // "we counted it again and got the same answer" is
                // distinguishable from "we counted it once".
                recountQuantity: count.quantity,
                recountAt: new Date(),
                varianceReason: count.varianceReason ?? undefined,
              }
            : {
                countedQuantity: count.quantity,
                looseUnits: count.looseUnits ?? null,
                countedByStaffId: actor.id,
                countedAt: new Date(),
                varianceReason: count.varianceReason ?? null,
              },
        });
      }

      return this.detail(id);
    });
  }

  /** Submit for review. Refuses a sheet with uncounted lines. */
  async submit(id: string) {
    return withAdminTx(this.rawPrisma, 'stockTake.manage', async (tx, actor) => {
      const take = await tx.stockTake.findUnique({
        where: { id },
        include: { lines: { select: { id: true, countedQuantity: true } } },
      });
      if (!take) throw new NotFoundException('Stock take not found');
      if (take.status !== StockTakeStatus.COUNTING) {
        throw new ConflictException(`A ${take.status.toLowerCase()} stock take cannot be submitted.`);
      }
      const uncounted = take.lines.filter((line) => line.countedQuantity === null).length;
      if (uncounted > 0) {
        throw new BadRequestException(
          `${uncounted} line${uncounted === 1 ? '' : 's'} still uncounted. An uncounted line is not a zero — post it and the ledger would write off stock nobody looked at.`,
        );
      }

      await tx.stockTakeAssignment.updateMany({
        where: { stockTakeId: id, staffId: actor.id, completedAt: null },
        data: { completedAt: new Date() },
      });

      return tx.stockTake.update({
        where: { id },
        data: { status: StockTakeStatus.IN_REVIEW, submittedAt: new Date(), submittedByStaffId: actor.id },
      });
    });
  }

  /**
   * Approve and POST. The only place a stock take touches live stock.
   *
   * One `StockMovement` per line whose count differs, referencing this take.
   * Lines a reviewer excluded produce nothing — an excluded line is one the
   * reviewer decided not to trust, and posting it anyway would make the
   * exclusion decorative.
   */
  async approve(id: string, dto: ReviewStockTakeDto) {
    return withAdminTx(this.rawPrisma, 'stockTake.approve', async (tx, actor) => {
      const take = await tx.stockTake.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!take) throw new NotFoundException('Stock take not found');
      if (take.status !== StockTakeStatus.IN_REVIEW) {
        throw new ConflictException('Only a submitted stock take can be approved.');
      }

      // SEPARATION OF DUTIES, checked against the PERSON and not only the
      // permission. In a small clinic one individual may hold both; they still
      // must not sign off a sheet they filled in themselves.
      if (take.submittedByStaffId === actor.id) {
        throw new ForbiddenException(
          'A stock take must be approved by somebody other than the person who submitted it.',
        );
      }

      const excluded = new Set(dto.excludeLineIds ?? []);
      let varianceValueCents = 0;
      let adjustedLines = 0;

      for (const line of take.lines) {
        if (excluded.has(line.id)) {
          await tx.stockTakeLine.update({ where: { id: line.id }, data: { excluded: true } });
          continue;
        }
        // A recount supersedes the first count: it is the more considered
        // number and the reason a recount exists.
        const counted = effectiveCount(line);
        const delta = lineVariance(line);
        if (counted === null || delta === null || delta === 0) continue;

        await postMovement(tx, {
          tenantId: take.tenantId,
          clinicId: take.clinicId,
          itemId: line.itemId,
          quantityDelta: delta,
          movementType: StockMovementType.STOCK_TAKE,
          adjustmentReason: StockAdjustmentReason.COUNT_CORRECTION,
          referenceType: 'StockTake',
          referenceId: take.id,
          createdByStaffId: actor.id,
          createdByUserId: actor.userId,
          notes:
            line.varianceReason ??
            `Stock take ${take.takeNumber}: counted ${counted}, system said ${line.systemQuantity}`,
        });
        adjustedLines += 1;
        varianceValueCents += delta * toCents(line.unitCost ?? 0);
      }

      const posted = await tx.stockTake.update({
        where: { id },
        data: {
          status: StockTakeStatus.POSTED,
          reviewedByStaffId: actor.id,
          reviewedAt: new Date(),
          postedAt: new Date(),
          varianceValue: fromCents(varianceValueCents),
          notes: dto.notes ?? take.notes,
        },
      });

      await recordAudit(tx, actor, {
        action: 'stockTake.posted',
        entityType: 'StockTake',
        entityId: id,
        before: { status: StockTakeStatus.IN_REVIEW, submittedBy: take.submittedByStaffId },
        after: {
          status: StockTakeStatus.POSTED,
          takeNumber: take.takeNumber,
          adjustedLines,
          excludedLines: excluded.size,
          varianceValue: fromCents(varianceValueCents),
        },
        reason: dto.notes ?? null,
        source: 'stock.stockTake',
      });

      return posted;
    });
  }

  async cancel(id: string, reason: string) {
    return withAdminTx(this.rawPrisma, 'stockTake.manage', async (tx, actor) => {
      const take = await tx.stockTake.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!take) throw new NotFoundException('Stock take not found');
      if (take.status === StockTakeStatus.POSTED) {
        throw new ConflictException(
          'A posted stock take cannot be cancelled. Its correction is on the ledger; reverse it with a new adjustment.',
        );
      }
      return tx.stockTake.update({
        where: { id },
        data: { status: StockTakeStatus.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
      });
    });
  }

  async list(clinicIdInput?: string) {
    const actor = await requirePermission(this.rawPrisma, 'stock.view');
    const clinicId = clinicIdInput ?? actor.clinicId ?? undefined;
    const takes = await this.prisma.stockTake.findMany({
      where: clinicId ? { clinicId } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        clinic: { select: { name: true } },
        createdBy: { select: { fullName: true } },
        submittedBy: { select: { fullName: true } },
        reviewedBy: { select: { fullName: true } },
        lines: { select: { countedQuantity: true, recountQuantity: true, systemQuantity: true, excluded: true } },
        counters: { include: { staff: { select: { fullName: true } } } },
      },
    });

    return takes.map((take) => {
      // The same summary the approval screen and the posting itself use, so
      // the number somebody approves is the number that gets written.
      const summary = summariseStockTake(take.lines);
      const counted = summary.countedCount;
      const variances = summary.varianceCount;
      return {
        id: take.id,
        takeNumber: take.takeNumber,
        name: take.name,
        status: take.status,
        location: take.location,
        clinicId: take.clinicId,
        clinicName: take.clinic.name,
        createdAt: take.createdAt,
        createdBy: take.createdBy.fullName,
        submittedAt: take.submittedAt,
        submittedBy: take.submittedBy?.fullName ?? null,
        reviewedAt: take.reviewedAt,
        reviewedBy: take.reviewedBy?.fullName ?? null,
        postedAt: take.postedAt,
        varianceValue: take.varianceValue === null ? null : Number(take.varianceValue),
        lineCount: take.lines.length,
        countedCount: counted,
        completionPercent: take.lines.length === 0 ? 0 : Math.round((counted / take.lines.length) * 100),
        varianceCount: variances,
        counters: take.counters.map((counter) => ({
          staffId: counter.staffId,
          name: counter.staff.fullName,
          location: counter.location,
          completedAt: counter.completedAt,
        })),
      };
    });
  }

  async detail(id: string) {
    await requirePermission(this.rawPrisma, 'stock.view');
    const take = await this.prisma.stockTake.findUnique({
      where: { id },
      include: {
        clinic: { select: { name: true } },
        createdBy: { select: { fullName: true } },
        submittedBy: { select: { fullName: true } },
        reviewedBy: { select: { fullName: true } },
        counters: { include: { staff: { select: { fullName: true } } } },
        lines: {
          include: {
            item: { select: { name: true, code: true, category: true, unitOfMeasure: true, sellPrice: true } },
            countedBy: { select: { fullName: true } },
          },
          orderBy: { item: { name: 'asc' } },
        },
      },
    });
    if (!take) throw new NotFoundException('Stock take not found');

    let varianceValueCents = 0;
    // SELLING VALUE ALONGSIDE COST, at count time.
    //
    // Kuwick showed a stock take purely at cost. The clinic's own count sheet
    // values the shelf BOTH ways — `E*G` at acquisition cost and `F*G` at
    // patient prices — because the two answer different questions: cost is what
    // a discrepancy took off the balance sheet, retail is what walked out of
    // the dispensary (docs/STOCK_LEGACY_WORKFLOW_AUDIT.md §1).
    //
    // The two are never added together and retail is never called profit; they
    // sit side by side, which is exactly how the sheet has them.
    let systemRetailCents = 0;
    let countedRetailCents = 0;
    let varianceRetailCents = 0;

    const lines = take.lines.map((line) => {
      const counted = line.recountQuantity ?? line.countedQuantity;
      const variance = counted === null ? null : counted - line.systemQuantity;
      const valueCents = variance === null ? 0 : variance * toCents(line.unitCost ?? 0);
      const sellCents = toCents(line.item.sellPrice);
      const lineSystemRetail = line.systemQuantity * sellCents;
      const lineCountedRetail = (counted ?? line.systemQuantity) * sellCents;
      const lineVarianceRetail = variance === null ? 0 : variance * sellCents;
      if (!line.excluded) {
        varianceValueCents += valueCents;
        systemRetailCents += lineSystemRetail;
        countedRetailCents += lineCountedRetail;
        varianceRetailCents += lineVarianceRetail;
      }
      return {
        sellPrice: Number(line.item.sellPrice),
        /** What this line is worth at patient prices, as counted. */
        countedRetailValue: fromCents(lineCountedRetail),
        /** What the discrepancy is worth at patient prices. */
        varianceRetailValue: fromCents(lineVarianceRetail),
        id: line.id,
        itemId: line.itemId,
        itemName: line.item.name,
        itemCode: line.item.code,
        category: line.item.category,
        unit: line.item.unitOfMeasure,
        systemQuantity: line.systemQuantity,
        countedQuantity: line.countedQuantity,
        recountQuantity: line.recountQuantity,
        looseUnits: line.looseUnits,
        variance,
        varianceValue: fromCents(valueCents),
        varianceReason: line.varianceReason,
        excluded: line.excluded,
        unitCost: line.unitCost === null ? null : Number(line.unitCost),
        countedBy: line.countedBy?.fullName ?? null,
        countedAt: line.countedAt,
      };
    });

    return {
      id: take.id,
      takeNumber: take.takeNumber,
      name: take.name,
      status: take.status,
      location: take.location,
      notes: take.notes,
      clinicId: take.clinicId,
      clinicName: take.clinic.name,
      createdAt: take.createdAt,
      createdBy: take.createdBy.fullName,
      submittedAt: take.submittedAt,
      submittedBy: take.submittedBy?.fullName ?? null,
      reviewedAt: take.reviewedAt,
      reviewedBy: take.reviewedBy?.fullName ?? null,
      postedAt: take.postedAt,
      varianceValue: take.varianceValue === null ? fromCents(varianceValueCents) : Number(take.varianceValue),
      /**
       * The shelf at PATIENT PRICES. Shown beside the cost figures, never added
       * to them and never called profit — the same discipline the valuation
       * report already carries.
       */
      systemRetailValue: fromCents(systemRetailCents),
      countedRetailValue: fromCents(countedRetailCents),
      varianceRetailValue: fromCents(varianceRetailCents),
      counters: take.counters.map((counter) => ({
        staffId: counter.staffId,
        name: counter.staff.fullName,
        location: counter.location,
        completedAt: counter.completedAt,
      })),
      lines,
    };
  }
}
