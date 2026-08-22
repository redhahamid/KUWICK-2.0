import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import { assertCanPerformAppointmentAction } from './appointment-authorization';

/**
 * PHASE 8 — THE CANONICAL MESSAGE VOCABULARY.
 *
 * Nine moments a clinic speaks to a patient about an appointment, each in
 * English and Bahasa Malaysia. The BODIES here are the built-in defaults; a
 * clinic's own wording lives in `appointment_message_templates` and a stored
 * row simply replaces the default for that (type, language) pair.
 *
 * THE CONTRACT THAT KEEPS "appointment at on" DEAD: a template refers to
 * facts only through the placeholders below, the server refuses to store a
 * placeholder it does not know, and the single web renderer
 * (appointmentMessages.ts) drops any LINE whose placeholder has no value
 * rather than leaving a hole mid-sentence. Nobody concatenates message
 * fragments anywhere else.
 */
export const MESSAGE_TEMPLATE_KEYS = [
  'BOOKING_CONFIRMATION',
  'BOOKING_REQUEST_RECEIVED',
  'BOOKING_APPROVED',
  'REMINDER',
  'RESCHEDULE_REQUEST_RECEIVED',
  'RESCHEDULE_APPROVED',
  'RESCHEDULE_DECLINED',
  'CANCELLATION_REQUEST_RECEIVED',
  'CANCELLATION_CONFIRMED',
] as const;
export type MessageTemplateKey = (typeof MESSAGE_TEMPLATE_KEYS)[number];

export const MESSAGE_LANGUAGES = ['en', 'ms'] as const;
export type MessageLanguage = (typeof MESSAGE_LANGUAGES)[number];

/** Every fact a template may mention. The web renderer resolves the values. */
export const MESSAGE_PLACEHOLDERS = [
  'patient_name',
  'clinic_name',
  'appointment_date',
  'appointment_time',
  'service_name',
  'provider_name',
  'booking_reference',
  'manage_booking_link',
  'clinic_phone',
] as const;

const MAX_BODY_CHARS = 1000;

/**
 * The default wording. Deliberate shape rules:
 *   - no clinical detail — these travel over WhatsApp to a phone that may be
 *     shared;
 *   - {manage_booking_link} and {clinic_phone} sit on their OWN lines,
 *     because they are the two facts that can be absent (a walk-in booking
 *     has no manage token; a clinic may have no phone on record) and the
 *     renderer omits the whole line rather than printing "call us at .";
 *   - the "received" messages say explicitly that nothing has changed yet —
 *     the same promise the manage page makes.
 */
export const DEFAULT_MESSAGE_TEMPLATES: Record<
  MessageTemplateKey,
  Record<MessageLanguage, string>
> = {
  BOOKING_CONFIRMATION: {
    en:
      'Hi {patient_name}, your appointment at {clinic_name} is confirmed: {service_name} with {provider_name} on {appointment_date} at {appointment_time}. Reference {booking_reference}.\n' +
      'Change or cancel: {manage_booking_link}\n' +
      'Need help? Call us at {clinic_phone}.',
    ms:
      'Hai {patient_name}, temujanji anda di {clinic_name} telah disahkan: {service_name} bersama {provider_name} pada {appointment_date} jam {appointment_time}. Rujukan {booking_reference}.\n' +
      'Ubah atau batal: {manage_booking_link}\n' +
      'Perlukan bantuan? Hubungi kami di {clinic_phone}.',
  },
  BOOKING_REQUEST_RECEIVED: {
    en:
      'Hi {patient_name}, we received your booking request for {service_name} on {appointment_date} at {appointment_time} at {clinic_name}. We will confirm it shortly — the time is not reserved until we do. Reference {booking_reference}.',
    ms:
      'Hai {patient_name}, kami telah menerima permohonan temujanji anda untuk {service_name} pada {appointment_date} jam {appointment_time} di {clinic_name}. Kami akan mengesahkannya sebentar lagi — slot belum ditempah selagi belum disahkan. Rujukan {booking_reference}.',
  },
  BOOKING_APPROVED: {
    en:
      'Hi {patient_name}, good news — your booking at {clinic_name} is confirmed: {service_name} with {provider_name} on {appointment_date} at {appointment_time}.\n' +
      'Change or cancel: {manage_booking_link}',
    ms:
      'Hai {patient_name}, berita baik — temujanji anda di {clinic_name} telah disahkan: {service_name} bersama {provider_name} pada {appointment_date} jam {appointment_time}.\n' +
      'Ubah atau batal: {manage_booking_link}',
  },
  REMINDER: {
    en:
      'Hi {patient_name}, this is a reminder of your appointment at {clinic_name} on {appointment_date} at {appointment_time} — {service_name} with {provider_name}.\n' +
      'Please reply if you need to change it.',
    ms:
      'Hai {patient_name}, ini peringatan temujanji anda di {clinic_name} pada {appointment_date} jam {appointment_time} — {service_name} bersama {provider_name}.\n' +
      'Sila balas jika anda perlu mengubahnya.',
  },
  RESCHEDULE_REQUEST_RECEIVED: {
    en:
      'Hi {patient_name}, we received your request to move your appointment at {clinic_name}. Your current time on {appointment_date} at {appointment_time} stays booked until we confirm the change.',
    ms:
      'Hai {patient_name}, kami telah menerima permohonan anda untuk menukar temujanji di {clinic_name}. Slot asal anda pada {appointment_date} jam {appointment_time} kekal sehingga kami mengesahkan perubahan.',
  },
  RESCHEDULE_APPROVED: {
    en:
      'Hi {patient_name}, your appointment at {clinic_name} has been moved as requested: {service_name} with {provider_name} on {appointment_date} at {appointment_time}.\n' +
      'Change or cancel: {manage_booking_link}',
    ms:
      'Hai {patient_name}, temujanji anda di {clinic_name} telah ditukar seperti dipohon: {service_name} bersama {provider_name} pada {appointment_date} jam {appointment_time}.\n' +
      'Ubah atau batal: {manage_booking_link}',
  },
  RESCHEDULE_DECLINED: {
    en:
      'Hi {patient_name}, sorry — we could not move your appointment at {clinic_name} this time. Your booking on {appointment_date} at {appointment_time} stays as it is.\n' +
      'Need another option? Call us at {clinic_phone}.',
    ms:
      'Hai {patient_name}, maaf — kami tidak dapat menukar temujanji anda di {clinic_name} kali ini. Tempahan anda pada {appointment_date} jam {appointment_time} kekal seperti asal.\n' +
      'Perlukan pilihan lain? Hubungi kami di {clinic_phone}.',
  },
  CANCELLATION_REQUEST_RECEIVED: {
    en:
      'Hi {patient_name}, we received your request to cancel your appointment on {appointment_date} at {appointment_time} at {clinic_name}. The booking stays in place until we confirm the cancellation.',
    ms:
      'Hai {patient_name}, kami telah menerima permohonan pembatalan temujanji anda pada {appointment_date} jam {appointment_time} di {clinic_name}. Tempahan kekal sehingga kami mengesahkan pembatalan.',
  },
  CANCELLATION_CONFIRMED: {
    en:
      'Hi {patient_name}, your appointment at {clinic_name} on {appointment_date} at {appointment_time} has been cancelled.\n' +
      'If you would like a new time, call us at {clinic_phone}.',
    ms:
      'Hai {patient_name}, temujanji anda di {clinic_name} pada {appointment_date} jam {appointment_time} telah dibatalkan.\n' +
      'Jika mahu slot baharu, hubungi kami di {clinic_phone}.',
  },
};

/** `{token}` occurrences — the renderer and the validator read one grammar. */
const PLACEHOLDER_PATTERN = /\{([a-z_]+)\}/g;

export function placeholdersIn(body: string): string[] {
  return [...body.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
}

@Injectable()
export class MessageTemplateService {
  constructor(private readonly rawPrisma: PrismaService) {}

  /**
   * Every (type, language) pair, customised or not, plus the placeholder
   * vocabulary — so the settings screen renders the server's contract rather
   * than hardcoding its own copy of it.
   */
  async list(clinicId: string) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'VIEW');

      const rows = await tx.appointmentMessageTemplate.findMany({
        where: { clinicId },
        select: { templateKey: true, language: true, body: true, updatedAt: true },
      });
      const custom = new Map(rows.map((row) => [`${row.templateKey}:${row.language}`, row]));

      const templates = MESSAGE_TEMPLATE_KEYS.flatMap((templateKey) =>
        MESSAGE_LANGUAGES.map((language) => {
          const stored = custom.get(`${templateKey}:${language}`);
          return {
            templateKey,
            language,
            body: stored?.body ?? DEFAULT_MESSAGE_TEMPLATES[templateKey][language],
            isCustom: Boolean(stored),
            updatedAt: stored?.updatedAt ?? null,
          };
        }),
      );

      return { clinicId, placeholders: MESSAGE_PLACEHOLDERS, templates };
    });
  }

  /**
   * Store the clinic's wording for one (type, language) — or, with a null
   * body, forget it and return to the default. Refuses an unknown
   * placeholder BY NAME, because "validation failed" teaches nobody that
   * they typed {patient} where the system knows {patient_name}.
   */
  async upsert(dto: {
    clinicId: string;
    templateKey: string;
    language: string;
    body?: string | null;
  }) {
    if (!(MESSAGE_TEMPLATE_KEYS as readonly string[]).includes(dto.templateKey)) {
      throw new BadRequestException('That is not one of the appointment message types.');
    }
    if (dto.body === undefined) {
      // Absent is a malformed call, not a reset: resetting a clinic's wording
      // must be said in so many words (body: null).
      throw new BadRequestException('Send body as the new wording, or null to reset to the default.');
    }
    if (!(MESSAGE_LANGUAGES as readonly string[]).includes(dto.language)) {
      throw new BadRequestException('Templates exist in English (en) and Bahasa Malaysia (ms).');
    }

    const body = dto.body === null ? null : dto.body.replace(/\r\n/g, '\n').trim();
    if (body !== null) {
      if (body.length === 0) {
        throw new BadRequestException(
          'A template cannot be empty. Use "Reset to default" to go back to the built-in wording.',
        );
      }
      if (body.length > MAX_BODY_CHARS) {
        throw new BadRequestException('A template is capped at 1000 characters.');
      }
      const unknown = placeholdersIn(body).filter(
        (token) => !(MESSAGE_PLACEHOLDERS as readonly string[]).includes(token),
      );
      if (unknown.length > 0) {
        throw new BadRequestException(
          `Unknown placeholder {${unknown[0]}}. The available ones are: ${MESSAGE_PLACEHOLDERS.map(
            (token) => `{${token}}`,
          ).join(' ')}.`,
        );
      }
    }

    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'CONFIGURE');

      if (body === null) {
        await tx.appointmentMessageTemplate.deleteMany({
          where: { clinicId: dto.clinicId, templateKey: dto.templateKey, language: dto.language },
        });
      } else {
        const existing = await tx.appointmentMessageTemplate.findFirst({
          where: { clinicId: dto.clinicId, templateKey: dto.templateKey, language: dto.language },
          select: { id: true },
        });
        if (existing) {
          await tx.appointmentMessageTemplate.update({ where: { id: existing.id }, data: { body } });
        } else {
          await tx.appointmentMessageTemplate.create({
            data: {
              tenantId: currentTenantId(),
              clinicId: dto.clinicId,
              templateKey: dto.templateKey,
              language: dto.language,
              body,
            },
          });
        }
      }

      const stored = await tx.appointmentMessageTemplate.findFirst({
        where: { clinicId: dto.clinicId, templateKey: dto.templateKey, language: dto.language },
        select: { body: true, updatedAt: true },
      });
      return {
        templateKey: dto.templateKey,
        language: dto.language,
        body:
          stored?.body ??
          DEFAULT_MESSAGE_TEMPLATES[dto.templateKey as MessageTemplateKey][
            dto.language as MessageLanguage
          ],
        isCustom: Boolean(stored),
        updatedAt: stored?.updatedAt ?? null,
      };
    });
  }
}
