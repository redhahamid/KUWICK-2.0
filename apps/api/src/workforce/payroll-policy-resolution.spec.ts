import { clinicRatesOf, resolvePayrollPolicy, ResolvablePolicy } from './payroll-policy-resolution';

const policy = (over: Partial<ResolvablePolicy> & { id: string; name: string }): ResolvablePolicy => ({
  isDefault: false,
  legalEmployerId: null,
  workforceCategory: null,
  overtimeMode: 'STATUTORY',
  clinicOvertimeHourly: null,
  clinicPublicHolidayShift: null,
  clinicRestDayShift: null,
  clinicSessionRate: null,
  ...over,
});

const STANDARD = policy({ id: 'std', name: 'Klinik Contoh standard', isDefault: true });
const DOCTORS = policy({
  id: 'doc',
  name: 'Doctors',
  workforceCategory: 'DOCTOR',
  overtimeMode: 'CLINIC_RATE',
  clinicPublicHolidayShift: '500.00',
});
const DOCTORS_AT_B = policy({ ...DOCTORS, id: 'doc-b', name: 'Doctors (Sdn Bhd B)', legalEmployerId: 'emp-b' });

describe('which rule set prices an employee', () => {
  it('takes the rule set assigned on the employee record before anything else', () => {
    const out = resolvePayrollPolicy([STANDARD, DOCTORS], { payrollPolicyId: 'std', legalEmployerId: null, category: 'DOCTOR' });
    expect(out).toEqual({ policy: STANDARD, how: 'ASSIGNED' });
  });

  it('falls to the rule set for the workforce category, the employing company first', () => {
    const atB = resolvePayrollPolicy([STANDARD, DOCTORS, DOCTORS_AT_B], { payrollPolicyId: null, legalEmployerId: 'emp-b', category: 'DOCTOR' });
    expect(atB).toEqual({ policy: DOCTORS_AT_B, how: 'CATEGORY' });
    const atA = resolvePayrollPolicy([STANDARD, DOCTORS, DOCTORS_AT_B], { payrollPolicyId: null, legalEmployerId: 'emp-a', category: 'DOCTOR' });
    expect(atA).toEqual({ policy: DOCTORS, how: 'CATEGORY' });
  });

  it('then to the default, and to nothing — the Act — when there is no default', () => {
    expect(resolvePayrollPolicy([STANDARD, DOCTORS], { payrollPolicyId: null, legalEmployerId: null, category: 'ADMIN' })).toEqual({
      policy: STANDARD,
      how: 'DEFAULT',
    });
    expect(resolvePayrollPolicy([DOCTORS], { payrollPolicyId: null, legalEmployerId: null, category: 'ADMIN' })).toEqual({
      policy: null,
      how: 'NONE',
    });
  });

  it('ignores an assignment to a rule set that no longer exists', () => {
    // A deleted or foreign id must not leave somebody on no rule set when the
    // category or default would have covered them.
    const out = resolvePayrollPolicy([STANDARD, DOCTORS], { payrollPolicyId: 'gone', legalEmployerId: null, category: 'DOCTOR' });
    expect(out).toEqual({ policy: DOCTORS, how: 'CATEGORY' });
  });
});

describe('the clinic rates of a rule set', () => {
  it('are null on a statutory rule set, whatever amounts it happens to carry', () => {
    expect(clinicRatesOf(policy({ id: 'x', name: 'x', clinicOvertimeHourly: '40.00' }))).toBeNull();
    expect(clinicRatesOf(null)).toBeNull();
  });

  it('come out in cents, with a missing amount as null rather than nought', () => {
    expect(clinicRatesOf(DOCTORS)).toEqual({
      ruleSet: 'Doctors',
      overtimeHourlyCents: null,
      publicHolidayShiftCents: 50000,
      restDayShiftCents: null,
      sessionCents: null,
    });
  });
});
