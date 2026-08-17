// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';
import { NextAppointmentCard } from './NextAppointmentCard';
import { Visit } from '../types';

// ===========================================================================
// b4 PIECE C — THE APPOINTMENT CARD AND ITS PICKER.
//
// What these hold is the part that would otherwise only be visible in a
// browser, and the part a second store would break:
//
//   - the card shows a STANDING booking and not a cancelled one;
//   - the service list is the doctor's MAPPING, not the catalogue;
//   - the slots come from /availability — the capacity engine — with the
//     clinic, doctor, service and date the doctor chose;
//   - booking POSTs to /appointments, the Appointments module's own endpoint,
//     with exactly the slot that was picked.
// ===========================================================================

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post, patch: vi.fn(), delete: vi.fn(), put: vi.fn(), postFile: vi.fn() },
  downloadFile: vi.fn(),
  fetchBlobUrl: vi.fn(),
}));

const VISIT = {
  id: 'visit-1',
  clinicId: 'clinic-1',
  staffId: 'dr-1',
  visitNumber: 'V-000004',
} as unknown as Visit;

const TOMORROW = dayjs().add(1, 'day');
const SLOT_START = TOMORROW.hour(9).minute(30).second(0).millisecond(0);

let APPOINTMENTS: unknown[] = [];
let QUALIFICATIONS: unknown[] = [];
let SLOTS: unknown[] = [];
let availabilityCalls: string[] = [];

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const renderCard = () =>
  render(
    <Harness>
      <NextAppointmentCard visit={VISIT} patientId="p1" patientName="Aisyah Ujian" />
    </Harness>,
  );

beforeEach(() => {
  APPOINTMENTS = [];
  QUALIFICATIONS = [{ id: 'q1', tenantId: 't1', staffId: 'dr-1', serviceId: 'svc-2' }];
  SLOTS = [
    { start: SLOT_START.toISOString(), end: SLOT_START.add(30, 'minute').toISOString() },
    {
      start: SLOT_START.add(30, 'minute').toISOString(),
      end: SLOT_START.add(60, 'minute').toISOString(),
    },
  ];
  availabilityCalls = [];
  get.mockReset();
  post.mockReset();
  get.mockImplementation((url: string) => {
    if (url.startsWith('/appointments')) return Promise.resolve(APPOINTMENTS);
    if (url.startsWith('/doctor-service-qualifications')) return Promise.resolve(QUALIFICATIONS);
    if (url.startsWith('/slot-capacity-configs'))
      return Promise.resolve([
        {
          id: 'cfg-1',
          tenantId: 't1',
          clinicId: 'clinic-1',
          staffId: 'dr-1',
          serviceId: 'svc-2',
          slotLengthMinutes: 30,
          dailyCapacity: 8,
        },
      ]);
    if (url.startsWith('/availability')) {
      availabilityCalls.push(url);
      return Promise.resolve(SLOTS);
    }
    if (url.startsWith('/staff'))
      return Promise.resolve([
        {
          id: 'dr-1',
          tenantId: 't1',
          role: 'DOCTOR_RESIDENT',
          fullName: 'Dr UAT Doctor',
          active: true,
          clinicId: 'clinic-1',
        },
        {
          id: 'nurse-1',
          tenantId: 't1',
          role: 'NURSE',
          fullName: 'Amy Tan',
          active: true,
          clinicId: 'clinic-1',
        },
      ]);
    if (url.startsWith('/services'))
      return Promise.resolve([
        {
          id: 'svc-1',
          tenantId: 't1',
          name: 'Minor surgery',
          orderType: 'STANDARD_SERVICE',
          durationMinutesDefault: 30,
          price: '80.00',
          active: true,
        },
        {
          id: 'svc-2',
          tenantId: 't1',
          name: 'Wound dressing',
          orderType: 'STANDARD_SERVICE',
          durationMinutesDefault: 30,
          price: '25.00',
          active: true,
        },
      ]);
    return Promise.resolve([]);
  });
  post.mockResolvedValue({ id: 'appt-new' });
});

describe('the card', () => {
  it('a first visit says there is no follow-up, in one line, with the control still there', async () => {
    renderCard();
    expect(await screen.findByText('No follow-up booked.')).toBeInTheDocument();
    expect(screen.getByTestId('book-follow-up-button')).toBeInTheDocument();
    // The empty state collapses the card rather than removing anything: the
    // panel carries the marker the stylesheet uses to put it on one line.
    expect(document.querySelector('.kw-rail-panel[data-panel="Next Appointment"]')).toHaveAttribute(
      'data-empty',
      'true',
    );
  });

  it('shows a standing booking with when, who and what', async () => {
    APPOINTMENTS = [
      {
        id: 'appt-1',
        clinicId: 'clinic-1',
        patientId: 'p1',
        staffId: 'dr-1',
        serviceId: 'svc-2',
        status: 'CONFIRMED',
        source: 'FRONT_DESK',
        scheduledStart: SLOT_START.toISOString(),
        scheduledEnd: SLOT_START.add(30, 'minute').toISOString(),
      },
    ];
    renderCard();
    const row = await screen.findByText(/Dr UAT Doctor · Wound dressing/);
    expect(row).toBeInTheDocument();
    expect(screen.getByText('CONFIRMED')).toBeInTheDocument();
    expect(screen.getByText(SLOT_START.format('HH:mm'), { exact: false })).toBeInTheDocument();
  });

  it('a cancelled booking is not shown as one', async () => {
    APPOINTMENTS = [
      {
        id: 'appt-1',
        clinicId: 'clinic-1',
        patientId: 'p1',
        staffId: 'dr-1',
        serviceId: 'svc-2',
        status: 'CANCELLED',
        source: 'FRONT_DESK',
        scheduledStart: SLOT_START.toISOString(),
        scheduledEnd: SLOT_START.add(30, 'minute').toISOString(),
      },
    ];
    renderCard();
    expect(await screen.findByText('No follow-up booked.')).toBeInTheDocument();
  });
});

describe('the picker', () => {
  const openPicker = async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByTestId('book-follow-up-button'));
    expect(await screen.findByText('Book a follow-up')).toBeInTheDocument();
    return user;
  };

  it('offers only the services THIS doctor is mapped to', async () => {
    const user = await openPicker();
    await user.click(screen.getByLabelText('Follow-up service'));
    await waitFor(() => {
      expect(screen.getByTitle('Wound dressing')).toBeInTheDocument();
    });
    // Minor surgery exists in the catalogue and is not mapped to this doctor.
    // Offering it would produce a booking the server refuses for a reason
    // nobody was shown.
    expect(screen.queryByTitle('Minor surgery')).not.toBeInTheDocument();
  });

  it('asks the availability engine for the chosen clinic, doctor, service and date', async () => {
    const user = await openPicker();
    await user.click(screen.getByLabelText('Follow-up service'));
    await user.click(await screen.findByTitle('Wound dressing'));

    // The date picker's own input, typed the way a user types it.
    const dateInput = screen.getByLabelText('Follow-up date');
    await user.click(dateInput);
    await user.type(dateInput, TOMORROW.format('YYYY-MM-DD'));
    await user.keyboard('{Enter}');

    await waitFor(() => expect(availabilityCalls.length).toBeGreaterThan(0));
    const asked = availabilityCalls[availabilityCalls.length - 1];
    expect(asked).toContain('staffId=dr-1');
    expect(asked).toContain('clinicId=clinic-1');
    expect(asked).toContain('serviceId=svc-2');
    expect(asked).toContain(`date=${TOMORROW.format('YYYY-MM-DD')}`);
  });

  it('books exactly the slot that was picked, through the appointments endpoint', async () => {
    const user = await openPicker();
    await user.click(screen.getByLabelText('Follow-up service'));
    await user.click(await screen.findByTitle('Wound dressing'));
    const dateInput = screen.getByLabelText('Follow-up date');
    await user.click(dateInput);
    await user.type(dateInput, TOMORROW.format('YYYY-MM-DD'));
    await user.keyboard('{Enter}');

    const slots = await screen.findByTestId('follow-up-slots');
    await user.click(within(slots).getByText(SLOT_START.format('HH:mm')));
    await user.click(screen.getByTestId('confirm-follow-up'));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/appointments', {
      clinicId: 'clinic-1',
      patientId: 'p1',
      staffId: 'dr-1',
      serviceId: 'svc-2',
      // FRONT_DESK is what makes it CONFIRMED rather than a request somebody
      // at the counter has to action.
      source: 'FRONT_DESK',
      scheduledStart: SLOT_START.toISOString(),
      scheduledEnd: SLOT_START.add(30, 'minute').toISOString(),
    });
  });

  it('an empty diary says which setting decides it', async () => {
    SLOTS = [];
    const user = await openPicker();
    await user.click(screen.getByLabelText('Follow-up service'));
    await user.click(await screen.findByTitle('Wound dressing'));
    const dateInput = screen.getByLabelText('Follow-up date');
    await user.click(dateInput);
    await user.type(dateInput, TOMORROW.format('YYYY-MM-DD'));
    await user.keyboard('{Enter}');

    expect(await screen.findByText('No open slots')).toBeInTheDocument();
    // The pairing IS configured here, so the message must not send anybody to
    // Settings for a diary that is simply full.
    expect(screen.getByText(/roster is full|daily capacity is spent/)).toBeInTheDocument();
  });

  it('a doctor with no mapping is told where mappings are made', async () => {
    QUALIFICATIONS = [];
    await openPicker();
    expect(
      await screen.findByText('This doctor is not mapped to any service yet'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Doctor-Service Mapping/)).toBeInTheDocument();
  });

  it('the confirm action is refused until a slot exists to book', async () => {
    await openPicker();
    expect(screen.getByTestId('confirm-follow-up')).toBeDisabled();
  });
});
