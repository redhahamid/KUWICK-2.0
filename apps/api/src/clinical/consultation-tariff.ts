import {
  InvoiceStatus,
  QueueTicketStatus,
  QueueType,
  VisitClassification,
  VisitWorkflowEventType,
} from '@prisma/client';
import { ClinicalTx } from './clinical-actor';

/**
 * G4.5d3c-3b2 (D-094) — CONSULTATION TARIFF RESOLUTION.
 *
 * Answers one question, entirely server-side: what is this visit's
 * consultation-charge situation right now? The browser renders the answer;
 * it never re-derives it.
 *
 * TIME. The tariff is matched against the START OF THE ACTUAL CONSULTATION,
 * never against when the invoice was opened, when Billing Review loaded, when
 * payment happened, or the current clock. The timestamp source, in order:
 *
 *   1. the visit's earliest CONSULTATION_STARTED workflow event (written
 *      transactionally by the WAITING -> IN_CONSULTATION queue transition
 *      since this checkpoint);
 *   2. for tickets that reached consultation before that event existed:
 *      QueueTicket.calledAt (the stored call-in moment);
 *   3. for ticketless visits (a doctor-initiated follow-up record) and as the
 *      final stored fallback: Visit.checkInAt.
 *
 * All three are STORED timestamps fixed before billing ever opens.
 *
 * TIMEZONE. Bands are clinic-local wall-clock. The instant is converted using
 * the clinic's stored IANA timezone (Clinic.timezone, default
 * Asia/Kuala_Lumpur) via Intl — a real conversion of a real UTC instant. The
 * appointment module's "local-time-in-UTC-getters" simplification is NOT
 * reused here: these are genuine event timestamps, not schedule templates.
 *
 * CONFIGURATION OFF. A clinic with no active tariff rules has consultation
 * auto-billing OFF: state NOT_CONFIGURED, no worklist row, no blocker. An
 * existing tenant's behaviour does not change until it configures a tariff.
 */

// Ticket states at or beyond the consultation room — proof a consultation
// happened even for tickets that predate the CONSULTATION_STARTED event.
const REACHED_CONSULTATION: QueueTicketStatus[] = [
  QueueTicketStatus.IN_CONSULTATION,
  QueueTicketStatus.AT_PROCEDURE,
  QueueTicketStatus.READY_FOR_DISPENSARY,
  QueueTicketStatus.READY_FOR_PAYMENT,
  QueueTicketStatus.DISPENSARY_PAYMENT,
  QueueTicketStatus.COMPLETED,
];

export interface TariffRuleForMatching {
  id: string;
  classification: VisitClassification;
  startTime: string;
  endTime: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  createdAt: Date;
  serviceCatalog: { id: string; name: string; active: boolean };
}

export type ConsultationChargeState =
  | { kind: 'NOT_CONFIGURED' }
  | { kind: 'NOT_APPLICABLE' }
  | { kind: 'BILLED'; invoiceLineId: string; description: string }
  | { kind: 'WAIVED'; invoiceLineId: string; description: string }
  | { kind: 'EXEMPT'; classification: VisitClassification }
  | { kind: 'TARIFF_REVIEW'; reason: string }
  | {
      kind: 'READY';
      rule: TariffRuleForMatching;
      service: { id: string; name: string };
      consultationStartAt: Date;
    };

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" -> minutes since local midnight. Throws on malformed input. */
export function parseTimeOfDay(value: string): number {
  const match = TIME_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Not a valid HH:MM time of day: ${value}`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isValidTimeOfDay(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/**
 * Inclusive at both ends. start > end means the band crosses midnight:
 * "23:00"–"07:59" covers 23:00.. and ..07:59.
 */
export function isWithinBand(minuteOfDay: number, startTime: string, endTime: string): boolean {
  const start = parseTimeOfDay(startTime);
  const end = parseTimeOfDay(endTime);
  if (start <= end) {
    return minuteOfDay >= start && minuteOfDay <= end;
  }
  return minuteOfDay >= start || minuteOfDay <= end;
}

function bandLengthMinutes(startTime: string, endTime: string): number {
  const start = parseTimeOfDay(startTime);
  const end = parseTimeOfDay(endTime);
  return start <= end ? end - start : 1440 - start + end;
}

/** The instant's wall-clock minutes-of-day in the given IANA timezone. */
export function localMinutesOfDay(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/** The instant's local calendar date as a comparable 'YYYY-MM-DD'. */
export function localDateKey(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Deterministic match: active rules for the classification whose effective
 * window covers the consultation's local DATE and whose band covers its local
 * TIME. Where bands overlap, the NARROWEST band wins (a tight night band
 * beats an all-day catch-all), oldest rule as the tiebreak — a stable answer,
 * never an arbitrary one.
 */
export function matchTariffRule(
  rules: TariffRuleForMatching[],
  params: { instant: Date; timeZone: string; classification: VisitClassification },
): TariffRuleForMatching | null {
  const minute = localMinutesOfDay(params.instant, params.timeZone);
  const dateKey = localDateKey(params.instant, params.timeZone);
  const candidates = rules.filter((rule) => {
    if (rule.classification !== params.classification) return false;
    if (rule.effectiveFrom && dateKey < localDateKey(rule.effectiveFrom, params.timeZone)) return false;
    if (rule.effectiveTo && dateKey > localDateKey(rule.effectiveTo, params.timeZone)) return false;
    return isWithinBand(minute, rule.startTime, rule.endTime);
  });
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => {
    const width = bandLengthMinutes(a.startTime, a.endTime) - bandLengthMinutes(b.startTime, b.endTime);
    if (width !== 0) return width;
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0];
}

/**
 * The visit's operational classification: an explicit value set by counter
 * staff wins; otherwise an OTC-queue visit is OTC_ONLY and everything else is
 * a CONSULTATION. Never inferred from diagnosis or note text.
 */
export function classifyVisit(
  visit: { classification: VisitClassification | null },
  queueType: QueueType | null,
): VisitClassification {
  if (visit.classification) return visit.classification;
  return queueType === QueueType.OTC ? VisitClassification.OTC_ONLY : VisitClassification.CONSULTATION;
}

export async function resolveConsultationState(tx: ClinicalTx, visitId: string): Promise<ConsultationChargeState> {
  const visit = await tx.visit.findUnique({
    where: { id: visitId },
    select: {
      id: true,
      clinicId: true,
      classification: true,
      checkInAt: true,
      clinic: { select: { timezone: true } },
      queueTicket: { select: { queueType: true, status: true, calledAt: true } },
    },
  });
  if (!visit) {
    return { kind: 'NOT_APPLICABLE' };
  }

  const rules = await tx.consultationTariffRule.findMany({
    where: { clinicId: visit.clinicId, active: true },
    select: {
      id: true,
      classification: true,
      startTime: true,
      endTime: true,
      effectiveFrom: true,
      effectiveTo: true,
      createdAt: true,
      serviceCatalog: { select: { id: true, name: true, active: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (rules.length === 0) {
    return { kind: 'NOT_CONFIGURED' };
  }

  // One ACTIVE consultation line per visit, across all its invoices.
  const consultationLines = await tx.invoiceLine.findMany({
    where: {
      sourceConsultationVisitId: visitId,
      invoice: { status: { not: InvoiceStatus.CANCELLED } },
    },
    select: { id: true, description: true, cancelledAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const activeLine = consultationLines.find((line) => !line.cancelledAt);
  if (activeLine) {
    return { kind: 'BILLED', invoiceLineId: activeLine.id, description: activeLine.description };
  }

  // Did a consultation actually happen, and when did it start?
  const startEvent = await tx.visitWorkflowEvent.findFirst({
    where: { visitId, eventType: VisitWorkflowEventType.CONSULTATION_STARTED },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  const ticket = visit.queueTicket;
  const occurred =
    startEvent != null ||
    (ticket ? REACHED_CONSULTATION.includes(ticket.status) : true); // a ticketless visit IS a consultation record
  if (!occurred) {
    return { kind: 'NOT_APPLICABLE' };
  }
  const consultationStartAt = startEvent?.createdAt ?? ticket?.calledAt ?? visit.checkInAt;

  // A cancelled consultation line means an explicit waiver — never silently
  // re-added; an authorised explicit re-add is the only way back.
  const waived = consultationLines.find((line) => line.cancelledAt);
  if (waived) {
    return { kind: 'WAIVED', invoiceLineId: waived.id, description: waived.description };
  }

  const classification = classifyVisit(visit, ticket?.queueType ?? null);
  const rulesForClassification = rules.filter((rule) => rule.classification === classification);
  if (rulesForClassification.length === 0) {
    if (classification !== VisitClassification.CONSULTATION) {
      // The clinic charges no consultation fee for this kind of visit.
      return { kind: 'EXEMPT', classification };
    }
    return { kind: 'TARIFF_REVIEW', reason: 'No consultation tariff is configured for consultation visits.' };
  }

  const timeZone = visit.clinic?.timezone ?? 'Asia/Kuala_Lumpur';
  const matched = matchTariffRule(rulesForClassification, {
    instant: consultationStartAt,
    timeZone,
    classification,
  });
  if (!matched) {
    return {
      kind: 'TARIFF_REVIEW',
      reason: 'No consultation tariff covers the time this consultation started.',
    };
  }
  if (!matched.serviceCatalog.active) {
    return {
      kind: 'TARIFF_REVIEW',
      reason: 'The consultation service selected by the tariff is inactive.',
    };
  }
  return {
    kind: 'READY',
    rule: matched,
    service: { id: matched.serviceCatalog.id, name: matched.serviceCatalog.name },
    consultationStartAt,
  };
}

/**
 * Explicit-add resolution (owner decision 9 and test 64/65): for an EXEMPT
 * visit where a real consultation did occur, or after a waiver, authorised
 * staff may add the charge deliberately. Still rule-driven: the visit's own
 * classification's rules first, the general CONSULTATION rules as fallback —
 * never a guessed price. Returns READY or TARIFF_REVIEW.
 */
export async function resolveExplicitConsultationAdd(
  tx: ClinicalTx,
  visitId: string,
): Promise<ConsultationChargeState> {
  const state = await resolveConsultationState(tx, visitId);
  if (state.kind !== 'EXEMPT' && state.kind !== 'WAIVED') {
    return state;
  }
  // Re-run the match as if the visit were a plain consultation.
  const visit = await tx.visit.findUnique({
    where: { id: visitId },
    select: {
      clinicId: true,
      checkInAt: true,
      clinic: { select: { timezone: true } },
      queueTicket: { select: { status: true, calledAt: true } },
    },
  });
  if (!visit) return { kind: 'NOT_APPLICABLE' };
  const rules = await tx.consultationTariffRule.findMany({
    where: { clinicId: visit.clinicId, active: true, classification: VisitClassification.CONSULTATION },
    select: {
      id: true,
      classification: true,
      startTime: true,
      endTime: true,
      effectiveFrom: true,
      effectiveTo: true,
      createdAt: true,
      serviceCatalog: { select: { id: true, name: true, active: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const startEvent = await tx.visitWorkflowEvent.findFirst({
    where: { visitId, eventType: VisitWorkflowEventType.CONSULTATION_STARTED },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  const consultationStartAt = startEvent?.createdAt ?? visit.queueTicket?.calledAt ?? visit.checkInAt;
  const timeZone = visit.clinic?.timezone ?? 'Asia/Kuala_Lumpur';
  const matched = matchTariffRule(rules, {
    instant: consultationStartAt,
    timeZone,
    classification: VisitClassification.CONSULTATION,
  });
  if (!matched || !matched.serviceCatalog.active) {
    return {
      kind: 'TARIFF_REVIEW',
      reason: 'No consultation tariff covers the time this consultation started.',
    };
  }
  return {
    kind: 'READY',
    rule: matched,
    service: { id: matched.serviceCatalog.id, name: matched.serviceCatalog.name },
    consultationStartAt,
  };
}
