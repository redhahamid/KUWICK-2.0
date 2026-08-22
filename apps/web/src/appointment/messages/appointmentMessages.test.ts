import { beforeEach, describe, expect, it } from 'vitest';
import { setClinicTimeZone } from '../../clinical/clinicTime';
import {
  messageContextFor,
  renderAppointmentMessage,
  whatsappLinkForMessage,
} from './appointmentMessages';

// ===========================================================================
// PHASE 8 — THE ONE RENDERER, AND WHY "appointment at on" CANNOT COME BACK.
//
// The 2026 UAT defect was a hardcoded sentence composed around an empty
// clinic name: "your appointment at on 22 Aug". The renderer's contract makes
// that class of output structurally impossible: an empty value does not leave
// a hole, it deletes its whole line. These pins are that contract.
// ===========================================================================

const APPOINTMENT = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  // 01:30Z = 09:30 in Kuala Lumpur.
  scheduledStart: '2026-09-01T01:30:00.000Z',
  manageToken: 'tok-secret',
  patient: { name: 'Ahmad Firdaus' },
  staff: { fullName: 'Dr Redha' },
  service: { name: 'GP Consultation' },
};

const CLINIC = {
  name: 'Klinik UAT Staging (Synthetic)',
  patientFacingName: 'Klinik Hijraa Bangi',
  phone: '03-8912 3456',
  bookingSlug: 'uat-clinic',
};

beforeEach(() => setClinicTimeZone('Asia/Kuala_Lumpur'));

describe('the context resolves every guaranteed fact', () => {
  it('1. patient, clinic (patient-facing), date and time in the CLINIC clock, service, provider, reference', () => {
    const context = messageContextFor({
      appointment: APPOINTMENT,
      clinic: CLINIC,
      origin: 'https://kuwick.example',
    });

    expect(context.patient_name).toBe('Ahmad Firdaus');
    expect(context.clinic_name).toBe('Klinik Hijraa Bangi');
    expect(context.appointment_date).toBe('1 Sep 2026');
    expect(context.appointment_time).toBe('09:30');
    expect(context.service_name).toBe('GP Consultation');
    expect(context.provider_name).toBe('Dr Redha');
    expect(context.booking_reference).toBe('A1B2C3D4');
    expect(context.manage_booking_link).toBe(
      'https://kuwick.example/book/uat-clinic/manage/tok-secret',
    );
  });

  it('2. the internal environment label never wins over the patient-facing name', () => {
    const context = messageContextFor({ appointment: APPOINTMENT, clinic: CLINIC });
    expect(context.clinic_name).not.toContain('Synthetic');
  });

  it('3. a walk-in booking (no manage token) and a phoneless clinic yield EMPTY optionals, not garbage', () => {
    const context = messageContextFor({
      appointment: { ...APPOINTMENT, manageToken: null },
      clinic: { ...CLINIC, phone: null, bookingSlug: null },
    });
    expect(context.manage_booking_link).toBe('');
    expect(context.clinic_phone).toBe('');
  });
});

describe('rendering: a hole deletes its line, never mangles its sentence', () => {
  const context = messageContextFor({
    appointment: { ...APPOINTMENT, manageToken: null },
    clinic: { ...CLINIC, phone: null, bookingSlug: null },
    origin: 'https://kuwick.example',
  });

  it('4. lines whose placeholders all resolve are filled verbatim', () => {
    const output = renderAppointmentMessage(
      'Hi {patient_name}, see you at {clinic_name} on {appointment_date} at {appointment_time}.',
      context,
    );
    expect(output).toBe('Hi Ahmad Firdaus, see you at Klinik Hijraa Bangi on 1 Sep 2026 at 09:30.');
  });

  it('5. a line with an EMPTY placeholder disappears whole — "Call us at ." is impossible', () => {
    const output = renderAppointmentMessage(
      'Hi {patient_name}.\nChange or cancel: {manage_booking_link}\nCall us at {clinic_phone}.',
      context,
    );
    expect(output).toBe('Hi Ahmad Firdaus.');
  });

  it('6. THE REGRESSION PIN: an empty clinic name can never render "at on" again', () => {
    // Force the historical failure input past the context builder.
    const broken = { ...context, clinic_name: '' };
    const output = renderAppointmentMessage(
      'Hi {patient_name}, a reminder of your appointment at {clinic_name} on {appointment_date}.',
      broken,
    );
    expect(output).not.toMatch(/at\s+on/);
    expect(output).toBe('');
  });

  it('7. an unknown placeholder is stripped and its double space collapsed', () => {
    const output = renderAppointmentMessage('Hi {patient_name}, {made_up} see you.', context);
    expect(output).toBe('Hi Ahmad Firdaus, see you.');
  });
});

describe('the wa.me link carries the rendered message', () => {
  it('8. Malaysian local numbers are normalised and the text is URL-encoded', () => {
    const link = whatsappLinkForMessage('012-345 6789', 'Hi Ahmad, 09:30 — see you.');
    expect(link).toBe('https://wa.me/60123456789?text=Hi%20Ahmad%2C%2009%3A30%20%E2%80%94%20see%20you.');
  });

  it('9. no usable number means NO link, not a link to a stranger', () => {
    expect(whatsappLinkForMessage('12', 'Hi')).toBeNull();
    expect(whatsappLinkForMessage(null, 'Hi')).toBeNull();
  });
});
