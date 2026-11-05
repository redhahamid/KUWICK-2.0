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

type NumberWarning = { name: string | null; what: string };
/**
 * The Approve step's line about membership numbers the filings need, from the
 * run's own warnings. Never a block. A missing number somebody acknowledged is
 * still missing: it says "acknowledged", never "on file" (Payroll A–Z guide,
 * issue 5).
 */
export function filingNumbersCheck(warnings: NumberWarning[], acknowledged: NumberWarning[] = []): { ok: boolean; detail: string } {
  const who = (rows: NumberWarning[]) => rows.map((row) => [row.name, row.what].filter(Boolean).join(': ')).join(' ');
  if (warnings.length === 0 && acknowledged.length > 0) {
    return { ok: true, detail: `Missing, acknowledged: ${who(acknowledged)} The EPF and PCB filings will be missing their number.` };
  }
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

/**
 * APPROVING A MONTH THAT HAS NOT ENDED (Payroll A–Z guide, issue 8): a
 * warning, never a block. A clinic may pay before the month ends; what it
 * should know is that attendance, leave and claims for the rest of the month
 * are not in these figures. `today` is the clinic's date, YYYY-MM-DD.
 */
export function monthNotEndedCheck(period: string, today: string): { ok: boolean; detail: string } {
  const [year, month] = period.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDay = `${period}-${String(last).padStart(2, '0')}`;
  if (today > lastDay) return { ok: true, detail: 'The month is over.' };
  const left = Math.round((Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) + 1;
  return {
    ok: false,
    detail: `${left} ${left === 1 ? 'day' : 'days'} of this month ${left === 1 ? 'is' : 'are'} still to come, today included. Attendance, leave and claims from those days are not in these figures; a change after approval is a recorded adjustment.`,
  };
}

