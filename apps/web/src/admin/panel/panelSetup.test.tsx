// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE SETUP WIZARD SAVES WHAT IT WAS TOLD, AND NOTHING IT WAS NOT (N-2).
 *
 * The failure this guards against is a wizard that is pleasant to click
 * through and quietly helpful: a 30-day term pre-filled because 30 is
 * reasonable, `NO_FEE` where the person said "not sure", a panel kind guessed
 * from a name. Each of those arrives looking like the clinic's own decision
 * and nothing afterwards can tell it apart from one. A payment term in
 * particular decides when a claim is called overdue and a panel gets chased
 * for money it does not yet owe.
 *
 * So these cases read the request BODY. What the screen looks like is a
 * separate question; what it sends is the one that reaches the money.
 */
const sent: unknown[] = [];
const navigated: string[] = [];

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => (to: string) => navigated.push(to) };
});

vi.mock('../hooks/useAdmin', () => ({
  usePanelSetupStatus: () => ({
    data: {
      needsSetup: true,
      panels: [],
      suggestions: [
        { name: 'Contoh TPA', portalUrl: 'https://portal.example.test', panelType: 'TPA' },
        { name: 'Contoh Insurer', portalUrl: null, panelType: 'INSURER' },
      ],
    },
    isError: false,
    isLoading: false,
  }),
  useCreatePanels: () => ({
    isPending: false,
    mutate: (body: unknown, options?: { onSuccess?: (result: unknown) => void }) => {
      sent.push(body);
      options?.onSuccess?.({ created: [{ id: 'p1' }], withoutTerm: 1, feeUnsettled: 1 });
    },
  }),
}));

const { PanelSetupPage } = await import('./PanelSetupPage');

const open = () =>
  render(
    <MemoryRouter>
      <AntApp>
        <PanelSetupPage />
      </AntApp>
    </MemoryRouter>,
  );

const body = () => sent[sent.length - 1] as { panels: Record<string, unknown>[] };

beforeEach(() => {
  sent.length = 0;
  navigated.length = 0;
});

describe('the panel setup wizard', () => {
  it('offers the platform list, and will not finish with nothing chosen', async () => {
    open();
    expect(screen.getByText('Contoh TPA')).toBeTruthy();
    expect(screen.getByText('Contoh Insurer')).toBeTruthy();
    // Nothing ticked, so there is nothing to go on with.
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
  });

  /**
   * THE WIZARD'S WHOLE PREMISE: one answer is enough, and the rest is recorded
   * as unanswered rather than filled in.
   */
  it('saves a panel with no term and no fee rule when both steps are skipped', async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole('checkbox', { name: /Contoh TPA/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Skip/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Add 1 panel/ }));

    await waitFor(() => expect(sent).toHaveLength(1));
    const [panel] = body().panels;
    expect(panel.name).toBe('Contoh TPA');
    // NOT 30. A guessed term decides when a claim is called late.
    expect(panel.paymentTermDays).toBeUndefined();
    // NOT NO_FEE. "Nobody has asked" and "this panel charges nothing" are
    // different facts — collapsing them is what D-112 was spent separating.
    expect(panel.feeTreatment).toBe('UNCONFIGURED');
    expect(panel.claimFeeValue).toBeUndefined();
    // The kind and the portal travel from the suggestion, so they are not
    // re-typed — these the platform did record.
    expect(panel.panelType).toBe('TPA');
    expect(panel.portalUrl).toBe('https://portal.example.test');
  });

  it('sends the term and the fee when they are given, as withheld', async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole('checkbox', { name: /Contoh TPA/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.type(screen.getByLabelText('Days to pay'), '20');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.click(screen.getByLabelText('Fee'));
    await user.click(await screen.findByTitle(/fixed amount per claim/i));
    await user.type(screen.getByLabelText('Fee amount'), '8');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Add 1 panel/ }));

    await waitFor(() => expect(sent).toHaveLength(1));
    const [panel] = body().panels;
    expect(panel.paymentTermDays).toBe(20);
    expect(panel.claimFeeType).toBe('AMOUNT');
    expect(panel.claimFeeValue).toBe(8);
    // The standing rule since 31 August 2026: a panel's fee is WITHHELD from
    // what it pays, not added to the bill. A wizard that chose
    // ADDED_TO_RECEIVABLE would overstate every receivable by twice the fee.
    expect(panel.feeTreatment).toBe('WITHHELD_FROM_CLAIM');
  });

  it('carries a panel the clinic typed itself, which the platform list cannot know', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByPlaceholderText(/panel of your own/i), 'Syarikat Contoh');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Skip/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Add 1 panel/ }));

    await waitFor(() => expect(sent).toHaveLength(1));
    const [panel] = body().panels;
    expect(panel.name).toBe('Syarikat Contoh');
    // Nothing is guessed about a panel nobody has described.
    expect(panel.panelType).toBeUndefined();
    expect(panel.portalUrl).toBeUndefined();
  });

  /**
   * Panels genuinely differ, and asking the same two questions twenty times
   * would not be answered honestly — so the answers apply to all and the
   * review step is where one row is corrected.
   */
  it('lets the review step override one panel without touching the others', async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole('checkbox', { name: /Contoh TPA/ }));
    await user.click(screen.getByRole('checkbox', { name: /Contoh Insurer/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText('Days to pay'), '30');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.clear(screen.getByLabelText('Days to pay — Contoh Insurer'));
    await user.type(screen.getByLabelText('Days to pay — Contoh Insurer'), '90');
    await user.click(screen.getByRole('button', { name: /Add 2 panels/ }));

    await waitFor(() => expect(sent).toHaveLength(1));
    const panels = body().panels;
    expect(panels.find((row) => row.name === 'Contoh TPA')!.paymentTermDays).toBe(30);
    expect(panels.find((row) => row.name === 'Contoh Insurer')!.paymentTermDays).toBe(90);
  });

  it('goes to the configuration screen afterwards, where the gaps are chased', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('checkbox', { name: /Contoh TPA/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Skip/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: /Add 1 panel/ }));

    await waitFor(() => expect(navigated).toEqual(['/admin/panel/configuration']));
  });
});
