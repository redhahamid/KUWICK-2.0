import { describe, expect, it } from 'vitest';
import { BillingWorklistItem } from '../types';
import {
  blockerGuidance,
  BLOCKER_GUIDANCE,
  PAYMENT_METHOD_LABEL,
  WAIVER_REASONS,
  worklistDetail,
  worklistState,
} from './billingReviewPresentation';

// ===========================================================================
// G4.5d3c-3b2 (D-094) — the counter's wording.
//
// Every state comes from the server; this file only names it. What is pinned
// here is that raw enums never reach the screen, that only a server-READY
// item offers an action, and that PANEL never claims the panel has paid.
// ===========================================================================

const item = (patch: Partial<BillingWorklistItem> = {}): BillingWorklistItem => ({
  sourceType: 'PRESCRIPTION',
  sourceId: 'rx-1',
  description: 'Amoxicillin 500mg',
  state: 'READY',
  stateReason: null,
  sourceStatus: 'DISPENSED',
  orderType: null,
  supplyMode: 'ONSITE_DISPENSE',
  billed: false,
  invoiceLineId: null,
  quantity: 10,
  ...patch,
});

describe('worklist state presentation', () => {
  it.each([
    ['READY', 'Ready to add', true],
    ['AWAITING_DISPENSE', 'Awaiting dispensing', false],
    ['UNRESOLVED_SUPPLY', 'Supply mode not confirmed', false],
    ['NOT_READY', 'Not ready', false],
    ['NOT_CHARGEABLE', 'Not chargeable', false],
    ['TARIFF_REVIEW', 'Tariff requires review', false],
    ['WAIVED', 'Waived', false],
  ] as const)('%s reads as "%s" and actionable=%s', (state, label, actionable) => {
    const presented = worklistState(item({ state }));
    expect(presented.label).toBe(label);
    expect(presented.actionable).toBe(actionable);
    // Never a raw enum.
    expect(presented.label).not.toMatch(/_/);
  });

  it('24. a billed item reads "Already invoiced" and offers no action', () => {
    const presented = worklistState(item({ billed: true, invoiceLineId: 'line-1' }));
    expect(presented.label).toBe('Already invoiced');
    expect(presented.actionable).toBe(false);
  });

  it('a deferred supply says so specifically, not just "unconfirmed"', () => {
    expect(worklistDetail(item({ state: 'UNRESOLVED_SUPPLY', supplyMode: 'DEFERRED' }))).toMatch(/deferred/i);
  });

  it('an auto-added consultation says where it came from', () => {
    const detail = worklistDetail(item({ sourceType: 'CONSULTATION', billed: true, invoiceLineId: 'l1' }));
    expect(detail).toMatch(/auto-added/i);
  });
});

describe('payment wording', () => {
  it('94. PANEL says the patient owes nothing — never that the panel paid', () => {
    expect(PAYMENT_METHOD_LABEL.PANEL).toBe('Panel — No Patient Payment');
    expect(PAYMENT_METHOD_LABEL.PANEL).not.toMatch(/paid/i);
  });

  it('the four patient-facing methods are plainly labelled', () => {
    expect(PAYMENT_METHOD_LABEL.CASH).toBe('Cash');
    expect(PAYMENT_METHOD_LABEL.CARD).toBe('Card');
    expect(PAYMENT_METHOD_LABEL.QR).toBe('QR Payment');
    expect(PAYMENT_METHOD_LABEL.BANK_TRANSFER).toBe('Bank Transfer');
  });
});

describe('blocker remediation', () => {
  it('every blocker names what is wrong, who fixes it and what to do', () => {
    for (const [code, guidance] of Object.entries(BLOCKER_GUIDANCE)) {
      expect(guidance.title.length, code).toBeGreaterThan(0);
      expect(guidance.who.length, code).toBeGreaterThan(0);
      expect(guidance.action.length, code).toBeGreaterThan(0);
    }
  });

  it('counter staff are never told to perform a clinical act', () => {
    expect(BLOCKER_GUIDANCE.PROCEDURE_PENDING.who).not.toMatch(/counter/i);
    expect(BLOCKER_GUIDANCE.PROCEDURE_PENDING.action).toMatch(/must not mark it done/i);
    expect(BLOCKER_GUIDANCE.MEDICATION_SUPPLY_DEFERRED.who).toMatch(/prescriber/i);
  });

  it('the consultation tariff blocker points at the configuration screen', () => {
    expect(BLOCKER_GUIDANCE.CONSULTATION_TARIFF_REVIEW_REQUIRED.title).toBe('Consultation tariff requires review.');
    expect(BLOCKER_GUIDANCE.CONSULTATION_TARIFF_REVIEW_REQUIRED.action).toMatch(/Clinic Settings/i);
  });

  it('an unknown blocker code still produces usable guidance', () => {
    const guidance = blockerGuidance('SOMETHING_NEW', 'Something new is outstanding.');
    expect(guidance.title).toBe('Something new is outstanding.');
    expect(guidance.who.length).toBeGreaterThan(0);
  });
});

describe('waiver reasons', () => {
  it('59. the owner-approved reasons are offered, with Other last', () => {
    expect(WAIVER_REASONS).toContain('OTC purchase only');
    expect(WAIVER_REASONS).toContain('Dressing-only visit');
    expect(WAIVER_REASONS).toContain('Procedure-only visit');
    expect(WAIVER_REASONS).toContain('Follow-up — no consultation fee');
    expect(WAIVER_REASONS).toContain('Complimentary');
    expect(WAIVER_REASONS).toContain('Billing correction');
    expect(WAIVER_REASONS[WAIVER_REASONS.length - 1]).toBe('Other');
  });
});
