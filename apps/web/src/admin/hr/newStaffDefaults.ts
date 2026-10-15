import { useGlobalSetting, useSetGlobalSetting } from '../../core/hooks/useGlobalSetting';

/**
 * WHAT A NEW EMPLOYEE STARTS FROM (new-clinic UAT, 15 October 2026): each a
 * clinic setting with a sensible default, edited on Pay rules, never a number
 * built into the form.
 */
export interface NewStaffDefaults {
  /** The usual working week, filled in on Add employee. */
  workDaysPerWeek: number;
  /** "Probation until" is filled in this many months after the start date; 0 leaves it blank. */
  probationMonths: number;
  /** The department list Add employee picks from. */
  departments: string[];
}

export const NEW_STAFF_DEFAULTS_SETTING = 'hr.newStaffDefaults';
export const KUWICK_NEW_STAFF_DEFAULTS: NewStaffDefaults = {
  workDaysPerWeek: 6,
  probationMonths: 3,
  departments: ['Clinical', 'Pharmacy', 'Front desk', 'Admin'],
};

export function useNewStaffDefaults(): NewStaffDefaults {
  const saved = useGlobalSetting<Partial<NewStaffDefaults>>(NEW_STAFF_DEFAULTS_SETTING).data ?? {};
  return { ...KUWICK_NEW_STAFF_DEFAULTS, ...saved };
}

export function useSetNewStaffDefaults() {
  return useSetGlobalSetting<NewStaffDefaults>(NEW_STAFF_DEFAULTS_SETTING);
}

/**
 * THE STATE A MALAYSIAN POSTCODE BELONGS TO, by its first digits (Pos
 * Malaysia's ranges), editable after. A few border areas differ; the town needs Pos Malaysia's full list, which Kuwick
 * does not carry yet, so only the state is filled.
 */
export function stateOfPostcode(postcode: string | null | undefined): string | null {
  const code = (postcode ?? '').trim();
  if (!/^\d{5}$/.test(code)) return null;
  const n = Number(code.slice(0, 2));
  if (n === 1 || n === 2) return 'Perlis';
  if (n >= 5 && n <= 9) return 'Kedah';
  if (n >= 10 && n <= 14) return 'Pulau Pinang';
  if (n >= 15 && n <= 18) return 'Kelantan';
  if (n >= 20 && n <= 24) return 'Terengganu';
  if ((n >= 25 && n <= 28) || n === 39 || n === 49 || n === 69) return 'Pahang';
  if (n >= 30 && n <= 36) return 'Perak';
  if (n >= 40 && n <= 48) return 'Selangor';
  if (n >= 50 && n <= 60) return 'W.P. Kuala Lumpur';
  if (n === 62) return 'W.P. Putrajaya';
  if (n >= 63 && n <= 68) return 'Selangor';
  if (n >= 70 && n <= 73) return 'Negeri Sembilan';
  if (n >= 75 && n <= 78) return 'Melaka';
  if (n >= 79 && n <= 86) return 'Johor';
  if (n === 87) return 'W.P. Labuan';
  if (n >= 88 && n <= 91) return 'Sabah';
  if (n >= 93 && n <= 98) return 'Sarawak';
  return null;
}
