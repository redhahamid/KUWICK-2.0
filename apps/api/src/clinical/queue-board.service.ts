import { Injectable } from '@nestjs/common';
import {
  InvoiceStatus,
  PrescriptionStatus,
  PrescriptionSupplyMode,
  QueueTicketStatus,
} from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { ClinicalTx, branchContext, requireActor, withReadOnlyTenantTx } from './clinical-actor';
import { hasBranchAccess } from './clinical-authorization';
import { QueueStage, isAtProcedure, isLegacyStatus, stageOf } from './queue-stage';
import { VisitCompletionBlocker, collectBlockers, mayCompleteVisit } from './visit-completion.service';

/**
 * G4.5d3c-3b (D-095) — THE QUEUE BOARD.
 *
 * One read that answers everything the six-stage queue needs, so the browser
 * derives nothing operational: which stage each patient is at, how much of
 * their medication is actually dispensed, what they owe, what is blocking
 * their visit from closing, and — decided HERE, never in the UI — whether
 * Complete Visit may be offered at all.
 *
 * Eligibility is the same `collectBlockers` the completion service itself
 * runs, imported rather than reimplemented: a board that computed its own
 * answer would eventually offer a button the server refuses.
 *
 * COST. Blockers are evaluated only for tickets where completion is plausible
 * (consultation, dispensary and payment stages). Waiting and completed rows
 * need none, which is most of the saving. Per-visit evaluation is still
 * several queries; batching it behind one loader is recorded as a limitation
 * rather than solved by duplicating the rules.
 */
// TASK 1 — imported, never reimplemented. A board that computed its own
// answer would eventually offer a Complete button the server refuses.

/** Stages whose rows carry a completion decision. */
const EVALUATED_STAGES: QueueStage[] = ['CONSULTATION', 'DISPENSARY', 'PAYMENT'];

export interface QueueBoardDispensing {
  /** Clinic-dispensed medications on the visit (ONSITE_DISPENSE, not cancelled). */
  onsiteTotal: number;
  dispensed: number;
  remaining: number;
}

export interface QueueBoardBilling {
  /** NULL where the responsibility engine has not resolved the split. */
  grandTotal: string | null;
  panelResponsibility: string | null;
  patientResponsibility: string | null;
  remainingBalance: string | null;
  /** UNRESOLVED = a human must confirm the split before money means anything. */
  state: 'NO_INVOICE' | 'UNRESOLVED' | 'BALANCE_DUE' | 'SETTLED';
  invoiceId: string | null;
  invoiceNumber: string | null;
}

export interface QueueBoardRow {
  ticketId: string;
  visitId: string;
  displayNumber: string | null;
  queueType: string;
  status: QueueTicketStatus;
  stage: QueueStage | null;
  /** The patient is out at a procedure but the doctor still holds the visit. */
  atProcedure: boolean;
  /** A row from before dispensing and payment were separate states. */
  legacyStatus: boolean;
  /**
   * KW2-C2 — the patient is back in the WAITING queue because a doctor
   * paused their consultation, not because they have yet to be seen.
   *
   * Both fields or neither, enforced by a database check constraint: an
   * unattributed "on hold" is the silent state change this feature exists to
   * prevent, so a held row can always name the doctor who is holding it.
   */
  heldAt: Date | null;
  heldByName: string | null;
  patientName: string;
  patientId: string;
  doctorName: string | null;
  roomName: string | null;
  billingType: string;
  panelName: string | null;
  checkInAt: Date;
  calledAt: Date | null;
  checkOutAt: Date | null;
  doctorCompletedAt: Date | null;
  dispensing: QueueBoardDispensing;
  billing: QueueBoardBilling;
  /** Empty when nothing is outstanding; absent evaluation returns null. */
  blockers: VisitCompletionBlocker[] | null;
  /** The SERVER'S decision. The UI offers Complete Visit only where true. */
  canComplete: boolean;
}

export interface QueueBoard {
  rows: QueueBoardRow[];
  counts: {
    totalToday: number;
    waiting: number;
    consultation: number;
    dispensary: number;
    payment: number;
    completed: number;
    cancelled: number;
  };
  /** Whether THIS user may complete visits at all (the button's visibility). */
  mayCompleteVisits: boolean;
}

@Injectable()
export class QueueBoardService {
  constructor(private readonly rawPrisma: PrismaService) {}

  async board(clinicId: string): Promise<QueueBoard> {
    return withReadOnlyTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      // Branch access is enforced against the requested clinic, the same rule
      // every other clinical read uses.
      if (!hasBranchAccess(actor, clinicId, await branchContext(tx, actor))) {
        return { rows: [], counts: emptyCounts(), mayCompleteVisits: false };
      }
      const mayCompleteVisits = mayCompleteVisit(actor);

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const tickets = await tx.queueTicket.findMany({
        where: {
          clinicId,
          OR: [
            // Everything still in play, whenever it started…
            { status: { notIn: [QueueTicketStatus.COMPLETED, QueueTicketStatus.CANCELLED] } },
            // …plus today's finished and cancelled tickets, for the Completed
            // tab and the day's counts.
            { status: { in: [QueueTicketStatus.COMPLETED, QueueTicketStatus.CANCELLED] }, createdAt: { gte: startOfDay } },
          ],
        },
        select: {
          id: true,
          visitId: true,
          displayNumber: true,
          queueType: true,
          status: true,
          calledAt: true,
          heldAt: true,
          heldBy: { select: { fullName: true } },
          room: { select: { name: true } },
          visit: {
            select: {
              id: true,
              checkInAt: true,
              checkOutAt: true,
              doctorCompletedAt: true,
              billingType: true,
              patient: { select: { id: true, name: true } },
              staff: { select: { fullName: true } },
              panelClinic: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      const rows: QueueBoardRow[] = [];
      for (const ticket of tickets) {
        const stage = stageOf(ticket.status);
        const dispensing = await dispensingSummary(tx, ticket.visitId);
        const billing = await billingSummary(tx, ticket.visitId);

        // Blockers only where a completion decision is meaningful.
        let blockers: VisitCompletionBlocker[] | null = null;
        if (stage && EVALUATED_STAGES.includes(stage)) {
          blockers = await collectBlockers(
            tx,
            ticket.visitId,
            ticket.visit.doctorCompletedAt,
            ticket.status,
          );
        }

        rows.push({
          ticketId: ticket.id,
          visitId: ticket.visitId,
          displayNumber: ticket.displayNumber,
          queueType: ticket.queueType,
          status: ticket.status,
          stage,
          atProcedure: isAtProcedure(ticket.status),
          legacyStatus: isLegacyStatus(ticket.status),
          heldAt: ticket.heldAt,
          heldByName: ticket.heldBy?.fullName ?? null,
          patientName: ticket.visit.patient?.name ?? 'Patient',
          patientId: ticket.visit.patient?.id ?? '',
          doctorName: ticket.visit.staff?.fullName ?? null,
          roomName: ticket.room?.name ?? null,
          billingType: ticket.visit.billingType,
          panelName: ticket.visit.panelClinic?.name ?? null,
          checkInAt: ticket.visit.checkInAt,
          calledAt: ticket.calledAt,
          checkOutAt: ticket.visit.checkOutAt,
          doctorCompletedAt: ticket.visit.doctorCompletedAt,
          dispensing,
          billing,
          blockers,
          // Never "the tab looks right": the row is completable only when the
          // authoritative evaluator found nothing outstanding AND the visit is
          // still open AND this user holds the permission.
          canComplete:
            mayCompleteVisits &&
            blockers !== null &&
            blockers.length === 0 &&
            ticket.visit.checkOutAt === null &&
            ticket.status !== QueueTicketStatus.CANCELLED &&
            ticket.status !== QueueTicketStatus.COMPLETED,
        });
      }

      return { rows, counts: countStages(rows), mayCompleteVisits };
    });
  }
}

function emptyCounts(): QueueBoard['counts'] {
  return { totalToday: 0, waiting: 0, consultation: 0, dispensary: 0, payment: 0, completed: 0, cancelled: 0 };
}

/** Counts by STAGE. Cancelled is counted separately and never as active work. */
function countStages(rows: QueueBoardRow[]): QueueBoard['counts'] {
  const counts = emptyCounts();
  for (const row of rows) {
    if (row.status === QueueTicketStatus.CANCELLED) {
      counts.cancelled += 1;
      continue;
    }
    counts.totalToday += 1;
    switch (row.stage) {
      case 'WAITING':
        counts.waiting += 1;
        break;
      case 'CONSULTATION':
        counts.consultation += 1;
        break;
      case 'DISPENSARY':
        counts.dispensary += 1;
        break;
      case 'PAYMENT':
        counts.payment += 1;
        break;
      case 'COMPLETED':
        counts.completed += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

/**
 * What the dispensary actually has to do: clinic-dispensed medication only.
 * External scripts, patient-own supply and no-supply-required are not the
 * dispensary's work and are not counted as if they were.
 */
async function dispensingSummary(tx: ClinicalTx, visitId: string): Promise<QueueBoardDispensing> {
  const prescriptions = await tx.prescription.findMany({
    where: {
      visitId,
      deletedAt: null,
      status: { not: PrescriptionStatus.CANCELLED },
      supplyMode: PrescriptionSupplyMode.ONSITE_DISPENSE,
    },
    select: { status: true },
  });
  const dispensed = prescriptions.filter((p) => p.status === PrescriptionStatus.DISPENSED).length;
  return {
    onsiteTotal: prescriptions.length,
    dispensed,
    remaining: prescriptions.length - dispensed,
  };
}

/**
 * The money, read from the PERSISTED calculation only (D-093). A NULL
 * responsibility is reported as UNRESOLVED, never as a zero balance — the
 * whole point of the 3b1 closure.
 */
async function billingSummary(tx: ClinicalTx, visitId: string): Promise<QueueBoardBilling> {
  const invoices = await tx.invoice.findMany({
    where: { visitId, status: { not: InvoiceStatus.CANCELLED } },
    select: {
      id: true,
      invoiceNumber: true,
      totalAmount: true,
      panelResponsibilityAmount: true,
      patientResponsibilityAmount: true,
      patientPaidAmount: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  if (invoices.length === 0) {
    return {
      grandTotal: null,
      panelResponsibility: null,
      patientResponsibility: null,
      remainingBalance: null,
      state: 'NO_INVOICE',
      invoiceId: null,
      invoiceNumber: null,
    };
  }

  const primary = invoices[0];
  const unresolved = invoices.some((i) => i.patientResponsibilityAmount === null);
  const total = invoices.reduce((sum, i) => sum + Number(i.totalAmount ?? 0), 0);
  if (unresolved) {
    return {
      grandTotal: money(total),
      panelResponsibility: null,
      patientResponsibility: null,
      remainingBalance: null,
      state: 'UNRESOLVED',
      invoiceId: primary.id,
      invoiceNumber: primary.invoiceNumber,
    };
  }

  const panel = invoices.reduce((sum, i) => sum + Number(i.panelResponsibilityAmount ?? 0), 0);
  const patient = invoices.reduce((sum, i) => sum + Number(i.patientResponsibilityAmount ?? 0), 0);
  const paid = invoices.reduce((sum, i) => sum + Number(i.patientPaidAmount ?? 0), 0);
  const remaining = Math.max(patient - paid, 0);
  return {
    grandTotal: money(total),
    panelResponsibility: money(panel),
    patientResponsibility: money(patient),
    remainingBalance: money(remaining),
    // A settled patient balance is SETTLED even when the panel has not paid
    // the clinic: the panel receivable is Finance's business, not the
    // patient's, and it never holds a visit open (owner decision 6).
    state: remaining >= 0.005 ? 'BALANCE_DUE' : 'SETTLED',
    invoiceId: primary.id,
    invoiceNumber: primary.invoiceNumber,
  };
}

function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}
