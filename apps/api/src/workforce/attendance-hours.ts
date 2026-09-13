import {
  AttendancePolicy,
  DEFAULT_ATTENDANCE_POLICY,
  overtimeCandidateMinutes,
} from './attendance-policy';

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

/** One press of the button. `IN` starts a stretch of work, `OUT` ends it. */
export interface Punch {
  readonly at: Date;
  readonly kind: 'IN' | 'OUT';
}

export interface PunchedDay {
  /** Every punch of the day, in any order — sorted here. */
  readonly punches: readonly Punch[];
  readonly scheduledStart?: Date | null;
  readonly scheduledEnd?: Date | null;
}

export interface AttendanceComputation {
  workedMinutes: number | null;
  /** Worked minutes the clinic pays for — worked, less any unpaid break. */
  payableMinutes: number | null;
  scheduledMinutes: number | null;
  lateMinutes: number | null;
  earlyOutMinutes: number | null;
  /**
   * Minutes short of the scheduled day, past the clinic's grace.
   *
   * NEVER deducted from anybody automatically. It is raised as an exception
   * for a manager to resolve — approved early release, half-day leave, unpaid
   * time, a correction — because the system cannot know which of those it was,
   * and guessing costs somebody real money.
   */
  shortMinutes: number;
  /** Minutes beyond the scheduled end. NOT overtime until somebody approves it. */
  excessMinutes: number;
  /** What the clinic's policy would actually consider paying, if approved. */
  overtimeCandidateMinutes: number;
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'MISSING_PUNCH';
  /** Named reasons this record needs a human. Empty means it does not. */
  exceptions: AttendanceExceptionCode[];
}

/**
 * WHY A RECORD NEEDS A PERSON.
 *
 * Codes rather than prose so a queue can be counted and filtered, and so the
 * screen and the API cannot drift apart on what "needs review" means.
 */
export type AttendanceExceptionCode =
  | 'MISSING_PUNCH'
  | 'ABSENT_WITH_SHIFT'
  | 'LATE'
  | 'SHORT_TIME'
  | 'OVERTIME_PENDING'
  | 'IMPLAUSIBLE_LENGTH'
  | 'UNSCHEDULED';

function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60000);
}

/**
 * @param policy the clinic's measurement rules. Omitted, the built-in
 *   defaults apply — which are the constants this module used to hardcode, so
 *   a caller that has not been taught about policy yet measures as before.
 */
export function computeAttendance(
  punch: PunchPair,
  policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY,
): AttendanceComputation {
  const { clockInAt, clockOutAt, scheduledStart, scheduledEnd } = punch;
  return computePunchedDay(
    {
      punches: [
        ...(clockInAt ? [{ at: clockInAt, kind: 'IN' as const }] : []),
        ...(clockOutAt ? [{ at: clockOutAt, kind: 'OUT' as const }] : []),
      ],
      scheduledStart,
      scheduledEnd,
    },
    policy,
  );
}

/**
 * A DAY IS THE SUM OF ITS PAIRS, NOT ITS FIRST PUNCH TO ITS LAST.
 *
 * The clinic's admin staff clock out at lunch and back in afterwards, on
 * purpose: the owner wants to see who left and came back late. Measuring the
 * day as first-punch-to-last-punch pays them for the hour they were at lunch,
 * and — because a day held one clock-in and one clock-out — threw the two
 * middle punches away entirely, with no audit row to recover them from.
 *
 * So every punch is stored, and the day is `Σ (OUT − IN)` over the CLOSED
 * pairs. The gaps between pairs are not counted, which is the whole point:
 * nothing has to be configured for a punched break to be unpaid.
 *
 * WHAT DELIBERATELY DID NOT MOVE. Lateness is still measured from the FIRST
 * clock-in and leaving early from the LAST clock-out, because those are the
 * two ends of the working day whatever happened in the middle — and every
 * existing test of them must keep passing unchanged.
 */
export function computePunchedDay(
  day: PunchedDay,
  policy: AttendancePolicy = DEFAULT_ATTENDANCE_POLICY,
): AttendanceComputation {
  const { scheduledStart, scheduledEnd } = day;
  const punches = [...day.punches].sort((a, b) => a.at.getTime() - b.at.getTime());
  const firstIn = punches.find((p) => p.kind === 'IN')?.at ?? null;
  const lastOut = [...punches].reverse().find((p) => p.kind === 'OUT')?.at ?? null;

  /*
   * PAIRING, AND WHAT AN ODD PUNCH MEANS.
   *
   * An IN opens a stretch; the next OUT closes it. A second IN with no OUT
   * between them is somebody who forgot to clock out, not two stretches at
   * once — the earlier one is abandoned and the day is incomplete. An OUT
   * with nothing open is an orphan: it cannot say when the work started, so
   * it adds no minutes and marks the day incomplete, which is exactly what a
   * lone clock-out did before.
   */
  let closedMinutes = 0;
  let openAt: Date | null = null;
  let incomplete = false;
  for (const punch of punches) {
    if (punch.kind === 'IN') {
      if (openAt) incomplete = true;
      openAt = punch.at;
    } else if (openAt) {
      closedMinutes += Math.max(0, minutesBetween(openAt, punch.at));
      openAt = null;
    } else {
      incomplete = true;
    }
  }
  if (openAt) incomplete = true;
  const pairsClosed = closedMinutes > 0 || (punches.length >= 2 && !incomplete);
  const scheduledMinutes =
    scheduledStart && scheduledEnd ? Math.max(0, minutesBetween(scheduledStart, scheduledEnd)) : null;
  const scheduled = Boolean(scheduledStart || scheduledEnd);

  // Neither punch: absent. One punch: a missing punch, which is a DIFFERENT
  // state — somebody was here and the record is incomplete, and paying them
  // zero hours for it would be wrong.
  if (punches.length === 0) {
    return {
      workedMinutes: null,
      payableMinutes: null,
      scheduledMinutes,
      lateMinutes: null,
      earlyOutMinutes: null,
      shortMinutes: 0,
      excessMinutes: 0,
      overtimeCandidateMinutes: 0,
      status: 'ABSENT',
      // Absent on a day nobody scheduled them is not an exception; absent on a
      // day the roster expected them is the whole point of the roster.
      exceptions: scheduled ? ['ABSENT_WITH_SHIFT'] : [],
    };
  }

  const lateMinutes = firstIn && scheduledStart
    ? Math.max(0, minutesBetween(scheduledStart, firstIn) - policy.lateGraceMinutes)
    : null;

  /*
   * NOTHING CLOSED: the day says how it started and not how it ended, and
   * there is no honest number of hours to report. `null`, as a lone clock-in
   * has always reported — an unfinished day is not a zero-hour day.
   */
  if (!pairsClosed) {
    return {
      workedMinutes: null,
      payableMinutes: null,
      scheduledMinutes,
      lateMinutes,
      earlyOutMinutes: null,
      shortMinutes: 0,
      excessMinutes: 0,
      overtimeCandidateMinutes: 0,
      status: 'MISSING_PUNCH',
      exceptions: lateMinutes && lateMinutes > 0 ? ['MISSING_PUNCH', 'LATE'] : ['MISSING_PUNCH'],
    };
  }

  // An overnight shift clocks out on the following calendar day. Treating that
  // as negative hours is how a night nurse ends a month owing the clinic time.
  const workedMinutes = closedMinutes;

  /*
   * THE FLAT UNPAID BREAK, AND WHY IT IS NOT APPLIED TO A PUNCHED BREAK.
   *
   * A clinic whose staff punch their breaks has already excluded them — the
   * gap between two pairs is simply not counted. Deducting the policy's flat
   * break on top would charge them for the same hour twice. So it applies
   * only to a day worked as ONE stretch, which is the day the setting was
   * written for.
   *
   * `payableMinutes` is still read by nothing: it is not stored, not shown and
   * not priced, so the two break fields remain inert whatever this returns.
   * That is a separate finding and belongs to the settings audit, not here —
   * but the arithmetic is correct for the day it is revived.
   */
  const oneStretch = punches.length <= 2;
  const breakMinutes =
    oneStretch && policy.unpaidBreakMinutes > 0 && workedMinutes >= policy.breakAfterMinutes
      ? policy.unpaidBreakMinutes
      : 0;
  const payableMinutes = Math.max(0, workedMinutes - breakMinutes);

  const earlyOutMinutes = lastOut && scheduledEnd ? Math.max(0, minutesBetween(lastOut, scheduledEnd)) : null;
  const shortMinutes = earlyOutMinutes ? Math.max(0, earlyOutMinutes - policy.earlyOutGraceMinutes) : 0;

  // EXTRA TIME, which is not overtime. Time worked after the scheduled end,
  // plus — only where the clinic says so — time worked before the scheduled
  // start. Arriving half an hour early to settle in is not usually a claim.
  const afterEnd = lastOut && scheduledEnd ? Math.max(0, minutesBetween(scheduledEnd, lastOut)) : 0;
  const beforeStart =
    policy.countEarlyClockIn && firstIn && scheduledStart
      ? Math.max(0, minutesBetween(firstIn, scheduledStart))
      : 0;
  const excessMinutes = afterEnd + beforeStart;
  const candidate = overtimeCandidateMinutes(excessMinutes, policy);

  const exceptions: AttendanceExceptionCode[] = [];
  if ((lateMinutes ?? 0) > 0) exceptions.push('LATE');
  if (shortMinutes > 0) exceptions.push('SHORT_TIME');
  if (candidate > 0) exceptions.push('OVERTIME_PENDING');
  if (workedMinutes > policy.maximumShiftHours * 60) exceptions.push('IMPLAUSIBLE_LENGTH');
  if (!scheduled) exceptions.push('UNSCHEDULED');
  // A day with a punch left open is reported with the hours it DID close, and
  // still named incomplete: the manager needs both halves of that sentence.
  if (incomplete) exceptions.push('MISSING_PUNCH');

  return {
    workedMinutes,
    payableMinutes,
    scheduledMinutes,
    lateMinutes,
    earlyOutMinutes,
    shortMinutes,
    excessMinutes,
    overtimeCandidateMinutes: candidate,
    status: incomplete ? 'MISSING_PUNCH' : (lateMinutes ?? 0) > 0 ? 'LATE' : 'PRESENT',
    exceptions,
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
