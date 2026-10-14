import { datesToLoad, priceWeek, weeksEndingIn, workOutWeeks, WeekRules, WorkedShift } from './weekly-hours';

// Clinic settings for the tests: 45 h a week of 7.5 h days, weeks from Monday.
const rules = (over: Partial<WeekRules> = {}): WeekRules => ({
  group: 'STAFF',
  basis: 'ACT',
  weeklyNormalMinutes: 45 * 60,
  normalDayMinutes: 450,
  weekStartDay: 1,
  holidays: new Map(),
  restDayOfWeek: null,
  employedFrom: null,
  employedTo: null,
  ...over,
});

const days = (from: string, count: number, minutes: number, extra: Partial<WorkedShift> = {}): WorkedShift[] =>
  Array.from({ length: count }, (_, i) => {
    const date = new Date(`${from}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + i);
    return { date: date.toISOString().slice(0, 10), minutes, night: false, ...extra };
  });

// Week Mon 5 Oct – Sun 11 Oct 2026.
const firstFullWeek = (weeks: ReturnType<typeof workOutWeeks>) => weeks.find((week) => week.weekStart === '2026-10-05')!;

describe('weeksEndingIn', () => {
  it('a week crossing two months belongs to the month it ends in', () => {
    const october = weeksEndingIn('2026-10', 1);
    expect(october.map((week) => week.start)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
    expect(weeksEndingIn('2026-11', 1)[0]).toEqual({ start: '2026-10-26', end: '2026-11-01' });
  });
});

describe('staff overtime', () => {
  it('Act basis: hours past the normal day, then past the weekly normal', () => {
    const daily = firstFullWeek(workOutWeeks('2026-10', days('2026-10-05', 6, 510), rules()));
    expect(daily.dailyOvertimeMinutes).toBe(6 * 60);
    expect(daily.weeklyOvertimeMinutes).toBe(0);

    const weekly = firstFullWeek(workOutWeeks('2026-10', days('2026-10-05', 7, 420), rules()));
    expect(weekly.dailyOvertimeMinutes).toBe(0);
    expect(weekly.overtimeMinutes).toBe(4 * 60);
  });

  it('weekly only can pay less than the Act, and says so', () => {
    const week = firstFullWeek(workOutWeeks('2026-10', days('2026-10-05', 5, 540), rules({ basis: 'WEEKLY' })));
    expect(week.overtimeMinutes).toBe(0);
    expect(week.notes.join(' ')).toContain('the Employment Act would pay 7.5 h');
  });

  it('a public holiday takes one normal day off the week, and is not counted as a work day', () => {
    const holidays = new Map([['2026-10-07', { name: 'Test Holiday', multiplier: null }]]);
    const week = firstFullWeek(workOutWeeks('2026-10', days('2026-10-05', 7, 420), rules({ holidays })));
    expect(week.normalMinutes).toBe(45 * 60 - 450);
    expect(week.countedMinutes).toBe(6 * 420);
    expect(week.overtimeMinutes).toBe(6 * 420 - (45 * 60 - 450));
  });

  it('a part week is cut to the days employed', () => {
    const week = firstFullWeek(workOutWeeks('2026-10', [], rules({ employedFrom: '2026-10-07' })));
    expect(week.normalMinutes).toBe(Math.round((45 * 60 * 5) / 7));
  });

  it('s.60C averaging pays only when the 3-week cycle is above normal, and warns past 12 hours a day', () => {
    const range = datesToLoad('2026-10', { weekStartDay: 1, basis: 'AVERAGED' })!;
    const shifts = days(range.from, 35, 7.5 * 60 + 60).concat([{ date: '2026-10-06', minutes: 13 * 60, night: false }]);
    const weeks = workOutWeeks('2026-10', shifts, rules({ basis: 'AVERAGED' }));
    const paid = weeks.filter((week) => week.overtimeMinutes > 0);
    expect(paid.length).toBeGreaterThan(0);
    expect(weeks.some((week) => week.notes.some((note) => note.includes('over 12 hours')))).toBe(true);
    // Only a cycle's last week carries overtime.
    expect(weeks.filter((week) => week.notes.some((note) => note.includes('Part of a 3-week'))).every((week) => week.overtimeMinutes === 0)).toBe(true);
  });

  it('prices overtime at the hourly rate times the multiplier', () => {
    const week = firstFullWeek(workOutWeeks('2026-10', days('2026-10-05', 6, 510), rules()));
    expect(priceWeek(week, { overtimeHourlyCents: 1000, overtimeMultiplier: 1.5, locumHourlyCents: null }).overtimeCents).toBe(9000);
  });
});

describe('doctors', () => {
  const doctor = (over: Partial<WeekRules> = {}) => rules({ group: 'DOCTOR', ...over });

  it('day hours above the weekly normal are locum hours at the doctor\'s rate', () => {
    const week = firstFullWeek(workOutWeeks('2026-10', days('2026-10-05', 5, 600), doctor()));
    expect(week.locumMinutes).toBe(5 * 60);
    expect(priceWeek(week, { overtimeHourlyCents: 0, overtimeMultiplier: 1, locumHourlyCents: 4500 }).locumCents).toBe(22500);
  });

  it('night shifts stay out of the weekly hours: fixed per shift, or hourly × hours', () => {
    const perShift = days('2026-10-05', 1, 600, { night: true, nightPay: { mode: 'PER_SHIFT', amountCents: 35000 } });
    const perHour = days('2026-10-06', 1, 420, { night: true, nightPay: { mode: 'PER_HOUR', amountCents: 3500 } });
    const week = firstFullWeek(workOutWeeks('2026-10', [...perShift, ...perHour], doctor()));
    expect(week.countedMinutes).toBe(0);
    expect(week.nights).toHaveLength(2);
    expect(priceWeek(week, { overtimeHourlyCents: 0, overtimeMultiplier: 1, locumHourlyCents: 4500 }).nightCents).toBe(35000 + 24500);
  });

  it('public holiday hours are paid at the holiday\'s multiplier, 1× by default', () => {
    const holidays = new Map([
      ['2026-10-07', { name: 'Holiday A', multiplier: null }],
      ['2026-10-08', { name: 'Holiday B', multiplier: 2 }],
    ]);
    const week = firstFullWeek(workOutWeeks('2026-10', days('2026-10-07', 2, 480), doctor({ holidays })));
    expect(week.holidayLocum.map((day) => day.multiplier)).toEqual([1, 2]);
    expect(priceWeek(week, { overtimeHourlyCents: 0, overtimeMultiplier: 1, locumHourlyCents: 4500 }).holidayCents).toBe(36000 + 72000);
  });
});
