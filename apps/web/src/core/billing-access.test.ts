import { describe, expect, it } from 'vitest';
import { BillingAction, canAccessBilling, canPerformBilling } from './billing-access';

// G3c closure (D-066) — this table must stay identical to the server's
// BILLING_MATRIX in clinical-authorization.ts. It decides only what renders;
// the server refuses independently. Written out in full so a drift between
// the two sides is a failing test rather than a silent divergence.
const EXPECTED: Record<string, BillingAction[]> = {
  OWNER_ADMIN: ['CREATE_INVOICE', 'EDIT_LINES', 'MARK_PAID', 'CANCEL_INVOICE'],
  FINANCE_STAFF: ['CREATE_INVOICE', 'EDIT_LINES', 'MARK_PAID', 'CANCEL_INVOICE'],
  FRONT_DESK_CLINICAL_STAFF: ['CREATE_INVOICE', 'EDIT_LINES', 'MARK_PAID'],
  DOCTOR_RESIDENT: ['CREATE_INVOICE', 'EDIT_LINES'],
  DOCTOR_LOCUM: ['CREATE_INVOICE', 'EDIT_LINES'],
  HR_STAFF: [],
  STOCK_STAFF: [],
  PANEL_STAFF: [],
  PATIENT_PORTAL: [],
};

const ALL_ACTIONS: BillingAction[] = ['CREATE_INVOICE', 'EDIT_LINES', 'MARK_PAID', 'CANCEL_INVOICE'];

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
