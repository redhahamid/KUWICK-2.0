import { HOLIDAY_PRESET_YEARS, MALAYSIAN_STATES, holidayPresets } from './holiday-presets';

/*
 * The starting holiday list (new-clinic UAT, 15 October 2026): federal days
 * everywhere, state days only where observed, one row per date.
 */
describe('holidayPresets', () => {
  it('gives every state the federal days and only its own state days', () => {
    const selangor = holidayPresets(2026, 'Selangor');
    const sarawak = holidayPresets(2026, 'Sarawak');
    for (const list of [selangor, sarawak]) {
      expect(list.map((row) => row.date)).toEqual(expect.arrayContaining(['2026-05-01', '2026-08-31', '2026-09-16', '2026-12-25']));
    }
    expect(selangor.find((row) => row.date === '2026-12-11')?.name).toBe('Birthday of the Sultan of Selangor');
    expect(sarawak.find((row) => row.date === '2026-12-11')).toBeUndefined();
    expect(sarawak.find((row) => row.date === '2026-07-22')?.name).toBe('Sarawak Day');
    // Deepavali is not a Sarawak holiday.
    expect(sarawak.find((row) => row.date === '2026-11-08')).toBeUndefined();
  });

  it('names two holidays on one day once, as one day off', () => {
    const kl = holidayPresets(2026, 'W.P. Kuala Lumpur');
    const first = kl.filter((row) => row.date === '2026-02-01');
    expect(first).toHaveLength(1);
    expect(first[0].name).toBe('Thaipusam / Federal Territory Day');
  });

  it('marks dates that move with the moon for checking, and is sorted with no duplicates', () => {
    for (const state of MALAYSIAN_STATES) {
      const list = holidayPresets(2026, state);
      expect(new Set(list.map((row) => row.date)).size).toBe(list.length);
      expect([...list].sort((a, b) => a.date.localeCompare(b.date))).toEqual(list);
    }
    expect(holidayPresets(2026, 'Johor').find((row) => row.date === '2026-03-21')?.check).toBe(true);
    expect(HOLIDAY_PRESET_YEARS).toContain(2026);
    expect(holidayPresets(2031, 'Johor')).toEqual([]);
  });

  /* New-clinic UAT #2, item 63: a holiday on the rest day moves to the next working day. */
  it('adds the replacement days, each marked for checking (Selangor 2026)', () => {
    const replacements = holidayPresets(2026, 'Selangor').filter((row) => row.replacement);
    expect(replacements.map((row) => row.date)).toEqual(['2026-02-02', '2026-03-23', '2026-06-02', '2026-11-09']);
    expect(replacements.every((row) => row.check)).toBe(true);
    // Wesak (Sunday 31 May) skips the Agong's birthday on Monday 1 June.
    expect(replacements[2].name).toBe('Replacement holiday for Wesak Day');
  });

  it('uses Friday as the rest day where the weekend is Friday and Saturday', () => {
    const kedah = holidayPresets(2026, 'Kedah');
    // Labour Day, Friday 1 May: the next working day is Sunday 3 May.
    expect(kedah.find((row) => row.date === '2026-05-03')).toMatchObject({ replacement: true });
    // A Sunday holiday there is a working day off, with no replacement.
    expect(kedah.find((row) => row.date === '2026-02-02')).toBeUndefined();
  });
});
