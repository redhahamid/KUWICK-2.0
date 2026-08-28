import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PurchaseOrderLine, PurchaseOrderStatus, StockMovementType } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { LedgerTx, postMovement } from '../stock/stock-ledger';
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
          unitCost: receiveLine.unitCost,
        },
      });

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

    return this.prisma.goodsReceivedNote.findUnique({
      where: { id: goodsReceivedNote.id },
      include: { lines: true },
    });
  }
}
