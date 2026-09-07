import {
  DEFAULT_ATTENDANCE_POLICY,
  overtimeCandidateMinutes,
  resolveAttendancePolicy,
} from './attendance-policy';

describe('resolveAttendancePolicy', () => {
  it('falls back to the built-in when the tenant has configured nothing', () => {
    expect(resolveAttendancePolicy([], 'clinic-a')).toEqual(DEFAULT_ATTENDANCE_POLICY);
  });

  it('uses the tenant default for a clinic with no row of its own', () => {
    const resolved = resolveAttendancePolicy([{ clinicId: null, lateGraceMinutes: 15 }], 'clinic-a');
    expect(resolved.lateGraceMinutes).toBe(15);
  });

  it('lets a clinic override the group', () => {
    const resolved = resolveAttendancePolicy(
      [
        { clinicId: null, lateGraceMinutes: 15 },
        { clinicId: 'clinic-a', lateGraceMinutes: 0 },
      ],
      'clinic-a',
    );
    expect(resolved.lateGraceMinutes).toBe(0);
  });

  it('INHERITS field by field, so overriding grace does not reset overtime rounding', () => {
    // Row-by-row fallback would drop this clinic to the built-in 15 for
    // rounding merely because it mentioned a grace period.
    const resolved = resolveAttendancePolicy(
      [
        { clinicId: null, lateGraceMinutes: 15, overtimeRoundingMinutes: 30 },
        { clinicId: 'clinic-a', lateGraceMinutes: 0 },
      ],
      'clinic-a',
    );
    expect(resolved).toMatchObject({ lateGraceMinutes: 0, overtimeRoundingMinutes: 30 });
  });

  it('does not hand one clinic another clinic’s policy', () => {
    const resolved = resolveAttendancePolicy([{ clinicId: 'clinic-b', lateGraceMinutes: 60 }], 'clinic-a');
    expect(resolved.lateGraceMinutes).toBe(DEFAULT_ATTENDANCE_POLICY.lateGraceMinutes);
  });

  it('resolves for a record with no clinic at all', () => {
    const resolved = resolveAttendancePolicy([{ clinicId: null, lateGraceMinutes: 10 }], null);
    expect(resolved.lateGraceMinutes).toBe(10);
  });
});

describe('overtimeCandidateMinutes', () => {
  const policy = { ...DEFAULT_ATTENDANCE_POLICY };

  it('is nothing at all below the minimum — eight minutes is not a claim on the payroll', () => {
    expect(overtimeCandidateMinutes(8, policy)).toBe(0);
    expect(overtimeCandidateMinutes(29, policy)).toBe(0);
  });

  it('rounds DOWN once the minimum is met, never up', () => {
    expect(overtimeCandidateMinutes(30, policy)).toBe(30);
    expect(overtimeCandidateMinutes(44, policy)).toBe(30);
    expect(overtimeCandidateMinutes(45, policy)).toBe(45);
    expect(overtimeCandidateMinutes(65, policy)).toBe(60);
  });

  it('applies the minimum BEFORE rounding', () => {
    // Rounding first would make 20 into 15 and then compare 15 to the
    // threshold, which answers a different question.
    expect(overtimeCandidateMinutes(20, { ...policy, overtimeMinimumMinutes: 20 })).toBe(15);
  });

  it('leaves the figure alone when a clinic turns rounding off', () => {
    expect(overtimeCandidateMinutes(37, { ...policy, overtimeRoundingMinutes: 0 })).toBe(37);
  });

  it('lets a clinic pay from the first minute', () => {
    const generous = { ...policy, overtimeMinimumMinutes: 0, overtimeRoundingMinutes: 0 };
    expect(overtimeCandidateMinutes(3, generous)).toBe(3);
  });
});
