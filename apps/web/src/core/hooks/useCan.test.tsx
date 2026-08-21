// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAuthStore } from '../auth-store';
import { permissionHint, useCan } from './useCan';

const staffWith = (permissions?: string[]) => ({
  id: 's1',
  fullName: 'Test Person',
  role: 'DOCTOR_RESIDENT',
  permissions,
});

const session = (permissions?: string[]) => ({
  accessToken: 't',
  refreshToken: 'r',
  staff: staffWith(permissions),
  tenant: { id: 'tn', name: 'T', slug: null },
});

beforeEach(() => useAuthStore.getState().clearAuth());

describe('useCan — the browser renders what the server decided', () => {
  it('1. answers from the server-published permission set', () => {
    useAuthStore.getState().setSession(session(['appointment.view', 'appointment.create']));
    expect(renderHook(() => useCan('appointment.create')).result.current).toBe(true);
    expect(renderHook(() => useCan('appointment.check_in')).result.current).toBe(false);
  });

  it('2. a session minted before the field existed falls back to ALLOW — the server still enforces', () => {
    // Absent means "fall back", never "no" (auth-store's documented rule for
    // its optional fields): a stale cached session keeps yesterday's
    // behaviour until its next refresh repopulates the array. Denying here
    // would lock a permitted owner out of their own buttons.
    useAuthStore.getState().setSession(session(undefined));
    expect(renderHook(() => useCan('appointment.check_in')).result.current).toBe(true);
  });

  it('3. no session at all also falls back to ALLOW, leaving routing/API as the gate', () => {
    expect(renderHook(() => useCan('appointment.view')).result.current).toBe(true);
  });

  it('4. the hint names the refused action in the same words the server uses', () => {
    expect(permissionHint('check a patient in')).toContain('not permitted to check a patient in');
  });
});
