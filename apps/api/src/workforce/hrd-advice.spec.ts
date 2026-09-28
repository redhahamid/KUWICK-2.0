import { hrdAdviceFor } from './hrd-advice';

/**
 * "3 not worked out" is not an explanation. The run says, per company, why
 * the levy is a dash and what to do about it — and the answer depends on the
 * class's date against the month, on whether it was recorded before or after
 * the month was worked out, and on whether the month can still be reopened.
 */
describe('why the HRD levy is a dash', () => {
  const lastDay = new Date('2026-07-31T00:00:00.000Z');
  const base = { lastDay, monthName: 'July 2026', notWorkedOut: 3, calculatedAt: new Date('2026-08-01T02:00:00.000Z') };
  const recorded = (effectiveFrom: string, createdAt: string) => ({
    name: 'Hijraa Sdn Bhd',
    latest: { effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`), hrdRegistration: 'MANDATORY_SECTION_14', createdAt: new Date(createdAt) },
  });

  it('says nothing when every line has a levy', () => {
    expect(hrdAdviceFor({ ...base, employers: [recorded('2026-01-01', '2026-01-02T00:00:00.000Z')], runStatus: 'APPROVED', notWorkedOut: 0 })).toBeNull();
  });

  it('names the class date when it falls after the month — the case a clinic mistook for a bug', () => {
    const text = hrdAdviceFor({ ...base, employers: [recorded('2026-09-01', '2026-09-28T00:00:00.000Z')], runStatus: 'APPROVED' });
    expect(text).toContain('recorded from 1 Sep 2026, after July 2026');
    expect(text).toContain('record it from that date');
  });

  it('says to reopen and recalculate when the class covers the month but came after it was worked out', () => {
    const text = hrdAdviceFor({ ...base, employers: [recorded('2026-01-01', '2026-09-28T00:00:00.000Z')], runStatus: 'APPROVED' });
    expect(text).toContain('Reopen the month, recalculate and approve it again');
  });

  it('says a paid month cannot be reopened', () => {
    const text = hrdAdviceFor({ ...base, employers: [recorded('2026-01-01', '2026-09-28T00:00:00.000Z')], runStatus: 'PAID' });
    expect(text).toContain('settled outside Kuwick');
  });

  it('says to recalculate while the month is still open', () => {
    const text = hrdAdviceFor({ ...base, employers: [recorded('2026-01-01', '2026-09-28T00:00:00.000Z')], runStatus: 'CALCULATED' });
    expect(text).toContain('Recalculate to include the levy');
  });

  it('says the class is not recorded at all, and where to record it', () => {
    const text = hrdAdviceFor({ ...base, employers: [{ name: 'Hijraa Sdn Bhd', latest: null }], runStatus: 'DRAFT' });
    expect(text).toContain('is not recorded');
    expect(text).toContain('Settings, Company and statutory');
  });

  it('points at the rows when the class applies and was in place before the month was worked out', () => {
    const text = hrdAdviceFor({ ...base, employers: [recorded('2026-01-01', '2026-01-02T00:00:00.000Z')], runStatus: 'APPROVED', notWorkedOut: 1 });
    expect(text).toContain('for 1 person for a reason on their own row');
  });

  it('says when nobody in the run has an employing company', () => {
    expect(hrdAdviceFor({ ...base, employers: [], runStatus: 'DRAFT' })).toContain('no employing company on record');
  });
});
