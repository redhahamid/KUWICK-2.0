// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddMedicationModal } from './AddMedicationModal';
import { MedicineSearchBox } from './MedicineSearchBox';
import { Item } from '../../inventory/types';

// ===========================================================================
// b1 — SEARCH-FIRST PRESCRIBING.
//
// "Add Medication" was a button whose only job was to reveal a search box, so
// every prescription began with a click that decided nothing. The box is in the
// rail now, and choosing a result opens the form with the drug LOCKED as its
// title.
//
// The properties worth pinning are the ones a redesign would quietly lose:
// that the form asks which medicine exactly ONCE, that the price and stock the
// doctor was just reading stay in front of them, and that "Add & Add Another"
// puts the cursor back where the next prescription starts.
// ===========================================================================

const { get, post, patch, postFile } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  postFile: vi.fn(),
}));
vi.mock('../../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post, patch, postFile, delete: vi.fn() },
  downloadFile: vi.fn(),
  fetchBlobUrl: vi.fn(async () => 'blob:x'),
}));

const COUGH_SYRUP: Item = {
  id: 'item-1',
  tenantId: 't',
  code: 'BROM4',
  name: 'SYP. BROMHEXINE 4MG/5ML',
  category: null,
  unitOfMeasure: 'Bottle',
  doseDefault: '5',
  doseUnitDefault: 'ml',
  frequencyDefault: 'TDS',
  durationDefault: '5 days',
  instruction: 'Take after food',
  indication: 'Cough',
  concVolMl: null,
  strengthMg: null,
  consumptionMethod: null,
  defaultDispenseQuantity: 1,
  prescriptionReference: null,
  remark: null,
  sellPrice: '15.00',
  cost: null,
  active: true,
  groupTag: 'BATUK, CAIR KAHAK',
  cashOnly: false,
  dosingType: 'ADULT_DEFAULT',
  stockLevels: [{ clinicId: 'c1', quantityOnHand: 20, minThreshold: 5 }],
};

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  get.mockImplementation(async (url: string) => {
    if (String(url).startsWith('/items?')) return [COUGH_SYRUP];
    if (String(url).includes('/items/')) return COUGH_SYRUP;
    return [];
  });
  post.mockResolvedValue({ id: 'rx-1' });
});

describe('the rail search box', () => {
  it('is a search box, not a button in front of one', async () => {
    render(
      <Harness>
        <MedicineSearchBox onPick={vi.fn()} />
      </Harness>,
    );
    // Present and usable with no click first — that is the whole change.
    expect(screen.getByRole('combobox', { name: 'Add medicine' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add medication/i })).toBeNull();
  });

  it('hands the WHOLE medicine up, so the form needs no second request', async () => {
    const onPick = vi.fn();
    render(
      <Harness>
        <MedicineSearchBox onPick={onPick} />
      </Harness>,
    );
    const box = screen.getByRole('combobox', { name: 'Add medicine' });
    await userEvent.click(box);
    await userEvent.type(box, 'brom');
    await userEvent.click(await screen.findByText('BROM4 — SYP. BROMHEXINE 4MG/5ML'));

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    // Not an id: the price, the stock and the dosing type all travelled with it.
    expect(onPick.mock.calls[0][0]).toMatchObject({
      id: 'item-1',
      sellPrice: '15.00',
      dosingType: 'ADULT_DEFAULT',
    });
  });

  it('searches the group as well as the name — the row a doctor types', async () => {
    render(
      <Harness>
        <MedicineSearchBox onPick={vi.fn()} />
      </Harness>,
    );
    const box = screen.getByRole('combobox', { name: 'Add medicine' });
    await userEvent.click(box);
    await userEvent.type(box, 'batuk');
    // The request is what matters here: the server owns the field list.
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(expect.stringContaining('search=batuk')),
    );
  });

  it('shows the group, price and stock on the row it offers', async () => {
    render(
      <Harness>
        <MedicineSearchBox onPick={vi.fn()} />
      </Harness>,
    );
    const box = screen.getByRole('combobox', { name: 'Add medicine' });
    await userEvent.click(box);
    await userEvent.type(box, 'brom');
    const detail = await screen.findByText(/BATUK, CAIR KAHAK · RM 15\.00 · 20 in stock/);
    expect(detail).toBeInTheDocument();
  });
});

describe('the form opens with the drug locked', () => {
  const openForm = (props: Partial<React.ComponentProps<typeof AddMedicationModal>> = {}) =>
    render(
      <Harness>
        <AddMedicationModal
          open
          visitId="visit-1"
          medicine={COUGH_SYRUP}
          onClose={vi.fn()}
          {...props}
        />
      </Harness>,
    );

  it('asks which medicine exactly ONCE — the title is the answer', async () => {
    openForm();
    expect(await screen.findByText('BROM4 — SYP. BROMHEXINE 4MG/5ML')).toBeInTheDocument();
    // Two boxes onto one decision invites a second, different answer.
    expect(screen.queryByRole('combobox', { name: 'Search medicine' })).toBeNull();
  });

  it('keeps the price and stock in front of the doctor while they set the dose', async () => {
    openForm();
    expect(await screen.findByText(/RM 15\.00 · 20 in stock/)).toBeInTheDocument();
  });

  it('says "stock unknown" rather than nothing when nobody has counted', async () => {
    // An absent stock line reads as "in stock", which is the one thing it must
    // never imply — same rule as the search row.
    openForm({ medicine: { ...COUGH_SYRUP, stockLevels: [] } });
    expect(await screen.findByText(/stock unknown/)).toBeInTheDocument();
  });

  it('opens PRE-FILLED from the item master, and says that it did', async () => {
    openForm();
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>(/dose amount/i)).toBeTruthy());
    // The master's dose, unit, frequency and duration, without a request: the
    // medicine was handed over whole.
    expect(get).not.toHaveBeenCalledWith('/items/item-1');
    // By its own attribute: the allergy strip is also a live region, and
    // "the only status on screen" is not a fact this form guarantees.
    expect(document.querySelector('[data-prefilled="true"]')).not.toBeNull();
  });

  it('Add & Add Another returns to the RAIL rather than reopening a search here', async () => {
    const onAddAnother = vi.fn();
    const onClose = vi.fn();
    openForm({ onAddAnother, onClose });

    await userEvent.click(await screen.findByRole('button', { name: /add & add another/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    await waitFor(() => expect(onAddAnother).toHaveBeenCalledTimes(1));
    // Not a close: the parent decides what happens next, and it is "focus the
    // search box", not "leave a filled form for a finished prescription".
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the allergy strip is still above the form, and is not a popup', async () => {
    openForm();
    // Kuwick does not cross-check medicines against allergies; the strip is a
    // standing fact, present for as long as the form is open.
    await waitFor(() => expect(screen.getByRole('button', { name: /add medication/i })).toBeTruthy());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
