// @vitest-environment jsdom
import { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { DispensaryPage } from './DispensaryPage';

// ===========================================================================
// G4.5d5b-3 — THE DISPENSARY WORKSPACE
//
// The behaviour that matters here is mostly refusal: what the workspace does
// NOT do. It does not let a quantity be edited, it does not dispense without
// confirmation, it does not treat printing as dispensing, and it does not
// touch the clinical note. Each of those has a physical or a clinical
// consequence, and each is pinned below.
// ===========================================================================

const { get, post, patch, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    constructor(
      message: string,
      public readonly status = 400,
    ) {
      super(message);
    }
  }
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), MockApiError };
});
vi.mock('../../core/api-client', () => ({
  ApiError: MockApiError,
  apiClient: { get, post, patch, delete: vi.fn() },
}));

const CLINIC = { id: 'clinic-1', name: 'Klinik Hijraa' };

const medication = (over: Record<string, unknown> = {}) => ({
  prescriptionId: 'rx-1',
  itemId: 'item-1',
  name: 'Amoxicillin',
  strength: '500mg',
  doseAmount: '2',
  doseUnit: 'capsule',
  frequency: 'three times daily',
  durationDays: 5,
  quantity: 30,
  status: 'ORDERED',
  supplyMode: 'ONSITE_DISPENSE',
  prescriberName: 'Dr Amira Rahman',
  dispenserName: null,
  dispensedAt: null,
  stock: { onHand: 120, state: 'IN_STOCK', prescriptionUnit: 'capsule' },
  labelPrintCount: 0,
  lastPrintedAt: null,
  ...over,
});

const row = (over: Record<string, unknown> = {}) => ({
  visitId: 'visit-1',
  queueTicketId: 'ticket-1',
  displayNumber: 'A012',
  patientName: 'Siti Nurhaliza',
  visitNumber: 'V-2026-0042',
  doctorName: 'Dr Amira Rahman',
  checkInAt: '2026-08-06T01:00:00.000Z',
  queueStatus: 'READY_FOR_DISPENSARY',
  counts: { total: 1, dispensed: 0, remaining: 1 },
  medications: [medication()],
  unresolvedCount: 0,
  hasStockWarning: false,
  ...over,
});

const PERMISSIONS = {
  VIEW_DISPENSARY: true,
  PRINT_LABEL: true,
  DISPENSE_MEDICATION: true,
  RESOLVE_STOCK_ISSUE: false,
};

const LABEL = {
  prescriptionId: 'rx-1',
  clinic: { name: 'Klinik Hijraa', branch: null },
  patient: { name: 'Siti Nurhaliza', identifier: '900101-14-5566' },
  medication: {
    name: 'Amoxicillin',
    strength: '500mg',
    doseAmount: '2',
    doseUnit: 'capsule',
    frequency: 'three times daily',
    durationDays: 5,
    quantity: 30,
    indication: null,
    remark: null,
  },
  prescriber: 'Dr Amira Rahman',
  processedBy: 'Siti Front Desk',
  dispensedBy: null,
  visitReference: 'V-2026-0042',
  printedAt: '2026-08-06T02:15:00.000Z',
  copies: 1,
  labelFormat: 'KUWICK_STD_70x40',
  printSequence: 1,
  isReprint: false,
};

let board: { rows: unknown[]; counts: unknown; permissions: unknown };
/** The selected patient's invoice, documents and blockers. */
let world: { invoices: unknown[]; documents: unknown[]; blockers: unknown[] };

const INVOICE = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  visitId: 'visit-1',
  invoiceNumber: 'INV-000001',
  status: 'UNPAID',
  grandTotal: '85.00',
  panelResponsibilityAmount: '0.00',
  patientResponsibilityAmount: '85.00',
  remainingBalance: '85.00',
  ...over,
});

function mockBoard(rows: unknown[], permissions = PERMISSIONS) {
  board = {
    rows,
    counts: {
      waitingPatients: rows.length,
      medicationsRemaining: rows.length,
      stockWarnings: 0,
    },
    permissions,
  };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  message.destroy();
  mockBoard([row()]);
  world = { invoices: [INVOICE()], documents: [], blockers: [] };
  patch.mockImplementation(async () => ({ ...INVOICE(), status: 'PAID', remainingBalance: '0.00' }));
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/clinics')) return [CLINIC];
    if (url.startsWith('/dispensary/board')) return board;
    if (url.includes('/label-preview')) return LABEL;
    if (url.includes('/label-history')) return [];
    if (url.startsWith('/invoices')) return world.invoices;
    if (url.startsWith('/documents')) return world.documents;
    if (url.includes('/completion-blockers')) return world.blockers;
    return [];
  });
  post.mockImplementation(async (url: string) => {
    if (url === '/dispensary/dispense') {
      return {
        visitId: 'visit-1',
        results: [
          { prescriptionId: 'rx-1', outcome: 'DISPENSED', message: 'Dispensed.', medicationName: 'Amoxicillin' },
        ],
        summary: { dispensed: 1, alreadyDispensed: 0, failed: 0 },
        routing: {
          dispensingComplete: true,
          queueStatus: 'READY_FOR_PAYMENT',
          message: 'The patient can go to payment.',
        },
      };
    }
    if (url.includes('/label')) return { ...LABEL, printSequence: 1 };
    return {};
  });
  // window.print does not exist under jsdom.
  Object.defineProperty(window, 'print', { value: vi.fn(), writable: true, configurable: true });
  setViewport('desktop');
});

/**
 * jsdom answers every media query with `false`, which would silently run the
 * whole suite in the phone layout — where the list and the patient pane are
 * never on screen together. The default here is the desktop split, and the
 * mobile behaviour is asserted deliberately rather than by accident.
 */
function setViewport(size: 'desktop' | 'mobile') {
  window.matchMedia = ((query: string) =>
    ({
      matches: size === 'desktop' && query.includes('min-width'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

function Harness({ children, initial = '/dispensary' }: { children: ReactNode; initial?: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/dispensary" element={children} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const renderPage = (initial?: string) =>
  render(
    <Harness initial={initial}>
      <DispensaryPage />
    </Harness>,
  );

async function selectPatient(name = 'Siti Nurhaliza') {
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
}

// ---------------------------------------------------------------------------

describe('the board', () => {
  it('31. shows the waiting patients with their progress', async () => {
    renderPage();
    expect(await screen.findByText('Siti Nurhaliza')).toBeTruthy();
    expect(screen.getByText(/0 of 1 dispensed/)).toBeTruthy();
  });

  it('32. reaches the server ONCE for the whole board', async () => {
    // A row that fetches its own medications, and a medication that fetches
    // its own stock, is a waterfall that gets worse exactly when the clinic
    // is busiest — which is the only time this screen is open.
    renderPage();
    await screen.findByText('Siti Nurhaliza');
    const boardCalls = get.mock.calls.filter((call: unknown[]) => (call[0] as string).startsWith('/dispensary/board'));
    expect(boardCalls).toHaveLength(1);
    expect(get.mock.calls.some((call: unknown[]) => (call[0] as string).startsWith('/prescriptions'))).toBe(false);
    expect(get.mock.calls.some((call: unknown[]) => (call[0] as string).startsWith('/stock'))).toBe(false);
  });

  it('33. says so plainly when nobody is waiting', async () => {
    mockBoard([]);
    renderPage();
    expect(await screen.findAllByText(/No patients are waiting for clinic dispensing/)).not.toHaveLength(0);
  });

  it('34. selects nobody until a dispenser chooses', async () => {
    // On a busy board the first row changes as people are served. A
    // workspace that quietly re-points while somebody is reading is how the
    // wrong medicine gets counted.
    renderPage();
    await screen.findByText('Siti Nurhaliza');
    expect(screen.getByText(/Choose a patient from the list/)).toBeTruthy();
  });

  it('35. opens straight onto the deep-linked visit', async () => {
    renderPage('/dispensary?visitId=visit-1');
    // The patient pane, not just the list entry.
    expect(await screen.findByRole('heading', { name: 'Siti Nurhaliza', level: 3 })).toBeTruthy();
  });

  it('36. says the visit has moved when the deep link no longer matches', async () => {
    // The patient was served, or sent back for a supply-mode decision. The
    // link is not broken and must not read as though it were.
    renderPage('/dispensary?visitId=visit-gone');
    await screen.findByText('Siti Nurhaliza');
    expect(screen.getByText(/This visit has moved to another stage/)).toBeTruthy();
  });

  it('37. filters the list without re-querying the server', async () => {
    mockBoard([row(), row({ visitId: 'visit-2', patientName: 'Ahmad Faiz', displayNumber: 'A013' })]);
    renderPage();
    await screen.findByText('Ahmad Faiz');
    await userEvent.type(screen.getByLabelText('Search waiting patients'), 'faiz');
    await waitFor(() => expect(screen.queryByText('Siti Nurhaliza')).toBeNull());
    expect(screen.getByText('Ahmad Faiz')).toBeTruthy();
    expect(get.mock.calls.filter((call: unknown[]) => (call[0] as string).startsWith('/dispensary/board'))).toHaveLength(1);
  });
});

describe('a medication card', () => {
  it('38. leads with the medicine, not the shelf', async () => {
    renderPage('/dispensary?visitId=visit-1');
    const card = await screen.findByText('Amoxicillin');
    expect(card.tagName).toBe('H4');
  });

  it('39. shows the quantity as text, never as an editable field', async () => {
    // There is no partial dispensing. A field that could be edited would be
    // a field that could silently disagree with the prescription.
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    expect(screen.getByText('Quantity to dispense')).toBeTruthy();
    const inputs = screen.queryAllByRole('spinbutton');
    expect(inputs).toHaveLength(0);
  });

  it('40. states the stock in words as well as colour', async () => {
    renderPage('/dispensary?visitId=visit-1');
    expect(await screen.findByText('In stock')).toBeTruthy();
    expect(screen.getByText('120 available')).toBeTruthy();
  });

  it('41. says the units cannot be compared rather than inventing a number', async () => {
    mockBoard([
      row({
        medications: [
          medication({ stock: { onHand: null, state: 'UNIT_UNKNOWN', prescriptionUnit: 'ml' } }),
        ],
      }),
    ]);
    renderPage('/dispensary?visitId=visit-1');
    expect(await screen.findByText('Unit needs review')).toBeTruthy();
    expect(screen.getByText(/cannot be compared safely/)).toBeTruthy();
  });

  it('42. offers no dispense action on a row already handed over', async () => {
    mockBoard([
      row({
        counts: { total: 1, dispensed: 1, remaining: 0 },
        medications: [
          medication({ status: 'DISPENSED', dispenserName: 'Siti Front Desk', dispensedAt: '2026-08-06T02:00:00Z' }),
        ],
      }),
    ]);
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    expect(screen.queryByRole('button', { name: 'Dispense Amoxicillin' })).toBeNull();
    expect(screen.getByText(/Dispensed by Siti Front Desk/)).toBeTruthy();
  });

  it('43. offers no dispense control on a medication row at all', async () => {
    // G4.5d5c — the counter hands a bag over once, not once per box. A
    // per-row Dispense is three clicks and three confirmations for an
    // ordinary three-medicine prescription.
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    expect(screen.queryByRole('button', { name: 'Dispense Amoxicillin' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Dispense Selected/ })).toBeNull();
  });

  it('44. tells a role that may not print, rather than hiding the control', async () => {
    mockBoard([row()], { ...PERMISSIONS, PRINT_LABEL: false });
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    const disabled = screen.getByRole('button', { name: /Print label$/ });
    expect(disabled.hasAttribute('disabled')).toBe(true);
  });
});

describe('confirming the hand-over', () => {
  it('45. one primary action covers the whole visit', async () => {
    mockBoard([
      row({
        counts: { total: 2, dispensed: 0, remaining: 2 },
        medications: [medication(), medication({ prescriptionId: 'rx-2', name: 'Paracetamol' })],
      }),
    ]);
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    expect(screen.getByRole('button', { name: 'Confirm Medications Dispensed' })).toBeTruthy();
  });

  it('46. sends every outstanding prescription id, and NO quantity', async () => {
    mockBoard([
      row({
        counts: { total: 2, dispensed: 0, remaining: 2 },
        medications: [medication(), medication({ prescriptionId: 'rx-2', name: 'Paracetamol' })],
      }),
    ]);
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Medications Dispensed' }));
    const dialog = await screen.findByTestId('confirm-dispense-modal');
    await userEvent.click(
      within(dialog.closest('.ant-modal') ?? dialog).getByRole('button', {
        name: 'Confirm Medications Dispensed',
      }),
    );
    await waitFor(() => {
      const call = post.mock.calls.find((c: unknown[]) => c[0] === '/dispensary/dispense');
      expect(call?.[1]).toMatchObject({ visitId: 'visit-1', prescriptionIds: ['rx-1', 'rx-2'] });
      expect(JSON.stringify(call?.[1])).not.toMatch(/quantity/i);
    });
  });

  it('47. a normal hand-over is NOT interrupted by an acknowledgement', async () => {
    // Everything in stock: confirm is live immediately. Asking on every
    // dispense is how an acknowledgement stops being read.
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Medications Dispensed' }));
    const dialog = await screen.findByTestId('confirm-dispense-modal');
    const confirm = within(dialog.closest('.ant-modal') ?? dialog).getByRole('button', {
      name: 'Confirm Medications Dispensed',
    });
    expect(confirm.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByRole('checkbox', { name: /discrepancy/ })).toBeNull();
  });

  it('48. a genuine stock discrepancy IS surfaced, and blocks until acknowledged', async () => {
    mockBoard([
      row({
        hasStockWarning: true,
        medications: [medication({ stock: { onHand: 3, state: 'INSUFFICIENT', prescriptionUnit: 'capsule' } })],
      }),
    ]);
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Medications Dispensed' }));
    const dialog = await screen.findByTestId('confirm-dispense-modal');
    const scope = within(dialog.closest('.ant-modal') ?? dialog);
    expect(scope.getByText(/Stock discrepancy/)).toBeTruthy();
    const confirm = scope.getByRole('button', { name: 'Confirm Medications Dispensed' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: /discrepancy/ }));
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false));
  });

  it('49. the acknowledgement reaches the server only when there was one', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Medications Dispensed' }));
    const dialog = await screen.findByTestId('confirm-dispense-modal');
    await userEvent.click(
      within(dialog.closest('.ant-modal') ?? dialog).getByRole('button', {
        name: 'Confirm Medications Dispensed',
      }),
    );
    await waitFor(() => {
      const call = post.mock.calls.find((c: unknown[]) => c[0] === '/dispensary/dispense');
      expect(call?.[1]).toMatchObject({ acknowledgeStockWarning: false });
    });
  });

  it('50. the confirmation still shows stock before and after', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Medications Dispensed' }));
    expect(await screen.findByText('120 → 90 after dispensing')).toBeTruthy();
  });

  it('51. a mixed outcome is reported per item, not as one failure', async () => {
    post.mockImplementation(async (url: string) => {
      if (url !== '/dispensary/dispense') return {};
      return {
        visitId: 'visit-1',
        results: [
          { prescriptionId: 'rx-1', outcome: 'DISPENSED', message: 'Dispensed.', medicationName: 'Amoxicillin' },
          {
            prescriptionId: 'rx-2',
            outcome: 'ALREADY_DISPENSED',
            message: 'This medication was already dispensed.',
            medicationName: 'Paracetamol',
          },
        ],
        summary: { dispensed: 1, alreadyDispensed: 1, failed: 0 },
        routing: { dispensingComplete: false, queueStatus: null, message: 'Still waiting.' },
      };
    });
    mockBoard([
      row({
        counts: { total: 2, dispensed: 0, remaining: 2 },
        medications: [medication(), medication({ prescriptionId: 'rx-2', name: 'Paracetamol' })],
      }),
    ]);
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Medications Dispensed' }));
    const dialog = await screen.findByTestId('confirm-dispense-modal');
    await userEvent.click(
      within(dialog.closest('.ant-modal') ?? dialog).getByRole('button', {
        name: 'Confirm Medications Dispensed',
      }),
    );
    expect(await screen.findByText(/1 dispensed · 1 already dispensed/)).toBeTruthy();
    expect(screen.getByText(/Paracetamol: This medication was already dispensed/)).toBeTruthy();
  });

  it('52. a refusal is reported inside the modal and dispenses nothing', async () => {
    post.mockImplementation(async () => {
      throw new MockApiError('This account may not dispense medication.', 403);
    });
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Medications Dispensed' }));
    const dialog = await screen.findByTestId('confirm-dispense-modal');
    await userEvent.click(
      within(dialog.closest('.ant-modal') ?? dialog).getByRole('button', {
        name: 'Confirm Medications Dispensed',
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('This account may not dispense medication.');
  });

  it('53. dispensing refreshes the board and the queue — and NOTHING clinical', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/dispensary?visitId=visit-1']}>
          <Routes>
            <Route path="/dispensary" element={<DispensaryPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm Medications Dispensed' }));
    const dialog = await screen.findByTestId('confirm-dispense-modal');
    await userEvent.click(
      within(dialog.closest('.ant-modal') ?? dialog).getByRole('button', {
        name: 'Confirm Medications Dispensed',
      }),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const keys = invalidate.mock.calls.map(([arg]) => JSON.stringify((arg as { queryKey: unknown }).queryKey));
    expect(keys.some((k) => k.includes('dispensary-board'))).toBe(true);
    expect(keys.some((k) => k.includes('queue-board'))).toBe(true);
    expect(keys.some((k) => k.includes('clinical-note'))).toBe(false);
    expect(keys.some((k) => k.includes('visit-observations'))).toBe(false);
  });
});

describe('documents at the counter', () => {
  it('54. an issued MC is listed with View and Print', async () => {
    // Counter staff must not have to go back to the Doctor Canvas to print
    // a medical certificate.
    world.documents = [
      {
        id: 'doc-1',
        visitId: 'visit-1',
        type: 'MC',
        title: null,
        content: '<p>MC</p>',
        issuedByStaffId: 'staff-1',
        issuedDate: '2026-08-08T00:00:00.000Z',
        startDate: null,
        endDate: null,
        diagnosisText: null,
        referredTo: null,
        signedAt: null,
        signedByStaffId: null,
      },
    ];
    renderPage('/dispensary?visitId=visit-1');
    expect(await screen.findByText('Medical Certificate')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View Medical Certificate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Print Medical Certificate' })).toBeTruthy();
  });

  it('55. a visit with no documents says so rather than showing an empty box', async () => {
    renderPage('/dispensary?visitId=visit-1');
    expect(await screen.findByText(/No documents were issued/)).toBeTruthy();
  });
});

describe('payment at the counter', () => {
  it('56. the patient responsibility and a way to collect it are on this screen', async () => {
    renderPage('/dispensary?visitId=visit-1');
    expect(await screen.findByText('Patient payable')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Collect RM85.00/ })).toBeTruthy();
    for (const m of ['Cash', 'Card', 'QR', 'Bank Transfer']) {
      expect(screen.getByRole('button', { name: m })).toBeTruthy();
    }
  });

  it('57. collecting calls the existing invoice API with the chosen method', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Patient payable');
    await userEvent.click(screen.getByRole('button', { name: 'QR' }));
    await userEvent.click(screen.getByRole('button', { name: /Collect RM85.00/ }));
    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith('/invoices/inv-1/pay', { paymentMethod: 'QR' });
    });
  });

  it('58. a settled invoice reads as settled, with no collect button', async () => {
    world.invoices = [INVOICE({ status: 'PAID', remainingBalance: '0.00' })];
    renderPage('/dispensary?visitId=visit-1');
    expect(await screen.findByText('Payment settled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Collect/ })).toBeNull();
  });

  it('59. a panel patient owing nothing is NOT described as paid', async () => {
    // The receivable is money the clinic still has to claim. Folding it into
    // a "settled" tick is how it quietly gets written off.
    world.invoices = [
      INVOICE({
        panelResponsibilityAmount: '85.00',
        patientResponsibilityAmount: '0.00',
        remainingBalance: '0.00',
      }),
    ];
    renderPage('/dispensary?visitId=visit-1');
    expect((await screen.findAllByText('No patient payment required')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Panel receivable RM85.00/)).toBeTruthy();
    expect(screen.queryByText('Payment settled')).toBeNull();
  });

  it('60. a visit with no invoice says so instead of offering to collect nothing', async () => {
    world.invoices = [];
    renderPage('/dispensary?visitId=visit-1');
    expect(await screen.findByText(/No invoice has been raised/)).toBeTruthy();
  });
});

describe('finishing the patient', () => {
  const dispensedRow = () =>
    row({
      counts: { total: 1, dispensed: 1, remaining: 0 },
      medications: [medication({ status: 'DISPENSED', dispenserName: 'Siti' })],
    });

  it('61. after dispensing but before payment, the counter shows exactly that', async () => {
    mockBoard([dispensedRow()]);
    renderPage('/dispensary?visitId=visit-1');
    expect(await screen.findByText(/Medications dispensed \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Payment RM85.00 outstanding/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Complete Visit' })).toBeNull();
  });

  it('62. once both are done, Complete Visit becomes the primary action', async () => {
    mockBoard([dispensedRow()]);
    world.invoices = [INVOICE({ status: 'PAID', remainingBalance: '0.00' })];
    renderPage('/dispensary?visitId=visit-1');
    expect(await screen.findByRole('button', { name: 'Complete Visit' })).toBeTruthy();
    expect(screen.getByText('Patient payment settled')).toBeTruthy();
  });

  it('63. a server blocker is quoted verbatim, not hidden behind a disabled button', async () => {
    mockBoard([dispensedRow()]);
    world.invoices = [INVOICE({ status: 'PAID', remainingBalance: '0.00' })];
    world.blockers = [{ code: 'PROCEDURE_IN_PROGRESS', message: 'Procedure FBC still in progress.' }];
    renderPage('/dispensary?visitId=visit-1');
    expect((await screen.findAllByText('Procedure FBC still in progress.')).length).toBeGreaterThan(0);
    const button = screen.getByRole('button', { name: 'Complete Visit' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('64. completing calls the authoritative visit endpoint', async () => {
    mockBoard([dispensedRow()]);
    world.invoices = [INVOICE({ status: 'PAID', remainingBalance: '0.00' })];
    renderPage('/dispensary?visitId=visit-1');
    await userEvent.click(await screen.findByRole('button', { name: 'Complete Visit' }));
    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith('/visits/visit-1/complete', {});
    });
  });

  it('65. the counter never invents a payment order — dispensing first is not required', async () => {
    // Payment may be collected before the medicine leaves the counter.
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Patient payable');
    expect(screen.getByRole('button', { name: /Collect RM85.00/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm Medications Dispensed' })).toBeTruthy();
  });
});

describe('labels', () => {
  it('56. previewing does NOT record a print', async () => {
    // "Was this printed" has to mean printed, not looked at.
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Print label for Amoxicillin' }));
    await screen.findByTestId('label-sheet');
    expect(post.mock.calls.filter((call: unknown[]) => (call[0] as string).endsWith('/label'))).toHaveLength(0);
    expect(get.mock.calls.some((call: unknown[]) => (call[0] as string).includes('/label-preview'))).toBe(true);
  });

  it('57. shows the label with the medicine, the directions and the patient', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Print label for Amoxicillin' }));
    const sheet = await screen.findByTestId('label-sheet');
    expect(within(sheet).getByText('Amoxicillin 500mg')).toBeTruthy();
    expect(within(sheet).getByText('Take 2 capsule three times daily for 5 days')).toBeTruthy();
    expect(within(sheet).getByText(/Siti Nurhaliza/)).toBeTruthy();
  });

  it('58. renders one label per copy', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Print label for Amoxicillin' }));
    const sheet = await screen.findByTestId('label-sheet');
    expect(sheet.querySelectorAll('.kw-label')).toHaveLength(1);
    // antd's injected radio styles put `pointer-events: none` on the hidden
    // input, so the pointer check refuses a click a real user makes on the
    // label above it.
    await userEvent.setup({ pointerEventsCheck: 0 }).click(screen.getByRole('radio', { name: '3' }));
    await waitFor(() => expect(sheet.querySelectorAll('.kw-label')).toHaveLength(3));
  });

  it('59. offers no more than three copies, matching the server', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Print label for Amoxicillin' }));
    await screen.findByTestId('label-sheet');
    expect(screen.queryByRole('radio', { name: '4' })).toBeNull();
    expect(screen.getByRole('radio', { name: '3' })).toBeTruthy();
  });

  it('60. records the print BEFORE handing the page to the printer', async () => {
    const order: string[] = [];
    post.mockImplementation(async (url: string) => {
      if (url.endsWith('/label')) {
        order.push('recorded');
        return LABEL;
      }
      return {};
    });
    (window.print as ReturnType<typeof vi.fn>).mockImplementation(() => order.push('printed'));

    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Print label for Amoxicillin' }));
    await screen.findByTestId('label-sheet');
    await userEvent.click(screen.getByRole('button', { name: /Print$/ }));

    await waitFor(() => expect(order).toEqual(['recorded', 'printed']));
    expect(post.mock.calls.find((call: unknown[]) => (call[0] as string).endsWith('/label'))?.[1]).toMatchObject({ copies: 1 });
  });

  it('61. prints nothing when the server refuses', async () => {
    post.mockImplementation(async () => {
      throw new MockApiError('A clinic medication label applies only to medication the clinic supplies.');
    });
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Print label for Amoxicillin' }));
    await screen.findByTestId('label-sheet');
    await userEvent.click(screen.getByRole('button', { name: /Print$/ }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(window.print).not.toHaveBeenCalled();
  });

  it('62. states that printing is not dispensing, in the dialog', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Print label for Amoxicillin' }));
    expect(await screen.findByText('Printing does not dispense')).toBeTruthy();
  });

  it('63. printing changes no prescription, no queue and no invoice', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Print label for Amoxicillin' }));
    await screen.findByTestId('label-sheet');
    await userEvent.click(screen.getByRole('button', { name: /Print$/ }));
    await waitFor(() => expect(window.print).toHaveBeenCalled());

    const posted = post.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(posted).toEqual(['/dispensary/prescriptions/rx-1/label']);
    expect(posted.some((url) => url.includes('dispense'))).toBe(false);
    expect(posted.some((url) => url.includes('invoice'))).toBe(false);
    expect(posted.some((url) => url.includes('queue'))).toBe(false);
  });

  it('64. offers a reprint once the label has a history, and audits it too', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/clinics')) return [CLINIC];
      if (url.startsWith('/dispensary/board')) return board;
      if (url.includes('/label-preview')) return { ...LABEL, printSequence: 2, isReprint: true };
      if (url.includes('/label-history')) {
        return [
          {
            id: 'print-1',
            printedByName: 'Siti Front Desk',
            printedAt: '2026-08-06T02:00:00.000Z',
            copies: 1,
            printSequence: 1,
            isReprint: false,
          },
        ];
      }
      if (url.startsWith('/invoices')) return world.invoices;
      if (url.startsWith('/documents')) return world.documents;
      if (url.includes('/completion-blockers')) return world.blockers;
      return [];
    });
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Print label for Amoxicillin' }));

    const sheet = await screen.findByTestId('label-sheet');
    // The reprint is marked on the label itself, so a duplicate in a bag is
    // identifiable.
    expect(within(sheet).getByText('Reprint #2')).toBeTruthy();
    await userEvent.click(await screen.findByRole('button', { name: /Reprint$/ }));
    await waitFor(() =>
      expect(post.mock.calls.filter((call: unknown[]) => (call[0] as string).endsWith('/label'))).toHaveLength(1),
    );
  });

  it('65. shows who printed the label and when', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/clinics')) return [CLINIC];
      if (url.startsWith('/dispensary/board')) return board;
      if (url.includes('/label-preview')) return LABEL;
      if (url.includes('/label-history')) {
        return [
          {
            id: 'print-1',
            printedByName: 'Siti Front Desk',
            printedAt: '2026-08-06T02:00:00.000Z',
            copies: 2,
            printSequence: 1,
            isReprint: false,
          },
        ];
      }
      if (url.startsWith('/invoices')) return world.invoices;
      if (url.startsWith('/documents')) return world.documents;
      if (url.includes('/completion-blockers')) return world.blockers;
      return [];
    });
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Print label for Amoxicillin' }));
    expect(await screen.findByText(/#1 · 2 copies/)).toBeTruthy();
    expect(screen.getByText(/Siti Front Desk/)).toBeTruthy();
  });
});

describe('the rest of the workspace', () => {
  it('66. names an unresolved supply mode without offering to resolve it', async () => {
    // The supply mode is the prescriber's decision. A control here would let
    // the counter make a clinical choice quietly.
    mockBoard([row({ unresolvedCount: 2 })]);
    renderPage('/dispensary?visitId=visit-1');
    expect(await screen.findByText(/2 medications without a confirmed supply mode/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /supply mode/i })).toBeNull();
  });

  it('67. links back to the Queue, and no longer hands off to Billing Review', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    expect(screen.getByRole('link', { name: /Back to Queue/ }).getAttribute('href')).toBe('/queue');
    // G4.5d5c — Billing Review is no longer the normal path out of the
    // counter; payment happens here. The route still exists for finance.
    expect(screen.queryByRole('link', { name: 'Go to Billing Review' })).toBeNull();
  });

  it('68. refuses gracefully when the account may not view the dispensary', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/clinics')) return [CLINIC];
      if (url.startsWith('/dispensary/board')) throw new MockApiError('This account may not view the dispensary.', 403);
      return [];
    });
    renderPage();
    expect(await screen.findByText(/not available to this account/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to Queue' })).toBeTruthy();
  });

  it('69. offers a retry when the board simply failed to load', async () => {
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/clinics')) return [CLINIC];
      if (url.startsWith('/dispensary/board')) throw new MockApiError('Network error', 500);
      return [];
    });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('70. keeps the selection in the URL so it can be handed to a colleague', async () => {
    mockBoard([row(), row({ visitId: 'visit-2', patientName: 'Ahmad Faiz', displayNumber: 'A013' })]);
    renderPage();
    await selectPatient('Ahmad Faiz');
    expect(await screen.findByRole('heading', { name: 'Ahmad Faiz', level: 3 })).toBeTruthy();
  });

  it('71. switching patient re-points the whole counter, not a selection', async () => {
    mockBoard([
      row({ counts: { total: 1, dispensed: 0, remaining: 1 } }),
      row({ visitId: 'visit-2', patientName: 'Ahmad Faiz', displayNumber: 'A013' }),
    ]);
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await selectPatient('Ahmad Faiz');
    expect(await screen.findByRole('heading', { name: 'Ahmad Faiz', level: 3 })).toBeTruthy();
    // No per-row selection survives, because there is none to survive.
    expect(screen.queryByRole('checkbox', { name: /^Select / })).toBeNull();
  });
});

describe('smaller screens and assistive technology', () => {
  it('72. a phone shows the waiting list, not both panes stacked', async () => {
    // Stacking means scrolling past every waiting patient to reach the
    // medication being handed over.
    setViewport('mobile');
    renderPage();
    await screen.findByText('Siti Nurhaliza');
    expect(screen.queryByText(/Choose a patient from the list/)).toBeNull();
  });

  it('73. a phone shows the patient alone, with a way back to the list', async () => {
    setViewport('mobile');
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    expect(screen.queryByLabelText('Search waiting patients')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back to the waiting list' }));
    expect(await screen.findByLabelText('Search waiting patients')).toBeTruthy();
  });

  it('74. the desktop split shows both panes at once', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    expect(screen.getByLabelText('Search waiting patients')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Siti Nurhaliza', level: 3 })).toBeTruthy();
  });

  it('75. the selected patient is announced, not only outlined', async () => {
    renderPage('/dispensary?visitId=visit-1');
    const selected = await screen.findByRole('button', { name: /Siti Nurhaliza/ });
    expect(selected.getAttribute('aria-current')).toBe('true');
  });

  it('76. the waiting list and the patient pane are both named', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    expect(screen.getByRole('list', { name: 'Patients waiting for dispensing' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Selected patient' })).toBeTruthy();
  });

  it('77. a blocking stock state is announced, not left to colour', async () => {
    mockBoard([
      row({
        hasStockWarning: true,
        medications: [medication({ stock: { onHand: 0, state: 'OUT_OF_STOCK', prescriptionUnit: 'capsule' } })],
      }),
    ]);
    renderPage('/dispensary?visitId=visit-1');
    const announced = await screen.findAllByRole('status');
    expect(announced.map((node) => node.textContent).join(' ')).toMatch(/Out of stock/);
  });

  it('78. every label control carries a name that says which medicine', async () => {
    // "Print label" three times over on one screen is unusable by voice or
    // by screen reader.
    mockBoard([
      row({
        counts: { total: 2, dispensed: 0, remaining: 2 },
        medications: [medication(), medication({ prescriptionId: 'rx-2', name: 'Paracetamol' })],
      }),
    ]);
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    expect(screen.getByRole('button', { name: 'Print label for Amoxicillin' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Print label for Paracetamol' })).toBeTruthy();
  });
});
