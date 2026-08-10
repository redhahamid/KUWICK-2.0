// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { CopyRxModal } from './CopyRxModal';

// ===========================================================================
// KW2-C2 — THE COPY RX REVIEW MODAL
//
// The spec's rule is one sentence: never blind-copy. These tests hold the
// three things that make the review real — only ticked rows are sent, the
// allergy panel says no more than a string comparison can support, and a
// flagged row still copies if the doctor decides it should.
// ===========================================================================

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post, patch: vi.fn(), delete: vi.fn() },
}));

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const DETAIL = {
  prescriptions: [
    {
      id: 'rx-1',
      status: 'ORDERED',
      amount: '1',
      unit: 'tab',
      frequency: 'TDS',
      durationDays: 5,
      quantity: 15,
      item: { name: 'Tab Penicillin V 250mg' },
    },
    {
      id: 'rx-2',
      status: 'ORDERED',
      amount: '2',
      unit: 'tab',
      frequency: 'QID',
      durationDays: 3,
      quantity: 24,
      item: { name: 'Tab Paracetamol 500mg' },
    },
  ],
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  message.destroy();
  get.mockResolvedValue(DETAIL);
  post.mockResolvedValue({ prescriptions: [], supplySummary: '' });
});

const renderModal = (allergies: string[] | null = null, onClose = vi.fn()) => {
  render(
    <Harness>
      <CopyRxModal
        open
        sourceVisitId="visit-old"
        sourceLabel="4 Aug · 02:18"
        patientId="patient-1"
        targetVisitId="visit-today"
        allergies={allergies}
        onClose={onClose}
      />
    </Harness>,
  );
  return onClose;
};

describe('the review itself', () => {
  it('1. lists the source visit’s medications with what would be copied', async () => {
    renderModal();
    expect(await screen.findByText('Tab Penicillin V 250mg')).toBeInTheDocument();
    expect(screen.getByText(/1 tab · TDS · ×5d/)).toBeInTheDocument();
  });

  it('2. only the TICKED medications are sent', async () => {
    // The whole point of the modal. Unticking one must mean one fewer.
    renderModal();
    await screen.findByText('Tab Penicillin V 250mg');
    const rows = screen.getAllByTestId('copy-rx-row');
    await userEvent.click(within(rows[0]).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Add 1 selected' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({
      sourceVisitId: 'visit-old',
      targetVisitId: 'visit-today',
      prescriptionIds: ['rx-2'],
    });
  });

  it('3. the button counts the selection, and says what to do when empty', async () => {
    renderModal();
    await screen.findByText('Tab Penicillin V 250mg');
    expect(screen.getByRole('button', { name: 'Add 2 selected' })).toBeInTheDocument();
    for (const row of screen.getAllByTestId('copy-rx-row')) {
      await userEvent.click(within(row).getByRole('checkbox'));
    }
    expect(screen.getByRole('button', { name: 'Select medications to copy' })).toBeDisabled();
  });

  it('4. cancelling copies nothing', async () => {
    const onClose = renderModal();
    await screen.findByText('Tab Penicillin V 250mg');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(post).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('what the modal may claim about allergies', () => {
  it('5. NO RECORD is itself a warning', async () => {
    renderModal(null);
    expect(await screen.findByText(/No allergy record for this patient/)).toBeInTheDocument();
  });

  it('6. recorded allergies are shown VERBATIM, under a heading that says who checks', async () => {
    renderModal(['Penicillin', 'Sulfa drugs']);
    expect(await screen.findByText('Recorded allergies — check yourself:')).toBeInTheDocument();
    expect(screen.getByText('Penicillin, Sulfa drugs')).toBeInTheDocument();
  });

  it('7. asked-and-none-known is neither a warning nor silence', async () => {
    renderModal([]);
    expect(await screen.findByText('Recorded allergies — check yourself:')).toBeInTheDocument();
    expect(screen.getByText('No known allergy recorded.')).toBeInTheDocument();
  });

  it('8. a matching row is flagged as POSSIBLE, and names the term', async () => {
    renderModal(['Penicillin']);
    await screen.findByText('Tab Penicillin V 250mg');
    const flagged = screen.getAllByTestId('copy-rx-row').filter(
      (row) => row.getAttribute('data-flagged') === 'true',
    );
    expect(flagged).toHaveLength(1);
    expect(within(flagged[0]).getByText(/possible allergy match — verify/)).toBeInTheDocument();
    expect(within(flagged[0]).getByText(/matches: Penicillin/)).toBeInTheDocument();
  });

  it('9. it NEVER says an interaction was detected', async () => {
    // There is no drug dictionary behind this. A warning that overclaims is
    // one that gets trusted and then, one day, missed.
    renderModal(['Penicillin']);
    await screen.findByText('Tab Penicillin V 250mg');
    expect(screen.queryByText(/interaction/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/contraindicat/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/do not prescribe/i)).not.toBeInTheDocument();
  });

  it('10. a flagged medication is NOT blocked — the doctor still decides', async () => {
    renderModal(['Penicillin']);
    await screen.findByText('Tab Penicillin V 250mg');
    const flagged = screen
      .getAllByTestId('copy-rx-row')
      .find((row) => row.getAttribute('data-flagged') === 'true')!;
    expect(within(flagged).getByRole('checkbox')).not.toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Add 2 selected' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1].prescriptionIds).toContain('rx-1');
  });
});
