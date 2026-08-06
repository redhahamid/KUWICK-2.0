// @vitest-environment jsdom
import { ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { AddMedicationModal } from './AddMedicationModal';
import { AddProcedureModal } from '../orders/AddProcedureModal';

// ===========================================================================
// G4.5d5b-1 — THE ENTRY MODALS, AND WHAT THEY MUST NOT TOUCH
//
// The interaction rule the owner set: structured multi-field entry goes in a
// centred modal, fast selection stays inline. These tests pin the modal half,
// and — more importantly — pin what opening one does NOT do to the clinical
// note, which is the C1 guarantee everything else is built on.
// ===========================================================================

const { get, post, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {}
  return { get: vi.fn(), post: vi.fn(), MockApiError };
});
vi.mock('../../core/api-client', () => ({
  ApiError: MockApiError,
  apiClient: { get, post, patch: vi.fn(), delete: vi.fn() },
}));

const ITEMS = [
  { id: 'item-1', name: 'Amoxicillin 500mg', code: 'AMX500', doseUnitDefault: 'capsule' },
  { id: 'item-2', name: 'Paracetamol 500mg', code: 'PCM500', doseUnitDefault: 'tablet' },
];

const SERVICES = [{ id: 'svc-1', name: 'Wound dressing', orderType: 'TASK_ORDER' }];

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  message.destroy();
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/items?')) return ITEMS;
    if (url.startsWith('/items/')) return ITEMS.find((i) => url.endsWith(i.id));
    if (url.startsWith('/services')) return SERVICES;
    return [];
  });
});

const openModal = () =>
  render(
    <Harness>
      <AddMedicationModal open visitId="visit-1" onClose={vi.fn()} />
    </Harness>,
  );

/** Chooses the first search result, the way a doctor would. */
async function chooseMedicine(term = 'amo') {
  const search = screen.getByRole('combobox', { name: 'Search medicine' });
  await userEvent.click(search);
  await userEvent.type(search, term);
  const option = await screen.findByTitle(/Amoxicillin/);
  await userEvent.click(option);
}

async function fillMinimum() {
  await chooseMedicine();
  await userEvent.type(screen.getByLabelText('Dose amount'), '1');
  await userEvent.type(screen.getByLabelText('Frequency'), 'TDS');
}

describe('Add Medication modal', () => {
  it('1. supply mode is pre-selected to clinic dispensing, visibly', async () => {
    openModal();
    expect(await screen.findByText('Dispense from clinic')).toBeInTheDocument();
    expect(screen.getByText(/Default — change this if/)).toBeInTheDocument();
  });

  it('2. the submitted prescription carries ONSITE_DISPENSE explicitly', async () => {
    post.mockResolvedValue({ id: 'rx-1' });
    openModal();
    await fillMinimum();
    await userEvent.click(screen.getByRole('button', { name: 'Add Medication' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, dto] = post.mock.calls[0];
    expect(url).toBe('/prescriptions');
    expect(dto).toMatchObject({ visitId: 'visit-1', itemId: 'item-1', supplyMode: 'ONSITE_DISPENSE' });
  });

  it('3. item-master defaults populate visibly', async () => {
    openModal();
    await chooseMedicine();
    await waitFor(() =>
      expect((screen.getByLabelText('Unit') as HTMLInputElement).value).toBe('capsule'),
    );
  });

  it('4. Add & Add Another clears the FORM and keeps the modal open', async () => {
    post.mockResolvedValue({ id: 'rx-1' });
    openModal();
    await fillMinimum();
    await userEvent.click(screen.getByRole('button', { name: 'Add & Add Another' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // The modal is still there, the form is empty, and the addition is
    // confirmed in place rather than by a dialog to dismiss.
    expect(await screen.findByText(/added to this visit/)).toBeInTheDocument();
    expect((screen.getByLabelText('Frequency') as HTMLInputElement).value).toBe('');
  });

  it('5. the primary action closes the modal, Add & Add Another does not', async () => {
    post.mockResolvedValue({ id: 'rx-1' });
    const onClose = vi.fn();
    render(
      <Harness>
        <AddMedicationModal open visitId="visit-1" onClose={onClose} />
      </Harness>,
    );
    await fillMinimum();
    await userEvent.click(screen.getByRole('button', { name: 'Add & Add Another' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('6. it never fetches or invalidates a clinical note', async () => {
    post.mockResolvedValue({ id: 'rx-1' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <AddMedicationModal open visitId="visit-1" onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    await fillMinimum();
    await userEvent.click(screen.getByRole('button', { name: 'Add Medication' }));
    await waitFor(() => expect(post).toHaveBeenCalled());

    // Nothing requested the note...
    expect(get.mock.calls.every(([url]: any[]) => !String(url).includes('clinical-note'))).toBe(true);
    // ...and nothing invalidated it either.
    const keys = invalidate.mock.calls.flatMap((call: unknown[]) => {
      const key = (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
      return Array.isArray(key) ? [String(key[0])] : [];
    });
    expect(keys).not.toContain('clinical-notes');
    expect(keys).toContain('prescriptions');
  });

  it('7. it does not download the whole catalogue — the search is bounded', async () => {
    openModal();
    await chooseMedicine();
    const searchCalls = get.mock.calls.filter(([url]: any[]) => String(url).startsWith('/items?'));
    expect(searchCalls.length).toBeGreaterThan(0);
    for (const [url] of searchCalls) {
      expect(String(url)).toContain('take=20');
      expect(String(url)).toContain('search=');
    }
  });

  it('8. the primary action is withheld until the required fields are filled', async () => {
    openModal();
    expect(screen.getByRole('button', { name: 'Add Medication' })).toBeDisabled();
    await fillMinimum();
    expect(screen.getByRole('button', { name: 'Add Medication' })).toBeEnabled();
  });

  it('9. a server refusal is shown inside the modal, and nothing closes', async () => {
    post.mockRejectedValue(new MockApiError('That medicine is inactive.'));
    const onClose = vi.fn();
    render(
      <Harness>
        <AddMedicationModal open visitId="visit-1" onClose={onClose} />
      </Harness>,
    );
    await fillMinimum();
    await userEvent.click(screen.getByRole('button', { name: 'Add Medication' }));
    expect(await screen.findByText('That medicine is inactive.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('10. it holds no historical medication list', async () => {
    openModal();
    await screen.findByRole('combobox', { name: 'Search medicine' });
    expect(screen.queryByText(/Prescribed Medications|Current medication/i)).not.toBeInTheDocument();
  });
});

describe('Add Procedure modal', () => {
  const openProcedure = () =>
    render(
      <Harness>
        <AddProcedureModal open visitId="visit-1" onClose={vi.fn()} />
      </Harness>,
    );

  it('11. it exposes the instruction field the model has always had', async () => {
    openProcedure();
    expect(await screen.findByLabelText('Instruction for this order')).toBeInTheDocument();
  });

  it('12. it searches TASK_ORDER services server-side, bounded', async () => {
    openProcedure();
    const search = screen.getByRole('combobox', { name: 'Search procedures and investigations' });
    await userEvent.click(search);
    await userEvent.type(search, 'wound');
    await waitFor(() => expect(get).toHaveBeenCalled());

    const calls = get.mock.calls.filter(([url]: any[]) => String(url).startsWith('/services'));
    expect(calls.length).toBeGreaterThan(0);
    for (const [url] of calls) {
      expect(String(url)).toContain('orderType=TASK_ORDER');
      expect(String(url)).toContain('take=20');
    }
  });

  it('13. it never touches a clinical note', async () => {
    post.mockResolvedValue({ id: 'ord-1' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <AddProcedureModal open visitId="visit-1" onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    const search = screen.getByRole('combobox', { name: 'Search procedures and investigations' });
    await userEvent.click(search);
    await userEvent.type(search, 'wound');
    await userEvent.click(await screen.findByTitle('Wound dressing'));
    await userEvent.click(screen.getByRole('button', { name: 'Add Order' }));
    await waitFor(() => expect(post).toHaveBeenCalled());

    const keys = invalidate.mock.calls.flatMap((call: unknown[]) => {
      const key = (call[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
      return Array.isArray(key) ? [String(key[0])] : [];
    });
    expect(keys).not.toContain('clinical-notes');
  });

  it('14. it holds no historical order list', async () => {
    openProcedure();
    await screen.findByRole('combobox', { name: 'Search procedures and investigations' });
    expect(screen.queryByText(/Orders \/ Procedures \(/)).not.toBeInTheDocument();
  });
});

// ===========================================================================
// G4.5d5b-1 — WHAT DID NOT BECOME A MODAL
//
// The owner's rule is a rule about which interaction fits which task, not a
// direction to move everything into dialogs. Diagnosis is the case that
// proves it: search-and-select, one field, done while talking to the patient.
// A modal would make the commonest clinical entry slower.
// ===========================================================================
describe('Diagnosis stays inline', () => {
  it('15. the diagnosis rail exposes no modal trigger', async () => {
    const { DiagnosisRail } = await import('../sections/DiagnosisRail');
    render(
      <Harness>
        <DiagnosisRail visitId="visit-1" />
      </Harness>,
    );
    // The search field is on the surface, not behind an "Add Diagnosis" button
    // that opens a dialog.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^add diagnosis$/i })).not.toBeInTheDocument();
  });

  it('16. its search control is rendered inline on the rail itself', async () => {
    const { DiagnosisRail } = await import('../sections/DiagnosisRail');
    const { container } = render(
      <Harness>
        <DiagnosisRail visitId="visit-1" />
      </Harness>,
    );
    await waitFor(() => expect(container.querySelector('.ant-select')).not.toBeNull());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
