import { describe, expect, it } from 'vitest';
import { REST_DAY_CHOICES, restDayBody, restDayChoiceOf, restDayLabel } from './restDay';

/*
 * ONE VOCABULARY FOR THE REST DAY across the five screens that ask for it:
 * a weekday, "varies week to week", or "rotating — follows the roster".
 */
describe('the rest day as a choice', () => {
  it('offers the seven weekdays, then the two answers with no fixed day', () => {
    expect(REST_DAY_CHOICES.map((choice) => choice.label)).toEqual([
      'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
      'Varies week to week',
      'Rotating — follows the roster',
    ]);
  });

  it('reads a standing back as the choice that produced it', () => {
    expect(restDayChoiceOf({ restDayOfWeek: 5, restDayVaries: false })).toBe(5);
    expect(restDayChoiceOf({ restDayOfWeek: null, restDayVaries: true })).toBe('VARIES');
    expect(restDayChoiceOf({ restDayOfWeek: null, restDayVaries: true, restDayFollowsRoster: true })).toBe('ROSTER');
    expect(restDayChoiceOf({ restDayOfWeek: null, restDayVaries: false })).toBeUndefined();
    expect(restDayChoiceOf(null)).toBeUndefined();
  });

  it('sends all three columns, so changing the answer clears the old one', () => {
    expect(restDayBody('ROSTER')).toEqual({ restDayOfWeek: null, restDayVaries: true, restDayFollowsRoster: true });
    expect(restDayBody('VARIES')).toEqual({ restDayOfWeek: null, restDayVaries: true, restDayFollowsRoster: false });
    expect(restDayBody(0)).toEqual({ restDayOfWeek: 0, restDayVaries: false, restDayFollowsRoster: false });
  });

  it('says it in words', () => {
    expect(restDayLabel({ restDayOfWeek: null, restDayVaries: true, restDayFollowsRoster: true })).toBe('Rotating — follows the roster');
    expect(restDayLabel({ restDayOfWeek: 0 })).toBe('Sunday');
    expect(restDayLabel({ restDayOfWeek: null })).toBeNull();
  });
});
