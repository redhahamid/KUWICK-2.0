import { PayrollInputSource } from '@prisma/client';

/**
 * MATERIALISATION — carrying an approved upstream fact into a payroll period.
 *
 * Upstream feeds were read LIVE at calculation time: the run queried attendance,
 * leave and incentives, derived a figure, and put it straight onto the payslip.
 * Three things were wrong with that.
 *
 *   1. There was no reviewable row. Step 3 could show "overtime RM90.26" and
 *      nothing on the screen could say where it came from, who approved the
 *      hours, or when.
 *   2. A derived figure could not be adjusted without editing the attendance
 *      record behind it — so correcting a payslip meant falsifying a timesheet.
 *   3. Nothing was idempotent by construction. Two calculations produced the
 *      same numbers only because they happened to read the same rows.
 *
 * A materialised input is a row in `payroll_input_entries` carrying its SOURCE
 * and the id of the upstream record that produced it. The unique key
 * (tenant, staff, period, componentCode) makes re-materialisation an upsert, so
 * recalculating a run twice cannot pay anybody twice.
 *
 * WHAT IS DELIBERATELY NOT HERE. This module decides WHAT should exist for a
 * period; it does not write anything. The service does the writing inside the
 * run's transaction, so a materialisation that fails leaves no half-carried
 * period behind.
 */

/** One input the period should contain, and the upstream fact behind it. */
export interface MaterialisedInput {
  staffId: string;
  componentCode: string;
  label: string;
  /** Always positive. The component's kind carries the sign. */
  amountCents: number;
  source: PayrollInputSource;
  /** The upstream row. Together with the component and period it is the identity. */
  sourceRecordId: string | null;
  /** Where the work was done, when that is not the month it is paid in. */
  earnedPeriod: Date | null;
  /**
   * Human-readable provenance, shown under the figure on the earnings step.
   * "5.5 approved hours from the timesheet" rather than a source enum.
   */
  provenance: string;
  /** Who approved the upstream fact, where the upstream has an approver. */
  approvedBy: string | null;
}

export interface AttendanceFact {
  staffId: string;
  approvedOvertimeMinutes: number;
  /** The rate this period prices overtime at, already resolved from ORP. */
  overtimeHourlyCents: number;
  /** Multiplier for a normal working day. Configured, never assumed here. */
  multiplier: number;
  /** The attendance rows behind it, so the input can point back at something. */
  sourceRecordIds: string[];
  approverName: string | null;
}

export interface LeaveFact {
  staffId: string;
  leaveRequestId: string;
  leaveType: string;
  unpaidDays: number;
  dailyRateCents: number;
  approverName: string | null;
  startDate: Date;
  endDate: Date;
}

export interface IncentiveFact {
  staffId: string;
  incentiveResultId: string;
  incentiveRunId: string;
  amountCents: number;
  /** The month the work was done in, which may not be the month it is paid in. */
  earnedPeriod: Date;
  approverName: string | null;
}

export interface ClaimFact {
  staffId: string;
  claimId: string;
  category: string;
  amountCents: number;
  claimDate: Date;
  approverName: string | null;
}

/**
 * Overtime. APPROVED MINUTES ONLY — unapproved overtime raises an exception
 * elsewhere and is deliberately not carried, because paying for hours nobody
 * approved is worse than paying late.
 */
export function materialiseOvertime(fact: AttendanceFact): MaterialisedInput | null {
  if (fact.approvedOvertimeMinutes <= 0) return null;
  const hours = fact.approvedOvertimeMinutes / 60;
  // Round the hourly rate before multiplying, matching the clinic's own
  // spreadsheet. Rounding at the end instead is a sen or two out on most rows,
  // which makes a reconciliation against the old workbook impossible to sign off.
  const rateCents = Math.round(fact.overtimeHourlyCents * fact.multiplier);
  const amountCents = Math.round(rateCents * hours);
  if (amountCents <= 0) return null;

  const roundedHours = Math.round(hours * 100) / 100;
  return {
    staffId: fact.staffId,
    componentCode: 'OVERTIME',
    label: 'Overtime',
    amountCents,
    source: 'ATTENDANCE',
    // One input covers many attendance rows, so the identity is the period
    // rather than a single row. The rows are named in the provenance.
    sourceRecordId: fact.sourceRecordIds.length === 1 ? fact.sourceRecordIds[0] : null,
    earnedPeriod: null,
    provenance:
      `${roundedHours} approved hour${roundedHours === 1 ? '' : 's'} from the timesheet, at ` +
      `${(rateCents / 100).toFixed(2)} an hour` +
      (fact.approverName ? `, approved by ${fact.approverName}` : ''),
    approvedBy: fact.approverName,
  };
}

/**
 * Unpaid leave. Only APPROVED leave of an unpaid type reaches pay; paid annual
 * and paid medical leave produce nothing, because there is no payroll effect
 * and a zero-amount input would be noise on the deductions step.
 */
export function materialiseUnpaidLeave(facts: LeaveFact[]): MaterialisedInput | null {
  const withDays = facts.filter((f) => f.unpaidDays > 0);
  if (withDays.length === 0) return null;

  const totalDays = withDays.reduce((sum, f) => sum + f.unpaidDays, 0);
  const dailyRate = withDays[0].dailyRateCents;
  const amountCents = Math.round(totalDays * dailyRate);
  if (amountCents <= 0) return null;

  const roundedDays = Math.round(totalDays * 100) / 100;
  const approver = withDays.find((f) => f.approverName)?.approverName ?? null;
  return {
    staffId: withDays[0].staffId,
    componentCode: 'UNPAID_LEAVE',
    label: 'Unpaid leave',
    amountCents,
    source: 'LEAVE',
    sourceRecordId: withDays.length === 1 ? withDays[0].leaveRequestId : null,
    earnedPeriod: null,
    provenance:
      `${roundedDays} approved unpaid day${roundedDays === 1 ? '' : 's'} from the leave record, at ` +
      `${(dailyRate / 100).toFixed(2)} a day` +
      (approver ? `, approved by ${approver}` : ''),
    approvedBy: approver,
  };
}

/**
 * Doctor incentives. The amount comes from the approved incentive run and is
 * NOT recalculated here: the run stored the rule version and a snapshot of it,
 * and recomputing would silently reprice a period whose rules have since moved.
 */
export function materialiseIncentives(facts: IncentiveFact[]): MaterialisedInput | null {
  if (facts.length === 0) return null;
  const amountCents = facts.reduce((sum, f) => sum + f.amountCents, 0);
  if (amountCents <= 0) return null;

  const earned = facts[0].earnedPeriod;
  const approver = facts.find((f) => f.approverName)?.approverName ?? null;
  return {
    staffId: facts[0].staffId,
    componentCode: 'INCENTIVE',
    label: 'Procedure incentive',
    amountCents,
    source: 'INCENTIVE',
    sourceRecordId: facts.length === 1 ? facts[0].incentiveResultId : null,
    earnedPeriod: earned,
    provenance:
      `${facts.length} approved incentive result${facts.length === 1 ? '' : 's'} from the ` +
      `${earned.toISOString().slice(0, 7)} incentive run` +
      (approver ? `, approved by ${approver}` : ''),
    approvedBy: approver,
  };
}

/**
 * Approved claims routed to payroll. One input per claim rather than a total,
 * so the earnings step can name each one and link back to its receipt — and so
 * the unique link between claim and input holds per claim.
 *
 * The component code carries the claim id so two claims in one month do not
 * collide on the (tenant, staff, period, componentCode) key. A total would have
 * been simpler and would have made "which claim was this" unanswerable.
 */
export function materialiseClaim(fact: ClaimFact): MaterialisedInput | null {
  if (fact.amountCents <= 0) return null;
  return {
    staffId: fact.staffId,
    componentCode: 'CLAIM_REIMBURSEMENT',
    label: `${claimCategoryLabel(fact.category)} claim`,
    amountCents: fact.amountCents,
    source: 'CLAIM',
    sourceRecordId: fact.claimId,
    earnedPeriod: new Date(Date.UTC(fact.claimDate.getUTCFullYear(), fact.claimDate.getUTCMonth(), 1)),
    provenance:
      `Approved ${claimCategoryLabel(fact.category).toLowerCase()} claim dated ` +
      `${fact.claimDate.toISOString().slice(0, 10)}` +
      (fact.approverName ? `, approved by ${fact.approverName}` : ''),
    approvedBy: fact.approverName,
  };
}

export function claimCategoryLabel(category: string): string {
  switch (category) {
    case 'MEDICAL': return 'Medical';
    case 'TRAVEL': return 'Travel';
    case 'MEAL': return 'Meal';
    case 'TRAINING': return 'Training';
    case 'EQUIPMENT': return 'Equipment';
    case 'PROFESSIONAL_FEE': return 'Professional fee';
    default: return 'Other';
  }
}

/**
 * IDEMPOTENCE, STATED AS A FUNCTION.
 *
 * Given what the period should contain and what it already contains, what has
 * to change. A materialised input is REPLACED when its amount or provenance has
 * moved, LEFT ALONE when it has not, and REMOVED when the upstream fact that
 * justified it is gone — an overtime claim rejected after a first calculation
 * must not keep being paid.
 *
 * Manual inputs are never touched. Somebody typed those, and a recalculation
 * that quietly deleted a hand-entered PCB figure would be the worst kind of
 * helpful.
 */
export interface ExistingInput {
  id: string;
  componentCode: string;
  source: PayrollInputSource;
  amountCents: number;
  sourceRecordId: string | null;
}

export interface MaterialisationPlan {
  create: MaterialisedInput[];
  update: { id: string; input: MaterialisedInput }[];
  /** Ids of derived inputs whose upstream fact no longer exists. */
  remove: string[];
  unchanged: number;
}

const DERIVED_SOURCES: PayrollInputSource[] = ['ATTENDANCE', 'LEAVE', 'INCENTIVE', 'CLAIM'];

/**
 * The identity of a materialised input is the component it is an instance of
 * AND the upstream row behind it — not the component alone. Two approved claims
 * in one month are two inputs, and matching them on component code would make
 * the second one overwrite the first.
 */
function identity(componentCode: string, sourceRecordId: string | null): string {
  return `${componentCode}::${sourceRecordId ?? ''}`;
}

export function planMaterialisation(
  desired: MaterialisedInput[],
  existing: ExistingInput[],
): MaterialisationPlan {
  const plan: MaterialisationPlan = { create: [], update: [], remove: [], unchanged: 0 };

  const existingDerived = new Map<string, ExistingInput>();
  for (const row of existing) {
    // MANUAL inputs are never touched. Somebody typed those, and a
    // recalculation that quietly deleted a hand-entered PCB figure would be the
    // worst kind of helpful.
    if (!DERIVED_SOURCES.includes(row.source)) continue;
    existingDerived.set(identity(row.componentCode, row.sourceRecordId), row);
  }

  const matched = new Set<string>();
  for (const want of desired) {
    const found = existingDerived.get(identity(want.componentCode, want.sourceRecordId));
    if (!found) {
      plan.create.push(want);
      continue;
    }
    matched.add(found.id);
    if (found.amountCents !== want.amountCents) {
      plan.update.push({ id: found.id, input: want });
    } else {
      plan.unchanged += 1;
    }
  }

  for (const row of existingDerived.values()) {
    if (!matched.has(row.id)) plan.remove.push(row.id);
  }

  return plan;
}
