import dayjs from 'dayjs';
import { VisitHistorySummary } from '../types';

/**
 * G4 (D-067) — how a previous visit reads on a collapsed card.
 *
 * Every function here returns `null` when the underlying field was never
 * recorded, and the card renders nothing for a null. That is the rule the
 * brief sets and the one that matters clinically: a blank "MC:" label reads
 * as "we checked and there wasn't one", which is a different claim from "we
 * have no record either way". Nothing here infers, defaults or backfills.
 */

export function visitDateLabel(checkInAt: string): string {
  return dayjs(checkInAt).format('D MMM YYYY');
}

export function visitTimeLabel(checkInAt: string): string {
  return dayjs(checkInAt).format('HH:mm');
}

/** "Dengue fever (A90)" — plus "+2 more" handled separately by the card. */
export function diagnosisLabel(summary: VisitHistorySummary): string | null {
  const primary = summary.primaryDiagnosis;
  if (!primary) {
    return null;
  }
  return primary.icd10Code ? `${primary.name} (${primary.icd10Code})` : primary.name;
}

/**
 * How many further diagnoses were recorded beyond the one on the card.
 * Zero means "there are no others", which is why it returns 0 and not null.
 */
export function additionalDiagnosisCount(summary: VisitHistorySummary): number {
  return Math.max(summary.diagnosisCount - (summary.primaryDiagnosis ? 1 : 0), 0);
}

/** "Amoxicillin 500", "Paracetamol" — strength only where the item stores one. */
export function medicationLabels(summary: VisitHistorySummary): string[] {
  return summary.medications.map((m) => (m.strength ? `${m.name} ${m.strength}` : m.name));
}

export function additionalMedicationCount(summary: VisitHistorySummary): number {
  return Math.max(summary.medicationCount - summary.medications.length, 0);
}

/**
 * Inclusive day count for an MC, the way a clinic counts it: 1–2 May is two
 * days off, not one. Returns null unless BOTH dates are stored — a one-sided
 * range cannot be counted honestly.
 */
export function mcDayCount(mc: { startDate: string | null; endDate: string | null }): number | null {
  if (!mc.startDate || !mc.endDate) {
    return null;
  }
  const days = dayjs(mc.endDate).startOf('day').diff(dayjs(mc.startDate).startOf('day'), 'day') + 1;
  return days > 0 ? days : null;
}

/** "MC · 2 days · 1–2 May 2026", degrading to whatever is actually stored. */
export function mcLabel(summary: VisitHistorySummary): string | null {
  const mc = summary.mc;
  if (!mc) {
    return null;
  }
  const parts = ['MC'];
  const days = mcDayCount(mc);
  if (days !== null) {
    parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  }
  if (mc.startDate && mc.endDate) {
    const start = dayjs(mc.startDate);
    const end = dayjs(mc.endDate);
    parts.push(
      start.isSame(end, 'month')
        ? `${start.format('D')}–${end.format('D MMM YYYY')}`
        : `${start.format('D MMM')} – ${end.format('D MMM YYYY')}`,
    );
  } else if (mc.startDate) {
    parts.push(`from ${dayjs(mc.startDate).format('D MMM YYYY')}`);
  }
  return parts.join(' · ');
}

/** "Referral · HKL Orthopaedics", or just "Referral" when nobody was named. */
export function referralLabel(summary: VisitHistorySummary): string | null {
  const referral = summary.referral;
  if (!referral) {
    return null;
  }
  const to = referral.referredTo ?? referral.title;
  return to ? `Referral · ${to}` : 'Referral';
}

export interface ContextChip {
  label: string;
  value: string;
}

/**
 * Optional secondary context — branch, billing, queue source. Only chips
 * whose data genuinely exists are returned, so the card never shows a label
 * with an em dash after it.
 */
export function contextChips(summary: VisitHistorySummary): ContextChip[] {
  const chips: ContextChip[] = [];
  if (summary.clinicName) {
    chips.push({ label: 'Branch', value: summary.clinicName });
  }
  if (summary.billingType) {
    chips.push({ label: 'Billing', value: summary.billingType });
  }
  if (summary.queueType) {
    chips.push({ label: 'Source', value: QUEUE_TYPE_LABEL[summary.queueType] ?? summary.queueType });
  }
  if (summary.queueNumber !== null) {
    chips.push({ label: 'Queue', value: String(summary.queueNumber) });
  }
  return chips;
}

const QUEUE_TYPE_LABEL: Record<string, string> = {
  APPOINTMENT: 'Appointment',
  WALK_IN: 'Walk-in',
  OTC: 'Over the counter',
  EMERGENCY: 'Emergency',
};

/**
 * A visit with no clinical content recorded at all. Shown as an explicit
 * "nothing was recorded" line rather than a card that looks broken — and it
 * is NOT the same as legacy data that exists but is unattributed.
 */
export function hasNoClinicalSummary(summary: VisitHistorySummary): boolean {
  return (
    summary.diagnosisCount === 0 &&
    summary.medicationCount === 0 &&
    summary.documentCount === 0 &&
    !summary.presentingComplaint
  );
}
