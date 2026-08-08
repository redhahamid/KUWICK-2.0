// @vitest-environment jsdom
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

import { QueueManagementPage } from './QueueManagementPage';
import { useAuthStore } from '../core/auth-store';
import { MemoryRoute, renderWithClient } from './test-utils/billingReviewHarness';

// ===========================================================================
// G4.5d3c-3b (D-095) — THE SIX-STAGE QUEUE.
//
// The defect: three statuses matched no filter, so a patient the doctor had
// finished with vanished from the board. Pinned here: every stage renders,
// Complete Visit is offered only where the SERVER said so, a blocked row
// states its reason, and completed history carries no completion action.
// ===========================================================================

interface BoardRow {
  ticketId: string;
  visitId: string;
  displayNumber: string;
  status: string;
  stage: string | null;
  atProcedure?: boolean;
  legacyStatus?: boolean;
  patientName: string;
  patientId: string;
  doctorName: string | null;
  billingType: string;
  panelName?: string | null;
  checkInAt: string;
  checkOutAt?: string | null;
  doctorCompletedAt?: string | null;
  dispensing?: { onsiteTotal: number; dispensed: number; remaining: number };
  billing?: Record<string, unknown>;
  blockers?: Array<{ code: string; message: string }> | null;
  canComplete?: boolean;
}

function row(patch: Partial<BoardRow> & { ticketId: string }): BoardRow {
  return {
    visitId: `v-${patch.ticketId}`,
    displayNumber: 'W001',
    status: 'READY_FOR_PAYMENT',
    stage: 'PAYMENT',
    atProcedure: false,
    legacyStatus: false,
    patientName: 'Nur Aisyah binti Kamal',
    patientId: 'p-1',
    doctorName: 'Dr Amira',
    billingType: 'Self-pay',
    panelName: null,
    checkInAt: '2026-08-04T02:00:00Z',
    checkOutAt: null,
    doctorCompletedAt: '2026-08-04T02:30:00Z',
    dispensing: { onsiteTotal: 0, dispensed: 0, remaining: 0 },
    billing: {
      grandTotal: '123.00', panelResponsibility: '0.00', patientResponsibility: '123.00',
      remainingBalance: '0.00', state: 'SETTLED', invoiceId: 'inv-1', invoiceNumber: 'INV-000123',
    },
    blockers: [],
    canComplete: true,
    ...patch,
  } as BoardRow;
}

const world: {
  rows: BoardRow[];
  counts: Record<string, number>;
  mayCompleteVisits: boolean;
  tickets: Array<Record<string, unknown>>;
} = { rows: [], counts: {}, mayCompleteVisits: true, tickets: [] };

function ticket(id: string, status: string) {
  return {
    id, tenantId: 't', clinicId: 'clinic-1', visitId: `v-${id}`, ticketNumber: 1,
    displayNumber: 'W001', queueType: 'WALK_IN', status, location: null, roomId: null, room: null,
    calledAt: null, cancelReason: null, createdAt: '2026-08-04T02:00:00Z',
    visit: {
      id: `v-${id}`, patientId: 'p-1', visitNumber: 'V-000123', billingType: 'Self-pay',
      checkInAt: '2026-08-04T02:00:00Z', checkOutAt: null, presentingComplaint: 'Fever',
      patient: { id: 'p-1', name: 'Nur Aisyah binti Kamal', identifierValue: '900101-14-5566' },
      staff: { id: 's-1', fullName: 'Dr Amira' },
    },
  };
}

function asRole(role: string) {
  useAuthStore.setState({
    accessToken: 'test-token',
    staff: { id: 'staff-1', fullName: 'Test Staff', role, clinicId: 'clinic-1' },
    tenant: { id: 'tenant-1', name: 'Test Clinic', slug: 'test' },
  } as never);
}

const renderPage = () =>
  renderWithClient(
    <MemoryRoute path="/queue" url="/queue">
      <QueueManagementPage />
    </MemoryRoute>,
  );

beforeEach(() => {
  message.destroy();
  get.mockReset();
  patch.mockReset();
  post.mockReset();
  del.mockReset();
  world.rows = [];
  world.counts = { totalToday: 0, waiting: 0, consultation: 0, dispensary: 0, payment: 0, completed: 0, cancelled: 0 };
  world.mayCompleteVisits = true;
  world.tickets = [];
  asRole('FRONT_DESK_CLINICAL_STAFF');

  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/queue-tickets/board')) {
      return { rows: world.rows, counts: world.counts, mayCompleteVisits: world.mayCompleteVisits };
    }
    if (url.startsWith('/queue-tickets')) return world.tickets;
    if (url.startsWith('/clinics')) return [{ id: 'clinic-1', name: 'Klinik Kuwick Bangsar' }];
    if (url.startsWith('/staff')) return [{ id: 's-1', fullName: 'Dr Amira' }];
    return [];
  });
  patch.mockImplementation(async () => ({
    visitId: 'v-t1', checkOutAt: '2026-08-04T05:00:00Z', queueStatus: 'COMPLETED',
    completedByStaffId: 'staff-1', alreadyCompleted: false,
  }));
});

describe('stage tabs and counts', () => {
  it('10. the Overview shows a separate count for every stage', async () => {
    world.counts = { totalToday: 9, waiting: 2, consultation: 3, dispensary: 1, payment: 2, completed: 1, cancelled: 4 };
    renderPage();
    // Wait for the SERVER'S counts, not the zero fallback.
    expect(await screen.findByText('9')).toBeInTheDocument();
    for (const label of ['Total today', 'Waiting', 'Consultation', 'Dispensary', 'Payment', 'Completed']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('the Live Patient Flow reads in stage order and says stages may be skipped', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Live patient flow')).toBeInTheDocument());
    const flow = screen.getByText('Live patient flow').closest('.ant-card');
    expect(within(flow as HTMLElement).getByText(/1\. Waiting/)).toBeInTheDocument();
    expect(within(flow as HTMLElement).getByText(/5\. Completed/)).toBeInTheDocument();
    expect(screen.getByText(/may skip stages/i)).toBeInTheDocument();
  });

  it('64. the stage navigation carries an accessible name', async () => {
    renderPage();
    expect(await screen.findByRole('navigation', { name: /queue stages/i })).toBeInTheDocument();
  });

  it('1–6. all six stage tabs exist', async () => {
    world.counts = { totalToday: 4, waiting: 1, consultation: 1, dispensary: 1, payment: 1, completed: 0, cancelled: 0 };
    renderPage();
    await waitFor(() => expect(screen.getByRole('tab', { name: /Overview/ })).toBeInTheDocument());
    for (const name of [/Waiting \(/, /Consultation \(/, /Dispensary \(/, /Payment \(/, /Completed \(/]) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    // 9/11. The combined legacy tab is gone.
    expect(screen.queryByRole('tab', { name: /Dispensary & Payment/ })).not.toBeInTheDocument();
  });

  it('65. the active tab reports itself as selected', async () => {
    renderPage();
    const overview = await screen.findByRole('tab', { name: /Overview/ });
    expect(overview).toHaveAttribute('aria-selected', 'true');
  });

  it('3. AT_PROCEDURE appears under Consultation with an "At procedure" stage', async () => {
    world.tickets = [ticket('t1', 'AT_PROCEDURE')];
    world.counts = { ...world.counts, consultation: 1, totalToday: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Consultation \(1\)/ }));
    expect(await screen.findByText('At procedure')).toBeInTheDocument();
  });
});

describe('the dispensary stage', () => {
  it('4. a READY_FOR_DISPENSARY visit appears with its dispensing progress', async () => {
    world.rows = [
      row({
        ticketId: 't1', status: 'READY_FOR_DISPENSARY', stage: 'DISPENSARY',
        dispensing: { onsiteTotal: 4, dispensed: 1, remaining: 3 },
        blockers: [{ code: 'DISPENSING_PENDING', message: 'Medication dispensing is not complete.' }],
        canComplete: false,
      }),
    ];
    world.counts = { ...world.counts, dispensary: 1, totalToday: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Dispensary \(1\)/ }));
    expect(await screen.findByText('1 of 4 dispensed · 3 remaining')).toBeInTheDocument();
    // No fake queue-side bulk dispense action.
    expect(screen.queryByRole('button', { name: /mark all dispensed/i })).not.toBeInTheDocument();
  });

  it('G4.5d5c. the row offers ONE way in — Open Counter, deep-linked', async () => {
    // The dispenser must land on the right patient rather than searching a
    // board for a name they were just told across a counter. And exactly one
    // action: the operational workflow lives in the counter, not here.
    world.rows = [
      row({
        ticketId: 't1', visitId: 'visit-9', status: 'READY_FOR_DISPENSARY', stage: 'DISPENSARY',
        dispensing: { onsiteTotal: 2, dispensed: 0, remaining: 2 },
        canComplete: false,
      }),
    ];
    world.counts = { ...world.counts, dispensary: 1, totalToday: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Dispensary \(1\)/ }));
    const link = await screen.findByRole('link', { name: 'Open Counter' });
    expect(link).toHaveAttribute('href', '/dispensary?visitId=visit-9');
    // No competing actions in the same row.
    expect(screen.queryByRole('link', { name: 'Billing Review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Complete visit for/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/later checkpoint/i)).not.toBeInTheDocument();
  });

  it('G4.5d5b-3. the payment stage is not offered a dispensary link', async () => {
    // The hand-over has already happened; a link back to the counter there
    // would invite a second one.
    world.rows = [
      row({ ticketId: 't1', status: 'READY_FOR_PAYMENT', stage: 'PAYMENT', canComplete: true }),
    ];
    world.counts = { ...world.counts, payment: 1, totalToday: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Payment \(1\)/ }));
    await screen.findByRole('link', { name: 'Billing Review' });
    expect(screen.queryByRole('link', { name: 'Open in Dispensary' })).not.toBeInTheDocument();
  });

  it('27/48. a dispensing blocker is stated on the row, and completion is not offered here', async () => {
    world.rows = [
      row({
        ticketId: 't1', status: 'READY_FOR_DISPENSARY', stage: 'DISPENSARY',
        dispensing: { onsiteTotal: 2, dispensed: 0, remaining: 2 },
        blockers: [{ code: 'DISPENSING_PENDING', message: 'Medication dispensing is not complete.' }],
        canComplete: false,
      }),
    ];
    world.counts = { ...world.counts, dispensary: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Dispensary/ }));
    // G4.5d5c — Complete Visit belongs to the counter workspace, where the
    // staff member can actually resolve what is blocking it. The Queue states
    // the outstanding work and hands over.
    expect(await screen.findByText('0 of 2 dispensed · 2 remaining')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Complete visit for/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Counter' })).toBeInTheDocument();
  });
});

describe('the payment stage', () => {
  it('5/31. a payment row shows the money and the exact outstanding balance', async () => {
    world.rows = [
      row({
        ticketId: 't1',
        billing: {
          grandTotal: '123.00', panelResponsibility: '0.00', patientResponsibility: '123.00',
          remainingBalance: '123.00', state: 'BALANCE_DUE', invoiceId: 'inv-1', invoiceNumber: 'INV-1',
        },
        blockers: [{ code: 'PATIENT_BALANCE_REMAINING', message: 'Patient payment is still outstanding.' }],
        canComplete: false,
      }),
    ];
    world.counts = { ...world.counts, payment: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Payment \(1\)/ }));
    // The total and the outstanding balance are both RM 123.00 here, so the
    // assertion is on their presence rather than on a single node.
    expect((await screen.findAllByText('RM 123.00')).length).toBeGreaterThan(0);
    expect(screen.getByText('Patient balance due')).toBeInTheDocument();
  });

  it('an unresolved responsibility reads "Unresolved", never RM 0.00', async () => {
    world.rows = [
      row({
        ticketId: 't1',
        billing: {
          grandTotal: '123.00', panelResponsibility: null, patientResponsibility: null,
          remainingBalance: null, state: 'UNRESOLVED', invoiceId: 'inv-1', invoiceNumber: 'INV-1',
        },
        blockers: [{ code: 'BILLING_REVIEW_REQUIRED', message: 'Billing responsibility has not been confirmed.' }],
        canComplete: false,
      }),
    ];
    world.counts = { ...world.counts, payment: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));
    expect(await screen.findByText('Unresolved')).toBeInTheDocument();
    expect(screen.getByText('Responsibility not confirmed')).toBeInTheDocument();
  });

  it('33. a tariff-review visit is badged in the Payment workload, not a tab of its own', async () => {
    world.rows = [
      row({
        ticketId: 't1',
        blockers: [{ code: 'CONSULTATION_TARIFF_REVIEW_REQUIRED', message: 'Consultation tariff requires review.' }],
        canComplete: false,
      }),
    ];
    world.counts = { ...world.counts, payment: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));
    expect(await screen.findByText('Tariff review required')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /tariff/i })).not.toBeInTheDocument();
  });

  it('8. a legacy DISPENSARY_PAYMENT row is shown under Payment and labelled', async () => {
    world.rows = [row({ ticketId: 't1', status: 'DISPENSARY_PAYMENT', legacyStatus: true })];
    world.counts = { ...world.counts, payment: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));
    expect(await screen.findByText('Legacy')).toBeInTheDocument();
  });
});

describe('Complete Visit', () => {
  it('46/47. the action appears for an eligible row and comes from the server', async () => {
    world.rows = [row({ ticketId: 't1' })];
    world.counts = { ...world.counts, payment: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));
    const button = await screen.findByRole('button', { name: /Complete visit for/i });
    expect(button).toBeEnabled();
  });

  it('46. a role without completion permission is not shown the action at all', async () => {
    world.mayCompleteVisits = false;
    world.rows = [row({ ticketId: 't1', canComplete: false })];
    world.counts = { ...world.counts, payment: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));
    await waitFor(() => expect(screen.getByText('Nur Aisyah binti Kamal')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Complete visit for/i })).not.toBeInTheDocument();
  });

  it('49/50/67. the confirmation summarises the visit, shows RM 0.00 and never calls the panel share paid', async () => {
    world.rows = [
      row({
        ticketId: 't1',
        billing: {
          grandTotal: '250.00', panelResponsibility: '250.00', patientResponsibility: '0.00',
          remainingBalance: '0.00', state: 'SETTLED', invoiceId: 'inv-1', invoiceNumber: 'INV-1',
        },
      }),
    ];
    world.counts = { ...world.counts, payment: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Complete visit for/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Complete this Visit\?/)).toBeInTheDocument();
    expect(within(dialog).getByText('Nur Aisyah binti Kamal')).toBeInTheDocument();
    expect(within(dialog).getByText('RM 0.00')).toBeInTheDocument();
    expect(within(dialog).getByText(/Claimed from the panel by Finance/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/panel paid/i)).not.toBeInTheDocument();
  });

  it('35/36. confirming calls the authoritative completion endpoint', async () => {
    world.rows = [row({ ticketId: 't1' })];
    world.counts = { ...world.counts, payment: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Complete visit for/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Complete Visit$/ }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/visits/v-t1/complete', {}));
    // Never a queue-only shortcut that bypasses the completion service.
    expect(patch.mock.calls.some((c) => String(c[0]).includes('/queue-tickets/'))).toBe(false);
  });

  it('a server refusal shows the blockers it found rather than a generic failure', async () => {
    world.rows = [row({ ticketId: 't1' })];
    world.counts = { ...world.counts, payment: 1 };
    patch.mockRejectedValue(
      new MockApiError('Medication dispensing is not complete.', 400, {
        blockers: [{ code: 'DISPENSING_PENDING', message: 'Medication dispensing is not complete.' }],
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Complete visit for/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Complete Visit$/ }));

    expect(await within(dialog).findByText(/can no longer be completed/i)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Medication dispensing is not complete/i).length).toBeGreaterThan(0);
  });

  it('40. an already-completed visit reports that instead of completing twice', async () => {
    world.rows = [row({ ticketId: 't1' })];
    world.counts = { ...world.counts, payment: 1 };
    patch.mockResolvedValue({
      visitId: 'v-t1', checkOutAt: '2026-08-04T04:00:00Z', queueStatus: 'COMPLETED',
      completedByStaffId: 'staff-1', alreadyCompleted: true,
    });
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Complete visit for/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Complete Visit$/ }));
    expect(await screen.findByText(/already completed/i)).toBeInTheDocument();
  });
});

describe('blockers on the board', () => {
  it('32/66. an expanded row lists what is outstanding, announced as status', async () => {
    world.rows = [
      row({
        ticketId: 't1',
        blockers: [
          { code: 'UNBILLED_CHARGEABLE_ITEMS', message: 'Billing contains items that have not been invoiced.' },
          { code: 'PATIENT_BALANCE_REMAINING', message: 'Patient payment is still outstanding.' },
        ],
        billing: {
          grandTotal: '123.00', panelResponsibility: '0.00', patientResponsibility: '123.00',
          remainingBalance: '45.00', state: 'BALANCE_DUE', invoiceId: 'inv-1', invoiceNumber: 'INV-1',
        },
        canComplete: false,
      }),
    ];
    world.counts = { ...world.counts, payment: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Payment/ }));
    await userEvent.click(await screen.findByRole('button', { name: /expand row/i }));

    const panel = await screen.findByRole('status');
    expect(within(panel).getByText(/have not been invoiced/i)).toBeInTheDocument();
    // 31. The exact amount travels with the balance blocker.
    expect(within(panel).getByText(/RM 45\.00 outstanding/)).toBeInTheDocument();
    expect(within(panel).getAllByRole('button', { name: /Open Billing Review/i }).length).toBeGreaterThan(0);
  });
});

describe('completed history', () => {
  it('53. a completed row offers no completion action', async () => {
    world.rows = [
      row({
        ticketId: 't1', status: 'COMPLETED', stage: 'COMPLETED',
        checkOutAt: '2026-08-04T04:00:00Z', canComplete: false, blockers: null,
      }),
    ];
    world.counts = { ...world.counts, completed: 1 };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /Completed \(1\)/ }));
    await waitFor(() => expect(screen.getAllByText('Nur Aisyah binti Kamal').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /Complete visit for/i })).not.toBeInTheDocument();
    expect(screen.getAllByText('Open visit').length).toBeGreaterThan(0);
  });
});
