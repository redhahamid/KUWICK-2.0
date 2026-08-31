import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ProcurementRequestStatus, PurchaseOrderStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';

export interface FindPurchaseOrdersFilter {
  clinicId?: string;
  status?: PurchaseOrderStatus;
}

@Injectable()
export class PurchaseOrderService {
  constructor(@Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient) {}

  // Sequential writes, not a nested $transaction — see GoodsReceivingService
  // for why (same accepted gap as AppointmentService#reschedule).
  async create(dto: CreatePurchaseOrderDto) {
    const tenantId = currentTenantId();
    const purchaseOrder = await this.prisma.purchaseOrder.create({
      data: {
        tenantId,
        clinicId: dto.clinicId,
        supplierId: dto.supplierId,
        status: PurchaseOrderStatus.ORDERED,
      },
    });

    for (const line of dto.lines) {
      await this.prisma.purchaseOrderLine.create({
        data: {
          tenantId,
          purchaseOrderId: purchaseOrder.id,
          itemId: line.itemId,
          procurementRequestId: line.procurementRequestId,
          orderedQuantity: line.orderedQuantity,
          unitCost: line.unitCost,
          bonusUnitCost: line.bonusUnitCost ?? null,
        },
      });
      if (line.procurementRequestId) {
        await this.prisma.procurementRequest.update({
          where: { id: line.procurementRequestId },
          data: { status: ProcurementRequestStatus.CONVERTED },
        });
      }
    }

    return this.findById(purchaseOrder.id);
  }

  findAll(filter: FindPurchaseOrdersFilter) {
    return this.prisma.purchaseOrder.findMany({
      where: { clinicId: filter.clinicId, status: filter.status },
      include: { supplier: true, lines: { include: { item: true } } },
      orderBy: { orderedAt: 'desc' },
    });
  }

  async findById(id: string) {
    const purchaseOrder = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { supplier: true, lines: { include: { item: true } } },
    });
    if (!purchaseOrder) {
      throw new NotFoundException('Purchase order not found');
    }
    return purchaseOrder;
  }
}
