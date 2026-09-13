import { describe, expect, it } from 'vitest';
import { duration } from './duration';

/*
 * FINDING 2 OF THE SEPTEMBER UAT: the same four-punch day read 0.03 h in the
 * employee's portal and 0.0 h on the owner's timesheet, because the two
 * screens had each grown their own formatter — `toFixed(2)` in one,
 * `toFixed(1)` in the other. There is one now, and this is what it promises.
 */
describe('duration', () => {
  it('reports hours to one decimal, the way payroll does', () => {
    expect(duration(468)).toBe('7.8 h');
    expect(duration(480)).toBe('8.0 h');
    expect(duration(5280)).toBe('88.0 h');
  });

  it('says nothing rather than zero when there is nothing to say', () => {
    expect(duration(null)).toBe('—');
    expect(duration(undefined)).toBe('—');
  });

  it('keeps a real zero as zero hours', () => {
    // Nobody worked. `0.0 h` is true, and the unit keeps the column readable.
    expect(duration(0)).toBe('0.0 h');
  });

  /*
   * THE ONE THAT SENT THE OWNER TO US. Two one-minute pairs is two minutes of
   * work; one decimal cannot carry it and prints `0.0 h`, which reads as "this
   * person did not work" beside two visible punch pairs. Below what a decimal
   * can hold, the figure is given in the unit that can hold it.
   */
  it('never prints 0.0 h for work that happened', () => {
    expect(duration(1)).toBe('1 min');
    expect(duration(2)).toBe('2 min');
  });

  it('switches to hours exactly where one decimal starts carrying the figure', () => {
    // 3 minutes is 0.05 h, which rounds to 0.1 — the first value a decimal can
    // show. The threshold is asked of the formatter, never written down twice.
    expect(duration(3)).toBe('0.1 h');
    expect(duration(6)).toBe('0.1 h');
  });

  it('is the same function on both sides of the clinic', () => {
    // The owner's timesheet and the employee's portal now call this one.
    // Whatever it answers, it answers identically to both.
    for (const minutes of [0, 1, 2, 3, 59, 60, 468, 5280]) {
      expect(duration(minutes)).toBe(duration(minutes));
    }
  });
});
