import { computeVariance, VarianceLine } from './payroll-variance';

const line = (staffId: string, previousNetCents: number | null, currentNetCents: number | null): VarianceLine => ({
  staffId,
  name: `Employee ${staffId}`,
  previousNetCents,
  currentNetCents,
});

describe('payroll variance', () => {
  it('reports nothing material when nobody moved', () => {
    const r = computeVariance([line('a', 300000, 300000)], []);
    expect(r.rows[0].status).toBe('UNCHANGED');
    expect(r.material).toHaveLength(0);
  });

  it('flags a movement beyond the threshold as material', () => {
    const r = computeVariance([line('a', 300000, 600000)], [], 20);
    expect(r.rows[0]).toMatchObject({ status: 'MATERIAL', deltaCents: 300000, percent: 100 });
    expect(r.material).toHaveLength(1);
  });

  it('catches the classic extra zero', () => {
    const r = computeVariance([line('a', 300000, 3000000)], [], 20);
    expect(r.material[0].percent).toBe(900);
  });

  it('does not flag a movement inside the threshold', () => {
    const r = computeVariance([line('a', 300000, 330000)], [], 20);
    expect(r.rows[0].status).toBe('MOVED');
    expect(r.material).toHaveLength(0);
  });

  it('flags a large DROP as well as a large rise', () => {
    const r = computeVariance([line('a', 300000, 60000)], [], 20);
    expect(r.rows[0].status).toBe('MATERIAL');
    expect(r.rows[0].percent).toBe(-80);
  });

  it('treats an employee with no previous period as a joiner, not a 100% rise', () => {
    const r = computeVariance([line('a', null, 300000)], []);
    expect(r.rows[0]).toMatchObject({ status: 'NEW', percent: null });
    expect(r.joiners).toBe(1);
  });

  it('treats a disappearance as a leaver, and does not hide the money', () => {
    const r = computeVariance([line('a', 300000, null)], []);
    expect(r.rows[0]).toMatchObject({ status: 'LEFT', deltaCents: -300000 });
    expect(r.leavers).toBe(1);
  });

  it('never divides by zero', () => {
    const r = computeVariance([line('a', 0, 300000)], []);
    expect(r.rows[0].percent).toBeNull();
    expect(r.rows[0].status).toBe('MOVED');
  });

  it('counts headcount on both sides', () => {
    const r = computeVariance([line('a', 300000, 300000), line('b', null, 200000), line('c', 100000, null)], []);
    expect(r.headcountPrevious).toBe(2);
    expect(r.headcountCurrent).toBe(2);
  });

  it('reports totals with their own deltas and percentages', () => {
    const r = computeVariance([], [{ field: 'netCents', previous: 1000000, current: 1200000 }]);
    expect(r.totals[0]).toMatchObject({ deltaCents: 200000, percent: 20 });
  });

  it('honours a widened threshold for a clinic with variable locum hours', () => {
    const lines = [line('a', 300000, 390000)];
    expect(computeVariance(lines, [], 20).material).toHaveLength(1);
    expect(computeVariance(lines, [], 50).material).toHaveLength(0);
  });

  it('rounds the percentage to one decimal rather than showing a float', () => {
    expect(computeVariance([line('a', 300000, 310000)], []).rows[0].percent).toBe(3.3);
  });
});
