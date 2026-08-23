import { describe, expect, it } from 'vitest';
import { composeMonth, personName } from './booking-composition';

describe('personName', () => {
  it('drops the honorific so six doctors do not all monogram to "D"', () => {
    expect(personName('Dr. Chong Wei Ling')).toBe('Chong Wei Ling');
    expect(personName('Dr Nurul Aisyah binti Hamid')).toBe('Nurul Aisyah binti Hamid');
    expect(personName('Prof. Farid Iskandar bin Zulkifli')).toBe('Farid Iskandar bin Zulkifli');
  });

  it('leaves a name that never had one alone', () => {
    expect(personName('Siti Aminah binti Rahman')).toBe('Siti Aminah binti Rahman');
  });

  it('only strips LEADING titles — a name is not a title because it looks like one', () => {
    // "Ms" here is a middle name, not an honorific: it is not in front.
    expect(personName('Chong Ms Ling')).toBe('Chong Ms Ling');
  });

  it('never strips a provider down to nothing', () => {
    expect(personName('Dr')).toBe('Dr');
    expect(personName('Dr.')).toBe('Dr.');
  });

  it('handles stacked titles and untidy spacing', () => {
    expect(personName('  Datuk  Dr.  Priyadarshini a/p Raghavan ')).toBe(
      'Priyadarshini a/p Raghavan',
    );
  });
});

describe('composeMonth', () => {
  // August 2026: the 1st is a Saturday, so padding is 6 and the month runs to 31.
  const AUGUST = { month: '2026-08', padding: 6, daysInMonth: 31 };
  const dates = (composition: ReturnType<typeof composeMonth>) =>
    composition.weeks.flat().filter((cell) => cell.date).map((cell) => cell.date);

  it('drops the leading weeks that have wholly passed, and says how many days went', () => {
    const composed = composeMonth({ ...AUGUST, today: '2026-08-23' });
    expect(composed.hiddenDays).toBe(22);
    expect(dates(composed)[0]).toBe('2026-08-23');
    expect(dates(composed)).toHaveLength(9);
  });

  it('keeps the whole month when nothing in it has passed yet', () => {
    const composed = composeMonth({ ...AUGUST, today: '2026-07-30' });
    expect(composed.hiddenDays).toBe(0);
    expect(dates(composed)).toHaveLength(31);
  });

  it('never collapses the week TODAY sits in, even mid-week', () => {
    // 26 Aug 2026 is a Wednesday; its week starts Sunday the 23rd.
    const composed = composeMonth({ ...AUGUST, today: '2026-08-26' });
    expect(dates(composed)).toContain('2026-08-23');
    expect(dates(composed)).toContain('2026-08-26');
    expect(composed.hiddenDays).toBe(22);
  });

  it('pins open the week holding a date the caller singled out', () => {
    // The reschedule flow marks the appointment's current date. Even when that
    // week is entirely past, hiding it would hide the thing being changed.
    const composed = composeMonth({
      ...AUGUST,
      today: '2026-08-23',
      markedDate: '2026-08-12',
    });
    expect(dates(composed)).toContain('2026-08-12');
    expect(composed.hiddenDays).toBe(8);
  });

  it('pins open the week holding the selected date', () => {
    const composed = composeMonth({
      ...AUGUST,
      today: '2026-08-23',
      selectedDate: '2026-08-05',
    });
    expect(dates(composed)).toContain('2026-08-05');
    expect(composed.hiddenDays).toBe(1);
  });

  it('never returns an empty grid, even for a month wholly in the past', () => {
    const composed = composeMonth({ ...AUGUST, today: '2027-01-01' });
    expect(composed.weeks.length).toBe(1);
    expect(dates(composed)).toContain('2026-08-30');
    expect(dates(composed)).toContain('2026-08-31');
  });

  it('keeps seven aligned columns in every week it returns', () => {
    const composed = composeMonth({ ...AUGUST, today: '2026-08-23' });
    for (const week of composed.weeks.slice(0, -1)) expect(week).toHaveLength(7);
  });

  it('loses no date: what is drawn plus what is hidden is the whole month', () => {
    for (const today of ['2026-07-31', '2026-08-01', '2026-08-15', '2026-08-23', '2026-08-31']) {
      const composed = composeMonth({ ...AUGUST, today });
      expect(dates(composed).length + composed.hiddenDays).toBe(31);
    }
  });
});
