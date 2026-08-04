import { InvoiceDiscountType, PanelCopaymentType, PanelCoverageType } from '@prisma/client';

/**
 * G4.5d3c-3b1 (D-093) — the responsibility engine. PURE: no I/O, no clock,
 * no Prisma. Every ringgit the clinic tells a patient or a panel they owe
 * comes out of this function, so it is exhaustively testable without a
 * database and its order of operations is written once, here.
 *
 * ORDER (owner-approved):
 *   1. active lines (cancelled lines do not exist financially)
 *   2. line discounts → discounted line totals
 *   3. covered vs excluded split
 *   4. visit-limit cap on the covered total
 *   5. copayment (NONE / FIXED / PERCENTAGE — percentage of the post-limit
 *      covered amount, never of excluded items)
 *   6. overall invoice discount — v1 policy AFTER_PANEL_SPLIT_PATIENT_ONLY:
 *      it reduces ONLY the patient-responsible portion; the panel's
 *      contractual receivable is untouched. (The policy is an explicit input
 *      so a later contract-specific policy is a new branch, not a rewrite.)
 *   7. per-line allocation — proportional, residue to the final line — so
 *      line sums EXACTLY equal invoice sums.
 *
 * INVARIANTS (asserted by tests on every case):
 *   totalAmount = panelResponsibility + patientResponsibility
 *   Σ line panel = invoice panel;  Σ line patient = invoice patient
 *   remaining patient balance = max(patientResponsibility − paid, 0)
 *
 * UNRESOLVED BENEFIT: a panel visit whose terms are not verified/overridden
 * yields responsibility = null everywhere. NULL is "not established" — the
 * engine never guesses, never assumes unlimited coverage.
 */

export type OverallDiscountPolicy = 'AFTER_PANEL_SPLIT_PATIENT_ONLY';

export interface EngineLine {
  id: string;
  /** quantity × unitPrice, pre-discount. */
  amount: number;
  excludedFromPanel: boolean;
  cancelled: boolean;
  lineDiscountType: InvoiceDiscountType | null;
  lineDiscountValue: number | null;
}

export type BenefitInput =
  | { kind: 'CASH' }
  | { kind: 'PANEL_UNRESOLVED' }
  | {
      kind: 'PANEL_RESOLVED';
      coverageType: PanelCoverageType;
      visitLimitAmount: number | null;
      copaymentType: PanelCopaymentType;
      copaymentValue: number | null;
    };

export interface EngineInput {
  lines: EngineLine[];
  invoiceDiscountType: InvoiceDiscountType | null;
  invoiceDiscountValue: number | null;
  benefit: BenefitInput;
  policy?: OverallDiscountPolicy;
}

export interface LineResult {
  id: string;
  lineDiscountAmount: number | null;
  /** null when responsibility is unresolved. */
  panelResponsibilityAmount: number | null;
  patientResponsibilityAmount: number | null;
}

export interface EngineResult {
  resolved: boolean;
  subtotalAmount: number;
  invoiceDiscountAmount: number | null;
  totalAmount: number;
  panelResponsibilityAmount: number | null;
  patientResponsibilityAmount: number | null;
  lines: LineResult[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function lineDiscountAmount(line: EngineLine): number {
  if (!line.lineDiscountType || line.lineDiscountValue == null) return 0;
  const raw =
    line.lineDiscountType === InvoiceDiscountType.PERCENTAGE
      ? (line.amount * line.lineDiscountValue) / 100
      : line.lineDiscountValue;
  // Guard, not an error path: the write side refuses oversized discounts,
  // and the engine independently refuses to produce a negative line.
  return round2(Math.min(Math.max(raw, 0), line.amount));
}

/**
 * Allocate `total` across `weights` proportionally, in cents, with the
 * rounding residue assigned to the FINAL entry — deterministic, and the
 * shares always sum exactly to `total`.
 */
function allocateProportionally(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (weightSum <= 0 || total <= 0) return weights.map(() => 0);
  const shares = weights.map((w) => round2((total * w) / weightSum));
  const allocated = round2(shares.reduce((sum, v) => sum + v, 0));
  const residue = round2(total - allocated);
  if (residue !== 0) {
    // Last entry with a positive weight takes the residue.
    for (let i = shares.length - 1; i >= 0; i -= 1) {
      if (weights[i] > 0) {
        shares[i] = round2(shares[i] + residue);
        break;
      }
    }
  }
  return shares;
}

export function calculateResponsibility(input: EngineInput): EngineResult {
  const active = input.lines.filter((line) => !line.cancelled);
  const discounts = new Map(active.map((line) => [line.id, lineDiscountAmount(line)]));
  const finalOf = (line: EngineLine) => round2(line.amount - (discounts.get(line.id) ?? 0));

  const subtotalAmount = round2(active.reduce((sum, line) => sum + line.amount, 0));
  const afterLineDiscounts = round2(active.reduce((sum, line) => sum + finalOf(line), 0));

  const baseLineResult = (line: EngineLine): LineResult => ({
    id: line.id,
    lineDiscountAmount: line.lineDiscountType ? (discounts.get(line.id) ?? 0) : null,
    panelResponsibilityAmount: null,
    patientResponsibilityAmount: null,
  });
  const cancelledResults: LineResult[] = input.lines
    .filter((line) => line.cancelled)
    .map((line) => ({
      id: line.id,
      lineDiscountAmount: null,
      panelResponsibilityAmount: null,
      patientResponsibilityAmount: null,
    }));

  // --- Unresolved panel: totals exist, responsibility does not. -----------
  if (input.benefit.kind === 'PANEL_UNRESOLVED') {
    return {
      resolved: false,
      subtotalAmount,
      // An overall discount is patient-portion-only under the v1 policy and
      // the patient portion is unknown here; the write side refuses to apply
      // one, so none can be present. Reported null, never guessed.
      invoiceDiscountAmount: null,
      totalAmount: afterLineDiscounts,
      panelResponsibilityAmount: null,
      patientResponsibilityAmount: null,
      lines: [...active.map(baseLineResult), ...cancelledResults],
    };
  }

  // --- Panel split (CASH is the degenerate case: everything patient). ------
  let panelTotal = 0;
  let patientBeforeOverall = afterLineDiscounts;
  let panelShares = new Map<string, number>();

  if (input.benefit.kind === 'PANEL_RESOLVED') {
    const covered = active.filter((line) => !line.excludedFromPanel);
    const eligible = round2(covered.reduce((sum, line) => sum + finalOf(line), 0));
    const excludedTotal = round2(afterLineDiscounts - eligible);

    const cap =
      input.benefit.coverageType === PanelCoverageType.VISIT_LIMIT
        ? round2(Math.min(eligible, input.benefit.visitLimitAmount ?? 0))
        : eligible;

    let copay = 0;
    if (input.benefit.copaymentType === PanelCopaymentType.FIXED_AMOUNT) {
      copay = round2(Math.min(input.benefit.copaymentValue ?? 0, cap));
    } else if (input.benefit.copaymentType === PanelCopaymentType.PERCENTAGE) {
      // Owner rule: percentage of the eligible covered amount AFTER
      // exclusions and AFTER the visit-limit cap. Never of excluded items.
      copay = round2((cap * (input.benefit.copaymentValue ?? 0)) / 100);
    }

    panelTotal = round2(cap - copay);
    patientBeforeOverall = round2(eligible - panelTotal + excludedTotal);

    // Per-line panel allocation: proportional across covered lines.
    const coveredFinals = covered.map(finalOf);
    const shares = allocateProportionally(panelTotal, coveredFinals);
    panelShares = new Map(covered.map((line, i) => [line.id, shares[i]]));
  }

  // --- Overall discount: AFTER the split, patient portion only. ------------
  let invoiceDiscountAmount: number | null = null;
  if (input.invoiceDiscountType && input.invoiceDiscountValue != null) {
    const raw =
      input.invoiceDiscountType === InvoiceDiscountType.PERCENTAGE
        ? (patientBeforeOverall * input.invoiceDiscountValue) / 100
        : input.invoiceDiscountValue;
    invoiceDiscountAmount = round2(Math.min(Math.max(raw, 0), patientBeforeOverall));
  }
  const patientTotal = round2(patientBeforeOverall - (invoiceDiscountAmount ?? 0));

  // --- Per-line patient shares, scaled so sums match the invoice exactly. --
  const patientWeights = active.map((line) => round2(finalOf(line) - (panelShares.get(line.id) ?? 0)));
  const patientLineShares = allocateProportionally(patientTotal, patientWeights);

  const lines: LineResult[] = active.map((line, i) => ({
    id: line.id,
    lineDiscountAmount: line.lineDiscountType ? (discounts.get(line.id) ?? 0) : null,
    panelResponsibilityAmount: panelShares.get(line.id) ?? 0,
    patientResponsibilityAmount: patientLineShares[i],
  }));

  return {
    resolved: true,
    subtotalAmount,
    invoiceDiscountAmount,
    totalAmount: round2(panelTotal + patientTotal),
    panelResponsibilityAmount: panelTotal,
    patientResponsibilityAmount: patientTotal,
    lines: [...lines, ...cancelledResults],
  };
}

/** The published balance rule — one implementation, used by reads and pay(). */
export function remainingPatientBalance(
  patientResponsibilityAmount: number | null,
  patientPaidAmount: number,
): number | null {
  if (patientResponsibilityAmount == null) return null;
  return round2(Math.max(patientResponsibilityAmount - patientPaidAmount, 0));
}
