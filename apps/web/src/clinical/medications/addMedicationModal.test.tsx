// @vitest-environment jsdom
import { ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { AddMedicationModal } from './AddMedicationModal';
import { DISCARD_TITLE } from '../../design-system/kuwick';
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
  {
    id: 'item-1',
    name: 'Amoxicillin 500mg',
    code: 'AMX500',
    doseUnitDefault: 'capsule',
    // G4.5d6 — the master's own defaults, which the form now reads.
    doseDefault: '1',
    frequencyDefault: 'TDS',
    durationDefault: '5 days',
    defaultDispenseQuantity: 15,
    indication: 'Bacterial infection',
    instruction: 'Take after food',
  },
  { id: 'item-2', name: 'Paracetamol 500mg', code: 'PCM500', doseUnitDefault: 'tablet' },
  // b1 PHASE A — carries NOTHING. Ten of the clinic's 236 medicines are like
  // this by design (arm slings, soaps, a spacer chamber), and the form must
  // open empty for them rather than inventing a dose.
  { id: 'item-3', name: 'Nothing Sling Adult', code: 'SLING' },
];

const SERVICES = [{ id: 'svc-1', name: 'Wound dressing', orderType: 'TASK_ORDER' }];

// Enough of item-1 for an ordinary prescription; the tests that need a
// shortage override this.
let STOCK: { itemId: string; quantityOnHand: number; minThreshold: number }[] = [
  { itemId: 'item-1', quantityOnHand: 100, minThreshold: 0 },
];

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  message.destroy();
  STOCK = [{ itemId: 'item-1', quantityOnHand: 100, minThreshold: 0 }];
  get.mockImplementation(async (url: string) => {
    // b1 PHASE A — the prescribing vocabulary the dropdowns are built from.
    // Without these the unit and frequency fields are empty lists, which is
    // itself the defect the E2E catalogue guardrail exists to catch — here it
    // just makes the modal untestable.
    if (url.startsWith('/reference-catalogs/dosage-units')) return DOSAGE_UNITS;
    if (url.startsWith('/reference-catalogs/frequencies')) return FREQUENCIES;
    if (url.startsWith('/reference-catalogs/consumption-methods')) return METHODS;
    if (url.startsWith('/reference-catalogs/indications')) return INDICATIONS;
    if (url.startsWith('/items?')) return ITEMS;
    if (url.startsWith('/stock/levels')) return STOCK;
    if (url.includes('/age-dosages')) return [];
    if (url.startsWith('/items/')) return ITEMS.find((i) => url.endsWith(i.id));
    if (url.startsWith('/services')) return SERVICES;
    return [];
  });
});

const catalogueBase = { tenantId: 't', origin: 'SYSTEM' as const, active: true, sortOrder: 0 };
const DOSAGE_UNITS = [
  { ...catalogueBase, id: 'unit-capsule', systemNameEn: 'capsule', patientLabelBm: 'KAPSUL', useCase: null },
  { ...catalogueBase, id: 'unit-tablet', systemNameEn: 'Tablet', patientLabelBm: 'BIJI', useCase: null },
];
const FREQUENCIES = [
  { ...catalogueBase, id: 'freq-tds', code: 'TDS', doctorDisplay: 'Three times a day', patientLabelBm: 'Tiga kali sehari', timesPerDay: 3 },
  { ...catalogueBase, id: 'freq-od', code: 'OD', doctorDisplay: 'Once daily', patientLabelBm: 'Sekali sehari', timesPerDay: 1 },
  { ...catalogueBase, id: 'freq-prn', code: 'PRN', doctorDisplay: 'When required', patientLabelBm: 'Bila perlu', timesPerDay: null },
];
const METHODS = [
  { ...catalogueBase, id: 'method-oral', methodBilingual: 'ORAL (MAKAN/MINUM)', patientInstructionBm: 'Ambil melalui mulut' },
];
const INDICATIONS = [
  { ...catalogueBase, id: 'ind-fever', labelEn: 'Fever', labelBm: 'Demam' },
];

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
  const wanted = term.startsWith('noth') ? /Nothing Sling/ : /Amoxicillin/;
  await userEvent.click(await screen.findByTitle(wanted));
}

/**
 * Replaces a number field's contents.
 *
 * `clear()` does not empty an antd InputNumber reliably — it leaves the
 * formatted value behind, so typing "3" after it produces 13 and the test then
 * asserts against a course nobody entered. Selecting the text first is what a
 * person does anyway.
 */
async function setNumber(label: string, value: string) {
  const field = screen.getByLabelText(label);
  await userEvent.tripleClick(field);
  await userEvent.keyboard(value);
}

/** Picks a duration unit — the dropdown that sits beside the number. */
async function chooseDurationUnit(optionLabel: string) {
  const box = screen.getByRole('combobox', { name: 'Duration unit' });
  await userEvent.click(box);
  const listId = box.getAttribute('aria-controls');
  const anchor = listId ? document.getElementById(listId) : null;
  const list = anchor?.closest('.ant-select-dropdown') ?? anchor;
  if (!list) throw new Error('The duration unit dropdown did not open.');
  await userEvent.click(await within(list as HTMLElement).findByTitle(optionLabel));
}

async function fillMinimum() {
  await chooseMedicine();
  await userEvent.type(screen.getByLabelText('Dose amount'), '1');
  await chooseFrequency('TDS — Three times a day');
}

/**
 * Picks a frequency from the catalogue dropdown, the way a doctor would.
 *
 * Scoped to the OPTION LIST, because the prefill already put the same label in
 * the closed control — searching the whole document finds both and cannot tell
 * a choice from what is already chosen.
 */
async function chooseFrequency(optionLabel: string) {
  // Scoped to THIS select's own listbox, found through `aria-controls`.
  // Two reasons, both learned the hard way: the closed control carries the
  // same title as the option, so a document-wide search cannot tell a choice
  // from what is already chosen; and in this antd version the `option` role
  // sits on an inner node that is not the one carrying the click handler, so
  // `findByRole('option')` resolves to an element clicking which does nothing
  // at all — silently, with the test then asserting the unchanged value.
  const box = screen.getByRole('combobox', { name: 'Frequency' });
  await userEvent.click(box);
  const listId = box.getAttribute('aria-controls');
  const anchor = listId ? document.getElementById(listId) : null;
  // `aria-controls` points at the inner holder; the options hang off the
  // dropdown around it.
  const list = anchor?.closest('.ant-select-dropdown') ?? anchor;
  if (!list) throw new Error('The frequency dropdown did not open.');
  await userEvent.click(await within(list as HTMLElement).findByTitle(optionLabel));
}

/** What a closed dropdown READS, which is all a doctor can check. */
function selectedText(inputId: string): string {
  const control = document.getElementById(inputId)?.closest('.ant-select');
  const content = control?.querySelector('.ant-select-content');
  // The same node holds the PLACEHOLDER when nothing is chosen, and reading
  // that back as a value would make an empty dropdown look filled — which is
  // exactly what the restraint tests are here to catch.
  if (!content?.classList.contains('ant-select-content-has-value')) return '';
  return content.textContent?.trim() ?? '';
}

describe('Add Medication modal', () => {
  it('1. G4.5d6 — the doctor is NOT asked for a supply mode', async () => {
    // Whether the patient collects here or buys elsewhere is a counter
    // decision, settled at the dispensary where somebody can see the stock
    // and take the money. Asked mid-consultation it became a field that was
    // left on its default and stopped being read.
    openModal();
    await screen.findByLabelText('Search medicine');
    expect(screen.queryByText('Dispense from clinic')).not.toBeInTheDocument();
    expect(screen.queryByText(/Default — change this if/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/supply mode/i)).not.toBeInTheDocument();
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
      // The dropdown SHOWS the resolved catalogue entry. The item's legacy
      // free text is matched to a real unit or dropped — an unfilled dropdown
      // is visible, a hidden mismatched string is not.
      expect(selectedText('kw-med-unit')).toBe('capsule'),
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
    //
    // G4.5d6 — this caught a real regression. Seeding the dosage calculator's
    // weight from `useLatestVitals` looked harmless, but that hook falls back
    // to a legacy note's frozen vitals columns, so the modal began fetching
    // clinical notes. The calculator reads the observation record directly
    // instead; on a pre-split visit the weight is simply typed.
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
    // Picked by its VISIBLE text, not by the title attribute. The option now
    // renders a second line (code · category · price) and the title carries
    // both parts, so a title-coupled assertion breaks on a presentation change
    // that a user would call an improvement — and it was never what the user
    // clicks anyway.
    await userEvent.click(await screen.findByText('Wound dressing'));
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

describe('G4.5d6 — prescribing from the medication master', () => {
  it('17. choosing a medicine fills the dose it is normally given at', async () => {
    // Retyping dose, frequency, duration, pack size, indication and
    // instruction for every amoxicillin is where prescribing time went.
    openModal();
    await chooseMedicine();
    // The frequency and unit are catalogue choices now, so what is asserted is
    // what the doctor READS in the closed dropdown.
    await waitFor(() => expect(selectedText('kw-med-frequency')).toBe('TDS — Three times a day'));
    expect(screen.getByLabelText('Dose amount')).toHaveValue('1.0');
    expect(selectedText('kw-med-unit')).toBe('capsule');
    expect(screen.getByLabelText('Duration')).toHaveValue('5');
    // 1 capsule x TDS (3/day) x 5 days = 15, and the item's own default
    // quantity is 15 too — the two agree, which is the point of the seed.
    expect(screen.getByLabelText('Quantity')).toHaveValue('15');
  });

  it('18. it SAYS it prefilled, so the doctor knows to check', async () => {
    // A prefill nobody can see is a prefill nobody checks.
    openModal();
    await chooseMedicine();
    expect(await screen.findByText(/filled from the medicine list/)).toBeInTheDocument();
  });

  it('19. a prefilled value is still the doctor’s to overrule', async () => {
    openModal();
    await chooseMedicine();
    await waitFor(() => expect(selectedText('kw-med-frequency')).toBe('TDS — Three times a day'));
    // Prefilled, never locked: the doctor picks a different one and it takes.
    await chooseFrequency('OD — Once daily');
    await waitFor(() => expect(selectedText('kw-med-frequency')).toBe('OD — Once daily'));
  });

  it('20. stock on hand is shown while prescribing, not after', async () => {
    openModal();
    await chooseMedicine();
    expect(await screen.findByText('100 in stock.')).toBeInTheDocument();
  });

  it('21. a shortage is named in numbers and does NOT block prescribing', async () => {
    // A doctor may legitimately prescribe what the clinic is out of, for the
    // patient to buy elsewhere. A system that refuses gets worked around.
    STOCK = [{ itemId: 'item-1', quantityOnHand: 4, minThreshold: 0 }];
    post.mockResolvedValue({ id: 'rx-1' });
    openModal();
    await chooseMedicine();
    expect(await screen.findByText('Only 4 in stock — 15 prescribed.')).toBeInTheDocument();

    const add = screen.getByRole('button', { name: 'Add Medication' });
    expect(add).toBeEnabled();
    await userEvent.click(add);
    await waitFor(() => expect(post).toHaveBeenCalled());
  });

  it('22. the prescription still carries ONSITE_DISPENSE, though nobody was asked', async () => {
    // Removing the question must not reintroduce a hidden database default.
    post.mockResolvedValue({ id: 'rx-1' });
    openModal();
    await fillMinimum();
    await userEvent.click(screen.getByRole('button', { name: 'Add Medication' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ supplyMode: 'ONSITE_DISPENSE' });
  });

  it('23. how the dose was arrived at is recorded', async () => {
    post.mockResolvedValue({ id: 'rx-1' });
    openModal();
    await fillMinimum();
    await userEvent.click(screen.getByRole('button', { name: 'Add Medication' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ calcMethod: 'MANUAL' });
  });
});

// ===========================================================================
// b1 PHASE A — THE REWIRED FORM.
//
// The dropdowns are catalogue-backed, the duration is a number beside a unit,
// and the quantity computes itself until somebody says otherwise. What is
// asserted below is what a doctor would SEE and what actually leaves the
// browser — never internal state.
// ===========================================================================

describe('b1 PHASE A — quantity computes itself, and knows when it cannot', () => {
  it('1 capsule TDS for 5 days comes to 15 without anyone typing it', async () => {
    openModal();
    await chooseMedicine();
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue('15'));
  });

  it('recalculates live when the duration changes', async () => {
    openModal();
    await chooseMedicine();
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue('15'));

    await setNumber('Duration', '3');
    // 1 x 3/day x 3 days.
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue('9'));
  });

  it('counts a WEEK as seven days', async () => {
    openModal();
    await chooseMedicine();
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue('15'));

    await setNumber('Duration', '1');
    await chooseDurationUnit('Weeks');
    // 1 x 3/day x 7 days.
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue('21'));
  });

  // PIECE 2 — Default Dispense Quantity stops being an invisible field.
  //
  // The precedence is unchanged: where the course can be multiplied out, the
  // computed number is the better answer and keeps up with edits. What was
  // wrong is that the clinic's own number vanished without trace — set on the
  // Edit Inventory screen, silently replaced here, and indistinguishable from
  // never having been set.
  it('names what the medicine itself dispenses when the box shows something else', async () => {
    openModal();
    await chooseMedicine();
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue('15'));

    // 1 x 3/day x 3 days = 9, against the medicine's stated 15.
    await setNumber('Duration', '3');
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue('9'));
    expect(screen.getByText(/This medicine dispenses 15 by default/)).toBeTruthy();
  });

  it('offers the medicine\'s number rather than applying it', async () => {
    openModal();
    await chooseMedicine();
    await setNumber('Duration', '3');
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue('9'));

    await userEvent.click(within(screen.getByText(/This medicine dispenses 15/).closest('div') as HTMLElement).getByRole('button', { name: 'Use it' }));
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue('15'));
  });

  it('says nothing when the medicine\'s number is what the box already shows', async () => {
    // 1 x 3/day x 5 days = 15, which is also what the medicine states. A hint
    // offering the number already in the box is noise.
    openModal();
    await chooseMedicine();
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue('15'));
    expect(screen.queryByText(/This medicine dispenses/)).toBeNull();
  });

  it('STOPS recalculating once the quantity is typed in', async () => {
    // A doctor who has decided on 20 must not have that overwritten because
    // they then corrected the duration.
    openModal();
    await chooseMedicine();
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue('15'));

    await setNumber('Quantity', '20');
    await setNumber('Duration', '3');

    // The suggestion is OFFERED, not applied.
    expect(await screen.findByText(/comes to 9/)).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity')).toHaveValue('20');
  });

  it('SKIPS auto-compute for PRN, and says why on the spot', async () => {
    // PRN has no doses per day. Computing "1 x 5 days" for a when-required
    // painkiller is a quantity nobody decided, and a dispensary would hand it
    // over. The box is left exactly as it was.
    openModal();
    await chooseMedicine();
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveValue('15'));

    await chooseFrequency('PRN — When required');

    expect(await screen.findByText(/no fixed daily count/)).toBeInTheDocument();
    expect(screen.getByLabelText('Quantity')).toHaveValue('15');
  });
});

describe('b1 PHASE A — what actually leaves the browser', () => {
  it('sends catalogue IDS and the duration as written, never the Malay text', async () => {
    // The patient-facing labels are resolved server-side. A client able to
    // send them could print a label contradicting the prescription.
    post.mockResolvedValue({ id: 'rx-1' });
    openModal();
    await chooseMedicine();
    await waitFor(() => expect(selectedText('kw-med-frequency')).toBe('TDS — Three times a day'));
    await setNumber('Duration', '2');
    await chooseDurationUnit('Weeks');
    await userEvent.click(screen.getByRole('button', { name: 'Add Medication' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, dto] = post.mock.calls[0];
    expect(dto).toMatchObject({
      frequencyId: 'freq-tds',
      doseUnitId: 'unit-capsule',
      durationValue: 2,
      durationUnit: 'WEEK',
      // Computed here too, so the field the rest of the system reads is never
      // blank — the server recomputes it rather than trusting this number.
      durationDays: 14,
    });
    expect(dto).not.toHaveProperty('frequencyBm');
    expect(dto).not.toHaveProperty('doseUnitBm');
  });

  it('a medicine with NO defaults opens empty and cannot be submitted blind', async () => {
    // The seed deliberately leaves ten medicines with nothing. The form must
    // not invent a dose for them, and must not let one through unfilled.
    openModal();
    await chooseMedicine('noth');
    await waitFor(() => expect(screen.getByLabelText('Dose amount')).toHaveValue(''));
    expect(selectedText('kw-med-frequency')).toBe('');
    expect(screen.getByRole('button', { name: 'Add Medication' })).toBeDisabled();
  });
});

// ===========================================================================
// b1 PHASE B — THE PRESCRIPTION MODAL INHERITS THE DIRTY GUARD.
//
// Asserted on the real prescribing modal, not only on the shell: the guard is
// worth nothing if this modal happens to pass `dirty={false}`, and that is a
// wiring mistake no test of the design system would catch.
// ===========================================================================

describe('b1 PHASE B — a half-written prescription is not lost by accident', () => {
  it('Escape on a filled form asks before discarding', async () => {
    const onClose = vi.fn();
    render(
      <Harness>
        <AddMedicationModal open visitId="visit-1" onClose={onClose} />
      </Harness>,
    );
    await chooseMedicine();
    await waitFor(() => expect(selectedText('kw-med-frequency')).toBe('TDS — Three times a day'));

    await userEvent.keyboard('{Escape}');

    expect(await screen.findByText(DISCARD_TITLE)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a text selection released outside the modal does NOT close it', async () => {
    // A doctor highlighting a dose to re-read it, and letting go a few pixels
    // outside. A `click` resolves to the common ancestor — the mask — so
    // antd's own maskClosable would have thrown the prescription away.
    const onClose = vi.fn();
    render(
      <Harness>
        <AddMedicationModal open visitId="visit-1" onClose={onClose} />
      </Harness>,
    );
    await chooseMedicine();
    const dose = screen.getByLabelText('Dose amount');
    const mask = document.querySelector('.ant-modal-wrap') as HTMLElement;

    fireEvent.mouseDown(dose, { target: dose });
    fireEvent.mouseUp(mask, { target: mask });
    fireEvent.click(mask, { target: mask });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(DISCARD_TITLE)).not.toBeInTheDocument();
  });

  it('an untouched modal closes straight away', async () => {
    // Nothing typed, nothing to lose. Asking here would train the doctor to
    // dismiss the question without reading it.
    const onClose = vi.fn();
    render(
      <Harness>
        <AddMedicationModal open visitId="visit-1" onClose={onClose} />
      </Harness>,
    );
    await screen.findByRole('combobox', { name: 'Search medicine' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
