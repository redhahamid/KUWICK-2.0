// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ProviderAvailabilityPage } from './ProviderAvailabilityPage';
import { apiClient } from '../core/api-client';

/**
 * `waitFor` with room to breathe.
 *
 * testing-library's default is 1000ms. These assertions wait on a react-query
 * refetch inside a jsdom render of an antd Table, in a suite running 83 files
 * in parallel — a second is tight on a loaded CI runner, and the contract
 * under test is "the request is made", never "within one second".
 */
const waitForSlow = (check: () => void | Promise<void>) => waitFor(check, { timeout: 8000 });


// ===========================================================================
// A DOCTOR'S WEEK IS ONE STATEMENT.
//
// The screen this replaces was a table of individual roster rows with an Add
// drawer: "Dr Lim works Monday to Friday, 9 to 5" took five separate acts and
// could not be read at a glance. These tests pin the shape that fixed it —
// seven days always visible, days off saying so in words, and ONE save.
// ===========================================================================

const DOCTOR = { id: 'doc-1', fullName: 'Dr Lim', role: 'DOCTOR_RESIDENT', active: true, clinicId: 'clinic-1' };
const CLINIC = { id: 'clinic-1', name: 'Klinik Utama', timezone: 'Asia/Kuala_Lumpur' };

function mockApi(weekly: unknown[] = []) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/doctor-schedules/weekly')) return weekly as never;
    if (path.startsWith('/clinics')) return [CLINIC] as never;
    if (path.startsWith('/staff')) return [DOCTOR] as never;
    if (path.startsWith('/schedule-exceptions')) return [] as never;
    return [] as never;
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProviderAvailabilityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('the week is visible before it is edited', () => {
  it('1. nothing is asked for until a doctor is chosen', async () => {
    mockApi();
    renderPage();

    expect(await screen.findByText(/choose a doctor to set their hours/i)).toBeInTheDocument();
  });

  it('2. all seven days are listed, working or not', async () => {
    // A day off that renders as an absent row is indistinguishable from a row
    // that failed to load.
    mockApi([{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }]);
    renderPage();

    await userEvent.click(await screen.findByRole('combobox'));
    await userEvent.click(await screen.findByTitle('Dr Lim'));

    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      expect(await screen.findByText(day)).toBeInTheDocument();
    }
  });

  it('3. a day the doctor does not work says so in words', async () => {
    mockApi([{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }]);
    renderPage();

    await userEvent.click(await screen.findByRole('combobox'));
    await userEvent.click(await screen.findByTitle('Dr Lim'));

    // Six days off, one worked.
    await waitForSlow(() => expect(screen.getAllByText('Not working')).toHaveLength(6));
  });

  it('4. the header counts the working days', async () => {
    mockApi([
      { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
      { dayOfWeek: 2, startTime: '09:00', endTime: '17:00' },
    ]);
    renderPage();

    await userEvent.click(await screen.findByRole('combobox'));
    await userEvent.click(await screen.findByTitle('Dr Lim'));

    expect(await screen.findByText('2 days a week')).toBeInTheDocument();
  });
});

describe('saving is one act', () => {
  it('5. Save is disabled until something changes', async () => {
    mockApi([{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }]);
    renderPage();

    await userEvent.click(await screen.findByRole('combobox'));
    await userEvent.click(await screen.findByTitle('Dr Lim'));

    expect(await screen.findByRole('button', { name: /save weekly hours/i })).toBeDisabled();
  });

  it('6. turning a day on sends the WHOLE week, not a single row', async () => {
    // The replace-in-one-transaction property. A per-row save would leave a
    // week half-changed when the third request failed.
    mockApi([{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }]);
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue([] as never);
    renderPage();

    await userEvent.click(await screen.findByRole('combobox'));
    await userEvent.click(await screen.findByTitle('Dr Lim'));
    await userEvent.click(await screen.findByRole('switch', { name: 'Tuesday' }));
    await userEvent.click(await screen.findByRole('button', { name: /save weekly hours/i }));

    await waitForSlow(() => expect(put).toHaveBeenCalled());
    const body = put.mock.calls[0][1] as { days: { dayOfWeek: number }[] };
    expect(body.days.map((day) => day.dayOfWeek).sort()).toEqual([1, 2]);
  });

  it('7. turning the last day off sends an EMPTY week rather than nothing', async () => {
    // "This doctor works no days" is a statement. Sending no request would
    // leave the old roster standing and the screen lying about it.
    mockApi([{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }]);
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue([] as never);
    renderPage();

    await userEvent.click(await screen.findByRole('combobox'));
    await userEvent.click(await screen.findByTitle('Dr Lim'));
    await userEvent.click(await screen.findByRole('switch', { name: 'Monday' }));
    await userEvent.click(await screen.findByRole('button', { name: /save weekly hours/i }));

    await waitForSlow(() => expect(put).toHaveBeenCalled());
    expect((put.mock.calls[0][1] as { days: unknown[] }).days).toEqual([]);
  });
});
