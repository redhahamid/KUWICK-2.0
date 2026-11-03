import { leaveRulesOf, offeredTo } from './leave-types';

/* New-clinic UAT #2 re-check, items 79 and 80. */
describe('who a leave type is for', () => {
  it('offers maternity to women and paternity to men, and both when gender is not recorded', () => {
    expect(offeredTo('MATERNITY', 'FEMALE')).toBe(true);
    expect(offeredTo('MATERNITY', 'MALE')).toBe(false);
    expect(offeredTo('PATERNITY', 'FEMALE')).toBe(false);
    expect(offeredTo('PATERNITY', 'MALE')).toBe(true);
    expect(offeredTo('PATERNITY', null)).toBe(true);
    expect(offeredTo('ANNUAL', 'FEMALE')).toBe(true);
  });

  it('reads the clinic’s part-year rules, with Kuwick’s defaults where none are saved', () => {
    expect(leaveRulesOf(null)).toEqual({ rounding: 'HALF', notProRated: ['COMPASSIONATE'] });
    expect(leaveRulesOf({ rounding: 'WHOLE', notProRated: [] })).toEqual({ rounding: 'WHOLE', notProRated: [] });
  });
});
