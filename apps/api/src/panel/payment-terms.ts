/**
 * PANEL PAYMENT TERMS — the shapes real panels actually use.
 *
 * Pure functions over plain inputs: no Prisma, no clock, no tenant. The same
 * discipline as `finance/financial-invariants.ts`, and for the same reason —
 * a due date computed in two places is a due date that will eventually
 * disagree with itself.
 *
 * WHY THIS MODULE EXISTS. The clinic's panel workbook states its payment terms
 * as free text, and reading all 29 of them found five incompatible shapes
 * (`docs/PANEL_LEGACY_WORKFLOW_AUDIT.md` §3):
 *
 *   - a single number of calendar days                    ("60 DAYS")
 *   - a RANGE                                             ("60 - 90 DAYS")
 *   - WORKING days                                        ("30 WORKING DAYS")
 *   - anchored to a different event                       ("90 DAYS from Invoice date")
 *   - delegated to the corporate client behind a TPA      ("VARY BASED ON COMPANY")
 *
 * Fourteen of the twenty-nine are one of the last four. A single
 * `paymentTermDays: number` holds none of them, which is why the workbook keeps
 * its terms in prose and why nothing in it can tell you a claim is overdue.
 *
 * TWO DELIBERATE CHOICES, both about not overstating what we know:
 *
 * 1. **A range has two edges and they mean different things.** The near edge is
 *    when the clinic may start chasing; the far edge is when the panel is
 *    genuinely late. `overdue` is judged against the FAR edge, because calling a
 *    claim overdue while the contract still permits payment is exactly how a
 *    receivables ledger drifts above what it will ever bank.
 *
 * 2. **Public holidays are not modelled.** Malaysia's holidays differ by state
 *    and no authoritative calendar is configured here, so WORKING_DAYS skips
 *    weekends only. A working-day due date is therefore the EARLIEST the term
 *    can expire, and `excludesPublicHolidaysOnly` says so, so a screen can
 *    label it rather than imply a precision that is not there.
 */

export type TermUnit = 'CALENDAR_DAYS' | 'WORKING_DAYS';
export type TermAnchor = 'SERVICE_DATE' | 'SUBMISSION_DATE' | 'INVOICE_DATE';

/** The panel's configured term, exactly as `PanelClinic` stores it. */
export interface PanelTerm {
  /** The nominal term — the near edge of a range, or the whole term. */
  nominalDays?: number | null;
  /** The far edge of a range term. NULL when the term is a single number. */
  maxDays?: number | null;
  /** NULL reads as CALENDAR_DAYS, which is what every pre-existing row means. */
  unit?: TermUnit | null;
  /** NULL reads as SUBMISSION_DATE, which is what the existing calculation does. */
  anchor?: TermAnchor | null;
  /** A TPA whose term is set by the employer behind the claim, not by the panel. */
  variesByPayer?: boolean | null;
}

/**
 * AN EMPLOYER'S OWN TERM (N-5, closes G-9), exactly as `PanelEmployer` stores
 * it. No `variesByPayer`: the employer IS the payer, so there is nothing
 * further down for the term to vary by.
 */
export interface EmployerTerm {
  nominalDays?: number | null;
  maxDays?: number | null;
  unit?: TermUnit | null;
  anchor?: TermAnchor | null;
}

/** Whose agreement the term that governed came from. */
export type TermSource = 'PANEL' | 'EMPLOYER';

/**
 * A `PanelEmployer` row, as the database spells it.
 *
 * Structural, not a Prisma type: this module takes plain inputs and knows
 * nothing about Prisma (see the module note), and a row carrying extra columns
 * satisfies it.
 */
export interface EmployerTermRow {
  paymentTermDays: number | null;
  paymentTermMaxDays: number | null;
  paymentTermUnit: TermUnit | null;
  paymentTermAnchor: TermAnchor | null;
}

/**
 * Map an employer row onto a term.
 *
 * It exists so the mapping lives in ONE place. The panel's equivalent mapping
 * is written out at each of its call sites, and those sites have already
 * drifted once in this module's history — a term field added to the schema and
 * mapped in one caller but not the other produces two different due dates for
 * the same claim, which is the single worst failure available here.
 */
export function employerTermOf(row?: EmployerTermRow | null): EmployerTerm | null {
  if (!row) return null;
  return {
    nominalDays: row.paymentTermDays,
    maxDays: row.paymentTermMaxDays,
    unit: row.paymentTermUnit,
    anchor: row.paymentTermAnchor,
  };
}

/**
 * WHICH TERM GOVERNS THIS CLAIM — the panel's, or the employer's behind it.
 *
 * G-9 is the reason this exists. One panel in the clinic's workbook states its
 * term as `VARY BASED ON COMPANY`, and until the employer was a recorded fact
 * Kuwick could only honour that by refusing to compute a due date at all
 * (`variesByPayer`). That was right — inventing one would have had staff chase
 * a panel that was not late — but it left a whole panel's receivable with
 * nothing to chase it by. Now the company is recorded, so its term can be too.
 *
 * TWO RULES, AND THE SECOND IS THE ONE THAT MATTERS.
 *
 * 1. AN EMPLOYER TERM WINS over the panel's, including over a panel with a
 *    perfectly good term of its own. If somebody has recorded that Company X
 *    pays in 90 days, that is the agreement this claim is under.
 *
 * 2. IT WINS AS A WHOLE, never field by field. An employer with 20 days and no
 *    unit does NOT inherit the panel's working-day rule: it reads as 20
 *    calendar days, the same default a panel with no unit gets. Half-inheriting
 *    produces a due date assembled from two different contracts, which nobody
 *    can explain and nobody can argue with a panel about.
 *
 * An employer with no `nominalDays` has no term, so the panel's governs —
 * which is what every employer means until somebody says otherwise, and is
 * why the field is nullable rather than defaulted.
 */
export function effectiveTerm(
  panel: PanelTerm,
  employer?: EmployerTerm | null,
): { term: PanelTerm; source: TermSource } {
  if (employer && employer.nominalDays !== null && employer.nominalDays !== undefined) {
    return {
      term: {
        nominalDays: employer.nominalDays,
        maxDays: employer.maxDays ?? null,
        unit: employer.unit ?? null,
        anchor: employer.anchor ?? null,
        // The employer's term is the payer's term. Carrying the panel's
        // `variesByPayer` through would make the one case this feature exists
        // for — a VARY BASED ON COMPANY panel whose company IS known —
        // resolve to "unknown" forever.
        variesByPayer: false,
      },
      source: 'EMPLOYER',
    };
  }
  return { term: panel, source: 'PANEL' };
}

/** The dates a claim's term actually resolves to. */
export interface TermWindow {
  /** When the clinic may start chasing. NULL when the term is unusable. */
  chaseFrom: Date | null;
  /** When the panel is genuinely late. Equals `chaseFrom` for a single-number term. */
  dueBy: Date | null;
  anchor: TermAnchor;
  anchorDate: Date | null;
  unit: TermUnit;
  /** FALSE when no due date could be computed. `reason` says why. */
  resolved: boolean;
  reason: string | null;
  /** TRUE when weekends were skipped but public holidays were not. */
  excludesPublicHolidaysOnly: boolean;
}

const DAY_MS = 86_400_000;

/** UTC-safe calendar-day addition. Dates here are day-precision facts. */
export function addCalendarDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/**
 * Monday–Friday day addition. Saturdays and Sundays are skipped; public
 * holidays are NOT, because no holiday calendar is configured — see the module
 * note. `days` of 0 returns the start date unchanged.
 */
export function addWorkingDays(from: Date, days: number): Date {
  if (days <= 0) return new Date(from.getTime());
  let cursor = new Date(from.getTime());
  let remaining = days;
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return cursor;
}

export interface TermAnchorDates {
  serviceDate?: Date | null;
  submittedAt?: Date | null;
  invoiceDate?: Date | null;
}

/**
 * Resolve a panel's term against a claim's dates.
 *
 * Returns `resolved: false` — with a reason a screen can print — rather than a
 * guessed date whenever the term cannot be computed:
 *   - the panel's term varies by the corporate client behind the claim
 *   - no number of days is configured
 *   - the date the clock starts from has not happened yet (an unsent claim has
 *     no submission date, so it cannot be overdue)
 */
export function resolveTermWindow(term: PanelTerm, dates: TermAnchorDates): TermWindow {
  const anchor: TermAnchor = term.anchor ?? 'SUBMISSION_DATE';
  const unit: TermUnit = term.unit ?? 'CALENDAR_DAYS';
  const anchorDate =
    anchor === 'SERVICE_DATE'
      ? (dates.serviceDate ?? null)
      : anchor === 'INVOICE_DATE'
        ? (dates.invoiceDate ?? null)
        : (dates.submittedAt ?? null);

  const base = {
    chaseFrom: null,
    dueBy: null,
    anchor,
    anchorDate,
    unit,
    excludesPublicHolidaysOnly: false,
  } as const;

  if (term.variesByPayer) {
    return {
      ...base,
      resolved: false,
      reason: "This panel's payment term is set by the employer behind each claim, not by the panel.",
    };
  }
  if (term.nominalDays === null || term.nominalDays === undefined) {
    return { ...base, resolved: false, reason: 'No payment term is configured for this panel.' };
  }
  if (!anchorDate) {
    const missing =
      anchor === 'SERVICE_DATE'
        ? 'service date'
        : anchor === 'INVOICE_DATE'
          ? 'invoice date'
          : 'submission date';
    return { ...base, resolved: false, reason: `No ${missing} yet, so the term has not started.` };
  }

  const add = unit === 'WORKING_DAYS' ? addWorkingDays : addCalendarDays;
  const chaseFrom = add(anchorDate, term.nominalDays);
  const dueBy = term.maxDays != null && term.maxDays > term.nominalDays ? add(anchorDate, term.maxDays) : chaseFrom;

  return {
    chaseFrom,
    dueBy,
    anchor,
    anchorDate,
    unit,
    resolved: true,
    reason: null,
    excludesPublicHolidaysOnly: unit === 'WORKING_DAYS',
  };
}

/**
 * Is this claim late?
 *
 * Judged against the FAR edge of the term (see the module note), and never for
 * a claim that is already settled — a paid claim is not overdue, it is done.
 * An unresolved window is never overdue: not knowing is not the same as knowing
 * it is on time, and the screen must show the reason instead.
 */
export function isOverdue(window: TermWindow, asOf: Date, settled: boolean): boolean {
  if (settled || !window.resolved || !window.dueBy) return false;
  return window.dueBy.getTime() < asOf.getTime();
}

/**
 * How many days past the far edge. Negative means still inside the term.
 * NULL when the window is unresolved — the honest answer to "how late is this"
 * when nobody has configured when it was ever due.
 */
export function daysPastDue(window: TermWindow, asOf: Date): number | null {
  if (!window.resolved || !window.dueBy) return null;
  return Math.floor((asOf.getTime() - window.dueBy.getTime()) / DAY_MS);
}

// ---------------------------------------------------------------------------
// THE RE-CLAIM DEADLINE (G-4).
//
// The clinic's excess/rejected register carries this as rule 5 of a procedure
// typed into spreadsheet cells: "max 2 months from the previous service date to
// make a new claim". It is a hard deadline with money attached — miss it and the
// claim is gone — and nothing in the workbook counts it down.
// ---------------------------------------------------------------------------

export interface ResubmissionWindow {
  deadline: Date | null;
  daysRemaining: number | null;
  expired: boolean;
  resolved: boolean;
  reason: string | null;
}

export function resolveResubmissionWindow(
  windowDays: number | null | undefined,
  originalServiceDate: Date | null | undefined,
  asOf: Date,
): ResubmissionWindow {
  if (windowDays === null || windowDays === undefined) {
    return {
      deadline: null,
      daysRemaining: null,
      expired: false,
      resolved: false,
      reason: "This panel's re-claim window is not configured, so the deadline is unknown.",
    };
  }
  if (!originalServiceDate) {
    return {
      deadline: null,
      daysRemaining: null,
      expired: false,
      resolved: false,
      reason: 'No original service date, so the re-claim deadline cannot be computed.',
    };
  }
  const deadline = addCalendarDays(originalServiceDate, windowDays);
  const daysRemaining = Math.ceil((deadline.getTime() - asOf.getTime()) / DAY_MS);
  return {
    deadline,
    daysRemaining,
    expired: daysRemaining < 0,
    resolved: true,
    reason: null,
  };
}
