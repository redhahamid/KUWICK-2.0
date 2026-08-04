import { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender } from '@testing-library/react';

/**
 * G4.5d3c-3b2 (D-094) — the Billing Review test harness.
 *
 * The workspace is a READER of server state, so a test states a "world" and
 * asserts what the counter sees — never what the browser computed, because it
 * must not compute anything financial. The api-client mock itself lives in
 * the test file (vi.hoisted cannot be re-exported across modules); everything
 * that does not need hoisting lives here.
 *
 * First router-level page test in the suite: the page reads :visitId from the
 * route, so MemoryRouter is part of the harness rather than each test.
 */
export interface BillingWorld {
  visit: Record<string, unknown>;
  invoice: Record<string, unknown>;
  worklist: Array<Record<string, unknown>>;
  blockers: Array<Record<string, unknown>>;
}

export function freshWorld(): BillingWorld {
  return {
    visit: {
      id: 'visit-1',
      visitNumber: 'V-000123',
      billingType: 'Self-pay',
      checkInAt: '2026-08-04T02:00:00Z',
      checkOutAt: null,
      classification: null,
      panelClinicId: null,
      patient: { id: 'p-1', name: 'Nur Aisyah binti Kamal' },
      clinic: { id: 'clinic-1', name: 'Klinik Kuwick Bangsar' },
    },
    invoice: {
      id: 'inv-1',
      visitId: 'visit-1',
      invoiceNumber: 'INV-000123',
      status: 'UNPAID',
      totalAmount: '35.00',
      subtotalAmount: '35.00',
      patientPaidAmount: '0',
      panelCoveredAmount: '0',
      patientResponsibilityAmount: '35.00',
      panelResponsibilityAmount: '0',
      paidAt: null,
      paymentMethod: null,
      cancelReason: null,
      createdByStaffId: 'staff-1',
      createdAt: '2026-08-04T02:05:00Z',
      updatedAt: '2026-08-04T02:05:00Z',
      lines: [],
    },
    worklist: [],
    blockers: [],
  };
}

export function MemoryRoute({ path, url, children }: { path: string; url: string; children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={<>{children}</>} />
      </Routes>
    </MemoryRouter>
  );
}

export function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
