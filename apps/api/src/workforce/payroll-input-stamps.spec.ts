import { computeInputStamps, diffInputStamps, storedInputStamps, type InputStamps, type StampDb } from './payroll-input-stamps';

const stamps = (employees: InputStamps['employees']): InputStamps => ({ version: 1, employees });

describe('what a draft was worked out from', () => {
  it('names each employee whose records moved, and which kind', () => {
    const saved = stamps({ a: { salary: 's1', standing: 't1', employee: 'e1' }, b: { salary: 's2', standing: 't2', employee: 'e2' } });
    const now = stamps({ a: { salary: 's1', standing: 'T1', employee: 'e1' }, b: { salary: 's2', standing: 't2', employee: 'e2' } });
    expect(diffInputStamps(saved, now)).toEqual([{ staffId: 'a', what: ['statutory standing'] }]);
  });

  it('says who joined or left the run’s scope since', () => {
    const saved = stamps({ a: { salary: 's1' } });
    const now = stamps({ b: { salary: 's2' } });
    expect(diffInputStamps(saved, now)).toEqual(
      expect.arrayContaining([
        { staffId: 'a', what: ['no longer in this month’s payroll'] },
        { staffId: 'b', what: ['joined this month’s payroll'] },
      ]),
    );
  });

  it('is empty when nothing moved', () => {
    const same = stamps({ a: { salary: 's1', inputs: 'i1' } });
    expect(diffInputStamps(same, stamps({ a: { salary: 's1', inputs: 'i1' } }))).toEqual([]);
  });

  /*
   * THE FINGERPRINT READS THE MONTH. A fake database stands in for Prisma:
   * each delegate answers findMany with the rows a test gives it.
   */
  const OCT = new Date('2026-10-01T00:00:00.000Z');
  const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const fakeDb = (rows: { salary?: object[]; standing?: object[]; profile?: Record<string, unknown> }): StampDb => {
    const none = { findMany: async () => [] };
    const profile = {
      id: 'p1', staffId: 's1', employeeNo: 'E1', legalName: null, dateOfBirth: D('1990-01-01'), employmentType: 'PERMANENT',
      employmentStatus: 'ACTIVE', workDaysPerWeek: null, startDate: D('2024-01-01'), endDate: null, position: 'Nurse', department: null,
      bankName: 'Maybank', legalEmployerId: 'le1', payrollPolicyId: null, leavePolicyId: null,
      staff: { fullName: 'Demo Nurse', active: true, clinicId: 'c1' },
      ...rows.profile,
    };
    return {
      employeeProfile: { findMany: async () => [profile] },
      employeeSalary: { findMany: async () => rows.salary ?? [] },
      employeeStatutoryClassification: { findMany: async () => rows.standing ?? [] },
      employeeContributionBasis: none, employeeTp1Entry: none, employeeTp3Record: none, attendanceRecord: none, leaveRequest: none,
      incentiveResult: none, payrollInputEntry: none, staffClaim: none, employeeRecurringItem: none, employeeYtd: none,
    } as unknown as StampDb;
  };
  const salary = (over: Record<string, unknown> = {}) => ({ id: 'sal1', staffId: 's1', basis: 'MONTHLY', amount: '3400.00', effectiveFrom: D('2026-01-01'), effectiveTo: null, reason: 'Starting', createdAt: D('2026-01-01'), ...over });

  it('does not move when a version is closed after the month, or its reason is reworded', async () => {
    const before = await computeInputStamps(fakeDb({ salary: [salary()] }), { clinicId: 'c1', period: OCT });
    const closedLater = await computeInputStamps(
      fakeDb({ salary: [salary({ effectiveTo: D('2026-12-31'), reason: 'Reworded' }), salary({ id: 'sal2', amount: '3600.00', effectiveFrom: D('2027-01-01') })] }),
      { clinicId: 'c1', period: OCT },
    );
    expect(diffInputStamps(before, closedLater)).toEqual([]);
  });

  it('moves when the month’s own figure changes, or a version starts inside it', async () => {
    const before = await computeInputStamps(fakeDb({ salary: [salary()] }), { clinicId: 'c1', period: OCT });
    const raised = await computeInputStamps(fakeDb({ salary: [salary({ amount: '3500.00' })] }), { clinicId: 'c1', period: OCT });
    expect(diffInputStamps(before, raised)).toEqual([{ staffId: 's1', what: ['salary'] }]);
    const midMonth = await computeInputStamps(
      fakeDb({ salary: [salary({ effectiveTo: D('2026-10-14') }), salary({ id: 'sal2', amount: '3600.00', effectiveFrom: D('2026-10-15') })] }),
      { clinicId: 'c1', period: OCT },
    );
    expect(diffInputStamps(before, midMonth)).toEqual([{ staffId: 's1', what: ['salary'] }]);
  });

  it('reads a new phone number as no change, and a new bank as one', async () => {
    const before = await computeInputStamps(fakeDb({}), { clinicId: 'c1', period: OCT });
    expect(diffInputStamps(before, await computeInputStamps(fakeDb({ profile: { phone: '012-0000000' } }), { clinicId: 'c1', period: OCT }))).toEqual([]);
    expect(diffInputStamps(before, await computeInputStamps(fakeDb({ profile: { bankName: 'CIMB' } }), { clinicId: 'c1', period: OCT }))).toEqual([
      { staffId: 's1', what: ['employee record'] },
    ]);
  });

  it('has nothing to compare with for a run worked out before fingerprints existed', () => {
    expect(storedInputStamps(null)).toBeNull();
    expect(storedInputStamps({ version: 2, employees: {} })).toBeNull();
    expect(storedInputStamps(stamps({}))).toEqual(stamps({}));
  });
});
