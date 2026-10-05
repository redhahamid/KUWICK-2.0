import { describe, expect, it } from 'vitest';
import { earnedInLabel, ytdSummary } from './payrollLabels';

describe('a line earned in another month', () => {
  it('carries that month, as the payslip prints it', () => {
    expect(earnedInLabel("Director's fee", '2026-04-01', '2026-05')).toBe("Director's fee (April 2026)");
  });

  it('is its plain label when earned in the month it is paid, or with no month', () => {
    expect(earnedInLabel("Director's fee", '2026-05-01', '2026-05')).toBe("Director's fee");
    expect(earnedInLabel('Allowance', null, '2026-05')).toBe('Allowance');
  });
});

describe('the year-to-date card', () => {
  it('names the months it adds up, not the month it sits beside', () => {
    expect(ytdSummary([1, 2, 3, 4], 2026, 5)).toEqual({ range: 'Jan – Apr 2026', gaps: [], pending: 'May', monthsOnRecord: 4 });
  });

  it('includes the run’s own month once it is approved', () => {
    expect(ytdSummary([1, 2, 3, 4, 5], 2026, 5)).toMatchObject({ range: 'Jan – May 2026', pending: null });
  });

  it('names a gap inside the range, and reads one month as one month', () => {
    expect(ytdSummary([1, 2, 4], 2026, 4)).toMatchObject({ range: 'Jan – Apr 2026', gaps: ['March'], pending: null });
    expect(ytdSummary([3], 2026, 3)).toMatchObject({ range: 'Mar 2026', gaps: [] });
  });

  it('says nothing about a range when no month is on record', () => {
    expect(ytdSummary([], 2026, 1)).toEqual({ range: null, gaps: [], pending: 'January', monthsOnRecord: 0 });
  });

  it('counts a month held for two employers once', () => {
    expect(ytdSummary([1, 1, 2], 2026)).toMatchObject({ range: 'Jan – Feb 2026', monthsOnRecord: 2 });
  });
});
