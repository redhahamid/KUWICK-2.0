import { ForbiddenException } from '@nestjs/common';
import { QueueTicketStatus, Role, Staff } from '@prisma/client';

/**
 * S3 (D-079) — who may move a patient through the queue.
 *
 * Before this, every queue mutation route was completely open: no
 * authentication, no role check, no branch check. Any caller who could reach
 * the API could create a ticket, call a patient to a room, reassign the
 * attending doctor, or close somebody's visit.
 *
 * The matrix is modelled on BILLING_MATRIX (D-066) — the same shape, the same
 * fail-closed semantics — and follows the same principle it settled: a role
 * gets a power because the job needs it, not because the person is senior.
 *
 * NOTE ON ROLES THAT DO NOT EXIST. The brief lists NURSE and DISPENSARY as
 * roles "where present". Neither exists in `Role`, so neither appears here;
 * nothing is invented. Dispensary work currently has no dedicated role, which
 * is recorded as an open question rather than papered over with STOCK_STAFF.
 *
 * WHERE THE ANSWER WAS NOT OBVIOUS, THE NARROWER OPTION WAS TAKEN. Granting a
 * privilege later is an ordinary product change; discovering that a role has
 * silently held one is an incident. The three judgement calls are flagged in
 * the S3 report for explicit approval.
 */
export type QueueAction =
  | 'CREATE_TICKET'
  | 'CALL_PATIENT'
  | 'ASSIGN_CLINICIAN'
  | 'START_CONSULTATION'
  | 'MOVE_TO_DISPENSARY'
  | 'COMPLETE_TICKET'
  | 'CANCEL_TICKET';

const QUEUE_MATRIX: Record<QueueAction, Role[]> = {
  // Registering an arrival is front-desk work. Doctors are included because
  // walk-in and emergency arrivals are sometimes entered by whoever is free.
  CREATE_TICKET: ['OWNER_ADMIN', 'FRONT_DESK_CLINICAL_STAFF', 'DOCTOR_RESIDENT', 'DOCTOR_LOCUM'],

  // Calling the next patient to a room: front desk announces, and a doctor
  // calls their own next patient.
  CALL_PATIENT: ['OWNER_ADMIN', 'FRONT_DESK_CLINICAL_STAFF', 'DOCTOR_RESIDENT', 'DOCTOR_LOCUM'],

  // JUDGEMENT CALL 1 — reassigning the ATTENDING CLINICIAN is a change to the
  // clinical record's authorship, not a queue movement. D-044 established
  // that front desk registers a walk-in before anyone knows who will see the
  // patient, so the power is real; it is kept to front desk and the owner
  // rather than granted to every doctor.
  ASSIGN_CLINICIAN: ['OWNER_ADMIN', 'FRONT_DESK_CLINICAL_STAFF'],

  // Starting the consultation is the clinician's own act.
  START_CONSULTATION: ['OWNER_ADMIN', 'FRONT_DESK_CLINICAL_STAFF', 'DOCTOR_RESIDENT', 'DOCTOR_LOCUM'],

  // Moving a finished consultation onward is the doctor closing their part.
  MOVE_TO_DISPENSARY: ['OWNER_ADMIN', 'FRONT_DESK_CLINICAL_STAFF', 'DOCTOR_RESIDENT', 'DOCTOR_LOCUM'],

  // JUDGEMENT CALL 2 — completing the ticket also sets Visit.checkOutAt, so
  // it closes the visit. That is counter work, and it follows MARK_PAID's
  // reasoning exactly: a doctor does not acquire closing rights merely by
  // being a doctor. Doctors are deliberately EXCLUDED.
  COMPLETE_TICKET: ['OWNER_ADMIN', 'FRONT_DESK_CLINICAL_STAFF', 'FINANCE_STAFF'],

  // JUDGEMENT CALL 3 — cancelling removes a patient from the day's work.
  // Front desk and the owner only; a doctor who wants a patient removed asks
  // the counter, which is also how the paper process works.
  CANCEL_TICKET: ['OWNER_ADMIN', 'FRONT_DESK_CLINICAL_STAFF'],
};

const ACTION_WORDS: Record<QueueAction, string> = {
  CREATE_TICKET: 'add a patient to the queue',
  CALL_PATIENT: 'call a patient',
  ASSIGN_CLINICIAN: 'change the attending clinician',
  START_CONSULTATION: 'start a consultation',
  MOVE_TO_DISPENSARY: 'move a patient to dispensary and payment',
  COMPLETE_TICKET: 'complete a visit',
  CANCEL_TICKET: 'cancel a queue ticket',
};

export function canPerformQueueAction(staff: Staff, action: QueueAction): boolean {
  return staff.active && QUEUE_MATRIX[action].includes(staff.role);
}

export function assertCanPerformQueueAction(staff: Staff, action: QueueAction): void {
  if (!canPerformQueueAction(staff, action)) {
    // Says what was refused, never who else may do it — an error message is
    // not a place to enumerate the tenant's permission model.
    throw new ForbiddenException(`Your role is not permitted to ${ACTION_WORDS[action]}.`);
  }
}

/**
 * S3D — the legal transitions of the CURRENT enum. No new statuses are
 * introduced here; that is G4.5d3c-1.
 *
 * Everything not listed is forbidden, including every transition out of a
 * terminal state. COMPLETED and CANCELLED have no outgoing edges at all: a
 * closed visit is not reopened by moving a queue ticket.
 */
const LEGAL_TRANSITIONS: Record<QueueTicketStatus, QueueTicketStatus[]> = {
  WAITING: [QueueTicketStatus.IN_CONSULTATION, QueueTicketStatus.CANCELLED],
  IN_CONSULTATION: [QueueTicketStatus.DISPENSARY_PAYMENT, QueueTicketStatus.CANCELLED],
  DISPENSARY_PAYMENT: [QueueTicketStatus.COMPLETED, QueueTicketStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};

export function isLegalQueueTransition(from: QueueTicketStatus, to: QueueTicketStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}
