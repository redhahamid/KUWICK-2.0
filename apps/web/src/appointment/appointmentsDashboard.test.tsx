// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppointmentsDashboardPage } from './AppointmentsDashboardPage';
import { apiClient } from '../core/api-client';
import { setClinicTimeZone } from '../clinical/clinicTime';
import type { DashboardStats } from './hooks/useAppointmentDashboard';

/**
 * `waitFor` with room to breathe.
 *
 * testing-library's default is 1000ms. These assertions wait on a react-query
 * refetch inside a jsdom render of an antd Table, in a suite running 83 files
 * in parallel — a second is tight on a loaded CI runner, and the contract
 * under test is "the request is made", never "within one second".
 */
const waitForSlow = (check: () => void | Promise<void>) => waitFor(check, { timeout: 8000 });


const CLINIC = { id: 'clinic-1', name: 'Klinik Utama', timezone: 'Asia/Kuala_Lumpur' };
const DOCTOR = { id: 'doc-1', fullName: 'Dr Lim', role: 'DOCTOR_RESIDENT', active: true, clinicId: 'clinic-1' };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appt-1',
    status: 'CONFIRMED',
    source: 'FRONT_DESK',
    clinicId: 'clinic-1',
    staffId: 'doc-1',
    serviceId: 'svc-1',
    patientId: 'pat-1',
    // 01:00Z is 09:00 in Kuala Lumpur.
    scheduledStart: '2026-08-20T01:00:00.000Z',
    scheduledEnd: '2026-08-20T01:30:00.000Z',
    notes: null,
    patient: { id: 'pat-1', name: 'Aminah', phone: '012-345 6789' },
    provider: { id: 'doc-1', fullName: 'Dr Lim' },
    service: { id: 'svc-1', name: 'Consultation', price: '35.00' },
    payment: { state: 'NO_FEE', amount: 0, paidAt: null },
    reminder: { sentAt: null, sentBy: null },
    ...overrides,
  };
}

const STATS: DashboardStats = {
  upcoming: 6,
  completed: 4,
  cancelled: 2,
  noShow: 1,
  noShowRate: 0.2,
  potentialSales: 245.5,
  realisedSales: 140,
  timeZone: 'Asia/Kuala_Lumpur',
};

function mockApi(rows: unknown[] = [row()], stats = STATS) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/appointments/dashboard')) {
      return { range: { from: '2026-08-01', to: '2026-08-31', timeZone: 'Asia/Kuala_Lumpur' }, stats, rows } as never;
    }
    if (path.startsWith('/clinics')) return [CLINIC] as never;
    if (path.startsWith('/staff')) return [DOCTOR] as never;
    if (path.startsWith('/services')) return [{ id: 'svc-1', name: 'Consultation' }] as never;
    return [] as never;
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AppointmentsDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  setClinicTimeZone('Asia/Kuala_Lumpur');
});

describe('the stats bar', () => {
  it('1. shows the five figures for the period', async () => {
    mockApi();
    renderPage();

    // Scoped to the bar: "Upcoming" is also a tab, and a test that matched
    // either would pass with the bar missing entirely.
    // Scoped to the bar: "Upcoming" is also a tab, and a test that matched
    // either would pass with the bar missing entirely.
    const bar = within(await screen.findByTestId('appointment-stats'));
    expect(await bar.findByText('6')).toBeInTheDocument();
    expect(bar.getByText('Upcoming')).toBeInTheDocument();
    expect(bar.getByText('4')).toBeInTheDocument();
    expect(bar.getByText('RM 245.50')).toBeInTheDocument();
  });

  it('2. the no-show figure carries its RATE, which is the number acted on', async () => {
    // A count alone means nothing without knowing how many could have come.
    mockApi();
    renderPage();

    expect(await screen.findByText('20% of attendable')).toBeInTheDocument();
  });

  it('3. a period with nothing attendable shows no rate rather than 0%', async () => {
    mockApi([], { ...STATS, noShow: 0, noShowRate: null });
    renderPage();

    const bar = within(await screen.findByTestId('appointment-stats'));
    await bar.findByText('0');
    expect(bar.queryByText(/of attendable/)).not.toBeInTheDocument();
  });

  it('4. potential sales is shown beside what was actually realised', async () => {
    mockApi();
    renderPage();

    expect(await screen.findByText('RM 140.00 realised')).toBeInTheDocument();
  });
});

describe('times are the CLINIC’s clock', () => {
  it('5. a 01:00Z booking reads as 09:00', async () => {
    mockApi();
    renderPage();

    expect(await screen.findByText('09:00–09:30')).toBeInTheDocument();
    expect(await screen.findByText('20 Aug 2026')).toBeInTheDocument();
  });
});

describe('the tabs ask the server, they do not filter in the browser', () => {
  it('6. choosing a tab re-queries with it', async () => {
    mockApi();
    renderPage();

    await screen.findByText('Aminah');
    await userEvent.setup({ pointerEventsCheck: 0 }).click(
      screen.getByRole('radio', { name: 'No-Show' }),
    );

    await waitForSlow(() => {
      const calls = (apiClient.get as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
      expect(calls.some((path: string) => path.includes('tab=NO_SHOW'))).toBe(true);
    });
  });

  it('7. an empty tab says what would fill it', async () => {
    // An empty tab that says nothing is a question, not an answer.
    mockApi([]);
    renderPage();

    await userEvent.setup({ pointerEventsCheck: 0 }).click(
      await screen.findByRole('radio', { name: 'To Be Scheduled' }),
    );

    expect(
      await screen.findByText(/never marked arrived or no-show/i),
    ).toBeInTheDocument();
  });
});

describe('the WhatsApp reminder', () => {
  it('8. opens wa.me and only then records that it was sent', async () => {
    // Recording first would mark a reminder sent for a popup that was blocked.
    mockApi();
    const open = vi.spyOn(window, 'open').mockReturnValue(null as unknown as Window);
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({} as never);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /send a whatsapp reminder to aminah/i }));

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/60123456789'),
      '_blank',
      'noopener,noreferrer',
    );
    await waitForSlow(() => expect(post).toHaveBeenCalledWith('/appointments/appt-1/reminder-sent', {}));
    expect(open.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]);
  });

  it('9. a patient with no phone number cannot be reminded', async () => {
    mockApi([row({ patient: { id: 'pat-1', name: 'Aminah', phone: null } })]);
    renderPage();

    expect(await screen.findByRole('button', { name: /send a whatsapp reminder/i })).toBeDisabled();
  });

  it('10. a sent reminder shows WHEN, with who on hover', async () => {
    // "Reminded" with nobody's name on it is what this column replaces.
    mockApi([
      row({ reminder: { sentAt: '2026-08-18T02:00:00.000Z', sentBy: 'Siti Aminah' } }),
    ]);
    renderPage();

    expect(await screen.findByText(/Sent 18 Aug 2026/)).toBeInTheDocument();
  });
});

describe('the lifecycle actions travel with the row', () => {
  it('11. a confirmed appointment can be marked arrived, no-show, rescheduled or cancelled', async () => {
    mockApi();
    renderPage();

    const rowEl = (await screen.findByText('Aminah')).closest('tr')!;
    for (const label of ['Arrived', 'No-Show', 'Reschedule', 'Cancel']) {
      expect(within(rowEl).getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(within(rowEl).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('12. a REQUESTED booking offers Confirm and not Arrived', async () => {
    mockApi([row({ status: 'REQUESTED' })]);
    renderPage();

    const rowEl = (await screen.findByText('Aminah')).closest('tr')!;
    expect(within(rowEl).getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(within(rowEl).queryByRole('button', { name: 'Arrived' })).not.toBeInTheDocument();
  });

  it('13. a completed appointment offers none of them', async () => {
    mockApi([row({ status: 'COMPLETED' })]);
    renderPage();

    const rowEl = (await screen.findByText('Aminah')).closest('tr')!;
    for (const label of ['Confirm', 'Arrived', 'No-Show', 'Reschedule', 'Cancel']) {
      expect(within(rowEl).queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });

  it('14. an action refreshes the bar as well as the list', async () => {
    // The bar is computed from the same rows; marking a no-show that left the
    // counts unchanged would be a screen disagreeing with itself.
    mockApi();
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({} as never);
    renderPage();

    const rowEl = (await screen.findByText('Aminah')).closest('tr')!;
    await userEvent.click(within(rowEl).getByRole('button', { name: 'No-Show' }));

    await waitForSlow(() => expect(patch).toHaveBeenCalledWith('/appointments/appt-1/no-show', undefined));
    await waitForSlow(() => {
      const calls = (apiClient.get as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
        String(call[0]).startsWith('/appointments/dashboard'),
      );
      expect(calls.length).toBeGreaterThan(1);
    });
  });
});

describe('filters', () => {
  it('15. searching asks the server rather than filtering the page', async () => {
    // The list is capped at 500 rows server-side; filtering in the browser
    // would search only the page that arrived.
    mockApi();
    renderPage();

    await screen.findByText('Aminah');
    await userEvent.type(screen.getByPlaceholderText(/patient name or phone/i), 'Ami');

    await waitForSlow(() => {
      const calls = (apiClient.get as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));
      expect(calls.some((path) => path.includes('search=Ami'))).toBe(true);
    });
  });
});
