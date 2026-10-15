/**
 * MALAYSIAN PUBLIC HOLIDAYS TO START A CLINIC'S CALENDAR WITH (new-clinic
 * UAT, 15 October 2026: "Public holidays 2026 = 0 days. Preload federal and
 * state holidays by the clinic's state.").
 *
 * A starting list, never the law: the clinic sees every date before anything
 * is saved, unticks what it does not observe, and edits the calendar after.
 * Compiled from published 2026 calendars, which agree on most dates; those
 * marked `check` differ between sources (moon-sighted Islamic dates, some
 * state days) and should be checked against the Jabatan Perdana Menteri
 * list or the state gazette. Replacement days (cuti ganti) are not listed:
 * they are announced case by case, so the clinic adds them by hand.
 *
 * A new year is a new block below, added when the government publishes it.
 */

export const MALAYSIAN_STATES = [
  'Johor',
  'Kedah',
  'Kelantan',
  'Melaka',
  'Negeri Sembilan',
  'Pahang',
  'Perak',
  'Perlis',
  'Pulau Pinang',
  'Sabah',
  'Sarawak',
  'Selangor',
  'Terengganu',
  'W.P. Kuala Lumpur',
  'W.P. Labuan',
  'W.P. Putrajaya',
] as const;
export type MalaysianState = (typeof MALAYSIAN_STATES)[number];

type Preset = {
  date: string;
  name: string;
  /** 'ALL', the states that observe it, or every state except some. */
  states: 'ALL' | MalaysianState[] | { except: MalaysianState[] };
  /** Sources disagree on this date: say so beside it. */
  check?: boolean;
};

const PRESETS: Record<number, Preset[]> = {
  2026: [
    { date: '2026-01-01', name: 'New Year’s Day', states: { except: ['Johor', 'Kedah', 'Kelantan', 'Perlis', 'Terengganu'] } },
    { date: '2026-01-14', name: 'Birthday of the Yang di-Pertuan Besar of Negeri Sembilan', states: ['Negeri Sembilan'] },
    { date: '2026-01-16', name: 'Israk and Mikraj', states: ['Kedah', 'Negeri Sembilan', 'Perlis', 'Terengganu'], check: true },
    {
      date: '2026-02-01',
      name: 'Thaipusam',
      states: ['Johor', 'Kedah', 'Negeri Sembilan', 'Perak', 'Pulau Pinang', 'Selangor', 'W.P. Kuala Lumpur', 'W.P. Putrajaya'],
    },
    { date: '2026-02-01', name: 'Federal Territory Day', states: ['W.P. Kuala Lumpur', 'W.P. Labuan', 'W.P. Putrajaya'] },
    { date: '2026-02-17', name: 'Chinese New Year', states: 'ALL' },
    { date: '2026-02-18', name: 'Chinese New Year (second day)', states: { except: ['Kelantan', 'Terengganu'] } },
    { date: '2026-02-19', name: 'Awal Ramadan', states: ['Johor', 'Kedah', 'Melaka'], check: true },
    { date: '2026-03-04', name: 'Anniversary of the Installation of the Sultan of Terengganu', states: ['Terengganu'] },
    {
      date: '2026-03-07',
      name: 'Nuzul Al-Quran',
      states: ['Kelantan', 'Pahang', 'Perak', 'Perlis', 'Pulau Pinang', 'Selangor', 'Terengganu', 'W.P. Kuala Lumpur', 'W.P. Labuan', 'W.P. Putrajaya'],
      check: true,
    },
    { date: '2026-03-21', name: 'Hari Raya Aidilfitri', states: 'ALL', check: true },
    { date: '2026-03-22', name: 'Hari Raya Aidilfitri (second day)', states: 'ALL', check: true },
    { date: '2026-03-23', name: 'Birthday of the Sultan of Johor', states: ['Johor'] },
    { date: '2026-04-03', name: 'Good Friday', states: ['Sabah', 'Sarawak'] },
    { date: '2026-04-26', name: 'Birthday of the Sultan of Terengganu', states: ['Terengganu'] },
    { date: '2026-05-01', name: 'Labour Day', states: 'ALL' },
    { date: '2026-05-17', name: 'Birthday of the Raja of Perlis', states: ['Perlis'] },
    { date: '2026-05-22', name: 'Hari Hol of Pahang', states: ['Pahang'], check: true },
    { date: '2026-05-26', name: 'Hari Arafah', states: ['Kelantan', 'Terengganu'], check: true },
    { date: '2026-05-27', name: 'Hari Raya Haji', states: 'ALL', check: true },
    { date: '2026-05-28', name: 'Hari Raya Haji (second day)', states: ['Kedah', 'Kelantan', 'Perlis', 'Terengganu'], check: true },
    { date: '2026-05-30', name: 'Pesta Kaamatan', states: ['Sabah'] },
    { date: '2026-05-31', name: 'Wesak Day', states: 'ALL' },
    { date: '2026-05-31', name: 'Pesta Kaamatan (second day)', states: ['Sabah'] },
    { date: '2026-06-01', name: 'Birthday of the Yang di-Pertuan Agong', states: 'ALL' },
    { date: '2026-06-01', name: 'Hari Gawai', states: ['Sarawak'] },
    { date: '2026-06-02', name: 'Hari Gawai (second day)', states: ['Sarawak'] },
    { date: '2026-06-17', name: 'Awal Muharram', states: 'ALL', check: true },
    { date: '2026-06-21', name: 'Birthday of the Sultan of Kedah', states: ['Kedah'] },
    { date: '2026-07-11', name: 'Birthday of the Governor of Pulau Pinang', states: ['Pulau Pinang'] },
    { date: '2026-07-21', name: 'Hari Hol of Almarhum Sultan Iskandar', states: ['Johor'], check: true },
    { date: '2026-07-22', name: 'Sarawak Day', states: ['Sarawak'] },
    { date: '2026-07-31', name: 'Birthday of the Sultan of Pahang', states: ['Pahang'], check: true },
    { date: '2026-08-24', name: 'Birthday of the Governor of Melaka', states: ['Melaka'] },
    { date: '2026-08-26', name: 'Maulidur Rasul', states: 'ALL', check: true },
    { date: '2026-08-31', name: 'National Day', states: 'ALL' },
    { date: '2026-09-16', name: 'Malaysia Day', states: 'ALL' },
    { date: '2026-09-29', name: 'Birthday of the Sultan of Kelantan', states: ['Kelantan'] },
    { date: '2026-09-30', name: 'Birthday of the Sultan of Kelantan (second day)', states: ['Kelantan'] },
    { date: '2026-10-10', name: 'Birthday of the Governor of Sarawak', states: ['Sarawak'], check: true },
    { date: '2026-11-06', name: 'Birthday of the Sultan of Perak', states: ['Perak'], check: true },
    { date: '2026-11-08', name: 'Deepavali', states: { except: ['Sarawak', 'W.P. Labuan'] }, check: true },
    { date: '2026-12-11', name: 'Birthday of the Sultan of Selangor', states: ['Selangor'] },
    { date: '2026-12-25', name: 'Christmas Day', states: 'ALL' },
  ],
};

export function isMalaysianState(value: string): value is MalaysianState {
  return (MALAYSIAN_STATES as readonly string[]).includes(value);
}

const observedIn = (preset: Preset, state: MalaysianState) =>
  preset.states === 'ALL'
    ? true
    : Array.isArray(preset.states)
      ? preset.states.includes(state)
      : !preset.states.except.includes(state);

/**
 * The year's holidays for one state, one row per date: two holidays on the
 * same day (Thaipusam and Federal Territory Day) are one day off, named once.
 */
export function holidayPresets(year: number, state: MalaysianState) {
  const byDate = new Map<string, { date: string; name: string; check: boolean }>();
  for (const preset of PRESETS[year] ?? []) {
    if (!observedIn(preset, state)) continue;
    const seen = byDate.get(preset.date);
    byDate.set(preset.date, seen ? { ...seen, name: `${seen.name} / ${preset.name}`, check: seen.check || Boolean(preset.check) } : { date: preset.date, name: preset.name, check: Boolean(preset.check) });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export const HOLIDAY_PRESET_YEARS = Object.keys(PRESETS).map(Number);
