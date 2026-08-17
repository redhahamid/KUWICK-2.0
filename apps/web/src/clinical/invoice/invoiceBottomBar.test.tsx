// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoiceBottomBar } from './InvoiceBottomBar';
import { invoiceDraftKey } from '../hooks/useInvoiceDraft';
import { DoctorPhaseStatus, InvoiceDraft, InvoiceDraftLine, Visit } from '../types';

// ===========================================================================
// b4 PIECE B — THE STICKY BOTTOM BAR, IN A DOM.
//
// The five things the owner asked for, asserted where a person would notice
// them going wrong:
//
//   1. every source auto-pulls into the breakdown — medications with their
//      quantity × price, orders/procedures, direct services, consultation;
//   2. an OTC visit shows NO consultation charge, and says why;
//   3. a discount is applied WITH A REASON, and the reason is on screen;
//   4. editing a source updates the draft live — no remount, no reload;
//   5. the bar is SLIM at rest and the breakdown is an overlay, so expanding
//      it never permanently costs the rail any height.
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

function renderBar(onReview = vi.fn()) {
  return {
    onReview,
    ...render(
      <Harness>
        <InvoiceBottomBar visit={VISIT} onReview={onReview} />
      </Harness>,
    ),
  };
}

const bar = () => screen.getByTestId('invoice-bar-total');
const expand = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(bar());
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
    renderBar();
    await waitFor(() => expect(bar()).toHaveTextContent('RM 127.50'));
    // Slim at rest: the breakdown is NOT in the DOM until it is asked for.
    expect(screen.queryByTestId('invoice-breakdown')).toBeNull();
  });

  it('lists medications, orders/procedures, direct services and the consultation', async () => {
    const user = userEvent.setup();
    serveDraft(FULL_DRAFT);
    renderBar();
    await waitFor(() => expect(bar()).toHaveTextContent('RM 127.50'));

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
    renderBar();
    const sheet = await expand(user);

    const row = sheet.querySelector('[data-source-type="PRESCRIPTION"]')!;
    expect(row.textContent).toContain('× 15');
    expect(row.textContent).toContain('RM 0.50');
    expect(row.textContent).toContain('RM 7.50');
  });

  it('an unpriced chargeable item is flagged on the BAR, not only inside', async () => {
    // A medication whose supply mode is undecided (D-091) has no price. The
    // total is therefore incomplete, and the bar must say so at rest.
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
        unpricedCount: 1,
      }),
    );
    renderBar();
    await waitFor(() =>
      expect(screen.getByTestId('invoice-bar-unpriced')).toHaveTextContent('1 item not priced yet'),
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
    renderBar();
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
    renderBar();
    await waitFor(() => expect(bar()).toHaveTextContent('RM 3.00'));

    const sheet = await expand(user);
    const consultation = sheet.querySelector('[data-source-type="CONSULTATION"]')!;
    expect(consultation.getAttribute('data-counted')).toBe('false');
    expect(consultation.textContent).toContain('This kind of visit carries no consultation charge.');
    expect(consultation.textContent).toContain('No charge');
    // The consultation GROUP totals nothing, and the visit's total is the
    // medication alone — the assertion that would fail if the bar started
    // deciding for itself that an OTC visit is billable.
    expect(bar()).toHaveTextContent('RM 3.00');
  });

  it('a non-OTC visit does carry it, from the same shape of payload', async () => {
    const user = userEvent.setup();
    serveDraft(FULL_DRAFT);
    renderBar();
    const sheet = await expand(user);
    const consultation = sheet.querySelector('[data-source-type="CONSULTATION"]')!;
    expect(consultation.getAttribute('data-counted')).toBe('true');
    expect(consultation.textContent).toContain('RM 35.00');
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
    renderBar();
    const sheet = await expand(user);

    await user.click(within(sheet).getByTestId('invoice-discount-button'));
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
    renderBar();
    const sheet = await expand(user);

    await user.click(within(sheet).getByTestId('invoice-discount-button'));
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
    await waitFor(() => expect(bar()).toHaveTextContent('RM 114.75'));
    // And the bar itself says a discount is in force, at rest.
    expect(screen.getByTestId('invoice-bar-discount')).toHaveTextContent('less RM 12.75 discount');
  });

  it("shows the server's refusal rather than inventing its own", async () => {
    const user = userEvent.setup();
    serveDraft(WITH_INVOICE);
    patch.mockRejectedValue(new ApiError('Your role may not apply a billing discount.', 403, {}));
    renderBar();
    const sheet = await expand(user);

    await user.click(within(sheet).getByTestId('invoice-discount-button'));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Amount'), '10');
    await user.type(within(dialog).getByLabelText('Reason'), 'Regular dressing patient');
    await user.click(within(dialog).getByRole('button', { name: 'Apply discount' }));

    expect(await screen.findByText('Your role may not apply a billing discount.')).toBeInTheDocument();
  });

  it('explains, rather than offering a dead control, when no invoice exists yet', async () => {
    const user = userEvent.setup();
    serveDraft(FULL_DRAFT); // invoiceId: null
    renderBar();
    const sheet = await expand(user);

    expect(within(sheet).queryByTestId('invoice-discount-button')).toBeNull();
    expect(within(sheet).getByTestId('invoice-discount-unavailable')).toHaveTextContent(
      /no open invoice for this visit yet/i,
    );
  });
});

// ---------------------------------------------------------------------------
describe('4. editing a source updates the draft live', () => {
  it('a medication added to the rail moves the total without a remount', async () => {
    serveDraft(DRAFT({ lines: [LINE({ unitPrice: 10, amount: 10 })], subtotal: 10, total: 10 }));
    renderBar();
    await waitFor(() => expect(bar()).toHaveTextContent('RM 10.00'));

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
    await waitFor(() => expect(bar()).toHaveTextContent('RM 15.00'));
  });
});

// ---------------------------------------------------------------------------
describe('5. slim at rest, and the expansion is an overlay', () => {
  it('carries the running total AND the completion action on one line', async () => {
    serveDraft(FULL_DRAFT);
    renderBar();
    await waitFor(() => expect(bar()).toHaveTextContent('RM 127.50'));
    // The one completion action, in its bar variant. It still names the
    // destination the server derived.
    expect(await screen.findByRole('button', { name: /Complete & Send to Dispensary/i })).toBeInTheDocument();
  });

  it('the breakdown is fixed to the viewport, so it takes no layout height', async () => {
    const user = userEvent.setup();
    serveDraft(FULL_DRAFT);
    renderBar();
    const sheet = await expand(user);
    // The CLASS is the contract with canvas.css, which pins it above the bar
    // at `bottom: var(--kw-invoice-bar-h)`. jsdom does not lay out, so the
    // class is what is assertable here; the e2e case measures the geometry.
    expect(sheet.className).toContain('kw-invoice-sheet');
  });

  it('collapsing returns to the slim bar', async () => {
    const user = userEvent.setup();
    serveDraft(FULL_DRAFT);
    renderBar();
    await expand(user);
    await user.click(bar());
    await waitFor(() => expect(screen.queryByTestId('invoice-breakdown')).toBeNull());
    expect(bar()).toHaveTextContent('RM 127.50');
  });

  it('Escape closes it and gives focus back to the control that opened it', async () => {
    const user = userEvent.setup();
    serveDraft(FULL_DRAFT);
    renderBar();
    await expand(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('invoice-breakdown')).toBeNull());
    expect(document.activeElement).toBe(bar());
  });

  it('a blocked completion still says how many items are outstanding, on the line', async () => {
    serveDraft(FULL_DRAFT, {
      ...PHASE_STATUS,
      blockers: [{ code: 'PROCEDURE_PENDING' }, { code: 'MEDICATION_SUPPLY_UNCONFIRMED' }],
    } as DoctorPhaseStatus);
    renderBar();
    const outstanding = await screen.findByTestId('consult-bar-blockers');
    expect(outstanding).toHaveTextContent('2 items outstanding');
    // And no completion action is offered while it is blocked.
    expect(screen.queryByRole('button', { name: /Complete &/i })).toBeNull();
  });

  it('the blockers themselves are one click away, with their review actions', async () => {
    const user = userEvent.setup();
    serveDraft(FULL_DRAFT, {
      ...PHASE_STATUS,
      blockers: [{ code: 'MEDICATION_SUPPLY_UNCONFIRMED' }],
    } as DoctorPhaseStatus);
    renderBar();
    await user.click(await screen.findByTestId('consult-bar-blockers'));
    // The clinic's own wording, from `doctorPhasePresentation` — not a
    // server string, and not re-worded for the bar.
    expect(await screen.findByText('Medication supply mode must be confirmed.')).toBeInTheDocument();
  });
});
