// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePatientVisits } from './useVisits';
import { useHoldConsultation, useResumeConsultation } from './useQueueTickets';
import { useClinicalNotes } from './useClinicalNote';

// ===========================================================================
// KW2-C2 — what a hold REFRESHES, and what it must leave alone.
//
// This exists because of a defect found against the running app: the mutation
// invalidated a query key nothing used, so the patient header went on saying
// "In Consult" after the patient had been sent back to the waiting room. A
// screen that disagrees with the queue is the silent state change the whole
// feature was built to prevent, so the refresh is held by a test rather than
// by a key string nobody re-reads.
//
// The other half is the C1 rule: a hold must NOT reach the clinical note
// query, because refetching it remounts the editor and takes an unsaved draft
// with it.
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

/** Reads the same two queries the Canvas does, and offers both transitions. */
function Screen() {
  const { data: visits } = usePatientVisits('patient-1');
  const notes = useClinicalNotes('visit-1');
  const hold = useHoldConsultation();
  const resume = useResumeConsultation();
  const args = { ticketId: 'ticket-1', visitId: 'visit-1', patientId: 'patient-1' };
  return (
    <div>
      <div data-testid="state">{visits?.[0]?.queueTicket?.status ?? 'unknown'}</div>
      <div data-testid="notes">{notes.data?.length ?? 0}</div>
      <button onClick={() => hold.mutateAsync(args)}>hold</button>
      <button onClick={() => resume.mutateAsync(args)}>resume</button>
    </div>
  );
}

const visitWith = (status: string, heldAt: string | null) => [
  { id: 'visit-1', queueTicket: { id: 'ticket-1', status, heldAt } },
];

/** Counts the reads of each surface, so "was it refetched" is a number. */
let noteReads = 0;
beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  noteReads = 0;
  let visitReads = 0;
  get.mockImplementation(async (url: string) => {
    const path = String(url);
    if (path.startsWith('/visits?patientId')) {
      visitReads += 1;
      // The SECOND read reflects the hold, exactly as the server would.
      return visitReads === 1
        ? visitWith('IN_CONSULTATION', null)
        : visitWith('WAITING', '2026-08-10T02:00:00.000Z');
    }
    if (path.includes('clinical-notes')) {
      noteReads += 1;
      return [{ id: 'note-1' }];
    }
    return [];
  });
  patch.mockResolvedValue({ id: 'ticket-1', status: 'WAITING' });
});

describe('holding refreshes what the doctor is looking at', () => {
  it('the visit list is refetched, so the header stops saying In Consult', async () => {
    render(
      <Harness>
        <Screen />
      </Harness>,
    );
    expect(await screen.findByText('IN_CONSULTATION')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'hold' }));

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('WAITING'));
  });

  it('resuming refreshes the same surfaces', async () => {
    render(
      <Harness>
        <Screen />
      </Harness>,
    );
    await screen.findByText('IN_CONSULTATION');

    await userEvent.click(screen.getByRole('button', { name: 'resume' }));

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('WAITING'));
  });

  it('it sends no body — the actor comes from the session', async () => {
    render(
      <Harness>
        <Screen />
      </Harness>,
    );
    await screen.findByText('IN_CONSULTATION');

    await userEvent.click(screen.getByRole('button', { name: 'hold' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());

    expect(patch.mock.calls[0][0]).toBe('/queue-tickets/ticket-1/hold');
    expect(patch.mock.calls[0][1]).toBeUndefined();
  });
});

describe('what a hold must NOT touch', () => {
  it('the clinical note is never refetched (C1/D-091)', async () => {
    // Refetching it remounts the editor and an unsaved draft goes with it —
    // the opposite of "resuming returns them with state intact".
    render(
      <Harness>
        <Screen />
      </Harness>,
    );
    await screen.findByText('IN_CONSULTATION');
    await waitFor(() => expect(noteReads).toBe(1));

    await userEvent.click(screen.getByRole('button', { name: 'hold' }));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('WAITING'));

    expect(noteReads).toBe(1);
  });
});
