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

const { get, post, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {
    constructor(
      message: string,
      public readonly status = 400,
    ) {
      super(message);
    }
  }
  return { get: vi.fn(), post: vi.fn(), MockApiError };
});
vi.mock('../../core/api-client', () => ({
  ApiError: MockApiError,
  apiClient: { get, post, patch: vi.fn(), delete: vi.fn() },
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
  message.destroy();
  mockBoard([row()]);
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/clinics')) return [CLINIC];
    if (url.startsWith('/dispensary/board')) return board;
    if (url.includes('/label-preview')) return LABEL;
    if (url.includes('/label-history')) return [];
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

  it('43. tells a dispenser who may not dispense, rather than hiding the button', async () => {
    mockBoard([row()], { ...PERMISSIONS, DISPENSE_MEDICATION: false });
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    const disabled = screen.getByRole('button', { name: 'Dispense' });
    expect(disabled.hasAttribute('disabled')).toBe(true);
  });

  it('44. offers no label to a role the server would refuse', async () => {
    mockBoard([row()], { ...PERMISSIONS, PRINT_LABEL: false });
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    expect(screen.queryByRole('button', { name: /label/i })).toBeNull();
  });
});

describe('dispensing', () => {
  it('45. never fires straight from the card — it confirms first', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Dispense Amoxicillin' }));
    expect(await screen.findByText(/this cannot be undone/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('46. sends prescription ids and NO quantity', async () => {
    // The server reads the quantity from the prescription. A client-supplied
    // quantity is a client-supplied dispensing decision.
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Dispense Amoxicillin' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Dispense', hidden: false }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/dispensary/dispense', expect.anything()));
    const [, body] = post.mock.calls.find((call: unknown[]) => call[0] === '/dispensary/dispense')!;
    expect(body).toMatchObject({ visitId: 'visit-1', prescriptionIds: ['rx-1'] });
    expect(JSON.stringify(body)).not.toMatch(/quantity/i);
  });

  it('47. shows the shelf before and after', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Dispense Amoxicillin' }));
    expect(await screen.findByText('120 → 90 after dispensing')).toBeTruthy();
  });

  it('48. blocks a short dispense until it is acknowledged', async () => {
    mockBoard([
      row({
        hasStockWarning: true,
        medications: [medication({ stock: { onHand: 4, state: 'INSUFFICIENT', prescriptionUnit: 'capsule' } })],
      }),
    ]);
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Dispense Amoxicillin' }));

    const dialog = await screen.findByTestId('dispense-confirm-modal');
    const confirm = within(dialog.closest('.ant-modal') ?? dialog).getByRole('button', { name: 'Dispense' });
    expect(confirm.hasAttribute('disabled')).toBe(true);

    await userEvent.click(screen.getByRole('checkbox', { name: /despite the shortage/ }));
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false));
  });

  it('49. passes the acknowledgement to the server when there was a shortage', async () => {
    mockBoard([
      row({
        hasStockWarning: true,
        medications: [medication({ stock: { onHand: 0, state: 'OUT_OF_STOCK', prescriptionUnit: 'capsule' } })],
      }),
    ]);
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Dispense Amoxicillin' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: /despite the shortage/ }));
    const dialog = await screen.findByTestId('dispense-confirm-modal');
    await userEvent.click(within(dialog.closest('.ant-modal') ?? dialog).getByRole('button', { name: 'Dispense' }));
    await waitFor(() => {
      const call = post.mock.calls.find((call: unknown[]) => call[0] === '/dispensary/dispense');
      expect(call?.[1]).toMatchObject({ acknowledgeStockWarning: true });
    });
  });

  it('50. does not claim an acknowledgement where there was no shortage', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Dispense Amoxicillin' }));
    const dialog = await screen.findByTestId('dispense-confirm-modal');
    await userEvent.click(within(dialog.closest('.ant-modal') ?? dialog).getByRole('button', { name: 'Dispense' }));
    await waitFor(() => {
      const call = post.mock.calls.find((call: unknown[]) => call[0] === '/dispensary/dispense');
      expect(call?.[1]).toMatchObject({ acknowledgeStockWarning: false });
    });
  });

  it('51. dispenses several together in ONE request', async () => {
    mockBoard([
      row({
        counts: { total: 2, dispensed: 0, remaining: 2 },
        medications: [
          medication(),
          medication({ prescriptionId: 'rx-2', name: 'Paracetamol', quantity: 20 }),
        ],
      }),
    ]);
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Amoxicillin for dispensing' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Paracetamol for dispensing' }));
    await userEvent.click(screen.getByRole('button', { name: /Dispense Selected \(2\)/ }));

    // The confirmation lists what is about to move, by name.
    const dialog = await screen.findByTestId('dispense-confirm-modal');
    const scope = within(dialog.closest('.ant-modal') ?? dialog);
    expect(scope.getByText('Amoxicillin 500mg')).toBeTruthy();
    expect(scope.getByText('Paracetamol 500mg')).toBeTruthy();

    await userEvent.click(scope.getByRole('button', { name: /Dispense 2 medications/ }));
    await waitFor(() => {
      const calls = post.mock.calls.filter((call: unknown[]) => call[0] === '/dispensary/dispense');
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toMatchObject({ prescriptionIds: ['rx-1', 'rx-2'] });
    });
  });

  it('52. reports a mixed batch per item, not as one failure', async () => {
    // Summarising a mixed batch by its failure alone sends a dispenser to
    // hand over medicine that has already left the shelf.
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
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Amoxicillin for dispensing' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Paracetamol for dispensing' }));
    await userEvent.click(screen.getByRole('button', { name: /Dispense Selected \(2\)/ }));
    const dialog = await screen.findByTestId('dispense-confirm-modal');
    await userEvent.click(
      within(dialog.closest('.ant-modal') ?? dialog).getByRole('button', { name: /Dispense 2 medications/ }),
    );

    expect(await screen.findByText(/1 dispensed · 1 already dispensed/)).toBeTruthy();
    expect(screen.getByText(/Paracetamol: This medication was already dispensed/)).toBeTruthy();
  });

  it('53. tells the dispenser where the patient goes next', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Dispense Amoxicillin' }));
    const dialog = await screen.findByTestId('dispense-confirm-modal');
    await userEvent.click(within(dialog.closest('.ant-modal') ?? dialog).getByRole('button', { name: 'Dispense' }));
    expect(await screen.findByText(/The patient can go to payment/)).toBeTruthy();
  });

  it('54. refreshes the board, the visit prescriptions and the queue — and NOTHING clinical', async () => {
    // C1/D-052 and D-091: the dispensary has no business remounting a
    // doctor's editor, and a clinical-note invalidation is how unsaved
    // narrative gets discarded from under somebody.
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
    await userEvent.click(screen.getByRole('button', { name: 'Dispense Amoxicillin' }));
    const dialog = await screen.findByTestId('dispense-confirm-modal');
    await userEvent.click(within(dialog.closest('.ant-modal') ?? dialog).getByRole('button', { name: 'Dispense' }));

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const keys = invalidate.mock.calls.map(([arg]) => JSON.stringify((arg as { queryKey: unknown }).queryKey));
    expect(keys.some((key) => key.includes('dispensary-board'))).toBe(true);
    expect(keys.some((key) => key.includes('queue-board'))).toBe(true);
    expect(keys.some((key) => key.includes('clinical-note'))).toBe(false);
    expect(keys.some((key) => key.includes('visit-observations'))).toBe(false);
  });

  it('55. reports a refusal inside the modal and dispenses nothing', async () => {
    post.mockImplementation(async () => {
      throw new MockApiError('This account may not dispense medication.', 403);
    });
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('button', { name: 'Dispense Amoxicillin' }));
    const dialog = await screen.findByTestId('dispense-confirm-modal');
    await userEvent.click(within(dialog.closest('.ant-modal') ?? dialog).getByRole('button', { name: 'Dispense' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This account may not dispense medication.');
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

  it('67. links back to the Queue and on to Billing Review', async () => {
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    expect(screen.getByRole('link', { name: /Back to Queue/ }).getAttribute('href')).toBe('/queue');
    expect(screen.getByRole('link', { name: 'Go to Billing Review' }).getAttribute('href')).toBe(
      '/billing/visits/visit-1',
    );
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

  it('71. drops the medication selection when the patient changes', async () => {
    // A selection that survived would point at another visit's prescriptions.
    mockBoard([
      row({ counts: { total: 1, dispensed: 0, remaining: 1 } }),
      row({ visitId: 'visit-2', patientName: 'Ahmad Faiz', displayNumber: 'A013' }),
    ]);
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Amoxicillin for dispensing' }));
    expect(screen.getByRole('button', { name: /Dispense Selected \(1\)/ })).toBeTruthy();

    await selectPatient('Ahmad Faiz');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Dispense Selected \(0\)/ })).toBeTruthy(),
    );
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

  it('78. every action control carries a name that says which medicine', async () => {
    // "Dispense" three times over on one screen is unusable by voice or by
    // screen reader.
    mockBoard([
      row({
        counts: { total: 2, dispensed: 0, remaining: 2 },
        medications: [medication(), medication({ prescriptionId: 'rx-2', name: 'Paracetamol' })],
      }),
    ]);
    renderPage('/dispensary?visitId=visit-1');
    await screen.findByText('Amoxicillin');
    expect(screen.getByRole('button', { name: 'Dispense Amoxicillin' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dispense Paracetamol' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Print label for Paracetamol' })).toBeTruthy();
  });
});
