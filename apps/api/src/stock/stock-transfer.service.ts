import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { StockMovementType, StockTransferStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { postMovement } from './stock-ledger';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { ReceiveStockTransferDto } from './dto/receive-stock-transfer.dto';
import { CancelStockTransferDto } from './dto/cancel-stock-transfer.dto';

/**
 * STOCK TRANSFERS — a document with two ends, and one rule that shapes it all.
 *
 * OWNER BRIEF §3D: "Sender cannot silently alter receiver-confirmed quantity."
 *
 * That single sentence rules out the obvious implementation, which is one
 * quantity field that both branches edit until they agree. Here `quantitySent`
 * is written at SEND and never again; `quantityReceived` is written by the
 * RECEIVING branch and only by them. When the two differ, that difference is a
 * discrepancy that must be explained — it is never resolved by an edit.
 *
 * STOCK MOVES IN TWO STEPS. It leaves the sender at SEND and arrives at the
 * receiver at RECEIVE. In between it is in transit and on neither shelf, which
 * is where it physically is. Deducting and adding in one step would make a
 * lorry-load of medicine appear at a branch that has not opened the box, and
 * would make a lost delivery invisible.
 */
@Injectable()
export class StockTransferService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  private async nextNumber(tx: AdminTx): Promise<string> {
    const count = await tx.stockTransfer.count();
    return `TRF-${String(count + 1).padStart(6, '0')}`;
  }

  async create(dto: CreateStockTransferDto) {
    return withAdminTx(this.rawPrisma, 'stock.transfer', async (tx, actor) => {
      if (dto.fromClinicId === dto.toClinicId) {
        throw new BadRequestException('A transfer needs two different branches.');
      }
      // A branch-scoped staff member may only send FROM their own branch.
      // Receiving is authorised separately, at the receiving end.
      if (actor.clinicId && actor.clinicId !== dto.fromClinicId) {
        throw new BadRequestException('You can only send stock from your own branch.');
      }

      const itemIds = dto.lines.map((line) => line.itemId);
      if (new Set(itemIds).size !== itemIds.length) {
        throw new BadRequestException('The same item appears twice on this transfer.');
      }
      const items = await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, cost: true } });
      if (items.length !== itemIds.length) {
        throw new NotFoundException('One of those items does not exist.');
      }
      const costById = new Map(items.map((item) => [item.id, item.cost]));

      const transfer = await tx.stockTransfer.create({
        data: {
          tenantId: currentTenantId(),
          transferNumber: await this.nextNumber(tx),
          fromClinicId: dto.fromClinicId,
          toClinicId: dto.toClinicId,
          status: StockTransferStatus.DRAFT,
          notes: dto.notes ?? null,
          interCompany: dto.interCompany ?? false,
          interCompanyReference: dto.interCompanyReference ?? null,
          createdByStaffId: actor.id,
          lines: {
            create: dto.lines.map((line) => ({
              tenantId: currentTenantId(),
              itemId: line.itemId,
              quantitySent: line.quantity,
              // Snapshotted so an inter-company settlement and a stock
              // valuation both have a number that does not move when the
              // catalogue cost does.
              unitCost: costById.get(line.itemId) ?? null,
            })),
          },
        },
        include: { lines: { include: { item: { select: { name: true, code: true } } } } },
      });
      return transfer;
    });
  }

  /**
   * Send it. Stock leaves the sending branch now.
   *
   * The availability check WARNS rather than blocks, matching D-020: a branch
   * that has physically received goods the system has not caught up with must
   * still be able to send them on. What it will not do is send silently — the
   * shortfall is recorded on the movement.
   */
  async send(id: string) {
    return withAdminTx(this.rawPrisma, 'stock.transfer', async (tx, actor) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!transfer) throw new NotFoundException('Transfer not found');
      if (transfer.status !== StockTransferStatus.DRAFT) {
        throw new ConflictException(`A ${transfer.status.toLowerCase()} transfer cannot be sent again.`);
      }
      if (actor.clinicId && actor.clinicId !== transfer.fromClinicId) {
        throw new BadRequestException('You can only send stock from your own branch.');
      }
      if (transfer.lines.length === 0) {
        throw new BadRequestException('A transfer with no lines has nothing to send.');
      }

      const shortfalls: string[] = [];
      for (const line of transfer.lines) {
        const result = await postMovement(tx, {
          tenantId: transfer.tenantId,
          clinicId: transfer.fromClinicId,
          itemId: line.itemId,
          quantityDelta: -line.quantitySent,
          movementType: StockMovementType.TRANSFER_OUT,
          referenceType: 'StockTransfer',
          referenceId: transfer.id,
          createdByStaffId: actor.id,
          createdByUserId: actor.userId,
          notes: `Sent on ${transfer.transferNumber}`,
        });
        if (result.quantityAfter < 0) {
          shortfalls.push(line.itemId);
        }
      }

      const sent = await tx.stockTransfer.update({
        where: { id },
        data: { status: StockTransferStatus.SENT, sentByStaffId: actor.id, sentAt: new Date() },
      });

      await recordAudit(tx, actor, {
        action: 'stock.transfer.sent',
        entityType: 'StockTransfer',
        entityId: id,
        before: { status: StockTransferStatus.DRAFT },
        after: {
          status: StockTransferStatus.SENT,
          transferNumber: transfer.transferNumber,
          fromClinicId: transfer.fromClinicId,
          toClinicId: transfer.toClinicId,
          lines: transfer.lines.map((line) => ({ itemId: line.itemId, quantitySent: line.quantitySent })),
          // Recorded, not hidden: a send that took a branch negative is a fact
          // somebody needs to reconcile, and the alternative — refusing it — is
          // the block D-020 exists to prevent.
          ...(shortfalls.length > 0 ? { droveBelowZero: shortfalls } : {}),
        },
        source: 'stock.transfers',
      });

      return sent;
    });
  }

  /**
   * Receive it. The RECEIVING branch says what arrived.
   *
   * A line whose received quantity differs from what was sent needs a reason.
   * The sender's number is not touched: the discrepancy is the record, and it
   * is what the exception queue shows.
   */
  async receive(id: string, dto: ReceiveStockTransferDto) {
    return withAdminTx(this.rawPrisma, 'stock.transfer.receive', async (tx, actor) => {
      const transfer = await tx.stockTransfer.findUnique({ where: { id }, include: { lines: true } });
      if (!transfer) throw new NotFoundException('Transfer not found');
      if (transfer.status !== StockTransferStatus.SENT) {
        throw new ConflictException(
          transfer.status === StockTransferStatus.DRAFT
            ? 'This transfer has not been sent yet.'
            : 'This transfer has already been received.',
        );
      }
      if (actor.clinicId && actor.clinicId !== transfer.toClinicId) {
        throw new BadRequestException('Only the receiving branch can confirm what arrived.');
      }

      const byLineId = new Map(transfer.lines.map((line) => [line.id, line]));
      const submitted = new Map(dto.lines.map((line) => [line.lineId, line]));
      for (const lineId of submitted.keys()) {
        if (!byLineId.has(lineId)) {
          throw new BadRequestException('That line does not belong to this transfer.');
        }
      }
      const missing = transfer.lines.filter((line) => !submitted.has(line.id));
      if (missing.length > 0) {
        throw new BadRequestException('Every line must be confirmed — say zero for a line that did not arrive.');
      }

      let anyDiscrepancy = false;
      for (const line of transfer.lines) {
        const confirmation = submitted.get(line.id)!;
        const discrepancy = confirmation.quantityReceived !== line.quantitySent;
        if (discrepancy) {
          anyDiscrepancy = true;
          if (!confirmation.discrepancyReason?.trim()) {
            throw new BadRequestException(
              `Line quantities differ from what was sent (${line.quantitySent} sent, ${confirmation.quantityReceived} received). Say why.`,
            );
          }
        }

        await tx.stockTransferLine.update({
          where: { id: line.id },
          data: {
            quantityReceived: confirmation.quantityReceived,
            discrepancyReason: confirmation.discrepancyReason ?? null,
          },
        });

        if (confirmation.quantityReceived > 0) {
          await postMovement(tx, {
            tenantId: transfer.tenantId,
            clinicId: transfer.toClinicId,
            itemId: line.itemId,
            quantityDelta: confirmation.quantityReceived,
            movementType: StockMovementType.TRANSFER_IN,
            referenceType: 'StockTransfer',
            referenceId: transfer.id,
            createdByStaffId: actor.id,
            createdByUserId: actor.userId,
            notes: discrepancy
              ? `Received on ${transfer.transferNumber} — ${line.quantitySent} sent, ${confirmation.quantityReceived} received`
              : `Received on ${transfer.transferNumber}`,
          });
        }
      }

      // WHAT WAS SENT BUT NOT RECEIVED STAYS OFF BOTH SHELVES.
      //
      // The sending branch's stock left at SEND and is not silently returned:
      // the goods are missing, and inventing a movement to put them back would
      // hide exactly the loss this workflow exists to surface. The shortfall
      // sits in the discrepancy report until somebody adjusts it deliberately,
      // with a reason, through `stock.adjust`.
      const received = await tx.stockTransfer.update({
        where: { id },
        data: {
          status: anyDiscrepancy ? StockTransferStatus.RECEIVED_WITH_DISCREPANCY : StockTransferStatus.RECEIVED,
          receivedByStaffId: actor.id,
          receivedAt: new Date(),
        },
      });

      await recordAudit(tx, actor, {
        action: 'stock.transfer.received',
        entityType: 'StockTransfer',
        entityId: id,
        before: { status: StockTransferStatus.SENT },
        after: {
          status: received.status,
          transferNumber: transfer.transferNumber,
          lines: transfer.lines.map((line) => ({
            itemId: line.itemId,
            quantitySent: line.quantitySent,
            quantityReceived: submitted.get(line.id)!.quantityReceived,
            discrepancyReason: submitted.get(line.id)!.discrepancyReason ?? null,
          })),
        },
        source: 'stock.transfers',
      });

      return received;
    });
  }

  /** Cancel a transfer that has not been sent. A sent one is received, not cancelled. */
  async cancel(id: string, dto: CancelStockTransferDto) {
    return withAdminTx(this.rawPrisma, 'stock.transfer', async (tx, actor) => {
      const transfer = await tx.stockTransfer.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!transfer) throw new NotFoundException('Transfer not found');
      if (transfer.status !== StockTransferStatus.DRAFT) {
        throw new ConflictException(
          'Only a draft transfer can be cancelled. Stock that has already left a branch must be received, even if the count is zero.',
        );
      }
      const cancelled = await tx.stockTransfer.update({
        where: { id },
        data: {
          status: StockTransferStatus.CANCELLED,
          cancelledByStaffId: actor.id,
          cancelledAt: new Date(),
          cancelReason: dto.reason,
        },
      });
      await recordAudit(tx, actor, {
        action: 'stock.transfer.cancelled',
        entityType: 'StockTransfer',
        entityId: id,
        before: { status: StockTransferStatus.DRAFT },
        after: { status: StockTransferStatus.CANCELLED },
        reason: dto.reason,
        source: 'stock.transfers',
      });
      return cancelled;
    });
  }

  async list(params: { clinicId?: string; status?: StockTransferStatus; direction?: 'IN' | 'OUT' }) {
    const actor = await requirePermission(this.rawPrisma, 'stock.view');
    const clinicId = params.clinicId ?? actor.clinicId ?? undefined;
    const branchFilter = clinicId
      ? params.direction === 'IN'
        ? { toClinicId: clinicId }
        : params.direction === 'OUT'
          ? { fromClinicId: clinicId }
          : { OR: [{ fromClinicId: clinicId }, { toClinicId: clinicId }] }
      : {};

    const transfers = await this.prisma.stockTransfer.findMany({
      where: { ...branchFilter, ...(params.status ? { status: params.status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        fromClinic: { select: { name: true } },
        toClinic: { select: { name: true } },
        createdBy: { select: { fullName: true } },
        sentBy: { select: { fullName: true } },
        receivedBy: { select: { fullName: true } },
        lines: { include: { item: { select: { name: true, code: true, unitOfMeasure: true } } } },
      },
    });

    return transfers.map((transfer) => {
      const discrepancies = transfer.lines.filter(
        (line) => line.quantityReceived !== null && line.quantityReceived !== line.quantitySent,
      );
      return {
        id: transfer.id,
        transferNumber: transfer.transferNumber,
        status: transfer.status,
        fromClinicId: transfer.fromClinicId,
        toClinicId: transfer.toClinicId,
        fromClinicName: transfer.fromClinic.name,
        toClinicName: transfer.toClinic.name,
        interCompany: transfer.interCompany,
        interCompanyReference: transfer.interCompanyReference,
        notes: transfer.notes,
        createdAt: transfer.createdAt,
        createdBy: transfer.createdBy.fullName,
        sentAt: transfer.sentAt,
        sentBy: transfer.sentBy?.fullName ?? null,
        receivedAt: transfer.receivedAt,
        receivedBy: transfer.receivedBy?.fullName ?? null,
        lineCount: transfer.lines.length,
        totalSent: transfer.lines.reduce((total, line) => total + line.quantitySent, 0),
        totalReceived: transfer.lines.reduce((total, line) => total + (line.quantityReceived ?? 0), 0),
        discrepancyCount: discrepancies.length,
        value: transfer.lines.reduce(
          (total, line) => total + Number(line.unitCost ?? 0) * line.quantitySent,
          0,
        ),
        lines: transfer.lines.map((line) => ({
          id: line.id,
          itemId: line.itemId,
          itemName: line.item.name,
          itemCode: line.item.code,
          unit: line.item.unitOfMeasure,
          quantitySent: line.quantitySent,
          quantityReceived: line.quantityReceived,
          discrepancy: line.quantityReceived === null ? null : line.quantityReceived - line.quantitySent,
          discrepancyReason: line.discrepancyReason,
          unitCost: line.unitCost === null ? null : Number(line.unitCost),
        })),
      };
    });
  }
}
