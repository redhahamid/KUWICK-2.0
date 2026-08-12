import { ForbiddenException } from '@nestjs/common';
import { QueueTicketStatus, Role, Staff } from '@prisma/client';
import { Permission, attachedRoles, can, hasDoctorIdentity } from '../core/permissions';

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
  | 'HOLD_CONSULTATION'
  | 'MOVE_TO_DISPENSARY'
  | 'COMPLETE_TICKET'
  | 'CANCEL_TICKET';

/**
 * TASK 1 — the matrix now says which PERMISSION each action needs, and the
 * policy module says who holds it. The role lists that used to live here are
 * gone: they were a second implementation of the same question, which is the
 * shape of defect this migration exists to remove.
 *
 * The split the owner approved runs straight down this table.
 * `queue.consultationFlow` is the moving-patients-through-the-clinic half —
 * doctors do it for their own patients all day — and `queue.manage` is the
 * counter's administration of the day's list.
 */
const QUEUE_PERMISSION: Record<QueueAction, Permission> = {
  // Registering an arrival is front-desk work. Doctors hold it too, because
  // walk-in and emergency arrivals are sometimes entered by whoever is free.
  CREATE_TICKET: 'queue.consultationFlow',

  // Calling the next patient to a room: front desk announces, and a doctor
  // calls their own next patient.
  CALL_PATIENT: 'queue.consultationFlow',

  // S3b — WHO may change the attending clinician at all. Which change each
  // may make is a further question no permission can express, because it
  // depends on who currently holds the visit — see
  // assertMayChangeAttendingClinician below.
  ASSIGN_CLINICIAN: 'queue.consultationFlow',

  // Starting the consultation is the clinician's own act.
  START_CONSULTATION: 'queue.consultationFlow',

  // KW2-C2 — pausing a consultation and sending the patient back to wait.
  //
  // The NARROW reading, per this file's own rule, and now its own clinical
  // permission rather than a role list. Front desk is deliberately EXCLUDED:
  // holding is a clinical judgement — the doctor needs a result, or the
  // patient needs to eat before a fasting test — and it is the doctor who
  // then has to remember to take them back. A counter that can push a patient
  // out of a consulting room is a queue-management tool aimed at a room the
  // counter cannot see into.
  //
  // Resuming runs through START_CONSULTATION, which front desk DOES hold: a
  // doctor asking the counter to call a held patient back in is ordinary
  // clinic work, and it is the pause that needed the narrower gate.
  //
  // MIGRATION NOTE: a legacy OWNER_ADMIN who is NOT a clinician loses this.
  // That is the approved rule — owner alone carries zero clinical ability —
  // and an owner who is also the GP keeps it through their DOCTOR role.
  HOLD_CONSULTATION: 'consultation.hold',

  // Moving a finished consultation onward is the doctor closing their part.
  MOVE_TO_DISPENSARY: 'queue.consultationFlow',

  // JUDGEMENT CALL 2 — completing the ticket also sets Visit.checkOutAt, so
  // it closes the visit. That is counter work, and it follows MARK_PAID's
  // reasoning exactly: a doctor does not acquire closing rights merely by
  // being a doctor. Doctors are deliberately EXCLUDED.
  COMPLETE_TICKET: 'queue.manage',

  // JUDGEMENT CALL 3 — cancelling removes a patient from the day's work.
  // The counter only; a doctor who wants a patient removed asks the front
  // desk, which is also how the paper process works.
  CANCEL_TICKET: 'queue.manage',
};

const ACTION_WORDS: Record<QueueAction, string> = {
  CREATE_TICKET: 'add a patient to the queue',
  CALL_PATIENT: 'call a patient',
  ASSIGN_CLINICIAN: 'change the attending clinician',
  START_CONSULTATION: 'start a consultation',
  HOLD_CONSULTATION: 'put a consultation on hold',
  MOVE_TO_DISPENSARY: 'move a patient to dispensary and payment',
  COMPLETE_TICKET: 'complete a visit',
  CANCEL_TICKET: 'cancel a queue ticket',
};

export function canPerformQueueAction(staff: Staff, action: QueueAction): boolean {
  return can(staff, QUEUE_PERMISSION[action], attachedRoles(staff));
}

export function assertCanPerformQueueAction(staff: Staff, action: QueueAction): void {
  if (!canPerformQueueAction(staff, action)) {
    // Says what was refused, never who else may do it — an error message is
    // not a place to enumerate the tenant's permission model. "Your account",
    // not "your role": since Task 1 a capability can be granted to a person
    // without changing their role, so naming the role as the cause would be
    // telling staff something that is no longer true.
    throw new ForbiddenException(`Your account is not permitted to ${ACTION_WORDS[action]}.`);
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

  // KW2-C2 — WAITING is now a legal destination from IN_CONSULTATION, for
  // HOLD. It is the one BACKWARD edge in this table and it is deliberate: a
  // consultation that has to pause is a real event in a GP clinic, and the
  // alternatives staff reach for otherwise — cancel and re-register, or leave
  // the room occupied and forget — both lose the record.
  //
  // The edge alone does not make holding possible for everyone: it is gated
  // by HOLD_CONSULTATION above, and every crossing writes an attributed
  // workflow event. A transition table says what CAN happen; it has never
  // said who may make it happen.
  IN_CONSULTATION: [
    QueueTicketStatus.WAITING,
    QueueTicketStatus.DISPENSARY_PAYMENT,
    QueueTicketStatus.CANCELLED,
  ],
  DISPENSARY_PAYMENT: [QueueTicketStatus.COMPLETED, QueueTicketStatus.CANCELLED],

  // G4.5d3c-1 added these three statuses to the enum, which made this
  // exhaustive Record demand entries for them. They are deliberately EMPTY.
  //
  // No route can put a ticket into any of them — the completion and procedure
  // endpoints are G4.5d3c-2, not this phase — so writing their outgoing edges
  // now would be deciding the new workflow's policy ahead of approval, in a
  // file whose whole purpose is to enforce approved policy. Empty is also the
  // safe reading if a row somehow acquires one of these: refuse to move it
  // rather than guess where it should go.
  //
  // The approved shape is on record (owner decision 4: AT_PROCEDURE returns
  // to IN_CONSULTATION, never straight to dispensary or payment); it gets
  // filled in when the endpoints that use it are built.
  AT_PROCEDURE: [],

  // G4.5d5b-2 — READY_FOR_DISPENSARY finally gets its outgoing edge.
  //
  // It had none, which meant a patient the doctor had sent to the counter
  // could not legally leave that stage: the dispensary had no operational
  // exit at all. The edge added here is exactly the one the approved flow
  // needs and no more — once the last clinic-supplied medication is handed
  // over, the visit moves to payment. CANCELLED stays available because a
  // visit can be abandoned at any stage.
  //
  // Deliberately NOT added: a direct edge to COMPLETED. Closing a visit is
  // VisitCompletionService's job under its own blockers (D-087), and giving
  // the dispensary a shortcut to it would let a hand-over close a bill.
  READY_FOR_DISPENSARY: [QueueTicketStatus.READY_FOR_PAYMENT, QueueTicketStatus.CANCELLED],

  // Left empty on purpose. Payment's exit is completion, and completion does
  // not move the ticket through this transition table — it is the one
  // operation that sets checkOutAt, and it owns its own rules.
  READY_FOR_PAYMENT: [],

  COMPLETED: [],
  CANCELLED: [],
};

export function isLegalQueueTransition(from: QueueTicketStatus, to: QueueTicketStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

// ===========================================================================
// S3b — ATTENDING CLINICIAN ASSIGNMENT AND TRANSFER (owner correction)
//
// The first version of this rule kept doctors out of clinician assignment
// entirely. That was too narrow and the owner corrected it: doctor-to-doctor
// transfer is real clinical work — shift handover, escalation, a doctor
// called away — and forcing it through the front desk, or through cancelling
// and recreating the visit, is worse than the risk it was guarding against.
//
// The risk that remains is a doctor SEIZING a patient who is actively with a
// colleague. So the rule is not "which role", it is "which role, given who
// holds the visit now":
//
//   OWNER / FRONT DESK   may assign or reassign freely.
//   DOCTOR               may claim a visit no doctor holds, and may hand on a
//                        visit they hold themselves. They may not take a
//                        visit out of another doctor's hands.
//
// The target is always validated as an eligible doctor (see
// isEligibleAttendingDoctor); a doctor cannot hand a patient to a non-doctor.
// ===========================================================================

const ELIGIBLE_ATTENDING_ROLES: Role[] = ['DOCTOR_RESIDENT', 'DOCTOR_LOCUM'];

/**
 * May this staff member be recorded as a visit's attending clinician?
 *
 * Two ways in, both facts about the row itself (tenant, active and branch
 * are checked separately, against the database):
 *
 *   - the legacy doctor ROLES, unchanged — a resident or locum is an
 *     attending doctor whether or not their professional fields are filled
 *     in yet, and narrowing that would break clinics mid-migration;
 *   - a professional DOCTOR IDENTITY (`hasDoctorIdentity`) — the Task 1 rule
 *     "OWNER_ADMIN + DOCTOR when credentialed" applied here. Before this, a
 *     doctor-owner could author and sign notes but could not be the visit's
 *     attending clinician: front desk could not queue a patient to the one
 *     doctor most small clinics actually have. The golden path caught it the
 *     first time a credentialed owner-doctor appeared in the staff list.
 */
export function isEligibleAttendingDoctor(staff: Staff): boolean {
  return staff.active && (ELIGIBLE_ATTENDING_ROLES.includes(staff.role) || hasDoctorIdentity(staff));
}

export type AttendingChangeKind = 'CLAIM' | 'TRANSFER' | 'REASSIGN';

/**
 * NOTE ON "UNASSIGNED". `Visit.staffId` is NOT nullable, so a visit with no
 * attending clinician cannot be represented at all — every visit is assigned
 * to whoever registered it. The real-world "unassigned" case is D-044's:
 * front desk registers a walk-in under themselves before anyone knows which
 * doctor will see the patient, so the visit is held by a NON-DOCTOR.
 *
 * That is what CLAIM means here. A genuinely nullable attending clinician is
 * a schema change and is reported as a gap rather than faked with a sentinel
 * staff row.
 */
export function classifyAttendingChange(current: Staff | null, actor: Staff): AttendingChangeKind {
  // S3c — `null` is the honest unassigned state the schema can now hold. The
  // non-doctor case below is the LEGACY shape: rows written while staffId was
  // required, where front desk had to name somebody. Both are a CLAIM.
  if (!current || !isEligibleAttendingDoctor(current)) {
    return 'CLAIM';
  }
  return current.id === actor.id ? 'TRANSFER' : 'REASSIGN';
}

export function assertMayChangeAttendingClinician(
  actor: Staff,
  current: Staff | null,
  target: Staff,
): void {
  assertCanPerformQueueAction(actor, 'ASSIGN_CLINICIAN');

  if (!isEligibleAttendingDoctor(target)) {
    throw new ForbiddenException(
      'Only an active doctor can be recorded as the attending clinician for a visit.',
    );
  }

  const kind = classifyAttendingChange(current, actor);
  const actorIsDoctor = isEligibleAttendingDoctor(actor);

  // Owner and front desk: no further restriction. Assigning and reassigning
  // patients between doctors is the counter's job.
  if (!actorIsDoctor) {
    return;
  }

  if (kind === 'CLAIM') {
    // A doctor picking up a patient nobody is seeing takes them for THEMSELVES.
    // Handing an unclaimed patient to a specific colleague is a scheduling
    // decision, and scheduling belongs to the counter.
    if (target.id !== actor.id) {
      throw new ForbiddenException(
        'You can take this visit yourself, but assigning it to another doctor is done by the front desk.',
      );
    }
    return;
  }

  if (kind === 'REASSIGN') {
    // The one thing this rule exists to prevent: taking a patient who is
    // actively with a colleague. The message says what to do instead rather
    // than naming who currently holds the visit.
    throw new ForbiddenException(
      'This visit is with another doctor. They can transfer it to you, or the front desk can reassign it.',
    );
  }

  // TRANSFER — the actor holds the visit and is handing it on. Permitted.
}

/**
 * A reason is required when a doctor is REPLACED, and not when a visit is
 * simply picked up. "Why did the attending doctor change mid-consultation" is
 * a question a clinic has to be able to answer; "why did a doctor start
 * seeing the walk-in" is not.
 */
export function attendingChangeNeedsReason(kind: AttendingChangeKind): boolean {
  return kind !== 'CLAIM';
}
