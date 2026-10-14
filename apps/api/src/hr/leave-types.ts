/**
 * LEAVE TYPES ARE THE CLINIC'S (Section D, 14 October 2026).
 *
 * A leave request, balance or policy stores a type CODE. The clinic names its
 * types and sets each one's rules in Settings → Leave types; the defaults
 * below are what a new clinic starts with. A type marked statutory never gives
 * less than the Employment Act's minimum for the person's years of service.
 */

/** The codes Kuwick has always used, still valid on every existing row. */
export const LeaveType = {
  ANNUAL: 'ANNUAL',
  MEDICAL: 'MEDICAL',
  EMERGENCY: 'EMERGENCY',
  UNPAID: 'UNPAID',
  OTHER: 'OTHER',
} as const;
export type LeaveType = string;

/** A type code: capitals, digits and underscores, e.g. ANNUAL or STUDY_LEAVE. */
export const LEAVE_CODE = /^[A-Z][A-Z0-9_]{1,29}$/;

export type StatutoryLeave = 'ANNUAL' | 'SICK' | 'HOSPITALISATION' | 'MATERNITY' | 'PATERNITY';
export const STATUTORY_LEAVE: StatutoryLeave[] = ['ANNUAL', 'SICK', 'HOSPITALISATION', 'MATERNITY', 'PATERNITY'];

/**
 * The Act's minimum days a year by completed years of service: ss.60E(1)
 * (annual), 60F(1) (sick, and hospitalisation), 37(1) (maternity) and 60FA
 * (paternity). Each row is "from this many years, at least this many days".
 */
const FLOORS: Record<StatutoryLeave, { fromYears: number; days: number }[]> = {
  ANNUAL: [
    { fromYears: 0, days: 8 },
    { fromYears: 2, days: 12 },
    { fromYears: 5, days: 16 },
  ],
  SICK: [
    { fromYears: 0, days: 14 },
    { fromYears: 2, days: 18 },
    { fromYears: 5, days: 22 },
  ],
  HOSPITALISATION: [{ fromYears: 0, days: 60 }],
  MATERNITY: [{ fromYears: 0, days: 98 }],
  PATERNITY: [{ fromYears: 0, days: 7 }],
};

/** The Act's minimum for a statutory type, 0 for anything else. */
export function statutoryFloor(statutory: string | null | undefined, yearsOfService: number): number {
  const rows = FLOORS[statutory as StatutoryLeave];
  if (!rows) return 0;
  return rows.filter((row) => yearsOfService >= row.fromYears).reduce((most, row) => Math.max(most, row.days), 0);
}

/** Completed years of service on the first day of `year`. */
export function yearsOfServiceAt(startDate: Date | null | undefined, year: number): number {
  if (!startDate) return 0;
  const yearStart = Date.UTC(year, 0, 1);
  let years = year - startDate.getUTCFullYear();
  const anniversary = Date.UTC(year, startDate.getUTCMonth(), startDate.getUTCDate());
  if (anniversary > yearStart) years -= 1;
  return Math.max(0, years);
}

/** Sick, hospitalisation, maternity and paternity are whole entitlements, not earned through the year. */
export function proRatesOnJoin(statutory: string | null | undefined): boolean {
  return !statutory || statutory === 'ANNUAL';
}

export interface LeaveTypeDefault {
  code: string;
  name: string;
  paid: boolean;
  daysPerYear: number | null;
  documentRequired: boolean;
  statutory: StatutoryLeave | null;
}

/** What a clinic starts with. Every figure can be changed, statutory ones never below the Act. */
export const DEFAULT_LEAVE_TYPES: LeaveTypeDefault[] = [
  { code: 'ANNUAL', name: 'Annual leave', paid: true, daysPerYear: 8, documentRequired: false, statutory: 'ANNUAL' },
  { code: 'MEDICAL', name: 'Medical leave (MC)', paid: true, daysPerYear: 14, documentRequired: true, statutory: 'SICK' },
  { code: 'HOSPITALISATION', name: 'Hospitalisation leave', paid: true, daysPerYear: 60, documentRequired: true, statutory: 'HOSPITALISATION' },
  { code: 'EMERGENCY', name: 'Emergency leave', paid: true, daysPerYear: null, documentRequired: false, statutory: null },
  { code: 'COMPASSIONATE', name: 'Compassionate leave', paid: true, daysPerYear: 3, documentRequired: false, statutory: null },
  { code: 'MATERNITY', name: 'Maternity leave', paid: true, daysPerYear: 98, documentRequired: true, statutory: 'MATERNITY' },
  { code: 'PATERNITY', name: 'Paternity leave', paid: true, daysPerYear: 7, documentRequired: true, statutory: 'PATERNITY' },
  { code: 'UNPAID', name: 'Unpaid leave', paid: false, daysPerYear: null, documentRequired: false, statutory: null },
  { code: 'OTHER', name: 'Other leave', paid: true, daysPerYear: null, documentRequired: false, statutory: null },
];

/** A leave type as the balance and payroll code reads it. */
export interface LeaveKind {
  code: string;
  name: string;
  paid: boolean;
  daysPerYear: number | null;
  documentRequired: boolean;
  carryForwardCap: number | null;
  statutory: string | null;
  active: boolean;
}

/** The clinic's stored types, or the defaults when it has none yet. */
export function leaveKinds(
  rows: {
    code: string;
    name: string;
    paid: boolean;
    daysPerYear: unknown;
    documentRequired: boolean;
    carryForwardCap: unknown;
    statutory: string | null;
    active: boolean;
  }[],
): LeaveKind[] {
  if (rows.length === 0) return DEFAULT_LEAVE_TYPES.map((row) => ({ ...row, carryForwardCap: null, active: true }));
  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    paid: row.paid,
    daysPerYear: row.daysPerYear === null || row.daysPerYear === undefined ? null : Number(row.daysPerYear),
    documentRequired: row.documentRequired,
    carryForwardCap: row.carryForwardCap === null || row.carryForwardCap === undefined ? null : Number(row.carryForwardCap),
    statutory: row.statutory,
    active: row.active,
  }));
}

/** The codes of unpaid types: their days come off pay (Section D). UNPAID always is. */
export function unpaidLeaveCodes(kinds: LeaveKind[]): Set<string> {
  return new Set([LeaveType.UNPAID, ...kinds.filter((kind) => !kind.paid).map((kind) => kind.code)]);
}
