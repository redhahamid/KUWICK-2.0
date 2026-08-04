import { describe, expect, it } from 'vitest';
import { BillingAction, canAccessBilling, canPerformBilling } from './billing-access';

// G3c closure (D-066) — this table must stay identical to the server's
// BILLING_MATRIX in clinical-authorization.ts. It decides only what renders;
// the server refuses independently. Written out in full so a drift between
// the two sides is a failing test rather than a silent divergence.
const EXPECTED: Record<string, BillingAction[]> = {
  OWNER_ADMIN: ['CREATE_INVOICE', 'EDIT_LINES', 'MARK_PAID', 'CANCEL_INVOICE', 'APPLY_DISCOUNT', 'CANCEL_LINE', 'CLASSIFY_VISIT'],
  FINANCE_STAFF: ['CREATE_INVOICE', 'EDIT_LINES', 'MARK_PAID', 'CANCEL_INVOICE', 'APPLY_DISCOUNT', 'CANCEL_LINE', 'CLASSIFY_VISIT'],
  // D-093/D-094 — front desk bills, collects, corrects lines and records the
  // visit type, but never discounts and never cancels an issued invoice.
  FRONT_DESK_CLINICAL_STAFF: ['CREATE_INVOICE', 'EDIT_LINES', 'MARK_PAID', 'CANCEL_LINE', 'CLASSIFY_VISIT'],
  DOCTOR_RESIDENT: ['CREATE_INVOICE', 'EDIT_LINES'],
  DOCTOR_LOCUM: ['CREATE_INVOICE', 'EDIT_LINES'],
  HR_STAFF: [],
  STOCK_STAFF: [],
  PANEL_STAFF: [],
  PATIENT_PORTAL: [],
};

const ALL_ACTIONS: BillingAction[] = [
  'CREATE_INVOICE',
  'EDIT_LINES',
  'MARK_PAID',
  'CANCEL_INVOICE',
  'APPLY_DISCOUNT',
  'CANCEL_LINE',
  'CLASSIFY_VISIT',
];

describe('billing access matrix', () => {
  for (const [role, allowed] of Object.entries(EXPECTED)) {
    for (const action of ALL_ACTIONS) {
      const permitted = allowed.includes(action);
      it(`${role} ${permitted ? 'may' : 'may NOT'} ${action}`, () => {
        expect(canPerformBilling(role, action)).toBe(permitted);
      });
    }
  }

  it('a doctor cannot take payment or cancel a bill', () => {
    expect(canPerformBilling('DOCTOR_RESIDENT', 'MARK_PAID')).toBe(false);
    expect(canPerformBilling('DOCTOR_RESIDENT', 'CANCEL_INVOICE')).toBe(false);
  });

  it('front desk can take payment but not cancel an issued invoice', () => {
    expect(canPerformBilling('FRONT_DESK_CLINICAL_STAFF', 'MARK_PAID')).toBe(true);
    expect(canPerformBilling('FRONT_DESK_CLINICAL_STAFF', 'CANCEL_INVOICE')).toBe(false);
  });

  it('an unknown or absent role gets nothing', () => {
    expect(canPerformBilling(undefined, 'CREATE_INVOICE')).toBe(false);
    expect(canPerformBilling('NOT_A_ROLE', 'CREATE_INVOICE')).toBe(false);
    expect(canAccessBilling(undefined)).toBe(false);
  });

  it('page access is granted to anyone with any billing action', () => {
    for (const [role, allowed] of Object.entries(EXPECTED)) {
      expect(canAccessBilling(role)).toBe(allowed.length > 0);
    }
  });
});

// G4.5d3c-3b2 (D-094) — the counter tiers the Billing Review workspace renders.
describe('counter tiers', () => {
  it('5/80/82. front desk may correct a line but may NOT discount', () => {
    expect(canPerformBilling('FRONT_DESK_CLINICAL_STAFF', 'CANCEL_LINE')).toBe(true);
    expect(canPerformBilling('FRONT_DESK_CLINICAL_STAFF', 'APPLY_DISCOUNT')).toBe(false);
  });

  it('6/7. finance and the owner may discount', () => {
    expect(canPerformBilling('FINANCE_STAFF', 'APPLY_DISCOUNT')).toBe(true);
    expect(canPerformBilling('OWNER_ADMIN', 'APPLY_DISCOUNT')).toBe(true);
  });

  it('11. a doctor may not waive a consultation or set the visit billing type', () => {
    for (const role of ['DOCTOR_RESIDENT', 'DOCTOR_LOCUM']) {
      expect(canPerformBilling(role, 'CANCEL_LINE')).toBe(false);
      expect(canPerformBilling(role, 'CLASSIFY_VISIT')).toBe(false);
    }
  });

  it('1/2/3/4. owner, front desk and finance reach billing; other roles do not', () => {
    for (const role of ['OWNER_ADMIN', 'FRONT_DESK_CLINICAL_STAFF', 'FINANCE_STAFF']) {
      expect(canAccessBilling(role)).toBe(true);
    }
    for (const role of ['HR_STAFF', 'STOCK_STAFF', 'PANEL_STAFF', 'PATIENT_PORTAL']) {
      expect(canAccessBilling(role)).toBe(false);
    }
  });
});
