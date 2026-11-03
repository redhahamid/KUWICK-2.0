import { compareMonths, type ComparableLine } from './payroll-comparison';

/* THIS MONTH BESIDE THE ONE BEFORE (new-clinic UAT #2 re-check, item 81). Demo names only. */
const line = (staffId: string, name: string, over: Partial<ComparableLine> = {}): ComparableLine => ({
  staffId,
  name,
  grossPay: '2000.00',
  netPay: '1757.25',
  employerCost: '2266.30',
  basicSalary: '2000.00',
  overtimePay: '0.00',
  unpaidLeaveDeduction: '0.00',
  ...over,
});
const oct = new Date(Date.UTC(2026, 9, 1));
const nov = new Date(Date.UTC(2026, 10, 1));

describe('compareMonths', () => {
  it('puts the four totals side by side and says why a joiner’s pay rose', () => {
    const result = compareMonths({
      previous: [line('s1', 'Demo Nurse', { grossPay: '1096.77', netPay: '963.00', employerCost: '1240.00', basicSalary: '1096.77' })],
      current: [line('s1', 'Demo Nurse')],
      employment: new Map([['s1', { startDate: new Date(Date.UTC(2026, 9, 15)), endDate: null }]]),
      previousMonth: oct,
      currentMonth: nov,
      previousLabel: 'October',
      currentLabel: 'November',
    });
    expect(result.totals).toEqual([
      { label: 'Gross pay', previous: '1096.77', current: '2000.00', change: '+903.23' },
      { label: 'Employee deductions', previous: '133.77', current: '242.75', change: '+108.98' },
      { label: 'Net pay', previous: '963.00', current: '1757.25', change: '+794.25' },
      { label: 'Cost to the clinic', previous: '1240.00', current: '2266.30', change: '+1026.30' },
    ]);
    expect(result.people).toEqual([
      { staffId: 's1', name: 'Demo Nurse', previousNet: '963.00', currentNet: '1757.25', change: '+794.25', reason: 'Joined 15 Oct, part month in October' },
    ]);
  });

  it('names newcomers, leavers and the other reasons, and leaves out anybody unchanged', () => {
    const result = compareMonths({
      previous: [line('s1', 'Demo Clerk'), line('s2', 'Demo Leaver'), line('s3', 'Demo Same'), line('s4', 'Demo Overtime')],
      current: [line('s1', 'Demo Clerk', { basicSalary: '2200.00', grossPay: '2200.00', netPay: '1930.00' }), line('s3', 'Demo Same'), line('s4', 'Demo Overtime', { overtimePay: '120.00', grossPay: '2120.00', netPay: '1860.00' }), line('s5', 'Demo Joiner')],
      employment: new Map([
        ['s2', { startDate: null, endDate: new Date(Date.UTC(2026, 9, 31)) }],
        ['s5', { startDate: new Date(Date.UTC(2026, 10, 3)), endDate: null }],
      ]),
      previousMonth: oct,
      currentMonth: nov,
      previousLabel: 'October',
      currentLabel: 'November',
    });
    expect(result.people.map((person) => [person.name, person.reason])).toEqual([
      ['Demo Clerk', 'Basic pay changed'],
      ['Demo Joiner', 'Joined 3 Nov, part month'],
      ['Demo Leaver', 'Left 31 Oct'],
      ['Demo Overtime', 'Overtime'],
    ]);
    expect(result.people.find((person) => person.name === 'Demo Leaver')).toMatchObject({ currentNet: null, change: '-1757.25' });
  });
});
