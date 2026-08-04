// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { message } from 'antd';

const { get, post, patch, del, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    status = 400;
    body: unknown;
  }
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), MockApiError };
});

vi.mock('../core/api-client', () => ({
  ApiError: MockApiError,
  apiClient: { get, post, patch, put: vi.fn(), delete: del },
}));

import { ConsultationTariffsPage } from './ConsultationTariffsPage';
import { useAuthStore } from '../core/auth-store';
import { renderWithClient } from './test-utils/billingReviewHarness';

// ===========================================================================
// G4.5d3c-3b2 (D-094) — Clinic Settings → Consultation Tariffs.
//
// The configuration screen must represent the owner's real tariff shapes
// (day/night, midnight-crossing, per-classification) and must NOT become a
// second place prices live: a rule selects a SERVICE, never a price.
// ===========================================================================

const RULES = [
  {
    id: 'rule-day',
    clinicId: 'clinic-1',
    name: 'Day consultation',
    active: true,
    classification: 'CONSULTATION',
    startTime: '08:00',
    endTime: '22:59',
    serviceCatalogId: 'svc-day',
    effectiveFrom: null,
    effectiveTo: null,
    serviceCatalog: { id: 'svc-day', name: 'Consultation (Day)', price: '35.00', active: true },
  },
  {
    id: 'rule-night',
    clinicId: 'clinic-1',
    name: 'Night consultation',
    active: true,
    classification: 'CONSULTATION',
    startTime: '23:00',
    endTime: '07:59',
    serviceCatalogId: 'svc-night',
    effectiveFrom: null,
    effectiveTo: null,
    serviceCatalog: { id: 'svc-night', name: 'Consultation (Night)', price: '50.00', active: true },
  },
];

const SERVICES = [
  { id: 'svc-day', name: 'Consultation (Day)', price: '35.00', active: true, orderType: 'STANDARD_SERVICE', durationMinutesDefault: 15 },
  { id: 'svc-night', name: 'Consultation (Night)', price: '50.00', active: true, orderType: 'STANDARD_SERVICE', durationMinutesDefault: 15 },
];

beforeEach(() => {
  message.destroy();
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  del.mockReset();
  useAuthStore.setState({
    accessToken: 'test-token',
    staff: { id: 'staff-1', fullName: 'Faiz Finance', role: 'FINANCE_STAFF', clinicId: 'clinic-1' },
    tenant: { id: 'tenant-1', name: 'Test Clinic', slug: 'test' },
  } as never);
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/consultation-tariff-rules')) return RULES;
    if (url.startsWith('/services')) return SERVICES;
    if (url.startsWith('/clinics')) return [{ id: 'clinic-1', name: 'Klinik Kuwick Bangsar' }];
    return [];
  });
  post.mockImplementation(async () => RULES[0]);
  patch.mockImplementation(async () => RULES[0]);
  del.mockImplementation(async () => ({ ...RULES[0], active: false }));
});

describe('consultation tariff configuration screen', () => {
  it('45/46/47. the owner’s day/night shapes are representable and readable', async () => {
    renderWithClient(<ConsultationTariffsPage />);
    expect(await screen.findByText('Day consultation')).toBeInTheDocument();
    expect(screen.getByText('08:00 – 22:59')).toBeInTheDocument();
    expect(screen.getByText('Night consultation')).toBeInTheDocument();
    expect(screen.getByText('23:00 – 07:59')).toBeInTheDocument();
  });

  it('38. a midnight-crossing band is labelled as such', async () => {
    renderWithClient(<ConsultationTariffsPage />);
    expect(await screen.findByText('Crosses midnight')).toBeInTheDocument();
  });

  it('the screen shows which SERVICE is charged and its cash price — it does not set a price', async () => {
    renderWithClient(<ConsultationTariffsPage />);
    expect(await screen.findByText('Consultation (Day)')).toBeInTheDocument();
    expect(screen.getByText('Cash RM 35.00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /add tariff/i }));
    const drawer = await screen.findByRole('dialog');
    // A tariff rule has no price input: pricing stays with the service and
    // the panel price overrides.
    expect(within(drawer).queryByLabelText(/price/i)).not.toBeInTheDocument();
    expect(within(drawer).getByLabelText(/consultation service/i)).toBeInTheDocument();
  });

  it('a new rule posts the band, classification and service — and no price', async () => {
    renderWithClient(<ConsultationTariffsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /add tariff/i }));
    const drawer = await screen.findByRole('dialog');

    await userEvent.type(within(drawer).getByLabelText(/rule name/i), 'Public holiday');
    await userEvent.click(within(drawer).getByLabelText(/consultation service/i));
    await userEvent.click(await screen.findByTitle(/Consultation \(Night\)/));
    await userEvent.click(within(drawer).getByRole('button', { name: /save/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/consultation-tariff-rules', expect.anything()));
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    expect(body).toMatchObject({
      clinicId: 'clinic-1',
      name: 'Public holiday',
      classification: 'CONSULTATION',
      startTime: '08:00',
      endTime: '22:59',
      serviceCatalogId: 'svc-night',
    });
    expect(body).not.toHaveProperty('price');
  });

  it('deactivation is offered instead of deletion', async () => {
    renderWithClient(<ConsultationTariffsPage />);
    const buttons = await screen.findAllByRole('button', { name: /deactivate/i });
    expect(buttons.length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it('a branch with no tariff says consultation billing is off, not broken', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/consultation-tariff-rules')) return [];
      if (url.startsWith('/services')) return SERVICES;
      return [];
    });
    renderWithClient(<ConsultationTariffsPage />);
    expect(await screen.findByText(/No consultation tariff is configured/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is guessed in the meantime/i)).toBeInTheDocument();
  });
});
