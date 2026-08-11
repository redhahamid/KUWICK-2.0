import { describe, expect, it } from 'vitest';
import { BillingAction, canAccessBilling, canPerformBilling } from './billing-access';

const ALL_ACTIONS: BillingAction[] = [
  'CREATE_INVOICE',
  'EDIT_LINES',
  'MARK_PAID',
  'CANCEL_INVOICE',
  'APPLY_DISCOUNT',
  'CANCEL_LINE',
  'CLASSIFY_VISIT',
];

const COUNTER_ACTIONS: BillingAction[] = [
  'CREATE_INVOICE',
  'EDIT_LINES',
  'MARK_PAID',
  'CANCEL_LINE',
  'CLASSIFY_VISIT',
];
const CORRECTION_ACTIONS: BillingAction[] = ['CANCEL_INVOICE', 'APPLY_DISCOUNT'];

// TASK 1 — the browser reads the server's permission list. These tests state
// what each permission unlocks, which is the whole contract; WHO holds the
// permission is the server's question and is tested there.
describe('billing access reads the session permissions', () => {
  it('billing.counter unlocks the counter actions and nothing more', () => {
    const staff = { role: 'DOCTOR_RESIDENT', permissions: ['billing.counter'] };
    for (const action of COUNTER_ACTIONS) expect(canPerformBilling(staff, action)).toBe(true);
    for (const action of CORRECTION_ACTIONS) expect(canPerformBilling(staff, action)).toBe(false);
  });

  it('billing.corrections unlocks discount and invoice cancellation', () => {
    const owner = { role: 'OWNER_ADMIN', permissions: ['billing.corrections'] };
    for (const action of CORRECTION_ACTIONS) expect(canPerformBilling(owner, action)).toBe(true);
    for (const action of COUNTER_ACTIONS) expect(canPerformBilling(owner, action)).toBe(false);
  });

  it('an empty permission list renders nothing — it is an answer, not an absence', () => {
    // The distinction that matters: `permissions: []` is the server saying
    // "none", and must NOT fall through to the role table.
    const hr = { role: 'HR_STAFF', permissions: [] };
    for (const action of ALL_ACTIONS) expect(canPerformBilling(hr, action)).toBe(false);
    expect(canAccessBilling(hr)).toBe(false);
  });

  it('no session at all gets nothing', () => {
    expect(canPerformBilling(undefined, 'CREATE_INVOICE')).toBe(false);
    expect(canPerformBilling(null, 'CREATE_INVOICE')).toBe(false);
    expect(canAccessBilling(undefined)).toBe(false);
  });

  it('page access follows from holding either billing permission', () => {
    expect(canAccessBilling({ permissions: ['billing.counter'] })).toBe(true);
    expect(canAccessBilling({ permissions: ['billing.corrections'] })).toBe(true);
    expect(canAccessBilling({ permissions: ['note.write', 'queue.manage'] })).toBe(false);
  });
});

// A session minted before Task 1 carries no permission list. It falls back to
// the OLD role table, deliberately left at its old narrower values: a stale
// session is never shown a control the server would refuse.
describe('legacy sessions fall back to the role, and only downwards', () => {
  const LEGACY: Record<string, BillingAction[]> = {
    OWNER_ADMIN: ALL_ACTIONS,
    FINANCE_STAFF: ALL_ACTIONS,
    FRONT_DESK_CLINICAL_STAFF: ['CREATE_INVOICE', 'EDIT_LINES', 'MARK_PAID', 'CANCEL_LINE', 'CLASSIFY_VISIT'],
    DOCTOR_RESIDENT: ['CREATE_INVOICE', 'EDIT_LINES'],
    DOCTOR_LOCUM: ['CREATE_INVOICE', 'EDIT_LINES'],
    HR_STAFF: [],
    STOCK_STAFF: [],
    PANEL_STAFF: [],
    PATIENT_PORTAL: [],
  };

  for (const [role, allowed] of Object.entries(LEGACY)) {
    for (const action of ALL_ACTIONS) {
      const permitted = allowed.includes(action);
      it(`${role} ${permitted ? 'may' : 'may NOT'} ${action}`, () => {
        expect(canPerformBilling({ role }, action)).toBe(permitted);
      });
    }
  }

  it('an unknown role gets nothing', () => {
    expect(canPerformBilling({ role: 'NOT_A_ROLE' }, 'CREATE_INVOICE')).toBe(false);
  });

  it('the permission list WINS over the role when both are present', () => {
    // The point of the change. A doctor whose session says billing.counter
    // takes payment, whatever the old role table used to say about doctors.
    expect(canPerformBilling({ role: 'DOCTOR_RESIDENT', permissions: ['billing.counter'] }, 'MARK_PAID')).toBe(true);
    expect(canPerformBilling({ role: 'OWNER_ADMIN', permissions: ['billing.counter'] }, 'APPLY_DISCOUNT')).toBe(false);
  });
});
