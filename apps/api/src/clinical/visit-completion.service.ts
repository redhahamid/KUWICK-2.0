import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ClinicalNoteStatus,
  InvoiceStatus,
  OrderServiceStatus,
  PrescriptionStatus,
  PrescriptionSupplyMode,
  QueueTicketStatus,
  Staff,
  VisitWorkflowEventType,
} from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { attachedRoles, can } from '../core/permissions';
import { currentTenantId } from '../core/tenant-context';
import { ClinicalTx, assertMayTouchVisit, requireActor, withTenantTx } from './clinical-actor';
import { collectBillingWorklist, tariffReviewItems, unbilledReadyItems } from './billing-worklist';
import { CompleteVisitDto } from './dto/complete-visit.dto';

/**
 * Structured blockers. The CODE is for the UI to branch on; the MESSAGE is
 * shown to clinic staff and therefore says what to do, never what the schema
 * is called. No enum name, table name, constraint or driver text reaches a
 * user through this path.
 */
export type VisitCompletionBlockerCode =
  | 'DOCTOR_PHASE_NOT_COMPLETED'
  // G4.5d6 — CLINICAL_DOCUMENTATION_PENDING is gone. Completion finalizes the
  // open note rather than waiting for it, so there is no state in which the
  // system asks anyone to go and sign before a visit can close.
  | 'PROCEDURE_PENDING'
  | 'MEDICATION_SUPPLY_UNCONFIRMED'
  | 'MEDICATION_SUPPLY_DEFERRED'
  | 'DISPENSING_PENDING'
  | 'BILLING_REVIEW_REQUIRED'
  | 'PATIENT_BALANCE_REMAINING'
  | 'UNBILLED_CHARGEABLE_ITEMS'
  | 'CONSULTATION_TARIFF_REVIEW_REQUIRED'
  | 'QUEUE_STATE_INELIGIBLE';

export interface VisitCompletionBlocker {
  code: VisitCompletionBlockerCode;
  message: string;
}

export interface VisitCompletionResult {
  visitId: string;
  checkOutAt: Date;
  queueStatus: QueueTicketStatus;
  completedByStaffId: string;
  alreadyCompleted: boolean;
}

const MESSAGES: Record<VisitCompletionBlockerCode, string> = {
  DOCTOR_PHASE_NOT_COMPLETED: 'The doctor consultation phase has not been completed.',
  PROCEDURE_PENDING: 'A procedure is still pending or in progress.',
  MEDICATION_SUPPLY_UNCONFIRMED: 'Medication supply mode must be confirmed.',
  MEDICATION_SUPPLY_DEFERRED: 'Deferred medication supply must be resolved.',
  DISPENSING_PENDING: 'Medication dispensing is not complete.',
  BILLING_REVIEW_REQUIRED: 'Billing responsibility has not been confirmed.',
  PATIENT_BALANCE_REMAINING: 'Patient payment is still outstanding.',
  UNBILLED_CHARGEABLE_ITEMS: 'Billing contains items that have not been invoiced.',
  CONSULTATION_TARIFF_REVIEW_REQUIRED: 'Consultation tariff requires review.',
  QUEUE_STATE_INELIGIBLE: 'This visit is not at a stage where it can be completed.',
};

/**
 * G4.5d3c-2b (D-087) — who may declare a visit finished.
 *
 * Operational, not clinical. Closing the visit asserts that dispensing and
 * billing are done, which is counter work — the same reasoning that put
 * COMPLETE_TICKET and MARK_PAID with the counter in D-066 and D-079. A doctor
 * does not acquire it by being a doctor; they finish the CONSULTATION, which
 * is a different operation with a different permission.
 *
 * TASK 1 — the role list is gone; `queue.manage` is the counter's
 * administration of the day's list and closing a visit is exactly that. A
 * legacy FINANCE_STAFF account loses this, which is the intentional narrowing
 * recorded with the migration: finance corrects money, the counter closes
 * visits.
 */
export function mayCompleteVisit(actor: Staff): boolean {
  return can(actor, 'queue.manage', attachedRoles(actor));
}

/** Queue states from which a visit may legitimately be closed. */
const COMPLETABLE_FROM: QueueTicketStatus[] = [
  QueueTicketStatus.READY_FOR_DISPENSARY,
  QueueTicketStatus.READY_FOR_PAYMENT,
  // Legacy rows that never split dispensing from payment.
  QueueTicketStatus.DISPENSARY_PAYMENT,
  // Destination NONE leaves the ticket here: the doctor finished and nothing
  // downstream was required.
  QueueTicketStatus.IN_CONSULTATION,
];

/**
 * G4.5d3c-2b (D-087) — the explicit act of closing a visit.
 *
 * This is the ONLY operation that sets `Visit.checkOutAt`. Doctor-phase
 * completion deliberately does not, and neither does paying an invoice,
 * signing a note or printing a label.
 *
 * Everything is re-resolved from stored data inside the transaction. A caller
 * cannot assert that dispensing is finished or that the bill is settled — the
 * service looks.
 */
@Injectable()
export class VisitCompletionService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** The blockers standing between this visit and completion, if any. */
  async blockers(visitId: string): Promise<VisitCompletionBlocker[]> {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      await assertMayTouchVisit(tx, visitId, actor);
      const visit = await tx.visit.findUnique({
        where: { id: visitId },
        select: { id: true, doctorCompletedAt: true },
      });
      if (!visit) {
        throw new NotFoundException('Visit not found');
      }
      const ticket = await tx.queueTicket.findUnique({ where: { visitId }, select: { status: true } });
      return collectBlockers(tx, visitId, visit.doctorCompletedAt, ticket?.status ?? null);
    });
  }

  async completeVisit(visitId: string, dto: CompleteVisitDto = {}): Promise<VisitCompletionResult> {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertMayCompleteVisit(actor);
      await assertMayTouchVisit(tx, visitId, actor);

      const visit = await tx.visit.findUnique({
        where: { id: visitId },
        select: { id: true, clinicId: true, checkOutAt: true, doctorCompletedAt: true },
      });
      if (!visit) {
        throw new NotFoundException('Visit not found');
      }

      const ticket = await tx.queueTicket.findUnique({
        where: { visitId },
        select: { id: true, status: true },
      });

      // Idempotent: a closed visit reports its ORIGINAL checkOutAt. Rewriting
      // it would move the clinic's record of when the patient left.
      if (visit.checkOutAt) {
        return {
          visitId,
          checkOutAt: visit.checkOutAt,
          queueStatus: ticket?.status ?? QueueTicketStatus.COMPLETED,
          completedByStaffId: actor.id,
          alreadyCompleted: true,
        };
      }

      if (ticket?.status === QueueTicketStatus.CANCELLED) {
        throw new BadRequestException('This visit was cancelled and cannot be completed.');
      }

      const blocking = await collectBlockers(tx, visitId, visit.doctorCompletedAt, ticket?.status ?? null);
      if (blocking.length > 0) {
        // The first blocker is the message; all of them travel in the payload
        // so a screen can list everything outstanding in one pass instead of
        // making staff fix them one refresh at a time.
        throw new BadRequestException({
          message: blocking[0].message,
          error: 'Bad Request',
          statusCode: 400,
          blockers: blocking,
        });
      }

      const checkOutAt = new Date();

      // Same atomic-claim pattern as doctor-phase completion: the precondition
      // lives in the WHERE clause, so two concurrent requests cannot both
      // close the visit. Exactly one sees count 1.
      const claim = await tx.visit.updateMany({
        where: { id: visitId, checkOutAt: null },
        data: { checkOutAt },
      });
      if (claim.count === 0) {
        const winner = await tx.visit.findUnique({ where: { id: visitId }, select: { checkOutAt: true } });
        const fresh = await tx.queueTicket.findUnique({ where: { visitId }, select: { status: true } });
        return {
          visitId,
          checkOutAt: winner?.checkOutAt ?? checkOutAt,
          queueStatus: fresh?.status ?? QueueTicketStatus.COMPLETED,
          completedByStaffId: actor.id,
          alreadyCompleted: true,
        };
      }

      if (ticket) {
        await tx.queueTicket.update({
          where: { id: ticket.id },
          data: { status: QueueTicketStatus.COMPLETED },
        });
      }

      // G4.5d6 — the documentation is finalized HERE, inside the same
      // transaction that closed the visit. Either both happened or neither
      // did; a completed visit with a still-editable note is exactly the gap
      // that would make this change a weakening rather than a relocation.
      const finalized = await finalizeVisitDocumentation(tx, visitId, actor, checkOutAt);

      await tx.visitWorkflowEvent.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: visit.clinicId,
          visitId,
          queueTicketId: ticket?.id ?? null,
          eventType: VisitWorkflowEventType.VISIT_COMPLETED,
          previousStatus: ticket?.status ?? null,
          newStatus: ticket ? QueueTicketStatus.COMPLETED : null,
          actorStaffId: actor.id,
          actorNameSnapshot: actor.fullName,
          actorRoleSnapshot: actor.role,
          reason: dto.note?.trim() || null,
          correlationId: dto.correlationId ?? null,
          metadata: finalized.length > 0 ? { finalizedNoteIds: finalized } : undefined,
        },
      });

      return {
        visitId,
        checkOutAt,
        queueStatus: QueueTicketStatus.COMPLETED,
        completedByStaffId: actor.id,
        alreadyCompleted: false,
      };
    });
  }
}

function assertMayCompleteVisit(actor: Staff): void {
  if (!mayCompleteVisit(actor)) {
    throw new ForbiddenException('Your account is not permitted to complete a visit.');
  }
}

/**
 * Everything still standing between this visit and the door.
 *
 * Deliberately collects ALL of them rather than throwing on the first: a
 * counter clerk fixing four problems one refresh at a time is how a queue
 * backs up.
 */
/**
 * Exported for the queue board (D-095), which needs the SAME answer for every
 * visit on screen. Exported rather than reimplemented: two places deciding
 * whether a visit may close is exactly how a screen ends up offering a button
 * the server will refuse.
 */
/**
 * G4.5d6 — lock this visit's open clinical documentation, immutably.
 *
 * Runs inside the completion transaction. Every DRAFT clinical note on the
 * visit becomes SIGNED and gains a finalization stamp, after which the note
 * service refuses to edit it and the only route to a change is an Amendment
 * carrying a reason and an actor.
 *
 * WHOSE NOTE IT REMAINS. The signer snapshots are the AUTHOR's, not the
 * completer's: the words are the clinician's and attributing them to whoever
 * happened to close the visit at the counter would be a falsification. Who
 * finalized it is recorded separately, in `finalizedByStaffId`, alongside the
 * mode — so the record can always say "the doctor wrote this, the system
 * locked it when the front desk closed the visit", which is the truth.
 *
 * A note with no author cannot be finalized this way and is left as a DRAFT:
 * the signature-state constraint requires a full signer identity, and
 * inventing one to satisfy it would be the same falsification by another
 * route. Those are surfaced as unattributed drafts rather than silently
 * closed.
 */
async function finalizeVisitDocumentation(
  tx: ClinicalTx,
  visitId: string,
  actor: Staff,
  finalizedAt: Date,
): Promise<string[]> {
  const drafts = await tx.clinicalNote.findMany({
    where: { visitId, status: ClinicalNoteStatus.DRAFT },
    select: {
      id: true,
      authorStaffId: true,
      authorNameSnapshot: true,
      authorRoleSnapshot: true,
    },
  });

  const finalizedIds: string[] = [];
  for (const draft of drafts) {
    if (!draft.authorStaffId || !draft.authorNameSnapshot || !draft.authorRoleSnapshot) {
      // Cannot be finalized honestly — see the note above.
      continue;
    }
    // Atomic claim on the note too: a concurrent amendment or a second
    // completion cannot finalize the same draft twice.
    const claim = await tx.clinicalNote.updateMany({
      where: { id: draft.id, status: ClinicalNoteStatus.DRAFT },
      data: {
        status: ClinicalNoteStatus.SIGNED,
        signedAt: finalizedAt,
        signedByStaffId: draft.authorStaffId,
        signerNameSnapshot: draft.authorNameSnapshot,
        signerRoleSnapshot: draft.authorRoleSnapshot,
        finalizedAt,
        finalizedByStaffId: actor.id,
        finalizationMode: 'AUTO_ON_VISIT_COMPLETION',
      },
    });
    if (claim.count === 1) finalizedIds.push(draft.id);
  }
  return finalizedIds;
}

export async function collectBlockers(
  tx: ClinicalTx,
  visitId: string,
  doctorCompletedAt: Date | null,
  queueStatus: QueueTicketStatus | null,
): Promise<VisitCompletionBlocker[]> {
  const blockers: VisitCompletionBlocker[] = [];
  const add = (code: VisitCompletionBlockerCode) => blockers.push({ code, message: MESSAGES[code] });

  if (!doctorCompletedAt) {
    add('DOCTOR_PHASE_NOT_COMPLETED');
  }
  if (queueStatus !== null && !COMPLETABLE_FROM.includes(queueStatus)) {
    // WAITING, AT_PROCEDURE, CANCELLED and COMPLETED all land here.
    add('QUEUE_STATE_INELIGIBLE');
  }

  // G4.5d3c-3c — the clinical note must still be signed. It just stopped
  // holding the PATIENT.
  //
  // Until now an unsigned note refused doctor-phase completion, which meant a
  // patient with a prescription in hand waited in the consultation room until
  // the prose was finished. That requirement now lives here, where it holds
  // the PAPERWORK instead: the patient goes to the dispensary and the counter
  // as soon as their clinical work is done, and the visit stays operationally
  // open until the record is complete.
  //
  // G4.5d6 — DOCUMENTATION NO LONGER BLOCKS COMPLETION.
  //
  // It used to. The effect in a clinic running 100-200 patients a day was that
  // a paid-up patient stood at the counter while somebody went to find a
  // doctor to press "Sign" — a queue defect dressed as a clinical control,
  // and one that encouraged end-of-session batch signing from memory, which
  // is worse documentation than what it was protecting.
  //
  // The record is protected better, not less: the note is finalized
  // automatically and immutably by `finalizeVisitDocumentation` below at the
  // moment the visit closes, carrying its author, its created timestamp and
  // its finalized timestamp, after which it can only change through an
  // Amendment with a reason and an actor. Nothing is lost except the waiting.

  const openProcedures = await tx.orderService.count({
    where: { visitId, status: { in: [OrderServiceStatus.PENDING, OrderServiceStatus.IN_PROGRESS] } },
  });
  if (openProcedures > 0) {
    add('PROCEDURE_PENDING');
  }

  const active = await tx.prescription.findMany({
    where: { visitId, deletedAt: null, status: { not: PrescriptionStatus.CANCELLED } },
    select: { supplyMode: true, status: true },
  });
  if (active.some((p) => p.supplyMode === null)) {
    add('MEDICATION_SUPPLY_UNCONFIRMED');
  }
  if (active.some((p) => p.supplyMode === PrescriptionSupplyMode.DEFERRED)) {
    add('MEDICATION_SUPPLY_DEFERRED');
  }
  if (
    active.some(
      (p) =>
        p.supplyMode === PrescriptionSupplyMode.ONSITE_DISPENSE &&
        p.status === PrescriptionStatus.ORDERED,
    )
  ) {
    add('DISPENSING_PENDING');
  }

  // G4.5d3c-3b1 (D-093) — unbilled detection is SOURCE-AWARE and no longer
  // silenced by the existence of an invoice: the worklist knows exactly which
  // chargeable items no active line bills, whatever else has been invoiced.
  // Supply modes that are never clinic charges (external, own supply, none)
  // do not count; unresolved modes are the medication blockers' business.
  const worklist = await collectBillingWorklist(tx, visitId);
  if (unbilledReadyItems(worklist).length > 0) {
    add('UNBILLED_CHARGEABLE_ITEMS');
  }
  // G4.5d3c-3b2 (D-094) — the tariff is configured but cannot resolve this
  // visit (no band covers the consultation time, or the selected service is
  // inactive). A human must look before the visit can settle.
  if (tariffReviewItems(worklist).length > 0) {
    add('CONSULTATION_TARIFF_REVIEW_REQUIRED');
  }

  const invoices = await tx.invoice.findMany({
    where: { visitId, status: { not: InvoiceStatus.CANCELLED } },
    select: { patientResponsibilityAmount: true, patientPaidAmount: true },
  });
  if (invoices.some((i) => i.patientResponsibilityAmount === null)) {
    // D-093's writer resolves this for every new invoice; a NULL now means a
    // legacy invoice or an unresolved panel — both genuinely Billing Review.
    add('BILLING_REVIEW_REQUIRED');
  } else if (invoices.length > 0) {
    const remaining = invoices.reduce(
      (sum, i) =>
        sum + Math.max(Number(i.patientResponsibilityAmount) - Number(i.patientPaidAmount), 0),
      0,
    );
    if (remaining >= 0.005) {
      add('PATIENT_BALANCE_REMAINING');
    }
  }

  // Documents deliberately do NOT appear here. Kuwick has no concept of a
  // document being REQUIRED for a visit, so every optional draft would block
  // every completion — an MC the patient decided not to take would trap the
  // visit open forever. Reported as a limitation rather than invented.

  return blockers;
}
