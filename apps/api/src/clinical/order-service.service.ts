import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttachmentRecordStatus, OrderServiceStatus, ServiceOrderType } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { saveUploadedFile } from '../core/file-storage';
import { validateClinicalAttachment } from './attachment-validation';
import { PrismaService } from '../core/prisma.service';
import { assertCanVoidClinicalRecord, snapshotOf } from './clinical-authorization';
import {
  assertMayTouchOrder,
  assertMayTouchVisit,
  requireActor,
  requireClinicalAuthor,
  withTenantTx,
} from './clinical-actor';
import { VoidClinicalRecordDto } from './dto/void-clinical-record.dto';
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
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * Snapshots code/procedureName/orderType from the catalogue at order time
   * (docs/DATABASE_ARCHITECTURE.md §3) and defaults requestedByStaffId to the
   * visit's attending physician — no separate doctor-picker UI this phase
   * (D-017).
   *
   * S2 (D-074) — resolve everything, in one tenant transaction, BEFORE writing.
   *
   * Creation used to read the visit and the catalogue entry through the
   * tenant-scoped client and write straight away. RLS meant a foreign tenant's
   * visit came back empty, so cross-TENANT creation already failed — but
   * nothing checked the BRANCH. A staff member authorised only for Branch A
   * could add an order or a chargeable service to a Branch B visit by naming
   * its id, which is the same gap D-069 closed for visits and D-070 for
   * appointments. This is the third and last of those endpoints.
   *
   * `assertMayTouchVisit` is the project's existing central guard: it loads
   * the visit's OWN stored `clinicId` and checks it against the actor's branch
   * context. The browser's idea of the tenant, clinic or branch is never
   * consulted — only the visit id, which is then resolved.
   *
   * Both order types go through the identical gate. A direct service is
   * chargeable, so "it is only a service" is a reason for more care, not less.
   */
  async create(dto: CreateOrderServiceDto) {
    const { visit, catalogEntry, orderAuthor } = await withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      // Ordering a procedure or investigation is a clinical decision, so the
      // actor must be entitled to author one — and becomes its author.
      const orderAuthor = await requireClinicalAuthor(tx, 'order a clinical service');

      // Resolves the visit AND the actor's right to work at its stored
      // branch. 404 for a visit that does not exist or belongs to another
      // tenant — identical responses, so this cannot be used to probe.
      await assertMayTouchVisit(tx, dto.visitId, actor);

      const resolvedVisit = await tx.visit.findUnique({
        where: { id: dto.visitId },
        select: { id: true, clinicId: true, staffId: true },
      });
      if (!resolvedVisit) {
        throw new NotFoundException('Visit not found');
      }

      const resolvedCatalog = await tx.serviceCatalog.findUnique({
        where: { id: dto.serviceCatalogId },
        select: { id: true, code: true, name: true, orderType: true },
      });
      if (!resolvedCatalog) {
        throw new NotFoundException('Service catalog entry not found');
      }

      // b2 PHASE E — the room must be one of THIS clinic's, and still in use.
      //
      // Not redundant with the foreign key: PostgreSQL checks FKs through
      // internal triggers that row-level security does not apply to, so
      // another clinic's room id would be accepted by the constraint and then
      // read back as nothing — a task queued to a room nobody can see, with no
      // error anywhere. A retired room is refused for the plainer reason that
      // nobody is working in it.
      if (dto.roomId) {
        const room = await tx.room.findFirst({
          where: { id: dto.roomId, clinicId: resolvedVisit.clinicId, active: true },
          select: { id: true },
        });
        if (!room) {
          throw new BadRequestException(
            'That room is not one of this clinic\'s active rooms. Choose another, or add it in Settings › Rooms & Stations.',
          );
        }
      }

      return { visit: resolvedVisit, catalogEntry: resolvedCatalog, orderAuthor };
    });

    // G4.5s (D-073) — the two order types are created in different states,
    // because they mean different things.
    //
    // A TASK_ORDER is a request for someone to DO something: it starts
    // PENDING and moves through the task workflow, unchanged.
    //
    // A STANDARD_SERVICE is a direct service — a consultation fee, a
    // dressing. Nobody is waiting on it and there is no result to come back.
    // Adding it to the visit IS the delivery event, so it is created in its
    // final operational state instead of sitting in a queue nobody works.
    //
    // The decision keys on the STORED orderType snapshotted from the
    // catalogue, never on the service's name.
    const isDirectService = catalogEntry.orderType === ServiceOrderType.STANDARD_SERVICE;
    const isTaskOrder = !isDirectService;
    const now = new Date();

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
        // b2 PHASE E — keyed on the STORED order type, never on the name.
        //
        // A room and an urgency describe work somebody has to carry out, so
        // they are dropped for a standard service rather than stored where
        // nothing will ever read them; a quantity is what a standard service
        // is billed by, and a task order is one piece of work whatever the
        // client sends. Silently ignoring the wrong field is right here —
        // refusing would make the picker's two shapes into two error messages.
        roomId: isTaskOrder ? dto.roomId : undefined,
        urgency: isTaskOrder ? dto.urgency : undefined,
        quantity: isTaskOrder ? 1 : (dto.quantity ?? 1),
        // G4.5d3c-1c (D-085) — the requesting clinician is the one who
        // ordered it, not whoever the visit happens to be assigned to.
        requestedByStaffId: orderAuthor.id,
        ...(isDirectService
          ? { status: OrderServiceStatus.COMPLETED, completedAt: now }
          : {}),
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
    assertIsTaskOrder(order.orderType, 'started');
    assertStatus(order.status, OrderServiceStatus.PENDING, 'start');
    return this.prisma.orderService.update({ where: { id }, data: { status: OrderServiceStatus.IN_PROGRESS } });
  }

  // Phase A7 — when a form template's structured formData is submitted
  // without explicit free-text `result`, a plain-text summary is derived
  // from it so every existing reader (the table's Result column, the
  // print view) keeps working without knowing about forms at all.
  async complete(id: string, dto: CompleteOrderServiceDto) {
    const order = await this.findById(id);
    assertIsTaskOrder(order.orderType, 'completed');
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

  /**
   * G4.5s (D-073) — cancellation, with the direct-service case made possible
   * again.
   *
   * The old rule refused to cancel anything COMPLETED. That is right for a
   * TASK_ORDER: a procedure that has been performed and has a result cannot
   * be un-performed. It would have made a direct service permanently
   * uncancellable the moment it was created, since it is now created
   * COMPLETED — a mis-added consultation fee could never be taken off the
   * visit. So COMPLETED blocks cancellation for TASK_ORDER only.
   *
   * Money is the harder constraint, and it is deliberately NOT resolved here.
   * If the service has already reached an invoice, cancelling it would leave a
   * charge for something that is no longer on the record. This does not
   * quietly delete that line: removing an invoice line is the biller's
   * existing, authorised, UNPAID-only route (D-066), and a paid invoice must
   * never be mutated as a side effect of a clinical action. The refusal names
   * the invoice so the biller knows exactly what to act on.
   */
  async cancel(id: string, dto: CancelOrderServiceDto) {
    const order = await this.findById(id);
    if (order.status === OrderServiceStatus.CANCELLED) {
      throw new BadRequestException('This order/service has already been cancelled.');
    }
    if (order.status === OrderServiceStatus.COMPLETED && order.orderType === ServiceOrderType.TASK_ORDER) {
      throw new BadRequestException('Cannot cancel a completed procedure or investigation.');
    }

    const billed = await this.prisma.invoiceLine.findFirst({
      where: { sourceOrderServiceId: id },
      select: { invoice: { select: { invoiceNumber: true, status: true } } },
    });
    if (billed) {
      throw new ConflictException(
        `This service is already charged on invoice ${billed.invoice.invoiceNumber} (${billed.invoice.status}). ` +
          `Remove the invoice line first, then cancel the service.`,
      );
    }

    return this.prisma.orderService.update({
      where: { id },
      data: {
        status: OrderServiceStatus.CANCELLED,
        cancelReason: dto.cancelReason,
        // The row survives — never a hard delete. It stays visible on the
        // visit, labelled, so a cancelled charge is auditable.
      },
    });
  }

  // G3a (D-062) — ACTIVE only by default. A removed result must not read as a
  // current investigation finding; `includeRemoved` backs the audit view.
  listAttachments(orderServiceId: string, includeRemoved = false) {
    return this.prisma.attachment.findMany({
      where: {
        orderServiceId,
        ...(includeRemoved ? {} : { recordStatus: AttachmentRecordStatus.ACTIVE }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // uploadedByStaffId defaults to the order's own requestedByStaffId — no
  // separate doctor/staff picker this phase (D-017, same convention as
  // OrderService.requestedByStaffId itself).
  // G4.5d3c-3c1 — the SAME allow-list, extension agreement and leading-byte
  // signature check the visit attachments use. An order result is a clinical
  // attachment by any other name, and a policy that covered one endpoint and
  // not the other would simply move where the unvalidated file goes.
  async addAttachment(orderServiceId: string, file: Express.Multer.File) {
    const { mimeType, fileName } = validateClinicalAttachment(file);
    const order = await this.findById(orderServiceId);
    const tenantId = currentTenantId();
    const stored = await saveUploadedFile(tenantId, order.id, file.buffer, fileName);
    return this.prisma.attachment.create({
      data: {
        tenantId,
        orderServiceId: order.id,
        fileName,
        filePath: stored.relativePath,
        mimeType,
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

  /**
   * G3a (D-062) — audited removal of an investigation/procedure result.
   *
   * Replaces the hard delete. The row, the order relationship and the FILE all
   * survive: `deleteUploadedFile` is no longer called, so an authorised
   * history request can still retrieve the lab result or ECG trace. The
   * order's own status is untouched — removing a result does not un-complete
   * a procedure.
   */
  async removeAttachment(orderServiceId: string, attachmentId: string, dto: VoidClinicalRecordDto) {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('A reason is required to remove an investigation result.');
    }

    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanVoidClinicalRecord(actor, 'remove an investigation or procedure result');
      await assertMayTouchOrder(tx, orderServiceId, actor);

      const attachment = await tx.attachment.findUnique({ where: { id: attachmentId } });
      if (!attachment || attachment.orderServiceId !== orderServiceId) {
        throw new NotFoundException('Attachment not found');
      }
      if (attachment.recordStatus === AttachmentRecordStatus.REMOVED_IN_ERROR) {
        throw new ConflictException('This result has already been removed.');
      }
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== attachment.version) {
        throw new ConflictException('This result changed since you loaded it. Reload and try again.');
      }

      const snap = snapshotOf(actor);
      return tx.attachment.update({
        where: { id: attachmentId },
        data: {
          recordStatus: AttachmentRecordStatus.REMOVED_IN_ERROR,
          removedAt: new Date(),
          removedByStaffId: snap.staffId,
          removedByNameSnapshot: snap.nameSnapshot,
          removedByRoleSnapshot: snap.roleSnapshot,
          removalReason: reason,
          version: { increment: 1 },
        },
      });
    });
  }
}

function assertStatus(current: OrderServiceStatus, required: OrderServiceStatus, action: string): void {
  if (current !== required) {
    throw new BadRequestException(`Cannot ${action} an order/service in status ${current}`);
  }
}

/**
 * G4.5s (D-073) — the task lifecycle belongs to TASK_ORDER alone.
 *
 * The Canvas already hides Start and Complete on direct services, but hiding
 * a control is not a rule: the routes accepted the transition from anything
 * that could reach them. This is the rule.
 */
function assertIsTaskOrder(orderType: ServiceOrderType, action: string): void {
  if (orderType !== ServiceOrderType.TASK_ORDER) {
    throw new BadRequestException(
      `A direct service has no task workflow and cannot be ${action}. It is complete when it is added.`,
    );
  }
}
