import { SnapshotPayload } from './payroll-snapshot';
import { salaryDateOf, scheduleOf } from './payroll-payment.service';

/*
 * THE MONTH'S PAYMENTS, READ FROM THE APPROVED RECORD (UAT, 10 October
 * 2026). A record written with pay dates is paid on each of its dates; one
 * approved before pay dates existed is one payment of everybody's net, as it
 * always was.
 */
describe('the payments an approved record makes', () => {
  const employee = (staffId: string, name: string, netCents: number, payments?: { date: string; netCents: number }[]) =>
    ({
      staffId,
      name,
      netCents,
      ...(payments ? { payments: payments.map((payment) => ({ ...payment, earningsCents: payment.netCents, deductionCents: 0 })) } : {}),
    }) as unknown as SnapshotPayload['employees'][number];
  const payload = (employees: SnapshotPayload['employees'], components?: SnapshotPayload['components']) =>
    ({ period: '2026-10-01', employees, components, totals: { netCents: 0 } }) as unknown as SnapshotPayload;

  it('pays a record from before pay dates as one payment of the whole net', () => {
    const schedule = scheduleOf(payload([employee('a', 'Ana', 300_000), employee('b', 'Badrul', 250_000)]));
    expect(schedule).toEqual([
      {
        date: null,
        people: [
          { staffId: 'a', name: 'Ana', amountCents: 300_000 },
          { staffId: 'b', name: 'Badrul', amountCents: 250_000 },
        ],
        totalCents: 550_000,
      },
    ]);
  });

  it('groups a dated record by date, in date order, and leaves out a date that pays nobody anything', () => {
    const schedule = scheduleOf(
      payload([
        employee('a', 'Ana', 350_000, [
          { date: '2026-11-15', netCents: 20_000 },
          { date: '2026-10-30', netCents: 280_000 },
          { date: '2026-11-01', netCents: 50_000 },
        ]),
        employee('b', 'Badrul', 250_000, [
          { date: '2026-10-30', netCents: 250_000 },
          { date: '2026-11-15', netCents: 0 },
        ]),
      ]),
    );
    expect(schedule.map((entry) => [entry.date, entry.totalCents, entry.people.length])).toEqual([
      ['2026-10-30', 530_000, 2],
      ['2026-11-01', 50_000, 1],
      ['2026-11-15', 20_000, 2],
    ]);
  });

  it('finds the salary date from the record’s own catalogue', () => {
    const basic = { code: 'BASIC', payDate: { payDay: 25, payMonthOffset: 0 } } as unknown as NonNullable<SnapshotPayload['components']>[number];
    expect(salaryDateOf(payload([], [basic]))).toBe('2026-10-25');
    expect(salaryDateOf(payload([]))).toBeNull();
  });
});
