// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AttendancePolicy, EffectiveAttendancePolicy } from '../types';

/*
 * SETTINGS THAT SAVE AND ARE NOT OBEYED.
 *
 * The September 2026 audit (docs/HR_SETTINGS_AUDIT_2026-09.md) traced every HR
 * setting to the code that consumes it and found fourteen that nothing reads.
 * Applying one changes what somebody is paid and is the account holder's
 * decision; deleting one throws away an answer a clinic already recorded. This
 * piece does neither. It stops them claiming to work.
 *
 * These tests pin the CLAIM, not the styling: a field that has quietly become
 * live again should fail here and be un-marked deliberately, and a field that
 * is still dead should never drift back to describing itself as in force.
 */
const policy: AttendancePolicy = {
  lateGraceMinutes: 5,
  earlyOutGraceMinutes: 5,
  overtimeMinimumMinutes: 30,
  overtimeRoundingMinutes: 15,
  overtimeRequiresApproval: true,
  countEarlyClockIn: false,
  unpaidBreakMinutes: 0,
  breakAfterMinutes: 360,
  maximumShiftHours: 16,
  geofenceLat: null,
  geofenceLng: null,
  geofenceRadiusMetres: 150,
};

const effective: EffectiveAttendancePolicy = {
  clinicId: null,
  policy,
  source: 'GROUP_DEFAULT',
  defaults: policy,
  hasOwnPolicy: true,
  hasGroupDefault: true,
  updatedAt: '2026-09-01T00:00:00.000Z',
};

vi.mock('../../core/hooks/useCan', () => ({
  useCan: () => true,
  permissionHint: () => undefined,
}));

vi.mock('../../core/hooks/useClinicFilter', () => ({
  useClinicFilter: () => ({ clinics: [], clinicId: undefined, setClinicId: vi.fn() }),
}));

vi.mock('../hooks/useAdmin', () => ({
  useAttendancePolicy: () => ({ data: effective, isLoading: false }),
  useSaveAttendancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { AttendanceRulesPanel } = await import('./AttendanceRulesPanel');

const mount = () =>
  render(
    <MemoryRouter>
      <AntApp>
        <AttendanceRulesPanel />
      </AntApp>
    </MemoryRouter>,
  );

describe('attendance rules that do not reach the calculation', () => {
  it('marks the unpaid break pair rather than letting two live-looking numbers imply a deduction', () => {
    mount();
    expect(screen.getByText('No break is deducted from anybody today.')).toBeTruthy();
    expect(screen.getByText('Nothing is measured against this yet.')).toBeTruthy();
    // Three marks on this panel: the break pair and the approval switch.
    expect(screen.getAllByText('Not applied')).toHaveLength(3);
  });

  it('no longer tells the clinic that turning approval off pays unapproved overtime', () => {
    mount();
    // The old help text. Every pricing branch gates on the day's own
    // overtimeApproved flag regardless of this switch, and only the explicit
    // Approve action sets it, so the sentence was false in the off position.
    expect(screen.queryByText(/reaches payroll without anybody agreeing to it/i)).toBeNull();
    expect(screen.getByText(/turning this off does not pay unapproved extra time/i)).toBeTruthy();
  });

  it('leaves the overtime minimum and rounding unmarked, because both are live', () => {
    mount();
    // These two were wrongly reported dead in the audit's first pass. They
    // reach overtimeCandidateMinutes, which decides the minutes written to the
    // record and priced. Marking them would have been the expensive error.
    expect(screen.getByText('Extra time below this is not an overtime candidate at all.')).toBeTruthy();
    expect(screen.getByText(/Candidate overtime rounds DOWN/)).toBeTruthy();
  });
});
