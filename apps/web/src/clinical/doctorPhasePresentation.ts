import { DoctorPhaseBlockerCode, DoctorPhaseStatus, DoctorRoutingReason } from './types';

/**
 * G4.5d3c-3a (D-089) — how the Consultation Footer describes the doctor phase.
 *
 * Every function here is a pure mapping over what the SERVER said. Nothing in
 * this file counts a prescription, reads an invoice, inspects an order status
 * or decides whether a visit can be completed — those are D-086/D-088 rules
 * and they live in one place, on the server. The footer's job is to render an
 * answer, not to compute a second one that can disagree with it.
 *
 * The write endpoint stays authoritative. `GET /visits/:id/doctor-phase-status`
 * is advisory: it decides what the doctor SEES, never what is allowed.
 */

// ---------------------------------------------------------------------------
// Blockers
//
// The server already returns these in a stable order (D-088). They are
// re-ordered here anyway, against an explicit list, so the footer's order is a
// property of the footer: a server that grew a sixth code, or returned them
// shuffled, must not silently reshuffle what the doctor reads.
// ---------------------------------------------------------------------------
export const BLOCKER_ORDER: DoctorPhaseBlockerCode[] = [
  'QUEUE_STATE_INELIGIBLE',
  'SIGNED_NOTE_REQUIRED',
  'PROCEDURE_PENDING',
  'MEDICATION_SUPPLY_UNCONFIRMED',
  'MEDICATION_SUPPLY_DEFERRED',
];

/**
 * The owner-approved staff-facing wording. Held here rather than rendered
 * from the server's message so the clinic's words are reviewable in one file
 * — and so no server string can ever put an enum, a column name or a driver
 * error in front of a doctor.
 */
export const BLOCKER_TEXT: Record<DoctorPhaseBlockerCode, string> = {
  QUEUE_STATE_INELIGIBLE: 'This visit is not currently at a stage that can be completed.',
  SIGNED_NOTE_REQUIRED: 'Clinical note must be signed before completing consultation.',
  PROCEDURE_PENDING: 'A procedure is still pending or in progress.',
  MEDICATION_SUPPLY_UNCONFIRMED: 'Medication supply mode must be confirmed.',
  MEDICATION_SUPPLY_DEFERRED: 'Deferred medication supply must be resolved.',
};

/** Canvas sections a blocker can send the doctor to. */
export type CanvasAnchor = 'note' | 'orders' | 'medications';

export interface BlockerView {
  code: DoctorPhaseBlockerCode;
  message: string;
  /**
   * The review action, or null where none is offered. QUEUE_STATE_INELIGIBLE
   * has none: the queue is a front-desk surface and there is no reliable
   * doctor-side queue action to point at. Inventing one would be worse than
   * saying nothing — it would imply the doctor can fix this alone.
   */
  action: { label: string; anchor: CanvasAnchor } | null;
}

const REVIEW_ACTION: Record<DoctorPhaseBlockerCode, { label: string; anchor: CanvasAnchor } | null> = {
  QUEUE_STATE_INELIGIBLE: null,
  // Focuses the EXISTING Clinical Note section. The footer never grows a
  // second signing control: two ways to sign is two things to keep correct,
  // and C0's signing rules live in one component.
  SIGNED_NOTE_REQUIRED: { label: 'Review and Sign Clinical Note', anchor: 'note' },
  // Deliberately NOT "Send to Procedure". No procedure-transition service
  // exists yet, and a button that looks like it moves a patient but does not
  // is worse than no button.
  PROCEDURE_PENDING: { label: 'Review Orders', anchor: 'orders' },
  MEDICATION_SUPPLY_UNCONFIRMED: { label: 'Review Medications', anchor: 'medications' },
  MEDICATION_SUPPLY_DEFERRED: { label: 'Review Medications', anchor: 'medications' },
};

/** Known codes in the approved order; anything unrecognised is dropped. */
export function orderBlockers(
  blockers: Array<{ code: string; message?: string }> | undefined,
): BlockerView[] {
  const seen = new Set((blockers ?? []).map((b) => b.code));
  return BLOCKER_ORDER.filter((code) => seen.has(code)).map((code) => ({
    code,
    message: BLOCKER_TEXT[code],
    action: REVIEW_ACTION[code],
  }));
}

/**
 * The distinct review actions across all blockers, de-duplicated.
 *
 * Two medication blockers produce ONE "Review Medications" button. Two
 * identical buttons side by side reads as a rendering fault and doubles the
 * footer's width for nothing.
 */
export function reviewActions(blockers: BlockerView[]): Array<{ label: string; anchor: CanvasAnchor }> {
  const out: Array<{ label: string; anchor: CanvasAnchor }> = [];
  for (const blocker of blockers) {
    if (blocker.action && !out.some((a) => a.anchor === blocker.action!.anchor)) {
      out.push(blocker.action);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The primary action
//
// Mapped from the server's routing reason, and offered ONLY when the server
// reports no blockers. A derived destination arriving alongside a blocker is
// a preview of where the patient would go, not permission to send them.
// ---------------------------------------------------------------------------
export interface PrimaryAction {
  reason: DoctorRoutingReason;
  label: string;
  supporting: string;
  confirmTitle: string;
  confirmSummary: string;
  /** What the completed footer calls the destination. */
  station: string;
}

const PRIMARY: Record<DoctorRoutingReason, PrimaryAction> = {
  DISPENSARY_REQUIRED: {
    reason: 'DISPENSARY_REQUIRED',
    label: 'Complete & Send to Dispensary',
    supporting: 'Clinic dispensing is required.',
    confirmTitle: 'Complete consultation and send to Dispensary?',
    confirmSummary: 'Billing will be handled after dispensing where applicable.',
    station: 'Dispensary',
  },
  PATIENT_PAYMENT_REQUIRED: {
    reason: 'PATIENT_PAYMENT_REQUIRED',
    label: 'Complete & Send to Payment',
    supporting: 'Patient payment remains.',
    confirmTitle: 'Complete consultation and send to Payment?',
    confirmSummary: 'Patient payment remains.',
    station: 'Payment',
  },
  // Never "Payment Required" and never a figure: the clinic has not worked
  // out what the patient owes, and telling them they owe money nobody has
  // calculated is worse than saying it has not been settled (D-086).
  BILLING_REVIEW_REQUIRED: {
    reason: 'BILLING_REVIEW_REQUIRED',
    label: 'Complete & Send for Billing Review',
    supporting: 'Billing responsibility has not been confirmed.',
    confirmTitle: 'Complete consultation and send for Billing Review?',
    confirmSummary: 'Billing responsibility has not been confirmed.',
    station: 'Billing Review',
  },
  NO_DOWNSTREAM_WORK: {
    reason: 'NO_DOWNSTREAM_WORK',
    label: 'Complete Consultation',
    supporting: 'No downstream clinical, dispensing or patient-payment work is currently required.',
    confirmTitle: 'Complete the Doctor consultation phase?',
    // The one place the footer must be explicit that finishing the
    // consultation does NOT close the visit — this is the branch where a
    // doctor would most reasonably assume it did.
    confirmSummary:
      'The Visit will remain operationally open until an authorised counter user completes it.',
    station: 'No downstream work',
  },
};

export function primaryActionFor(reason: DoctorRoutingReason | null | undefined): PrimaryAction | null {
  return reason ? (PRIMARY[reason] ?? null) : null;
}

// ---------------------------------------------------------------------------
// What the footer is showing
// ---------------------------------------------------------------------------
export type FooterMode = 'LOADING' | 'ELIGIBLE' | 'BLOCKED' | 'COMPLETED' | 'UNAVAILABLE';

export interface FooterView {
  mode: FooterMode;
  blockers: BlockerView[];
  actions: Array<{ label: string; anchor: CanvasAnchor }>;
  primary: PrimaryAction | null;
}

/**
 * The whole footer decision, in one pure function.
 *
 * ELIGIBLE requires all three of: not completed, no blockers, and a routing
 * reason the server actually supplied. The last clause is not belt-and-braces
 * — `PROCEDURE_PENDING` returns a null reason (D-088), and a future blocker
 * that also withholds routing must fall through to BLOCKED rather than
 * rendering a button with no destination behind it.
 */
export function footerView(params: {
  status: DoctorPhaseStatus | undefined;
  loading: boolean;
  failed: boolean;
}): FooterView {
  const empty = { blockers: [] as BlockerView[], actions: [], primary: null };

  if (params.loading || (!params.status && !params.failed)) {
    // Nothing is offered until eligibility is known. A button that appears
    // and then withdraws teaches a doctor to click before reading.
    return { mode: 'LOADING', ...empty };
  }
  if (!params.status) {
    // The read failed. The footer says so and offers nothing; the Canvas and
    // every unsaved word in the editor are untouched, because this component
    // owns none of them.
    return { mode: 'UNAVAILABLE', ...empty };
  }
  if (params.status.completed) {
    return { mode: 'COMPLETED', ...empty };
  }

  const blockers = orderBlockers(params.status.blockers);
  const primary = blockers.length === 0 ? primaryActionFor(params.status.routingReason) : null;
  if (!primary) {
    return { mode: 'BLOCKED', blockers, actions: reviewActions(blockers), primary: null };
  }
  return { mode: 'ELIGIBLE', blockers: [], actions: [], primary };
}

// ---------------------------------------------------------------------------
// The completed summary
//
// Built from STORED values only. Nothing here re-derives a destination, and a
// later invoice payment or dispensing event cannot change a word of it.
// ---------------------------------------------------------------------------
const STATION_FOR_DESTINATION: Record<string, string> = {
  DISPENSARY: 'Dispensary',
  PAYMENT: 'Payment',
  NONE: 'No downstream work',
};

const QUEUE_STATUS_TEXT: Record<string, string> = {
  WAITING: 'Waiting',
  IN_CONSULTATION: 'In consultation',
  AT_PROCEDURE: 'At procedure',
  READY_FOR_DISPENSARY: 'Ready for Dispensary',
  READY_FOR_PAYMENT: 'Ready for Payment',
  DISPENSARY_PAYMENT: 'Dispensary / Payment',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function queueStatusText(status: string | null | undefined): string | null {
  if (!status) return null;
  return QUEUE_STATUS_TEXT[status] ?? null;
}

/**
 * The next station, from the STORED routing reason where there is one.
 *
 * The reason is preferred over the destination because `PAYMENT` has two
 * meanings and only the reason separates them: a patient sent for billing
 * review must never read "Payment". A visit completed before D-087 stored a
 * reason falls back to the destination, which is the honest remainder.
 */
export function completedStation(params: {
  destination: string | null | undefined;
  routingReason: DoctorRoutingReason | null | undefined;
}): string {
  const byReason = primaryActionFor(params.routingReason);
  if (byReason) return byReason.station;
  if (params.destination) return STATION_FOR_DESTINATION[params.destination] ?? 'Not recorded';
  return 'Not recorded';
}

/**
 * What the footer says about the VISIT once the doctor phase is done.
 *
 * `checkOutAt` is the only thing that makes a visit complete (D-087), and
 * this component never sets it. Until it exists the visit is open, whatever
 * the doctor phase says.
 */
export function visitStandingText(checkOutAt: string | null | undefined): string {
  return checkOutAt ? 'Visit completed' : 'Awaiting overall completion';
}
