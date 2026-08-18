import { describe, expect, it, beforeEach } from 'vitest';
import { reminderMessage, toWhatsappNumber, whatsappLink } from './whatsappReminder';
import { setClinicTimeZone } from '../clinical/clinicTime';

// 01:00Z is 09:00 in Kuala Lumpur.
const SLOT = '2026-08-20T01:00:00.000Z';

beforeEach(() => setClinicTimeZone('Asia/Kuala_Lumpur'));

// ===========================================================================
// NO WHATSAPP API.
//
// This builds a wa.me deep link; the staff member's own phone sends it. Kuwick
// therefore claims nothing about delivery — which is exactly why the number
// has to be right: a wrong country code sends a stranger a message about
// somebody's medical appointment.
// ===========================================================================

describe('Malaysian numbers, as people actually write them', () => {
  it.each([
    ['012-345 6789', '60123456789'],
    ['0123456789', '60123456789'],
    ['+60 12 3456789', '60123456789'],
    ['60123456789', '60123456789'],
    ['03-1234 5678', '60312345678'],
  ])('1. %s → %s', (input, expected) => {
    expect(toWhatsappNumber(input)).toBe(expected);
  });

  it.each([null, undefined, '', '   ', '123'])('2. %p has no usable number', (input) => {
    // Better to disable the button than to open a chat with whoever owns the
    // number that guess produced.
    expect(toWhatsappNumber(input as string)).toBeNull();
  });

  it('3. a number that is neither local nor Malaysian is NOT given a country code', () => {
    // Prefixing 60 onto a foreign number is the guess that sends a stranger a
    // patient's appointment time.
    expect(toWhatsappNumber('+65 9123 4567')).toBe('6591234567');
    expect(toWhatsappNumber('+44 7700 900123')).toBe('447700900123');
  });
});

describe('the message', () => {
  it('4. names the patient, the clinic and the time in the CLINIC’s clock', () => {
    const text = reminderMessage({
      patientName: 'Aminah binti Yusof',
      scheduledStart: SLOT,
      clinicName: 'Klinik Utama',
    });

    expect(text).toContain('Aminah binti Yusof');
    expect(text).toContain('Klinik Utama');
    // 09:00, not 01:00 — the patient is told the hour they should arrive.
    expect(text).toContain('20 Aug 2026 · 09:00');
  });

  it('5. carries NO clinical detail', () => {
    // A reminder travels unencrypted to a phone that may be shared.
    const text = reminderMessage({
      patientName: 'Aminah',
      scheduledStart: SLOT,
      clinicName: 'Klinik Utama',
    });

    expect(text).not.toMatch(/diagnos|medicat|consultation for|complaint/i);
  });
});

describe('the link', () => {
  it('6. is a wa.me link with the message url-encoded', () => {
    const link = whatsappLink({
      phone: '012-345 6789',
      patientName: 'Aminah',
      scheduledStart: SLOT,
      clinicName: 'Klinik Utama',
    })!;

    expect(link.startsWith('https://wa.me/60123456789?text=')).toBe(true);
    expect(decodeURIComponent(link.split('?text=')[1])).toContain('Klinik Utama');
  });

  it('7. is null when there is no usable number, so the caller can disable the button', () => {
    expect(
      whatsappLink({ phone: null, patientName: 'A', scheduledStart: SLOT, clinicName: 'K' }),
    ).toBeNull();
  });

  it('8. survives a name with characters that would break a url', () => {
    const link = whatsappLink({
      phone: '0123456789',
      patientName: 'A/P Rajan & Sons',
      scheduledStart: SLOT,
      clinicName: 'Klinik 100% Sihat',
    })!;

    expect(link).not.toContain('&Sons');
    expect(decodeURIComponent(link.split('?text=')[1])).toContain('A/P Rajan & Sons');
  });
});
