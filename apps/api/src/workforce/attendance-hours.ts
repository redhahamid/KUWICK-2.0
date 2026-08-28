/**
 * ATTENDANCE ARITHMETIC — pure, so it can be tested exhaustively.
 *
 * Every one of these turns into somebody's pay, so each rule is stated rather
 * than implied, and each has a test naming the case it exists for.
 */

export interface PunchPair {
  clockInAt?: Date | null;
  clockOutAt?: Date | null;
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
}

export interface AttendanceComputation {
  workedMinutes: number | null;
  lateMinutes: number | null;
  earlyOutMinutes: number | null;
  /** Minutes beyond the scheduled end. NOT overtime until somebody approves it. */
  excessMinutes: number;
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'MISSING_PUNCH';
}

/**
 * Grace before a late arrival counts as late.
 *
 * Stated as a constant with a name rather than hidden in a comparison, because
 * "am I late at 09:05" is a question employees ask and managers must be able to
 * answer the same way twice.
 */
export const LATE_GRACE_MINUTES = 5;

function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60000);
}

export function computeAttendance(punch: PunchPair): AttendanceComputation {
  const { clockInAt, clockOutAt, scheduledStart, scheduledEnd } = punch;

  // Neither punch: absent. One punch: a missing punch, which is a DIFFERENT
  // state — somebody was here and the record is incomplete, and paying them
  // zero hours for it would be wrong.
  if (!clockInAt && !clockOutAt) {
    return { workedMinutes: null, lateMinutes: null, earlyOutMinutes: null, excessMinutes: 0, status: 'ABSENT' };
  }
  if (!clockInAt || !clockOutAt) {
    return {
      workedMinutes: null,
      lateMinutes:
        clockInAt && scheduledStart ? Math.max(0, minutesBetween(scheduledStart, clockInAt) - LATE_GRACE_MINUTES) : null,
      earlyOutMinutes: null,
      excessMinutes: 0,
      status: 'MISSING_PUNCH',
    };
  }

  // An overnight shift clocks out on the following calendar day. Treating that
  // as negative hours is how a night nurse ends a month owing the clinic time.
  const workedMinutes = Math.max(0, minutesBetween(clockInAt, clockOutAt));

  const lateMinutes = scheduledStart
    ? Math.max(0, minutesBetween(scheduledStart, clockInAt) - LATE_GRACE_MINUTES)
    : null;
  const earlyOutMinutes = scheduledEnd ? Math.max(0, minutesBetween(clockOutAt, scheduledEnd)) : null;
  const excessMinutes = scheduledEnd ? Math.max(0, minutesBetween(scheduledEnd, clockOutAt)) : 0;

  return {
    workedMinutes,
    lateMinutes,
    earlyOutMinutes,
    excessMinutes,
    status: (lateMinutes ?? 0) > 0 ? 'LATE' : 'PRESENT',
  };
}

/** Hours, to two decimals, from minutes. */
export function hoursOf(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export interface TimesheetTotals {
  daysPresent: number;
  daysAbsent: number;
  daysOnLeave: number;
  daysMissingPunch: number;
  workedMinutes: number;
  lateMinutes: number;
  lateOccasions: number;
  /** APPROVED overtime only. Unapproved excess is reported separately. */
  approvedOvertimeMinutes: number;
  unapprovedOvertimeMinutes: number;
}

export interface TimesheetRow {
  status: string;
  workedMinutes?: number | null;
  lateMinutes?: number | null;
  overtimeMinutes?: number;
  overtimeApproved?: boolean;
}

/**
 * A month's totals.
 *
 * UNAPPROVED OVERTIME IS NOT PAID and is counted separately, because a long
 * day is not automatically overtime — that assumption is what turns a payroll
 * into a dispute, and it is the reason `overtimeApproved` exists at all.
 */
export function totalTimesheet(rows: TimesheetRow[]): TimesheetTotals {
  const totals: TimesheetTotals = {
    daysPresent: 0,
    daysAbsent: 0,
    daysOnLeave: 0,
    daysMissingPunch: 0,
    workedMinutes: 0,
    lateMinutes: 0,
    lateOccasions: 0,
    approvedOvertimeMinutes: 0,
    unapprovedOvertimeMinutes: 0,
  };

  for (const row of rows) {
    if (row.status === 'PRESENT' || row.status === 'LATE') totals.daysPresent += 1;
    else if (row.status === 'ABSENT') totals.daysAbsent += 1;
    else if (row.status === 'ON_LEAVE') totals.daysOnLeave += 1;
    else if (row.status === 'MISSING_PUNCH') totals.daysMissingPunch += 1;

    totals.workedMinutes += row.workedMinutes ?? 0;
    if ((row.lateMinutes ?? 0) > 0) {
      totals.lateMinutes += row.lateMinutes ?? 0;
      totals.lateOccasions += 1;
    }
    if (row.overtimeApproved) totals.approvedOvertimeMinutes += row.overtimeMinutes ?? 0;
    else totals.unapprovedOvertimeMinutes += row.overtimeMinutes ?? 0;
  }

  return totals;
}
