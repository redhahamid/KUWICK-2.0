import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { QueueTicketStatus, QueueType, VisitWorkflowEventType } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { VisitService, CreateVisitInput } from './visit.service';
import { CancelQueueTicketDto } from './dto/cancel-queue-ticket.dto';
import { PrismaService } from '../core/prisma.service';
import { VisitCompletionService } from './visit-completion.service';
import { ClinicalTx, assertMayTouchVisit, branchContext, requireActor, withTenantTx } from './clinical-actor';
import { hasBranchAccess } from './clinical-authorization';
import {
  QueueAction,
  assertCanPerformQueueAction,
  assertMayChangeAttendingClinician,
  attendingChangeNeedsReason,
  classifyAttendingChange,
  isLegalQueueTransition,
} from './queue-authorization';

export interface ChangeAttendingClinicianInput {
  staffId: string;
  reason?: string;
  /** Idempotency key, so a retried handover writes one event rather than two. */
  correlationId?: string;
}

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
    private readonly visitCompletion: VisitCompletionService,
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
        select: {
          id: true,
          visitId: true,
          status: true,
          clinicId: true,
          heldAt: true,
          heldByStaffId: true,
        },
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
        include: { visit: { include: { patient: true, staff: true } }, room: true, heldBy: true },
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
      include: { visit: { include: { patient: true, staff: true } }, room: true, heldBy: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(id: string) {
    const ticket = await this.prisma.queueTicket.findUnique({
      where: { id },
      include: { visit: { include: { patient: true, staff: true } }, room: true, heldBy: true },
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

    // S3F/S3b — reassigning the attending clinician is a change of clinical
    // authorship, not a queue movement, so it goes through its own rule.
    // Before this, calling a patient could silently rewrite Visit.staffId to
    // any id the caller sent, including a staff member from another tenant or
    // branch, or an inactive one.
    if (staffId && staffId !== current.visit.staffId) {
      await this.changeAttendingClinician(id, { staffId });
    }
    return this.prisma.queueTicket.update({
      where: { id },
      data: { calledAt: new Date(), roomId: roomId ?? null },
      include: { room: true, visit: { include: { patient: true, staff: true } } },
    });
  }

  /**
   * S3b (D-081) — assign or transfer the attending clinician.
   *
   * The owner's correction: doctor-to-doctor transfer is real clinical work
   * (shift handover, escalation, a doctor called away), and forcing it through
   * the front desk — or through cancelling and recreating the visit — is worse
   * than the risk of allowing it. What is still refused is a doctor taking a
   * patient who is actively with a colleague.
   *
   * PROSPECTIVE ONLY. This writes `Visit.staffId` and nothing else. Notes,
   * signatures, amendments, diagnoses, prescriptions, orders, services,
   * documents and authorisation records keep the author they already have —
   * Dr A's signed note stays Dr A's after the visit moves to Dr B. The queue
   * status, checkOutAt, doctor-completion state and every invoice are
   * untouched: a change of doctor is not a change of workflow position.
   */
  async changeAttendingClinician(ticketId: string, input: ChangeAttendingClinicianInput) {
    const { ticket } = await this.authoriseTicket(ticketId, 'ASSIGN_CLINICIAN');

    await withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);

      // Re-read inside the transaction: the visit may have changed hands
      // between the authorisation read and this write, and the whole point of
      // the rule is who holds it NOW.
      const visit = await tx.visit.findUnique({
        where: { id: ticket.visitId },
        select: { id: true, staffId: true },
      });
      if (!visit) {
        throw new NotFoundException('Visit not found');
      }

      // Idempotent: asking for the doctor who already holds the visit is a
      // double-click. No write, and NO event — a handover that did not happen
      // must not appear in the history.
      if (visit.staffId === input.staffId) {
        return;
      }

      // S3c — genuinely nobody is attending, which is now a real state rather
      // than something front desk had to fake. A missing staff ROW for a
      // non-null id is different and would be a broken reference, so it is
      // not silently treated as unassigned.
      const current = visit.staffId
        ? await tx.staff.findUnique({ where: { id: visit.staffId } })
        : null;
      if (visit.staffId && !current) {
        throw new NotFoundException('Visit not found');
      }
      const target = await resolveClinicianForVisit(tx, input.staffId, ticket.clinicId);

      assertMayChangeAttendingClinician(actor, current, target);

      const kind = classifyAttendingChange(current, actor);
      const reason = input.reason?.trim();
      if (attendingChangeNeedsReason(kind) && !reason) {
        throw new BadRequestException(
          'Give a reason for changing the attending doctor, so the handover is on record.',
        );
      }

      await tx.visit.update({ where: { id: visit.id }, data: { staffId: target.id } });

      // Same transaction as the write it describes: an unrecorded handover and
      // a recorded one that did not happen are both wrong, and only atomicity
      // rules out each.
      await tx.visitWorkflowEvent.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: ticket.clinicId,
          visitId: visit.id,
          queueTicketId: ticket.id,
          eventType: VisitWorkflowEventType.ATTENDING_CLINICIAN_CHANGED,
          previousStaffId: current?.id ?? null,
          newStaffId: target.id,
          actorStaffId: actor.id,
          actorNameSnapshot: actor.fullName,
          actorRoleSnapshot: actor.role,
          reason: reason ?? null,
          metadata: { kind },
          correlationId: input.correlationId ?? null,
        },
      });
    });

    return this.findById(ticketId);
  }

  // D-024 (docs/DECISIONS.md): WAITING -> IN_CONSULTATION.
  //
  // G4.5d3c-3b2 (D-094) — the transition now records a CONSULTATION_STARTED
  // workflow event in the SAME transaction. The event's createdAt is the
  // stable consultation-start timestamp the consultation tariff reads: the
  // fee for a 10:55pm consultation must come from when the consultation
  // STARTED, never from when the invoice was opened or paid. The enum value
  // existed since D-083; this is its first writer.
  async arrived(id: string) {
    const { ticket, actor } = await this.authoriseTicket(id, 'START_CONSULTATION');
    // Idempotent: asking again for a state the ticket is already in is a
    // double-click, not an error — and records NO second start.
    if (ticket.status === QueueTicketStatus.IN_CONSULTATION) {
      return this.findById(id);
    }
    // KW2-C2 — a HELD patient taken back through the ordinary "Arrived"
    // action is a RESUMPTION, not a new consultation. Front desk reaches for
    // this button because it is the one they always use, and letting it write
    // a second CONSULTATION_STARTED would claim in the audit that the
    // consultation began twice. One path, one truth.
    if (ticket.heldAt) {
      return this.resume(id);
    }
    assertTransition(ticket.status, QueueTicketStatus.IN_CONSULTATION, 'mark as arrived');
    await withTenantTx(this.rawPrisma, async (tx) => {
      // Re-read inside the transaction so two racing requests cannot both
      // record a start: the loser sees IN_CONSULTATION and writes nothing.
      const fresh = await tx.queueTicket.findUnique({
        where: { id },
        select: { id: true, status: true, visitId: true, clinicId: true },
      });
      if (!fresh) {
        throw new NotFoundException('Queue ticket not found');
      }
      if (fresh.status === QueueTicketStatus.IN_CONSULTATION) {
        return;
      }
      assertTransition(fresh.status, QueueTicketStatus.IN_CONSULTATION, 'mark as arrived');
      await tx.queueTicket.update({
        where: { id },
        data: { status: QueueTicketStatus.IN_CONSULTATION },
      });
      await tx.visitWorkflowEvent.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: fresh.clinicId,
          visitId: fresh.visitId,
          queueTicketId: fresh.id,
          eventType: VisitWorkflowEventType.CONSULTATION_STARTED,
          previousStatus: fresh.status,
          newStatus: QueueTicketStatus.IN_CONSULTATION,
          actorStaffId: actor.id,
          actorNameSnapshot: actor.fullName,
          actorRoleSnapshot: actor.role,
        },
      });
    });
    return this.findById(id);
  }

  // =========================================================================
  // KW2-C2 — HOLD and RESUME.
  //
  // A consultation that has to pause is ordinary GP work: a result is not
  // back, the patient must eat before a fasting test, an emergency walks in.
  // Until now Kuwick offered nothing for it, so staff reached for the two
  // things that were available — cancel and re-register, which loses the
  // visit, or leave the room "occupied" and remember, which loses the
  // patient. Both are worse than a recorded pause.
  //
  // The rule the owner set, and the reason this is a service method rather
  // than a status write: NO SILENT STATE CHANGES. A queue that reorders
  // itself with no attributable cause is the defect. Every crossing in either
  // direction writes an attributed workflow event, and the ticket carries who
  // holds the patient so the board can say it out loud.
  //
  // NOTHING CLINICAL MOVES. The note, the diagnoses, the prescriptions, the
  // orders and the invoice are untouched by both operations — the patient
  // changes place in the queue, not state in the record. That is what makes
  // "resuming returns them with state intact" true rather than aspirational.
  // =========================================================================

  /** IN_CONSULTATION -> WAITING, attributed. */
  async hold(id: string) {
    const { actor } = await this.authoriseTicket(id, 'HOLD_CONSULTATION');

    await withTenantTx(this.rawPrisma, async (tx) => {
      const fresh = await tx.queueTicket.findUnique({
        where: { id },
        select: { id: true, status: true, visitId: true, clinicId: true, heldAt: true },
      });
      if (!fresh) {
        throw new NotFoundException('Queue ticket not found');
      }
      // Already held: a double-click, not an error, and it records no second
      // hold — the first one's actor and time are the ones that are true.
      if (fresh.heldAt) {
        return;
      }
      assertTransition(fresh.status, QueueTicketStatus.WAITING, 'put a consultation on hold');

      // The D-087 atomic claim: the precondition is IN the WHERE clause, so
      // two doctors pressing Hold at once produce exactly one transition and
      // exactly one event. The loser sees count 0 and writes nothing.
      const held = await tx.queueTicket.updateMany({
        where: { id, status: QueueTicketStatus.IN_CONSULTATION, heldAt: null },
        data: {
          status: QueueTicketStatus.WAITING,
          heldAt: new Date(),
          heldByStaffId: actor.id,
        },
      });
      if (held.count === 0) {
        return;
      }

      await tx.visitWorkflowEvent.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: fresh.clinicId,
          visitId: fresh.visitId,
          queueTicketId: fresh.id,
          eventType: VisitWorkflowEventType.CONSULTATION_HELD,
          previousStatus: QueueTicketStatus.IN_CONSULTATION,
          newStatus: QueueTicketStatus.WAITING,
          // The snapshot, not a join: a later promotion or rename must not
          // rewrite who paused this consultation, or in what role.
          actorStaffId: actor.id,
          actorNameSnapshot: actor.fullName,
          actorRoleSnapshot: actor.role,
        },
      });
    });

    return this.findById(id);
  }

  /**
   * WAITING -> IN_CONSULTATION for a HELD ticket, attributed.
   *
   * Records CONSULTATION_RESUMED and deliberately NOT a second
   * CONSULTATION_STARTED: that event's instant is the consultation's start,
   * and the consultation tariff reads it. A patient held at 22:40 and taken
   * back at 23:05 must not acquire a late-night fee for a consultation that
   * began before the band.
   */
  async resume(id: string) {
    const { actor } = await this.authoriseTicket(id, 'START_CONSULTATION');

    await withTenantTx(this.rawPrisma, async (tx) => {
      const fresh = await tx.queueTicket.findUnique({
        where: { id },
        select: { id: true, status: true, visitId: true, clinicId: true, heldAt: true },
      });
      if (!fresh) {
        throw new NotFoundException('Queue ticket not found');
      }
      if (!fresh.heldAt) {
        // Not on hold. Two ways to arrive here and neither is an error: the
        // ticket is already back in consultation, or it was never held. Both
        // want the same answer — nothing to resume, nothing written.
        return;
      }
      assertTransition(fresh.status, QueueTicketStatus.IN_CONSULTATION, 'resume a consultation');

      const resumed = await tx.queueTicket.updateMany({
        where: { id, status: QueueTicketStatus.WAITING, heldAt: { not: null } },
        data: {
          status: QueueTicketStatus.IN_CONSULTATION,
          // Cleared: these two describe the CURRENT hold, and there no longer
          // is one. The pause survives in the events, where history lives.
          heldAt: null,
          heldByStaffId: null,
        },
      });
      if (resumed.count === 0) {
        return;
      }

      await tx.visitWorkflowEvent.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: fresh.clinicId,
          visitId: fresh.visitId,
          queueTicketId: fresh.id,
          eventType: VisitWorkflowEventType.CONSULTATION_RESUMED,
          previousStatus: QueueTicketStatus.WAITING,
          newStatus: QueueTicketStatus.IN_CONSULTATION,
          actorStaffId: actor.id,
          actorNameSnapshot: actor.fullName,
          actorRoleSnapshot: actor.role,
        },
      });
    });

    return this.findById(id);
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
    // G4.5d3c-2b (D-087) — THIS WAS A BYPASS, and closing it is the point.
    //
    // S3 made this route atomic and authorised, which was the problem it had
    // then. What it still did was set `Visit.checkOutAt` after checking one
    // thing: that the ticket was in DISPENSARY_PAYMENT. It would happily
    // close a visit with medication still undispensed, a bill nobody had
    // raised, or a doctor phase that never happened — every rule
    // VisitCompletionService enforces, walked straight past.
    //
    // Two implementations of "finish the visit" is how they drift, so this one
    // no longer has an implementation. It resolves the visit and delegates.
    // The legacy route keeps working; the unsafe path underneath it does not.
    const { ticket } = await this.authoriseTicket(id, 'COMPLETE_TICKET');
    await this.visitCompletion.completeVisit(ticket.visitId);
    return this.findById(id);
  }

  /**
   * S3G — cancellation. The ticket row is RETAINED and the reason kept; the
   * visit, its prescriptions, orders, documents, invoices and stock movements
   * are all untouched. A terminal ticket cannot be cancelled.
   */
  async cancel(id: string, dto: CancelQueueTicketDto) {
    const { ticket } = await this.authoriseTicket(id, 'CANCEL_TICKET');

    await withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);

      // Re-read inside the transaction: the status decides both whether this
      // is legal and what the event records as the previous state.
      const fresh = await tx.queueTicket.findUnique({
        where: { id },
        select: { id: true, status: true, visitId: true },
      });
      if (!fresh) {
        throw new NotFoundException('Queue ticket not found');
      }
      // Idempotent: a repeat writes nothing and, critically, records NO
      // second cancellation. Two cancellation events for one cancellation
      // would be a false history, which is worse than none.
      if (fresh.status === QueueTicketStatus.CANCELLED) {
        return;
      }
      if (fresh.status === QueueTicketStatus.COMPLETED) {
        throw new BadRequestException(`Cannot cancel a queue ticket in status ${fresh.status}`);
      }

      await tx.queueTicket.update({
        where: { id },
        data: { status: QueueTicketStatus.CANCELLED, cancelReason: dto.cancelReason },
      });

      // G4.5d3c-1c (D-085) — the cancellation audit S3 could not write.
      //
      // QueueTicket stores `cancelReason` and nothing else: no actor, no
      // timestamp. Rather than add two columns that only this one action
      // uses, the approved immutable event carries it — and, being
      // append-only at the database level (D-083), it cannot later be edited
      // to say someone else cancelled the visit.
      //
      // Same transaction as the status change: an unrecorded cancellation and
      // a recorded one that did not happen are both wrong.
      await tx.visitWorkflowEvent.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: ticket.clinicId,
          visitId: fresh.visitId,
          queueTicketId: fresh.id,
          eventType: VisitWorkflowEventType.VISIT_CANCELLED,
          previousStatus: fresh.status,
          newStatus: QueueTicketStatus.CANCELLED,
          actorStaffId: actor.id,
          actorNameSnapshot: actor.fullName,
          actorRoleSnapshot: actor.role,
          reason: dto.cancelReason ?? null,
          correlationId: dto.correlationId ?? null,
        },
      });

      // Nothing else is touched. The visit, its prescriptions, orders,
      // documents, invoices and stock movements all survive a cancelled
      // ticket — a patient who left is not a patient who was never here.
    });

    return this.findById(id);
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
