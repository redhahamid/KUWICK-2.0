/**
 * NO WHATSAPP API. Messages travel as `wa.me` deep links the staff member's
 * own WhatsApp sends, so Kuwick claims nothing about delivery — pressing the
 * button records that somebody opened a message, which is the only part the
 * clinic can honestly assert.
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

/**
 * What a PATIENT should read as the clinic's name. The server resolves it on
 * the clinics list (`patientFacingName`: booking-page displayName → clinic
 * name); this helper is the one fallback chain every caller shares, so the
 * calendar drawer and the appointment list can never again greet the same
 * patient with two different clinics — one of which was blank.
 */
export function patientFacingClinicName(
  clinic: { name: string; patientFacingName?: string } | null | undefined,
): string {
  return clinic?.patientFacingName?.trim() || clinic?.name?.trim() || '';
}

// PHASE 8 — the hardcoded reminder sentence that used to live here became the
// REMINDER default template (message-template.service.ts, both languages),
// and every message now goes through the ONE renderer in
// messages/appointmentMessages.ts. What stays in this module are the two
// contracts every message still leans on: the phone-number normalisation
// above and the patient-facing-name chain below.
