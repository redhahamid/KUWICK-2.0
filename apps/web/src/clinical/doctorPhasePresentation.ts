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
  PROCEDURE_PENDING: 'A procedure is still pending or in progress.',
  MEDICATION_SUPPLY_UNCONFIRMED: 'Medication supply mode must be confirmed.',
  MEDICATION_SUPPLY_DEFERRED: 'Deferred medication supply must be resolved.',
};

/**
 * G4.5d3c-3c — the DOCUMENTATION PENDING wording, kept apart from the blocker
 * texts on purpose.
 *
 * A blocker says "you cannot do this". Documentation pending says "you can do
 * this, and here is what will still be outstanding afterwards". Putting the
 * two in one map is how the second quietly acquires the tone of the first —
 * and it is exactly the conflation that had a doctor holding a patient in the
 * room until the prose was finished.
 */
export const DOCUMENTATION_PENDING_TITLE = 'Documentation pending';
export const DOCUMENTATION_PENDING_BODY =
  'The clinical note for this visit has not been signed. The patient can be sent on now; the visit stays open until the note is signed.';
export const DOCUMENTATION_PENDING_ACTION = { label: 'Write and Sign Clinical Note', anchor: 'note' as const };

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

/**
 * G4.5d3c-3c — the four cases the footer must tell apart, and the ONE thing
 * that distinguishes them visually.
 *
 *   A. ELIGIBLE, documentation complete   — neutral. Send the patient on.
 *   B. ELIGIBLE, documentation pending    — AMBER. Send the patient on, and
 *                                           say plainly what will still be
 *                                           outstanding.
 *   C. BLOCKED                            — RED. The patient does not move.
 *   D. COMPLETED                          — the recorded outcome, carrying an
 *                                           amber note where the patient was
 *                                           sent on with documentation
 *                                           pending.
 *
 * Amber and red are not decoration. Red had come to mean two different things
 * on this bar — "you cannot proceed" and "you have not finished writing" —
 * and a doctor who sees the same alarm for both learns to read neither. Amber
 * is reserved for a state that permits the action; red is reserved for one
 * that forbids it. Nothing else is allowed to use red here.
 */
export type FooterTone = 'NEUTRAL' | 'PENDING' | 'BLOCKED';

export interface FooterView {
  mode: FooterMode;
  tone: FooterTone;
  blockers: BlockerView[];
  actions: Array<{ label: string; anchor: CanvasAnchor }>;
  primary: PrimaryAction | null;
  /** True when the consultation may finish but the note is not signed. */
  documentationPending: boolean;
  /** KW2-C2 — the allergy checkpoint's two lists, or null. */
  allergyCheckpoint: { allergies: string[]; prescribedMedications: string[] } | null;
  /**
   * KW2-C2 — carried-over medications nobody has re-read yet, by name.
   *
   * Reported, NEVER a blocker. Copying a prescription forward is a fresh
   * prescribing decision taken from old information; the weight, the allergies
   * and the stock have all had time to change since. So finishing with one
   * unreviewed is a real clinical choice and the confirmation says so — but it
   * is still allowed, because a refusal would only teach people to tick
   * "reviewed" without reading, which is worse than the state it prevents.
   */
  unreviewedCopies: string[];
}

/**
 * The whole footer decision, in one pure function.
 *
 * ELIGIBLE requires all three of: not completed, no blockers, and a routing
 * reason the server actually supplied. The last clause is not belt-and-braces
 * — `PROCEDURE_PENDING` returns a null reason (D-088), and a future blocker
 * that also withholds routing must fall through to BLOCKED rather than
 * rendering a button with no destination behind it.
 *
 * G4.5d3c-3c — `documentationPending` never affects the MODE. It is reported
 * beside whatever the mode is, so an unsigned note cannot withhold the
 * primary action and cannot dress itself as a blocker.
 */
export function footerView(params: {
  status: DoctorPhaseStatus | undefined;
  loading: boolean;
  failed: boolean;
}): FooterView {
  const empty = {
    blockers: [] as BlockerView[],
    actions: [],
    primary: null,
    documentationPending: false,
    unreviewedCopies: [] as string[],
    allergyCheckpoint: null,
    tone: 'NEUTRAL' as FooterTone,
  };

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

  // A phase completed before 3c recorded the state reports NULL, and NULL is
  // not "documentation was complete". The live value is used for the amber
  // note in that case, because it is the only true thing available.
  const pendingNow = params.status.documentationPending === true;
  // Absent, not empty, on an API that predates this. `?? []` collapses the two
  // — which is right ONLY because the list is used to ADD a warning, never to
  // withhold one: an older server simply asks the ordinary question.
  const unreviewedCopies = params.status.unreviewedCopiedMedications ?? [];
  const allergyCheckpoint = params.status.allergyCheckpoint ?? null;

  if (params.status.completed) {
    const pendingThen = params.status.documentationPendingAtCompletion;
    const stillPending = pendingThen === null ? pendingNow : pendingThen && pendingNow;
    return {
      ...empty,
      mode: 'COMPLETED',
      documentationPending: stillPending,
      unreviewedCopies,
      allergyCheckpoint,
      tone: stillPending ? 'PENDING' : 'NEUTRAL',
    };
  }

  const blockers = orderBlockers(params.status.blockers);
  const primary = blockers.length === 0 ? primaryActionFor(params.status.routingReason) : null;
  if (!primary) {
    // Case C. Red, and the documentation state is not shown alongside it: a
    // doctor facing a genuine blocker does not need a second, softer problem
    // competing for the same glance.
    return {
      mode: 'BLOCKED',
      tone: 'BLOCKED',
      blockers,
      actions: reviewActions(blockers),
      primary: null,
      documentationPending: pendingNow,
      unreviewedCopies,
      allergyCheckpoint,
    };
  }
  // Cases A and B — identical except for the tone and the amber note.
  return {
    mode: 'ELIGIBLE',
    tone: pendingNow ? 'PENDING' : 'NEUTRAL',
    blockers: [],
    actions: [],
    primary,
    documentationPending: pendingNow,
    unreviewedCopies,
    allergyCheckpoint,
  };
}

/**
 * The confirmation a doctor sees when sending a patient on before the note is
 * written.
 *
 * The owner's wording. It is a distinct question from the ordinary
 * confirmation because it asserts something extra, and it names the
 * consequence rather than implying that the software will handle it: nothing
 * auto-saves, nothing auto-signs, and the visit will not close until a human
 * signs the note.
 */
export function documentationPendingConfirm(primary: PrimaryAction): {
  title: string;
  summary: string;
} {
  return {
    title: 'Send Patient with documentation pending?',
    summary: [
      `${primary.supporting} The clinical note has not been signed.`,
      'Your draft is kept exactly as you left it — nothing is saved or signed on your behalf.',
      'This visit cannot be closed until the note is signed, and this action is recorded against you with the time.',
    ].join(' '),
  };
}

// ---------------------------------------------------------------------------
// KW2-C2 — completing with carried-over medications nobody re-read
//
// The owner's rule, in full: dispensing is NOT blocked by the flag, and
// completion is not refused — but it must be a conscious click. So the
// confirmation changes shape rather than the button disappearing: a different
// question, the medicines NAMED, and an OK that says what is being accepted.
//
// Named, never counted. "2 copied medications not reviewed" is not something a
// doctor can act on from the dialog; "Syr Paracetamol, Bromhexine" is — they
// either recognise those as still right for this patient or they cancel.
// ---------------------------------------------------------------------------
export const UNREVIEWED_COPIES_TITLE = 'Copied medications not reviewed';
export const UNREVIEWED_COPIES_OK = 'Complete anyway';

/**
 * KW2-C2 — ONE consolidated checkpoint, never a stack of dialogs.
 *
 * Two things can be outstanding at completion, and they used to want a dialog
 * each. Stacking them is how the second gets clicked through without being
 * read: by the time it appears the doctor has already decided to proceed, and
 * the second box is an obstacle rather than a question.
 *
 * So there is one dialog with up to two sections, and the wording of the whole
 * thing changes to match what is actually in it.
 */
export const CHECKPOINT_TITLE = 'Before completing this consultation';
export const CHECKPOINT_BACK = 'Back to review';
export const CHECKPOINT_PROCEED = 'Proceed & complete';
export const ALLERGY_CHECKPOINT_HEADING = 'This patient has recorded allergies';
export const ALLERGY_CHECKPOINT_CONFIRM =
  'Confirm you have checked the prescribed medications against these.';
export const ALLERGY_CHECKPOINT_LIMIT =
  'Kuwick does not cross-check medicines against allergies. Only you can.';

/** "2 copied medications not reviewed: Syr PCM, Bromhexine". */
export function unreviewedCopiesLine(names: string[]): string {
  const noun = names.length === 1 ? 'copied medication' : 'copied medications';
  const verb = names.length === 1 ? 'has' : 'have';
  return `${names.length} ${noun} ${verb} not been reviewed: ${names.join(', ')}`;
}

export interface CompletionConfirm {
  title: string;
  summary: string;
  okText: string;
  cancelText: string;
  /** The amber block, or null. Present ONLY for unreviewed copies. */
  warning: { line: string; explanation: string } | null;
  /** The allergy section, or null when there is nothing to compare. */
  allergy: {
    heading: string;
    allergies: string[];
    prescribedMedications: string[];
    confirm: string;
    limitation: string;
  } | null;
  /**
   * True when the dialog is a SAFETY CHECKPOINT rather than an ordinary
   * confirmation. The Canvas uses it to put default focus on "Back to
   * review" — the button that does nothing — so a reflex Enter cannot
   * complete a visit past an unread warning.
   */
  checkpoint: boolean;
}

/**
 * The one confirmation the footer shows, across every combination of state.
 *
 * Precedence when both apply: the unreviewed-copies question wins the TITLE
 * and the OK label, because it is the one asking the doctor to accept a
 * clinical risk. Documentation pending is still stated in the summary — it is
 * no longer a task since G4.5d6 auto-finalizes the note, so it does not need
 * to own the question, only to be true and visible.
 */
export function completionConfirm(params: {
  primary: PrimaryAction;
  documentationPending: boolean;
  unreviewedCopies: string[];
  allergyCheckpoint?: { allergies: string[]; prescribedMedications: string[] } | null;
}): CompletionConfirm {
  const base = params.documentationPending
    ? documentationPendingConfirm(params.primary)
    : { title: params.primary.confirmTitle, summary: params.primary.confirmSummary };

  const allergy = params.allergyCheckpoint?.allergies.length
    ? {
        heading: ALLERGY_CHECKPOINT_HEADING,
        // Verbatim, both lists. The doctor is being asked to confirm a
        // comparison, and a dialog that names neither side is a box to tick.
        allergies: params.allergyCheckpoint.allergies,
        prescribedMedications: params.allergyCheckpoint.prescribedMedications,
        confirm: ALLERGY_CHECKPOINT_CONFIRM,
        // Says plainly what the software did NOT do. Silence here would let
        // the dialog imply a check ran and passed.
        limitation: ALLERGY_CHECKPOINT_LIMIT,
      }
    : null;

  const warning = params.unreviewedCopies.length
    ? {
        line: unreviewedCopiesLine(params.unreviewedCopies),
        // States what the flag MEANS and nothing more. It is not a safety
        // check, it does not know whether the medicine is still right, and it
        // must not be written as though it does.
        explanation:
          'These were carried over from an earlier visit and nobody has re-read them on this one. Proceed only if they are still right for this patient today.',
      }
    : null;

  // Neither → the ordinary confirmation, unchanged.
  if (!allergy && !warning) {
    return {
      ...base,
      okText: params.primary.label,
      cancelText: 'Cancel',
      warning: null,
      allergy: null,
      checkpoint: false,
    };
  }

  // Either or both → ONE dialog. The title is the checkpoint's, not the
  // individual sections': two sections under two competing headings is the
  // stack this exists to avoid, drawn in one window.
  return {
    title: allergy ? CHECKPOINT_TITLE : UNREVIEWED_COPIES_TITLE,
    summary: base.summary,
    okText: allergy ? CHECKPOINT_PROCEED : UNREVIEWED_COPIES_OK,
    cancelText: allergy ? CHECKPOINT_BACK : 'Cancel',
    warning,
    allergy,
    checkpoint: true,
  };
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
