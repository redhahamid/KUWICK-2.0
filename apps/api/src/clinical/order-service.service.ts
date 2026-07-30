import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OrderServiceStatus, ServiceOrderType } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { VisitService } from './visit.service';
import { CreateOrderServiceDto } from './dto/create-order-service.dto';
import { CompleteOrderServiceDto } from './dto/complete-order-service.dto';
import { CancelOrderServiceDto } from './dto/cancel-order-service.dto';

export interface FindOrderServicesFilter {
  orderType?: ServiceOrderType;
  status?: OrderServiceStatus;
}

export interface ProcedureQueueFilter {
  clinicId?: string;
  status?: OrderServiceStatus;
}

@Injectable()
export class OrderServiceService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly visits: VisitService,
  ) {}

  // Snapshots code/procedureName/orderType from the catalog at order time
  // (docs/DATABASE_ARCHITECTURE.md §3) and defaults requestedByStaffId to
  // the visit's attending physician — no separate doctor-picker UI this
  // phase, since no real auth/user-identity exists yet (D-017).
  async create(dto: CreateOrderServiceDto) {
    const visit = await this.visits.findById(dto.visitId);
    const catalogEntry = await this.prisma.serviceCatalog.findUnique({ where: { id: dto.serviceCatalogId } });
    if (!catalogEntry) {
      throw new NotFoundException('Service catalog entry not found');
    }

    return this.prisma.orderService.create({
      data: {
        tenantId: currentTenantId(),
        clinicId: visit.clinicId,
        visitId: dto.visitId,
        serviceCatalogId: catalogEntry.id,
        code: catalogEntry.code,
        procedureName: catalogEntry.name,
        orderType: catalogEntry.orderType,
        instruction: dto.instruction,
        requestedByStaffId: visit.staffId,
      },
    });
  }

  findByVisitId(visitId: string, filter: FindOrderServicesFilter = {}) {
    return this.prisma.orderService.findMany({
      where: { visitId, orderType: filter.orderType, status: filter.status },
      orderBy: { requestedAt: 'desc' },
    });
  }

  // The standalone Procedure Queue (/procedure-queue) — TASK_ORDER only
  // (Clinical 2c plan, judgment call #1): a paid consultation "Standard
  // Service" has no lab/imaging staff to execute it against a shared queue.
  procedureQueue(filter: ProcedureQueueFilter = {}) {
    return this.prisma.orderService.findMany({
      where: { orderType: ServiceOrderType.TASK_ORDER, clinicId: filter.clinicId, status: filter.status },
      include: { visit: { include: { patient: true } }, requestedBy: true },
      orderBy: { requestedAt: 'asc' },
    });
  }

  async findById(id: string) {
    const order = await this.prisma.orderService.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException('Order/service not found');
    }
    return order;
  }

  // PENDING -> IN_PROGRESS. Exposed on the Orders & Services tab's Action
  // column, not on the Procedure Queue — the audited reference system's own
  // Procedure Queue only shows a "Complete" action on IN_PROGRESS rows
  // (Clinical 2c plan, judgment call #2), same D-023 precedent as the Queue
  // module's thin Dispensary/Completed tabs.
  async start(id: string) {
    const order = await this.findById(id);
    assertStatus(order.status, OrderServiceStatus.PENDING, 'start');
    return this.prisma.orderService.update({ where: { id }, data: { status: OrderServiceStatus.IN_PROGRESS } });
  }

  async complete(id: string, dto: CompleteOrderServiceDto) {
    const order = await this.findById(id);
    assertStatus(order.status, OrderServiceStatus.IN_PROGRESS, 'complete');
    return this.prisma.orderService.update({
      where: { id },
      data: { status: OrderServiceStatus.COMPLETED, result: dto.result, completedAt: new Date() },
    });
  }

  async cancel(id: string, dto: CancelOrderServiceDto) {
    const order = await this.findById(id);
    if (order.status === OrderServiceStatus.COMPLETED || order.status === OrderServiceStatus.CANCELLED) {
      throw new BadRequestException(`Cannot cancel an order/service in status ${order.status}`);
    }
    return this.prisma.orderService.update({
      where: { id },
      data: { status: OrderServiceStatus.CANCELLED, cancelReason: dto.cancelReason },
    });
  }
}

function assertStatus(current: OrderServiceStatus, required: OrderServiceStatus, action: string): void {
  if (current !== required) {
    throw new BadRequestException(`Cannot ${action} an order/service in status ${current}`);
  }
}
