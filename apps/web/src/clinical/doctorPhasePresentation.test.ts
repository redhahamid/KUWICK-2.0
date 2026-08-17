import { describe, expect, it } from 'vitest';
import {
  BLOCKER_CHIP,
  BLOCKER_ORDER,
  BLOCKER_TEXT,
  blockerChipLabel,
  DOCUMENTATION_PENDING_ACTION,
  DOCUMENTATION_PENDING_BODY,
  completedStation,
  documentationPendingConfirm,
  footerView,
  orderBlockers,
  primaryActionFor,
  queueStatusText,
  reviewActions,
  visitStandingText,
} from './doctorPhasePresentation';
import { DoctorPhaseStatus } from './types';

// ===========================================================================
// G4.5d3c-3a (D-089) — CONSULTATION FOOTER PRESENTATION
//
// Every rule here is a mapping over what the SERVER said. There is no test
// below that computes an eligibility, counts a prescription or reads an
// invoice, because the footer does none of those things — that is the point.
// ===========================================================================

const STATUS = (over: Partial<DoctorPhaseStatus> = {}): DoctorPhaseStatus => ({
  visitId: 'visit-1',
  completed: false,
  doctorCompletedAt: null,
  doctorCompletedByStaffId: null,
  queueStatus: 'IN_CONSULTATION',
  blockers: [],
  // G4.5d3c-3c — the default fixture has a SIGNED note. Documentation
  // pending is the exception, stated explicitly by the tests that mean it.
  documentationPending: false,
  documentationPendingAtCompletion: null,
  documentationPendingActorName: null,
  documentationPendingAt: null,
  destination: 'NONE',
  routingReason: 'NO_DOWNSTREAM_WORK',
  ...over,
});

const blocked = (...codes: string[]) =>
  STATUS({
    blockers: codes.map((code) => ({ code, message: 'server text' })) as never,
    destination: null,
    routingReason: null,
  });

const view = (status: DoctorPhaseStatus | undefined, over: { loading?: boolean; failed?: boolean } = {}) =>
  footerView({ status, loading: over.loading ?? false, failed: over.failed ?? false });

describe('status loading', () => {
  it('1. no completion action exists before the status resolves', () => {
    const v = view(undefined, { loading: true });
    expect(v.mode).toBe('LOADING');
    expect(v.primary).toBeNull();
    expect(v.blockers).toEqual([]);
  });

  it('1b. an undelivered status is still LOADING, not "eligible by default"', () => {
    expect(view(undefined).mode).toBe('LOADING');
  });

  it('2. a failed read offers nothing and asserts nothing', () => {
    const v = view(undefined, { failed: true });
    expect(v.mode).toBe('UNAVAILABLE');
    expect(v.primary).toBeNull();
  });
});

describe('blocked state', () => {
  it.each([
    // G4.5d3c-3c — 'unsigned note' is deliberately ABSENT from this table.
    // It is no longer a doctor-phase blocker; see the documentation-pending
    // suite below, which asserts what it is instead.
    ['4. pending procedure', 'PROCEDURE_PENDING', 'A procedure is still pending or in progress.'],
    ['5. NULL supply mode', 'MEDICATION_SUPPLY_UNCONFIRMED', 'Medication supply mode must be confirmed.'],
    ['6. DEFERRED supply', 'MEDICATION_SUPPLY_DEFERRED', 'Deferred medication supply must be resolved.'],
    ['queue state', 'QUEUE_STATE_INELIGIBLE', 'This visit is not currently at a stage that can be completed.'],
  ])('%s displays the approved wording', (_n, code, text) => {
    const v = view(blocked(code));
    expect(v.mode).toBe('BLOCKED');
    expect(v.blockers.map((b) => b.message)).toEqual([text]);
  });

  it('7. multiple blockers are shown together, not one at a time', () => {
    const v = view(
      blocked('QUEUE_STATE_INELIGIBLE', 'PROCEDURE_PENDING', 'MEDICATION_SUPPLY_DEFERRED'),
    );
    expect(v.blockers).toHaveLength(3);
  });

  it('8. the display order is stable regardless of the order received', () => {
    const forwards = view(blocked(...BLOCKER_ORDER));
    const backwards = view(blocked(...[...BLOCKER_ORDER].reverse()));
    expect(forwards.blockers.map((b) => b.code)).toEqual(BLOCKER_ORDER);
    expect(backwards.blockers.map((b) => b.code)).toEqual(BLOCKER_ORDER);
  });

  it.each(BLOCKER_ORDER)('9. %s alone removes the completion action', (code) => {
    const v = view(blocked(code));
    expect(v.mode).toBe('BLOCKED');
    expect(v.primary).toBeNull();
  });

  it('9b. a derived destination arriving WITH a blocker does not produce a button', () => {
    // The preview can carry a destination for a blocked visit — an open
    // procedure says nothing about where the patient goes once it closes.
    // That is a preview, never permission to send them.
    const v = view(
      STATUS({
        blockers: [{ code: 'PROCEDURE_PENDING', message: 'x' }] as never,
        destination: 'DISPENSARY',
        routingReason: 'DISPENSARY_REQUIRED',
      }),
    );
    expect(v.mode).toBe('BLOCKED');
    expect(v.primary).toBeNull();
  });

  it('an unrecognised code from a newer server is dropped, not rendered raw', () => {
    // A doctor must never read SOME_NEW_ENUM_VALUE off a clinical screen.
    expect(orderBlockers([{ code: 'SOMETHING_NEW' }])).toEqual([]);
  });

  it('no blocker message contains schema vocabulary', () => {
    // Case-SENSITIVE on the enum-shaped tokens: the approved wording says
    // "Deferred medication supply", which is English, while DEFERRED is the
    // column value a doctor must never read.
    for (const text of Object.values(BLOCKER_TEXT)) {
      expect(text).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
      expect(text).not.toMatch(/visit_|queue_ticket|supply_mode|prisma|postgres|constraint/i);
    }
  });
});

describe('review actions', () => {
  const actionsFor = (...codes: string[]) => reviewActions(orderBlockers(codes.map((code) => ({ code }))));

  it('10. an unsigned note is not a blocker and contributes no blocker action', () => {
    // G4.5d3c-3c — the note action moved to the documentation-pending panel,
    // which offers it WITHOUT withholding the completion button.
    expect(actionsFor('SIGNED_NOTE_REQUIRED')).toEqual([]);
    expect(DOCUMENTATION_PENDING_ACTION).toEqual({
      label: 'Write and Sign Clinical Note',
      anchor: 'note',
    });
  });

  it('11. a pending procedure offers Orders', () => {
    expect(actionsFor('PROCEDURE_PENDING')).toEqual([{ label: 'Review Orders', anchor: 'orders' }]);
  });

  it.each(['MEDICATION_SUPPLY_UNCONFIRMED', 'MEDICATION_SUPPLY_DEFERRED'])(
    '12. %s offers Medications',
    (code) => {
      expect(actionsFor(code)).toEqual([{ label: 'Review Medications', anchor: 'medications' }]);
    },
  );

  it('13. the procedure blocker never offers Send to Procedure', () => {
    // No approved procedure-transition service exists. A button that looks
    // like it moves a patient but does not is worse than no button.
    const labels = actionsFor('PROCEDURE_PENDING').map((a) => a.label);
    expect(labels.join(' ')).not.toMatch(/send to procedure/i);
  });

  it('two medication blockers produce ONE Review Medications button', () => {
    expect(actionsFor('MEDICATION_SUPPLY_UNCONFIRMED', 'MEDICATION_SUPPLY_DEFERRED')).toHaveLength(1);
  });

  it('the queue blocker offers no action rather than an invented one', () => {
    // The queue is a front-desk surface; there is no reliable doctor-side
    // action, and implying one would tell a doctor they can fix this alone.
    expect(actionsFor('QUEUE_STATE_INELIGIBLE')).toEqual([]);
  });

  it('actions follow the blocker order, not the order they were discovered', () => {
    expect(actionsFor('MEDICATION_SUPPLY_DEFERRED', 'PROCEDURE_PENDING').map((a) => a.anchor))
      .toEqual(['orders', 'medications']);
  });
});

describe('primary action mapping', () => {
  const eligible = (reason: string) =>
    view(STATUS({ routingReason: reason as never, destination: 'PAYMENT' }));

  it('14. DISPENSARY_REQUIRED maps to Complete & Send to Dispensary', () => {
    const v = eligible('DISPENSARY_REQUIRED');
    expect(v.mode).toBe('ELIGIBLE');
    expect(v.primary?.label).toBe('Complete & Send to Dispensary');
    expect(v.primary?.supporting).toBe('Clinic dispensing is required.');
  });

  it('15. PATIENT_PAYMENT_REQUIRED maps to Complete & Send to Payment', () => {
    expect(eligible('PATIENT_PAYMENT_REQUIRED').primary?.label).toBe('Complete & Send to Payment');
  });

  it('16. BILLING_REVIEW_REQUIRED maps to Complete & Send for Billing Review', () => {
    expect(eligible('BILLING_REVIEW_REQUIRED').primary?.label).toBe('Complete & Send for Billing Review');
  });

  it('17. billing review is never described as payment due', () => {
    const action = primaryActionFor('BILLING_REVIEW_REQUIRED');
    const words = `${action?.label} ${action?.supporting} ${action?.confirmTitle} ${action?.confirmSummary} ${action?.station}`;
    expect(words).not.toMatch(/payment required|payment due|amount due|owes/i);
    expect(action?.supporting).toBe('Billing responsibility has not been confirmed.');
    expect(action?.station).toBe('Billing Review');
  });

  it('18. NO_DOWNSTREAM_WORK maps to Complete Consultation', () => {
    const v = eligible('NO_DOWNSTREAM_WORK');
    expect(v.primary?.label).toBe('Complete Consultation');
    expect(v.primary?.supporting).toBe(
      'No downstream clinical, dispensing or patient-payment work is currently required.',
    );
  });

  it('19. no mapping anywhere produces "Complete Visit"', () => {
    // Closing the visit is counter work under a different permission (D-087).
    // The doctor is never offered it, in any branch.
    for (const reason of [
      'DISPENSARY_REQUIRED',
      'PATIENT_PAYMENT_REQUIRED',
      'BILLING_REVIEW_REQUIRED',
      'NO_DOWNSTREAM_WORK',
    ] as const) {
      const action = primaryActionFor(reason);
      expect(action?.label).not.toMatch(/complete visit/i);
      expect(action?.confirmTitle).not.toMatch(/complete visit/i);
    }
  });

  it('a null routing reason yields no action even with no blockers', () => {
    // PROCEDURE_PENDING withholds routing (D-088). Belt and braces for a
    // future blocker that does the same: no reason, no button.
    const v = view(STATUS({ blockers: [], destination: null, routingReason: null }));
    expect(v.mode).toBe('BLOCKED');
    expect(v.primary).toBeNull();
  });
});

describe('confirmation copy', () => {
  it('20. the destination is not offered as a choice anywhere in the copy', () => {
    for (const reason of [
      'DISPENSARY_REQUIRED',
      'PATIENT_PAYMENT_REQUIRED',
      'BILLING_REVIEW_REQUIRED',
      'NO_DOWNSTREAM_WORK',
    ] as const) {
      const action = primaryActionFor(reason);
      expect(action?.confirmTitle).not.toMatch(/choose|select|where would|pick/i);
    }
  });

  it.each([
    ['DISPENSARY_REQUIRED', 'Complete consultation and send to Dispensary?'],
    ['PATIENT_PAYMENT_REQUIRED', 'Complete consultation and send to Payment?'],
    ['BILLING_REVIEW_REQUIRED', 'Complete consultation and send for Billing Review?'],
    ['NO_DOWNSTREAM_WORK', 'Complete the Doctor consultation phase?'],
  ])('21. %s shows its approved title', (reason, title) => {
    expect(primaryActionFor(reason as never)?.confirmTitle).toBe(title);
  });

  it('21b. NO_DOWNSTREAM_WORK says the visit stays open', () => {
    // The branch where a doctor would most reasonably assume completing the
    // consultation closed the visit. It does not.
    expect(primaryActionFor('NO_DOWNSTREAM_WORK')?.confirmSummary).toBe(
      'The Visit will remain operationally open until an authorised counter user completes it.',
    );
  });
});

describe('completed state', () => {
  const done = (over: Partial<DoctorPhaseStatus> = {}) =>
    view(
      STATUS({
        completed: true,
        doctorCompletedAt: '2026-08-03T10:03:00.000Z',
        doctorCompletedByStaffId: 'dr-a',
        ...over,
      }),
    );

  it('24. a completed phase renders the completed mode and no action', () => {
    const v = done({ destination: 'DISPENSARY', routingReason: 'DISPENSARY_REQUIRED' });
    expect(v.mode).toBe('COMPLETED');
    expect(v.primary).toBeNull();
    expect(v.blockers).toEqual([]);
  });

  it('24b. a completed phase shows no blockers even from an ineligible queue state', () => {
    const v = done({ queueStatus: 'COMPLETED', blockers: [{ code: 'QUEUE_STATE_INELIGIBLE', message: 'x' }] as never });
    expect(v.blockers).toEqual([]);
  });

  it('25. the queue status is rendered from the server value', () => {
    expect(queueStatusText('READY_FOR_DISPENSARY')).toBe('Ready for Dispensary');
    expect(queueStatusText('READY_FOR_PAYMENT')).toBe('Ready for Payment');
    expect(queueStatusText(null)).toBeNull();
    // An unknown status is omitted rather than printed raw.
    expect(queueStatusText('SOME_NEW_STAGE')).toBeNull();
  });

  it('26. checkOutAt NULL is never described as an overall completion', () => {
    expect(visitStandingText(null)).toBe('Awaiting overall completion');
    expect(visitStandingText(undefined)).toBe('Awaiting overall completion');
    expect(visitStandingText('2026-08-03T11:00:00.000Z')).toBe('Visit completed');
  });

  it('28. the STORED routing reason names the station', () => {
    expect(completedStation({ destination: 'PAYMENT', routingReason: 'BILLING_REVIEW_REQUIRED' })).toBe(
      'Billing Review',
    );
    expect(completedStation({ destination: 'PAYMENT', routingReason: 'PATIENT_PAYMENT_REQUIRED' })).toBe('Payment');
    expect(completedStation({ destination: 'DISPENSARY', routingReason: 'DISPENSARY_REQUIRED' })).toBe('Dispensary');
    expect(completedStation({ destination: 'NONE', routingReason: 'NO_DOWNSTREAM_WORK' })).toBe('No downstream work');
  });

  it('28b. a billing-review visit never reads "Payment" on the completed bar', () => {
    // PAYMENT has two meanings and only the stored reason separates them.
    expect(completedStation({ destination: 'PAYMENT', routingReason: 'BILLING_REVIEW_REQUIRED' })).not.toBe('Payment');
  });

  it('a pre-D-087 visit with no stored reason falls back to the destination', () => {
    expect(completedStation({ destination: 'DISPENSARY', routingReason: null })).toBe('Dispensary');
    expect(completedStation({ destination: null, routingReason: null })).toBe('Not recorded');
  });

  it.each([
    ['29. a later invoice payment', { destination: 'DISPENSARY', routingReason: 'DISPENSARY_REQUIRED' }],
    ['30. a later dispensing event', { destination: 'PAYMENT', routingReason: 'PATIENT_PAYMENT_REQUIRED' }],
  ])('%s cannot change the completed display', (_n, stored) => {
    // Nothing in this module reads an invoice or a prescription, so there is
    // no input by which later billing or dispensing could reach it. Same
    // stored values in, same words out, forever.
    const first = completedStation(stored as never);
    const second = completedStation(stored as never);
    expect(first).toBe(second);
    expect(Object.keys(stored)).toEqual(['destination', 'routingReason']);
  });
});

// ===========================================================================
// G4.5d3c-3c — DOCUMENTATION PENDING
//
// The owner's rule in one sentence: an empty, unsaved or unsigned clinical
// note must not stop a patient being sent to the Dispensary or to Billing.
// Every test below is a way of asking whether that is still true.
// ===========================================================================
describe('documentation pending — the state, not a blocker', () => {
  it('31. an unsigned note does not withhold the completion action', () => {
    const v = view(STATUS({ documentationPending: true }));
    expect(v.mode).toBe('ELIGIBLE');
    expect(v.primary).not.toBeNull();
    expect(v.blockers).toEqual([]);
  });

  it('32. it is reported as documentation pending rather than as a blocker', () => {
    const v = view(STATUS({ documentationPending: true }));
    expect(v.documentationPending).toBe(true);
    expect(v.blockers.map((b) => b.code)).not.toContain('SIGNED_NOTE_REQUIRED');
  });

  it('33. it is AMBER, and a real blocker is RED', () => {
    expect(view(STATUS({ documentationPending: true })).tone).toBe('PENDING');
    expect(view(blocked('PROCEDURE_PENDING')).tone).toBe('BLOCKED');
  });

  it('34. a signed note is neutral, not amber', () => {
    const v = view(STATUS({ documentationPending: false }));
    expect(v.tone).toBe('NEUTRAL');
    expect(v.documentationPending).toBe(false);
  });

  it('35. documentation pending routes to every destination unchanged', () => {
    for (const reason of ['DISPENSARY_REQUIRED', 'PATIENT_PAYMENT_REQUIRED', 'BILLING_REVIEW_REQUIRED'] as const) {
      const v = view(STATUS({ documentationPending: true, routingReason: reason, destination: 'PAYMENT' }));
      expect(v.mode).toBe('ELIGIBLE');
      expect(v.primary?.reason).toBe(reason);
    }
  });

  it('36. a genuine blocker still wins — amber never overrides red', () => {
    const v = view(
      STATUS({
        documentationPending: true,
        blockers: [{ code: 'PROCEDURE_PENDING', message: 'x' }] as never,
        destination: null,
        routingReason: null,
      }),
    );
    expect(v.mode).toBe('BLOCKED');
    expect(v.tone).toBe('BLOCKED');
    expect(v.primary).toBeNull();
  });

  it('37. the confirmation asks the owner-approved question', () => {
    const primary = primaryActionFor('DISPENSARY_REQUIRED')!;
    expect(documentationPendingConfirm(primary).title).toBe('Send Patient with documentation pending?');
  });

  it('38. the confirmation promises no auto-save and no auto-sign', () => {
    const { summary } = documentationPendingConfirm(primaryActionFor('DISPENSARY_REQUIRED')!);
    expect(summary).toMatch(/nothing is saved or signed on your behalf/i);
    expect(summary).toMatch(/cannot be closed until the note is signed/i);
    expect(summary).toMatch(/recorded against you/i);
  });

  it('39. the pending wording says the patient may go now', () => {
    expect(DOCUMENTATION_PENDING_BODY).toMatch(/can be sent on now/i);
    expect(DOCUMENTATION_PENDING_BODY).toMatch(/visit stays open until the note is signed/i);
  });

  it('40. the pending panel offers the note section without withholding the action', () => {
    expect(DOCUMENTATION_PENDING_ACTION.anchor).toBe('note');
    expect(view(STATUS({ documentationPending: true })).primary).not.toBeNull();
  });

  it('41. no user-facing documentation wording leaks an enum or a column name', () => {
    for (const text of [DOCUMENTATION_PENDING_BODY, DOCUMENTATION_PENDING_ACTION.label]) {
      expect(text).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
      expect(text).not.toMatch(/clinical_note|signed_at|prisma|postgres/i);
    }
  });
});

describe('documentation pending — after completion', () => {
  const completed = (over: Partial<DoctorPhaseStatus> = {}) =>
    view(
      STATUS({
        completed: true,
        doctorCompletedAt: '2026-08-06T02:00:00.000Z',
        doctorCompletedByStaffId: 'dr-a',
        ...over,
      }),
    );

  it('42. a visit sent on with documentation pending, still unsigned, stays amber', () => {
    const v = completed({ documentationPendingAtCompletion: true, documentationPending: true });
    expect(v.mode).toBe('COMPLETED');
    expect(v.documentationPending).toBe(true);
    expect(v.tone).toBe('PENDING');
  });

  it('43. signing afterwards clears the amber note', () => {
    // The RECORD of what happened is kept on the workflow event and is not
    // rewritten; what the footer stops showing is the outstanding-work notice,
    // because there is no longer any outstanding work.
    const v = completed({ documentationPendingAtCompletion: true, documentationPending: false });
    expect(v.documentationPending).toBe(false);
    expect(v.tone).toBe('NEUTRAL');
  });

  it('44. a visit completed with the note already signed is never amber', () => {
    const v = completed({ documentationPendingAtCompletion: false, documentationPending: false });
    expect(v.tone).toBe('NEUTRAL');
  });

  it('45. a pre-3c visit with nothing recorded falls back to the live answer', () => {
    // NULL means "not recorded", which is not "documentation was complete".
    expect(completed({ documentationPendingAtCompletion: null, documentationPending: true }).documentationPending).toBe(true);
    expect(completed({ documentationPendingAtCompletion: null, documentationPending: false }).documentationPending).toBe(false);
  });

  it('46. a completed phase never offers a completion action, pending or not', () => {
    expect(completed({ documentationPending: true }).primary).toBeNull();
    expect(completed({ documentationPending: false }).primary).toBeNull();
  });
});


// ===========================================================================
// b4 PIECE C (2b) — WHAT IS OUTSTANDING, NAMED.
//
// The one-line completion control said "1 item outstanding" beside a running
// total, and a doctor could not tell from it whether a medicine was waiting on
// a decision only they could make, or whether the visit was at the wrong queue
// stage. Different problems, different actions.
// ===========================================================================
describe('the outstanding chip names what is outstanding', () => {
  it('names a single blocker rather than counting it', () => {
    const blockers = orderBlockers([{ code: 'MEDICATION_SUPPLY_UNCONFIRMED' }]);
    expect(blockerChipLabel(blockers)).toBe('supply mode to confirm');
  });

  it('names EVERY kind when several are outstanding, in the approved order', () => {
    const blockers = orderBlockers([
      { code: 'MEDICATION_SUPPLY_UNCONFIRMED' },
      { code: 'PROCEDURE_PENDING' },
    ]);
    // Showing one and counting the rest is how a doctor ends up opening the
    // popover to learn the same thing twice.
    expect(blockerChipLabel(blockers)).toBe('procedure pending · supply mode to confirm');
  });

  it('every known blocker has a chip name — a missing one would silently count instead', () => {
    for (const code of BLOCKER_ORDER) {
      expect(BLOCKER_CHIP[code], code).toBeTruthy();
    }
  });
});
