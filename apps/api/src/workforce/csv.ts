/**
 * CSV THAT EXCEL OPENS AS WRITTEN (UAT, 6 October 2026).
 *
 * Two things went wrong when a listing was opened in Excel:
 *   - "—" read as "â€”": with no byte-order mark Excel guesses the file is in
 *     the Windows code page, not UTF-8. `CSV_BOM` at the start says UTF-8.
 *   - an IC, a membership, tax or account number read as 9.63E+12, or lost
 *     its leading zero: Excel takes a long run of digits for a number.
 *     `csvTextCell` writes it as ="…", which Excel keeps as text and every
 *     CSV reader still sees as one quoted cell.
 */
export const CSV_BOM = '\uFEFF';

/** One cell: quoted when it holds a comma, a quote or a line break. */
export function csvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A number that must stay text in Excel: an IC, a membership, tax or account number. Blank stays blank. */
export function csvTextCell(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === '') return '';
  return csvCell(`="${value.replace(/"/g, '""')}"`);
}
