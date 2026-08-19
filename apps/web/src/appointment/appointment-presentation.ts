import {
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUS_TONE,
  AppointmentStatus,
  type StatusTone,
} from '@kuwick/shared';

/**
 * HOW AN APPOINTMENT IS WORDED AND TONED, in one place.
 *
 * The mapping lives in `@kuwick/shared` so the enum and its presentation stay
 * together; this is the thin adapter every screen uses, so a status added to
 * the enum cannot appear on one screen as "CHECKED_IN" and on another as
 * "Checked in".
 */
export function statusChip(status: string): { tone: StatusTone; label: string } {
  const known = status as AppointmentStatus;
  return {
    tone: APPOINTMENT_STATUS_TONE[known] ?? 'neutral',
    // A status the browser has never heard of still renders — as itself,
    // tidied — rather than as an empty chip.
    label: APPOINTMENT_STATUS_LABEL[known] ?? sentence(status),
  };
}

export const PAYMENT_LABEL: Record<string, string> = {
  NOT_REQUIRED: 'No booking fee',
  PENDING: 'Deposit due',
  PAID: 'Deposit paid',
  PARTIALLY_PAID: 'Part paid',
  FAILED: 'Payment failed',
  REFUNDED: 'Refunded',
};

export const PAYMENT_TONE: Record<string, StatusTone> = {
  NOT_REQUIRED: 'neutral',
  PENDING: 'attention',
  PAID: 'success',
  PARTIALLY_PAID: 'attention',
  FAILED: 'error',
  REFUNDED: 'neutral',
};

export function paymentChip(state: string): { tone: StatusTone; label: string } {
  return {
    tone: PAYMENT_TONE[state] ?? 'neutral',
    label: PAYMENT_LABEL[state] ?? sentence(state),
  };
}

/** SCREAMING_CASE → "Screaming case". */
export function sentence(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
