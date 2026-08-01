import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { QueueTicketStatus, QueueType } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { VisitService, CreateVisitInput } from './visit.service';
import { CancelQueueTicketDto } from './dto/cancel-queue-ticket.dto';

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
  async addToQueue(input: AddToQueueInput) {
    const queueType = input.queueType ?? QueueType.WALK_IN;
    const { queueType: _ignored, ...visitInput } = input;
    const visit = await this.visits.create(visitInput);
    const ticketNumber = await this.nextTicketNumber(input.clinicId, queueType);
    return this.prisma.queueTicket.create({
      data: {
        tenantId: currentTenantId(),
        clinicId: input.clinicId,
        visitId: visit.id,
        ticketNumber,
        queueType,
        displayNumber: formatDisplayNumber(queueType, ticketNumber),
      },
      include: { visit: { include: { patient: true, staff: true } }, room: true },
    });
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
    const ticket = await this.findById(id);
    if (roomId) {
      const room = await this.prisma.room.findUnique({ where: { id: roomId } });
      if (!room || !room.active) {
        throw new BadRequestException('Unknown or inactive room');
      }
    }
    if (staffId && staffId !== ticket.visit.staffId) {
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
    const ticket = await this.findById(id);
    assertStatus(ticket.status, QueueTicketStatus.WAITING, 'mark as arrived');
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
    const ticket = await this.findById(id);
    assertStatus(ticket.status, QueueTicketStatus.IN_CONSULTATION, 'move to dispensary & payment');
    return this.prisma.queueTicket.update({
      where: { id },
      data: { status: QueueTicketStatus.DISPENSARY_PAYMENT },
    });
  }

  async complete(id: string) {
    const ticket = await this.findById(id);
    assertStatus(ticket.status, QueueTicketStatus.DISPENSARY_PAYMENT, 'complete');
    await this.visits.checkOut(ticket.visitId);
    return this.prisma.queueTicket.update({
      where: { id },
      data: { status: QueueTicketStatus.COMPLETED },
    });
  }

  async cancel(id: string, dto: CancelQueueTicketDto) {
    const ticket = await this.findById(id);
    if (ticket.status === QueueTicketStatus.COMPLETED || ticket.status === QueueTicketStatus.CANCELLED) {
      throw new BadRequestException(`Cannot cancel a queue ticket in status ${ticket.status}`);
    }
    return this.prisma.queueTicket.update({
      where: { id },
      data: { status: QueueTicketStatus.CANCELLED, cancelReason: dto.cancelReason },
    });
  }
}

function assertStatus(current: QueueTicketStatus, required: QueueTicketStatus, action: string): void {
  if (current !== required) {
    throw new BadRequestException(`Cannot ${action} a queue ticket in status ${current}`);
  }
}
