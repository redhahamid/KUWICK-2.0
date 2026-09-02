import {
  MINIMUM_STATE_FOR_APPROVAL,
  SCHEMES_WITHOUT_A_SCHEDULE,
  STATUTORY_SCHEDULES,
  meetsApprovalBar,
  scheduleFor,
  stampFor,
} from './registry';

/**
 * The registry is what makes a payslip defensible a year later. These tests are
 * about that property rather than about any particular rate: that a period
 * resolves to the edition in force AT THE TIME, that the stamp records enough
 * to prove it, and that a gap is reported rather than filled in.
 */

const JAN_2026 = new Date('2026-01-31T00:00:00.000Z');
const BEFORE_EVERYTHING = new Date('2019-01-31T00:00:00.000Z');

describe('resolving a schedule', () => {
  it('resolves each scheme to exactly one schedule for a current period', () => {
    for (const scheme of ['EPF', 'SOCSO', 'EIS', 'PCB', 'HRD_LEVY', 'EMPLOYMENT_ACT'] as const) {
      expect(scheduleFor(scheme, JAN_2026)).not.toBeNull();
    }
  });

  it('resolves nothing for a period before any edition took effect', () => {
    // Deliberately not "the earliest schedule we have". A 2019 period is a
    // period this system cannot speak to, and saying so is the only safe
    // answer — the alternative is a historical run quietly recalculated at
    // rates that did not exist yet.
    expect(scheduleFor('EPF', BEFORE_EVERYTHING)).toBeNull();
    expect(scheduleFor('PCB', BEFORE_EVERYTHING)).toBeNull();
  });

  it('does not resolve PCB for a 2025 period, because the 2026 specification does not reach back', () => {
    expect(scheduleFor('PCB', new Date('2025-11-30T00:00:00.000Z'))).toBeNull();
    // EPF's October 2025 edition does cover that month.
    expect(scheduleFor('EPF', new Date('2025-11-30T00:00:00.000Z'))).not.toBeNull();
  });
});

describe('the stamp a run carries', () => {
  it('records the id, hash, verification state and document per scheme', () => {
    const stamp = stampFor(['EPF', 'SOCSO', 'EIS', 'PCB'], JAN_2026);
    expect(stamp.schedules).toHaveLength(4);
    for (const line of stamp.schedules) {
      expect(line.missing).toBe(false);
      expect(line.scheduleId).toBeTruthy();
      expect(line.contentHash).toMatch(/^[0-9a-f]{16}$/);
      expect(line.verification).toBeTruthy();
      expect(line.document).toContain('—');
    }
    expect(stamp.approvable).toBe(true);
    expect(stamp.blockers).toEqual([]);
  });

  it('refuses approval and names the scheme when a period has no schedule', () => {
    const stamp = stampFor(['EPF', 'PCB'], BEFORE_EVERYTHING);
    expect(stamp.approvable).toBe(false);
    expect(stamp.schedules.every((line) => line.missing)).toBe(true);
    expect(stamp.blockers.join(' ')).toMatch(/No EPF schedule is in force/);
    expect(stamp.blockers.join(' ')).toMatch(/No PCB schedule is in force/);
  });

  it('resolves against the period, not against today', () => {
    // The same call for two periods must be able to differ, or effective
    // dating is decorative. PCB is the case in hand: in force from 2026.
    const before = stampFor(['PCB'], new Date('2025-12-31T00:00:00.000Z'));
    const after = stampFor(['PCB'], new Date('2026-01-31T00:00:00.000Z'));
    expect(before.schedules[0].missing).toBe(true);
    expect(after.schedules[0].missing).toBe(false);
  });
});

describe('the content hash', () => {
  it('is stable across calls, so a re-run of an unchanged period reconciles', () => {
    expect(stampFor(['EPF'], JAN_2026).schedules[0].contentHash).toBe(
      stampFor(['EPF'], JAN_2026).schedules[0].contentHash,
    );
  });

  it('differs between schemes, so one schedule’s stamp cannot stand in for another', () => {
    const hashes = STATUTORY_SCHEDULES.map((schedule) => schedule.contentHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe('what may drive an approved run', () => {
  it('holds every shipped schedule at or above the approval bar', () => {
    for (const schedule of STATUTORY_SCHEDULES) {
      expect(meetsApprovalBar(schedule.verification)).toBe(true);
    }
  });

  it('treats corroboration as below the bar, however many sources agree', () => {
    // §1 of the brief: official current authority wins, never majority voting.
    expect(meetsApprovalBar('CORROBORATED')).toBe(false);
    expect(meetsApprovalBar('UNVERIFIED')).toBe(false);
    expect(MINIMUM_STATE_FOR_APPROVAL).toBe('OFFICIAL_SOURCE_VERIFIED');
  });

  it('never claims a state stronger than the evidence behind it', () => {
    // Test-vector verification means the authority published expected answers
    // that Kuwick reproduces. HRD Corp and the Employment Act publish none, so
    // they stop at source-verified however carefully they were transcribed.
    const byScheme = Object.fromEntries(STATUTORY_SCHEDULES.map((s) => [s.scheme, s.verification]));
    expect(byScheme.HRD_LEVY).toBe('OFFICIAL_SOURCE_VERIFIED');
    expect(byScheme.EMPLOYMENT_ACT).toBe('OFFICIAL_SOURCE_VERIFIED');
    expect(byScheme.PCB).toBe('OFFICIAL_TEST_VECTOR_VERIFIED');
  });
});

describe('what is missing is named, not left blank', () => {
  it('records LINDUNG 24 JAM as a scheme with no supplied document', () => {
    const lindung = SCHEMES_WITHOUT_A_SCHEDULE.find((gap) => gap.scheme.includes('LINDUNG'));
    expect(lindung).toBeDefined();
    expect(lindung?.reason).toMatch(/not established/i);
    // And it is genuinely absent from the registry rather than present as a
    // zero-rate placeholder, which is the failure mode this guards.
    expect(STATUTORY_SCHEDULES.some((s) => String(s.scheme).includes('LINDUNG'))).toBe(false);
  });
});
