import { StatusTone } from '../../design-system/tokens';
import { StockState, needsStockAcknowledgement } from './dispensaryPresentation';

/**
 * G4.5d5c — the COUNTER, expressed as rules rather than screens.
 *
 * The UAT finding was not that any one control was wrong. It was that
 * dispensing lived in five places — a Queue tab, a workspace, a per-row
 * button, a batch button, and then a hand-off to Billing Review — so counter
 * staff had to hold Kuwick's module boundaries in their head to serve one
 * patient. This file is the other model: one patient, one screen, and two
 * INDEPENDENT obligations that the counter satisfies in whatever order the
 * clinic actually works in.
 *
 * Nothing here decides anything the server decides. Completion eligibility,
 * responsibility splitting and stock movement all remain server-authoritative;
 * these functions only decide what the counter is TOLD.
 */

// ---------------------------------------------------------------------------
// The two obligations
// ---------------------------------------------------------------------------

/** Medication is either still to hand over, or handed over. */
export type MedicationState = 'NONE_REQUIRED' | 'PENDING' | 'DISPENSED';

/**
 * Money is either not owed, owed, or settled.
 *
 * `NOT_REQUIRED` is NOT the same as `SETTLED`, and conflating them is the
 * specific error this type exists to prevent: a panel patient who owes nothing
 * has a panel receivable the clinic still has to claim. Telling the counter
 * "paid" would quietly write off money.
 */
export type PaymentState = 'NOT_REQUIRED' | 'OUTSTANDING' | 'SETTLED' | 'NO_INVOICE';

export interface CounterMedication {
  prescriptionId: string;
  status: string;
  quantity: number;
  stock: { state: StockState; onHand: number | null };
}

export function medicationState(medications: CounterMedication[]): MedicationState {
  const dispensable = medications.filter((m) => m.status === 'ORDERED');
  if (medications.length === 0) return 'NONE_REQUIRED';
  if (dispensable.length > 0) return 'PENDING';
  return 'DISPENSED';
}

export interface BillingSummary {
  grandTotal: string | null;
  panelResponsibility: string | null;
  patientResponsibility: string | null;
  remainingBalance: string | null;
  invoiceId: string | null;
  status: string | null;
}

export function paymentState(billing: BillingSummary | null): PaymentState {
  if (!billing || !billing.invoiceId) return 'NO_INVOICE';
  const payable = Number(billing.patientResponsibility ?? '0');
  const remaining = Number(billing.remainingBalance ?? '0');
  // Zero payable is "nothing to collect", never "collected".
  if (!Number.isFinite(payable) || payable <= 0) return 'NOT_REQUIRED';
  if (Number.isFinite(remaining) && remaining <= 0) return 'SETTLED';
  return 'OUTSTANDING';
}

// ---------------------------------------------------------------------------
// What the counter reads
// ---------------------------------------------------------------------------

export interface CounterLine {
  tone: StatusTone;
  done: boolean;
  label: string;
}

export function medicationLine(state: MedicationState, counts: { total: number; remaining: number }): CounterLine {
  if (state === 'NONE_REQUIRED') {
    return { tone: 'neutral', done: true, label: 'No clinic medication to hand over' };
  }
  if (state === 'DISPENSED') {
    return { tone: 'success', done: true, label: `Medications dispensed (${counts.total})` };
  }
  return {
    tone: 'attention',
    done: false,
    label: counts.remaining === 1 ? '1 medication not dispensed' : `${counts.remaining} medications not dispensed`,
  };
}

export function paymentLine(state: PaymentState, billing: BillingSummary | null): CounterLine {
  switch (state) {
    case 'SETTLED':
      return { tone: 'success', done: true, label: 'Patient payment settled' };
    case 'NOT_REQUIRED':
      return { tone: 'success', done: true, label: 'No patient payment required' };
    case 'OUTSTANDING':
      return {
        tone: 'attention',
        done: false,
        label: `Payment ${money(billing?.remainingBalance ?? billing?.patientResponsibility)} outstanding`,
      };
    case 'NO_INVOICE':
    default:
      return { tone: 'attention', done: false, label: 'No invoice raised yet' };
  }
}

/** "RM45.00" — never a bare number, never a currency the clinic does not use. */
export function money(amount: string | number | null | undefined): string {
  const value = Number(amount ?? NaN);
  if (!Number.isFinite(value)) return '—';
  return `RM${value.toFixed(2)}`;
}

/**
 * The panel receivable, stated separately and never as "paid".
 *
 * Returned only when there genuinely is one, so the counter does not read a
 * reassuring zero on a self-pay visit.
 */
export function panelReceivableLine(billing: BillingSummary | null): string | null {
  const panel = Number(billing?.panelResponsibility ?? NaN);
  if (!Number.isFinite(panel) || panel <= 0) return null;
  return `Panel receivable ${money(panel)}`;
}

// ---------------------------------------------------------------------------
// Exceptions — the only thing allowed to interrupt a normal hand-over
// ---------------------------------------------------------------------------

export interface DispenseException {
  prescriptionId: string;
  name: string;
  kind: 'STOCK_SHORTFALL';
  detail: string;
}

/**
 * A normal counter run has no exceptions and must not be interrupted.
 *
 * Only a genuine shortfall qualifies. `UNIT_UNKNOWN` deliberately does not:
 * the units cannot be compared, which is a fact the card already states, not a
 * shortage anyone can acknowledge their way out of.
 */
export function dispenseExceptions(
  medications: Array<CounterMedication & { name: string }>,
): DispenseException[] {
  return medications
    .filter((m) => m.status === 'ORDERED' && needsStockAcknowledgement(m.stock.state))
    .map((m) => ({
      prescriptionId: m.prescriptionId,
      name: m.name,
      kind: 'STOCK_SHORTFALL' as const,
      detail: `Required ${m.quantity} · system stock ${m.stock.onHand ?? 0}`,
    }));
}

// ---------------------------------------------------------------------------
// The single primary action
// ---------------------------------------------------------------------------

export type CounterStage =
  | 'CONFIRM_MEDICATIONS'
  | 'COLLECT_PAYMENT'
  | 'COMPLETE_VISIT'
  | 'BLOCKED'
  | 'DONE';

export interface PrimaryAction {
  stage: CounterStage;
  label: string;
  /** Why the counter cannot proceed. Never "disabled" with no explanation. */
  reasons: string[];
}

/**
 * What the counter should do NEXT.
 *
 * Deliberately not a fixed sequence. A clinic may take the money before the
 * medicine leaves the counter or after it, so whichever obligation is still
 * open becomes the next action, and completion is offered as soon as the
 * SERVER says nothing is outstanding.
 */
export function primaryAction(params: {
  medication: MedicationState;
  payment: PaymentState;
  serverBlockers: Array<{ code: string; message: string }>;
  completed: boolean;
}): PrimaryAction {
  if (params.completed) {
    return { stage: 'DONE', label: 'Visit completed', reasons: [] };
  }
  if (params.medication === 'PENDING') {
    return { stage: 'CONFIRM_MEDICATIONS', label: 'Confirm Medications Dispensed', reasons: [] };
  }
  if (params.payment === 'OUTSTANDING' || params.payment === 'NO_INVOICE') {
    return { stage: 'COLLECT_PAYMENT', label: 'Collect payment', reasons: [] };
  }
  // Both counter obligations are met; the server decides whether anything
  // else — a procedure still running, a clinical blocker — is outstanding.
  if (params.serverBlockers.length > 0) {
    return {
      stage: 'BLOCKED',
      label: 'Complete Visit',
      reasons: params.serverBlockers.map((b) => b.message),
    };
  }
  return { stage: 'COMPLETE_VISIT', label: 'Complete Visit', reasons: [] };
}

/** Wording for the counter-check list, in the order staff work through it. */
export const COUNTER_CHECK_EMPTY = 'Nothing outstanding at the counter.';
