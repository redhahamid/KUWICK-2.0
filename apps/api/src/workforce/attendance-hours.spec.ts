import { computeAttendance, computePunchedDay, hoursOf, totalTimesheet } from './attendance-hours';
import { DEFAULT_ATTENDANCE_POLICY } from './attendance-policy';

const at = (iso: string) => new Date(iso);

describe('attendance hours', () => {
  describe('computeAttendance', () => {
    it('is ABSENT with no punches, and MISSING_PUNCH with one — they are different states', () => {
      expect(computeAttendance({}).status).toBe('ABSENT');
      expect(computeAttendance({ clockInAt: at('2026-08-03T01:00:00Z') }).status).toBe('MISSING_PUNCH');
      expect(computeAttendance({ clockOutAt: at('2026-08-03T10:00:00Z') }).status).toBe('MISSING_PUNCH');
      // Paying a missing punch as zero hours would be wrong: somebody was here.
      expect(computeAttendance({ clockInAt: at('2026-08-03T01:00:00Z') }).workedMinutes).toBeNull();
    });

    it('counts worked minutes between the punches', () => {
      const result = computeAttendance({
        clockInAt: at('2026-08-03T01:00:00Z'),
        clockOutAt: at('2026-08-03T09:30:00Z'),
      });
      expect(result.workedMinutes).toBe(510);
      expect(hoursOf(result.workedMinutes!)).toBe(8.5);
    });

    it('handles an overnight shift without producing negative hours', () => {
      const result = computeAttendance({
        clockInAt: at('2026-08-03T14:00:00Z'),
        clockOutAt: at('2026-08-04T02:00:00Z'),
      });
      expect(result.workedMinutes).toBe(720);
    });

    it('allows a grace period before an arrival is late', () => {
      const scheduledStart = at('2026-08-03T01:00:00Z');
      const onTime = computeAttendance({
        clockInAt: at(`2026-08-03T01:0${DEFAULT_ATTENDANCE_POLICY.lateGraceMinutes}:00Z`),
        clockOutAt: at('2026-08-03T09:00:00Z'),
        scheduledStart,
      });
      expect(onTime.lateMinutes).toBe(0);
      expect(onTime.status).toBe('PRESENT');

      const late = computeAttendance({
        clockInAt: at('2026-08-03T01:20:00Z'),
        clockOutAt: at('2026-08-03T09:00:00Z'),
        scheduledStart,
      });
      expect(late.lateMinutes).toBe(15);
      expect(late.status).toBe('LATE');
    });

    it('never reports a negative lateness for an early arrival', () => {
      const result = computeAttendance({
        clockInAt: at('2026-08-03T00:30:00Z'),
        clockOutAt: at('2026-08-03T09:00:00Z'),
        scheduledStart: at('2026-08-03T01:00:00Z'),
      });
      expect(result.lateMinutes).toBe(0);
    });

    it('separates leaving early from working late', () => {
      const early = computeAttendance({
        clockInAt: at('2026-08-03T01:00:00Z'),
        clockOutAt: at('2026-08-03T08:00:00Z'),
        scheduledStart: at('2026-08-03T01:00:00Z'),
        scheduledEnd: at('2026-08-03T09:00:00Z'),
      });
      expect(early.earlyOutMinutes).toBe(60);
      expect(early.excessMinutes).toBe(0);

      const over = computeAttendance({
        clockInAt: at('2026-08-03T01:00:00Z'),
        clockOutAt: at('2026-08-03T11:00:00Z'),
        scheduledStart: at('2026-08-03T01:00:00Z'),
        scheduledEnd: at('2026-08-03T09:00:00Z'),
      });
      expect(over.excessMinutes).toBe(120);
      expect(over.earlyOutMinutes).toBe(0);
    });

    it('has no opinion about lateness when there was no shift', () => {
      const result = computeAttendance({
        clockInAt: at('2026-08-03T04:00:00Z'),
        clockOutAt: at('2026-08-03T09:00:00Z'),
      });
      expect(result.lateMinutes).toBeNull();
      expect(result.status).toBe('PRESENT');
    });
  });

  describe('totalTimesheet', () => {
    it('counts approved and unapproved overtime SEPARATELY', () => {
      // A long day is not automatically overtime. This separation is the whole
      // reason `overtimeApproved` exists, and paying the unapproved column is
      // what turns a payroll into a dispute.
      const totals = totalTimesheet([
        { status: 'PRESENT', workedMinutes: 480, overtimeMinutes: 60, overtimeApproved: true },
        { status: 'PRESENT', workedMinutes: 540, overtimeMinutes: 90, overtimeApproved: false },
      ]);
      expect(totals.approvedOvertimeMinutes).toBe(60);
      expect(totals.unapprovedOvertimeMinutes).toBe(90);
    });

    it('counts late OCCASIONS as well as minutes', () => {
      const totals = totalTimesheet([
        { status: 'LATE', workedMinutes: 470, lateMinutes: 10 },
        { status: 'LATE', workedMinutes: 465, lateMinutes: 15 },
        { status: 'PRESENT', workedMinutes: 480, lateMinutes: 0 },
      ]);
      expect(totals.lateOccasions).toBe(2);
      expect(totals.lateMinutes).toBe(25);
      expect(totals.daysPresent).toBe(3);
    });

    it('keeps absent, on-leave and missing-punch days apart', () => {
      const totals = totalTimesheet([
        { status: 'ABSENT' },
        { status: 'ON_LEAVE' },
        { status: 'MISSING_PUNCH' },
        { status: 'PRESENT', workedMinutes: 480 },
      ]);
      expect(totals).toMatchObject({
        daysAbsent: 1,
        daysOnLeave: 1,
        daysMissingPunch: 1,
        daysPresent: 1,
        workedMinutes: 480,
      });
    });
  });
});

/**
 * FOUR PUNCHES A DAY — the clinic's admin staff clock out at lunch and back
 * in, on purpose, so the owner can see who left and came back late. Measuring
 * the day as first-punch-to-last paid them for the lunch hour.
 */
describe('computePunchedDay', () => {
  const punch = (iso: string, kind: 'IN' | 'OUT') => ({ at: at(iso), kind });

  it('sums each pair and never pays the gap between them', () => {
    const result = computePunchedDay({
      punches: [
        punch('2026-09-13T01:00:00Z', 'IN'), //  09:00 local
        punch('2026-09-13T05:00:00Z', 'OUT'), // 13:00 — lunch
        punch('2026-09-13T06:00:00Z', 'IN'), //  14:00 — back
        punch('2026-09-13T10:00:00Z', 'OUT'), // 18:00
      ],
    });
    // 4h + 4h worked. The hour at lunch is not in it; first-to-last would be 9h.
    expect(result.workedMinutes).toBe(480);
    expect(result.status).toBe('PRESENT');
  });

  it('is not confused by the order the punches arrive in', () => {
    const ordered = computePunchedDay({
      punches: [punch('2026-09-13T01:00:00Z', 'IN'), punch('2026-09-13T05:00:00Z', 'OUT')],
    });
    const shuffled = computePunchedDay({
      punches: [punch('2026-09-13T05:00:00Z', 'OUT'), punch('2026-09-13T01:00:00Z', 'IN')],
    });
    expect(shuffled).toEqual(ordered);
  });

  it('measures lateness from the first punch and early leaving from the last', () => {
    const result = computePunchedDay({
      punches: [
        punch('2026-09-13T01:20:00Z', 'IN'), //  20 min after the shift started
        punch('2026-09-13T05:00:00Z', 'OUT'),
        punch('2026-09-13T06:00:00Z', 'IN'),
        punch('2026-09-13T09:30:00Z', 'OUT'), // 30 min before it ended
      ],
      scheduledStart: at('2026-09-13T01:00:00Z'),
      scheduledEnd: at('2026-09-13T10:00:00Z'),
    });
    expect(result.lateMinutes).toBe(15); // 20 less the 5-minute grace
    expect(result.earlyOutMinutes).toBe(30);
  });

  it('reports the hours it closed on a day still open, and still calls it incomplete', () => {
    const result = computePunchedDay({
      punches: [
        punch('2026-09-13T01:00:00Z', 'IN'),
        punch('2026-09-13T05:00:00Z', 'OUT'),
        punch('2026-09-13T06:00:00Z', 'IN'), // never clocked out
      ],
    });
    expect(result.workedMinutes).toBe(240);
    expect(result.status).toBe('MISSING_PUNCH');
    expect(result.exceptions).toContain('MISSING_PUNCH');
  });

  it('adds nothing for a clock-out with nothing open, as a lone clock-out always did', () => {
    expect(computePunchedDay({ punches: [punch('2026-09-13T05:00:00Z', 'OUT')] }).workedMinutes).toBeNull();
  });

  it('counts a punched break out once, and has no second figure to count it out of', () => {
    /*
     * THE FLAT BREAK DEDUCTION IS GONE, at the owner's decision: this clinic's
     * staff clock out for their break and back in, so the break is already
     * outside the worked minutes. A policy deduction on top would charge the
     * same hour twice, and the only thing that had ever saved it was that the
     * `payableMinutes` it produced was read by nothing.
     *
     * Nine hours on the clock with an hour punched out is eight hours worked,
     * and eight is the only figure the day carries.
     */
    const punched = computePunchedDay(
      {
        punches: [
          punch('2026-09-13T01:00:00Z', 'IN'),
          punch('2026-09-13T05:00:00Z', 'OUT'),
          punch('2026-09-13T06:00:00Z', 'IN'),
          punch('2026-09-13T10:00:00Z', 'OUT'),
        ],
      },
      DEFAULT_ATTENDANCE_POLICY,
    );
    expect(punched.workedMinutes).toBe(480);
    expect('payableMinutes' in punched).toBe(false);

    // A day worked as one stretch is worth every minute of it. This used to
    // lose an hour to a break nobody took.
    const oneStretch = computePunchedDay(
      { punches: [punch('2026-09-13T01:00:00Z', 'IN'), punch('2026-09-13T10:00:00Z', 'OUT')] },
      DEFAULT_ATTENDANCE_POLICY,
    );
    expect(oneStretch.workedMinutes).toBe(540);
  });

  it('reproduces the owner’s UAT day exactly', () => {
    const result = computePunchedDay({
      punches: [
        punch('2026-09-13T06:01:00Z', 'IN'),
        punch('2026-09-13T06:03:00Z', 'OUT'),
        punch('2026-09-13T06:06:00Z', 'IN'),
        punch('2026-09-13T06:07:00Z', 'OUT'),
      ],
    });
    expect(result.workedMinutes).toBe(3); // 2 + 1, not the 6 that first-to-last reported
  });
});
