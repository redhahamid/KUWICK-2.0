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

/** The Approve step's warning about membership numbers the filings need. Never a block. */
export function filingNumbersCheck(rows: { name: string; missing: string[] }[] | undefined): { ok: boolean; detail: string } {
  const list = rows ?? [];
  if (list.length === 0) return { ok: true, detail: 'Everyone’s numbers are on file.' };
  return {
    ok: false,
    detail: `${list.map((row) => `${row.name}: no ${row.missing.join(' or ')}`).join('. ')}. The EPF and PCB filings will be missing their number.`,
  };
}
