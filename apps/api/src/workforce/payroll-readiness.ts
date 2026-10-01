import { formatCents } from '../finance/money';
import type { PayrollSalaryOutcome } from './salary-resolution';

/** Grouped ringgit for a sentence a person reads. `1800000` -> `18,000.00`. */
function money(cents: number): string {
  const [whole, part] = formatCents(cents).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${part}`;
}

/**
 * PAYROLL READINESS — one builder, two screens.
 *
 * The employee workspace answers "is THIS person ready to be paid" and the
 * pre-run readiness screen answers "who in this clinic is not, and why". Both
 * used to be at risk of drifting from each other and from the run itself; the
 * checklist is now built HERE, from the same facts the calculation blocks on,
 * so a person this list calls ready is a person the run can pay.
 *
 * Each item carries a SEVERITY. BLOCKING mirrors the run's own exceptions —
 * the run will refuse to pay this person, or refuse approval, while the item
 * is open. ADVISORY is real work that does not stop the run: a missing bank
 * account keeps somebody out of a payment file, not out of payroll.
 *
 * THE SALARY AMOUNT IS CONFIDENTIAL. The employee record needs only `hr.view`,
 * and this checklist used to print "RM3,200.00 a month" into the salary item's
 * detail regardless — handing the figure to anybody who could open the
 * record. The amount now appears only when the caller says the reader may
 * see pay; the item is exactly as actionable without it.
 *
 * WHICH PERMISSION says the reader may see pay: `hr.payroll.view` is the
 * enforced pay gate on every payroll surface — a run's lines, the journey,
 * this checklist — because running payroll IS seeing the figures.
 * `hr.salary.view` gates the standing salary register and parity screens on
 * top of it, and stays owner-only. The caller passes its own check in.
 */

export type ReadinessSeverity = 'BLOCKING' | 'ADVISORY';

export interface ReadinessItem {
  key: string;
  label: string;
  severity: ReadinessSeverity;
  done: boolean;
  /** A full sentence in the same language as the exception catalogue. */
  detail: string;
  /**
   * Where on the person's record this is put right: a query string the
   * screen appends to `/admin/hr/employees/<staffId>`, naming the tab and the
   * panel, so a chip is a link to the field and not to the top of the page.
   */
  link: string;
}

export interface ReadinessResult {
  items: ReadinessItem[];
  done: number;
  total: number;
  /** Open BLOCKING items — the number that decides "can the run pay them". */
  blockersOutstanding: number;
  ready: boolean;
}

/** The classification fields the checklist reads, as the resolver returns them. */
export interface ReadinessStanding {
  epfApplicable: boolean;
  epfMembership: string | null;
  socsoApplicable: boolean;
  eisApplicable: boolean;
  pcbApplicable: boolean;
  lindungParticipation: string | null;
  taxResidence: string | null;
  pcbCategory: string | number | null;
  restDayOfWeek: number | null;
  /** No fixed rest day: an answer, not a gap. */
  restDayVaries?: boolean;
}

export interface ReadinessFacts {
  salary: PayrollSalaryOutcome;
  /** Whether the reader may see pay figures. Decides wording only, never readiness. */
  mayReadPay: boolean;
  standing: ReadinessStanding;
  legalEmployerName: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  dateOfBirth: Date | null;
  epfNumberOnFile: boolean;
  socsoNumberOnFile: boolean;
  /** The hand-entered PCB input for the period, if any. */
  pcbInputAmountCents: number | null;
  /**
   * Whether LINDUNG 24 JAM has commenced for the period being readied.
   * Absent reads TRUE (fail closed); a caller readying a pre-June-2026
   * month passes false, so a scheme that does not exist yet asks nobody
   * anything.
   */
  lindungInForce?: boolean;
  /**
   * Year-to-date context for the period being readied. Null when the question
   * does not arise — January, or an employee who starts this month.
   */
  ytd: {
    periodMonth: number;
    taxYear: number;
    /** Any EmployeeYtd rows (calculated or imported) before this month. */
    hasPriorMonths: boolean;
    /** Whether the employee was employed before this period began. */
    employedBeforePeriod: boolean;
  } | null;
}

const longDate = (value: Date) =>
  value.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function buildPayrollReadiness(facts: ReadinessFacts): ReadinessResult {
  const { salary, standing } = facts;

  const items: ReadinessItem[] = [
    {
      key: 'employer',
      link: '?tab=employment&focus=employer',
      label: 'Legal employer',
      severity: 'BLOCKING',
      done: facts.legalEmployerName !== null,
      detail:
        facts.legalEmployerName !== null
          ? `Employed by ${facts.legalEmployerName}. Statutory filings and the payroll run are made under this company.`
          : 'No employing company is recorded. A payroll run belongs to one legal employer, and EPF, SOCSO and tax are all filed under it — so nothing can be calculated until this is set.',
    },
    {
      key: 'salary',
      link: '?tab=employment&focus=salary',
      label: 'Salary',
      severity: 'BLOCKING',
      done: salary.kind === 'RESOLVED',
      detail:
        salary.kind === 'RESOLVED'
          ? facts.mayReadPay
            ? `RM${money(salary.row.amountCents)} a ${salary.row.basis === 'MONTHLY' ? 'month' : salary.row.basis.toLowerCase()}, since ${longDate(salary.row.effectiveFrom)}`
            : `A salary is in force, since ${longDate(salary.row.effectiveFrom)}. The amount is visible to pay-permission holders only.`
          : salary.reason,
    },
    {
      key: 'restDay',
      link: '?tab=statutory&focus=standing',
      label: 'Rest day',
      severity: 'BLOCKING',
      done: (standing.restDayOfWeek !== null && standing.restDayOfWeek !== undefined) || standing.restDayVaries === true,
      detail:
        standing.restDayVaries === true
          ? 'Varies week to week. Kuwick cannot tell which worked day was the rest day, so rest-day pay for them is keyed by hand when it arises; the run says so each month.'
          : standing.restDayOfWeek === null || standing.restDayOfWeek === undefined
            ? 'No rest day is designated. The Employment Act requires one a week, and working it is paid in days at the ordinary rate rather than as hours of overtime — so without it their extra hours cannot be priced.'
            : `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][standing.restDayOfWeek]}. Work on it is paid under s.60(3), not as ordinary overtime.`,
    },
    {
      key: 'bank',
      link: '?tab=bank',
      label: 'Bank account',
      severity: 'ADVISORY',
      done: Boolean(facts.bankName && facts.bankAccountNo),
      detail: facts.bankName
        ? `${facts.bankName}${facts.bankAccountNo ? ` · ending ${facts.bankAccountNo.slice(-4)}` : ''}`
        : 'No bank account is recorded, so they cannot be included in a payment file.',
    },
    {
      key: 'pcb',
      link: '?tab=statutory&focus=standing',
      label: 'Monthly tax (PCB) information',
      severity: 'BLOCKING',
      done: !standing.pcbApplicable || facts.pcbInputAmountCents !== null || Boolean(standing.taxResidence && standing.pcbCategory),
      detail: !standing.pcbApplicable
        ? 'Recorded as not paying PCB.'
        : facts.pcbInputAmountCents !== null
          ? `RM${money(facts.pcbInputAmountCents)} entered for this month.`
          : standing.taxResidence && standing.pcbCategory
            ? 'Their tax residence and MTD category are recorded, so monthly tax is calculated from the official specification.'
            : 'Needed before this month can be finalised: either record their tax residence and MTD category so the figure can be calculated, or enter the month’s PCB by hand.',
    },
    (() => {
      // The membership numbers a filing is made under. Only the
      // schemes that APPLY are required: a person outside SOCSO
      // needs no SOCSO number, and demanding one would be an amber
      // mark against a record that is complete.
      const missing = [
        standing.epfApplicable && !facts.epfNumberOnFile ? 'EPF' : null,
        standing.socsoApplicable && !facts.socsoNumberOnFile ? 'SOCSO' : null,
      ].filter((name): name is string => name !== null);
      // A membership number lets a filing be addressed; the Third
      // Schedule Part decides what goes IN it, and without the Part
      // there is no EPF figure to file at all.
      const partUnknown = standing.epfApplicable && !standing.epfMembership;
      // Monthly tax cannot be worked out without both, and neither
      // can be inferred: residence chooses between a flat 30% and
      // the progressive table, category chooses the deductions.
      // LINDUNG 24 JAM asks nothing here: PERKESO enrols every employee
      // unless they opt out through its own form, so a blank participation
      // is enrolled, and the run deducts it. The owner's decision, 1 October
      // 2026, replacing the old "cannot be guessed either way".
      const taxProfileUnknown =
        standing.pcbApplicable && (!standing.taxResidence || !standing.pcbCategory) && facts.pcbInputAmountCents === null;
      const applies = [
        standing.epfApplicable ? 'EPF' : null,
        standing.socsoApplicable ? 'SOCSO' : null,
        standing.eisApplicable ? 'EIS' : null,
      ].filter((name): name is string => name !== null);
      /*
       * SEVERITY FOLLOWS THE RUN, because this page's own header promises
       * "blocking items are the ones the run itself will refuse on". An
       * unknown Part or tax profile stops the CALCULATION, so those are
       * BLOCKING. A missing membership NUMBER stops nothing the
       * run does — it stops the FILING being addressed, exactly like the
       * employer's own missing SOCSO code, which the section above calls
       * out as gating the filings and not the calculation. Marking it
       * BLOCKING put seven people in red on a month the run itself
       * calculated and approved — two answers to one question, from the
       * screen built to prevent that.
       */
      const calculationBlocked = partUnknown || taxProfileUnknown;
      return {
        key: 'statutory',
        link: '?tab=statutory&focus=standing',
        label: 'EPF, SOCSO and EIS',
        severity: (calculationBlocked ? 'BLOCKING' : 'ADVISORY') as ReadinessSeverity,
        done: missing.length === 0 && !calculationBlocked,
        detail: taxProfileUnknown
          ? 'Their tax residence or MTD category is not recorded. Monthly tax is a flat 30% for a non-resident and a table for everybody else, and the category decides which deductions apply, so neither can be guessed.'
          : partUnknown
            ? 'Their EPF membership — Malaysian citizen, permanent resident or non-citizen — is not recorded. The Third Schedule has a different Part for each, so no EPF contribution can be worked out until it is.'
            : missing.length > 0
              ? `No ${missing.join(' or ')} membership number is on file, so nothing could be filed for them under ${missing.length === 1 ? 'that scheme' : 'those schemes'}.`
              : applies.length === 0
                ? 'None of the three applies to this person.'
                : `${applies.join(', ')} apply, and the membership numbers are on file.`,
      };
    })(),
    {
      key: 'dob',
      link: '?tab=profile&edit=1',
      label: 'Date of birth',
      severity: 'BLOCKING',
      done: Boolean(facts.dateOfBirth),
      detail: facts.dateOfBirth
        ? 'Sets the age-related statutory rates.'
        : 'EPF, SOCSO and EIS all change at 60, so this is needed before they can be calculated.',
    },
  ];

  // OPENING BALANCES. Only raised where the question arises: a period after
  // January, for somebody employed before it, with no pay history for the
  // year on record. Advisory, because a clinic genuinely starting fresh in
  // this month is not wrong — but monthly tax is cumulative, and computing it
  // as though January onwards paid nothing is a decision somebody should make
  // knowingly, not a default they never saw.
  if (facts.ytd && facts.ytd.periodMonth > 1 && facts.ytd.employedBeforePeriod && !facts.ytd.hasPriorMonths) {
    items.push({
      key: 'ytdOpening',
      link: '?tab=statutory&focus=tax',
      label: 'Pay history for the year',
      severity: 'ADVISORY',
      done: false,
      detail:
        `No pay before this month is on record for ${facts.ytd.taxYear}. Monthly tax is cumulative over the year, ` +
        'so it will be worked out as though nothing was paid in the earlier months. If this employer paid them ' +
        'before this system did, import the opening balances; if a previous employer paid them this year, record ' +
        'their Form TP3.',
    });
  }

  const blockersOutstanding = items.filter((item) => item.severity === 'BLOCKING' && !item.done).length;
  return {
    items,
    done: items.filter((item) => item.done).length,
    total: items.length,
    blockersOutstanding,
    ready: blockersOutstanding === 0,
  };
}
