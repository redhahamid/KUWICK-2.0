import { STANDING_LABELS } from './StatutoryStandingManager';

/**
 * SMALL WORDINGS FOR THE EMPLOYEE RECORD AND THE APPROVE STEP (new-clinic
 * UAT #2, items 71, 72 and 77), kept apart so each is tested on its own.
 */

/** "No login" when the person was added without one; otherwise whether the account is on. */
export function accountLabel(identity: { hasLogin?: boolean; accountActive: boolean }): string {
  if (identity.hasLogin === false) return 'No login';
  return identity.accountActive ? 'Active' : 'Inactive';
}

/** The MTD category in force, in the words the form below uses; the old free-text field only as a fallback. */
export function taxCategoryLabel(statutory: { pcbCategory?: string | null; taxCategory?: string | null }): string | null {
  if (statutory.pcbCategory) return STANDING_LABELS[statutory.pcbCategory] ?? statutory.pcbCategory;
  return statutory.taxCategory ?? null;
}

/** The Approve step's warning about membership numbers the filings need, from the run's own warnings. Never a block. */
export function filingNumbersCheck(warnings: { name: string | null; what: string }[]): { ok: boolean; detail: string } {
  if (warnings.length === 0) return { ok: true, detail: 'Everyone’s numbers are on file.' };
  return {
    ok: false,
    detail: `${warnings.map((row) => [row.name, row.what].filter(Boolean).join(': ')).join(' ')} The EPF and PCB filings will be missing their number.`,
  };
}

/** "8 days a year · 1.5 this year · Standard leave", the same figure the Leave page shows. */
export function annualLeaveLabel(annual: { fullYear: number; thisYear: number; policyName: string | null } | null | undefined, policyName: string | null): string | null {
  if (!annual) return policyName ? `No annual leave · ${policyName}` : null;
  const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  const name = annual.policyName ?? policyName;
  return [`${days(annual.fullYear)} a year`, annual.thisYear !== annual.fullYear ? `${annual.thisYear} this year` : null, name].filter(Boolean).join(' · ');
}
