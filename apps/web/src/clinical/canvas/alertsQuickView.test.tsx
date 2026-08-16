// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertsQuickView } from './AlertsQuickView';
import { Patient } from '../../core/types';

// ===========================================================================
// THE ALERTS OPEN WHERE THE CHIP IS.
//
// FIX 1 gave the alert chip its own view instead of the full profile, but made
// it a centred modal — the canvas dimmed to answer "what is this patient
// flagged for?". The allergy chip beside it had already settled the shape.
//
// What these hold is the shape (anchored, dismissed by clicking away) and the
// thing an anchored form can lose that a modal cannot: a dropdown inside a
// popover renders in its own portal, and a click there must not read as a
// click OUTSIDE the popover and take the half-filled form with it.
// ===========================================================================

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post, patch, delete: vi.fn(), put: vi.fn(), postFile: vi.fn() },
  downloadFile: vi.fn(),
  fetchBlobUrl: vi.fn(),
}));

const PATIENT = { id: 'p1', name: 'Aisyah Ujian' } as Patient;

const ALERT = {
  id: 'a1',
  patientId: 'p1',
  type: 'MEDICAL',
  label: 'Type 2 diabetes',
  note: null,
  active: true,
  createdAt: '2026-08-01T02:30:00.000Z',
  createdByStaffId: 's1',
  createdByName: 'Dr Amira Rahman',
  deactivatedAt: null,
  deactivatedByName: null,
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  get.mockImplementation(async (url: string) => (String(url).includes('/alerts') ? [ALERT] : []));
  post.mockResolvedValue({ id: 'a2' });
});

const open = (props: { canEdit?: boolean; canRecordMedical?: boolean } = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AlertsQuickView patient={PATIENT} canEdit canRecordMedical {...props}>
        <button type="button">1 alert</button>
      </AlertsQuickView>
    </QueryClientProvider>,
  );

describe('the alerts answer where they were asked', () => {
  it('opens under the chip, with the alerts and the patient named', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: '1 alert' }));

    const view = within(await screen.findByTestId('patient-alerts-popover'));
    expect(await view.findByText('Type 2 diabetes')).toBeInTheDocument();
    // Named, so a doctor is not trusting they opened it from the right row.
    expect(view.getByText('Aisyah Ujian')).toBeInTheDocument();
  });

  it('dims nothing — it is a popover, not a modal in disguise', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: '1 alert' }));
    await screen.findByTestId('patient-alerts-popover');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.ant-modal-mask')).toBeNull();
  });

  it('closes on the chip again, without a Close button to hunt for', async () => {
    open();
    const chip = screen.getByRole('button', { name: '1 alert' });
    await userEvent.click(chip);
    await screen.findByTestId('patient-alerts-popover');

    await userEvent.click(chip);
    // Hidden rather than unmounted: antd keeps popover content in the DOM, and
    // that is worth keeping — a doctor who clicks away mid-entry finds the
    // half-typed alert still there when they reopen it.
    await waitFor(() => expect(screen.getByTestId('patient-alerts-popover')).not.toBeVisible());
  });

  it('keeps the same rules as the profile: an alert is resolved, never deleted', async () => {
    // The panel inside is the profile's, in its compact layout. If a lighter
    // re-write ever replaces it, this is what notices.
    patch.mockResolvedValue({ ...ALERT, active: false });
    open();
    await userEvent.click(screen.getByRole('button', { name: '1 alert' }));

    const view = within(await screen.findByTestId('patient-alerts-popover'));
    await userEvent.click(await view.findByRole('button', { name: 'Resolve' }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0][0]).toBe('/patient-alerts/a1/deactivate');
  });

  it('choosing an alert type does not dismiss the form under the doctor', async () => {
    // The Type dropdown renders in its OWN portal, outside the popover's DOM.
    // A click there reaching the popover's click-away handler would close the
    // whole thing mid-entry, losing a typed label — the exact failure a modal
    // cannot have and an anchored form can.
    open();
    await userEvent.click(screen.getByRole('button', { name: '1 alert' }));
    const view = within(await screen.findByTestId('patient-alerts-popover'));
    await userEvent.click(await view.findByRole('button', { name: 'Add alert' }));

    await userEvent.type(await view.findByLabelText('Alert'), 'Wheelchair user');

    const combobox = view.getByRole('combobox');
    await userEvent.click(combobox);
    // Scoped to THIS dropdown via aria-controls, and by title: antd 6's option
    // role node does not carry the click handler.
    const anchor = document.getElementById(combobox.getAttribute('aria-controls') ?? '');
    const dropdown = anchor?.closest('.ant-select-dropdown') as HTMLElement;
    // pointerEventsCheck off: the dropdown is still animating in.
    await userEvent
      .setup({ pointerEventsCheck: 0 })
      .click(await within(dropdown).findByTitle('Accessibility'));

    // Still open, and still holding what was typed.
    expect(screen.getByTestId('patient-alerts-popover')).toBeInTheDocument();
    expect(view.getByLabelText('Alert')).toHaveValue('Wheelchair user');
  });
});
