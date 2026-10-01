/**
 * THE REGISTER'S COLUMNS AND BUCKETS, ONE RULE.
 *
 * Three readers ask the same question — "where on the payroll grid does this
 * line count?": the inputs drawer (its group headings and subtotals), the
 * month journey (the cells and the totals under them) and the run itself,
 * which is the arithmetic the other two describe. The answer lives here so
 * the drawer's "Counted in Other income" subtotal and the grid's Other income
 * cell cannot disagree.
 *
 * AN ITEM CAN HAVE A COLUMN OF ITS OWN. `PayComponent.gridColumn` is layout,
 * not treatment: a clinic that keys a director's fee, locum sessions and an
 * incentive for most people every month wants a column each, the way its
 * spreadsheet had them, and everything else folded into Other income. Only an
 * addition keyed by hand may have one — the derived codes and overtime have
 * columns already — and `pay-component.service.ts` refuses the rest.
 */

/**
 * Codes the run derives or that already have a column: none of them may be
 * given a grid column or carried forward, because their amount is not
 * something a person keys.
 */
export const DERIVED_CODES = new Set(['BASIC', 'OVERTIME', 'UNPAID_LEAVE', 'CLAIM_REIMBURSEMENT', 'LEAVE_PAYOUT', 'PCB']);

/** Who an item is for: everybody, or the employees named on it. Absent means everybody. */
export type ItemAudience = { appliesTo: string; appliesToStaffIds: string[] };

export type RegisterItem = {
  code: string;
  name: string;
  type: string;
  includeIn: string;
  gridColumn: boolean;
  carryForward: boolean;
  active: boolean;
} & Partial<ItemAudience>;

export type RegisterColumn = { code: string; name: string; carryForward: boolean; appliesTo: 'EVERYONE' | 'SELECTED' };

/**
 * WHETHER AN ITEM IS FOR THIS PERSON. An item is for everybody unless it
 * names its people, in which case it is for them alone: no column cell, no
 * drawer option, no keyed line and no carried line for anybody else. One
 * answer here, so the grid, the drawer, the save route and the month start
 * cannot disagree about who a director's fee is for.
 */
export function itemAppliesTo(item: Partial<ItemAudience> | undefined, staffId: string | undefined): boolean {
  if (!item || item.appliesTo !== 'SELECTED' || !staffId) return true;
  return (item.appliesToStaffIds ?? []).includes(staffId);
}

export type RegisterBucket = 'OTHER_INCOME' | 'OWN_COLUMN' | 'DEDUCTION' | 'UNKNOWN';

/** The rows keyed by code; the first row for a code wins, so pass them in the order that matters. */
export function itemsByCode<T extends { code: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) if (!map.has(row.code)) map.set(row.code, row);
  return map;
}

/**
 * The items with a column of their own, in the order given — the caller
 * queries them the way the Payroll items screen lists them, category then
 * code. A retired item keeps no column: its lines, if any, fall back into
 * Other income, which is also where the journey counts their money.
 */
export function columnItems(rows: RegisterItem[]): RegisterColumn[] {
  return rows
    .filter((row) => row.gridColumn && row.active && row.type === 'ADDITION' && !DERIVED_CODES.has(row.code))
    .map((row) => ({ code: row.code, name: row.name, carryForward: row.carryForward, appliesTo: row.appliesTo === 'SELECTED' ? 'SELECTED' : 'EVERYONE' }));
}

/**
 * WHERE ON THE REGISTER A ROW IS COUNTED.
 *
 * The grid's "Other income" cell is everything that reached gross except
 * basic pay, overtime, reimbursed claims and the items with a column of their
 * own; its "Other" deductions cell is every withholding line; unpaid leave
 * reduces gross and PCB is a supplied amount with a column of its own. This
 * mirrors `kindOf` in `component-liability.ts` and the column sums in the
 * journey, so a line the drawer shows under "Counted in Other income" is a
 * line the cell counts.
 */
export function placeOnRegister(
  row: { componentCode: string; source: string; staffId?: string },
  item: (Pick<RegisterItem, 'code' | 'name' | 'type' | 'includeIn' | 'gridColumn' | 'active'> & Partial<ItemAudience>) | undefined,
): { bucket: RegisterBucket; column: string } {
  if (row.componentCode === 'PCB') return { bucket: 'OWN_COLUMN', column: 'PCB' };
  if (!item) return { bucket: 'UNKNOWN', column: 'Not paid' };
  if (item.type === 'OVERTIME' || row.componentCode === 'OVERTIME') return { bucket: 'OWN_COLUMN', column: 'OT h' };
  if (row.source === 'CLAIM' || row.componentCode === 'CLAIM_REIMBURSEMENT') return { bucket: 'OWN_COLUMN', column: 'Claims' };
  if (item.type === 'DEDUCTION') {
    // `kindOf`: a deduction that reaches gross makes the wages smaller.
    if (item.includeIn === 'NET_ONLY') return { bucket: 'DEDUCTION', column: 'Other' };
    return { bucket: 'OWN_COLUMN', column: row.componentCode === 'UNPAID_LEAVE' ? 'Unpaid d' : 'Gross' };
  }
  // A column the item keeps for its own people: somebody else's line for it
  // (keyed before the list was set, say) is still paid, in Other income.
  if (columnItems([{ ...item, carryForward: false }]).length > 0 && itemAppliesTo(item, row.staffId)) {
    return { bucket: 'OWN_COLUMN', column: item.name };
  }
  return { bucket: 'OTHER_INCOME', column: 'Other income' };
}

type InputRowForOrigin = {
  source: string;
  sourceRecordId: string | null;
  staffId: string;
  carriedFromId: string | null;
  createdBy: { fullName: string };
};

/** The sentence for where a row came from, and the screen that corrects it. */
export function originOf(row: InputRowForOrigin, month: string): { origin: string; sourceLink: string | null } {
  switch (row.source) {
    case 'ATTENDANCE':
      return { origin: 'From attendance: overtime approved on the timesheet', sourceLink: `/admin/hr/attendance?staffId=${row.staffId}&month=${month}` };
    case 'LEAVE':
      return { origin: 'From leave: unpaid leave approved on the leave queue', sourceLink: `/admin/hr/leave?staffId=${row.staffId}` };
    case 'CLAIM':
      return { origin: 'From an approved claim routed to payroll', sourceLink: row.sourceRecordId ? `/admin/hr/claims?claimId=${row.sourceRecordId}` : '/admin/hr/claims' };
    case 'INCENTIVE':
      return { origin: 'From the incentive run for this month', sourceLink: '/admin/hr/incentives' };
    case 'RECURRING':
      return { origin: 'Recurring item on the employee record', sourceLink: `/admin/hr/employees/${row.staffId}?tab=employment` };
    case 'IMPORT':
      return { origin: 'Imported', sourceLink: null };
    default:
      // A copied line says so until somebody edits or clears it; then it is
      // that person's figure like any other.
      if (row.carriedFromId) {
        return { origin: `Carried from ${monthLabel(monthBefore(new Date(`${month}-01T00:00:00.000Z`)))} when the month was started`, sourceLink: null };
      }
      return { origin: `Entered by ${row.createdBy.fullName}`, sourceLink: null };
  }
}

export function monthStartOf(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function monthBefore(period: Date): Date {
  return new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() - 1, 1));
}

/** "January 2026", the way the run names a month in its exceptions. */
export function monthLabel(period: Date): string {
  return period.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The reason on a carried line: "Carried from January 2026", keeping whatever
 * the person wrote on the original after a colon, and not stacking month on
 * month when a line is carried again.
 */
export function carriedReason(from: string, previousReason: string | null): string {
  const kept = (previousReason ?? '').replace(/^Carried from [A-Za-z]+ \d{4}(?:: )?/, '').trim();
  return kept ? `Carried from ${from}: ${kept}` : `Carried from ${from}`;
}
