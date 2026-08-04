import { QueueTicketStatus } from '@prisma/client';

/**
 * G4.5d3c-3b (D-095) — the OPERATIONAL STAGE a queue ticket sits at.
 *
 * The queue's status enum and the board's stages are deliberately different
 * things. `QueueTicketStatus` records the exact state a ticket is in — six
 * live values plus a legacy one plus two terminal ones. A stage is where the
 * PATIENT is standing, which is what a counter screen is about:
 *
 *   WAITING              -> WAITING
 *   IN_CONSULTATION      -> CONSULTATION
 *   AT_PROCEDURE         -> CONSULTATION   (the patient is out at a procedure
 *                                           but the doctor still holds them;
 *                                           the row carries an "At procedure"
 *                                           indicator rather than a tab of
 *                                           its own, per owner decision 1)
 *   READY_FOR_DISPENSARY -> DISPENSARY
 *   READY_FOR_PAYMENT    -> PAYMENT
 *   DISPENSARY_PAYMENT   -> PAYMENT        (LEGACY: rows created before
 *                                           dispensing and payment were
 *                                           separate states. Labelled as
 *                                           legacy wherever shown; nothing
 *                                           creates new ones.)
 *   COMPLETED            -> COMPLETED
 *   CANCELLED            -> (no stage — excluded from every active count)
 *
 * A visit may legitimately skip stages: a consultation with no medication and
 * nothing to bill goes straight from CONSULTATION to COMPLETED. The stage
 * order below is the flow's READING order, not a required path.
 */
export type QueueStage = 'WAITING' | 'CONSULTATION' | 'DISPENSARY' | 'PAYMENT' | 'COMPLETED';

/** The Live Patient Flow order (owner decision, section A). */
export const QUEUE_STAGE_ORDER: QueueStage[] = [
  'WAITING',
  'CONSULTATION',
  'DISPENSARY',
  'PAYMENT',
  'COMPLETED',
];

const STAGE_BY_STATUS: Record<QueueTicketStatus, QueueStage | null> = {
  [QueueTicketStatus.WAITING]: 'WAITING',
  [QueueTicketStatus.IN_CONSULTATION]: 'CONSULTATION',
  [QueueTicketStatus.AT_PROCEDURE]: 'CONSULTATION',
  [QueueTicketStatus.READY_FOR_DISPENSARY]: 'DISPENSARY',
  [QueueTicketStatus.READY_FOR_PAYMENT]: 'PAYMENT',
  [QueueTicketStatus.DISPENSARY_PAYMENT]: 'PAYMENT',
  [QueueTicketStatus.COMPLETED]: 'COMPLETED',
  // Cancelled is not a stage. It is retained history, and it is deliberately
  // absent from every active count rather than quietly folded into one.
  [QueueTicketStatus.CANCELLED]: null,
};

export function stageOf(status: QueueTicketStatus): QueueStage | null {
  return STAGE_BY_STATUS[status] ?? null;
}

/** Statuses that belong to a stage, for a status-filtered query. */
export function statusesForStage(stage: QueueStage): QueueTicketStatus[] {
  return (Object.keys(STAGE_BY_STATUS) as QueueTicketStatus[]).filter(
    (status) => STAGE_BY_STATUS[status] === stage,
  );
}

/**
 * A legacy row: created when dispensing and payment were one state. Shown
 * under Payment and labelled, never silently presented as a modern ticket.
 */
export function isLegacyStatus(status: QueueTicketStatus): boolean {
  return status === QueueTicketStatus.DISPENSARY_PAYMENT;
}

/** Whether the patient is out at a procedure while still held by the doctor. */
export function isAtProcedure(status: QueueTicketStatus): boolean {
  return status === QueueTicketStatus.AT_PROCEDURE;
}
