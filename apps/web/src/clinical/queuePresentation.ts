import { QueueTicketStatus } from './types';

/**
 * G4.5d3c-3b (D-095) — how the queue describes itself to counter staff.
 *
 * One table, replacing the three partial copies the audit found: the queue
 * page's five-colour map (which rendered raw enum names and had no entry for
 * the three newest statuses), and the doctor-phase module's private label map.
 *
 * House rule, kept: an unknown code falls back to null, never to a raw enum
 * string in front of staff.
 */
export type QueueStage = 'WAITING' | 'CONSULTATION' | 'DISPENSARY' | 'PAYMENT' | 'COMPLETED';

/** The Live Patient Flow's reading order. A visit may legitimately skip stages. */
export const QUEUE_STAGE_ORDER: QueueStage[] = [
  'WAITING',
  'CONSULTATION',
  'DISPENSARY',
  'PAYMENT',
  'COMPLETED',
];

export const STAGE_LABEL: Record<QueueStage, string> = {
  WAITING: 'Waiting',
  CONSULTATION: 'Consultation',
  DISPENSARY: 'Dispensary',
  PAYMENT: 'Payment',
  COMPLETED: 'Completed',
};

const STATUS_LABEL: Record<QueueTicketStatus, string> = {
  WAITING: 'Waiting',
  IN_CONSULTATION: 'In consultation',
  AT_PROCEDURE: 'At procedure',
  READY_FOR_DISPENSARY: 'Ready for dispensary',
  READY_FOR_PAYMENT: 'Ready for payment',
  // Kept explicit rather than hidden: these rows predate the split and staff
  // need to know why they look different.
  DISPENSARY_PAYMENT: 'Dispensary/Payment — Legacy',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const STATUS_COLOR: Record<QueueTicketStatus, string> = {
  WAITING: 'gold',
  IN_CONSULTATION: 'blue',
  AT_PROCEDURE: 'geekblue',
  READY_FOR_DISPENSARY: 'purple',
  READY_FOR_PAYMENT: 'orange',
  DISPENSARY_PAYMENT: 'default',
  COMPLETED: 'green',
  CANCELLED: 'default',
};

export function queueStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return STATUS_LABEL[status as QueueTicketStatus] ?? null;
}

export function queueStatusColor(status: string | null | undefined): string {
  if (!status) return 'default';
  return STATUS_COLOR[status as QueueTicketStatus] ?? 'default';
}

/**
 * The billing state of a queue row, in counter language. UNRESOLVED is
 * deliberately not "RM 0.00": an unconfirmed split is not a settled bill.
 */
export type QueueBillingState = 'NO_INVOICE' | 'UNRESOLVED' | 'BALANCE_DUE' | 'SETTLED';

export const BILLING_STATE_LABEL: Record<QueueBillingState, string> = {
  NO_INVOICE: 'No invoice raised',
  UNRESOLVED: 'Responsibility not confirmed',
  BALANCE_DUE: 'Patient balance due',
  SETTLED: 'Patient settled',
};

export const BILLING_STATE_COLOR: Record<QueueBillingState, string> = {
  NO_INVOICE: 'default',
  UNRESOLVED: 'gold',
  BALANCE_DUE: 'orange',
  SETTLED: 'green',
};

/**
 * Dispensing progress in words. "3 of 4 dispensed" beats a bare fraction, and
 * a visit with no clinic medication says so rather than showing "0 of 0".
 */
export function dispensingLabel(d: { onsiteTotal: number; dispensed: number; remaining: number }): string {
  if (d.onsiteTotal === 0) return 'No clinic medication';
  if (d.remaining === 0) return `All ${d.onsiteTotal} dispensed`;
  return `${d.dispensed} of ${d.onsiteTotal} dispensed · ${d.remaining} remaining`;
}

/**
 * Blocker guidance for the QUEUE. Same codes as Billing Review, but the
 * destinations differ: from the queue, a clinical blocker sends you to the
 * clinical visit, a money blocker to Billing Review. Counter staff are never
 * offered a clinical action to clear a clinical blocker.
 */
export type BlockerDestination = 'CLINICAL_VISIT' | 'BILLING_REVIEW' | 'CONSULTATION_TARIFFS' | 'NONE';

export interface QueueBlockerGuidance {
  title: string;
  who: string;
  action: string;
  destination: BlockerDestination;
}

const BLOCKER_GUIDANCE: Record<string, QueueBlockerGuidance> = {
  DOCTOR_PHASE_NOT_COMPLETED: {
    title: 'The doctor consultation phase has not been completed.',
    who: 'Attending doctor',
    action: 'Open the clinical visit so the doctor can finish their phase.',
    destination: 'CLINICAL_VISIT',
  },
  // G4.5d6 — CLINICAL_DOCUMENTATION_PENDING was removed here too. The server
  // no longer raises it, and counter staff should never again see a visit
  // held open with "the doctor signs the note to release this visit": the
  // note is finalized by completing the visit, not the other way round.
  PROCEDURE_PENDING: {
    title: 'A procedure is still pending or in progress.',
    who: 'Clinical staff',
    action: 'Open the clinical visit. Counter staff must not mark a procedure done.',
    destination: 'CLINICAL_VISIT',
  },
  MEDICATION_SUPPLY_UNCONFIRMED: {
    title: 'Medication supply mode must be confirmed.',
    who: 'Prescriber',
    action: 'Open the clinical visit so the prescriber can set how each medication is supplied.',
    destination: 'CLINICAL_VISIT',
  },
  MEDICATION_SUPPLY_DEFERRED: {
    title: 'Deferred medication supply must be resolved.',
    who: 'Prescriber',
    action: 'Open the clinical visit so the prescriber can confirm the final supply mode.',
    destination: 'CLINICAL_VISIT',
  },
  DISPENSING_PENDING: {
    title: 'Medication dispensing is not complete.',
    who: 'Dispensary',
    action: 'Open the clinical visit to dispense. This cannot be waived — not by anyone.',
    destination: 'CLINICAL_VISIT',
  },
  BILLING_REVIEW_REQUIRED: {
    title: 'Billing responsibility has not been confirmed.',
    who: 'Counter or finance staff',
    action: 'Open Billing Review and confirm the panel benefit.',
    destination: 'BILLING_REVIEW',
  },
  PATIENT_BALANCE_REMAINING: {
    title: 'Patient payment is still outstanding.',
    who: 'Counter staff',
    action: 'Open Billing Review and record the payment.',
    destination: 'BILLING_REVIEW',
  },
  UNBILLED_CHARGEABLE_ITEMS: {
    title: 'Billing contains items that have not been invoiced.',
    who: 'Counter staff',
    action: 'Open Billing Review and add each ready item.',
    destination: 'BILLING_REVIEW',
  },
  CONSULTATION_TARIFF_REVIEW_REQUIRED: {
    title: 'Consultation tariff requires review.',
    who: 'Finance staff or the clinic owner',
    action: 'Open Billing Review, or configure a covering tariff in Clinic Settings.',
    destination: 'BILLING_REVIEW',
  },
  QUEUE_STATE_INELIGIBLE: {
    title: 'This visit is not currently at a stage that can be completed.',
    who: 'Counter staff',
    action: 'The visit must reach dispensary or payment before it can be completed.',
    destination: 'NONE',
  },
};

export function queueBlockerGuidance(code: string, fallbackMessage: string): QueueBlockerGuidance {
  return (
    BLOCKER_GUIDANCE[code] ?? {
      title: fallbackMessage,
      who: 'Counter staff',
      action: 'Review this visit before completing it.',
      destination: 'NONE',
    }
  );
}

/**
 * The one-line reason a completion button is unavailable. Never a bare
 * "disabled": a control that refuses without saying why is a support call.
 */
export function completionDisabledReason(row: {
  canComplete: boolean;
  blockers: Array<{ code: string; message: string }> | null;
  checkOutAt: string | null;
  status: QueueTicketStatus;
}): string | null {
  if (row.canComplete) return null;
  if (row.checkOutAt) return 'This visit is already completed.';
  if (row.status === 'CANCELLED') return 'This visit was cancelled.';
  if (row.blockers === null) return 'This visit is not yet at a stage that can be completed.';
  if (row.blockers.length === 1) return queueBlockerGuidance(row.blockers[0].code, row.blockers[0].message).title;
  if (row.blockers.length > 1) return `${row.blockers.length} items are outstanding.`;
  return 'Your role is not permitted to complete a visit.';
}

export function money(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return `RM ${Number(value).toFixed(2)}`;
}
