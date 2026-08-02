import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OrderServiceStatus, ServiceOrderType } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { deleteUploadedFile, saveUploadedFile } from '../core/file-storage';
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

  // G2b — read-only additions so the clinical record can show who ordered
  // something, whether it carries results/attachments, and whether it has
  // reached an invoice. Counts rather than full rows: the section only needs
  // to say "2 attachments", and pulling the payloads would be wasteful.
  findByVisitId(visitId: string, filter: FindOrderServicesFilter = {}) {
    return this.prisma.orderService.findMany({
      where: { visitId, orderType: filter.orderType, status: filter.status },
      include: {
        requestedBy: true,
        _count: { select: { attachments: true, invoiceLines: true } },
      },
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

  // Includes visit/patient/clinic/requestedBy so this one call backs both
  // internal status-transition validation and the print-result view
  // (GET /order-services/:id) — extra joined fields are harmless to the
  // former, no separate "detail" method needed.
  async findById(id: string) {
    const order = await this.prisma.orderService.findUnique({
      where: { id },
      include: { visit: { include: { patient: true, clinic: true } }, requestedBy: true },
    });
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

  // Phase A7 — when a form template's structured formData is submitted
  // without explicit free-text `result`, a plain-text summary is derived
  // from it so every existing reader (the table's Result column, the
  // print view) keeps working without knowing about forms at all.
  async complete(id: string, dto: CompleteOrderServiceDto) {
    const order = await this.findById(id);
    assertStatus(order.status, OrderServiceStatus.IN_PROGRESS, 'complete');
    let result = dto.result;
    if (!result && dto.formTemplateId && dto.formData) {
      const template = await this.prisma.formTemplate.findUnique({ where: { id: dto.formTemplateId } });
      if (template) {
        const fields = template.fields as unknown as { id: string; label: string; unit?: string }[];
        result = fields
          .map((field) => `${field.label}: ${dto.formData?.[field.id] ?? '-'}${field.unit ? ` ${field.unit}` : ''}`)
          .join('\n');
      }
    }
    return this.prisma.orderService.update({
      where: { id },
      data: {
        status: OrderServiceStatus.COMPLETED,
        result,
        formTemplateId: dto.formTemplateId,
        formData: dto.formData as object | undefined,
        completedAt: new Date(),
      },
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

  listAttachments(orderServiceId: string) {
    return this.prisma.attachment.findMany({
      where: { orderServiceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // uploadedByStaffId defaults to the order's own requestedByStaffId — no
  // separate doctor/staff picker this phase (D-017, same convention as
  // OrderService.requestedByStaffId itself).
  async addAttachment(orderServiceId: string, file: Express.Multer.File) {
    const order = await this.findById(orderServiceId);
    const tenantId = currentTenantId();
    const stored = await saveUploadedFile(tenantId, order.id, file.buffer, file.originalname);
    return this.prisma.attachment.create({
      data: {
        tenantId,
        orderServiceId: order.id,
        fileName: file.originalname,
        filePath: stored.relativePath,
        mimeType: file.mimetype,
        fileSize: file.size,
        uploadedByStaffId: order.requestedByStaffId,
      },
    });
  }

  async findAttachment(orderServiceId: string, attachmentId: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.orderServiceId !== orderServiceId) {
      throw new NotFoundException('Attachment not found');
    }
    return attachment;
  }

  async deleteAttachment(orderServiceId: string, attachmentId: string) {
    const attachment = await this.findAttachment(orderServiceId, attachmentId);
    await this.prisma.attachment.delete({ where: { id: attachmentId } });
    await deleteUploadedFile(attachment.filePath);
  }
}

function assertStatus(current: OrderServiceStatus, required: OrderServiceStatus, action: string): void {
  if (current !== required) {
    throw new BadRequestException(`Cannot ${action} an order/service in status ${current}`);
  }
}
