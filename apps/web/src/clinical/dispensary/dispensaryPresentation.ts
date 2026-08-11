import { StatusTone } from '../../design-system/tokens';

/**
 * G4.5d5b-3 — how the dispensary describes itself.
 *
 * Pure. Every rule the workspace branches on lives here so it can be tested
 * without a DOM, and so the wording a dispenser reads is reviewable in one
 * file rather than scattered across JSX.
 */

export type StockState = 'IN_STOCK' | 'LOW_STOCK' | 'INSUFFICIENT' | 'OUT_OF_STOCK' | 'UNIT_UNKNOWN';

export interface StockPresentation {
  tone: StatusTone;
  label: string;
  /** The numbers, in words. Never a bare figure with an implied unit. */
  detail: string;
}

/**
 * Stock, said honestly.
 *
 * `UNIT_UNKNOWN` is the case worth reading twice. There is no unit-conversion
 * model in the product: a prescription's dose × frequency × duration cannot be
 * turned into bottles or millilitres, and `Prescription.quantity` is only a
 * stock-unit quantity where the item is counted in the same units it is
 * dispensed in. Where that does not hold, the answer is that the units cannot
 * be compared — not a confident number a dispenser would act on.
 */
export function stockPresentation(params: {
  state: StockState;
  onHand: number | null;
  required: number;
}): StockPresentation {
  const { state, onHand, required } = params;
  switch (state) {
    case 'IN_STOCK':
      return { tone: 'success', label: 'In stock', detail: `${onHand} available` };
    case 'LOW_STOCK':
      return { tone: 'attention', label: 'Low stock', detail: `${onHand} available` };
    case 'INSUFFICIENT':
      return {
        tone: 'error',
        label: 'Insufficient stock',
        detail: `${onHand} available · requires ${required}`,
      };
    case 'OUT_OF_STOCK':
      return { tone: 'error', label: 'Out of stock', detail: '0 available' };
    case 'UNIT_UNKNOWN':
    default:
      return {
        tone: 'neutral',
        label: 'Unit needs review',
        detail: 'Stock and prescription units cannot be compared safely',
      };
  }
}

/** Whether dispensing this row needs an explicit shortage acknowledgement. */
export function needsStockAcknowledgement(state: StockState): boolean {
  return state === 'INSUFFICIENT' || state === 'OUT_OF_STOCK';
}

export interface MedicationLike {
  status: string;
  stock: { state: StockState };
}

/** Only an ORDERED clinic-supplied row can be dispensed. */
export function isDispensable(medication: MedicationLike): boolean {
  return medication.status === 'ORDERED';
}

export function dispenseStatusPresentation(status: string): { tone: StatusTone; label: string } {
  if (status === 'DISPENSED') return { tone: 'success', label: 'Dispensed' };
  if (status === 'CANCELLED') return { tone: 'neutral', label: 'Cancelled' };
  return { tone: 'active', label: 'To dispense' };
}

/** "2 of 5 dispensed · 3 remaining" — progress a dispenser can read at a glance. */
export function progressText(counts: { total: number; dispensed: number; remaining: number }): string {
  if (counts.total === 0) return 'No clinic medication';
  if (counts.remaining === 0) return `All ${counts.total} dispensed`;
  return `${counts.dispensed} of ${counts.total} dispensed · ${counts.remaining} remaining`;
}

/**
 * How long the patient has been waiting.
 *
 * Returns null rather than "0m" when the timestamp is unusable: an invented
 * waiting time on a busy board is worse than an absent one, because staff
 * order their work by it.
 */
export function waitingText(checkInAt: string | Date | null | undefined, now = new Date()): string | null {
  if (!checkInAt) return null;
  const start = new Date(checkInAt).getTime();
  if (!Number.isFinite(start)) return null;
  const minutes = Math.floor((now.getTime() - start) / 60000);
  if (minutes < 0) return null;
  if (minutes < 60) return `${minutes}m waiting`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m waiting`;
}

/** The result summary after a batch: "2 dispensed · 1 already dispensed". */
export function dispenseSummaryText(summary: {
  dispensed: number;
  alreadyDispensed: number;
  failed: number;
}): string {
  const parts: string[] = [];
  if (summary.dispensed > 0) parts.push(`${summary.dispensed} dispensed`);
  if (summary.alreadyDispensed > 0) parts.push(`${summary.alreadyDispensed} already dispensed`);
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  return parts.length > 0 ? parts.join(' · ') : 'Nothing was dispensed';
}

export const OUTCOME_TONE: Record<string, StatusTone> = {
  DISPENSED: 'success',
  STOCK_WARNING_ACKNOWLEDGED: 'attention',
  ALREADY_DISPENSED: 'neutral',
  NO_LONGER_ELIGIBLE: 'attention',
  PERMISSION_DENIED: 'error',
  FAILED: 'error',
};

export const OUTCOME_LABEL: Record<string, string> = {
  DISPENSED: 'Dispensed',
  STOCK_WARNING_ACKNOWLEDGED: 'Dispensed with a stock shortage',
  ALREADY_DISPENSED: 'Already dispensed',
  NO_LONGER_ELIGIBLE: 'No longer eligible',
  PERMISSION_DENIED: 'Not permitted',
  FAILED: 'Not dispensed',
};

/** Empty states, worded for the person reading them at the counter. */
export const EMPTY_BOARD_TEXT = 'No patients are waiting for clinic dispensing.';
export const VISIT_MOVED_TEXT = 'This visit has moved to another stage.';
