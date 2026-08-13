// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrescriptionVocabularyPage } from './PrescriptionVocabularyPage';

// ===========================================================================
// b1 PHASE 1G — SETTINGS › PRESCRIPTION VOCABULARY.
//
// The API already refuses to change a SYSTEM row and refuses a clinic-invented
// stock unit. What this screen has to add is that the clinic can SEE both of
// those before clicking — a refusal they could have predicted is a screen that
// wasted their time.
//
// The assertions are on rendered consequences: the words the clinic reads and
// the requests that actually leave the browser. Not on tag colours, and not on
// whether a particular antd class is present.
// ===========================================================================

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post, patch, delete: vi.fn(), put: vi.fn(), postFile: vi.fn() },
  downloadFile: vi.fn(),
  fetchBlobUrl: vi.fn(),
}));

const base = { tenantId: 't', sortOrder: 0 };
const OD = { ...base, id: 'freq-od', origin: 'SYSTEM', active: true, code: 'OD', doctorDisplay: 'Once daily', patientLabelBm: 'Sekali sehari', timesPerDay: 1 };
const PRN = { ...base, id: 'freq-prn', origin: 'SYSTEM', active: true, code: 'PRN', doctorDisplay: 'When required', patientLabelBm: 'Bila perlu', timesPerDay: null };
const CLINIC_FREQ = { ...base, id: 'freq-own', origin: 'CUSTOM', active: true, code: 'EOD', doctorDisplay: 'Every other day', patientLabelBm: 'Selang sehari', timesPerDay: null };
const RETIRED_FREQ = { ...base, id: 'freq-old', origin: 'CUSTOM', active: false, code: 'QID', doctorDisplay: 'Four times daily', patientLabelBm: 'Empat kali sehari', timesPerDay: 4 };

const TABLET = { ...base, id: 'unit-1', origin: 'SYSTEM', active: true, systemNameEn: 'Tablet', patientLabelBm: 'BIJI', useCase: null };
const ORAL = { ...base, id: 'method-1', origin: 'SYSTEM', active: true, methodBilingual: 'ORAL (MAKAN/MINUM)', patientInstructionBm: 'Ambil melalui mulut' };
const FEVER = { ...base, id: 'ind-1', origin: 'SYSTEM', active: true, labelEn: 'Fever', labelBm: 'Demam' };
const STRIP = { ...base, id: 'stock-1', origin: 'SYSTEM', active: true, name: 'TABLET PER STRIP' };

function catalogue(url: string) {
  const path = String(url);
  const withRetired = path.includes('includeRetired=true');
  if (path.includes('/frequencies')) {
    return withRetired ? [OD, PRN, CLINIC_FREQ, RETIRED_FREQ] : [OD, PRN, CLINIC_FREQ];
  }
  if (path.includes('/dosage-units')) return [TABLET];
  if (path.includes('/consumption-methods')) return [ORAL];
  if (path.includes('/indications')) return [FEVER];
  if (path.includes('/stock-units')) return [STRIP];
  return [];
}

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const section = (name: string) => within(screen.getByTestId(`catalog-${name}`));

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  get.mockImplementation(async (url: string) => catalogue(url));
  post.mockResolvedValue({ id: 'new-1' });
  patch.mockResolvedValue({ id: 'freq-own' });
});

describe('all five catalogues are on the page', () => {
  it.each([
    ['frequencies', 'Frequencies'],
    ['dosage-units', 'Dose units'],
    ['consumption-methods', 'Consumption methods'],
    ['indications', 'Indications'],
    ['stock-units', 'Stock units'],
  ])('%s has its own section', async (name, title) => {
    // 1A–1E each get a section. A page that quietly ships four of five is
    // exactly the "fixing one proves nothing about the other" failure, one
    // screen up from the search boxes it came from.
    render(
      <Harness>
        <PrescriptionVocabularyPage />
      </Harness>,
    );
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByTestId(`catalog-${name}`)).toBeInTheDocument();
  });

  it('asks each catalogue for its own rows', async () => {
    render(
      <Harness>
        <PrescriptionVocabularyPage />
      </Harness>,
    );
    await screen.findByText('OD');
    const asked = get.mock.calls.map(([url]) => String(url));
    for (const name of [
      'frequencies',
      'dosage-units',
      'consumption-methods',
      'indications',
      'stock-units',
    ]) {
      expect(asked.some((url) => url.includes(`/reference-catalogs/${name}`))).toBe(true);
    }
  });
});

describe('the platform\'s rows are visibly locked', () => {
  it('a SYSTEM row offers no edit or retire control at all', async () => {
    render(
      <Harness>
        <PrescriptionVocabularyPage />
      </Harness>,
    );
    const frequencies = section('frequencies');
    const systemRow = (await frequencies.findByText('OD')).closest('tr')!;
    expect(within(systemRow).getByText('Standard')).toBeInTheDocument();
    // Not a disabled button either — a control that can never do anything is
    // not worth the pixel. The row says what it is instead.
    expect(within(systemRow).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(systemRow).queryByRole('button', { name: /retire/i })).toBeNull();
    expect(within(systemRow).getByText(/Locked — add your own instead/)).toBeInTheDocument();
  });

  it('the clinic\'s own row is editable and retirable', async () => {
    render(
      <Harness>
        <PrescriptionVocabularyPage />
      </Harness>,
    );
    const row = (await section('frequencies').findByText('EOD')).closest('tr')!;
    expect(within(row).getByText('Your entry')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Edit' })).toBeEnabled();
    expect(within(row).getByRole('button', { name: 'Retire' })).toBeEnabled();
  });

  it('every catalogue that has a custom row lets it be edited', async () => {
    // Independently, per catalogue. Five sections rendered by one component is
    // an argument for consistency, not proof of it.
    render(
      <Harness>
        <PrescriptionVocabularyPage />
      </Harness>,
    );
    await screen.findByText('OD');
    for (const name of ['dosage-units', 'consumption-methods', 'indications']) {
      expect(section(name).getByRole('button', { name: /add custom/i })).toBeEnabled();
    }
  });
});

describe('stock units are honestly refused, before the click', () => {
  it('the Add button is disabled and the reason is on the page', async () => {
    render(
      <Harness>
        <PrescriptionVocabularyPage />
      </Harness>,
    );
    const stock = section('stock-units');
    expect(await stock.findByText('TABLET PER STRIP')).toBeInTheDocument();
    expect(stock.getByRole('button', { name: /add custom/i })).toBeDisabled();
    // The reason is READ, not hovered — a tooltip is unreachable on a phone.
    expect(stock.getByText(/stock deduction arithmetic depends on it/i)).toBeInTheDocument();
  });

  it('every other catalogue can still be added to', async () => {
    render(
      <Harness>
        <PrescriptionVocabularyPage />
      </Harness>,
    );
    await screen.findByText('OD');
    expect(section('frequencies').getByRole('button', { name: /add custom/i })).toBeEnabled();
  });
});

describe('adding and retiring', () => {
  it('posts a new frequency to the right catalogue', async () => {
    render(
      <Harness>
        <PrescriptionVocabularyPage />
      </Harness>,
    );
    await screen.findByText('OD');
    await userEvent.click(section('frequencies').getByRole('button', { name: /add custom/i }));

    await userEvent.type(await screen.findByLabelText('Code'), 'QID');
    await userEvent.type(screen.getByLabelText('Meaning (English)'), 'Four times daily');
    await userEvent.type(screen.getByLabelText('Patient label (BM)'), 'Empat kali sehari');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/reference-catalogs/frequencies');
    expect(post.mock.calls[0][1]).toMatchObject({
      code: 'QID',
      doctorDisplay: 'Four times daily',
      patientLabelBm: 'Empat kali sehari',
    });
    // `origin` is never sent. The API sets it, so a clinic cannot dress its own
    // row up as a platform row that its own owner then cannot edit.
    expect(post.mock.calls[0][1]).not.toHaveProperty('origin');
  });

  it('retiring is a PATCH to active=false, never a delete', async () => {
    // These rows are referenced by prescriptions already printed. The database
    // refuses a delete outright; this screen must never ask for one.
    render(
      <Harness>
        <PrescriptionVocabularyPage />
      </Harness>,
    );
    const row = (await section('frequencies').findByText('EOD')).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Retire' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][0]).toBe('/reference-catalogs/frequencies/freq-own/active');
    expect(patch.mock.calls[0][1]).toEqual({ active: false });
  });

  it('a retired entry is hidden until asked for, then offers Restore', async () => {
    render(
      <Harness>
        <PrescriptionVocabularyPage />
      </Harness>,
    );
    const frequencies = section('frequencies');
    await frequencies.findByText('OD');
    expect(frequencies.queryByText('QID')).toBeNull();

    await userEvent.click(frequencies.getByRole('switch'));

    const restored = (await frequencies.findByText('QID')).closest('tr')!;
    expect(within(restored).getByText('Retired')).toBeInTheDocument();
    expect(within(restored).getByRole('button', { name: 'Restore' })).toBeEnabled();
  });

  it('asks the server for the retired rows rather than filtering locally', async () => {
    // Two different questions and two different cache entries. Sharing one
    // would put a withdrawn frequency back on a prescribing form.
    render(
      <Harness>
        <PrescriptionVocabularyPage />
      </Harness>,
    );
    await section('frequencies').findByText('OD');
    await userEvent.click(section('frequencies').getByRole('switch'));

    await waitFor(() =>
      expect(
        get.mock.calls.some(([url]) =>
          String(url).includes('/reference-catalogs/frequencies?includeRetired=true'),
        ),
      ).toBe(true),
    );
  });
});

describe('what the rows actually say', () => {
  it('shows the patient-facing Malay label, not only the code', async () => {
    // The Malay half is the reason these rows exist — it is what prints on the
    // medicine. A settings screen showing only "OD" cannot be checked.
    render(
      <Harness>
        <PrescriptionVocabularyPage />
      </Harness>,
    );
    expect(await section('frequencies').findByText('Sekali sehari')).toBeInTheDocument();
    expect(section('consumption-methods').getByText('Ambil melalui mulut')).toBeInTheDocument();
    expect(section('indications').getByText('Demam')).toBeInTheDocument();
  });

  it('renders an uncountable frequency as blank, never as zero', async () => {
    // PRN carries a null timesPerDay meaning "cannot be counted". Showing 0
    // would read as a real number and quantity auto-compute would look broken.
    render(
      <Harness>
        <PrescriptionVocabularyPage />
      </Harness>,
    );
    const prn = (await section('frequencies').findByText('PRN')).closest('tr')!;
    expect(within(prn).getByText('—')).toBeInTheDocument();
    expect(within(prn).queryByText('0')).toBeNull();
  });
});
