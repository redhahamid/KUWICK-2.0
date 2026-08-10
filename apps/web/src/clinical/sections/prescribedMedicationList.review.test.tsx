// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrescribedMedicationList } from './PrescribedMedicationList';
import { Prescription } from '../types';

// ===========================================================================
// KW2-C2 — the "reviewed ✓" affordance on a carried-over medication.
//
// The owner's lifecycle in full: the flag is set on copy, and cleared EITHER
// by editing any field of the row OR by an explicit acknowledgement. Until
// this existed the flag could be set but never cleared from the UI, and a
// warning nobody can act on is worse than no warning.
//
// What these tests hold: the acknowledgement is attributed, it never travels
// as a client-chosen author, it is not offered where it makes no sense, and
// nothing about it blocks dispensing.
// ===========================================================================

const { patch, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {}
  return { patch: vi.fn(), MockApiError };
});

vi.mock('../../core/api-client', () => ({
  ApiError: MockApiError,
  apiClient: { patch, get: vi.fn(async () => []), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../inventory/hooks/useStock', () => ({ useStockLevels: () => ({ data: [] }) }));

vi.mock('../../hr/hooks/useStaff', () => ({
  useStaff: () => ({ data: [{ id: 'dr-a', fullName: 'Dr Amira Rahman', role: 'DOCTOR_RESIDENT' }] }),
}));

const RX = (over: Partial<Prescription> = {}): Prescription =>
  ({
    id: 'rx-1',
    visitId: 'visit-1',
    itemId: 'item-1',
    item: { id: 'item-1', name: 'Bromhexine 8mg' },
    quantity: 10,
    amount: '1',
    unit: 'tab',
    frequency: 'TDS',
    durationDays: 3,
    indication: null,
    remark: null,
    status: 'ORDERED',
    supplyMode: 'ONSITE_DISPENSE',
    prescribedAt: '2026-08-10T01:00:00.000Z',
    prescribedBy: { id: 'dr-a', fullName: 'Dr Amira Rahman' },
    sourceVisitId: null,
    reviewFlag: false,
    reviewedByStaffId: null,
    reviewedAt: null,
    ...over,
  }) as unknown as Prescription;

function renderList(prescriptions: Prescription[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Harness = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(
    <Harness>
      <PrescribedMedicationList visitId="visit-1" prescriptions={prescriptions} />
    </Harness>,
  );
}

beforeEach(() => patch.mockReset());

describe('a medication prescribed on this visit', () => {
  it('carries neither tag and is not asked about', () => {
    renderList([RX()]);
    expect(screen.queryByText('Carried over')).not.toBeInTheDocument();
    expect(screen.queryByText('Not reviewed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reviewed/i })).not.toBeInTheDocument();
  });
});

describe('a carried-over medication nobody has re-read', () => {
  const copied = () => RX({ sourceVisitId: 'visit-old', reviewFlag: true });

  it('says where it came from AND that nobody has looked', () => {
    renderList([copied()]);
    expect(screen.getByText('Carried over')).toBeInTheDocument();
    expect(screen.getByText('Not reviewed')).toBeInTheDocument();
  });

  it('offers the acknowledgement, and it PATCHes with no body to forge', async () => {
    patch.mockResolvedValue({ ...copied(), reviewFlag: false });
    renderList([copied()]);

    await userEvent.click(screen.getByRole('button', { name: /Reviewed/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));

    const [url, body] = patch.mock.calls[0];
    expect(url).toBe('/prescriptions/rx-1/reviewed');
    // Owner decision 4 — the acting user comes from the SESSION. There is
    // deliberately no payload at all, so no client can name a reviewer.
    expect(body).toBeUndefined();
  });

  it('never blocks dispensing', () => {
    // The flag is a question, not a gate. A copied medicine still reaches the
    // dispensary; refusing would only teach people to tick without reading.
    renderList([copied()]);
    expect(screen.getByRole('button', { name: 'Dispense' })).toBeEnabled();
  });

  it('is amber, not red — nobody said it is wrong, only that nobody looked', () => {
    const { container } = renderList([copied()]);
    const tag = within(container as HTMLElement).getByText('Not reviewed');
    expect(tag).toHaveClass('ant-tag-gold');
    expect(tag.className).not.toMatch(/ant-tag-red/);
  });

  it('names no interaction, allergy or contraindication check', () => {
    const { container } = renderList([copied()]);
    const hint = screen.getByRole('button', { name: /Reviewed/ });
    const words = `${container.textContent ?? ''} ${hint.getAttribute('title') ?? ''}`;
    for (const forbidden of [/interaction/i, /contraindicat/i, /unsafe/i]) {
      expect(words).not.toMatch(forbidden);
    }
  });

  it('a CANCELLED copy is not asked about', () => {
    renderList([RX({ sourceVisitId: 'visit-old', reviewFlag: true, status: 'CANCELLED' })]);
    expect(screen.getByText('Carried over')).toBeInTheDocument();
    expect(screen.queryByText('Not reviewed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reviewed/ })).not.toBeInTheDocument();
  });
});

describe('once it has been re-read', () => {
  const reviewed = () =>
    RX({
      sourceVisitId: 'visit-old',
      reviewFlag: false,
      reviewedByStaffId: 'dr-a',
      reviewedAt: '2026-08-10T01:14:00.000Z',
    });

  it('keeps the provenance and drops only the outstanding state', () => {
    renderList([reviewed()]);
    expect(screen.getByText('Carried over')).toBeInTheDocument();
    expect(screen.queryByText('Not reviewed')).not.toBeInTheDocument();
  });

  it('the acknowledgement is attributed to a person and a time', () => {
    const { container } = renderList([reviewed()]);
    const line = container.querySelector('[data-reviewed-line="true"]');
    expect(line?.textContent).toMatch(/^Re-read by Dr Amira Rahman · /);
  });

  it('cannot be pressed again — there is no un-review', () => {
    // "I have re-read this" is a statement about something that happened. A
    // toggle that takes it back would let the record claim it never did.
    renderList([reviewed()]);
    expect(screen.queryByRole('button', { name: /Reviewed/ })).not.toBeInTheDocument();
  });
});
