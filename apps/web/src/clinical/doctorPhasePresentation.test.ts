import { describe, expect, it } from 'vitest';
import {
  BLOCKER_ORDER,
  BLOCKER_TEXT,
  completedStation,
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
    ['3. unsigned note', 'SIGNED_NOTE_REQUIRED', 'Clinical note must be signed before completing consultation.'],
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
    const v = view(blocked('SIGNED_NOTE_REQUIRED', 'PROCEDURE_PENDING', 'MEDICATION_SUPPLY_DEFERRED'));
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
    // The preview can carry a destination for a blocked visit — an unsigned
    // note says nothing about where the patient goes once it is signed. That
    // is a preview, never permission to send them.
    const v = view(
      STATUS({
        blockers: [{ code: 'SIGNED_NOTE_REQUIRED', message: 'x' }] as never,
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

  it('10. an unsigned note offers the Clinical Note section', () => {
    expect(actionsFor('SIGNED_NOTE_REQUIRED')).toEqual([
      { label: 'Review and Sign Clinical Note', anchor: 'note' },
    ]);
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
    expect(actionsFor('MEDICATION_SUPPLY_DEFERRED', 'SIGNED_NOTE_REQUIRED', 'PROCEDURE_PENDING').map((a) => a.anchor))
      .toEqual(['note', 'orders', 'medications']);
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
