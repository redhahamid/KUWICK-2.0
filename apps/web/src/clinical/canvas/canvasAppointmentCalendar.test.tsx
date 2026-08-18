// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';
import { CanvasAppointmentCalendar } from './CanvasAppointmentCalendar';
import { Visit } from '../types';
import { clinicDayjs } from '../clinicTime';

// ===========================================================================
// b4 PIECE C (3) — THE APPOINTMENT MONTH AND ITS PICKER.
//
// What these hold is the part that would otherwise only be visible in a
// browser, and the part a second store would break:
//
//   - the calendar names this patient's PREVIOUS and NEXT appointment, and a
//     cancelled one is neither;
//   - tapping a day opens the picker ON that day — the form does not ask for
//     a date the doctor has already chosen;
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

// BUILT IN THE CLINIC'S ZONE, and asserted in it. These were built with a
// bare `dayjs()`, which meant "09:30" was 09:30 to the TEST RUNNER — so the
// assertions agreed with whatever zone CI happened to run in and could never
// have caught the eight-hour error the module actually had. The card renders
// through `clinicTime.ts` now, so the fixture has to speak the same clock.
const TOMORROW = clinicDayjs(dayjs().add(1, 'day').valueOf());
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
      <CanvasAppointmentCalendar visit={VISIT} patientId="p1" patientName="Aisyah Ujian" />
    </Harness>,
  );

/** A day cell in the month, by date — how a doctor starts a booking. */
const dayCell = (date: dayjs.Dayjs) =>
  document.querySelector(`[data-date="${date.format('YYYY-MM-DD')}"]`) as HTMLElement;

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

describe('the month, and the two facts above it', () => {
  it('a patient with no appointments says so on both lines, and still offers a month', async () => {
    renderCard();
    expect(await screen.findByTestId('appointment-previous')).toHaveTextContent('no previous appointment');
    expect(screen.getByTestId('appointment-next')).toHaveTextContent('none booked');
    // The calendar is the control: there is always a day to tap.
    expect(dayCell(dayjs())).not.toBeNull();
  });

  it('names the next standing booking with when, who and what', async () => {
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
    const next = await screen.findByTestId('appointment-next');
    await waitFor(() => expect(next).toHaveTextContent(/Dr UAT Doctor · Wound dressing/));
    expect(next).toHaveTextContent(SLOT_START.format('HH:mm'));
  });

  it('names the previous one too, including a visit the patient did not attend', async () => {
    const lastWeek = clinicDayjs(dayjs().subtract(7, 'day').valueOf())
      .hour(9)
      .minute(0)
      .second(0)
      .millisecond(0);
    APPOINTMENTS = [
      {
        id: 'appt-old',
        clinicId: 'clinic-1',
        patientId: 'p1',
        staffId: 'dr-1',
        serviceId: 'svc-2',
        status: 'NO_SHOW',
        source: 'FRONT_DESK',
        scheduledStart: lastWeek.toISOString(),
        scheduledEnd: lastWeek.add(30, 'minute').toISOString(),
      },
    ];
    renderCard();
    const previous = await screen.findByTestId('appointment-previous');
    await waitFor(() => expect(previous).toHaveTextContent('Dr UAT Doctor'));
    // "They did not come last time" is the context that decides whether to
    // book another, so it is said rather than left to the status column of
    // another screen.
    expect(previous).toHaveTextContent('did not attend');
    // …and it is NOT offered as the next appointment.
    expect(screen.getByTestId('appointment-next')).toHaveTextContent('none booked');
  });

  it('a cancelled booking is neither the next nor the last', async () => {
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
    expect(await screen.findByTestId('appointment-next')).toHaveTextContent('none booked');
    expect(screen.getByTestId('appointment-previous')).toHaveTextContent('no previous appointment');
  });

  it('marks the days this patient has something standing on', async () => {
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
    await waitFor(() => {
      expect(dayCell(SLOT_START)?.getAttribute('data-appointments')).toBe('1');
    });
    // A day with nothing on it carries no mark at all.
    expect(dayCell(SLOT_START.add(1, 'day'))?.getAttribute('data-appointments')).toBeNull();
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

  /** Opens the picker the way a doctor does: by tapping a day in the month. */
  const openPickerOn = async (day: dayjs.Dayjs) => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(dayCell(day)).not.toBeNull());
    await user.click(dayCell(day));
    expect(await screen.findByText('Book a follow-up')).toBeInTheDocument();
    return user;
  };

  it('tapping a day opens the picker ON that day, without asking for it again', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(dayCell(TOMORROW)).not.toBeNull());
    await user.click(dayCell(TOMORROW));

    expect(await screen.findByText('Book a follow-up')).toBeInTheDocument();
    expect(screen.getByLabelText('Follow-up date')).toHaveValue(TOMORROW.format('YYYY-MM-DD'));
  });

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

  it('asks the availability engine for the clinic, doctor, service and the DAY that was tapped', async () => {
    const user = await openPickerOn(TOMORROW);
    await user.click(screen.getByLabelText('Follow-up service'));
    await user.click(await screen.findByTitle('Wound dressing'));

    await waitFor(() => expect(availabilityCalls.length).toBeGreaterThan(0));
    const asked = availabilityCalls[availabilityCalls.length - 1];
    expect(asked).toContain('staffId=dr-1');
    expect(asked).toContain('clinicId=clinic-1');
    expect(asked).toContain('serviceId=svc-2');
    expect(asked).toContain(`date=${TOMORROW.format('YYYY-MM-DD')}`);
  });

  it('books exactly the slot that was picked, through the appointments endpoint', async () => {
    const user = await openPickerOn(TOMORROW);
    await user.click(screen.getByLabelText('Follow-up service'));
    await user.click(await screen.findByTitle('Wound dressing'));

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
    const user = await openPickerOn(TOMORROW);
    await user.click(screen.getByLabelText('Follow-up service'));
    await user.click(await screen.findByTitle('Wound dressing'));

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
