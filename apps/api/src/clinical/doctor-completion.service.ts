import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ClinicalNoteStatus,
  ClinicalNoteType,
  DoctorCompletionDestination,
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
import { currentTenantId } from '../core/tenant-context';
import {
  ClinicalTx,
  assertMayTouchVisit,
  requireActor,
  requireClinicalAuthor,
  withReadOnlyTenantTx,
  withTenantTx,
} from './clinical-actor';
import { isEligibleAttendingDoctor } from './queue-authorization';
import { CompleteDoctorPhaseDto } from './dto/complete-doctor-phase.dto';
import { collectBillingWorklist, pendingBillingWork, tariffReviewItems } from './billing-worklist';
import { isDocumentationPending, readDocumentationPending } from './clinical-documentation';

/**
 * Why the patient is going where they are going. Returned so the caller can
 * say something true rather than inferring from the destination — DISPENSARY
 * and PAYMENT each have more than one cause.
 */
export type DestinationReason =
  | 'DISPENSARY_REQUIRED'
  | 'PATIENT_PAYMENT_REQUIRED'
  | 'BILLING_REVIEW_REQUIRED'
  | 'NO_DOWNSTREAM_WORK';

/**
 * G4.5d3c-2c (D-088) — what stands between this consultation and being
 * finished. The CODE is what a screen branches on; the MESSAGE is what clinic
 * staff read, so it says what to do and never names a table, column, enum
 * value or constraint.
 *
 * Billing is deliberately absent from this list. An unraised invoice or an
 * unpaid balance changes where the patient goes NEXT — it has never stopped a
 * doctor finishing a consultation, and turning a billing state into a clinical
 * blocker would let a slow front desk hold a clinician at their desk.
 */
export type DoctorPhaseBlockerCode =
  | 'QUEUE_STATE_INELIGIBLE'
  | 'PROCEDURE_PENDING'
  | 'MEDICATION_SUPPLY_UNCONFIRMED'
  | 'MEDICATION_SUPPLY_DEFERRED';

export interface DoctorPhaseBlocker {
  code: DoctorPhaseBlockerCode;
  message: string;
}

/**
 * The order blockers are reported in, fixed here rather than emerging from
 * whichever query resolved first. A screen that lists them, a test that pins
 * them and the message chosen for a rejected write all read the same sequence
 * on every call: queue state, then the record, then the work, then the
 * medicine.
 */
const BLOCKER_MESSAGES: Record<DoctorPhaseBlockerCode, string> = {
  QUEUE_STATE_INELIGIBLE: 'The consultation can only be completed while the patient is in consultation.',
  PROCEDURE_PENDING:
    'A procedure or investigation is still open. Complete or cancel it before completing the consultation.',
  MEDICATION_SUPPLY_UNCONFIRMED:
    'Medication has no supply mode recorded. Set how it is supplied before completing consultation.',
  MEDICATION_SUPPLY_DEFERRED:
    'Medication supply is deferred and unresolved. Resolve the supply mode before completing consultation.',
};

/** One evaluation of a doctor phase that has not been completed yet. */
export interface DoctorPhaseEvaluation {
  blockers: DoctorPhaseBlocker[];
  /** NULL when the visit is not in a state where routing can be answered. */
  destination: DoctorCompletionDestination | null;
  routingReason: DestinationReason | null;
  /**
   * G4.5d3c-3c — the DOCUMENTATION PENDING state.
   *
   * True when no signed doctor narrative exists for this visit. It is a
   * FACT about the record, reported alongside the blockers and deliberately
   * not among them: see `evaluateDoctorPhase` for why an unsigned note no
   * longer holds a patient in the consultation room.
   *
   * Derived, not stored. There is no column for it and there does not need to
   * be — it is the same count the blocker used to be built from, and deriving
   * it means it can never disagree with the notes themselves. What IS stored
   * is the answer AT THE MOMENT OF COMPLETION, on the workflow event, because
   * that one is a historical fact and re-deriving it later would silently
   * rewrite itself the instant the doctor went back and signed.
   */
  documentationPending: boolean;

  /**
   * KW2-C2 — medications carried over from a previous visit that nobody has
   * re-read yet.
   *
   * Reported, never a blocker. Copying is a new prescribing decision made
   * from old information — the weight, the allergies and the stock have all
   * had time to change — so completing with one unreviewed is a real clinical
   * choice, and the UI asks before it happens. Refusing outright would only
   * teach people to tick "reviewed" without reading.
   *
   * Names travel with the count because "2 unreviewed" is not something a
   * doctor can act on; "Syr PCM, Bromhexine" is.
   */
  unreviewedCopiedMedications: string[];
}

/**
 * Carried-over medications on a visit that nobody has re-read yet, by name.
 *
 * Shared by the live evaluation and the already-completed branch so the two
 * can never disagree about what is outstanding.
 */
async function unreviewedCopiedNames(tx: ClinicalTx, visitId: string): Promise<string[]> {
  const rows = await tx.prescription.findMany({
    where: {
      visitId,
      deletedAt: null,
      reviewFlag: true,
      status: { not: PrescriptionStatus.CANCELLED },
    },
    select: { item: { select: { name: true } } },
  });
  return rows.map((row) => row.item?.name).filter((name): name is string => Boolean(name));
}

export interface DoctorPhaseStatus extends DoctorPhaseEvaluation {
  visitId: string;
  completed: boolean;
  doctorCompletedAt: Date | null;
  doctorCompletedByStaffId: string | null;
  queueStatus: QueueTicketStatus | null;
  /**
   * Whether documentation was pending when the phase was completed, read from
   * the recorded workflow event. NULL for a phase that is not complete, and
   * for one completed before this was recorded — which is reported honestly
   * rather than guessed at from today's notes.
   */
  documentationPendingAtCompletion: boolean | null;
  /** Who sent the patient on with documentation pending, and when. */
  documentationPendingActorName: string | null;
  documentationPendingAt: Date | null;
}

export interface DoctorCompletionResult {
  visitId: string;
  destination: DoctorCompletionDestination;
  /** NULL only for visits completed before D-087 recorded it. */
  reason: DestinationReason | null;
  queueStatus: QueueTicketStatus;
  doctorCompletedAt: Date;
  doctorCompletedByStaffId: string;
  /** True when this call did nothing because the phase was already complete. */
  alreadyCompleted: boolean;
}

const QUEUE_STATUS_FOR: Record<DoctorCompletionDestination, QueueTicketStatus | null> = {
  [DoctorCompletionDestination.DISPENSARY]: QueueTicketStatus.READY_FOR_DISPENSARY,
  [DoctorCompletionDestination.PAYMENT]: QueueTicketStatus.READY_FOR_PAYMENT,
  // NONE leaves the ticket in consultation: the doctor has finished, but
  // closing the VISIT is a separate, explicit act (see checkOutAt below).
  [DoctorCompletionDestination.NONE]: null,
};

/**
 * G4.5d3c-2 (D-086) — the doctor finishes their part, and the server decides
 * where the patient goes next.
 *
 * The destination is DERIVED from stored data, never accepted from the
 * browser. Two rules in particular exist because the obvious shortcut is
 * wrong:
 *
 *   "a Prescription exists"    does NOT mean dispensing is required
 *   "an Invoice is UNPAID"     does NOT mean the patient owes anything
 *
 * A fully panel-covered invoice is UNPAID with nothing for the patient to pay;
 * an external prescription needs no dispensary. Both were guessable before
 * D-084 gave the model the fields to answer honestly, and where those fields
 * are NULL this service reports UNDETERMINED rather than guessing.
 *
 * G4.5d3c-2c (D-088) adds the read. `doctorPhaseStatus` and
 * `completeDoctorPhase` share ONE evaluator: a screen that asks what is
 * outstanding and a write that refuses for the same reason must never be able
 * to disagree, and two implementations of "can this consultation finish" is
 * how they would. The write still runs the evaluator itself, inside its own
 * transaction — a preview taken seconds earlier is evidence about the past.
 *
 * NOT built here: the Canvas footer, any queue screen, and the overall visit
 * completion step. This service never sets `Visit.checkOutAt`.
 */
@Injectable()
export class DoctorCompletionService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * What is outstanding, and where the patient would go — without changing
   * anything. The transaction is read-only at the database level, so this is
   * a property the server enforces rather than a claim this comment makes.
   *
   * Readable by any active staff member with access to the visit's branch,
   * matching the visit-completion blocker read: the payload is workflow state
   * — queue stage, whether a note is signed, whether medicine is outstanding —
   * and carries no clinical content. A visit outside the caller's tenant does
   * not exist as far as this endpoint is concerned.
   */
  async doctorPhaseStatus(visitId: string): Promise<DoctorPhaseStatus> {
    return withReadOnlyTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      await assertMayTouchVisit(tx, visitId, actor);

      const visit = await tx.visit.findUnique({
        where: { id: visitId },
        select: {
          id: true,
          clinicId: true,
          checkOutAt: true,
          doctorCompletedAt: true,
          doctorCompletedByStaffId: true,
          doctorCompletedDestination: true,
          doctorCompletedRoutingReason: true,
        },
      });
      if (!visit) {
        throw new NotFoundException('Visit not found');
      }

      const ticket = await tx.queueTicket.findUnique({ where: { visitId }, select: { status: true } });
      const queueStatus = ticket?.status ?? null;

      // A completed phase reports what was RECORDED. Re-deriving it here would
      // reintroduce, on every screen refresh, exactly the defect D-087's
      // stored reason exists to prevent: prescriptions get dispensed and bills
      // get paid afterwards, so a re-derivation an hour later describes a
      // patient who has already moved on. A visit completed before that column
      // existed reads NULL — not captured, never NO_DOWNSTREAM_WORK.
      if (visit.doctorCompletedAt) {
        // G4.5d3c-3c — what was recorded at completion, from the append-only
        // workflow event. Not re-derived: a doctor who wrote the note an hour
        // later would otherwise erase the fact that the patient was sent on
        // without one, and that is exactly the fact this state exists to keep.
        const completionEvent = await tx.visitWorkflowEvent.findFirst({
          where: { visitId, eventType: VisitWorkflowEventType.DOCTOR_PHASE_COMPLETED },
          orderBy: { createdAt: 'asc' },
          select: { metadata: true, actorNameSnapshot: true, createdAt: true },
        });
        const recorded = readDocumentationPending(completionEvent?.metadata);
        return {
          visitId: visit.id,
          completed: true,
          doctorCompletedAt: visit.doctorCompletedAt,
          doctorCompletedByStaffId: visit.doctorCompletedByStaffId ?? null,
          destination: visit.doctorCompletedDestination ?? null,
          routingReason: (visit.doctorCompletedRoutingReason as DestinationReason | null) ?? null,
          queueStatus,
          blockers: [],
          // The LIVE answer stays available too: a counter deciding whether
          // the visit can be closed needs to know whether the note has been
          // signed SINCE, not only whether it was signed then.
          documentationPending: await isDocumentationPending(tx, visitId),
          unreviewedCopiedMedications: await unreviewedCopiedNames(tx, visitId),
          documentationPendingAtCompletion: recorded,
          documentationPendingActorName: recorded ? (completionEvent?.actorNameSnapshot ?? null) : null,
          documentationPendingAt: recorded ? (completionEvent?.createdAt ?? null) : null,
        };
      }

      const evaluation = await evaluateDoctorPhase(tx, visitId, queueStatus);
      return {
        visitId: visit.id,
        completed: false,
        doctorCompletedAt: null,
        doctorCompletedByStaffId: null,
        queueStatus,
        documentationPendingAtCompletion: null,
        documentationPendingActorName: null,
        documentationPendingAt: null,
        ...evaluation,
      };
    });
  }

  async completeDoctorPhase(
    visitId: string,
    dto: CompleteDoctorPhaseDto = {},
  ): Promise<DoctorCompletionResult> {
    return withTenantTx(this.rawPrisma, async (tx) => {
      // Completing the doctor phase IS a clinical act, so the actor must be
      // entitled to author clinical work (D-085) — front desk, finance and
      // stock accounts are refused here, not merely hidden from a button.
      const actor = await requireClinicalAuthor(tx, 'complete a doctor consultation');
      await assertMayTouchVisit(tx, visitId, actor);

      const visit = await tx.visit.findUnique({
        where: { id: visitId },
        select: {
          id: true,
          clinicId: true,
          staffId: true,
          checkOutAt: true,
          doctorCompletedAt: true,
          doctorCompletedByStaffId: true,
          doctorCompletedDestination: true,
          doctorCompletedRoutingReason: true,
        },
      });
      if (!visit) {
        throw new NotFoundException('Visit not found');
      }

      const ticket = await tx.queueTicket.findUnique({
        where: { visitId },
        select: { id: true, status: true },
      });

      // --- Idempotency ----------------------------------------------------
      // A repeat returns what was recorded. It must NOT re-derive the
      // destination: prescriptions and invoices move on afterwards, and a
      // second call an hour later would otherwise "correct" a completed
      // consultation to somewhere the patient has already been.
      if (visit.doctorCompletedAt) {
        return {
          visitId: visit.id,
          destination: visit.doctorCompletedDestination ?? DoctorCompletionDestination.NONE,
          // D-087 — the STORED reason, not a re-derivation. READY_FOR_PAYMENT
          // has two meanings and the destination alone cannot say which.
          // A visit completed before that column existed reads NULL, which is
          // reported honestly rather than guessed at.
          reason: (visit.doctorCompletedRoutingReason as DestinationReason | null) ?? null,
          queueStatus: ticket?.status ?? QueueTicketStatus.COMPLETED,
          doctorCompletedAt: visit.doctorCompletedAt,
          doctorCompletedByStaffId: visit.doctorCompletedByStaffId ?? actor.id,
          alreadyCompleted: true,
        };
      }

      assertMayCompleteThisVisit(actor, visit.staffId);

      if (visit.checkOutAt) {
        throw new BadRequestException('This visit is already closed.');
      }

      // Re-evaluated HERE, inside the transaction, against the ticket status
      // read inside the same transaction. Whatever a preview said, a racing
      // request that moved the ticket or signed the note is visible to this
      // evaluation and not to that one.
      const evaluation = await evaluateDoctorPhase(tx, visitId, ticket?.status ?? null);
      if (evaluation.blockers.length > 0) {
        // The first blocker is the message; all of them travel in the payload
        // so a doctor can see everything outstanding in one pass instead of
        // clearing them one refresh at a time.
        throw new BadRequestException({
          message: evaluation.blockers[0].message,
          error: 'Bad Request',
          statusCode: 400,
          blockers: evaluation.blockers,
        });
      }

      const { destination, routingReason: reason } = evaluation;
      if (!ticket || destination === null || reason === null) {
        // Unreachable: a missing ticket and a pending procedure are both
        // blockers, and nothing else withholds a destination. Kept so the
        // types narrow on a real check rather than a non-null assertion —
        // if a future blocker suppresses routing, this refuses rather than
        // writing a destination nobody derived.
        throw new BadRequestException(BLOCKER_MESSAGES.QUEUE_STATE_INELIGIBLE);
      }

      const completedAt = new Date();

      // --- Concurrency: the atomic claim ----------------------------------
      //
      // The earlier version re-read the visit inside the transaction and
      // trusted what it saw. Under READ COMMITTED that is not enough: two
      // requests can both read doctorCompletedAt as NULL, both pass, and both
      // write — producing two DOCTOR_PHASE_COMPLETED events and, worse, two
      // queue transitions.
      //
      // `updateMany` with the precondition IN THE WHERE CLAUSE turns the
      // check and the write into one atomic statement. The row is locked by
      // the first writer; the second blocks, re-evaluates the predicate after
      // the first commits, matches nothing, and gets count 0. Exactly one
      // request can ever see count 1, whatever their idempotency keys.
      const claim = await tx.visit.updateMany({
        where: { id: visitId, doctorCompletedAt: null },
        data: {
          doctorCompletedAt: completedAt,
          doctorCompletedByStaffId: actor.id,
          doctorCompletedDestination: destination,
          doctorCompletedRoutingReason: reason,
          // checkOutAt is NOT set here, in ANY branch. Closing the visit is
          // VisitCompletionService's job.
        },
      });

      if (claim.count === 0) {
        // Another request won while this one was evaluating. Report what THEY
        // committed rather than failing: the caller asked for the phase to be
        // complete, and it is.
        const winner = await tx.visit.findUnique({
          where: { id: visitId },
          select: {
            doctorCompletedAt: true,
            doctorCompletedByStaffId: true,
            doctorCompletedDestination: true,
            doctorCompletedRoutingReason: true,
          },
        });
        const fresh = await tx.queueTicket.findUnique({
          where: { visitId },
          select: { status: true },
        });
        return {
          visitId,
          destination: winner?.doctorCompletedDestination ?? DoctorCompletionDestination.NONE,
          reason: (winner?.doctorCompletedRoutingReason as DestinationReason) ?? 'NO_DOWNSTREAM_WORK',
          queueStatus: fresh?.status ?? ticket.status,
          doctorCompletedAt: winner?.doctorCompletedAt ?? completedAt,
          doctorCompletedByStaffId: winner?.doctorCompletedByStaffId ?? actor.id,
          alreadyCompleted: true,
        };
      }

      const nextQueueStatus = QUEUE_STATUS_FOR[destination];
      if (nextQueueStatus) {
        await tx.queueTicket.update({ where: { id: ticket.id }, data: { status: nextQueueStatus } });
      }

      await tx.visitWorkflowEvent.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: visit.clinicId,
          visitId,
          queueTicketId: ticket.id,
          eventType: VisitWorkflowEventType.DOCTOR_PHASE_COMPLETED,
          previousStatus: ticket.status,
          newStatus: nextQueueStatus ?? ticket.status,
          destination,
          // G4.5d3c-3c — the actor and the timestamp for a patient sent on
          // with documentation pending are THESE. The append-only event
          // already carries who and when; the metadata says what was true of
          // the record at that moment.
          actorStaffId: actor.id,
          actorNameSnapshot: actor.fullName,
          actorRoleSnapshot: actor.role,
          reason: dto.note?.trim() || null,
          metadata: {
            destinationReason: reason,
            // Recorded, never re-derived. Signing the note afterwards must not
            // retroactively make it look as though it was signed at the time.
            documentationPending: evaluation.documentationPending,
          },
          correlationId: dto.correlationId ?? null,
        },
      });

      return {
        visitId,
        destination,
        reason,
        queueStatus: nextQueueStatus ?? ticket.status,
        doctorCompletedAt: completedAt,
        doctorCompletedByStaffId: actor.id,
        alreadyCompleted: false,
      };
    });
  }
}

/**
 * Who may finish this consultation.
 *
 * The attending clinician, and nobody else. There is deliberately no override
 * permission: none exists in the Role enum, and inventing one here would put a
 * clinical bypass in the same commit that introduces the rule it bypasses. A
 * colleague who genuinely needs to finish the consultation takes the visit
 * first — S3b made exactly that a one-step, audited action.
 */
function assertMayCompleteThisVisit(actor: Staff, attendingStaffId: string | null): void {
  if (!isEligibleAttendingDoctor(actor)) {
    throw new ForbiddenException('Only a doctor can complete a consultation.');
  }
  if (!attendingStaffId) {
    throw new BadRequestException(
      'No doctor is recorded as attending this visit. Take the visit before completing the consultation.',
    );
  }
  if (attendingStaffId !== actor.id) {
    throw new ForbiddenException(
      'This visit is with another doctor. They can transfer it to you before the consultation is completed.',
    );
  }
}

/**
 * G4.5d3c-2c (D-088) — THE evaluator. One implementation, three callers: the
 * status read, the write that refuses, and the write that proceeds.
 *
 * Every blocker is collected; none short-circuits. A doctor told to sign the
 * note, who signs it and is then told about a procedure, and then about a
 * medication, has been made to do three round trips to learn one thing.
 *
 * Billing NEVER appears here. It decides the routing reason — where the
 * patient goes after the doctor is done — and has no say in whether the
 * doctor is done.
 */
async function evaluateDoctorPhase(
  tx: ClinicalTx,
  visitId: string,
  queueStatus: QueueTicketStatus | null,
): Promise<DoctorPhaseEvaluation> {
  const blockers: DoctorPhaseBlocker[] = [];
  const add = (code: DoctorPhaseBlockerCode) => blockers.push({ code, message: BLOCKER_MESSAGES[code] });

  // NULL means the visit has no queue ticket at all — a record-only visit
  // created outside the front desk. It has no consultation to finish, which
  // is the same answer as a ticket at the wrong stage.
  if (queueStatus !== QueueTicketStatus.IN_CONSULTATION) {
    add('QUEUE_STATE_INELIGIBLE');
  }

  // G4.5d3c-3c — DOCUMENTATION PENDING, and why this is no longer a blocker.
  //
  // An unsigned clinical note used to refuse the whole routing decision: the
  // patient could not be sent to the dispensary or the counter until the
  // doctor had finished writing. In a clinic seeing 100–200 patients a day
  // that inverted the queue. The note is written while the patient is still
  // in the room, or between patients, or at the end of a block — and none of
  // those are reasons for a patient with a prescription in hand to sit in the
  // consultation room waiting for prose.
  //
  // What is NOT relaxed: the requirement itself. G4.5d6 moved the moment the
  // note becomes immutable to Complete Visit, where `VisitCompletionService`
  // finalizes the open draft under its author's identity. So documentation is
  // never a gate on a person here OR there — but it is still written, still
  // attributed, and still locked. Nothing in this file auto-saves or signs
  // anything; the draft in the editor is untouched by doctor completion.
  //
  // The state is still reported so the doctor can be asked to confirm it and
  // so it can be recorded against them, with a time. Sending a patient on
  // with the note unfinished is a real clinical decision, not an accident to
  // be hidden.
  const documentationPending = await isDocumentationPending(tx, visitId);

  // KW2-C2 — carried-over medications still marked "not re-read".
  const unreviewedCopiedMedications = await unreviewedCopiedNames(tx, visitId);

  // A procedure still running is the strongest blocker there is: the doctor is
  // meant to review its result before finishing (owner decision 4), so
  // completing now would close a phase whose findings do not exist yet.
  const openProcedures = await tx.orderService.count({
    where: {
      visitId,
      status: { in: [OrderServiceStatus.PENDING, OrderServiceStatus.IN_PROGRESS] },
    },
  });
  if (openProcedures > 0) {
    add('PROCEDURE_PENDING');
  }

  const active = await tx.prescription.findMany({
    where: { visitId, deletedAt: null, status: { not: PrescriptionStatus.CANCELLED } },
    select: { supplyMode: true, status: true },
  });
  // Separate codes, both reportable at once. NULL and DEFERRED are different
  // facts about the clinic — nobody has said, versus somebody said "later" —
  // and collapsing them would tell a doctor to set a supply mode that is
  // already set.
  if (active.some((p) => p.supplyMode === null)) {
    add('MEDICATION_SUPPLY_UNCONFIRMED');
  }
  if (active.some((p) => p.supplyMode === PrescriptionSupplyMode.DEFERRED)) {
    add('MEDICATION_SUPPLY_DEFERRED');
  }

  if (openProcedures > 0) {
    // No destination, and no reason for one. The procedure's findings are the
    // input to this decision: they can add an order, a prescription or a
    // charge, so any routing computed now is a guess about a visit that has
    // not stopped changing. Reporting NULL says "not yet knowable", which is
    // true; reporting NONE would say "nothing further", which is not.
    return { blockers, destination: null, routingReason: null, documentationPending, unreviewedCopiedMedications };
  }

  // Only ONSITE_DISPENSE counts, and only while still ORDERED. Everything else
  // is either supplied elsewhere, already in the patient's hands, or already
  // dispensed.
  const needsDispensing = active.some(
    (p) =>
      p.supplyMode === PrescriptionSupplyMode.ONSITE_DISPENSE &&
      p.status === PrescriptionStatus.ORDERED,
  );
  const billing = await evaluateBilling(tx, visitId);

  // --- Destination precedence -----------------------------------------
  // Order matters and is the owner's: clinical blockers first, then
  // dispensing, then money. Money never jumps the queue over medicine.
  if (needsDispensing) {
    return {
      blockers,
      destination: DoctorCompletionDestination.DISPENSARY,
      routingReason: 'DISPENSARY_REQUIRED',
      documentationPending,
      unreviewedCopiedMedications,
    };
  }
  if (billing === 'UNDETERMINED') {
    // Deliberately NOT phrased as "payment due". The clinic has to look;
    // telling the patient they owe money we cannot compute is worse than
    // saying we have not worked it out.
    return {
      blockers,
      destination: DoctorCompletionDestination.PAYMENT,
      routingReason: 'BILLING_REVIEW_REQUIRED',
      documentationPending,
      unreviewedCopiedMedications,
    };
  }
  if (billing > 0) {
    return {
      blockers,
      destination: DoctorCompletionDestination.PAYMENT,
      routingReason: 'PATIENT_PAYMENT_REQUIRED',
      documentationPending,
      unreviewedCopiedMedications,
    };
  }
  return {
    blockers,
    destination: DoctorCompletionDestination.NONE,
    routingReason: 'NO_DOWNSTREAM_WORK',
    documentationPending,
    unreviewedCopiedMedications,
  };
}

/**
 * What the patient still owes across the whole visit.
 *
 * Returns a number, or 'UNDETERMINED' when the model cannot say. Every
 * non-cancelled invoice is evaluated — a visit may carry several, and a
 * cancelled one contributes nothing.
 */
async function evaluateBilling(tx: ClinicalTx, visitId: string): Promise<number | 'UNDETERMINED'> {
  // D-093/D-094: billing work that still lies AHEAD of the patient — a
  // ready-but-unbilled charge, ordered clinic medication not yet dispensed,
  // or a consultation the tariff cannot resolve — means the counter has to
  // look, whatever invoices already exist. Routing past it would lose the
  // money. An external prescription is not clinic work and never routes a
  // visit to billing by itself (owner decision 4).
  const worklist = await collectBillingWorklist(tx, visitId);
  if (pendingBillingWork(worklist).length > 0 || tariffReviewItems(worklist).length > 0) {
    return 'UNDETERMINED';
  }

  const invoices = await tx.invoice.findMany({
    where: { visitId, status: { not: InvoiceStatus.CANCELLED } },
    select: { patientResponsibilityAmount: true, patientPaidAmount: true },
  });

  if (invoices.length === 0) {
    return 0;
  }

  let remaining = 0;
  for (const invoice of invoices) {
    if (invoice.patientResponsibilityAmount === null) {
      // One unknown makes the whole visit unknown. Substituting totalAmount
      // here would invent a debt for a panel patient who owes nothing.
      return 'UNDETERMINED';
    }
    const owed = Number(invoice.patientResponsibilityAmount) - Number(invoice.patientPaidAmount);
    remaining += Math.max(owed, 0);
  }
  // Rounding guard: sub-cent residue is not a reason to send someone to a
  // payment counter.
  return remaining < 0.005 ? 0 : remaining;
}
