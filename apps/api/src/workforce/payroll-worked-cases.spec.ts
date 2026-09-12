import { overtimeScope } from '../statutory/employment-act';
import { classifyDay, priceOvertime, WorkedDay } from './overtime-pricing';
import {
  DEFAULT_COMPONENT_LIABILITY,
  PayrollComponentLine,
  computePayslip,
  ordinaryRates,
  unpaidLeaveDeductionCents,
} from './payroll-calculation';

/**
 * THE WORKED CASES THE OWNER CHECKS AGAINST A REAL PAYSLIP.
 *
 * Piece 3 §9(5) asks for the engine's answer, printed, for three wages —
 * RM2,900, RM5,600 and RM9,500 — with EPF, SOCSO, EIS and PCB; overtime under
 * mode A (the Act) and mode B (clinic rates); one day of unpaid leave; and a
 * claim that is not taxed. The table these tests print is copied into
 * docs/HR_RESTRUCTURE_PIECE3D.md, and the assertions pin the facts a reader
 * would otherwise have to take on trust:
 *
 *   - EPF is the Third Schedule's TABLE, not a percentage, and the employer
 *     rate drops to 12% above RM5,000 (3rd Schedule Part A).
 *   - SOCSO and EIS are capped at the RM6,000 wage ceiling.
 *   - Unpaid leave is s.18A: monthly wages over the days in THAT month (31 in
 *     August), never over 26.
 *   - Overtime is s.60A(3)(a) at 1.5× for wages within the First Schedule; a
 *     clinic rate is applied only where it is not below that.
 *   - A claim reimbursement changes net pay by exactly its amount and nothing
 *     else — not EPF, not SOCSO, not PCB.
 *
 * August 2026, the same month the Slate mockups show. Normal hours 7.5 a day
 * (the product's default), 26-day ordinary rate, resident, single, under 60,
 * no children, employer not registered with HRD Corp.
 */
const AUGUST = { periodEnd: new Date('2026-08-31T00:00:00.000Z') };
const DAYS_IN_AUGUST = 31;
const HOURS_PER_DAY = 7.5;
const ORP = { overtimeDaysPerMonth: 26, unpaidLeaveDaysPerMonth: 31, hoursPerDay: HOURS_PER_DAY };

const profile = {
  age: 34,
  epfMembership: 'MALAYSIAN_CITIZEN' as const,
  epfEmployeeRate: 11,
  epfApplicable: true,
  socsoApplicable: true,
  eisApplicable: true,
  pcbApplicable: true,
  taxResidence: 'RESIDENT' as const,
  pcbCategory: 1 as const,
  qualifyingChildren: 0,
  disabledSelf: false,
  disabledSpouse: false,
  lindungParticipation: 'NOT_PARTICIPATING' as const,
  hrdRegistration: 'NOT_REGISTERED' as const,
  hrdFullTimeEmployment: true,
};

const line = (code: string, amount: number, kind: PayrollComponentLine['kind'] = 'EARNING'): PayrollComponentLine => ({
  code,
  label: code,
  kind,
  amount,
  liability: DEFAULT_COMPONENT_LIABILITY[code],
});

const rm = (cents: number | null) => (cents === null ? '—' : (cents / 100).toFixed(2));

const day = (over: Partial<WorkedDay>): WorkedDay => ({
  attendanceId: 'a',
  date: new Date('2026-08-12T00:00:00.000Z'),
  workedMinutes: 450,
  overtimeMinutes: 0,
  overtimeApproved: true,
  ...over,
});

/** 6.5 approved overtime hours on normal days, and one public holiday worked (31 August). */
const MONTH: WorkedDay[] = [
  day({ attendanceId: 'a1', overtimeMinutes: 240 }),
  day({ attendanceId: 'a2', date: new Date('2026-08-13T00:00:00.000Z'), overtimeMinutes: 150 }),
  day({ attendanceId: 'a3', date: new Date('2026-08-31T00:00:00.000Z'), workedMinutes: 450 }),
];
const classify = (date: Date) => classifyDay(date, { publicHolidayDates: new Set(['2026-08-31']), restDayOfWeek: 0 });

const WAGES = [2900, 5600, 9500] as const;
const rows: string[] = [];

describe.each(WAGES)('RM%s a month, August 2026', (wage) => {
  const wageCents = wage * 100;
  const rates = ordinaryRates(wageCents, ORP, DAYS_IN_AUGUST);
  const basic = computePayslip([line('BASIC', wage)], AUGUST, profile);

  it('EPF, SOCSO, EIS and PCB on basic pay alone', () => {
    // The Third Schedule: 11% employee; employer 13% up to RM5,000 and 12% above.
    expect(basic.statutory.epf.employeeCents).toBe(Math.ceil((wageCents * 0.11) / 100) * 100);
    expect(basic.statutory.epf.employerCents).toBe(Math.ceil((wageCents * (wage > 5000 ? 0.12 : 0.13)) / 100) * 100);
    // SOCSO and EIS stop at the RM6,000 ceiling: RM9,500 pays exactly what RM6,000 pays.
    if (wage > 6000) {
      const atCeiling = computePayslip([line('BASIC', 6000)], AUGUST, profile);
      expect(basic.statutory.socso.employeeCents).toBe(atCeiling.statutory.socso.employeeCents);
      expect(basic.statutory.eis.employeeCents).toBe(atCeiling.statutory.eis.employeeCents);
    }
    expect(basic.statutory.pcbCents).not.toBeNull();
    expect(basic.grossCents - basic.employeeDeductionCents).toBe(basic.netCents);
    rows.push(
      `| ${wage} | basic only | ${rm(basic.grossCents)} | ${rm(basic.statutory.epf.employeeCents)} / ${rm(basic.statutory.epf.employerCents)} | ` +
        `${rm(basic.statutory.socso.employeeCents)} / ${rm(basic.statutory.socso.employerCents)} | ${rm(basic.statutory.eis.employeeCents)} / ${rm(basic.statutory.eis.employerCents)} | ` +
        `${rm(basic.statutory.pcbCents)} | ${rm(basic.netCents)} |`,
    );
  });

  it('overtime under mode A — the Act', () => {
    // Within the First Schedule the Act applies; above it, this is the
    // employer's undertaking to pay at the same rates.
    const scope = overtimeScope(wageCents, AUGUST.periodEnd, wage > 4000 ? 'PAY_AT_STATUTORY_RATES' : null);
    const pricing = priceOvertime(MONTH, classify, {
      basis: 'MONTHLY',
      scope,
      normalHoursPerDay: HOURS_PER_DAY,
      dailyOrpCents: rates.overtimeDailyCents,
      hourlyOrpCents: rates.overtimeHourlyCents,
    });
    // 6.5h × hourly × 1.5, hourly rounded to the sen first; the holiday is two
    // days' wages (s.60D(3)) at the daily rate, itself rounded to the sen —
    // the spreadsheet's rounding order, which the engine keeps.
    const hourly = Math.round(wageCents / 26 / HOURS_PER_DAY);
    const normalDays = Math.round(4 * hourly * 1.5) + Math.round(2.5 * hourly * 1.5);
    const holiday = 2 * rates.overtimeDailyCents;
    expect(pricing.normalDayHours).toBe(6.5);
    expect(pricing.totalCents).toBe(normalDays + holiday);
    const slip = computePayslip([line('BASIC', wage), line('OVERTIME', pricing.totalCents / 100)], AUGUST, profile);
    // Overtime is SOCSO and EIS wages, not EPF wages.
    expect(slip.statutory.epf.employeeCents).toBe(basic.statutory.epf.employeeCents);
    rows.push(
      `| ${wage} | OT mode A: 6.5 h at 1.5× (RM${rm(hourly)}/h) + 1 public holiday (2 days) | ${rm(slip.grossCents)} | ` +
        `${rm(slip.statutory.epf.employeeCents)} / ${rm(slip.statutory.epf.employerCents)} | ${rm(slip.statutory.socso.employeeCents)} / ${rm(slip.statutory.socso.employerCents)} | ` +
        `${rm(slip.statutory.eis.employeeCents)} / ${rm(slip.statutory.eis.employerCents)} | ${rm(slip.statutory.pcbCents)} | ${rm(slip.netCents)} | OT ${rm(normalDays)} + PH ${rm(holiday)}`,
    );
  });

  it('overtime under mode B — clinic rates, held to the Act as a floor', () => {
    const scope = overtimeScope(wageCents, AUGUST.periodEnd, null);
    const clinicRates =
      wage > 4000
        ? { ruleSet: 'Doctors', overtimeHourlyCents: null, publicHolidayShiftCents: 50000, restDayShiftCents: null, sessionCents: null }
        : { ruleSet: 'Front desk', overtimeHourlyCents: 2000, publicHolidayShiftCents: 25000, restDayShiftCents: null, sessionCents: null };
    const pricing = priceOvertime(MONTH, classify, {
      basis: 'MONTHLY',
      scope,
      normalHoursPerDay: HOURS_PER_DAY,
      dailyOrpCents: rates.overtimeDailyCents,
      hourlyOrpCents: rates.overtimeHourlyCents,
      clinicRates,
    });
    if (wage > 4000) {
      // A doctor: RM500 the holiday shift, and no hourly rate fixed — so the
      // normal days' overtime falls back to the Act, which does not reach a
      // RM5,600 wage with nothing contracted: nothing owed, hours recorded.
      expect(pricing.totalCents).toBe(50000);
      expect(pricing.belowStatutoryFloor).toHaveLength(0);
      expect(pricing.days.find((row) => row.dayType === 'PUBLIC_HOLIDAY')?.entitlement).toBe('CONTRACTUAL');
    } else {
      // RM20 an hour against the Act's RM22.31, and RM250 a holiday shift
      // against the Act's RM223.08: the hour is paid at the Act's figure and
      // blocks the run; the shift stands at the clinic rate.
      const hourly = Math.round(wageCents / 26 / HOURS_PER_DAY);
      const actHours = Math.round(4 * hourly * 1.5) + Math.round(2.5 * hourly * 1.5);
      expect(pricing.belowStatutoryFloor.map((row) => row.attendanceId)).toEqual(['a1', 'a2']);
      expect(pricing.totalCents).toBe(actHours + 25000);
    }
    rows.push(
      `| ${wage} | OT mode B: ${wage > 4000 ? 'Doctors — RM500 a public holiday shift, no hourly rate' : 'Front desk — RM20/h, RM250 a public holiday shift'} | ` +
        `${rm(pricing.totalCents)} extra | ${pricing.belowStatutoryFloor.length} day(s) below the Act | | | | |`,
    );
  });

  it('one day of unpaid leave — s.18A, over the days in the month', () => {
    const deduction = unpaidLeaveDeductionCents(1, rates);
    expect(deduction).toBe(Math.round(wageCents / DAYS_IN_AUGUST));
    const slip = computePayslip([line('BASIC', wage), line('UNPAID_LEAVE', deduction / 100, 'WAGE_REDUCTION')], AUGUST, profile);
    // Wages are smaller, so every base is smaller: EPF cannot exceed basic pay's.
    expect(slip.grossCents).toBe(wageCents - deduction);
    expect(slip.statutory.epf.employeeCents).toBeLessThanOrEqual(basic.statutory.epf.employeeCents ?? 0);
    rows.push(
      `| ${wage} | unpaid leave 1 day (RM${rm(deduction)} = ${wage} ÷ 31) | ${rm(slip.grossCents)} | ` +
        `${rm(slip.statutory.epf.employeeCents)} / ${rm(slip.statutory.epf.employerCents)} | ${rm(slip.statutory.socso.employeeCents)} / ${rm(slip.statutory.socso.employerCents)} | ` +
        `${rm(slip.statutory.eis.employeeCents)} / ${rm(slip.statutory.eis.employerCents)} | ${rm(slip.statutory.pcbCents)} | ${rm(slip.netCents)} |`,
    );
  });

  it('a claim reimbursement of RM42.00 is not taxed and not contributed on', () => {
    const slip = computePayslip([line('BASIC', wage), line('CLAIM_REIMBURSEMENT', 42)], AUGUST, profile);
    expect(slip.statutory.pcbCents).toBe(basic.statutory.pcbCents);
    expect(slip.statutory.epf.employeeCents).toBe(basic.statutory.epf.employeeCents);
    expect(slip.statutory.socso.employeeCents).toBe(basic.statutory.socso.employeeCents);
    expect(slip.statutory.eis.employeeCents).toBe(basic.statutory.eis.employeeCents);
    expect(slip.netCents).toBe(basic.netCents + 4200);
    rows.push(
      `| ${wage} | + mileage claim RM42.00 (not taxed) | ${rm(slip.grossCents)} | ${rm(slip.statutory.epf.employeeCents)} / ${rm(slip.statutory.epf.employerCents)} | ` +
        `${rm(slip.statutory.socso.employeeCents)} / ${rm(slip.statutory.socso.employerCents)} | ${rm(slip.statutory.eis.employeeCents)} / ${rm(slip.statutory.eis.employerCents)} | ` +
        `${rm(slip.statutory.pcbCents)} | ${rm(slip.netCents)} |`,
    );
  });
});

afterAll(() => {
  // Printed for docs/HR_RESTRUCTURE_PIECE3D.md — the owner compares these
  // with a real payslip.
  // eslint-disable-next-line no-console
  console.log(
    ['| Wage | Case | Gross | EPF ee / er | SOCSO ee / er | EIS ee / er | PCB | Net | Note |', '|---|---|---|---|---|---|---|---|---|', ...rows].join('\n'),
  );
});
