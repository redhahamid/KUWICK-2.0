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

function open(overrides: Record<string, unknown> = {}) {
  get.mockResolvedValue({ ...BASE, ...overrides });
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

  it('2. an already checked-in appointment cannot be checked in again', async () => {
    // An enabled button that 400s is worse than a disabled one: the counter
    // presses it three times before reading the toast.
    open({ status: 'CHECKED_IN', visitId: 'visit-9' });

    const button = await screen.findByRole('button', { name: /check in/i });
    expect(button).toBeDisabled();
  });

  it('3. a REQUEST offers Accept and Decline instead of Check in', async () => {
    open({ status: 'REQUESTED' });

    expect(await screen.findByRole('button', { name: /accept request/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^check in$/i })).not.toBeInTheDocument();
  });

  it('4. accepting a request calls the confirm endpoint', async () => {
    patch.mockResolvedValue({});
    open({ status: 'REQUESTED' });

    await userEvent.click(await screen.findByRole('button', { name: /accept request/i }));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/appointments/appt-1/confirm', undefined),
    );
  });

  it('5. a cancelled appointment can be neither checked in nor rescheduled', async () => {
    open({ status: 'CANCELLED' });

    expect(await screen.findByRole('button', { name: /check in/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reschedule/i })).toBeDisabled();
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
    expect(screen.getByText(/what the patient said/i)).toBeInTheDocument();
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
