/**
 * THE PATIENT BOOKING PAGE'S PURE DECISIONS.
 *
 * Two things the public flow works out for itself, pulled out of the
 * components so they can be tested without a browser: how a provider's name
 * becomes a monogram, and which weeks of a month are worth drawing.
 *
 * Neither touches availability. Every time, every day colour and every rule
 * about what may be booked still comes from the one canonical engine through
 * the public endpoints — this module only decides what to PAINT.
 */

/**
 * A MONOGRAM OF SIX DOCTORS THAT ALL READ "D" IS NOT AN IDENTITY.
 *
 * `initialsOf` takes the first letter of the first two words, which is right
 * for a patient and wrong for "Dr. Chong Wei Ling" — every provider in a
 * Malaysian clinic list comes back as D-something, and the avatar stops
 * telling two doctors apart, which is the only job it has.
 *
 * This strips the title at the call site rather than inside the shared
 * `PersonAvatar`: the same improvement would apply to the clinic calendar's
 * provider avatars, and the calendar is frozen by owner acceptance. The
 * moment that freeze lifts, this belongs in `initialsOf` itself — one line,
 * for every surface at once.
 *
 * Only LEADING honorifics go, and only while something still follows: a
 * provider recorded as just "Dr" keeps what little there is, and a surname
 * that happens to be "Ms" mid-name is nobody's title.
 */
const HONORIFICS =
  /^(dr|doctor|prof|professor|mr|mrs|ms|mdm|madam|datuk|dato|datin|puan|encik|cik)\.?$/i;

export function personName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  let index = 0;
  while (index < words.length - 1 && HONORIFICS.test(words[index])) index += 1;
  return words.slice(index).join(' ') || fullName.trim();
}

export interface MonthCell {
  key: string;
  /** ISO date, or null for the blank cells that align the first weekday. */
  date: string | null;
}

export interface MonthComposition {
  weeks: MonthCell[][];
  /** How many real dates the collapsed leading weeks held. */
  hiddenDays: number;
}

/**
 * WEEKS THAT HAVE ALREADY HAPPENED ARE NOT A DATE PICKER.
 *
 * Opening the month on the 23rd used to hand a patient three full rows of
 * dead grey before the first day they could actually tap — on a 390px phone
 * that is most of the fold spent on days nobody can book. So leading weeks in
 * which EVERY real date is already past are dropped.
 *
 * Only leading ones, and only wholly-past ones: the week containing today
 * always survives (part of it is bookable, and seeing today anchors the
 * patient in the month), the grid keeps its seven aligned columns, and the
 * header still names the month — so this is the same calendar with the
 * unusable rows removed, not a different control. A date the caller has
 * singled out (the chosen day, or the appointment being rescheduled) pins its
 * week open regardless, and the last week is never collapsed, so the grid can
 * never come back empty.
 */
export function composeMonth(options: {
  /** 'YYYY-MM'. */
  month: string;
  /** The first weekday offset, i.e. dayjs(`${month}-01`).day(). */
  padding: number;
  daysInMonth: number;
  /** 'YYYY-MM-DD'. */
  today: string;
  selectedDate?: string | null;
  markedDate?: string | null;
}): MonthComposition {
  const { month, padding, daysInMonth, today, selectedDate, markedDate } = options;
  const cells: MonthCell[] = [
    ...Array.from({ length: padding }, (_, index) => ({ key: `pad-${index}`, date: null })),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, '0')}`;
      return { key: date, date };
    }),
  ];

  const weeks: MonthCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));

  const pinned = new Set([selectedDate, markedDate].filter(Boolean) as string[]);
  let first = 0;
  while (
    first < weeks.length - 1 &&
    weeks[first].every((cell) => cell.date === null || (cell.date < today && !pinned.has(cell.date)))
  ) {
    first += 1;
  }

  return {
    weeks: weeks.slice(first),
    hiddenDays: weeks
      .slice(0, first)
      .reduce((count, week) => count + week.filter((cell) => cell.date).length, 0),
  };
}
