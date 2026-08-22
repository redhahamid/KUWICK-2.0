// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppointmentDrawer } from './AppointmentDrawer';
import { setClinicTimeZone } from '../../clinical/clinicTime';

// ===========================================================================
// THE APPOINTMENT DRAWER.
//
// What these pin is the behaviour a receptionist depends on and a redesign is
// most likely to break quietly:
//
//   - CHECK IN is the primary action, and it is DISABLED for an appointment
//     that has already been checked in. An enabled button that 400s is worse
//     than a disabled one, because the counter tries it three times first.
//   - A REQUEST offers Accept and Decline instead, because "check in" for
//     something the clinic has not agreed to is a nonsense.
//   - An OVERRIDDEN booking says so, unprompted. The whole value of recording
//     an override is that somebody later can see it without going looking.
//   - The times render in the CLINIC's clock, not the browser's.
// ===========================================================================

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post, patch, delete: vi.fn() },
}));

const BASE = {
  id: 'appt-1',
  status: 'CONFIRMED',
  source: 'FRONT_DESK',
  sourceDetail: null,
  clinicId: 'clinic-1',
  staffId: 'doc-1',
  serviceId: 'svc-1',
  patientId: 'pat-1',
  // 01:00Z is 09:00 in Kuala Lumpur — the assertion that would have caught the
  // eight-hour defect this convention exists to prevent.
  scheduledStart: '2026-09-01T01:00:00.000Z',
  scheduledEnd: '2026-09-01T01:30:00.000Z',
  notes: 'Regular patient',
  patientNote: 'Sore throat since Friday',
  cancelReason: null,
  cancellationReason: null,
  arrivedAt: null,
  checkedInAt: null,
  visitId: null,
  createdAt: '2026-08-20T02:00:00.000Z',
  paymentStatus: 'NOT_REQUIRED',
  bookingFeeAmount: '0',
  reminderSentAt: null,
  overriddenRule: null,
  overrideReason: null,
  manageToken: null,
  patient: { id: 'pat-1', name: 'Ahmad bin Ali', phone: '0123456789', identifierValue: '900101015555' },
  staff: { id: 'doc-1', fullName: 'Dr Redha', calendarColor: null },
  service: { id: 'svc-1', name: 'Consultation', preInstructions: null, postInstructions: null },
  visit: null,
  queueTicket: null,
  formAnswers: [],
  communications: [],
  events: [],
  rescheduledFrom: null,
  rescheduledTo: null,
};

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

const CLINICS = [
  // The internal name is deliberately the staging label and the patient-facing
  // name the clinic's own: the drawer must always speak the second.
  { id: 'clinic-1', name: 'Klinik UAT Staging (Synthetic)', patientFacingName: 'Klinik Hijraa Bangi' },
];

function open(overrides: Record<string, unknown> = {}) {
  get.mockImplementation((url: string) =>
    url.startsWith('/clinics')
      ? Promise.resolve(CLINICS)
      : url.includes('/change-requests')
        ? Promise.resolve([])
        : Promise.resolve({ ...BASE, ...overrides }),
  );
  return render(
    <Harness>
      <AppointmentDrawer
        appointmentId="appt-1"
        open
        onClose={() => undefined}
        onReschedule={() => undefined}
      />
    </Harness>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setClinicTimeZone('Asia/Kuala_Lumpur');
});

describe('the drawer offers the action the counter actually needs', () => {
  it('1. Check in is the primary action for a confirmed appointment', async () => {
    open();

    const button = await screen.findByRole('button', { name: /check in/i });
    expect(button).toBeEnabled();
  });

  it('2. an already checked-in appointment offers Open visit, not a dead Check in', async () => {
    // §10 — the irrelevant primary is not disabled, it is GONE, and the
    // button that replaces it is the one the counter actually needs next.
    open({ status: 'CHECKED_IN', visitId: 'visit-9' });

    expect(await screen.findByRole('button', { name: /open visit/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^check in$/i })).not.toBeInTheDocument();
  });

  it('3. a REQUEST offers Accept and Decline instead of Check in', async () => {
    open({ status: 'REQUESTED' });

    expect(await screen.findByRole('button', { name: /accept request/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^check in$/i })).not.toBeInTheDocument();
  });

  it('3b. Register / Check in opens the registration REVIEW — the click itself creates nothing', async () => {
    // Phase 4. One click used to mean visit + queue ticket, payer guessed.
    // Now the click opens the review, and only Confirm & add to queue commits
    // — with the payer and the attending doctor it reviewed.
    patch.mockResolvedValue({});
    get.mockImplementation((url: string) =>
      url.startsWith('/clinics')
        ? Promise.resolve(CLINICS)
        : url.startsWith('/staff')
          ? Promise.resolve([{ id: 'doc-1', fullName: 'Dr Redha', role: 'DOCTOR_RESIDENT' }])
          : url.startsWith('/panel-clinics') || url.includes('/change-requests')
            ? Promise.resolve([])
            : Promise.resolve({ ...BASE }),
    );
    render(
      <Harness>
        <AppointmentDrawer
          appointmentId="appt-1"
          open
          onClose={() => undefined}
          onReschedule={() => undefined}
        />
      </Harness>,
    );

    await userEvent.click(await screen.findByRole('button', { name: /register \/ check in/i }));
    expect(await screen.findByTestId('checkin-registration-drawer')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('confirm-add-to-queue'));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        '/appointments/appt-1/arrived',
        expect.objectContaining({
          billingType: 'Self-pay',
          staffId: 'doc-1',
          presentingComplaint: 'Sore throat since Friday',
        }),
      ),
    );
  });

  it('4. accepting a request calls the confirm endpoint', async () => {
    patch.mockResolvedValue({});
    open({ status: 'REQUESTED' });

    await userEvent.click(await screen.findByRole('button', { name: /accept request/i }));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/appointments/appt-1/confirm', undefined),
    );
  });

  it('5. a cancelled appointment shows neither Check in nor Reschedule at all', async () => {
    open({ status: 'CANCELLED' });

    // The drawer still renders (More menu, history) — wait for it, then
    // assert the dead controls are absent rather than merely disabled.
    expect(await screen.findByRole('button', { name: /more actions/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^check in$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reschedule/i })).not.toBeInTheDocument();
  });
});

describe('the drawer speaks the patient-facing clinic identity', () => {
  it('WhatsApp goes through the template modal and carries the booking-page name, never the internal label', async () => {
    // PHASE 8 — the drawer composes no message text itself. The modal fetches
    // the clinic's templates (defaults here), the ONE renderer fills them,
    // and the preview is what wa.me receives.
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    post.mockResolvedValue({});
    get.mockImplementation((url: string) =>
      url.startsWith('/clinics')
        ? Promise.resolve(CLINICS)
        : url.includes('/appointment-message-templates')
          ? Promise.resolve({
              clinicId: 'clinic-1',
              placeholders: ['patient_name', 'clinic_name', 'appointment_date', 'appointment_time'],
              templates: [
                {
                  templateKey: 'REMINDER',
                  language: 'en',
                  body: 'Hi {patient_name}, reminder of your appointment at {clinic_name} on {appointment_date} at {appointment_time}.',
                  isCustom: false,
                  updatedAt: null,
                },
              ],
            })
          : url.includes('/change-requests')
            ? Promise.resolve([])
            : Promise.resolve({ ...BASE }),
    );
    render(
      <Harness>
        <AppointmentDrawer
          appointmentId="appt-1"
          open
          onClose={() => undefined}
          onReschedule={() => undefined}
        />
      </Harness>,
    );

    await userEvent.click(await screen.findByRole('button', { name: /whatsapp patient/i }));

    // The preview shows the rendered message — clinic clock, patient-facing
    // name — before anything opens.
    const preview = await screen.findByTestId('message-preview');
    await waitFor(() => expect((preview as HTMLTextAreaElement).value).toContain('Klinik Hijraa Bangi'));
    expect((preview as HTMLTextAreaElement).value).toContain('09:00');

    await userEvent.click(screen.getByRole('button', { name: /open whatsapp/i }));

    await waitFor(() => expect(opened).toHaveBeenCalled());
    const url = decodeURIComponent(String(opened.mock.calls[0][0]));
    expect(url).toContain('Klinik Hijraa Bangi');
    expect(url).not.toContain('Synthetic');
    // And the log records the TEMPLATE that was sent, for the due worklist.
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/appointment-communications/appt-1',
        expect.objectContaining({ channel: 'WHATSAPP', template: 'REMINDER' }),
      ),
    );
    opened.mockRestore();
  });
});

describe('the drawer records communication honestly', () => {
  it('a recorded WhatsApp open is described as OPENED, never as a reminder sent', async () => {
    open({ reminderSentAt: '2026-08-21T09:11:00.000Z' });

    // 17:11 KL. The row says what was observed — the window opened — and
    // claims nothing about delivery a wa.me link cannot prove.
    expect(await screen.findByText(/WhatsApp opened · 21 Aug 2026 · 17:11/)).toBeTruthy();
    expect(screen.queryByText(/reminder sent/i)).toBeNull();
  });
});

describe('the drawer says what happened to this booking', () => {
  it('6. an override is announced without anybody going looking for it', async () => {
    open({
      overriddenRule: 'FULLY_BOOKED',
      overrideReason: 'Patient travelling tomorrow',
    });

    expect(await screen.findByText(/booked against the clinic's rules/i)).toBeInTheDocument();
    expect(screen.getByText(/patient travelling tomorrow/i)).toBeInTheDocument();
  });

  it('7. a rescheduled booking names where it came from', async () => {
    open({ rescheduledFrom: { id: 'appt-0', scheduledStart: '2026-08-25T01:00:00.000Z' } });

    expect(await screen.findByText(/moved from/i)).toBeInTheDocument();
  });

  it("8. the patient's own words are shown apart from the internal note", async () => {
    open();

    expect(await screen.findByText('Sore throat since Friday')).toBeInTheDocument();
    expect(screen.getByText('Regular patient')).toBeInTheDocument();
    // Two headings, because one of the two is safe to show a patient and the
    // other is not.
    expect(screen.getByText(/patient message/i)).toBeInTheDocument();
    expect(screen.getByText(/internal note/i)).toBeInTheDocument();
  });

  it('9. the queue ticket appears once the patient is checked in', async () => {
    open({
      status: 'CHECKED_IN',
      visitId: 'visit-9',
      visit: { id: 'visit-9', visitNumber: 42, checkOutAt: null },
      queueTicket: { id: 't1', displayNumber: 'A012', status: 'WAITING', queueType: 'APPOINTMENT' },
    });

    expect(await screen.findByText('A012')).toBeInTheDocument();
  });
});

describe('every time is the clinic’s time', () => {
  it('10. a 01:00Z appointment reads 09:00, not 01:00', async () => {
    open();

    expect(await screen.findByText(/09:00/)).toBeInTheDocument();
    expect(screen.queryByText(/01:00/)).not.toBeInTheDocument();
  });
});
