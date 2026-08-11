// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAddInvoiceLine, useBillingWorklist, useCreateInvoice, usePayInvoice } from './useInvoices';
import { useVisit } from './useVisits';

// ===========================================================================
// GUARDRAIL follow-up — what a billing mutation REFRESHES.
//
// This exists because of a defect found against the running app: adding the
// medication line from the billing worklist succeeded on the server (the line
// was on the invoice, verified in the database) while the worklist kept
// offering its "Add to invoice" button forever — the mutation invalidated
// only ['invoices'] and never ['billing-worklist'], so the screen told the
// counter something untrue. A retry loop clicked that button for 45 seconds.
//
// Same family as holdConsultation.test.tsx: the refresh contract is held by a
// test that counts real refetches and reads the rendered consequence, not by
// a key string nobody re-reads.
// ===========================================================================

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post, patch, delete: vi.fn() },
}));

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Reads the same surfaces the billing page does, and offers the mutations. */
function Screen() {
  const { data: worklist = [] } = useBillingWorklist('visit-1');
  const { data: visit } = useVisit('visit-1');
  const createInvoice = useCreateInvoice('visit-1');
  const addLine = useAddInvoiceLine('visit-1');
  const payInvoice = usePayInvoice('visit-1');
  const outstanding = worklist.filter((item) => !item.billed);
  return (
    <div>
      <div data-testid="outstanding">{outstanding.length}</div>
      <div data-testid="visit-status">{visit?.visitNumber ?? 'unknown'}</div>
      <button onClick={() => createInvoice.mutateAsync({ visitId: 'visit-1', createdByStaffId: 'staff-1' })}>
        create
      </button>
      <button
        onClick={() =>
          addLine.mutateAsync({
            invoiceId: 'inv-1',
            dto: { description: 'Paracetamol 500mg', sourcePrescriptionId: 'rx-1' },
          })
        }
      >
        add
      </button>
      <button onClick={() => payInvoice.mutateAsync({ invoiceId: 'inv-1', dto: { paymentMethod: 'CASH' } })}>
        pay
      </button>
    </div>
  );
}

/** Counts the reads of each surface, so "was it refetched" is a number. */
let worklistReads = 0;
let visitReads = 0;
/** What the server would report for the worklist on its NEXT read. */
let medicationBilled = false;

beforeEach(() => {
  worklistReads = 0;
  visitReads = 0;
  medicationBilled = false;
  get.mockImplementation((path: string) => {
    if (path.includes('billing-worklist')) {
      worklistReads += 1;
      return Promise.resolve([
        { sourceId: 'rx-1', sourceType: 'PRESCRIPTION', description: 'Paracetamol 500mg', state: 'READY', billed: medicationBilled },
      ]);
    }
    if (path.includes('completion-blockers')) return Promise.resolve([]);
    if (path.startsWith('/visits/')) {
      visitReads += 1;
      return Promise.resolve({ id: 'visit-1', visitNumber: 'V-0001' });
    }
    if (path.startsWith('/invoices')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
  post.mockImplementation(() => {
    // The server accepts the add — from here on the worklist reports billed.
    medicationBilled = true;
    return Promise.resolve({ id: 'inv-1' });
  });
  patch.mockResolvedValue({ id: 'inv-1', status: 'PAID' });
});

describe('billing mutations refresh the worklist the counter is looking at', () => {
  it('adding a sourced line refetches the worklist, and the outstanding item clears', async () => {
    render(<Screen />, { wrapper: Harness });
    await waitFor(() => expect(screen.getByTestId('outstanding')).toHaveTextContent('1'));
    const readsBefore = worklistReads;

    await userEvent.click(screen.getByText('add'));

    // The rendered consequence: the worklist was re-read and the server's
    // "billed" answer reached the screen, so nothing is offered twice.
    await waitFor(() => expect(screen.getByTestId('outstanding')).toHaveTextContent('0'));
    expect(worklistReads).toBeGreaterThan(readsBefore);
  });

  it('creating an invoice refetches the worklist on its own, without relying on ensure-consultation', async () => {
    render(<Screen />, { wrapper: Harness });
    await waitFor(() => expect(screen.getByTestId('outstanding')).toHaveTextContent('1'));
    const readsBefore = worklistReads;

    await userEvent.click(screen.getByText('create'));

    await waitFor(() => expect(worklistReads).toBeGreaterThan(readsBefore));
  });

  it('paying refreshes the visit under its REAL key — plural visits, the one useVisit reads', async () => {
    render(<Screen />, { wrapper: Harness });
    await waitFor(() => expect(screen.getByTestId('visit-status')).toHaveTextContent('V-0001'));
    const readsBefore = visitReads;

    await userEvent.click(screen.getByText('pay'));

    // Before the fix this invalidated ['visit', id], which no query uses, and
    // the visit header went on telling the counter a stale status.
    await waitFor(() => expect(visitReads).toBeGreaterThan(readsBefore));
  });
});
