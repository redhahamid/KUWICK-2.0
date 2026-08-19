// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppointmentDetailPanel } from './AppointmentDetailPanel';
import { apiClient } from '../../core/api-client';
import { setClinicTimeZone } from '../../clinical/clinicTime';
import { Appointment } from '../types';
import { AppointmentStatus } from '@kuwick/shared';

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'appt-1',
    tenantId: 't1',
    clinicId: 'clinic-1',
    patientId: 'pat-1',
    staffId: 'doc-1',
    serviceId: 'svc-1',
    status: 'CONFIRMED',
    source: 'FRONT_DESK',
    // 01:00Z is 09:00 in Kuala Lumpur.
    scheduledStart: '2026-08-20T01:00:00.000Z',
    scheduledEnd: '2026-08-20T01:30:00.000Z',
    notes: 'Sore throat',
    cancelReason: null,
    arrivedAt: null,
    rescheduledFromId: null,
    visitId: null,
    ...overrides,
  } as Appointment;
}

function renderPanel(value: Appointment | null, onReschedule = vi.fn(), onChanged = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/appointments']}>
        <Routes>
          <Route
            path="/appointments"
            element={
              <AppointmentDetailPanel
                appointment={value}
                patientName="Aminah"
                staffName="Dr Lim"
                serviceName="Consultation"
                onReschedule={onReschedule}
                onChanged={onChanged}
                onClose={vi.fn()}
              />
            }
          />
          <Route path="/patients/:id" element={<div>PATIENT RECORD</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, onReschedule, onChanged };
}

beforeEach(() => {
  vi.restoreAllMocks();
  setClinicTimeZone('Asia/Kuala_Lumpur');
});

describe('the panel says what the appointment is', () => {
  it('1. with nothing selected it invites a selection rather than showing blanks', async () => {
    renderPanel(null);
    expect(await screen.findByText(/select an appointment/i)).toBeInTheDocument();
  });

  it('2. times read in the CLINIC’s clock', async () => {
    renderPanel(appointment());
    expect(await screen.findByText(/09:00–09:30/)).toBeInTheDocument();
    expect(screen.getByText('20 Aug 2026 ·', { exact: false })).toBeInTheDocument();
  });

  it('3. the notes are shown — they are why the patient is coming', async () => {
    renderPanel(appointment());
    expect(await screen.findByText('Sore throat')).toBeInTheDocument();
  });

  it('4. a cancellation shows the reason it carries', async () => {
    renderPanel(appointment({ status: AppointmentStatus.CANCELLED, cancelReason: 'Patient rang' }));
    expect(await screen.findByText('Patient rang')).toBeInTheDocument();
  });
});

describe('what can be done to it depends on where it is', () => {
  it('5. a confirmed appointment offers arrived, reschedule, no-show and cancel', async () => {
    renderPanel(appointment());
    for (const label of ['Arrived', 'Reschedule', 'No-show', 'Cancel']) {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('6. a completed appointment offers none of them', async () => {
    renderPanel(appointment({ status: AppointmentStatus.COMPLETED }));
    await screen.findByText('Consultation');
    for (const label of ['Arrived', 'Reschedule', 'No-show', 'Cancel']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });

  it('7. arriving calls the same endpoint the list rows call', async () => {
    // One mutation, two surfaces — the calendar and the dashboard cannot
    // disagree about what "arrived" does.
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({} as never);
    const { onChanged } = renderPanel(appointment());

    await userEvent.click(await screen.findByRole('button', { name: 'Arrived' }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/appointments/appt-1/arrived', undefined));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('8. a refused action shows the server’s own sentence', async () => {
    const { ApiError } = await import('../../core/api-client');
    vi.spyOn(apiClient, 'patch').mockRejectedValue(
      new ApiError('This visit is already in the queue.', 409, null),
    );
    renderPanel(appointment(), vi.fn(), vi.fn());

    await userEvent.click(await screen.findByRole('button', { name: 'Arrived' }));

    expect(await screen.findByText('This visit is already in the queue.')).toBeInTheDocument();
  });
});

describe('open record goes to the RIGHT visit', () => {
  it('9. an arrived appointment opens the visit it became', async () => {
    // Not the patient's most recent visit, which is the wrong one the moment
    // they have two.
    renderPanel(appointment({ status: AppointmentStatus.ARRIVED, visitId: 'visit-9' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Open record' }));

    expect(await screen.findByText('PATIENT RECORD')).toBeInTheDocument();
  });

  it('10. before arrival there is no record to open, and the button says so', async () => {
    renderPanel(appointment());

    expect(await screen.findByRole('button', { name: 'Open patient' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open record' })).not.toBeInTheDocument();
  });
});
