import { EpfMembership } from '../statutory/contributions';
import { LindungParticipation } from '../statutory/lindung-24-jam';

/**
 * WHAT SOMEBODY'S STATUTORY STANDING WAS, ON THE DAY IT MATTERED.
 *
 * THE DEFECT THIS CLOSES.
 *
 * Every classification that decides a Malaysian statutory figure — which Part
 * of the EPF Third Schedule an employee falls under, whether they elected 9%
 * or 11%, whether they joined LINDUNG 24 JAM, their tax residence and MTD
 * category, the rest day the employer designated — lived as a plain mutable
 * column on `employee_profiles`. Editing one changed the answer for EVERY
 * period that had not been approved yet, including periods already calculated
 * and looked at. A permanent resident recorded in September repriced March.
 *
 * This is the same failure `EmployeeSalary` was built to fix, in the same
 * place, for figures of the same size: moving a person between Third Schedule
 * Parts is worth two percentage points of employer contribution, and nothing
 * on the payslip says which Part was used.
 *
 * So classification becomes what pay already is: A ROW WITH A DATE ON IT.
 *
 * WHAT IS AND IS NOT VERSIONED — the line, stated once.
 *
 *  - A STATE that genuinely CHANGED is versioned. Permanent residence is
 *    granted on a date. An EPF rate election under Borang KWSP 17A takes
 *    effect from a date. A LINDUNG opt-in is dated. Tax residence turns on the
 *    183-day test and can differ year to year. A rest day is redesignated.
 *    Each of these has a "before" that was correct when it was true, and a
 *    historical payroll must keep using the "before".
 *
 *  - AN IDENTITY that was MIS-KEYED is corrected, not versioned. An EPF member
 *    number, a SOCSO number and an LHDN reference are one lifelong fact each.
 *    Effective-dating them would freeze a typo into a filed return: the March
 *    submission wants the CORRECT number, not the wrong one that was on file
 *    in March. Those stay as mutable columns, deliberately.
 *
 * RESOLUTION IS BY PERIOD, NEVER BY TODAY — and the period END, matching
 * `salary-resolution.ts`: a contribution is worked out on the standing at the
 * point the wage period closes.
 */

export type TaxResidence = 'RESIDENT' | 'NON_RESIDENT';
export type PcbCategoryCode = 'CATEGORY_1' | 'CATEGORY_2' | 'CATEGORY_3';
export type OvertimeContractPolicyCode = 'PAY_AT_STATUTORY_RATES' | 'NOT_PAID';

/**
 * One complete statement of a person's statutory standing from a date.
 *
 * A version is COMPLETE on purpose rather than a patch of the fields that
 * moved. An auditor's question is "what was this person's statutory standing
 * in March", and a chain of partial diffs answers that only by replaying every
 * row since hire — which is a reconstruction, not a record.
 */
export interface StatutoryClassificationRow {
  readonly id: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;

  readonly epfApplicable: boolean;
  readonly epfMembership: EpfMembership | null;
  readonly epfEmployeeRate: number | null;
  readonly socsoApplicable: boolean;
  readonly eisApplicable: boolean;
  readonly lindungParticipation: LindungParticipation | null;

  readonly pcbApplicable: boolean;
  readonly taxResidence: TaxResidence | null;
  readonly pcbCategory: PcbCategoryCode | null;
  readonly qualifyingChildren: number;
  readonly disabledSelf: boolean;
  readonly disabledSpouse: boolean;

  readonly restDayOfWeek: number | null;
  /** No fixed rest day: it varies week to week, so no weekday is the rest day. */
  readonly restDayVaries: boolean;
  /** The varying rest day is the one the roster gives. Only ever with restDayVaries. */
  readonly restDayFollowsRoster: boolean;
  readonly overtimeContractPolicy: OvertimeContractPolicyCode | null;
  /** On top of the computed MTD each month, in cents; 0 when none. */
  readonly additionalPcbCents: number;
  readonly additionalPcbNote: string | null;
}

/**
 * THE FIELDS THAT CAN MOVE MONEY, and the words a person reads for each.
 *
 * Used for two things that must not drift apart: deciding whether two rows
 * overlapping a period are a genuine ambiguity, and naming the change in the
 * exception. A field added to the row and forgotten here would be a
 * classification that could change mid-period WITHOUT stopping the run — so
 * the list is asserted against the row's own keys by test.
 */
export const CLASSIFICATION_FIELDS = {
  epfApplicable: 'whether EPF applies',
  epfMembership: 'EPF Third Schedule Part',
  epfEmployeeRate: 'elected EPF employee rate',
  socsoApplicable: 'whether SOCSO applies',
  eisApplicable: 'whether EIS applies',
  lindungParticipation: 'LINDUNG 24 JAM participation',
  pcbApplicable: 'whether PCB applies',
  taxResidence: 'tax residence',
  pcbCategory: 'MTD category',
  qualifyingChildren: 'qualifying children',
  disabledSelf: 'disabled (self)',
  disabledSpouse: 'disabled (spouse)',
  restDayOfWeek: 'designated rest day',
  restDayVaries: 'whether the rest day varies week to week',
  restDayFollowsRoster: 'whether the rest day follows the roster',
  overtimeContractPolicy: 'overtime policy above the First Schedule limit',
  additionalPcbCents: 'additional PCB each month',
  additionalPcbNote: 'additional PCB note',
} as const satisfies Record<
  Exclude<keyof StatutoryClassificationRow, 'id' | 'effectiveFrom' | 'effectiveTo'>,
  string
>;

export type ClassificationField = keyof typeof CLASSIFICATION_FIELDS;

/** Which money-affecting fields differ between two versions. */
export function classificationDiff(
  a: StatutoryClassificationRow,
  b: StatutoryClassificationRow,
): ClassificationField[] {
  return (Object.keys(CLASSIFICATION_FIELDS) as ClassificationField[]).filter((key) => a[key] !== b[key]);
}

/**
 * The list a row was recorded as changing, read back from its JSON column.
 *
 * Null when the row carries none (it was written before the column existed)
 * or holds anything but known field keys; the caller then diffs live. A
 * stored list is never recomputed: it is what the row was recorded as
 * changing, and a version inserted before it later does not alter that.
 */
export function storedChangedFields(value: unknown): ClassificationField[] | null {
  if (!Array.isArray(value)) return null;
  const keys = value.filter(
    (entry): entry is ClassificationField => typeof entry === 'string' && entry in CLASSIFICATION_FIELDS,
  );
  return keys.length === value.length ? keys : null;
}

function atDayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function covers(row: StatutoryClassificationRow, instant: number): boolean {
  if (atDayStart(row.effectiveFrom) > instant) return false;
  if (row.effectiveTo && atDayStart(row.effectiveTo) < instant) return false;
  return true;
}

/**
 * WHAT PAYROLL IS ALLOWED TO DO WITH A CLASSIFICATION CHANGE MID-PERIOD.
 *
 * The same refusal `resolveSalaryForPayroll` makes, for the same reason. If an
 * employee's Third Schedule Part changed on the 15th, the month's contribution
 * is genuinely ambiguous: the Act does not say, and nothing in this system has
 * been told which answer the clinic wants. Both possible figures look exactly
 * like a correct one on a payslip.
 *
 * The ONE case that is not ambiguous is a version recorded mid-period that
 * changed NO money-affecting field — a re-recorded standing, a corrected note.
 * That is resolved, not refused: the block exists because the money is
 * uncertain, and here it demonstrably is not. The proof is the field list, not
 * a judgement about the change.
 */
export type ClassificationOutcome =
  | { kind: 'RESOLVED'; row: StatutoryClassificationRow; reason: string }
  | { kind: 'NONE_ON_RECORD'; reason: string }
  | {
      kind: 'CHANGED_MID_PERIOD';
      /** Oldest first. At least two rows, or this outcome would not arise. */
      overlapping: StatutoryClassificationRow[];
      previous: StatutoryClassificationRow;
      next: StatutoryClassificationRow;
      /** The day the change takes effect — `next.effectiveFrom`. */
      changedOn: Date;
      /** Every money-affecting field that moved, across all overlapping rows. */
      changed: ClassificationField[];
      reason: string;
    };

/**
 * Resolve the classification for a payroll period.
 *
 * `periodStart` and `periodEnd` are INCLUSIVE day boundaries — the caller
 * passes the last day of the month, not the first of the next.
 */
/**
 * THE STANDING IN FORCE ON ONE DAY: the latest version that covers it, or null
 * where none does. A day worked last month and paid this month was a rest day
 * or not by the standing of that day, not of the month that pays it.
 */
export function classificationOn<R extends StatutoryClassificationRow>(rows: readonly R[], day: Date): R | null {
  const instant = atDayStart(day);
  return [...rows].sort((a, b) => atDayStart(b.effectiveFrom) - atDayStart(a.effectiveFrom)).find((row) => covers(row, instant)) ?? null;
}

export function resolveClassificationForPayroll(
  rows: readonly StatutoryClassificationRow[],
  periodStart: Date,
  periodEnd: Date,
): ClassificationOutcome {
  const start = atDayStart(periodStart);
  const end = atDayStart(periodEnd);

  const sorted = [...rows].sort((a, b) => atDayStart(a.effectiveFrom) - atDayStart(b.effectiveFrom));
  const overlapping = sorted.filter((row) => {
    const from = atDayStart(row.effectiveFrom);
    const to = row.effectiveTo ? atDayStart(row.effectiveTo) : Number.POSITIVE_INFINITY;
    return from <= end && to >= start;
  });

  const atEnd = [...sorted].reverse().find((row) => covers(row, end)) ?? null;

  if (overlapping.length > 1) {
    const first = overlapping[0];
    const changed = [
      ...new Set(overlapping.slice(1).flatMap((row) => classificationDiff(first, row))),
    ];
    if (changed.length > 0) {
      const next = overlapping[overlapping.length - 1];
      return {
        kind: 'CHANGED_MID_PERIOD',
        overlapping,
        previous: first,
        next,
        changedOn: next.effectiveFrom,
        changed,
        reason:
          `${overlapping.length} statutory classifications apply to this period and ` +
          `${changed.length === 1 ? 'one field differs' : `${changed.length} fields differ`} between them ` +
          `(${changed.map((key) => CLASSIFICATION_FIELDS[key]).join(', ')}). ` +
          'How a mid-period change is contributed has not been decided for this clinic, so payroll will not assume one.',
      };
    }
    if (atEnd) {
      return {
        kind: 'RESOLVED',
        row: atEnd,
        reason:
          `${overlapping.length} classification versions overlap this period but none of the fields that ` +
          'change a statutory figure differs between them, so there is nothing to decide.',
      };
    }
  }

  if (!atEnd) {
    return {
      kind: 'NONE_ON_RECORD',
      reason:
        overlapping.length > 0
          ? 'A statutory classification is recorded for part of this period but none was in force at the period end.'
          : 'No statutory classification is recorded for this employee for this period.',
    };
  }

  return {
    kind: 'RESOLVED',
    row: atEnd,
    reason: 'One statutory classification was in force for the whole period.',
  };
}

// ---------------------------------------------------------------------------
// The employer side
// ---------------------------------------------------------------------------

export type HrdRegistrationClassCode = 'MANDATORY_SECTION_14' | 'OPTIONAL_SECTION_15' | 'NOT_REGISTERED';

/**
 * THE EMPLOYER'S STATUTORY STANDING, dated.
 *
 * `legal_employers` held HRD Corp registration as a free-text `hrd_category`
 * beside a hand-typed `hrd_levy_rate` decimal. Two problems, both real:
 *
 *  - THE RATE WAS TYPED. Section 14 is 1% and section 15 is 0.5%; those are
 *    the Act's numbers, not the clinic's. A field accepting 0.0075 accepted a
 *    levy nobody could reconcile to the PSMB Act.
 *
 *  - IT WAS NOT DATED. An employer crossing the section 14 headcount moves
 *    from 0.5% to 1% on a date, and a levy return for the months before it
 *    must keep the old class.
 *
 * So the class is an enum the levy engine already understands, the rate is
 * derived from it, and the pair is a dated row.
 */
export interface EmployerStatutoryProfileRow {
  readonly id: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly hrdRegistration: HrdRegistrationClassCode;
}

export type EmployerProfileOutcome =
  | { kind: 'RESOLVED'; row: EmployerStatutoryProfileRow; reason: string }
  | { kind: 'NONE_ON_RECORD'; reason: string }
  | {
      kind: 'CHANGED_MID_PERIOD';
      overlapping: EmployerStatutoryProfileRow[];
      previous: EmployerStatutoryProfileRow;
      next: EmployerStatutoryProfileRow;
      changedOn: Date;
      reason: string;
    };

export function resolveEmployerProfileForPayroll(
  rows: readonly EmployerStatutoryProfileRow[],
  periodStart: Date,
  periodEnd: Date,
): EmployerProfileOutcome {
  const start = atDayStart(periodStart);
  const end = atDayStart(periodEnd);

  const sorted = [...rows].sort((a, b) => atDayStart(a.effectiveFrom) - atDayStart(b.effectiveFrom));
  const overlapping = sorted.filter((row) => {
    const from = atDayStart(row.effectiveFrom);
    const to = row.effectiveTo ? atDayStart(row.effectiveTo) : Number.POSITIVE_INFINITY;
    return from <= end && to >= start;
  });
  const atEnd =
    [...sorted]
      .reverse()
      .find((row) => {
        if (atDayStart(row.effectiveFrom) > end) return false;
        if (row.effectiveTo && atDayStart(row.effectiveTo) < end) return false;
        return true;
      }) ?? null;

  if (overlapping.length > 1) {
    const distinct = new Set(overlapping.map((row) => row.hrdRegistration));
    if (distinct.size > 1) {
      const next = overlapping[overlapping.length - 1];
      return {
        kind: 'CHANGED_MID_PERIOD',
        overlapping,
        previous: overlapping[0],
        next,
        changedOn: next.effectiveFrom,
        reason:
          'The HRD Corp registration class changed part-way through this period. The levy for the month would ' +
          'be charged at one rate or the other, and nothing here decides which.',
      };
    }
    if (atEnd) {
      return {
        kind: 'RESOLVED',
        row: atEnd,
        reason: 'Several employer statutory versions overlap this period, all in the same registration class.',
      };
    }
  }

  if (!atEnd) {
    return {
      kind: 'NONE_ON_RECORD',
      reason:
        overlapping.length > 0
          ? 'An employer statutory profile is recorded for part of this period but none was in force at the period end.'
          : 'No employer statutory profile is recorded for this period.',
    };
  }

  return { kind: 'RESOLVED', row: atEnd, reason: 'One employer statutory profile was in force for the whole period.' };
}

// ---------------------------------------------------------------------------
// The employer-selected contribution basis
// ---------------------------------------------------------------------------

/**
 * WHICH CONTRIBUTION BASIS GOVERNS A PERIOD — resolved with the same rules as
 * every other dated statutory question, because it prices the same money.
 *
 * A basis that CHANGES part-way through the month blocks exactly as a salary
 * or an HRD class change does: the month's EPF would look correct computed on
 * either selection, and nothing here decides which one the employer meant the
 * month to follow. No row on record is not an error — it is the default, and
 * it means the statutory assessment governs alone.
 */
export interface ContributionBasisRow {
  readonly id: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly mode: 'BASIC_ONLY' | 'BASIC_PLUS_SELECTED' | 'ALL_APPLICABLE';
  readonly includedComponentCodes: readonly string[];
}

export type ContributionBasisOutcome =
  | { kind: 'RESOLVED'; row: ContributionBasisRow; reason: string }
  | { kind: 'NONE_ON_RECORD'; reason: string }
  | {
      kind: 'CHANGED_MID_PERIOD';
      overlapping: ContributionBasisRow[];
      previous: ContributionBasisRow;
      next: ContributionBasisRow;
      changedOn: Date;
      reason: string;
    };

function basisContentDiffers(a: ContributionBasisRow, b: ContributionBasisRow): boolean {
  if (a.mode !== b.mode) return true;
  const left = [...a.includedComponentCodes].sort().join(',');
  const right = [...b.includedComponentCodes].sort().join(',');
  return left !== right;
}

export function resolveContributionBasisForPayroll(
  rows: readonly ContributionBasisRow[],
  periodStart: Date,
  periodEnd: Date,
): ContributionBasisOutcome {
  const start = atDayStart(periodStart);
  const end = atDayStart(periodEnd);

  // A SUPERSEDED row is closed into an EMPTY interval — effectiveTo before
  // its own effectiveFrom. It was never in force for any day and must be
  // invisible here; the naive overlap test below would otherwise catch an
  // empty interval sitting wholly inside the period.
  const sorted = [...rows]
    .filter((row) => row.effectiveTo === null || atDayStart(row.effectiveTo) >= atDayStart(row.effectiveFrom))
    .sort((a, b) => atDayStart(a.effectiveFrom) - atDayStart(b.effectiveFrom));
  const overlapping = sorted.filter((row) => {
    const from = atDayStart(row.effectiveFrom);
    const to = row.effectiveTo ? atDayStart(row.effectiveTo) : Number.POSITIVE_INFINITY;
    return from <= end && to >= start;
  });
  const atEnd =
    [...sorted]
      .reverse()
      .find((row) => {
        if (atDayStart(row.effectiveFrom) > end) return false;
        if (row.effectiveTo && atDayStart(row.effectiveTo) < end) return false;
        return true;
      }) ?? null;

  if (overlapping.length > 1) {
    const first = overlapping[0];
    if (overlapping.slice(1).some((row) => basisContentDiffers(first, row))) {
      const next = overlapping[overlapping.length - 1];
      return {
        kind: 'CHANGED_MID_PERIOD',
        overlapping,
        previous: first,
        next,
        changedOn: next.effectiveFrom,
        reason:
          'The EPF contribution basis changed part-way through this period. The month would look correct ' +
          'computed on either selection, and nothing here decides which.',
      };
    }
    if (atEnd) {
      return {
        kind: 'RESOLVED',
        row: atEnd,
        reason: 'Several basis versions overlap this period, all selecting the same thing.',
      };
    }
  }

  if (!atEnd) {
    return {
      kind: 'NONE_ON_RECORD',
      reason:
        overlapping.length > 0
          ? 'A contribution basis is recorded for part of this period but none was in force at the period end.'
          : 'No contribution basis is recorded for this period; the statutory assessment governs alone.',
    };
  }

  return { kind: 'RESOLVED', row: atEnd, reason: 'One contribution basis was in force for the whole period.' };
}
