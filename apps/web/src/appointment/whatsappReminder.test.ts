import { describe, expect, it } from 'vitest';
import { patientFacingClinicName, toWhatsappNumber } from './whatsappReminder';

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

describe('the patient-facing clinic name', () => {
  it('9. prefers the booking page displayName over the internal clinic name', () => {
    expect(
      patientFacingClinicName({
        name: 'Klinik UAT Staging (Synthetic)',
        patientFacingName: 'Klinik Hijraa Bangi',
      }),
    ).toBe('Klinik Hijraa Bangi');
  });

  it('10. falls back to the clinic name, and to empty only when there is nothing', () => {
    expect(patientFacingClinicName({ name: 'Klinik Utama' })).toBe('Klinik Utama');
    expect(patientFacingClinicName({ name: 'Klinik Utama', patientFacingName: '  ' })).toBe(
      'Klinik Utama',
    );
    expect(patientFacingClinicName(undefined)).toBe('');
  });
});
