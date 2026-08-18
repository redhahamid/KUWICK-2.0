// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoiceRail } from './InvoiceRail';
import { invoiceDraftKey } from '../hooks/useInvoiceDraft';
import { DoctorPhaseStatus, InvoiceDraft, InvoiceDraftLine, Visit } from '../types';

// ===========================================================================
// b4 PIECE C — THE INVOICE CARD, IN A DOM.
//
// The surface moved from the sticky bottom bar into the rail; what it must do
// did not, and these are the same five assertions Piece B was accepted on:
//
//   1. every source auto-pulls into the card — medications with their
//      quantity × price, orders/procedures, direct services, consultation;
//   2. an OTC visit shows NO consultation charge, and says why;
//   3. a discount is applied WITH A REASON, and the reason is on screen;
//   4. editing a source updates the draft live — no remount, no reload;
//   5. the card is COMPACT at rest — group totals and the total — and the
//      itemised detail discloses in place, the way every rail card does.
//
// Plus the one thing Piece C changed: the card carries NO completion action.
// There is exactly one of those on the page and it is in the header band.
//
// The numbers are the server's. Nothing here re-computes a total, and a test
// that summed the lines itself would be asserting the fixture.
// ===========================================================================

const { get, patch } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));

vi.mock('../../core/api-client', async () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly body: unknown,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return { ApiError, apiClient: { get, patch } };
});

vi.mock('../../hr/hooks/useStaff', () => ({
  useStaff: () => ({ data: [{ id: 'dr-a', fullName: 'Amira Rahman', role: 'DOCTOR_RESIDENT' }] }),
}));

const { ApiError } = await import('../../core/api-client');

const VISIT = { id: 'visit-1', checkOutAt: null } as Visit;

const PHASE_STATUS: DoctorPhaseStatus = {
  visitId: 'visit-1',
  completed: false,
  doctorCompletedAt: null,
  doctorCompletedByStaffId: null,
  queueStatus: 'IN_CONSULTATION',
  blockers: [],
  documentationPending: false,
  documentationPendingAtCompletion: null,
  documentationPendingActorName: null,
  documentationPendingAt: null,
  destination: 'DISPENSARY',
  routingReason: 'DISPENSARY_REQUIRED',
};

const LINE = (over: Partial<InvoiceDraftLine> = {}): InvoiceDraftLine => ({
  sourceType: 'PRESCRIPTION',
  sourceId: 'rx-1',
  description: 'Amoxicillin 500mg',
  state: 'READY',
  stateReason: null,
  orderType: null,
  quantity: 1,
  unitPrice: 10,
  amount: 10,
  counted: true,
  billed: false,
  invoiceLineId: null,
  lineDiscountAmount: null,
  ...over,
});

const DRAFT = (over: Partial<InvoiceDraft> = {}): InvoiceDraft => ({
  visitId: 'visit-1',
  invoiceId: null,
  invoiceNumber: null,
  lines: [],
  subtotal: 0,
  discount: null,
  total: 0,
  unpricedCount: 0,
  ...over,
});

/** A visit with one of each source, priced by the server. */
const FULL_DRAFT = DRAFT({
  lines: [
    LINE({ sourceId: 'rx-1', description: 'Amoxicillin 500mg', quantity: 15, unitPrice: 0.5, amount: 7.5 }),
    LINE({
      sourceType: 'ORDER_SERVICE',
      sourceId: 'ord-1',
      description: 'Chest X-ray',
      orderType: 'TASK_ORDER',
      unitPrice: 60,
      amount: 60,
    }),
    LINE({
      sourceType: 'ORDER_SERVICE',
      sourceId: 'svc-1',
      description: 'Wound dressing',
      orderType: 'STANDARD_SERVICE',
      unitPrice: 25,
      amount: 25,
    }),
    LINE({
      sourceType: 'CONSULTATION',
      sourceId: 'visit-1',
      description: 'Consultation (Day)',
      unitPrice: 35,
      amount: 35,
    }),
  ],
  subtotal: 127.5,
  total: 127.5,
});

/**
 * One client per test, held OUTSIDE the component so a re-render cannot
 * silently replace the cache — which would make a "live update" assertion
 * pass by remounting, the very thing it is there to rule out.
 */
let client: QueryClient;

function Harness({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Routes the two reads the bar makes: the draft, and the phase status. */
function serveDraft(draft: InvoiceDraft, status: DoctorPhaseStatus = PHASE_STATUS) {
  get.mockImplementation(async (url: string) => {
    if (url.includes('/invoice-draft')) return draft;
    if (url.includes('/doctor-phase-status')) return status;
    throw new Error(`unexpected GET ${url}`);
  });
}

function renderCard() {
  return render(
    <Harness>
      <InvoiceRail visit={VISIT} />
    </Harness>,
  );
}

/** The card's own header total — the figure a doctor reads without opening anything. */
const total = () => screen.getByTestId('invoice-total');
const card = () => document.querySelector('.kw-rail-panel[data-panel="Invoice"]') as HTMLElement;
const expand = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByTestId('invoice-details-toggle'));
  return screen.findByTestId('invoice-breakdown');
};

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

// ---------------------------------------------------------------------------
describe('1. every billable source auto-pulls', () => {
  it('shows the running total at rest, without expanding anything', async () => {
    serveDraft(FULL_DRAFT);
    renderCard();
    await waitFor(() => expect(total()).toHaveTextContent('RM 127.50'));
    // Slim at rest: the breakdown is NOT in the DOM until it is asked for.
    expect(screen.queryByTestId('invoice-breakdown')).toBeNull();
  });

  it('lists medications, orders/procedures, direct services and the consultation', async () => {
    const user = userEvent.setup();
    serveDraft(FULL_DRAFT);
    renderCard();
    await waitFor(() => expect(total()).toHaveTextContent('RM 127.50'));

    const sheet = await expand(user);
    // Grouped under the SAME names the rail cards use, so a figure can be
    // checked against the card it came from.
    for (const group of ['Consultation', 'Direct Services', 'Orders / Procedures', 'Medications']) {
      expect(within(sheet).getByText(group)).toBeInTheDocument();
    }
    for (const item of ['Amoxicillin 500mg', 'Chest X-ray', 'Wound dressing', 'Consultation (Day)']) {
      expect(within(sheet).getByText(item, { exact: false })).toBeInTheDocument();
    }
  });

  it('a medication line shows quantity × price as well as its amount', async () => {
    const user = userEvent.setup();
    serveDraft(FULL_DRAFT);
    renderCard();
    const sheet = await expand(user);

    const row = sheet.querySelector('[data-source-type="PRESCRIPTION"]')!;
    expect(row.textContent).toContain('× 15');
    expect(row.textContent).toContain('RM 0.50');
    expect(row.textContent).toContain('RM 7.50');
  });

  it('an unpriced chargeable item is flagged on the CARD HEADER, not only inside', async () => {
    // A medication whose supply mode is undecided (D-091) has no price. The
    // total is therefore incomplete, and the card must say so at rest —
    // without the detail being opened.
    serveDraft(
      DRAFT({
        lines: [
          LINE({ unitPrice: 10, amount: 10 }),
          LINE({
            sourceId: 'rx-2',
            description: 'Loratadine 10mg',
            state: 'UNRESOLVED_SUPPLY',
            stateReason: 'Medication supply mode has not been confirmed.',
            unitPrice: null,
            amount: null,
            counted: false,
          }),
        ],
        subtotal: 10,
        total: 10,
        // ZERO, faithfully: `unpricedCount` counts COUNTED lines whose price
        // failed, and an undecided supply is uncounted. That is why this chip
        // used to stay silent on the state it exists for. PIECE 4 moved the
        // fix to the server — `notPricedCount` is every line that is real work
        // with no price on it — rather than leaving the browser to maintain
        // its own list of states that make a total incomplete.
        unpricedCount: 0,
        notPricedCount: 1,
      }),
    );
    renderCard();
    await waitFor(() =>
      expect(screen.getByTestId('invoice-unpriced')).toHaveTextContent('1 item not priced'),
    );
  });

  it('a line with no charge is listed WITH the reason, never silently dropped', async () => {
    const user = userEvent.setup();
    serveDraft(
      DRAFT({
        lines: [
          LINE({
            sourceType: 'ORDER_SERVICE',
            sourceId: 'ord-9',
            description: 'Nebuliser',
            orderType: 'TASK_ORDER',
            state: 'NOT_CHARGEABLE',
            stateReason: 'Cancelled — not chargeable.',
            unitPrice: null,
            amount: null,
            counted: false,
          }),
        ],
      }),
    );
    renderCard();
    const sheet = await expand(user);
    expect(within(sheet).getByText('Nebuliser')).toBeInTheDocument();
    expect(within(sheet).getByText('Cancelled — not chargeable.')).toBeInTheDocument();
    expect(within(sheet).getByText('No charge')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('2. OTC skips the consultation charge', () => {
  it('shows no consultation amount, and says why there is none', async () => {
    const user = userEvent.setup();
    serveDraft(
      DRAFT({
        lines: [
          LINE({ sourceId: 'rx-1', description: 'Paracetamol 500mg', unitPrice: 3, amount: 3 }),
          LINE({
            sourceType: 'CONSULTATION',
            sourceId: 'visit-1',
            description: 'Consultation',
            state: 'NOT_CHARGEABLE',
            stateReason: 'This kind of visit carries no consultation charge.',
            unitPrice: null,
            amount: null,
            counted: false,
          }),
        ],
        subtotal: 3,
        total: 3,
      }),
    );
    renderCard();
    await waitFor(() => expect(total()).toHaveTextContent('RM 3.00'));

    const sheet = await expand(user);
    const consultation = sheet.querySelector('[data-source-type="CONSULTATION"]')!;
    expect(consultation.getAttribute('data-counted')).toBe('false');
    expect(consultation.textContent).toContain('This kind of visit carries no consultation charge.');
    expect(consultation.textContent).toContain('No charge');
    // The consultation GROUP totals nothing, and the visit's total is the
    // medication alone — the assertion that would fail if the bar started
    // deciding for itself that an OTC visit is billable.
    expect(total()).toHaveTextContent('RM 3.00');
  });

  it('a non-OTC visit does carry it, from the same shape of payload', async () => {
    const user = userEvent.setup();
    serveDraft(FULL_DRAFT);
    renderCard();
    const sheet = await expand(user);
    const consultation = sheet.querySelector('[data-source-type="CONSULTATION"]')!;
    expect(consultation.getAttribute('data-counted')).toBe('true');
    expect(consultation.textContent).toContain('RM 35.00');
  });
});

// ---------------------------------------------------------------------------
describe('2a. a consultation the clinic is NOT charging for says so', () => {
  const NOT_CONFIGURED = DRAFT({
    lines: [
      LINE({ sourceId: 'rx-1', description: 'Amoxicillin 500mg', unitPrice: 10, amount: 10 }),
      LINE({
        sourceType: 'CONSULTATION',
        sourceId: 'visit-1',
        description: 'Consultation',
        state: 'NOT_CONFIGURED',
        stateReason:
          'No consultation charge has been added: this branch has no consultation tariff configured. ' +
          'Settings → Clinical → Consultation Tariffs.',
        unitPrice: null,
        amount: null,
        counted: false,
      }),
    ],
    subtotal: 10,
    total: 10,
  });

  it('names the gap on the card at rest — it is a fee the clinic meant to charge', async () => {
    // The staging report: orders + medications, no consultation, nothing
    // saying why. The chip is the answer to "why is this bill short?".
    serveDraft(NOT_CONFIGURED);
    renderCard();
    expect(await screen.findByTestId('invoice-consultation-gap')).toHaveTextContent(
      'Consultation not charged',
    );
  });

  it('shows the consultation as No charge, never as RM 0.00', async () => {
    serveDraft(NOT_CONFIGURED);
    renderCard();
    const row = await waitFor(() => {
      const found = card().querySelector('[data-group="CONSULTATION"]');
      expect(found).not.toBeNull();
      return found!;
    });
    // RM 0.00 reads as a consultation the clinic gave away for free.
    expect(row.textContent).not.toContain('RM 0.00');
    expect(row.textContent).toContain('No charge');
    expect(row.getAttribute('data-charged')).toBe('false');
  });

  it('the reason, and where to fix it, are in the detail in the server’s words', async () => {
    const user = userEvent.setup();
    serveDraft(NOT_CONFIGURED);
    renderCard();
    const sheet = await expand(user);
    expect(within(sheet).getByText(/no consultation tariff configured/i)).toBeInTheDocument();
    expect(within(sheet).getByText(/Consultation Tariffs/)).toBeInTheDocument();
  });

  it('an OTC visit gets NO gap chip — that one is a decision, not an omission', async () => {
    // A chip that fires on every OTC visit is a chip nobody reads, and the
    // exemption is already stated on the line with its reason.
    serveDraft(
      DRAFT({
        lines: [
          LINE({ sourceId: 'rx-1', unitPrice: 3, amount: 3 }),
          LINE({
            sourceType: 'CONSULTATION',
            sourceId: 'visit-1',
            description: 'Consultation',
            state: 'NOT_CHARGEABLE',
            stateReason: 'This kind of visit carries no consultation charge.',
            unitPrice: null,
            amount: null,
            counted: false,
          }),
        ],
        subtotal: 3,
        total: 3,
      }),
    );
    renderCard();
    await waitFor(() => expect(total()).toHaveTextContent('RM 3.00'));
    expect(screen.queryByTestId('invoice-consultation-gap')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('3. the discount is recorded with a reason', () => {
  const WITH_INVOICE = DRAFT({
    ...FULL_DRAFT,
    invoiceId: 'inv-1',
    invoiceNumber: 'INV-000001',
  });

  it('will not submit without a reason', async () => {
    const user = userEvent.setup();
    serveDraft(WITH_INVOICE);
    renderCard();
    // The control lives WITH the itemised bill it changes, which is also where
    // the refusal is worded when there is nothing to discount yet.
    await expand(user);
    await user.click(await screen.findByTestId('invoice-discount-button'));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Amount'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'Apply discount' }));

    expect(await screen.findByText('A discount must say why.')).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it('sends the type, the value and the reason, and then shows the reason on the invoice', async () => {
    const user = userEvent.setup();
    const discounted = DRAFT({
      ...WITH_INVOICE,
      discount: {
        type: 'PERCENTAGE',
        value: 10,
        amount: 12.75,
        reason: 'Regular dressing patient',
        byStaffId: 'dr-a',
        at: '2026-08-17T01:00:00.000Z',
      },
      total: 114.75,
    });
    serveDraft(WITH_INVOICE);
    patch.mockImplementation(async () => {
      serveDraft(discounted);
      return discounted;
    });
    renderCard();
    await expand(user);
    await user.click(await screen.findByTestId('invoice-discount-button'));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Amount'), '10');
    await user.type(within(dialog).getByLabelText('Reason'), 'Regular dressing patient');
    await user.click(within(dialog).getByRole('button', { name: 'Apply discount' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('/visits/visit-1/invoice-draft/discount', {
      type: 'PERCENTAGE',
      value: 10,
      reason: 'Regular dressing patient',
    });

    // The REASON is on the invoice, beside the amount it explains — not
    // hidden in a tooltip, where nobody audits it.
    await waitFor(() =>
      expect(screen.getByTestId('invoice-discount-row')).toHaveTextContent('Regular dressing patient'),
    );
    expect(screen.getByTestId('invoice-discount-row')).toHaveTextContent('RM 12.75');
    await waitFor(() => expect(total()).toHaveTextContent('RM 114.75'));
    // And the card header itself says a discount is in force, at rest.
    expect(screen.getByTestId('invoice-discount-chip')).toHaveTextContent('less RM 12.75 discount');
  });

  it("shows the server's refusal rather than inventing its own", async () => {
    const user = userEvent.setup();
    serveDraft(WITH_INVOICE);
    patch.mockRejectedValue(new ApiError('Your role may not apply a billing discount.', 403, {}));
    renderCard();
    await expand(user);
    await user.click(await screen.findByTestId('invoice-discount-button'));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Amount'), '10');
    await user.type(within(dialog).getByLabelText('Reason'), 'Regular dressing patient');
    await user.click(within(dialog).getByRole('button', { name: 'Apply discount' }));

    expect(await screen.findByText('Your role may not apply a billing discount.')).toBeInTheDocument();
  });

  it('explains, rather than offering a dead control, when no invoice exists yet', async () => {
    const user = userEvent.setup();
    serveDraft(FULL_DRAFT); // invoiceId: null
    renderCard();

    // No dead button at rest — and the reason is one click away rather than
    // spending five lines of a rail that is over its window. The words are the
    // server's rule, unchanged.
    expect(await screen.findByTestId('invoice-details-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('invoice-discount-button')).toBeNull();
    const sheet = await expand(user);
    expect(within(sheet).getByTestId('invoice-discount-unavailable')).toHaveTextContent(
      /no open invoice for this visit yet/i,
    );
  });
});

// ---------------------------------------------------------------------------
describe('4. editing a source updates the draft live', () => {
  it('a medication added to the rail moves the total without a remount', async () => {
    serveDraft(DRAFT({ lines: [LINE({ unitPrice: 10, amount: 10 })], subtotal: 10, total: 10 }));
    renderCard();
    await waitFor(() => expect(total()).toHaveTextContent('RM 10.00'));

    // Exactly what the rail's mutations do: invalidate the draft's query key
    // (`usePrescriptions`, `useOrderServices` and the billing hooks all call
    // it through `invoiceDraftKey`). No remount, no reload — the same mounted
    // bar has to move.
    const grown = DRAFT({
      lines: [LINE({ unitPrice: 10, amount: 10 }), LINE({ sourceId: 'rx-2', unitPrice: 5, amount: 5 })],
      subtotal: 15,
      total: 15,
    });
    serveDraft(grown);
    await client.invalidateQueries({ queryKey: invoiceDraftKey(VISIT.id) });
    await waitFor(() => expect(total()).toHaveTextContent('RM 15.00'));
  });
});

// ---------------------------------------------------------------------------
describe('5. compact at rest, and the detail discloses in place', () => {
  it('shows the group totals and the total without anything being opened', async () => {
    serveDraft(FULL_DRAFT);
    renderCard();
    await waitFor(() => expect(total()).toHaveTextContent('RM 127.50'));

    // One row per group — the four figures a doctor checks continuously — and
    // no itemised list until it is asked for. That is the card's whole budget
    // argument: the rail is measured with this card in it.
    for (const group of ['CONSULTATION', 'SERVICE', 'ORDER', 'MEDICATION']) {
      expect(card().querySelector(`[data-group="${group}"]`), group).not.toBeNull();
    }
    expect(within(card()).getByText('Total')).toBeInTheDocument();
    expect(screen.queryByTestId('invoice-breakdown')).toBeNull();
  });

  it('the detail opens INSIDE the card, in flow — no overlay, nothing fixed', async () => {
    const user = userEvent.setup();
    serveDraft(FULL_DRAFT);
    renderCard();
    const sheet = await expand(user);
    // The contract with canvas.css: an in-flow disclosure block inside the
    // rail panel, not a fixed sheet pinned to the viewport. jsdom does not lay
    // out, so containment and the class are what is assertable here; the e2e
    // case measures the geometry.
    expect(sheet.className).toContain('kw-invoice-detail');
    expect(card().contains(sheet)).toBe(true);
  });

  it('collapsing returns to the compact card', async () => {
    const user = userEvent.setup();
    serveDraft(FULL_DRAFT);
    renderCard();
    await expand(user);
    await user.click(screen.getByTestId('invoice-details-toggle'));
    await waitFor(() => expect(screen.queryByTestId('invoice-breakdown')).toBeNull());
    expect(total()).toHaveTextContent('RM 127.50');
  });

  it('carries NO completion action — there is exactly one of those and it is in the header', async () => {
    // The invariant Piece C has to keep. The bar used to hold both; the card
    // holds the money and nothing else, so the page cannot end up with two
    // ways to complete a consultation.
    serveDraft(FULL_DRAFT);
    renderCard();
    await waitFor(() => expect(total()).toHaveTextContent('RM 127.50'));
    expect(screen.queryByRole('button', { name: /Complete/i })).toBeNull();
    expect(screen.queryByTestId('consult-bar-blockers')).toBeNull();
  });

  it('an empty visit says so in one line, and offers no totals to read', async () => {
    serveDraft(DRAFT());
    renderCard();
    expect(await screen.findByText('Nothing chargeable added to this visit yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('invoice-details-toggle')).toBeNull();
  });
});
