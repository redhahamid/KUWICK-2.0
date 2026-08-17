// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MedicationsRail } from './sections/MedicationsRail';
import { CanvasQuickNav } from './CanvasQuickNav';
import { useSetSupplyMode } from './hooks/usePrescriptions';
import { renderHook, act } from '@testing-library/react';
import { Prescription } from './types';

// ===========================================================================
// G4.5d3c-3a1 (D-091) — SUPPLY MODE IN THE DOM
//
// The rail's rows, badges and Dispense gating; the hook's NARROW refresh; and
// the mobile quick-nav closure. Server rules are tested server-side — these
// tests pin what the doctor sees and what the browser refreshes.
// ===========================================================================

const { get, patch, post, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {}
  return { get: vi.fn(), patch: vi.fn(), post: vi.fn(), MockApiError };
});
vi.mock('../core/api-client', () => ({
  ApiError: MockApiError,
  apiClient: { get, patch, post, delete: vi.fn() },
}));

const RX = (over: Partial<Prescription>): Prescription =>
  ({
    id: 'rx-1',
    visitId: 'visit-1',
    quantity: 15,
    amount: '1',
    unit: 'tablet',
    frequency: 'TDS',
    durationDays: 5,
    status: 'ORDERED',
    supplyMode: null,
    item: { id: 'item-1', name: 'Ibuprofen 400mg' },
    ...over,
  }) as Prescription;

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderRail(prescriptions: Prescription[]) {
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/prescriptions?')) return prescriptions;
    return [];
  });
  return render(
    <Harness>
      <MedicationsRail visitId="visit-1" />
    </Harness>,
  );
}

describe('medication rows', () => {
  it('23. rows carry the user-facing supply wording — on hover, since b4', async () => {
    // b4 PIECE 1 compacted the row to one line and moved the RESOLVED supply
    // source to a title attribute. Deliberately a title and not a portal
    // tooltip: it stays in the DOM and in the accessibility tree, so the
    // wording is still there for a screen reader and for this test. The
    // UNRESOLVED state did not move — see the next case.
    renderRail([
      RX({ id: 'a', supplyMode: 'ONSITE_DISPENSE', item: { id: 'i1', name: 'Ibuprofen 400mg' } as never }),
      RX({ id: 'b', supplyMode: 'EXTERNAL_PRESCRIPTION', item: { id: 'i2', name: 'Cetirizine 10mg' } as never }),
      RX({ id: 'c', supplyMode: 'PATIENT_OWN_SUPPLY', item: { id: 'i3', name: 'Metformin 500mg' } as never }),
    ]);
    expect(await screen.findByTitle(/Dispense from clinic/)).toBeInTheDocument();
    expect(screen.getByTitle(/External prescription/)).toBeInTheDocument();
    expect(screen.getByTitle(/Patient already has medication/)).toBeInTheDocument();
  });

  it('4. a NULL mode reads as not confirmed, never as clinic dispensing', async () => {
    renderRail([RX({ supplyMode: null })]);
    expect(await screen.findByText('Supply mode not confirmed')).toBeInTheDocument();
    expect(screen.queryByText('Dispense from clinic')).not.toBeInTheDocument();
  });

  it('24. no raw enum value is rendered anywhere in the rail', async () => {
    const { container } = renderRail([
      RX({ id: 'a', supplyMode: 'ONSITE_DISPENSE' }),
      RX({ id: 'b', supplyMode: null }),
      RX({ id: 'c', supplyMode: 'NO_SUPPLY_REQUIRED', status: 'DISPENSED' }),
    ]);
    await screen.findByTitle(/Dispense from clinic/);
    // Including the STATUS chips — the rail used to print the raw enum. The
    // title attributes are checked too: moving text to hover must not be a
    // route for a raw enum to reappear where nobody is looking.
    expect(
      [...container.querySelectorAll('[title]')].map((el) => el.getAttribute('title')).join(' '),
    ).not.toMatch(/ONSITE_DISPENSE|EXTERNAL_PRESCRIPTION|PATIENT_OWN_SUPPLY|NO_SUPPLY_REQUIRED/);
    expect(container.textContent).not.toMatch(
      /ONSITE_DISPENSE|EXTERNAL_PRESCRIPTION|PATIENT_OWN_SUPPLY|NO_SUPPLY_REQUIRED|ORDERED|DISPENSED|CANCELLED/,
    );
  });

  it('the unresolved row is findable by the footer navigation', async () => {
    const { container } = renderRail([RX({ id: 'a', supplyMode: 'ONSITE_DISPENSE' }), RX({ id: 'b', supplyMode: null })]);
    await screen.findByText('Supply mode not confirmed');
    const marked = container.querySelectorAll('[data-unresolved-supply]');
    expect(marked).toHaveLength(1);
  });

  it('b4 — disclosure never collapses an unresolved row out of sight', async () => {
    // FOUND BY THE DENSITY MEASUREMENT, on the ten-medication fixture.
    //
    // D-091 kept this chip off hover because a warning behind an interaction
    // is a warning that gets missed. b4 Piece 1 then set the disclosure
    // threshold to five, and a tenth-in-the-list unresolved row went straight
    // into "+5 more" — the same information, behind a different click.
    //
    // Ten rows, the unresolved one LAST in the server's order, which is where
    // the fixture's oldest prescription lands. It has to be on screen without
    // expanding anything.
    const many = Array.from({ length: 9 }, (_, i) =>
      RX({ id: `r${i}`, supplyMode: 'ONSITE_DISPENSE', item: { id: `i${i}`, name: `Medicine ${i}` } as never }),
    );
    renderRail([...many, RX({ id: 'last', supplyMode: null, item: { id: 'iz', name: 'Paracetamol 500mg' } as never })]);

    expect(await screen.findByText('Supply mode not confirmed')).toBeInTheDocument();
    // The remainder is still collapsed — this is not "show everything", which
    // would give the rail back the height Piece 1 just reclaimed.
    expect(screen.getByRole('button', { name: '+5 more' })).toBeInTheDocument();
    expect(screen.getByText('Paracetamol 500mg')).toBeInTheDocument();
  });
});

describe('rail badges', () => {
  it('the two counts are separate tags with correct wording', async () => {
    renderRail([
      RX({ id: 'a', supplyMode: 'ONSITE_DISPENSE' }),
      RX({ id: 'b', supplyMode: 'ONSITE_DISPENSE' }),
      RX({ id: 'c', supplyMode: 'ONSITE_DISPENSE' }),
      RX({ id: 'd', supplyMode: null }),
    ]);
    expect(await screen.findByText('3 to dispense')).toBeInTheDocument();
    expect(screen.getByText('1 supply mode unresolved')).toBeInTheDocument();
  });

  it('an external prescription produces NO dispensing badge at all', async () => {
    renderRail([RX({ supplyMode: 'EXTERNAL_PRESCRIPTION' })]);
    await screen.findByTitle(/External prescription/);
    expect(screen.queryByText(/to dispense/)).not.toBeInTheDocument();
    expect(screen.queryByText(/unresolved/)).not.toBeInTheDocument();
  });
});

describe('dispense gating', () => {
  it('25a. ONSITE_DISPENSE + ORDERED offers Dispense', async () => {
    renderRail([RX({ supplyMode: 'ONSITE_DISPENSE' })]);
    expect(await screen.findByRole('button', { name: 'Dispense' })).toBeInTheDocument();
  });

  it.each([
    ['EXTERNAL_PRESCRIPTION', 'External prescription'],
    ['PATIENT_OWN_SUPPLY', 'Patient already has medication'],
    ['NO_SUPPLY_REQUIRED', 'No supply required'],
    ['DEFERRED', 'Deferred supply'],
  ])('25b. %s offers no Dispense action', async (mode, label) => {
    renderRail([RX({ supplyMode: mode as never })]);
    await screen.findByTitle(new RegExp(label));
    expect(screen.queryByRole('button', { name: 'Dispense' })).not.toBeInTheDocument();
  });

  it('25c. a NULL mode offers no Dispense action', async () => {
    renderRail([RX({ supplyMode: null })]);
    await screen.findByText('Supply mode not confirmed');
    expect(screen.queryByRole('button', { name: 'Dispense' })).not.toBeInTheDocument();
  });
});

describe('26/28. the hook refreshes narrowly and never completes anything', () => {
  /**
   * b4 PIECE B added the third key, deliberately.
   *
   * "Narrowly" was never a count — it is a rule about WHAT may be refetched:
   * nothing that feeds an editor holding unsaved text (C1/D-091). The draft
   * invoice feeds a read-only bottom bar, and a supply mode set is exactly
   * the change that moves what the visit costs, so leaving the bar stale
   * would put two different answers about the same prescription on one
   * screen. The clinical-notes assertion below is the rule, and it is
   * unchanged.
   */
  it('invalidates prescriptions, doctor-phase status and the draft — and nothing else', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidated: unknown[] = [];
    vi.spyOn(client, 'invalidateQueries').mockImplementation(async (filters) => {
      invalidated.push((filters as { queryKey: unknown[] }).queryKey);
    });
    patch.mockResolvedValue(RX({ supplyMode: 'EXTERNAL_PRESCRIPTION' }));

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSetSupplyMode('visit-1'), { wrapper });
    await act(() => result.current.mutateAsync({ id: 'rx-1', dto: { supplyMode: 'EXTERNAL_PRESCRIPTION' } }));

    expect(invalidated).toEqual([
      ['prescriptions', 'visit-1'],
      ['doctor-phase-status', 'visit-1'],
      ['invoice-draft', 'visit-1'],
    ]);
    // 29-31 rest on this line: the clinical-notes query is NOT invalidated, so
    // no refetch can carry a server seed toward an editor holding a draft.
    expect(JSON.stringify(invalidated)).not.toContain('clinical-notes');

    // 28 — the only network call is the supply-mode PATCH. Nothing here can
    // invoke doctor completion.
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][0]).toBe('/prescriptions/rx-1/supply-mode');
  });
});

describe('mobile quick-nav closure', () => {
  it('33. a tapped tab scrolls itself fully into view', async () => {
    const user = userEvent.setup();
    render(<CanvasQuickNav />);
    const scrolls: ScrollIntoViewOptions[] = [];
    const spy = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(function (this: Element, options?: boolean | ScrollIntoViewOptions) {
        scrolls.push(options as ScrollIntoViewOptions);
      });
    await user.click(screen.getByRole('button', { name: 'Medications' }));
    // First the tab itself (inline: nearest), then the section.
    expect(scrolls[0]).toMatchObject({ inline: 'nearest' });
    spy.mockRestore();
  });

  it('34. short labels exist for the crowded names, full names stay accessible', () => {
    render(<CanvasQuickNav />);
    const meds = screen.getByRole('button', { name: 'Medications' });
    expect(within(meds).getByText('Meds')).toBeInTheDocument();
    expect(within(meds).getByText('Medications')).toBeInTheDocument();
    const dx = screen.getByRole('button', { name: 'Diagnosis' });
    expect(within(dx).getByText('Dx')).toBeInTheDocument();
    // Names without a short form are unchanged.
    expect(screen.getByRole('button', { name: 'Orders' })).toBeInTheDocument();
  });

  it('the nav names itself for assistive tech', () => {
    render(<CanvasQuickNav />);
    expect(screen.getByRole('navigation', { name: /jump to a section/i })).toBeInTheDocument();
  });
});
