import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { QueueTicketStatus, QueueType } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { VisitService, CreateVisitInput } from './visit.service';
import { CancelQueueTicketDto } from './dto/cancel-queue-ticket.dto';
import { PrismaService } from '../core/prisma.service';
import { ClinicalTx, assertMayTouchVisit, branchContext, requireActor, withTenantTx } from './clinical-actor';
import { hasBranchAccess } from './clinical-authorization';
import { QueueAction, assertCanPerformQueueAction, isLegalQueueTransition } from './queue-authorization';

export interface FindQueueTicketsFilter {
  clinicId?: string;
  status?: QueueTicketStatus;
  queueType?: QueueType;
}

export interface AddToQueueInput extends CreateVisitInput {
  queueType?: QueueType;
}

// Queue overhaul (D-038) — kuwick.com's real 4-stream numbering. Each
// stream numbers independently per clinic per day: W001, E001, A003...
const QUEUE_TYPE_PREFIX: Record<QueueType, string> = {
  [QueueType.APPOINTMENT]: 'A',
  [QueueType.OTC]: 'C',
  [QueueType.WALK_IN]: 'W',
  [QueueType.EMERGENCY]: 'E',
};

export function formatDisplayNumber(queueType: QueueType, ticketNumber: number): string {
  return `${QUEUE_TYPE_PREFIX[queueType]}${String(ticketNumber).padStart(3, '0')}`;
}

// Sequential, not a nested $transaction: TENANT_SCOPED_PRISMA
// (core/tenant-scoped-prisma.provider.ts) already wraps each individual
// query in its own transaction, and nesting an interactive $transaction
// through it is untested — the same accepted gap as
// AppointmentService#reschedule and GoodsReceivingService.
@Injectable()
export class QueueTicketService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
    private readonly visits: VisitService,
  ) {}

  // Resets daily per clinic *per queue type* (D-038) — same accepted
  // count-based-sequence gap as Visit.visitNumber.
  private async nextTicketNumber(clinicId: string, queueType: QueueType): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const count = await this.prisma.queueTicket.count({
      where: { clinicId, queueType, createdAt: { gte: startOfDay } },
    });
    return count + 1;
  }

  // The single operation behind both entry points: the front-desk "Add to
  // Daily Queue" action and AppointmentService.arrived() (docs/PRODUCT_
  // REQUIREMENTS.md §6 — "arrived auto-creates a queue ticket", which
  // passes queueType APPOINTMENT).
  /**
   * S3 (D-079) — the ONE gate every queue mutation goes through.
   *
   * Resolves the acting staff member from the authenticated session (never a
   * role claim in the request), checks the action against the queue matrix,
   * and checks branch access against the ticket's own STORED visit — never a
   * tenant, clinic or branch supplied by the browser.
   *
   * `requireActor` is what makes anonymous access fail: there is no staff on
   * the session, so it throws before anything is read or written. That is the
   * same enforcement point G3c, S1 and S2 use.
   */
  private async authoriseTicket(ticketId: string, action: QueueAction) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformQueueAction(actor, action);

      // Resolved under the tenant: a foreign ticket reads back empty and gets
      // the same 404 a nonexistent id gets.
      const ticket = await tx.queueTicket.findUnique({
        where: { id: ticketId },
        select: { id: true, visitId: true, status: true, clinicId: true },
      });
      if (!ticket) {
        throw new NotFoundException('Queue ticket not found');
      }
      // Branch is checked against the VISIT's stored clinic, the same
      // authority every other clinical guard uses.
      await assertMayTouchVisit(tx, ticket.visitId, actor);
      return { actor, ticket };
    });
  }

  /** Authorises an action that has no ticket yet. */
  private async authoriseCreate(action: QueueAction) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformQueueAction(actor, action);
      return actor;
    });
  }

  async addToQueue(input: AddToQueueInput) {
    await this.authoriseCreate('CREATE_TICKET');

    const queueType = input.queueType ?? QueueType.WALK_IN;
    const { queueType: _ignored, ...visitInput } = input;
    // VisitService.create already resolves patient, clinic and staff under
    // the tenant and enforces branch access (D-069). The ticket below is
    // written from the RESOLVED visit, not from the request.
    const visit = await this.visits.create(visitInput);

    const ticketNumber = await this.nextTicketNumber(visit.clinicId, queueType);
    try {
      return await this.prisma.queueTicket.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: visit.clinicId,
          visitId: visit.id,
          ticketNumber,
          queueType,
          displayNumber: formatDisplayNumber(queueType, ticketNumber),
        },
        include: { visit: { include: { patient: true, staff: true } }, room: true },
      });
    } catch (error) {
      // `visitId` is unique: one ticket represents the visit's CURRENT
      // location, by owner decision. A second one is refused in the
      // product's words, never with the constraint's name.
      if (isUniqueViolation(error)) {
        throw new ConflictException('This visit is already in the queue.');
      }
      throw error;
    }
  }

  findAll(filter: FindQueueTicketsFilter) {
    return this.prisma.queueTicket.findMany({
      where: { clinicId: filter.clinicId, status: filter.status, queueType: filter.queueType },
      include: { visit: { include: { patient: true, staff: true } }, room: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(id: string) {
    const ticket = await this.prisma.queueTicket.findUnique({
      where: { id },
      include: { visit: { include: { patient: true, staff: true } }, room: true },
    });
    if (!ticket) {
      throw new NotFoundException('Queue ticket not found');
    }
    return ticket;
  }

  // Announces/highlights the ticket on the monitor display — no status
  // change (distinct from "Arrived", D-024 docs/DECISIONS.md). D-038: also
  // records which room/station the patient is being called to, so the
  // monitor can pair "W001" with "Consultation 1". D-044: staffId lets the
  // call reassign the visit's attending doctor — front-desk often adds a
  // walk-in before knowing which doctor will actually see them.
  async call(id: string, roomId?: string, staffId?: string) {
    const { ticket } = await this.authoriseTicket(id, 'CALL_PATIENT');
    const current = await this.findById(id);

    if (roomId) {
      // Resolved under the tenant — a foreign room id reads back empty.
      const room = await this.prisma.room.findUnique({ where: { id: roomId } });
      if (!room || !room.active) {
        throw new BadRequestException('Unknown or inactive room');
      }
      if (room.clinicId !== ticket.clinicId) {
        throw new BadRequestException('That room belongs to a different branch.');
      }
    }

    // S3F — reassigning the attending clinician is a change of clinical
    // authorship, not a queue movement, so it needs its OWN permission and
    // its own validation. Before this, calling a patient could silently
    // rewrite Visit.staffId to any id the caller sent, including a staff
    // member from another tenant or branch, or an inactive one.
    if (staffId && staffId !== current.visit.staffId) {
      await withTenantTx(this.rawPrisma, async (tx) => {
        const actor = await requireActor(tx);
        assertCanPerformQueueAction(actor, 'ASSIGN_CLINICIAN');
        await resolveClinicianForVisit(tx, staffId, ticket.clinicId);
      });
      await this.prisma.visit.update({ where: { id: ticket.visitId }, data: { staffId } });
    }
    return this.prisma.queueTicket.update({
      where: { id },
      data: { calledAt: new Date(), roomId: roomId ?? null },
      include: { room: true, visit: { include: { patient: true, staff: true } } },
    });
  }

  // D-024 (docs/DECISIONS.md): WAITING -> IN_CONSULTATION.
  async arrived(id: string) {
    const { ticket } = await this.authoriseTicket(id, 'START_CONSULTATION');
    // Idempotent: asking again for a state the ticket is already in is a
    // double-click, not an error.
    if (ticket.status === QueueTicketStatus.IN_CONSULTATION) {
      return this.findById(id);
    }
    assertTransition(ticket.status, QueueTicketStatus.IN_CONSULTATION, 'mark as arrived');
    return this.prisma.queueTicket.update({
      where: { id },
      data: { status: QueueTicketStatus.IN_CONSULTATION },
    });
  }

  // Not explicitly detailed in the audit — Dispensary & Payment and
  // Completed are thin placeholders even in the reference system (D-023) —
  // this is the state-machine progression Invoice/payment recording
  // (Phase 5) needs to have something real to close out.
  async moveToDispensary(id: string) {
    const { ticket } = await this.authoriseTicket(id, 'MOVE_TO_DISPENSARY');
    if (ticket.status === QueueTicketStatus.DISPENSARY_PAYMENT) {
      return this.findById(id);
    }
    assertTransition(ticket.status, QueueTicketStatus.DISPENSARY_PAYMENT, 'move to dispensary & payment');
    return this.prisma.queueTicket.update({
      where: { id },
      data: { status: QueueTicketStatus.DISPENSARY_PAYMENT },
    });
  }

  /**
   * S3E (D-079) — completion is now ATOMIC.
   *
   * It used to be two unprotected writes: the ticket was set COMPLETED, then
   * the visit's checkOutAt was set by a separate call. A failure between them
   * left a completed ticket on a visit that was still open — a patient who
   * had left the clinic but whose visit never closed, with nothing to
   * indicate which of the two was true.
   *
   * Both writes are now one transaction. The ticket is re-read INSIDE it and
   * its status re-checked, so two racing requests cannot both proceed on a
   * stale read; the loser finds the ticket already COMPLETED and returns the
   * existing state rather than closing the visit twice.
   */
  async complete(id: string) {
    await this.authoriseTicket(id, 'COMPLETE_TICKET');

    await withTenantTx(this.rawPrisma, async (tx) => {
      const fresh = await tx.queueTicket.findUnique({
        where: { id },
        select: { id: true, status: true, visitId: true },
      });
      if (!fresh) {
        throw new NotFoundException('Queue ticket not found');
      }
      // Idempotent: a repeated completion is a no-op, not a second checkout.
      if (fresh.status === QueueTicketStatus.COMPLETED) {
        return;
      }
      assertTransition(fresh.status, QueueTicketStatus.COMPLETED, 'complete');

      await tx.queueTicket.update({ where: { id }, data: { status: QueueTicketStatus.COMPLETED } });
      // Same transaction: if this fails, the ticket update rolls back with it.
      await tx.visit.update({ where: { id: fresh.visitId }, data: { checkOutAt: new Date() } });
    });

    return this.findById(id);
  }

  /**
   * S3G — cancellation. The ticket row is RETAINED and the reason kept; the
   * visit, its prescriptions, orders, documents, invoices and stock movements
   * are all untouched. A terminal ticket cannot be cancelled.
   */
  async cancel(id: string, dto: CancelQueueTicketDto) {
    const { ticket } = await this.authoriseTicket(id, 'CANCEL_TICKET');
    if (ticket.status === QueueTicketStatus.COMPLETED || ticket.status === QueueTicketStatus.CANCELLED) {
      throw new BadRequestException(`Cannot cancel a queue ticket in status ${ticket.status}`);
    }
    return this.prisma.queueTicket.update({
      where: { id },
      data: { status: QueueTicketStatus.CANCELLED, cancelReason: dto.cancelReason },
    });
  }
}

/**
 * S3D — every transition is checked against the legal map, so a status can
 * only move where the workflow actually allows. The message names the states,
 * never a database constraint.
 */
function assertTransition(from: QueueTicketStatus, to: QueueTicketStatus, action: string): void {
  if (!isLegalQueueTransition(from, to)) {
    throw new BadRequestException(`Cannot ${action} a queue ticket in status ${from}`);
  }
}

/** Prisma's unique-violation code, without leaking the constraint name. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

/**
 * S3F — a staff member who may be recorded as the attending clinician on a
 * visit at this branch. Mirrors `resolveActiveStaffForClinic` (D-069): exists
 * in this tenant, active, and authorised for the branch.
 */
async function resolveClinicianForVisit(
  tx: ClinicalTx,
  staffId: string,
  clinicId: string,
) {
  const staff = await tx.staff.findUnique({ where: { id: staffId } });
  if (!staff) {
    throw new NotFoundException('Staff member not found');
  }
  if (!staff.active) {
    throw new BadRequestException('That staff member is not active.');
  }
  if (!hasBranchAccess(staff, clinicId, await branchContext(tx, staff))) {
    throw new BadRequestException(
      'That staff member is not authorised for this branch, so they cannot be recorded as the attending clinician.',
    );
  }
  return staff;
}
