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
import { ClinicalTx, assertMayTouchVisit, requireClinicalAuthor, withTenantTx } from './clinical-actor';
import { isEligibleAttendingDoctor } from './queue-authorization';
import { CompleteDoctorPhaseDto } from './dto/complete-doctor-phase.dto';

/**
 * Why the patient is going where they are going. Returned so the caller can
 * say something true rather than inferring from the destination — DISPENSARY
 * and PAYMENT each have more than one cause.
 */
export type DestinationReason =
  | 'DISPENSING_REQUIRED'
  | 'PATIENT_PAYMENT_REQUIRED'
  | 'BILLING_REVIEW_REQUIRED'
  | 'NOTHING_OUTSTANDING';

export interface DoctorCompletionResult {
  visitId: string;
  destination: DoctorCompletionDestination;
  reason: DestinationReason;
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
 * NOT built here: the Canvas footer, any queue screen, and the overall visit
 * completion step. This service never sets `Visit.checkOutAt`.
 */
@Injectable()
export class DoctorCompletionService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

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
          reason: reasonFor(visit.doctorCompletedDestination),
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
      // The ticket is re-read inside this transaction, so a racing request
      // that already moved it cannot be overwritten by a stale view.
      if (!ticket) {
        throw new BadRequestException('This visit is not in the queue, so the consultation cannot be completed.');
      }
      if (ticket.status !== QueueTicketStatus.IN_CONSULTATION) {
        throw new BadRequestException(
          `The consultation can only be completed while the patient is in consultation (currently ${ticket.status}).`,
        );
      }

      await assertClinicalRecordReady(tx, visitId);
      const needsDispensing = await evaluateDispensing(tx, visitId);
      const billing = await evaluateBilling(tx, visitId);

      // --- Destination precedence -----------------------------------------
      // Order matters and is the owner's: clinical blockers first, then
      // dispensing, then money. Money never jumps the queue over medicine.
      let destination: DoctorCompletionDestination;
      let reason: DestinationReason;
      if (needsDispensing) {
        destination = DoctorCompletionDestination.DISPENSARY;
        reason = 'DISPENSING_REQUIRED';
      } else if (billing === 'UNDETERMINED') {
        // Deliberately NOT phrased as "payment due". The clinic has to look;
        // telling the patient they owe money we cannot compute is worse than
        // saying we have not worked it out.
        destination = DoctorCompletionDestination.PAYMENT;
        reason = 'BILLING_REVIEW_REQUIRED';
      } else if (billing > 0) {
        destination = DoctorCompletionDestination.PAYMENT;
        reason = 'PATIENT_PAYMENT_REQUIRED';
      } else {
        destination = DoctorCompletionDestination.NONE;
        reason = 'NOTHING_OUTSTANDING';
      }

      const completedAt = new Date();
      await tx.visit.update({
        where: { id: visitId },
        data: {
          doctorCompletedAt: completedAt,
          doctorCompletedByStaffId: actor.id,
          doctorCompletedDestination: destination,
          // checkOutAt is NOT set here, in ANY branch. See the note below.
        },
      });

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
          actorStaffId: actor.id,
          actorNameSnapshot: actor.fullName,
          actorRoleSnapshot: actor.role,
          reason: dto.note?.trim() || null,
          metadata: { destinationReason: reason },
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

/** The clinical record has to be finished before the phase can be. */
async function assertClinicalRecordReady(tx: ClinicalTx, visitId: string): Promise<void> {
  const signedNotes = await tx.clinicalNote.count({
    where: {
      visitId,
      noteType: ClinicalNoteType.DOCTOR_NARRATIVE,
      status: ClinicalNoteStatus.SIGNED,
      signedAt: { not: null },
    },
  });
  if (signedNotes === 0) {
    throw new BadRequestException(
      'Sign the clinical note before completing the consultation.',
    );
  }

  // A procedure still running is the strongest blocker there is: the doctor
  // is meant to review its result before finishing (owner decision 4), so
  // completing now would close a phase whose findings do not exist yet.
  const openProcedures = await tx.orderService.count({
    where: {
      visitId,
      status: { in: [OrderServiceStatus.PENDING, OrderServiceStatus.IN_PROGRESS] },
    },
  });
  if (openProcedures > 0) {
    throw new BadRequestException(
      `${openProcedures} procedure or investigation is still open. Complete or cancel it before completing the consultation.`,
    );
  }
}

/**
 * Does the clinic still have medicine to hand over?
 *
 * Only ONSITE_DISPENSE counts, and only while still ORDERED. Everything else
 * is either supplied elsewhere, already in the patient's hands, or already
 * dispensed. DEFERRED and NULL are not "no" — they are "not established", and
 * they stop completion rather than being resolved by assumption.
 */
async function evaluateDispensing(tx: ClinicalTx, visitId: string): Promise<boolean> {
  const active = await tx.prescription.findMany({
    where: { visitId, deletedAt: null, status: { not: PrescriptionStatus.CANCELLED } },
    select: { id: true, supplyMode: true, status: true },
  });

  const unresolved = active.filter(
    (p) => p.supplyMode === null || p.supplyMode === PrescriptionSupplyMode.DEFERRED,
  );
  if (unresolved.length > 0) {
    const deferred = unresolved.some((p) => p.supplyMode === PrescriptionSupplyMode.DEFERRED);
    throw new BadRequestException(
      deferred
        ? 'Medication supply is deferred and unresolved. Resolve the supply mode before completing consultation.'
        : `${unresolved.length} medication has no supply mode recorded. Set how it is supplied before completing consultation.`,
    );
  }

  return active.some(
    (p) =>
      p.supplyMode === PrescriptionSupplyMode.ONSITE_DISPENSE &&
      p.status === PrescriptionStatus.ORDERED,
  );
}

/**
 * What the patient still owes across the whole visit.
 *
 * Returns a number, or 'UNDETERMINED' when the model cannot say. Every
 * non-cancelled invoice is evaluated — a visit may carry several, and a
 * cancelled one contributes nothing.
 */
async function evaluateBilling(tx: ClinicalTx, visitId: string): Promise<number | 'UNDETERMINED'> {
  const invoices = await tx.invoice.findMany({
    where: { visitId, status: { not: InvoiceStatus.CANCELLED } },
    select: { patientResponsibilityAmount: true, patientPaidAmount: true },
  });

  if (invoices.length === 0) {
    // No invoice yet. If the visit has chargeable work on it, the bill has
    // simply not been raised — closing the visit here would lose the money.
    const billable = await countBillableItems(tx, visitId);
    return billable > 0 ? 'UNDETERMINED' : 0;
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

/** Work on the visit that would normally be charged for. */
async function countBillableItems(tx: ClinicalTx, visitId: string): Promise<number> {
  const [services, medications] = await Promise.all([
    tx.orderService.count({ where: { visitId, status: { not: OrderServiceStatus.CANCELLED } } }),
    tx.prescription.count({
      where: { visitId, deletedAt: null, status: { not: PrescriptionStatus.CANCELLED } },
    }),
  ]);
  return services + medications;
}

function reasonFor(destination: DoctorCompletionDestination | null): DestinationReason {
  switch (destination) {
    case DoctorCompletionDestination.DISPENSARY:
      return 'DISPENSING_REQUIRED';
    case DoctorCompletionDestination.PAYMENT:
      // A recorded PAYMENT destination cannot be re-attributed to its original
      // cause without re-deriving it, and re-deriving is exactly what
      // idempotency must not do. The safer of the two is reported.
      return 'BILLING_REVIEW_REQUIRED';
    default:
      return 'NOTHING_OUTSTANDING';
  }
}
