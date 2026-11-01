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
  /** What employee numbers start with: E gives E001, E002… (new-clinic UAT #2, item 70). */
  employeeNoPrefix: string;
}

export const NEW_STAFF_DEFAULTS_SETTING = 'hr.newStaffDefaults';
export const KUWICK_NEW_STAFF_DEFAULTS: NewStaffDefaults = {
  workDaysPerWeek: 6,
  probationMonths: 3,
  departments: ['Clinical', 'Pharmacy', 'Front desk', 'Admin'],
  employeeNoPrefix: 'E',
};

export function useNewStaffDefaults(): NewStaffDefaults {
  const saved = useGlobalSetting<Partial<NewStaffDefaults>>(NEW_STAFF_DEFAULTS_SETTING).data ?? {};
  return { ...KUWICK_NEW_STAFF_DEFAULTS, ...saved };
}

export function useSetNewStaffDefaults() {
  return useSetGlobalSetting<NewStaffDefaults>(NEW_STAFF_DEFAULTS_SETTING);
}
