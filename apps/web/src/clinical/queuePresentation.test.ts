import { describe, expect, it } from 'vitest';
import { QueueTicketStatus } from './types';
import {
  BILLING_STATE_LABEL,
  QUEUE_STAGE_ORDER,
  STAGE_LABEL,
  completionDisabledReason,
  dispensingLabel,
  money,
  queueBlockerGuidance,
  queueStatusColor,
  queueStatusLabel,
} from './queuePresentation';

// ===========================================================================
// G4.5d3c-3b (D-095) — how the queue describes itself.
//
// The defect this replaces: a five-entry colour map that rendered raw enum
// names and had no entry at all for the three newest statuses. Pinned here:
// every status has words, no raw enum escapes, and a disabled completion
// always states its reason.
// ===========================================================================

const ALL_STATUSES: QueueTicketStatus[] = [
  'WAITING',
  'IN_CONSULTATION',
  'AT_PROCEDURE',
  'READY_FOR_DISPENSARY',
  'READY_FOR_PAYMENT',
  'DISPENSARY_PAYMENT',
  'COMPLETED',
  'CANCELLED',
];

describe('status wording', () => {
  it('11. every status has a human label — none renders as a raw enum', () => {
    for (const status of ALL_STATUSES) {
      const label = queueStatusLabel(status);
      expect(label).toBeTruthy();
      expect(label).not.toMatch(/_/);
    }
  });

  it('3. AT_PROCEDURE reads "At procedure"', () => {
    expect(queueStatusLabel('AT_PROCEDURE')).toBe('At procedure');
  });

  it('8. the legacy combined status says so in its label', () => {
    expect(queueStatusLabel('DISPENSARY_PAYMENT')).toBe('Dispensary/Payment — Legacy');
  });

  it('70. status is carried by TEXT, so colour is never the only signal', () => {
    for (const status of ALL_STATUSES) {
      expect(queueStatusLabel(status)).toBeTruthy();
      expect(queueStatusColor(status)).toBeTruthy();
    }
  });

  it('an unknown status falls back to null, never to the raw code', () => {
    expect(queueStatusLabel('SOME_NEW_STAGE')).toBeNull();
    expect(queueStatusLabel(null)).toBeNull();
    expect(queueStatusColor('SOME_NEW_STAGE')).toBe('default');
  });

  it('the Live Patient Flow reads Waiting → Consultation → Dispensary → Payment → Completed', () => {
    expect(QUEUE_STAGE_ORDER.map((s) => STAGE_LABEL[s])).toEqual([
      'Waiting',
      'Consultation',
      'Dispensary',
      'Payment',
      'Completed',
    ]);
  });
});

describe('dispensing progress wording', () => {
  it('a visit with no clinic medication says so rather than "0 of 0"', () => {
    expect(dispensingLabel({ onsiteTotal: 0, dispensed: 0, remaining: 0 })).toBe('No clinic medication');
  });

  it('partial and complete dispensing both read plainly', () => {
    expect(dispensingLabel({ onsiteTotal: 4, dispensed: 1, remaining: 3 })).toBe(
      '1 of 4 dispensed · 3 remaining',
    );
    expect(dispensingLabel({ onsiteTotal: 4, dispensed: 4, remaining: 0 })).toBe('All 4 dispensed');
  });
});

describe('billing state wording', () => {
  it('an unconfirmed split is never described as settled or as zero', () => {
    expect(BILLING_STATE_LABEL.UNRESOLVED).toBe('Responsibility not confirmed');
    expect(BILLING_STATE_LABEL.UNRESOLVED).not.toMatch(/0\.00|settled/i);
  });

  it('money renders in full, and null stays null rather than becoming zero', () => {
    expect(money('123.4')).toBe('RM 123.40');
    expect(money(0)).toBe('RM 0.00');
    expect(money(null)).toBeNull();
  });
});

describe('blocker guidance', () => {
  it('every blocker names the problem, the person and the destination', () => {
    const codes = [
      'DOCTOR_PHASE_NOT_COMPLETED',
      'PROCEDURE_PENDING',
      'MEDICATION_SUPPLY_UNCONFIRMED',
      'MEDICATION_SUPPLY_DEFERRED',
      'DISPENSING_PENDING',
      'BILLING_REVIEW_REQUIRED',
      'PATIENT_BALANCE_REMAINING',
      'UNBILLED_CHARGEABLE_ITEMS',
      'CONSULTATION_TARIFF_REVIEW_REQUIRED',
      'QUEUE_STATE_INELIGIBLE',
    ];
    for (const code of codes) {
      const guidance = queueBlockerGuidance(code, 'fallback');
      expect(guidance.title.length).toBeGreaterThan(0);
      expect(guidance.who.length).toBeGreaterThan(0);
      expect(guidance.action.length).toBeGreaterThan(0);
      expect(['CLINICAL_VISIT', 'BILLING_REVIEW', 'CONSULTATION_TARIFFS', 'NONE']).toContain(guidance.destination);
    }
  });

  it('clinical blockers route to the clinical visit; money blockers to Billing Review', () => {
    expect(queueBlockerGuidance('PROCEDURE_PENDING', '').destination).toBe('CLINICAL_VISIT');
    expect(queueBlockerGuidance('DISPENSING_PENDING', '').destination).toBe('CLINICAL_VISIT');
    expect(queueBlockerGuidance('PATIENT_BALANCE_REMAINING', '').destination).toBe('BILLING_REVIEW');
    expect(queueBlockerGuidance('UNBILLED_CHARGEABLE_ITEMS', '').destination).toBe('BILLING_REVIEW');
    expect(queueBlockerGuidance('CONSULTATION_TARIFF_REVIEW_REQUIRED', '').destination).toBe('BILLING_REVIEW');
  });

  it('counter staff are never told to perform the clinical act themselves', () => {
    expect(queueBlockerGuidance('PROCEDURE_PENDING', '').action).toMatch(/must not mark a procedure done/i);
    expect(queueBlockerGuidance('DISPENSING_PENDING', '').action).toMatch(/cannot be waived/i);
  });

  it('an unknown blocker still yields usable guidance', () => {
    const guidance = queueBlockerGuidance('SOMETHING_NEW', 'Something new is outstanding.');
    expect(guidance.title).toBe('Something new is outstanding.');
    expect(guidance.destination).toBe('NONE');
  });
});

describe('completion disabled reason (68)', () => {
  const base = {
    canComplete: false,
    blockers: null as Array<{ code: string; message: string }> | null,
    checkOutAt: null as string | null,
    status: 'READY_FOR_PAYMENT' as QueueTicketStatus,
  };

  it('an eligible row has no reason to show', () => {
    expect(completionDisabledReason({ ...base, canComplete: true, blockers: [] })).toBeNull();
  });

  it('a single blocker is named in full', () => {
    expect(
      completionDisabledReason({
        ...base,
        blockers: [{ code: 'DISPENSING_PENDING', message: 'Medication dispensing is not complete.' }],
      }),
    ).toBe('Medication dispensing is not complete.');
  });

  it('several blockers are counted rather than truncated to one', () => {
    expect(
      completionDisabledReason({
        ...base,
        blockers: [
          { code: 'DISPENSING_PENDING', message: 'a' },
          { code: 'PATIENT_BALANCE_REMAINING', message: 'b' },
        ],
      }),
    ).toBe('2 items are outstanding.');
  });

  it('an already-completed or cancelled visit says so', () => {
    expect(completionDisabledReason({ ...base, checkOutAt: '2026-08-04T04:00:00Z' })).toMatch(/already completed/i);
    expect(completionDisabledReason({ ...base, status: 'CANCELLED' })).toMatch(/cancelled/i);
  });

  it('a stage that carries no completion decision says that, not "blocked"', () => {
    expect(completionDisabledReason({ ...base, status: 'WAITING' })).toMatch(/not yet at a stage/i);
  });

  it('a permitted-but-unpermissioned row reports the permission, not a blocker', () => {
    expect(completionDisabledReason({ ...base, blockers: [] })).toMatch(/not permitted/i);
  });
});
