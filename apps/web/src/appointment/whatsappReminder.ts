import { formatClinicDateTime } from '../clinical/clinicTime';

/**
 * The reminder message, and the link that opens it.
 *
 * NO WHATSAPP API. This builds a `wa.me` deep link and the staff member's own
 * WhatsApp sends it from their own phone. Kuwick therefore claims nothing
 * about delivery — pressing the button records that somebody sent a message,
 * which is the only part the clinic can honestly assert.
 */

/**
 * Malaysian numbers as people write them — `012-345 6789`, `+60 12 3456789`,
 * `0123456789` — into the digits-only international form wa.me needs.
 *
 * A local number starting 0 is Malaysian: drop the 0, prefix 60. A number
 * already starting 60 (or +60) is left alone. Anything else is returned
 * digits-only and unprefixed rather than guessed at — a wrong country code
 * sends a stranger a message about somebody's medical appointment.
 */
export function toWhatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return null;
  if (digits.startsWith('60')) return digits;
  if (digits.startsWith('0')) return `60${digits.slice(1)}`;
  return digits;
}

export function reminderMessage(params: {
  patientName: string;
  scheduledStart: string | Date;
  clinicName: string;
}): string {
  // Short, and it names the three things a patient needs: who it is for, when,
  // and where. No clinical detail — a reminder travels over an unencrypted
  // channel to a phone that may be shared.
  return (
    `Hi ${params.patientName}, this is a reminder of your appointment at ` +
    `${params.clinicName} on ${formatClinicDateTime(params.scheduledStart)}. ` +
    'Please reply if you need to change it.'
  );
}

export function whatsappLink(params: {
  phone: string | null | undefined;
  patientName: string;
  scheduledStart: string | Date;
  clinicName: string;
}): string | null {
  const number = toWhatsappNumber(params.phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(reminderMessage(params))}`;
}
