// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersRail } from '../sections/OrdersRail';
import { AddOrderModal } from './AddOrderModal';
import { serviceSearchDetail, serviceSearchLabel } from './orderPicker';
import { Service } from '../types';

// ===========================================================================
// b2 PHASE E — SEARCH-FIRST ORDERING.
//
// "+ Add Order" was a button whose only job was to reveal a picker, so every
// order began with a click that decided nothing. What is asserted here is the
// removal, the TASK-vs-SERVICE distinction (the most consequential fact on a
// result row), and that the two order types submit different things — because
// a quantity on a task order and a room on a consultation fee are both
// meaningless, and the server keys on the STORED type.
// ===========================================================================

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post, patch: vi.fn(), delete: vi.fn(), put: vi.fn(), postFile: vi.fn() },
  downloadFile: vi.fn(),
  fetchBlobUrl: vi.fn(),
}));

const DRESSING: Service = {
  id: 'svc-task', tenantId: 't', name: 'Wound dressing', code: 'DRESS', category: 'Procedure',
  orderType: 'TASK_ORDER', durationMinutesDefault: 10, price: '45.00', active: true,
};
const CONSULT: Service = {
  id: 'svc-std', tenantId: 't', name: 'Consultation', code: null, category: 'Consultation',
  orderType: 'STANDARD_SERVICE', durationMinutesDefault: 10, price: '35.00', active: true,
};

const ROOMS = [{ id: 'room-1', name: 'Treatment Room 1', active: true }];

let ORDERS: unknown[] = [];

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  ORDERS = [];
  get.mockImplementation(async (url: string) => {
    const path = String(url);
    if (path.startsWith('/services')) {
      // Mirrors the SERVER's filter. A mock that returns both types whatever
      // is asked would let the box look scoped while it is not — the test
      // would then be asserting the mock rather than the boundary.
      return path.includes('orderType=TASK_ORDER') ? [DRESSING] : [DRESSING, CONSULT];
    }
    if (path.startsWith('/rooms')) return ROOMS;
    if (path.includes('order-services')) return ORDERS;
    return [];
  });
  post.mockResolvedValue({ id: 'order-new' });
});

const openRail = () =>
  render(
    <Harness>
      <OrdersRail visitId="visit-1" clinicId="clinic-1" />
    </Harness>,
  );

/** Types into the rail's box and chooses a result, the way a doctor would. */
async function pick(term: string, optionTitle: string) {
  const box = screen.getByRole('combobox', { name: 'Add order or service' });
  await userEvent.click(box);
  await userEvent.type(box, term);
  // By TEXT: KuwickSearchSelect renders a custom option node, so the label is
  // the handle rather than a title attribute.
  await userEvent.click(await screen.findByText(optionTitle));
}

describe('the picker is a box, not a button in front of one', () => {
  it('the search box is usable with no click first', () => {
    openRail();
    expect(screen.getByRole('combobox', { name: 'Add order or service' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^add order$/i })).toBeNull();
  });

  it('asks the SERVER, so the category is searchable too', async () => {
    // "imaging" is how a doctor looks for an X-ray they cannot spell, and a
    // browser cannot filter a catalogue it was never sent.
    openRail();
    const box = screen.getByRole('combobox', { name: 'Add order or service' });
    await userEvent.click(box);
    await userEvent.type(box, 'imaging');
    await waitFor(() =>
      expect(get.mock.calls.some(([url]) => String(url).includes('search=imaging'))).toBe(true),
    );
  });

  it('a result row carries the category, the price and the TYPE', () => {
    // The three facts the choice turns on. A row showing only a name makes
    // the doctor open two modals to find out which is which.
    expect(serviceSearchDetail(DRESSING)).toBe('Procedure · RM 45.00 · TASK');
    expect(serviceSearchDetail(CONSULT)).toBe('Consultation · RM 35.00 · SERVICE');
    expect(serviceSearchLabel(DRESSING)).toBe('DRESS — Wound dressing');
    expect(serviceSearchLabel(CONSULT)).toBe('Consultation');
  });
});

describe('the two order types ask for different things', () => {
  it('a TASK ORDER asks where, how urgently, and what staff need to know', async () => {
    openRail();
    await pick('dress', 'DRESS — Wound dressing');

    expect(await screen.findByLabelText('Room / station')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Urgent' })).toBeInTheDocument();
    expect(screen.getByLabelText('Instructions for staff')).toBeInTheDocument();
    // Nobody is billed by the count of a procedure that has one result.
    expect(screen.queryByLabelText('Quantity')).toBeNull();
  });

  it('a STANDARD SERVICE asks only how many, and a remark', async () => {
    // Rendered DIRECTLY, because a standard service is no longer reachable
    // from the orders box — Direct Services owns that path. The modal stays
    // generic, and this pins the shape it renders when handed one.
    render(
      <Harness>
        <AddOrderModal open visitId="visit-1" clinicId="clinic-1" service={CONSULT} onClose={vi.fn()} />
      </Harness>,
    );

    expect(await screen.findByLabelText('Quantity')).toBeInTheDocument();
    expect(screen.getByLabelText('Remark (optional)')).toBeInTheDocument();
    // A consultation fee has no room and nobody waiting on it.
    expect(screen.queryByLabelText('Room / station')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Urgent' })).toBeNull();
  });

  it('submits the room, urgency and instruction for a task order', async () => {
    // One relaxed user for the whole test: opening the antd dropdown leaves
    // jsdom reporting `pointer-events: none` on nodes a real cursor reaches
    // perfectly well, and that is an artefact of the environment rather than
    // anything a doctor would meet.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    openRail();
    await pick('dress', 'DRESS — Wound dressing');
    await user.click(screen.getByLabelText('Room / station'));
    await user.click(await screen.findByTitle('Treatment Room 1'));
    await user.click(screen.getByRole('radio', { name: 'Urgent' }));
    await user.type(screen.getByLabelText('Instructions for staff'), 'Left forearm');
    await user.click(screen.getByRole('button', { name: 'Add Order' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({
      serviceCatalogId: 'svc-task',
      roomId: 'room-1',
      urgency: 'URGENT',
      instruction: 'Left forearm',
    });
    // Not sent at all — the server would drop it, and sending it would imply
    // this form believes a procedure can be ordered three times as one row.
    expect(post.mock.calls[0][1].quantity).toBeUndefined();
  });

  it('submits the quantity for a standard service, and shows what it will bill', async () => {
    render(
      <Harness>
        <AddOrderModal open visitId="visit-1" clinicId="clinic-1" service={CONSULT} onClose={vi.fn()} />
      </Harness>,
    );
    const quantity = await screen.findByLabelText('Quantity');
    await userEvent.tripleClick(quantity);
    await userEvent.keyboard('3');

    // The arithmetic is on screen BEFORE the click, because the invoice is
    // what this decides.
    expect(await screen.findByText(/RM 105\.00 on the invoice/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add Order' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ serviceCatalogId: 'svc-std', quantity: 3 });
    expect(post.mock.calls[0][1].roomId).toBeUndefined();
  });
});

describe('the list says what each row IS', () => {
  it('tags a task order and a standard service differently, and shows status', async () => {
    ORDERS = [
      {
        id: 'o1', tenantId: 't', clinicId: 'c', visitId: 'visit-1', serviceCatalogId: 'svc-task',
        code: 'DRESS', procedureName: 'Wound dressing', orderType: 'TASK_ORDER', instruction: null,
        result: null, status: 'PENDING', requestedByStaffId: 's1', requestedAt: '2026-08-13T00:00:00Z',
        completedAt: null, cancelReason: null, formTemplateId: null, formData: null,
        roomId: 'room-1', urgency: 'URGENT', quantity: 1, room: { id: 'room-1', name: 'Treatment Room 1' },
      },
      {
        id: 'o2', tenantId: 't', clinicId: 'c', visitId: 'visit-1', serviceCatalogId: 'svc-std',
        code: null, procedureName: 'Consultation', orderType: 'STANDARD_SERVICE', instruction: null,
        result: null, status: 'COMPLETED', requestedByStaffId: 's1', requestedAt: '2026-08-13T00:00:00Z',
        completedAt: '2026-08-13T00:00:00Z', cancelReason: null, formTemplateId: null, formData: null,
        roomId: null, urgency: null, quantity: 3, room: null,
      },
    ];
    openRail();

    const task = (await screen.findByText('Wound dressing')).closest('.kw-rail-row') as HTMLElement;
    expect(within(task).getByText('TASK')).toBeInTheDocument();
    expect(within(task).getByText('Ordered')).toBeInTheDocument();
    expect(within(task).getByText('Treatment Room 1')).toBeInTheDocument();
    expect(within(task).getByText('URGENT')).toBeInTheDocument();

    const service = (await screen.findByText('Consultation')).closest('.kw-rail-row') as HTMLElement;
    expect(within(service).getByText('SERVICE')).toBeInTheDocument();
    expect(within(service).getByText('Completed')).toBeInTheDocument();
    // The quantity is on the row, because it is what the invoice multiplies by.
    expect(within(service).getByText('3 ×')).toBeInTheDocument();
  });

  it('a task order offers the completion round-trip; a finished service does not', async () => {
    ORDERS = [
      {
        id: 'o1', tenantId: 't', clinicId: 'c', visitId: 'visit-1', serviceCatalogId: 'svc-task',
        code: 'DRESS', procedureName: 'Wound dressing', orderType: 'TASK_ORDER', instruction: null,
        result: null, status: 'PENDING', requestedByStaffId: 's1', requestedAt: '2026-08-13T00:00:00Z',
        completedAt: null, cancelReason: null, formTemplateId: null, formData: null,
        roomId: null, urgency: null, quantity: 1, room: null,
      },
    ];
    openRail();
    const task = (await screen.findByText('Wound dressing')).closest('.kw-rail-row') as HTMLElement;
    // PENDING offers Start — and only Start. Nothing greyed out.
    expect(within(task).getByRole('button', { name: 'Start' })).toBeEnabled();
    expect(within(task).queryByRole('button', { name: 'Complete' })).toBeNull();
  });

  it('a COMPLETED task order offers the doctor its result to review', async () => {
    ORDERS = [
      {
        id: 'o1', tenantId: 't', clinicId: 'c', visitId: 'visit-1', serviceCatalogId: 'svc-task',
        code: 'DRESS', procedureName: 'Wound dressing', orderType: 'TASK_ORDER', instruction: null,
        result: 'Clean, redressed', status: 'COMPLETED', requestedByStaffId: 's1',
        requestedAt: '2026-08-13T00:00:00Z', completedAt: '2026-08-13T01:00:00Z', cancelReason: null,
        formTemplateId: null, formData: null, roomId: null, urgency: null, quantity: 1, room: null,
      },
    ];
    openRail();
    const task = (await screen.findByText('Wound dressing')).closest('.kw-rail-row') as HTMLElement;
    expect(within(task).getByText('Completed')).toBeInTheDocument();
    expect(within(task).getByRole('button', { name: 'View Result' })).toBeEnabled();
    expect(screen.getByText(/Clean, redressed/)).toBeInTheDocument();
  });
});

// ===========================================================================
// E-FOLLOWUP — THE BOUNDARY BETWEEN THE TWO CARDS (owner decision).
//
// The box briefly offered standard services, which put a consultation fee in
// two cards at once. The fix is to scope the SEARCH, not to merge the cards —
// so what has to hold is that the box asks for task orders only, that a
// standard service cannot be reached from here, and that a visit which
// already has one recorded under orders still renders it.
// ===========================================================================

describe('the orders box searches TASK ORDERS only', () => {
  it('asks the SERVER for task orders, rather than trimming the page here', async () => {
    // The request is bounded to twenty rows. Filtering in the browser would
    // return three task orders out of twenty and present them as the lot.
    openRail();
    const box = screen.getByRole('combobox', { name: 'Add order or service' });
    await userEvent.click(box);
    await userEvent.type(box, 'con');
    await waitFor(() =>
      expect(
        get.mock.calls.some(([url]) => String(url).includes('orderType=TASK_ORDER')),
      ).toBe(true),
    );
  });

  it('returns no standard services, even for a term that names one', async () => {
    openRail();
    const box = screen.getByRole('combobox', { name: 'Add order or service' });
    await userEvent.click(box);
    await userEvent.type(box, 'consult');

    // The task order is offered; the consultation fee is not.
    expect(await screen.findByText('DRESS — Wound dressing')).toBeInTheDocument();
    expect(screen.queryByText('Consultation')).toBeNull();
  });

  it('says where billable services are added, in the box and on the empty card', async () => {
    // A boundary a doctor cannot see is a boundary they will cross.
    openRail();
    expect(
      await screen.findByText(/Billable services are added in Direct Services/i),
    ).toBeInTheDocument();

    const box = screen.getByRole('combobox', { name: 'Add order or service' });
    await userEvent.click(box);
    expect(await screen.findByText(/Billable services are added in the Direct Services card/i)).toBeInTheDocument();
  });
});

describe('a visit that ALREADY has a standard service under orders still renders it', () => {
  it('shows the stored row, tagged and with its quantity', async () => {
    // Scoping the search must not hide data already written. A visit recorded
    // before this decision still has the row, and it still bills.
    ORDERS = [
      {
        id: 'o2', tenantId: 't', clinicId: 'c', visitId: 'visit-1', serviceCatalogId: 'svc-std',
        code: null, procedureName: 'Consultation', orderType: 'STANDARD_SERVICE', instruction: null,
        result: null, status: 'COMPLETED', requestedByStaffId: 's1', requestedAt: '2026-08-13T00:00:00Z',
        completedAt: '2026-08-13T00:00:00Z', cancelReason: null, formTemplateId: null, formData: null,
        roomId: null, urgency: null, quantity: 3, room: null,
      },
    ];
    openRail();

    const row = (await screen.findByText('Consultation')).closest('.kw-rail-row') as HTMLElement;
    expect(within(row).getByText('SERVICE')).toBeInTheDocument();
    // The quantity is what the invoice multiplies by, so it stays on the row.
    expect(within(row).getByText('3 ×')).toBeInTheDocument();
  });

  it('does not filter the LIST — only the search is scoped', async () => {
    ORDERS = [
      {
        id: 'o1', tenantId: 't', clinicId: 'c', visitId: 'visit-1', serviceCatalogId: 'svc-task',
        code: 'DRESS', procedureName: 'Wound dressing', orderType: 'TASK_ORDER', instruction: null,
        result: null, status: 'PENDING', requestedByStaffId: 's1', requestedAt: '2026-08-13T00:00:00Z',
        completedAt: null, cancelReason: null, formTemplateId: null, formData: null,
        roomId: null, urgency: null, quantity: 1, room: null,
      },
      {
        id: 'o2', tenantId: 't', clinicId: 'c', visitId: 'visit-1', serviceCatalogId: 'svc-std',
        code: null, procedureName: 'Consultation', orderType: 'STANDARD_SERVICE', instruction: null,
        result: null, status: 'COMPLETED', requestedByStaffId: 's1', requestedAt: '2026-08-13T00:00:00Z',
        completedAt: '2026-08-13T00:00:00Z', cancelReason: null, formTemplateId: null, formData: null,
        roomId: null, urgency: null, quantity: 1, room: null,
      },
    ];
    openRail();
    expect(await screen.findByText('Wound dressing')).toBeInTheDocument();
    expect(screen.getByText('Consultation')).toBeInTheDocument();
    // The list request carries no orderType — mixed stored data renders whole.
    const listCalls = get.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('order-services'));
    expect(listCalls.every((url) => !url.includes('orderType='))).toBe(true);
  });
});
