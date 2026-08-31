import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PurchaseOrderLine, PurchaseOrderStatus, StockMovementType } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { LedgerTx, postMovement } from '../stock/stock-ledger';
import { fromCents, toCents } from '../finance/money';
import { effectiveUnitCostCents } from './procurement-pricing';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';

const CLOSED_STATUSES: PurchaseOrderStatus[] = [PurchaseOrderStatus.CLOSED, PurchaseOrderStatus.CANCELLED];

// Receiving one GRN is several dependent writes per line (batch, movement,
// stock-level increment, PO-line receivedQuantity) plus a PO status
// recompute. Not wrapped in a single DB transaction: TENANT_SCOPED_PRISMA
// (core/tenant-scoped-prisma.provider.ts) already wraps every individual
// query in its own transaction to set the RLS session variable, and nesting
// an interactive $transaction through that extension is untested — the same
// accepted gap documented on AppointmentService#reschedule. The one write
// that matters most for data integrity (stock cannot go negative) is still
// protected regardless, by StockLevel's CHECK constraint.
@Injectable()
export class GoodsReceivingService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  async receive(purchaseOrderId: string, dto: ReceivePurchaseOrderDto) {
    const tenantId = currentTenantId();
    const purchaseOrder = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { lines: true },
    });
    if (!purchaseOrder) {
      throw new NotFoundException('Purchase order not found');
    }
    if (CLOSED_STATUSES.includes(purchaseOrder.status)) {
      throw new BadRequestException(`Cannot receive against a purchase order in status ${purchaseOrder.status}`);
    }

    const linesById = new Map<string, PurchaseOrderLine>(
      purchaseOrder.lines.map((line) => [line.id, line]),
    );
    /** Items that became real on this delivery, reported back to the caller. */
    const activatedItemIds: string[] = [];

    const goodsReceivedNote = await this.prisma.goodsReceivedNote.create({
      data: { tenantId, clinicId: dto.clinicId, purchaseOrderId },
    });

    for (const receiveLine of dto.lines) {
      const orderLine = linesById.get(receiveLine.purchaseOrderLineId);
      if (!orderLine) {
        throw new BadRequestException(
          `Purchase order line ${receiveLine.purchaseOrderLineId} does not belong to this purchase order`,
        );
      }
      const outstanding = orderLine.orderedQuantity - orderLine.receivedQuantity;
      if (receiveLine.quantityReceived > outstanding) {
        throw new BadRequestException(
          `Cannot receive ${receiveLine.quantityReceived} against line ${orderLine.id}; only ${outstanding} outstanding`,
        );
      }

      const batch = await this.prisma.stockBatch.create({
        data: {
          tenantId,
          clinicId: dto.clinicId,
          itemId: orderLine.itemId,
          batchNumber: receiveLine.batchNumber,
          quantity: receiveLine.quantityReceived,
          expiryDate: receiveLine.expiryDate ? new Date(receiveLine.expiryDate) : undefined,
          receivedDate: new Date(),
        },
      });

      // WAVE 2 — through the ONE ledger writer, so a receipt, a dispense, a
      // transfer and a stock-take correction all reach a stock level the same
      // way and under the same row lock.
      await postMovement(this.prisma as never as LedgerTx, {
        tenantId,
        clinicId: dto.clinicId,
        itemId: orderLine.itemId,
        batchId: batch.id,
        quantityDelta: receiveLine.quantityReceived,
        movementType: StockMovementType.GOODS_RECEIVED,
        referenceType: 'GoodsReceivedNote',
        referenceId: goodsReceivedNote.id,
        createdByUserId: null,
      });

      await this.prisma.purchaseOrderLine.update({
        where: { id: orderLine.id },
        data: { receivedQuantity: { increment: receiveLine.quantityReceived } },
      });

      // The cost this delivery actually came in at: what the invoice will say,
      // falling back to the effective ordered price — `MIN(unit, bonus)`,
      // because a promotion is what the clinic pays, not a note beside what it
      // pays (docs/STOCK_LEGACY_WORKFLOW_AUDIT.md §3).
      const receivedUnitCostCents =
        receiveLine.unitCost === undefined
          ? effectiveUnitCostCents(orderLine.unitCost, orderLine.bonusUnitCost)
          : toCents(receiveLine.unitCost);

      await this.prisma.goodsReceivedNoteLine.create({
        data: {
          tenantId,
          goodsReceivedNoteId: goodsReceivedNote.id,
          purchaseOrderLineId: orderLine.id,
          itemId: orderLine.itemId,
          batchId: batch.id,
          quantityReceived: receiveLine.quantityReceived,
          batchNumber: receiveLine.batchNumber,
          expiryDate: receiveLine.expiryDate ? new Date(receiveLine.expiryDate) : undefined,
          unitCost: fromCents(receivedUnitCostCents),
        },
      });

      // ---------------------------------------------------------------------
      // THE PRICE CHANGE, AND THE ACTIVATION. Both happen HERE and nowhere
      // else, because both are facts about stock physically arriving.
      //
      // The clinic's order queue carries "old price / new price" columns at
      // goods-in for exactly this reason: the moment a cost actually changes is
      // the moment stock turns up at a different price. Kuwick recorded neither
      // the change nor who made it, from any source.
      // ---------------------------------------------------------------------
      const item = await this.prisma.item.findUnique({
        where: { id: orderLine.itemId },
        select: { id: true, cost: true, active: true, awaitingFirstReceipt: true },
      });

      if (item) {
        const previousCents = item.cost === null ? null : toCents(item.cost);
        const costMoved = previousCents === null || previousCents !== receivedUnitCostCents;

        if (costMoved) {
          await this.prisma.itemPriceChange.create({
            data: {
              tenantId,
              itemId: item.id,
              previousCost: item.cost,
              newCost: fromCents(receivedUnitCostCents),
              source: 'GOODS_RECEIPT',
              goodsReceivedNoteId: goodsReceivedNote.id,
              changedByStaffId: dto.receivedByStaffId ?? null,
              note:
                previousCents === null
                  ? 'First recorded cost, captured at goods-in.'
                  : 'Cost changed at goods-in.',
            },
          });
        }

        // An item ordered but never delivered is a promise; prescribing from a
        // promise hands a patient a script for something the dispensary has
        // never seen. Arrival is what makes it real.
        const activating = item.awaitingFirstReceipt;

        if (costMoved || activating) {
          await this.prisma.item.update({
            where: { id: item.id },
            data: {
              ...(costMoved ? { cost: fromCents(receivedUnitCostCents) } : {}),
              ...(activating
                ? { awaitingFirstReceipt: false, active: true, activatedAt: new Date() }
                : {}),
            },
          });
          if (activating) activatedItemIds.push(item.id);
        }
      }

      // Keeps the outstanding-quantity check correct if the same PO line
      // appears twice within one receive() call.
      orderLine.receivedQuantity += receiveLine.quantityReceived;
    }

    const refreshedLines = await this.prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId } });
    const fullyReceived = refreshedLines.every((line) => line.receivedQuantity >= line.orderedQuantity);
    const anyReceived = refreshedLines.some((line) => line.receivedQuantity > 0);
    await this.prisma.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: {
        status: fullyReceived
          ? PurchaseOrderStatus.FULLY_RECEIVED
          : anyReceived
            ? PurchaseOrderStatus.PARTIALLY_RECEIVED
            : purchaseOrder.status,
      },
    });

    const note = await this.prisma.goodsReceivedNote.findUnique({
      where: { id: goodsReceivedNote.id },
      include: { lines: true },
    });
    return { ...note, activatedItemIds };
  }
}
