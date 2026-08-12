// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePatient } from '../../core/hooks/usePatients';
import { useVisit } from '../hooks/useVisits';
import { AllergyStrip } from '../medications/AllergyStrip';
import { AllergyQuickRecord } from './AllergyQuickRecord';

// ===========================================================================
// A2 — allergy quick-record. The header chip is where the allergy question
// gets ANSWERED, and every other surface (strip, Copy Rx, checkpoint) reads
// the patient record this writes. So the tests drive the real round trip:
// the chip renders from the patient QUERY, the popover saves through the
// real mutation, and the assertion is the chip's rendered next state after
// the refetch — the same propagation every other surface rides on.
//
// The confirmed negative is load-bearing: an emptied list must save [] (the
// NONE_KNOWN state), never null, and the button must SAY that is what it
// records — a negative answer recorded by accident under a "save" label
// would poison the three-state model everywhere it is read.
// ===========================================================================

const { get, patch } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('../../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, patch, post: vi.fn(), delete: vi.fn() },
}));

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Renders the chip from the patient QUERY, and the strip from the VISIT's
 * embedded patient copy — the two real read paths. The strip reading the
 * visit copy is exactly how the first live run of this feature went stale:
 * the chip updated and the medications card kept saying "Allergy not asked".
 */
function Screen() {
  const { data: patient } = usePatient('p1');
  const { data: visit } = useVisit('v1');
  if (!patient) return null;
  return (
    <div>
      <AllergyQuickRecord patient={patient} />
      <AllergyStrip allergies={visit ? (visit.patient?.allergies ?? null) : undefined} />
    </div>
  );
}

/** What the server holds; PATCH updates it, the next GET serves it. */
let stored: string[] | null = null;

beforeEach(() => {
  stored = null;
  get.mockImplementation((path: string) => {
    if (path === '/patients/p1') return Promise.resolve({ id: 'p1', name: 'Test Patient', allergies: stored });
    if (path === '/visits/v1')
      return Promise.resolve({ id: 'v1', patient: { id: 'p1', name: 'Test Patient', allergies: stored } });
    return Promise.resolve(null);
  });
  patch.mockImplementation((_path: string, dto: { allergies: string[] }) => {
    stored = dto.allergies;
    return Promise.resolve({ id: 'p1', name: 'Test Patient', allergies: stored });
  });
});

describe('allergy quick-record', () => {
  it('records a confirmed negative as [], and the chip moves from amber to "no known"', async () => {
    render(<Screen />, { wrapper: Harness });
    // Never asked: the amber state.
    const chip = await screen.findByRole('button', { name: /allergy not asked/i });

    await userEvent.click(chip);
    // The empty box is labelled for what it records — a negative answer,
    // deliberately, not a save that happens to be empty.
    await userEvent.click(await screen.findByRole('button', { name: /record: no known allergies/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /no known allergy — edit/i })).toBeInTheDocument(),
    );
    expect(patch).toHaveBeenCalledWith('/patients/p1', { allergies: [] });
  });

  it('records typed allergies verbatim, and the chip carries the words', async () => {
    render(<Screen />, { wrapper: Harness });
    await userEvent.click(await screen.findByRole('button', { name: /allergy not asked/i }));

    const input = await screen.findByRole('combobox', { name: 'Allergies' });
    await userEvent.type(input, 'Penicillin{enter}');
    // A non-empty list flips the button label to a plain save.
    await userEvent.click(screen.getByRole('button', { name: /save allergies/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /allergies: penicillin — edit/i })).toBeInTheDocument(),
    );
    expect(patch).toHaveBeenCalledWith('/patients/p1', { allergies: ['Penicillin'] });

    // The STRIP updates too — it reads the visit's embedded patient copy, so
    // the mutation must refetch visit queries as well. This is the live-run
    // defect: the chip changed and the strip went on saying "not asked".
    await waitFor(() => expect(screen.getByText(/⚠ ALLERGIES: Penicillin/)).toBeInTheDocument());
  });

  it('editing an existing list starts from the recorded words, not a blank box', async () => {
    stored = ['NSAIDs'];
    render(<Screen />, { wrapper: Harness });
    await userEvent.click(await screen.findByRole('button', { name: /allergies: nsaids — edit/i }));

    const input = await screen.findByRole('combobox', { name: 'Allergies' });
    await userEvent.type(input, 'Aspirin{enter}');
    await userEvent.click(screen.getByRole('button', { name: /save allergies/i }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/patients/p1', { allergies: ['NSAIDs', 'Aspirin'] }));
  });
});
