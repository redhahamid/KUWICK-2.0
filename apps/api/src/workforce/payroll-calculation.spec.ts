import {
  computeBracketContribution,
  computeEpf,
  computePayslip,
  computePcb,
  computeStatutory,
  dailyRateCents,
  overtimePayCents,
  statutoryStatusOf,
} from './payroll-calculation';

// A rule set a TENANT configured. Nothing here is a rate this system believes
// in — these are test fixtures standing in for what a clinic types into
// Settings, and the numbers are deliberately round so the arithmetic is
// checkable by eye rather than resembling any published table.
const CONFIGURED = {
  epfRules: { employeeRate: '10.000', employerRate: '12.000' },
  socsoRules: {
    brackets: [
      { from: '0', to: '1000.00', employee: '5.00', employer: '17.50' },
      { from: '1000.01', to: '3000.00', employee: '15.00', employer: '52.50' },
      { from: '3000.01', employee: '20.00', employer: '70.00' },
    ],
  },
  eisRules: {
    brackets: [
      { from: '0', to: '3000.00', employee: '2.00', employer: '2.00' },
      { from: '3000.01', employee: '5.00', employer: '5.00' },
    ],
  },
  pcbRules: {
    monthlyRelief: '500.00',
    brackets: [
      { from: '0', to: '2000.00', baseAmount: '0', percentOfExcess: '0' },
      { from: '2000.01', baseAmount: '10.00', percentOfExcess: '5.000' },
    ],
  },
};

describe('payroll calculation', () => {
  // -------------------------------------------------------------------------
  // THE RULE THE WHOLE MODULE EXISTS FOR
  // -------------------------------------------------------------------------
  describe('an unconfigured system computes NOTHING rather than zero', () => {
    it('returns absent contributions, not zeros, when no rules exist', () => {
      const result = computeStatutory(300000, null);
      expect(result.epf.employeeCents).toBeNull();
      expect(result.socso.employeeCents).toBeNull();
      expect(result.eis.employeeCents).toBeNull();
      expect(result.pcbCents).toBeNull();
      expect(result.epf.note).toMatch(/No statutory rate configured/);
    });

    it('marks a payslip incomplete when a statutory figure could not be computed', () => {
      const payslip = computePayslip({ basicSalary: '3000.00' }, null);
      expect(payslip.incomplete).toBe(true);
      // Net pay is gross, because nothing was deducted — visibly a draft
      // rather than a plausible final number.
      expect(payslip.netCents).toBe(payslip.grossCents);
    });

    it('reports NOT_CONFIGURED for an empty rule set and PROVISIONAL for an unverified one', () => {
      expect(statutoryStatusOf(null, false)).toBe('NOT_CONFIGURED');
      expect(statutoryStatusOf({}, true)).toBe('NOT_CONFIGURED');
      expect(statutoryStatusOf(CONFIGURED, false)).toBe('PROVISIONAL');
      expect(statutoryStatusOf(CONFIGURED, true)).toBe('CONFIGURED');
    });

    it('distinguishes "outside the scheme" from "not configured" — they are different facts', () => {
      const outside = computeStatutory(300000, CONFIGURED, { epf: false });
      expect(outside.epf.employeeCents).toBe(0);
      expect(outside.epf.note).toMatch(/outside the scheme/);

      const unconfigured = computeStatutory(300000, { epfRules: null });
      expect(unconfigured.epf.employeeCents).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('EPF from a configured rate pair', () => {
    it('applies the configured percentages', () => {
      const epf = computeEpf(300000, CONFIGURED.epfRules);
      expect(epf.employeeCents).toBe(30000);
      expect(epf.employerCents).toBe(36000);
    });

    it('honours a configured wage ceiling', () => {
      const epf = computeEpf(1000000, { employeeRate: '10.000', employerRate: '12.000', wageCeiling: '5000.00' });
      expect(epf.employeeCents).toBe(50000);
      expect(epf.employerCents).toBe(60000);
    });

    it('rounds up to the ringgit only when the tenant configured that', () => {
      const plain = computeEpf(333333, { employeeRate: '10.000', employerRate: '12.000' });
      expect(plain.employeeCents).toBe(33333);
      const rounded = computeEpf(333333, {
        employeeRate: '10.000',
        employerRate: '12.000',
        roundUpToRinggit: true,
      });
      expect(rounded.employeeCents).toBe(33400);
    });
  });

  describe('bracket contributions', () => {
    it('picks the band the wage falls in, inclusive at both edges', () => {
      expect(computeBracketContribution(100000, CONFIGURED.socsoRules).employeeCents).toBe(500);
      expect(computeBracketContribution(100001, CONFIGURED.socsoRules).employeeCents).toBe(1500);
      expect(computeBracketContribution(300000, CONFIGURED.socsoRules).employeeCents).toBe(1500);
      expect(computeBracketContribution(300001, CONFIGURED.socsoRules).employeeCents).toBe(2000);
    });

    it('reports a wage outside every band as a GAP, not as zero', () => {
      const partial = { brackets: [{ from: '0', to: '1000.00', employee: '5.00', employer: '17.50' }] };
      const result = computeBracketContribution(500000, partial);
      expect(result.employeeCents).toBeNull();
      expect(result.note).toMatch(/outside every configured contribution band/);
    });
  });

  describe('PCB', () => {
    it('is absent unless a schedule is configured — the common case', () => {
      const result = computePcb(400000, null);
      expect(result.cents).toBeNull();
      expect(result.note).toMatch(/not calculated by this system/);
    });

    it('applies the relief before the table, and the marginal rate to the excess', () => {
      // 3,000 chargeable − 500 relief = 2,500 taxable.
      // Band 2: base 10.00 + 5% of (2,500 − 2,000.01) ≈ 10 + 25.00
      const result = computePcb(300000, CONFIGURED.pcbRules);
      expect(result.cents).toBe(1000 + 2500);
    });

    it('is zero in the bottom band rather than absent', () => {
      const result = computePcb(150000, CONFIGURED.pcbRules);
      expect(result.cents).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('the payslip', () => {
    it('adds up gross, deductions, net and employer cost consistently', () => {
      const payslip = computePayslip(
        { basicSalary: '3000.00', allowances: '200.00', overtimePay: '150.00' },
        CONFIGURED,
      );
      expect(payslip.grossCents).toBe(335000);
      expect(payslip.statutoryWageCents).toBe(335000);

      // EPF 10/12%, SOCSO top band, EIS top band, PCB on 3,350.
      expect(payslip.statutory.epf.employeeCents).toBe(33500);
      expect(payslip.statutory.epf.employerCents).toBe(40200);
      expect(payslip.statutory.socso.employeeCents).toBe(2000);
      expect(payslip.statutory.eis.employeeCents).toBe(500);

      const expectedDeductions =
        33500 + 2000 + 500 + (payslip.statutory.pcbCents ?? 0);
      expect(payslip.employeeDeductionCents).toBe(expectedDeductions);
      expect(payslip.netCents).toBe(payslip.grossCents - expectedDeductions);
      expect(payslip.employerCostCents).toBe(payslip.grossCents + payslip.employerContributionCents);
      expect(payslip.incomplete).toBe(false);
    });

    it('EXCLUDES bonus and incentive from statutory wages, and says so by the arithmetic', () => {
      // Including them silently would over-contribute in a bonus month.
      const withBonus = computePayslip(
        { basicSalary: '3000.00', bonus: '5000.00', incentives: '1200.00' },
        CONFIGURED,
      );
      expect(withBonus.grossCents).toBe(920000);
      expect(withBonus.statutoryWageCents).toBe(300000);
      expect(withBonus.statutory.epf.employeeCents).toBe(30000);
    });

    it('reduces both gross and statutory wages by unpaid leave', () => {
      const payslip = computePayslip({ basicSalary: '3000.00', unpaidLeaveDeduction: '300.00' }, CONFIGURED);
      expect(payslip.grossCents).toBe(270000);
      expect(payslip.statutoryWageCents).toBe(270000);
      expect(payslip.statutory.epf.employeeCents).toBe(27000);
    });

    it('never produces a negative statutory wage', () => {
      const payslip = computePayslip({ basicSalary: '1000.00', unpaidLeaveDeduction: '2000.00' }, CONFIGURED);
      expect(payslip.statutoryWageCents).toBe(0);
    });
  });

  describe('helpers', () => {
    it('divides monthly pay by the calendar days in the month', () => {
      expect(dailyRateCents(310000, 31)).toBe(10000);
      expect(dailyRateCents(280000, 28)).toBe(10000);
      expect(dailyRateCents(0, 30)).toBe(0);
      expect(dailyRateCents(100000, 0)).toBe(0);
    });

    it('takes the overtime multiplier as a parameter rather than assuming one', () => {
      // 1.5× on a normal day and 2× on a rest day are contractual terms.
      expect(overtimePayCents(1000, 120, 1.5)).toBe(3000);
      expect(overtimePayCents(1000, 120, 2)).toBe(4000);
    });
  });
});
