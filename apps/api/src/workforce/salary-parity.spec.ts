import { ParityInput, salaryParity } from './salary-parity';
import { SalaryRow, resolveSalaryForPayroll } from './salary-resolution';

const row = (id: string, amountCents: number, from: string, to?: string, basis: SalaryRow['basis'] = 'MONTHLY'): SalaryRow => ({
  id,
  basis,
  amountCents,
  effectiveFrom: new Date(`${from}T00:00:00.000Z`),
  effectiveTo: to ? new Date(`${to}T00:00:00.000Z`) : null,
});

const SEP_START = new Date('2026-09-01T00:00:00.000Z');
const SEP_END = new Date('2026-09-30T00:00:00.000Z');

const input = (over: Partial<ParityInput> = {}): ParityInput => ({
  staffId: 'staff-1',
  name: 'Nurul Hidayah',
  legacyCents: 320000,
  salaryRows: [row('a', 320000, '2026-03-05')],
  ...over,
});

describe('resolveSalaryForPayroll — payroll refuses to guess', () => {
  it('resolves a single rate in force for the whole period', () => {
    const out = resolveSalaryForPayroll([row('a', 320000, '2026-03-05')], SEP_START, SEP_END);
    expect(out.kind).toBe('RESOLVED');
    if (out.kind === 'RESOLVED') expect(out.row.amountCents).toBe(320000);
  });

  it('reports NO_SALARY rather than falling back to zero', () => {
    const out = resolveSalaryForPayroll([], SEP_START, SEP_END);
    expect(out.kind).toBe('NO_SALARY');
  });

  it('REFUSES a mid-period change instead of taking the rate at the period end', () => {
    const out = resolveSalaryForPayroll(
      [row('old', 320000, '2026-03-05', '2026-09-14'), row('new', 360000, '2026-09-15')],
      SEP_START,
      SEP_END,
    );
    expect(out.kind).toBe('CHANGED_MID_PERIOD');
    if (out.kind !== 'CHANGED_MID_PERIOD') return;
    // The four facts the owner needs to decide.
    expect(out.previous.amountCents).toBe(320000);
    expect(out.next.amountCents).toBe(360000);
    expect(out.changedOn.toISOString().slice(0, 10)).toBe('2026-09-15');
    expect(out.reason).toMatch(/has not been decided/i);
  });

  it('does not treat a change dated to the first of the period as mid-period', () => {
    const out = resolveSalaryForPayroll(
      [row('old', 320000, '2026-03-05', '2026-08-31'), row('new', 360000, '2026-09-01')],
      SEP_START,
      SEP_END,
    );
    expect(out.kind).toBe('RESOLVED');
    if (out.kind === 'RESOLVED') expect(out.row.amountCents).toBe(360000);
  });
});

describe('salary parity — the cutover proof', () => {
  it('is clean when every employee resolves to their legacy figure', () => {
    const report = salaryParity([input()], SEP_START, SEP_END);
    expect(report.clean).toBe(true);
    expect(report.mismatched).toBe(0);
    expect(report.byVerdict.MATCH).toBe(1);
  });

  it('names an employee whose effective-dated rate differs, and by how much', () => {
    const report = salaryParity(
      [input({ legacyCents: 320000, salaryRows: [row('a', 345000, '2026-03-05')] })],
      SEP_START,
      SEP_END,
    );
    expect(report.clean).toBe(false);
    expect(report.lines[0].verdict).toBe('AMOUNT_DIFFERS');
    expect(report.lines[0].differenceCents).toBe(25000);
    expect(report.lines[0].explanation).toMatch(/250\.00/);
  });

  it('flags an employee who had a legacy salary but no effective-dated row', () => {
    const report = salaryParity([input({ salaryRows: [] })], SEP_START, SEP_END);
    expect(report.lines[0].verdict).toBe('LEGACY_ONLY');
    expect(report.lines[0].explanation).toMatch(/NO_SALARY/);
    expect(report.clean).toBe(false);
  });

  it('counts an employee with no salary on either side as consistent, not as a mismatch', () => {
    const report = salaryParity([input({ legacyCents: null, salaryRows: [] })], SEP_START, SEP_END);
    expect(report.lines[0].verdict).toBe('NEITHER');
    expect(report.clean).toBe(true);
    expect(report.matched).toBe(1);
  });

  it('does not compare an employee whose salary changed mid-period — there is nothing to compare to', () => {
    const report = salaryParity(
      [
        input({
          salaryRows: [row('old', 320000, '2026-03-05', '2026-09-14'), row('new', 360000, '2026-09-15')],
        }),
      ],
      SEP_START,
      SEP_END,
    );
    expect(report.lines[0].verdict).toBe('CHANGED_MID_PERIOD');
    expect(report.lines[0].canonicalCents).toBeNull();
    expect(report.clean).toBe(false);
  });

  it('flags a daily or hourly rate as unsupported rather than paying it as a monthly figure', () => {
    const report = salaryParity(
      [input({ legacyCents: null, salaryRows: [row('a', 15000, '2026-01-01', undefined, 'DAILY')] })],
      SEP_START,
      SEP_END,
    );
    expect(report.lines[0].verdict).toBe('BASIS_UNSUPPORTED');
    expect(report.clean).toBe(false);
  });

  it('summarises the whole workforce, not a sample', () => {
    const report = salaryParity(
      [
        input({ staffId: 's1' }),
        input({ staffId: 's2', legacyCents: 900000, salaryRows: [row('b', 950000, '2026-01-01')] }),
        input({ staffId: 's3', legacyCents: null, salaryRows: [] }),
      ],
      SEP_START,
      SEP_END,
    );
    expect(report.total).toBe(3);
    expect(report.matched).toBe(2);
    expect(report.mismatched).toBe(1);
    expect(report.summary).toMatch(/1 of 3 employee\(s\) would be paid differently/);
  });
});
