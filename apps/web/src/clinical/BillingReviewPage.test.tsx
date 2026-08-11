// @vitest-environment jsdom
import { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { message } from 'antd';

const { get, post, patch, del, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status = 400, body?: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), MockApiError };
});

vi.mock('../core/api-client', () => ({
  ApiError: MockApiError,
  apiClient: { get, post, patch, put: vi.fn(), delete: del },
}));

import { BillingVisitPage } from './BillingVisitPage';
import { useAuthStore } from '../core/auth-store';
import { BillingWorld, freshWorld, MemoryRoute, renderWithClient } from './test-utils/billingReviewHarness';

const world: BillingWorld = freshWorld();

function resetApiMocks() {
  Object.assign(world, freshWorld());
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  del.mockReset();

  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/visits/') && url.endsWith('/billing-worklist')) return world.worklist;
    if (url.startsWith('/visits/') && url.endsWith('/completion-blockers')) return world.blockers;
    if (url.startsWith('/visits/')) return world.visit;
    if (url.startsWith('/invoices?')) return [world.invoice];
    return [];
  });
  post.mockImplementation(async (url: string) => {
    if (url.includes('ensure-consultation')) return { added: false, state: { kind: 'NOT_CONFIGURED' } };
    return world.invoice;
  });
  patch.mockImplementation(async () => world.invoice);
  del.mockImplementation(async () => world.invoice);
}

// ===========================================================================
// G4.5d3c-3b2 (D-094) — COUNTER BILLING REVIEW, as the counter sees it.
//
// The workspace renders the SERVER'S answers. These tests pin that it renders
// them faithfully, offers an action only where the server said the item is
// ready, hides finance-tier controls from front desk, refuses a waiver with
// no reason, and never offers payment the server would refuse.
// ===========================================================================

function asRole(role: string) {
  useAuthStore.setState({
    accessToken: 'test-token',
    refreshToken: null,
    staff: { id: 'staff-1', fullName: 'Test Staff', role, clinicId: 'clinic-1' },
    tenant: { id: 'tenant-1', name: 'Test Clinic', slug: 'test' },
  } as never);
}

const renderPage = (children: ReactNode = <BillingVisitPage />) =>
  renderWithClient(<MemoryRoute path="/billing/visits/:visitId" url="/billing/visits/visit-1">{children}</MemoryRoute>);

beforeEach(() => {
  // antd toasts render into a global container that RTL's cleanup does not
  // touch, so a success toast from the previous test would otherwise be the
  // first role="alert" the next test finds.
  message.destroy();
  resetApiMocks();
  asRole('FRONT_DESK_CLINICAL_STAFF');
});

describe('access', () => {
  it('4. a doctor is refused the counter billing workspace', async () => {
    asRole('DOCTOR_RESIDENT');
    renderPage();
    // A doctor holds CREATE_INVOICE/EDIT_LINES, so they reach the page —
    // what they must not get is the counter's corrective controls.
    await waitFor(() => expect(screen.getByText(/Billing review/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /overall discount/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^waive$/i })).not.toBeInTheDocument();
  });

  it('a role with no billing rights at all sees a 403', async () => {
    asRole('STOCK_STAFF');
    renderPage();
    expect(await screen.findByText(/do not have access to billing/i)).toBeInTheDocument();
  });

  it.each(['OWNER_ADMIN', 'FRONT_DESK_CLINICAL_STAFF', 'FINANCE_STAFF'])(
    '1/2/3. %s reaches the workspace',
    async (role) => {
      asRole(role);
      renderPage();
      expect(await screen.findByText(/Billing review/i)).toBeInTheDocument();
    },
  );
});

describe('the worklist', () => {
  it('12/13/14/16. each source shows its state, and only READY offers an action', async () => {
    world.worklist = [
      { sourceType: 'PRESCRIPTION', sourceId: 'rx-1', description: 'Amoxicillin', state: 'READY', stateReason: null, sourceStatus: 'DISPENSED', supplyMode: 'ONSITE_DISPENSE', billed: false, invoiceLineId: null, quantity: 10 },
      { sourceType: 'PRESCRIPTION', sourceId: 'rx-2', description: 'Paracetamol', state: 'AWAITING_DISPENSE', stateReason: 'Awaiting dispensing.', sourceStatus: 'ORDERED', supplyMode: 'ONSITE_DISPENSE', billed: false, invoiceLineId: null, quantity: 6 },
      { sourceType: 'PRESCRIPTION', sourceId: 'rx-3', description: 'Vitamin C', state: 'UNRESOLVED_SUPPLY', stateReason: 'Medication supply mode has not been confirmed.', sourceStatus: 'ORDERED', supplyMode: null, billed: false, invoiceLineId: null, quantity: 30 },
      { sourceType: 'PRESCRIPTION', sourceId: 'rx-4', description: 'Loratadine', state: 'NOT_CHARGEABLE', stateReason: 'Prescribed to an external pharmacy — not a clinic medication charge.', sourceStatus: 'ORDERED', supplyMode: 'EXTERNAL_PRESCRIPTION', billed: false, invoiceLineId: null, quantity: 5 },
    ];
    renderPage();

    expect(await screen.findByText('Ready to add')).toBeInTheDocument();
    expect(screen.getByText('Awaiting dispensing')).toBeInTheDocument();
    expect(screen.getByText('Supply mode not confirmed')).toBeInTheDocument();
    expect(screen.getByText('Not chargeable')).toBeInTheDocument();
    // Exactly one add button: the dispensed onsite medication.
    const addButtons = screen.getAllByRole('button', { name: /add .* to invoice/i });
    expect(addButtons).toHaveLength(1);
    expect(addButtons[0]).toHaveAccessibleName(/Amoxicillin/i);
  });

  it('26/31. adding a sourced item sends NO price and NO quantity', async () => {
    world.worklist = [
      { sourceType: 'PRESCRIPTION', sourceId: 'rx-1', description: 'Amoxicillin', state: 'READY', stateReason: null, sourceStatus: 'DISPENSED', supplyMode: 'ONSITE_DISPENSE', billed: false, invoiceLineId: null, quantity: 10 },
    ];
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /add .* to invoice/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/invoices/inv-1/lines', expect.anything()));
    const body = post.mock.calls.find((call) => String(call[0]).endsWith('/lines'))?.[1] as Record<string, unknown>;
    expect(body).toMatchObject({ sourcePrescriptionId: 'rx-1' });
    expect(body).not.toHaveProperty('unitPrice');
    expect(body).not.toHaveProperty('quantity');
  });

  it('24. an already-invoiced source says so and offers no second charge', async () => {
    world.worklist = [
      { sourceType: 'PRESCRIPTION', sourceId: 'rx-1', description: 'Amoxicillin', state: 'READY', stateReason: null, sourceStatus: 'DISPENSED', supplyMode: 'ONSITE_DISPENSE', billed: true, invoiceLineId: 'line-1', quantity: 10 },
    ];
    renderPage();
    expect(await screen.findByText('Already invoiced')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add .* to invoice/i })).not.toBeInTheDocument();
  });
});

describe('the consultation charge', () => {
  it('52/53. the workspace calls the idempotent ensure operation once per invoice', async () => {
    renderPage();
    await waitFor(() => expect(post).toHaveBeenCalledWith('/invoices/inv-1/ensure-consultation', {}));
    expect(post.mock.calls.filter((call) => String(call[0]).includes('ensure-consultation'))).toHaveLength(1);
  });

  it('51/97. an unresolvable tariff shows the review alert and blocks settlement', async () => {
    world.worklist = [
      { sourceType: 'CONSULTATION', sourceId: 'visit-1', description: 'Consultation', state: 'TARIFF_REVIEW', stateReason: 'No consultation tariff covers the time this consultation started.', sourceStatus: null, supplyMode: null, billed: false, invoiceLineId: null, quantity: 1 },
    ];
    world.invoice.patientResponsibilityAmount = '35.00';
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Consultation tariff requires review/i)).toBeInTheDocument();
    // Settlement is refused, and the reason is visible — not just disabled.
    const payButton = await screen.findByRole('button', { name: /collect/i });
    expect(payButton).toBeDisabled();
    expect(screen.getAllByText(/Consultation tariff requires review/i).length).toBeGreaterThan(1);
  });

  it('a waived consultation is reported and not re-added silently', async () => {
    world.worklist = [
      { sourceType: 'CONSULTATION', sourceId: 'visit-1', description: 'Consultation (Day)', state: 'WAIVED', stateReason: 'Consultation charge was waived.', sourceStatus: null, supplyMode: null, billed: false, invoiceLineId: 'line-9', quantity: 1 },
    ];
    renderPage();
    expect(await screen.findByText(/consultation charge was waived for this visit/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add .* to invoice/i })).not.toBeInTheDocument();
  });
});

describe('line correction', () => {
  beforeEach(() => {
    world.invoice.lines = [
      {
        id: 'line-1', invoiceId: 'inv-1', description: 'Consultation (Day)', quantity: 1, unitPrice: '35.00',
        amount: '35.00', sourceOrderServiceId: null, sourcePrescriptionId: null, sourceConsultationVisitId: 'visit-1',
        excludedFromPanel: false, cancelledAt: null, createdAt: '2026-08-04T02:10:00Z',
        panelResponsibilityAmount: null, patientResponsibilityAmount: '35.00',
      },
    ];
    world.invoice.patientResponsibilityAmount = '35.00';
  });

  it('58/83. a consultation line offers "Waive" and refuses to submit without a reason', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^waive$/i }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /waive charge/i }));

    expect(await within(dialog).findByText(/a reason is required/i)).toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();
  });

  it('58. a waiver with a reason sends it as the mandatory cancellation reason', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^waive$/i }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByTitle('Dressing-only visit'));
    await userEvent.click(within(dialog).getByRole('button', { name: /waive charge/i }));

    await waitFor(() =>
      expect(del).toHaveBeenCalledWith('/invoices/inv-1/lines/line-1', { cancelReason: 'Dressing-only visit' }),
    );
  });

  it('5/82. front desk sees no discount controls; finance does', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Billing summary/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /overall discount/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^discount$/i })).not.toBeInTheDocument();

    resetApiMocks();
    world.invoice.lines = [
      {
        id: 'line-1', invoiceId: 'inv-1', description: 'Consultation (Day)', quantity: 1, unitPrice: '35.00',
        amount: '35.00', sourceOrderServiceId: null, sourcePrescriptionId: null, sourceConsultationVisitId: 'visit-1',
        excludedFromPanel: false, cancelledAt: null, createdAt: '2026-08-04T02:10:00Z',
        panelResponsibilityAmount: null, patientResponsibilityAmount: '35.00',
      },
    ];
    world.invoice.patientResponsibilityAmount = '35.00';
    asRole('FINANCE_STAFF');
    renderPage();
    expect(await screen.findByRole('button', { name: /overall discount/i })).toBeInTheDocument();
  });

  it('85. a cancelled line stays visible as history and out of the totals', async () => {
    world.invoice.lines = [
      ...(world.invoice.lines as Array<Record<string, unknown>>),
      {
        id: 'line-2', invoiceId: 'inv-1', description: 'Nebuliser', quantity: 1, unitPrice: '20.00', amount: '20.00',
        sourceOrderServiceId: 'os-1', sourcePrescriptionId: null, excludedFromPanel: false,
        cancelledAt: '2026-08-04T03:00:00Z', cancelReason: 'Billing correction', createdAt: '2026-08-04T02:20:00Z',
        panelResponsibilityAmount: null, patientResponsibilityAmount: null,
      },
    ];
    renderPage();
    expect(await screen.findByText(/retained in financial history/i)).toBeInTheDocument();
    expect(screen.getByText(/Billing correction/)).toBeInTheDocument();
  });
});

describe('responsibility and payment', () => {
  it('66/95. an unresolved responsibility blocks payment in the approved wording', async () => {
    world.invoice.patientResponsibilityAmount = null;
    world.invoice.panelResponsibilityAmount = null;
    world.visit.panelClinicId = 'panel-1';
    world.visit.panelVerificationStatus = 'PENDING_VERIFICATION';
    renderPage();

    expect(
      (await screen.findAllByText(/Billing responsibility has not been confirmed/i)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /collect/i })).toBeDisabled();
  });

  it('68/70. the visit benefit snapshot is displayed, not the panel’s current settings', async () => {
    world.visit.panelClinicId = 'panel-1';
    world.visit.panelVerificationStatus = 'VERIFIED';
    world.visit.panelCoverageType = 'VISIT_LIMIT';
    world.visit.panelVisitLimitAmount = '200.00';
    world.visit.panelCopaymentType = 'PERCENTAGE';
    world.visit.panelCopaymentValue = '10';
    renderPage();

    expect(await screen.findByText('Verified')).toBeInTheDocument();
    expect(screen.getByText(/Visit limit · RM 200.00 per visit/)).toBeInTheDocument();
    expect(screen.getByText(/Percentage copayment · 10%/)).toBeInTheDocument();
  });

  it('8/9. front desk may verify but not override; finance may override', async () => {
    world.visit.panelClinicId = 'panel-1';
    renderPage();
    expect(await screen.findByRole('button', { name: /record verification/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /override terms/i })).not.toBeInTheDocument();

    resetApiMocks();
    world.visit.panelClinicId = 'panel-1';
    asRole('FINANCE_STAFF');
    renderPage();
    expect(await screen.findByRole('button', { name: /override terms/i })).toBeInTheDocument();
  });

  it('89. a cash payment settles the exact remaining balance, with no amount input', async () => {
    world.invoice.patientResponsibilityAmount = '35.00';
    renderPage();

    const payButton = await screen.findByRole('button', { name: /collect RM 35\.00/i });
    expect(payButton).toBeEnabled();
    // All-or-nothing: there is no partial-amount field anywhere.
    expect(screen.queryByLabelText(/amount to collect/i)).not.toBeInTheDocument();

    await userEvent.click(payButton);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/invoices/inv-1/pay', { paymentMethod: 'CASH' }));
  });

  it('93/94. PANEL is offered only at zero patient responsibility with a positive panel amount', async () => {
    world.invoice.patientResponsibilityAmount = '35.00';
    world.invoice.panelResponsibilityAmount = '0';
    renderPage();
    await userEvent.click(await screen.findByLabelText('Payment method'));
    expect(await screen.findByTitle('Panel — No Patient Payment')).toHaveAttribute('aria-disabled', 'true');
  });

  it('96. unbilled ready work prevents settlement and names the items', async () => {
    world.invoice.patientResponsibilityAmount = '35.00';
    world.worklist = [
      { sourceType: 'PRESCRIPTION', sourceId: 'rx-1', description: 'Amoxicillin', state: 'READY', stateReason: null, sourceStatus: 'DISPENSED', supplyMode: 'ONSITE_DISPENSE', billed: false, invoiceLineId: null, quantity: 10 },
    ];
    renderPage();
    expect(await screen.findByRole('button', { name: /collect/i })).toBeDisabled();
    expect(screen.getByText(/Add the remaining ready item before settling: Amoxicillin/i)).toBeInTheDocument();
  });

  it('99. settling never triggers Complete Visit', async () => {
    world.invoice.patientResponsibilityAmount = '35.00';
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /collect/i }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/invoices/inv-1/pay', expect.anything()));
    expect(patch.mock.calls.some((call) => String(call[0]).includes('/complete'))).toBe(false);
    expect(post.mock.calls.some((call) => String(call[0]).includes('/complete'))).toBe(false);
  });
});

describe('blockers', () => {
  it('every blocker names who resolves it and what to do', async () => {
    world.blockers = [
      { code: 'DISPENSING_PENDING', message: 'Medication dispensing is not complete.' },
      { code: 'PROCEDURE_PENDING', message: 'A procedure is still pending or in progress.' },
    ];
    renderPage();
    expect(await screen.findByText(/Medication dispensing is not complete/i)).toBeInTheDocument();
    expect(screen.getByText(/Dispensary ·/)).toBeInTheDocument();
    // Counter staff are never told to complete a procedure themselves.
    expect(screen.getByText(/must not mark it done/i)).toBeInTheDocument();
  });

  it('unbilled work is listed item by item, not as a generic complaint', async () => {
    world.blockers = [{ code: 'UNBILLED_CHARGEABLE_ITEMS', message: 'Billing contains items that have not been invoiced.' }];
    world.worklist = [
      { sourceType: 'ORDER_SERVICE', sourceId: 'os-1', description: 'Nebuliser', state: 'READY', stateReason: null, sourceStatus: 'COMPLETED', supplyMode: null, billed: false, invoiceLineId: null, quantity: 1 },
    ];
    renderPage();
    const blockerCard = await screen.findByText(/have not been invoiced/i);
    expect(blockerCard).toBeInTheDocument();
    expect(screen.getAllByText('Nebuliser').length).toBeGreaterThan(0);
  });
});

describe('internal pricing is never rendered', () => {
  it('the standard billing view shows no base price, markup or price rule', async () => {
    // A PANEL visit, so the split columns are rendered at all — this test is
    // about what must never appear beside them.
    world.visit.panelClinicId = 'panel-1';
    world.visit.panelVerificationStatus = 'VERIFIED';
    world.visit.panelCoverageType = 'UNLIMITED';
    world.invoice.panelResponsibilityAmount = '110.00';
    world.invoice.lines = [
      {
        id: 'line-1', invoiceId: 'inv-1', description: 'Amoxicillin', quantity: 10, unitPrice: '12.00',
        amount: '120.00', sourceOrderServiceId: null, sourcePrescriptionId: 'rx-1', excludedFromPanel: false,
        cancelledAt: null, createdAt: '2026-08-04T02:10:00Z',
        panelResponsibilityAmount: '110.00', patientResponsibilityAmount: '10.00',
        priceRule: 'CASH_PLUS_MARKUP', baseUnitPrice: '10.00', panelMarkupAmount: '2.00',
      } as never,
    ];
    renderPage();
    await waitFor(() => expect(screen.getByText('Amoxicillin')).toBeInTheDocument());
    expect(screen.queryByText(/CASH_PLUS_MARKUP/)).not.toBeInTheDocument();
    expect(screen.queryByText(/markup/i)).not.toBeInTheDocument();
    expect(screen.queryByText('RM 10.00 base')).not.toBeInTheDocument();
    // The final charge and the split ARE shown.
    expect(screen.getByText('RM 12.00')).toBeInTheDocument();
    // The panel share appears on the line AND in the summary — both are the
    // server's persisted figure, neither is a derivation.
    expect(screen.getAllByText('RM 110.00').length).toBeGreaterThan(0);
  });
});
