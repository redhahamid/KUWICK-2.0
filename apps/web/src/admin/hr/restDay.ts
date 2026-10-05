/**
 * THE REST DAY, ONE ANSWER IN THREE COLUMNS.
 *
 * A standing names a weekday (0 = Sunday … 6 = Saturday), or says the rest day
 * varies week to week, or says it rotates with the roster. The last two are
 * the same to payroll — no weekday is the rest day, and rest-day pay is keyed
 * by hand — and differ only in where the day comes from. Every screen that
 * asks for a rest day takes its options and its body from here, so five
 * pickers cannot disagree about which day 0 is or what "rotating" sends.
 */

/** The rest day is stored as 0–6. One list of names, so screens cannot disagree about which day 0 is. */
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type RestDayChoice = number | 'VARIES' | 'ROSTER';

export const REST_DAY_VARIES_LABEL = 'Varies week to week';
export const REST_DAY_ROSTER_LABEL = 'Rotating — follows the roster';

/** The picker's options: the seven weekdays, then the two answers with no fixed day. */
export const REST_DAY_CHOICES: { value: RestDayChoice; label: string }[] = [
  ...DAY_NAMES.map((name, index) => ({ value: index as RestDayChoice, label: name })),
  { value: 'VARIES', label: REST_DAY_VARIES_LABEL },
  { value: 'ROSTER', label: REST_DAY_ROSTER_LABEL },
];

type RestDayFields = { restDayOfWeek: number | null; restDayVaries?: boolean; restDayFollowsRoster?: boolean };

/** What a standing says, as a picker value. Undefined when it names nothing. */
export function restDayChoiceOf(row: RestDayFields | null | undefined): RestDayChoice | undefined {
  if (!row) return undefined;
  if (row.restDayFollowsRoster) return 'ROSTER';
  if (row.restDayVaries) return 'VARIES';
  return row.restDayOfWeek ?? undefined;
}

/** What a standing says, in words. Null when it names nothing. */
export function restDayLabel(row: RestDayFields | null | undefined): string | null {
  const choice = restDayChoiceOf(row);
  if (choice === undefined) return null;
  if (choice === 'ROSTER') return REST_DAY_ROSTER_LABEL;
  if (choice === 'VARIES') return REST_DAY_VARIES_LABEL;
  return DAY_NAMES[choice] ?? null;
}

/** The three columns a choice is sent as. Always all three, so a change of answer clears the old one. */
export function restDayBody(choice: RestDayChoice): { restDayOfWeek: number | null; restDayVaries: boolean; restDayFollowsRoster: boolean } {
  if (choice === 'ROSTER') return { restDayOfWeek: null, restDayVaries: true, restDayFollowsRoster: true };
  if (choice === 'VARIES') return { restDayOfWeek: null, restDayVaries: true, restDayFollowsRoster: false };
  return { restDayOfWeek: choice, restDayVaries: false, restDayFollowsRoster: false };
}

/** Said under the picker when the choice has no fixed day: what payroll does with it. */
export const NO_FIXED_DAY_HELP =
  'Payroll does not read the roster’s off days: with no fixed day, a rest day worked is priced as a normal day, the run says so each month, and rest-day pay is keyed by hand where it is due.';
