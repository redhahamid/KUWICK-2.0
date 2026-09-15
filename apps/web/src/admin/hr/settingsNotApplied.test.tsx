// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AttendancePolicy, EffectiveAttendancePolicy } from '../types';

/*
 * SETTINGS THAT SAVED AND WERE NOT OBEYED — WHAT IS LEFT OF THEM.
 *
 * The September 2026 audit (docs/HR_SETTINGS_AUDIT_2026-09.md) traced every HR
 * setting to the code that consumes it and found fourteen that nothing reads.
 * They were marked rather than changed, because applying one changes what
 * somebody is paid and deleting one throws away an answer a clinic recorded.
 * The account holder has now decided each: three went live in earlier pieces,
 * and ten were deleted.
 *
 * On THIS panel that was all three marked fields — the unpaid break pair and
 * the approval switch — so what these tests pin now is the opposite of what
 * they pinned before. The boxes are gone, and the rules they pretended to
 * control are stated as sentences. A box that reappears here is a box somebody
 * can type a number into that changes nothing, which is where this started.
 */
const policy: AttendancePolicy = {
  lateGraceMinutes: 5,
  earlyOutGraceMinutes: 5,
  overtimeMinimumMinutes: 30,
  overtimeRoundingMinutes: 15,
  countEarlyClockIn: false,
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
  it('offers no box for a break the punches already took out', () => {
    mount();
    // The pair is gone, and so is the mark that admitted they did nothing.
    expect(screen.queryByText(/Unpaid break/i)).toBeNull();
    expect(screen.queryByText(/Break applies to shifts over/i)).toBeNull();
    expect(screen.queryByText('No break is deducted from anybody today.')).toBeNull();
    expect(screen.queryAllByText('Not applied')).toHaveLength(0);
  });

  it('states the two rules instead, because a rule nobody can see is one somebody will ask about', () => {
    mount();
    expect(screen.getByText(/Overtime always needs approval/i)).toBeTruthy();
    expect(screen.getByText(/Breaks are deducted by punching, not by a rule/i)).toBeTruthy();
  });

  it('offers no switch for an approval that is never optional', () => {
    mount();
    // A switch with one position: every pricing branch gates on the day's own
    // overtimeApproved flag whatever it said, and only the explicit Approve
    // action sets it. Honouring the off position would have paid extra time
    // nobody agreed to, so it went rather than being implemented.
    expect(screen.queryByText('Overtime must be approved')).toBeNull();
    expect(screen.queryByText(/turning this off does not pay unapproved extra time/i)).toBeNull();
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
