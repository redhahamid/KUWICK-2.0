import type { ReactNode } from 'react';
import dayjs from 'dayjs';

/**
 * SHARED BITS OF THE PORTAL — money, months, a greeting, an empty state, and
 * the two glyphs the kit does not carry. The pages are otherwise the kit.
 */

/** `RM 9,979.14` — the mockup's spacing and thousands. */
export function rm(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `2026-08` → `August 2026`. */
export function monthLabel(period: string): string {
  return dayjs(`${period.slice(0, 7)}-01`).format('MMMM YYYY');
}

/** `2026-08` → `Aug`. */
export function monthShort(period: string): string {
  return dayjs(`${period.slice(0, 7)}-01`).format('MMM');
}

/** `2026-09-21` → `21 Sep`; a range collapses to `21–23 Sep` when the month matches. */
export function dayRange(start: string, end: string): string {
  const a = dayjs(start);
  const b = dayjs(end);
  if (a.isSame(b, 'day')) return a.format('D MMM');
  if (a.isSame(b, 'month')) return `${a.format('D')}–${b.format('D MMM')}`;
  return `${a.format('D MMM')} to ${b.format('D MMM')}`;
}

/**
 * "Hi, Dr Meera" — the title and the first name. A title is kept because
 * dropping it turns a doctor into a first-name acquaintance on their own
 * payslip portal; everybody else is greeted by their first name.
 */
export function greetingName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'there';
  const TITLES = ['dr', 'dr.', 'mr', 'ms', 'mrs', 'puan', 'encik', 'cik', 'tuan'];
  if (TITLES.includes(parts[0].toLowerCase()) && parts[1]) return `${parts[0]} ${parts[1]}`;
  return parts[0];
}

export function PortalEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="hr-portal__empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

export const IconCheckCircle = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12l3 3 5-6" />
  </svg>
);

export const IconCard = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M7 12h.01M17 12h.01" />
  </svg>
);
