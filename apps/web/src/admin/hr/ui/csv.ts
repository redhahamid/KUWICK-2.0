/**
 * CSV FROM THE ROWS THE SCREEN HAS, quoted by the RFC 4180 rule: a name with
 * a comma or an apostrophe is not an edge case in a clinic.
 *
 * Exports what the filter produced — the person exporting a list wants the
 * list they are looking at, not the whole tenant.
 */
export function downloadCsv(name: string, header: string[], rows: (string | number | null | undefined)[][]): void {
  const quote = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [header, ...rows].map((line) => line.map(quote).join(',')).join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
