/**
 * ONE ORDER FOR EVERY LIST OF EMPLOYEES IN A PAYROLL MONTH.
 *
 * The grid, an employee's previous and next, the payslip list, the bank
 * listing (on screen and as CSV) and the payment and register reports each
 * had their own: the payslips came out in internal-id order, the bank listing
 * put the excluded at the end, the database sorted the grid by its own
 * collation. Reported from UAT: "the bank listing order differs from the
 * payslip order". Every one of them now sorts with this: the name A to Z,
 * ignoring case and accents and reading numbers as numbers, then the staff id
 * so two people with one name never swap places between two screens.
 */
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export interface Named {
  name: string;
  staffId: string;
}

export function compareByEmployeeName(a: Named, b: Named): number {
  return collator.compare(a.name, b.name) || (a.staffId < b.staffId ? -1 : a.staffId > b.staffId ? 1 : 0);
}

/** The comparator for rows that hold the name and id under other keys. */
export function byEmployeeName<T>(pick: (row: T) => Named): (a: T, b: T) => number {
  return (a, b) => compareByEmployeeName(pick(a), pick(b));
}
