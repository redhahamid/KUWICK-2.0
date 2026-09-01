import { resolveSalaryForPeriod, SalaryRow } from './salary-resolution';

const row = (id: string, amountCents: number, from: string, to?: string): SalaryRow => ({
  id,
  basis: 'MONTHLY',
  amountCents,
  effectiveFrom: new Date(`${from}T00:00:00.000Z`),
  effectiveTo: to ? new Date(`${to}T00:00:00.000Z`) : null,
});

const JULY_START = new Date('2026-07-01T00:00:00.000Z');
const JULY_END = new Date('2026-07-31T00:00:00.000Z');

describe('salary resolution', () => {
  it('finds nothing when no salary is recorded, and says so rather than returning zero', () => {
    const r = resolveSalaryForPeriod([], JULY_START, JULY_END);
    expect(r.row).toBeNull();
    expect(r.reason).toMatch(/No salary is recorded/);
  });

  it('resolves an open-ended salary that started long before the period', () => {
    const r = resolveSalaryForPeriod([row('a', 300000, '2024-01-01')], JULY_START, JULY_END);
    expect(r.row?.id).toBe('a');
    expect(r.changedDuringPeriod).toBe(false);
  });

  it('does NOT apply a salary that only starts after the period ends', () => {
    const r = resolveSalaryForPeriod([row('future', 500000, '2026-08-01')], JULY_START, JULY_END);
    expect(r.row).toBeNull();
  });

  it('does NOT apply a salary that ended before the period began', () => {
    const r = resolveSalaryForPeriod([row('old', 200000, '2023-01-01', '2026-06-30')], JULY_START, JULY_END);
    expect(r.row).toBeNull();
  });

  it('resolves the historical rate for a historical period, not the current one', () => {
    const rows = [row('old', 200000, '2024-01-01', '2026-06-30'), row('new', 300000, '2026-07-01')];
    const june = resolveSalaryForPeriod(
      rows,
      new Date('2026-06-01T00:00:00.000Z'),
      new Date('2026-06-30T00:00:00.000Z'),
    );
    expect(june.row?.id).toBe('old');
    expect(june.row?.amountCents).toBe(200000);
  });

  it('is the whole point: a raise today does not reprice last year', () => {
    const rows = [row('then', 250000, '2025-01-01', '2025-12-31'), row('now', 900000, '2026-01-01')];
    const backThen = resolveSalaryForPeriod(
      rows,
      new Date('2025-03-01T00:00:00.000Z'),
      new Date('2025-03-31T00:00:00.000Z'),
    );
    expect(backThen.row?.amountCents).toBe(250000);
  });

  it('flags a mid-period change and uses the rate in force at the period end', () => {
    const rows = [row('before', 300000, '2024-01-01', '2026-07-14'), row('after', 360000, '2026-07-15')];
    const r = resolveSalaryForPeriod(rows, JULY_START, JULY_END);
    expect(r.row?.id).toBe('after');
    expect(r.changedDuringPeriod).toBe(true);
    expect(r.overlapping).toHaveLength(2);
    expect(r.reason).toMatch(/2 rates overlap/);
  });

  it('reports overlap even when the later row starts on the last day of the period', () => {
    const rows = [row('before', 300000, '2024-01-01', '2026-07-30'), row('after', 360000, '2026-07-31')];
    const r = resolveSalaryForPeriod(rows, JULY_START, JULY_END);
    expect(r.row?.id).toBe('after');
    expect(r.changedDuringPeriod).toBe(true);
  });

  it('says a salary covered part of the period but not its end, rather than silently finding nothing', () => {
    const r = resolveSalaryForPeriod([row('gone', 300000, '2024-01-01', '2026-07-10')], JULY_START, JULY_END);
    expect(r.row).toBeNull();
    expect(r.overlapping).toHaveLength(1);
    expect(r.reason).toMatch(/none was in force at the period end/);
  });

  it('is insensitive to the order rows arrive in', () => {
    const rows = [row('after', 360000, '2026-07-15'), row('before', 300000, '2024-01-01', '2026-07-14')];
    expect(resolveSalaryForPeriod(rows, JULY_START, JULY_END).row?.id).toBe('after');
  });

  it('carries the basis through, so an hourly employee is not treated as monthly', () => {
    const hourly: SalaryRow = { ...row('h', 12000, '2024-01-01'), basis: 'HOURLY' };
    expect(resolveSalaryForPeriod([hourly], JULY_START, JULY_END).row?.basis).toBe('HOURLY');
  });
});
