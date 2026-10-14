/**
 * WEEK BY WEEK: overtime for staff, locum hours and night shifts for doctors.
 *
 * Section C of the HR brief (14 October 2026). A clinic pays extra hours by the
 * WEEK, not by the day: hours above the weekly normal are overtime for staff
 * and locum hours for doctors. Everything here is a clinic setting passed in by
 * the caller; nothing about a particular clinic is written into this file.
 *
 * Pure arithmetic: no database, no money rounding beyond the sen. The payroll
 * run loads the days, calls `workOutWeeks`, then `priceWeek`, and turns the
 * result into payroll items for the month the week ENDS in (decision 5).
 */

export type OvertimeBasis = 'ACT' | 'WEEKLY' | 'AVERAGED';
export type NightPayMode = 'PER_SHIFT' | 'PER_HOUR';

/** One shift's paid minutes. Two on one date is fine (a day and a night). */
export interface WorkedShift {
  /** The clinic date the shift started on, YYYY-MM-DD. */
  date: string;
  minutes: number;
  /** A night shift. Doctors are paid for it apart from the weekly hours. */
  night: boolean;
  /** Night pay for this shift, from the doctor or the night shift template. */
  nightPay?: { mode: NightPayMode; amountCents: number } | null;
}

export interface WeekRules {
  group: 'DOCTOR' | 'STAFF';
  basis: OvertimeBasis;
  /** The clinic's weekly normal hours, in minutes. */
  weeklyNormalMinutes: number;
  /** One normal day, in minutes. A public holiday takes one off the week. */
  normalDayMinutes: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekStartDay: number;
  /** Public holidays by date, with the clinic's multiplier for each (null = the default). */
  holidays: ReadonlyMap<string, { name: string; multiplier: number | null }>;
  /** The person's rest day of the week, when fixed. Staff rest-day work is priced by the Act elsewhere. */
  restDayOfWeek: number | null;
  /** First and last day employed. A part week's normal is cut to the days employed. */
  employedFrom: string | null;
  employedTo: string | null;
}

export interface WeekDay {
  date: string;
  minutes: number;
  kind: 'WORK' | 'NIGHT' | 'HOLIDAY' | 'REST';
}

export interface WeekWorking {
  weekStart: string;
  weekEnd: string;
  /** YYYY-MM: the month the week ends in, whose payroll items it becomes. */
  earnedMonth: string;
  normalMinutes: number;
  /** Hours counted against the weekly normal (normal working days only). */
  countedMinutes: number;
  dailyOvertimeMinutes: number;
  weeklyOvertimeMinutes: number;
  /** Staff overtime for the week, by the clinic's basis. */
  overtimeMinutes: number;
  /** Doctors: day hours above the weekly normal. */
  locumMinutes: number;
  /** Doctors: hours on public holidays, each at its own multiplier. */
  holidayLocum: { date: string; name: string; minutes: number; multiplier: number }[];
  /** Doctors: night shifts, kept out of the weekly hours. */
  nights: { date: string; minutes: number; pay: { mode: NightPayMode; amountCents: number } | null }[];
  days: WeekDay[];
  /** Plain-English remarks for the payroll page. */
  notes: string[];
}

const DAY_MS = 86_400_000;
/** The Act caps a normal day at 8 hours (s.60A(1)). */
const ACT_DAY_CAP_MINUTES = 8 * 60;
/** Shift-work averaging warns past 12 hours in a day (s.60C). */
const AVERAGING_DAY_LIMIT_MINUTES = 12 * 60;
/** The averaging cycle is three weeks (s.60C(1)). */
const AVERAGING_WEEKS = 3;

const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const toIso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => toIso(new Date(toDate(iso).getTime() + days * DAY_MS));
export const hoursOf = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

/** The first day of the week that holds `iso`. */
export function weekStartOf(iso: string, weekStartDay: number): string {
  const back = (toDate(iso).getUTCDay() - weekStartDay + 7) % 7;
  return addDays(iso, -back);
}

/** Every week that ENDS in the month (YYYY-MM): decision 5, a week belongs to the month it ends in. */
export function weeksEndingIn(month: string, weekStartDay: number): { start: string; end: string }[] {
  const first = `${month}-01`;
  const next = toDate(first);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = addDays(toIso(next), -1);
  const weeks: { start: string; end: string }[] = [];
  let start = weekStartOf(first, weekStartDay);
  while (start <= last) {
    const end = addDays(start, 6);
    if (end >= first && end <= last) weeks.push({ start, end });
    start = addDays(start, 7);
  }
  return weeks;
}

/**
 * The averaging cycle a week belongs to. Cycles are counted in threes from a
 * fixed week so that every month and every run agree where a cycle starts.
 */
function cycleOf(weekStart: string): number {
  return Math.floor(Math.round(toDate(weekStart).getTime() / DAY_MS / 7) / AVERAGING_WEEKS);
}

/** The dates to load shifts for: the month's weeks, and the start of an averaging cycle before them. */
export function datesToLoad(month: string, rules: Pick<WeekRules, 'weekStartDay' | 'basis'>): { from: string; to: string } | null {
  const weeks = weeksEndingIn(month, rules.weekStartDay);
  if (weeks.length === 0) return null;
  let from = weeks[0].start;
  if (rules.basis === 'AVERAGED') {
    while (cycleOf(addDays(from, -7)) === cycleOf(weeks[0].start)) from = addDays(from, -7);
  }
  return { from, to: weeks[weeks.length - 1].end };
}

/** The week's normal hours: cut for a part week, and one normal day less per public holiday in it. */
function normalFor(start: string, rules: WeekRules): { minutes: number; notes: string[] } {
  const notes: string[] = [];
  let employedDays = 0;
  let holidayDays = 0;
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(start, i);
    const employed = (!rules.employedFrom || day >= rules.employedFrom) && (!rules.employedTo || day <= rules.employedTo);
    if (!employed) continue;
    employedDays += 1;
    const holiday = rules.holidays.get(day);
    if (holiday) {
      holidayDays += 1;
      notes.push(`${holiday.name} (${day}) takes one normal day off the week.`);
    }
  }
  let minutes = Math.round((rules.weeklyNormalMinutes * employedDays) / 7);
  if (employedDays < 7) notes.push(`Employed ${employedDays} of 7 days, so the week's normal hours are cut to match.`);
  minutes = Math.max(0, minutes - holidayDays * rules.normalDayMinutes);
  return { minutes, notes };
}

function kindOf(shift: WorkedShift, rules: WeekRules): WeekDay['kind'] {
  if (rules.group === 'DOCTOR' && shift.night) return 'NIGHT';
  if (rules.holidays.has(shift.date)) return 'HOLIDAY';
  if (rules.group === 'STAFF' && rules.restDayOfWeek !== null && toDate(shift.date).getUTCDay() === rules.restDayOfWeek) {
    return 'REST';
  }
  return 'WORK';
}

/** Minutes per date on normal working days. */
function workMinutesByDate(days: WeekDay[]): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const day of days) {
    if (day.kind === 'WORK') byDate.set(day.date, (byDate.get(day.date) ?? 0) + day.minutes);
  }
  return byDate;
}

/** The Act's basis: hours past the normal day, then hours past the weekly normal not already counted. */
function actOvertime(byDate: Map<string, number>, normalMinutes: number, rules: WeekRules) {
  const dayLimit = Math.min(rules.normalDayMinutes, ACT_DAY_CAP_MINUTES);
  let daily = 0;
  let counted = 0;
  for (const minutes of byDate.values()) {
    daily += Math.max(0, minutes - dayLimit);
    counted += minutes;
  }
  const weekly = Math.max(0, counted - daily - normalMinutes);
  return { daily, weekly };
}

/**
 * Work out every week ending in `month` for one person.
 * `shifts` must cover `datesToLoad(month, rules)`.
 */
export function workOutWeeks(month: string, shifts: readonly WorkedShift[], rules: WeekRules): WeekWorking[] {
  const weekOf = (start: string) => {
    const end = addDays(start, 6);
    const days: WeekDay[] = shifts
      .filter((shift) => shift.date >= start && shift.date <= end && shift.minutes > 0)
      .map((shift) => ({ date: shift.date, minutes: shift.minutes, kind: kindOf(shift, rules) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const normal = normalFor(start, rules);
    const byDate = workMinutesByDate(days);
    const counted = [...byDate.values()].reduce((sum, minutes) => sum + minutes, 0);
    return { start, end, days, normal, byDate, counted };
  };

  return weeksEndingIn(month, rules.weekStartDay).map(({ start, end }) => {
    const week = weekOf(start);
    const notes = [...week.normal.notes];
    let dailyOvertime = 0;
    let weeklyOvertime = 0;
    let locum = 0;
    const holidayLocum: WeekWorking['holidayLocum'] = [];
    const nights: WeekWorking['nights'] = [];

    if (rules.group === 'DOCTOR') {
      // Doctors' extra day hours stay weekly whatever the staff basis is.
      locum = Math.max(0, week.counted - week.normal.minutes);
      for (const day of week.days) {
        if (day.kind === 'HOLIDAY') {
          const holiday = rules.holidays.get(day.date)!;
          holidayLocum.push({ date: day.date, name: holiday.name, minutes: day.minutes, multiplier: holiday.multiplier ?? 1 });
        }
      }
      for (const shift of shifts) {
        if (shift.night && shift.date >= start && shift.date <= end && shift.minutes > 0) {
          nights.push({ date: shift.date, minutes: shift.minutes, pay: shift.nightPay ?? null });
          if (!shift.nightPay) notes.push(`Night shift on ${shift.date} has no night rate set, so it is not paid.`);
        }
      }
    } else if (rules.basis === 'ACT') {
      const act = actOvertime(week.byDate, week.normal.minutes, rules);
      dailyOvertime = act.daily;
      weeklyOvertime = act.weekly;
    } else if (rules.basis === 'WEEKLY') {
      weeklyOvertime = Math.max(0, week.counted - week.normal.minutes);
      const act = actOvertime(week.byDate, week.normal.minutes, rules);
      if (act.daily + act.weekly > weeklyOvertime) {
        notes.push(
          `Weekly only pays ${hoursOf(weeklyOvertime)} h; the Employment Act would pay ${hoursOf(act.daily + act.weekly)} h for this week.`,
        );
      }
    } else {
      // s.60C: overtime only when the 3-week cycle as a whole is above normal,
      // paid with the cycle's last week.
      for (const day of week.byDate) {
        if (day[1] > AVERAGING_DAY_LIMIT_MINUTES) notes.push(`${day[0]} is over 12 hours, the s.60C daily limit.`);
      }
      const cycle = cycleOf(start);
      if (cycleOf(addDays(start, 7)) === cycle) {
        notes.push('Part of a 3-week averaging cycle; any overtime is paid with the cycle\'s last week.');
      } else {
        let cycleStart = start;
        while (cycleOf(addDays(cycleStart, -7)) === cycle) cycleStart = addDays(cycleStart, -7);
        let worked = 0;
        let normal = 0;
        for (let s = cycleStart; s <= start; s = addDays(s, 7)) {
          const w = s === start ? week : weekOf(s);
          worked += w.counted;
          normal += w.normal.minutes;
        }
        weeklyOvertime = Math.max(0, worked - normal);
        notes.push(`3-week cycle from ${cycleStart}: ${hoursOf(worked)} h worked against ${hoursOf(normal)} h normal.`);
      }
    }

    return {
      weekStart: start,
      weekEnd: end,
      earnedMonth: end.slice(0, 7),
      normalMinutes: week.normal.minutes,
      countedMinutes: week.counted,
      dailyOvertimeMinutes: dailyOvertime,
      weeklyOvertimeMinutes: weeklyOvertime,
      overtimeMinutes: dailyOvertime + weeklyOvertime,
      locumMinutes: locum,
      holidayLocum,
      nights,
      days: week.days,
      notes,
    };
  });
}

export interface WeekRates {
  /** Staff: the hourly ordinary rate and the overtime multiplier, or a clinic hourly amount. */
  overtimeHourlyCents: number;
  overtimeMultiplier: number;
  /** Doctors: the doctor's own hourly locum rate. Null means none set. */
  locumHourlyCents: number | null;
}

export interface WeekPay {
  overtimeCents: number;
  locumCents: number;
  holidayCents: number;
  nightCents: number;
}

const money = (minutes: number, hourlyCents: number, multiplier = 1) => Math.round((minutes * hourlyCents * multiplier) / 60);

/** What one week is worth. */
export function priceWeek(week: WeekWorking, rates: WeekRates): WeekPay {
  const locumRate = rates.locumHourlyCents ?? 0;
  return {
    overtimeCents: money(week.overtimeMinutes, rates.overtimeHourlyCents, rates.overtimeMultiplier),
    locumCents: money(week.locumMinutes, locumRate),
    holidayCents: week.holidayLocum.reduce((sum, day) => sum + money(day.minutes, locumRate, day.multiplier), 0),
    nightCents: week.nights.reduce((sum, night) => {
      if (!night.pay) return sum;
      return sum + (night.pay.mode === 'PER_SHIFT' ? night.pay.amountCents : money(night.minutes, night.pay.amountCents));
    }, 0),
  };
}
