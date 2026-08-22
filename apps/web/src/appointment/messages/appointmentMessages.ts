import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { formatClinicDate, formatClinicTime } from '../../clinical/clinicTime';
import { patientFacingClinicName, toWhatsappNumber } from '../whatsappReminder';

/**
 * PHASE 8 — THE ONE RENDERER.
 *
 * Every patient message the staff app produces — calendar drawer, list,
 * reminder worklist, settings preview — is rendered HERE, from a template
 * body the server stores (custom) or ships (default), against a context this
 * module builds. Nobody else concatenates message fragments, which is the
 * structural end of "your appointment at on 22 Aug":
 *
 *   - the GUARANTEED placeholders (patient, clinic, date, time, service,
 *     provider, reference) come from the appointment itself and the
 *     patient-facing name chain, so they always resolve;
 *   - the OPTIONAL ones (manage link, clinic phone) can be absent, and a
 *     LINE containing an empty placeholder is dropped WHOLE — a missing
 *     sentence, never a mangled one.
 */

export const TEMPLATE_KEY_WORDS: Record<string, string> = {
  BOOKING_CONFIRMATION: 'Booking confirmation',
  BOOKING_REQUEST_RECEIVED: 'Booking request received',
  BOOKING_APPROVED: 'Booking approved',
  REMINDER: 'Appointment reminder',
  RESCHEDULE_REQUEST_RECEIVED: 'Reschedule request received',
  RESCHEDULE_APPROVED: 'Reschedule approved',
  RESCHEDULE_DECLINED: 'Reschedule declined',
  CANCELLATION_REQUEST_RECEIVED: 'Cancellation request received',
  CANCELLATION_CONFIRMED: 'Cancellation confirmed',
};

export interface MessageTemplateRow {
  templateKey: string;
  language: string;
  body: string;
  isCustom: boolean;
  updatedAt: string | null;
}

export interface MessageTemplatesDoc {
  clinicId: string;
  placeholders: string[];
  templates: MessageTemplateRow[];
}

export function useMessageTemplates(clinicId: string | undefined) {
  return useQuery({
    queryKey: ['appointment-message-templates', clinicId],
    queryFn: () =>
      apiClient.get<MessageTemplatesDoc>(`/appointment-message-templates?clinicId=${clinicId}`),
    enabled: Boolean(clinicId),
    staleTime: 60_000,
  });
}

export function templateBody(
  doc: MessageTemplatesDoc | undefined,
  templateKey: string,
  language: string,
): string {
  return (
    doc?.templates.find((row) => row.templateKey === templateKey && row.language === language)
      ?.body ?? ''
  );
}

export interface MessageContext {
  patient_name: string;
  clinic_name: string;
  appointment_date: string;
  appointment_time: string;
  service_name: string;
  provider_name: string;
  booking_reference: string;
  manage_booking_link: string;
  clinic_phone: string;
}

/**
 * The context for one appointment. Guarantees, by construction:
 * every appointment HAS a patient, a service, a provider and a start; the
 * clinic name falls back through booking-page displayName → clinic name and
 * a clinic name is NOT NULL; the reference derives from the id every
 * appointment has. The two the world may genuinely lack come out '' and the
 * renderer drops their lines.
 */
export function messageContextFor(params: {
  appointment: {
    id: string;
    scheduledStart: string | Date;
    manageToken?: string | null;
    patient: { name: string };
    staff: { fullName: string };
    service: { name: string };
  };
  clinic:
    | { name: string; patientFacingName?: string; phone?: string | null; bookingSlug?: string | null }
    | null
    | undefined;
  /** window.location.origin in the app; injectable for tests. */
  origin?: string;
}): MessageContext {
  const { appointment, clinic } = params;
  const origin = params.origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const manageLink =
    clinic?.bookingSlug && appointment.manageToken && origin
      ? `${origin}/book/${clinic.bookingSlug}/manage/${appointment.manageToken}`
      : '';
  return {
    patient_name: appointment.patient.name,
    clinic_name: patientFacingClinicName(clinic),
    appointment_date: formatClinicDate(appointment.scheduledStart),
    appointment_time: formatClinicTime(appointment.scheduledStart),
    service_name: appointment.service.name,
    provider_name: appointment.staff.fullName,
    booking_reference: appointment.id.replace(/-/g, '').slice(0, 8).toUpperCase(),
    manage_booking_link: manageLink,
    clinic_phone: clinic?.phone?.trim() ?? '',
  };
}

const PLACEHOLDER_PATTERN = /\{([a-z_]+)\}/g;

/**
 * Substitute placeholders into a template body. The rules, in order:
 *   1. a line containing a placeholder whose value is EMPTY is omitted whole
 *      — "Call us at ." must be impossible, whatever a caller passes;
 *   2. a placeholder the context does not know is stripped (the server
 *      refuses to store one, so this is belt-and-braces for hand-typed
 *      preview text);
 *   3. doubled spaces left by a stripped token are collapsed.
 */
export function renderAppointmentMessage(body: string, context: MessageContext): string {
  const values = context as unknown as Record<string, string | undefined>;
  const lines = body.split('\n').map((line) => {
    const tokens = [...line.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
    const missing = tokens.some((token) => token in values && !values[token]?.trim());
    if (missing) return null;
    const filled = line.replace(PLACEHOLDER_PATTERN, (whole, token: string) =>
      token in values ? (values[token] as string) : '',
    );
    return filled.replace(/ {2,}/g, ' ').trimEnd();
  });
  return lines
    .filter((line): line is string => line !== null)
    .join('\n')
    .trim();
}

/** The wa.me deep link for an already-rendered message. */
export function whatsappLinkForMessage(
  phone: string | null | undefined,
  message: string,
): string | null {
  const number = toWhatsappNumber(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
