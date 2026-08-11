import { describe, expect, it } from 'vitest';
import { axisLabelIndices } from './TrendChart';

// A1 route sweep — found as eight duplicate-React-key warnings on
// /management/reports: `[0, mid, last]` is only three DISTINCT positions
// when the range holds three or more days. Short and empty ranges are real
// states (a clinic's first day; a filter with no data), not edge cases.
describe('axisLabelIndices', () => {
  it('an empty range labels nothing — not dayjs(undefined), which is today', () => {
    expect(axisLabelIndices(0)).toEqual([]);
  });

  it('one day gets exactly one label, not three stacked copies with one key', () => {
    expect(axisLabelIndices(1)).toEqual([0]);
  });

  it('two days label both ends without repeating index 0', () => {
    expect(axisLabelIndices(2)).toEqual([0, 1]);
  });

  it('a real range labels first, middle and last, all distinct and in bounds', () => {
    expect(axisLabelIndices(31)).toEqual([0, 15, 30]);
  });
});
