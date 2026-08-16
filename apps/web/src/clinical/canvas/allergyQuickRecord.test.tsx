// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePatient } from '../../core/hooks/usePatients';
import { PatientAllergyStrip } from '../medications/AllergyStrip';
import { AllergyQuickRecord } from './AllergyQuickRecord';

// ===========================================================================
// A2 — allergy quick-record, WRITING TO ALERTS.
//
// The chip is where the allergy question gets answered mid-consult, and that
// has not changed: same three states, same two clicks. What changed is where
// it writes. It used to put free text into `patient.allergies` — no author, no
// timestamp, no history — while the alerts view beside it wrote an attributed,
// append-only ALLERGY alert. Two stores for one clinical fact, and the one a
// doctor actually reached for was the unattributed one.
//
// So the round trip these drive is the real one: the chip renders from the
// alerts query, the popover writes alerts, and the assertion is the chip's and
// the STRIP's rendered next state after the refetch. Assert the consequence,
// not the call.
//
// Three things carry weight and are held here: the confirmed negative is
// recorded POSITIVELY (an empty list can no longer imply it), removing an
// allergy RESOLVES rather than deletes, and nothing a doctor sees differs from
// before.
// ===========================================================================

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post, patch, delete: vi.fn(), put: vi.fn(), postFile: vi.fn() },
  downloadFile: vi.fn(),
  fetchBlobUrl: vi.fn(),
}));

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * The chip and the strip side by side, each on its own real read path.
 *
 * The strip is here on purpose. The first live run of this feature went stale
 * exactly this way: the chip updated and the medications card kept saying
 * "Allergy not asked", because the two read different things. They read the
 * same query now, and this is what proves it.
 */
function Screen() {
  const { data: patient } = usePatient('p1');
  if (!patient) return null;
  return (
    <div>
      <AllergyQuickRecord patient={patient} />
      <PatientAllergyStrip patientId="p1" />
    </div>
  );
}

interface StoredAlert {
  id: string;
  patientId: string;
  type: string;
  label: string;
  note: string | null;
  active: boolean;
  createdAt: string;
  createdByStaffId: string | null;
  createdByName: string | null;
  origin?: 'HUMAN' | 'MIGRATED';
  deactivatedAt: string | null;
  deactivatedByName: string | null;
}

/** What the server holds. POST/PATCH update it, the next GET serves it. */
let stored: StoredAlert[] = [];
let nextId = 1;

const alertRow = (type: string, label: string, over: Partial<StoredAlert> = {}): StoredAlert => ({
  id: `alert-${nextId++}`,
  patientId: 'p1',
  type,
  label,
  note: null,
  active: true,
  createdAt: '2026-08-16T02:00:00.000Z',
  createdByStaffId: 's1',
  createdByName: 'Dr Amira',
  origin: 'HUMAN',
  deactivatedAt: null,
  deactivatedByName: null,
  ...over,
});

beforeEach(() => {
  stored = [];
  nextId = 1;
  get.mockReset();
  post.mockReset();
  patch.mockReset();

  get.mockImplementation((path: string) => {
    if (path === '/patients/p1') return Promise.resolve({ id: 'p1', name: 'Test Patient' });
    if (path === '/patients/p1/alerts') return Promise.resolve(stored);
    return Promise.resolve(null);
  });
  post.mockImplementation((_path: string, dto: { type: string; label: string }) => {
    const row = alertRow(dto.type, dto.label);
    stored = [...stored, row];
    return Promise.resolve(row);
  });
  patch.mockImplementation((path: string) => {
    const id = path.split('/')[2];
    stored = stored.map((row) =>
      row.id === id ? { ...row, active: false, deactivatedAt: '2026-08-16T03:00:00.000Z' } : row,
    );
    return Promise.resolve(stored.find((row) => row.id === id));
  });
});

describe('allergy quick-record writes alerts', () => {
  it('records a confirmed negative POSITIVELY, and the chip moves from amber to "no known"', async () => {
    // The fact most easily lost in this move. `allergies = []` used to carry
    // "asked, none known" by implication; implication does not survive the
    // column being dropped, and it never had an author.
    render(<Screen />, { wrapper: Harness });
    await userEvent.click(await screen.findByRole('button', { name: /allergy not asked/i }));
    await userEvent.click(await screen.findByRole('button', { name: /record: no known allergies/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /no known allergy — edit/i })).toBeInTheDocument(),
    );
    expect(post).toHaveBeenCalledWith('/patients/p1/alerts', {
      type: 'NO_KNOWN_ALLERGY',
      label: 'No known allergy',
    });
  });

  it('records typed allergies verbatim, and BOTH the chip and the strip carry the words', async () => {
    render(<Screen />, { wrapper: Harness });
    await userEvent.click(await screen.findByRole('button', { name: /allergy not asked/i }));

    await userEvent.type(await screen.findByRole('combobox', { name: 'Allergies' }), 'Penicillin{enter}');
    await userEvent.click(screen.getByRole('button', { name: /save allergies/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /allergies: penicillin — edit/i })).toBeInTheDocument(),
    );
    expect(post).toHaveBeenCalledWith('/patients/p1/alerts', { type: 'ALLERGY', label: 'Penicillin' });
    // The consequence, on the surface that prescribes.
    await waitFor(() => expect(screen.getByText(/⚠ ALLERGIES: Penicillin/)).toBeInTheDocument());
  });

  it('editing an existing list starts from the recorded words, not a blank box', async () => {
    stored = [alertRow('ALLERGY', 'NSAIDs')];
    render(<Screen />, { wrapper: Harness });
    await userEvent.click(await screen.findByRole('button', { name: /allergies: nsaids — edit/i }));

    await userEvent.type(await screen.findByRole('combobox', { name: 'Allergies' }), 'Aspirin{enter}');
    await userEvent.click(screen.getByRole('button', { name: /save allergies/i }));

    // Only the NEW one is written. Re-posting NSAIDs would append a duplicate
    // to an append-only table, and the chip would read "NSAIDs, NSAIDs".
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/patients/p1/alerts', { type: 'ALLERGY', label: 'Aspirin' }),
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('removing an allergy RESOLVES it — nothing is deleted', async () => {
    // Taking a word out of the box is a clinical decision: "the penicillin
    // reaction turned out to be the virus". The row stays, stamped with who
    // retired it and when — which the free-text array could never hold.
    stored = [alertRow('ALLERGY', 'NSAIDs'), alertRow('ALLERGY', 'Aspirin')];
    render(<Screen />, { wrapper: Harness });
    await userEvent.click(await screen.findByRole('button', { name: /allergies: nsaids, aspirin — edit/i }));

    // antd renders one remove control per tag, in order.
    const removeAspirin = screen.getAllByLabelText('close')[1];
    await userEvent.click(removeAspirin);
    await userEvent.click(screen.getByRole('button', { name: /save allergies/i }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/patient-alerts/alert-2/deactivate'));
    expect(post).not.toHaveBeenCalled();
  });

  it('recording an allergy retires a standing "no known allergy"', async () => {
    // Both cannot be true. Retiring it rather than letting it be outranked
    // silently means the history reads as the sequence it actually was.
    stored = [alertRow('NO_KNOWN_ALLERGY', 'No known allergy')];
    render(<Screen />, { wrapper: Harness });
    await userEvent.click(await screen.findByRole('button', { name: /no known allergy — edit/i }));

    await userEvent.type(await screen.findByRole('combobox', { name: 'Allergies' }), 'Latex{enter}');
    await userEvent.click(screen.getByRole('button', { name: /save allergies/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/patients/p1/alerts', { type: 'ALLERGY', label: 'Latex' }),
    );
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/patient-alerts/alert-1/deactivate'));
  });

  it('says the record is attributed, which is the whole reason it moved', async () => {
    render(<Screen />, { wrapper: Harness });
    await userEvent.click(await screen.findByRole('button', { name: /allergy not asked/i }));
    expect(await screen.findByText(/Recorded against your name, with the time/i)).toBeInTheDocument();
  });
});
