import { computeAttendance, hoursOf, totalTimesheet } from './attendance-hours';
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
