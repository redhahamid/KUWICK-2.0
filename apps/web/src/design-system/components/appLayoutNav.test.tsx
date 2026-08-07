// @vitest-environment jsdom
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ===========================================================================
// G4.5d5b-3 — WHO IS OFFERED THE DISPENSARY
//
// The server authorises every dispensary request and refuses what this list
// gets wrong, so these tests are about what is OFFERED. A link that always
// refuses teaches staff to ignore refusals, after which "not you" stops being
// distinguishable from "something is broken".
// ===========================================================================

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { AppLayout } from './AppLayout';
import { useAuthStore } from '../../core/auth-store';

function signIn(role: string) {
  useAuthStore.setState({
    accessToken: 'token',
    refreshToken: 'refresh',
    staff: { id: 'staff-1', fullName: 'Test User', role, clinicId: 'clinic-1' },
    tenant: { id: 'tenant-1', name: 'Klinik Hijraa', slug: null },
  });
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue([]);
});

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/queue']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/queue" element={<div>queue</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the top-level navigation', () => {
  it('79. offers the Dispensary to the counter roles', () => {
    signIn('FRONT_DESK_CLINICAL_STAFF');
    renderLayout();
    expect(screen.getByRole('link', { name: 'Dispensary' }).getAttribute('href')).toBe('/dispensary');
  });

  it('80. offers it to a doctor, who dispenses in a small clinic', () => {
    signIn('DOCTOR_RESIDENT');
    renderLayout();
    expect(screen.getByRole('link', { name: 'Dispensary' })).toBeTruthy();
  });

  it('81. offers it to stock staff, who may look but not hand over', () => {
    // Reading the board is how they see the demand they are about to fill.
    signIn('STOCK_STAFF');
    renderLayout();
    expect(screen.getByRole('link', { name: 'Dispensary' })).toBeTruthy();
  });

  it('82. withholds it from finance', () => {
    signIn('FINANCE_STAFF');
    renderLayout();
    expect(screen.queryByRole('link', { name: 'Dispensary' })).toBeNull();
  });

  it('83. leaves the existing navigation exactly as it was', () => {
    // A new entry beside Queue, and nothing moved or renamed.
    signIn('FINANCE_STAFF');
    renderLayout();
    for (const label of ['Appointments', 'Patients', 'Queue', 'Tasks']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
  });
});
