import { describe, expect, it } from 'vitest';
import { HOLD_ROLES, holdLabel, isOnHold, mayHoldConsultation } from './holdPresentation';

// ===========================================================================
// KW2-C2 — a HELD patient sits in the WAITING queue beside patients who have
// simply not been seen yet. These are the rules that keep the two apart.
// ===========================================================================

describe('who may pause a consultation', () => {
  it('doctors and the owner may', () => {
    expect(mayHoldConsultation('DOCTOR_RESIDENT')).toBe(true);
    expect(mayHoldConsultation('DOCTOR_LOCUM')).toBe(true);
    expect(mayHoldConsultation('OWNER_ADMIN')).toBe(true);
  });

  it('front desk may NOT — holding is a judgement made in a room they cannot see into', () => {
    expect(mayHoldConsultation('FRONT_DESK_CLINICAL_STAFF')).toBe(false);
  });

  it('an unknown or absent role may not', () => {
    // Fails CLOSED. This only ever hides a control — the server refuses
    // regardless of what the browser believes — so the narrow reading costs a
    // button at worst, never an unauthorised write.
    expect(mayHoldConsultation(null)).toBe(false);
    expect(mayHoldConsultation(undefined)).toBe(false);
    expect(mayHoldConsultation('FINANCE_STAFF')).toBe(false);
    expect(mayHoldConsultation('SOMETHING_NEW')).toBe(false);
  });

  it('mirrors the server matrix exactly', () => {
    expect(HOLD_ROLES).toEqual(['OWNER_ADMIN', 'DOCTOR_RESIDENT', 'DOCTOR_LOCUM']);
  });
});

describe('telling a held row apart from a waiting one', () => {
  it('a hold time is what makes a row held', () => {
    expect(isOnHold({ heldAt: '2026-08-10T02:00:00.000Z' })).toBe(true);
    expect(isOnHold({ heldAt: null })).toBe(false);
    expect(isOnHold({})).toBe(false);
  });

  it('the label always names the doctor', () => {
    expect(holdLabel({ heldAt: '2026-08-10T02:00:00.000Z', heldByName: 'Dr Amira Rahman' })).toBe(
      'On hold · Dr Amira Rahman',
    );
  });

  it('a row that is not held gets no label at all', () => {
    expect(holdLabel({ heldAt: null, heldByName: 'Dr Amira Rahman' })).toBeNull();
    expect(holdLabel({})).toBeNull();
  });

  it('an unresolvable name loses the name, never the fact', () => {
    // The database will not store a hold without an actor, so this is a
    // client-side lookup miss — a staff list that has not loaded. Dropping
    // the whole tag would hide a real state; inventing a name would be worse.
    expect(holdLabel({ heldAt: '2026-08-10T02:00:00.000Z', heldByName: null })).toBe('On hold');
  });
});
