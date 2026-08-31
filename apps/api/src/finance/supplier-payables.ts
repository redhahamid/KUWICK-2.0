/**
 * THE SUPPLIER PAYABLE INVARIANTS.
 *
 * Pure functions over plain inputs: no Prisma, no clock, no tenant — the same
 * discipline as `financial-invariants.ts`, because the failure mode is the
 * same. The clinic's own payable workbook is the cautionary tale: its
 * `TOTAL PAYABLE` roll-up computes each supplier's balance as
 * `SUM('<supplier>'!I…)`, and on the supplier sheets column **I is the payment
 * DATE** — the balance is column J. The headline "what we owe" figure is built
 * from dates (`docs/STOCK_LEGACY_WORKFLOW_AUDIT.md` §5, finding S-1).
 *
 * That is exactly what happens when the same number is added up in two places.
 * Here it is added up in one.
 *
 * ALL AMOUNTS ARE CENTS. See money.ts for why.
 */

import { MoneyLike, clampAtZero, toCents } from './money';

export type SupplierInvoiceStatusLike = 'OPEN' | 'PAID' | 'DISPUTED' | 'CANCELLED';

export interface SupplierInvoiceFacts {
  totalAmount: MoneyLike;
  /** Sum of the payments allocated to this invoice. Derived, never typed. */
  allocatedAmount?: MoneyLike;
  status?: SupplierInvoiceStatusLike;
  /** Day-precision. NULL when the supplier's payment term is not configured. */
  dueDate?: Date | string | null;
}

export interface SupplierInvoiceBalance {
  totalCents: number;
  paidCents: number;
  /** What is still owed. Never negative — an overpayment is a credit, not a debt. */
  balanceCents: number;
  /** Paid beyond the invoice. Never negative. The mirror of `balanceCents`. */
  overpaidCents: number;
  settled: boolean;
  /**
   * TRUE only when there is a due date, it has passed, and the invoice is still
   * owed. A disputed invoice is NOT overdue: it is being argued about, and
   * listing it in "must pay this week" is how a clinic pays a bill it had
   * already refused.
   */
  overdue: boolean;
  /**
   * Days until due — negative once past. NULL when no term is configured, which
   * is the honest answer to "when must I pay this" if nobody has said.
   */
  daysUntilDue: number | null;
}

const DAY_MS = 86_400_000;

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

export function computeSupplierInvoiceBalance(
  invoice: SupplierInvoiceFacts,
  asOf: Date = new Date(),
): SupplierInvoiceBalance {
  const totalCents = toCents(invoice.totalAmount);
  const paidCents = toCents(invoice.allocatedAmount ?? 0);
  const status = invoice.status ?? 'OPEN';
  // A cancelled invoice owes nothing, whatever its face value says. It is kept
  // rather than deleted because it may already have been paid against.
  const raw = status === 'CANCELLED' ? 0 : totalCents - paidCents;
  const due = asDate(invoice.dueDate);
  const daysUntilDue = due === null ? null : Math.ceil((due.getTime() - asOf.getTime()) / DAY_MS);

  return {
    totalCents,
    paidCents,
    balanceCents: clampAtZero(raw),
    overpaidCents: clampAtZero(-raw),
    settled: raw <= 0,
    overdue: raw > 0 && status !== 'DISPUTED' && daysUntilDue !== null && daysUntilDue < 0,
    daysUntilDue,
  };
}

export interface PayableRollUp {
  invoices: number;
  totalCents: number;
  paidCents: number;
  /** What the clinic owes. THE number the workbook gets wrong. */
  outstandingCents: number;
  /** Owed, past its due date, not disputed. */
  overdueCents: number;
  overdueInvoices: number;
  /** Owed and falling due inside the next 7 days — "what must I pay this week". */
  dueThisWeekCents: number;
  dueThisWeekInvoices: number;
  /** Owed on invoices being argued about, held out of the two figures above. */
  disputedCents: number;
  disputedInvoices: number;
  /**
   * Owed on invoices whose supplier has no payment term configured, so nothing
   * can say when they are due. Counted so the screen can name what it cannot
   * schedule, rather than quietly filing it under "not due yet".
   */
  undatedCents: number;
  undatedInvoices: number;
}

/** Same arithmetic, summed — never a second formula. */
export function rollUpPayables(invoices: SupplierInvoiceFacts[], asOf: Date = new Date()): PayableRollUp {
  const roll: PayableRollUp = {
    invoices: invoices.length,
    totalCents: 0,
    paidCents: 0,
    outstandingCents: 0,
    overdueCents: 0,
    overdueInvoices: 0,
    dueThisWeekCents: 0,
    dueThisWeekInvoices: 0,
    disputedCents: 0,
    disputedInvoices: 0,
    undatedCents: 0,
    undatedInvoices: 0,
  };

  for (const invoice of invoices) {
    const balance = computeSupplierInvoiceBalance(invoice, asOf);
    roll.totalCents += balance.totalCents;
    roll.paidCents += balance.paidCents;
    roll.outstandingCents += balance.balanceCents;
    if (balance.balanceCents === 0) continue;

    if ((invoice.status ?? 'OPEN') === 'DISPUTED') {
      roll.disputedCents += balance.balanceCents;
      roll.disputedInvoices += 1;
      continue;
    }
    if (balance.daysUntilDue === null) {
      roll.undatedCents += balance.balanceCents;
      roll.undatedInvoices += 1;
      continue;
    }
    if (balance.overdue) {
      roll.overdueCents += balance.balanceCents;
      roll.overdueInvoices += 1;
      continue;
    }
    if (balance.daysUntilDue <= 7) {
      roll.dueThisWeekCents += balance.balanceCents;
      roll.dueThisWeekInvoices += 1;
    }
  }

  return roll;
}

export type PayableAgeBucket = 'NOT_DUE' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_PLUS';

/**
 * How overdue a payable is. Aged from the DUE DATE, not the invoice date: the
 * question a supplier asks is "you are sixty days past terms", not "that
 * invoice is ninety days old".
 */
export function payableAgeBucket(daysUntilDue: number | null): PayableAgeBucket | null {
  if (daysUntilDue === null) return null;
  if (daysUntilDue >= 0) return 'NOT_DUE';
  const overdueBy = -daysUntilDue;
  if (overdueBy <= 30) return 'D1_30';
  if (overdueBy <= 60) return 'D31_60';
  if (overdueBy <= 90) return 'D61_90';
  return 'D90_PLUS';
}

export interface SupplierExposure {
  outstandingCents: number;
  creditLimitCents: number | null;
  /** Owed as a share of the limit, 0–∞. NULL when no limit is configured. */
  utilisation: number | null;
  /** TRUE only when a limit exists AND is exceeded. Unknown is never "over". */
  overLimit: boolean;
  /** Headroom left. NULL when no limit is configured; never negative. */
  headroomCents: number | null;
}

/**
 * How much of a supplier's credit line is used.
 *
 * The clinic tracks credit limits today in a free-text note on each supplier
 * sheet, where nothing can compare them to anything. This compares them — and
 * deliberately does NOT block ordering: a clinic that cannot buy medication
 * because of a stale number in a configuration screen is worse off than one
 * that gets a warning it can act on.
 */
export function supplierExposure(outstandingCents: number, creditLimit: MoneyLike | null | undefined): SupplierExposure {
  if (creditLimit === null || creditLimit === undefined) {
    return { outstandingCents, creditLimitCents: null, utilisation: null, overLimit: false, headroomCents: null };
  }
  const creditLimitCents = toCents(creditLimit);
  if (creditLimitCents <= 0) {
    return { outstandingCents, creditLimitCents, utilisation: null, overLimit: false, headroomCents: null };
  }
  return {
    outstandingCents,
    creditLimitCents,
    utilisation: Math.round((outstandingCents / creditLimitCents) * 1000) / 1000,
    overLimit: outstandingCents > creditLimitCents,
    headroomCents: clampAtZero(creditLimitCents - outstandingCents),
  };
}
