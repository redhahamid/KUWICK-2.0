// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE COUNTER REMEMBERS, AND DOES NOT OVERRULE (N-5).
 *
 * Kuwick 1.0 remembered the panel a patient came in on and 2.0 did not — a
 * regression paid for at the busiest moment of the day, since the card number,
 * the employer and the relationship were keyed again at every visit.
 *
 * Two failures are guarded here, and the second is the subtle one:
 *
 *  1. the pre-fill does not happen, so the re-typing continues;
 *  2. the pre-fill is applied on every render, so it fights the person —
 *     clearing the employer, or switching to Cash because THIS visit is
 *     self-pay, is undone under their cursor. That is worse than no pre-fill:
 *     a form that will not keep what you typed is a form nobody trusts.
 */
const queued: unknown[] = [];
const created: unknown[] = [];

vi.mock('../core/hooks/useClinics', () => ({
  useClinics: () => ({ data: [{ id: 'clinic-1', name: 'Contoh Clinic' }] }),
}));
vi.mock('../core/hooks/useClinicFilter', () => ({ useDefaultClinicId: () => 'clinic-1' }));
vi.mock('../hr/hooks/useStaff', () => ({
  useStaff: () => ({ data: [{ id: 'doc-1', fullName: 'Dr Contoh' }] }),
}));
vi.mock('./printQueueTicket', () => ({ printQueueTicket: vi.fn() }));
vi.mock('./hooks/useQueueTickets', () => ({
  useAddToQueue: () => ({
    isPending: false,
    mutateAsync: async (body: unknown) => {
      queued.push(body);
      return { displayNumber: 'W001', ticketNumber: 1 };
    },
  }),
}));
vi.mock('./hooks/usePanelClinics', () => ({
  usePanelClinics: () => ({
    data: [
      { id: 'panel-1', name: 'Contoh TPA', active: true, limitAmount: 70 },
      { id: 'panel-2', name: 'Contoh Insurer', active: true, limitAmount: null },
    ],
  }),
  useUpdatePanelClinic: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

let prefillData: Record<string, unknown> | undefined;

vi.mock('./hooks/usePanelEmployers', () => ({
  usePanelEmployers: (panelClinicId?: string) => ({
    isLoading: false,
    data: panelClinicId === 'panel-1' ? [{ id: 'emp-1', name: 'Syarikat Contoh' }] : [],
  }),
  useCreatePanelEmployer: () => ({
    isPending: false,
    mutateAsync: async (body: unknown) => {
      created.push(body);
      return { id: 'emp-new', name: (body as { name: string }).name };
    },
  }),
  useCounterPrefill: () => ({ data: prefillData }),
}));

const { AddToQueueDrawer } = await import('./AddToQueueDrawer');

const patient = { id: 'pat-1', name: 'Pesakit Contoh' } as never;

const open = () =>
  render(
    <MemoryRouter>
      <AntApp>
        <AddToQueueDrawer patient={patient} onClose={() => {}} />
      </AntApp>
    </MemoryRouter>,
  );

const sent = () => queued[queued.length - 1] as Record<string, unknown>;

/**
 * The drawer's Doctor field is required and has no default, so nothing submits
 * until it is chosen. Every case below is about the PANEL fields, so this gets
 * the form out of the way rather than being the thing under test.
 */
const chooseDoctor = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByLabelText('Doctor'));
  await user.click(await screen.findByTitle('Dr Contoh'));
};

const submit = async (user: ReturnType<typeof userEvent.setup>) => {
  await chooseDoctor(user);
  await user.click(screen.getByRole('button', { name: 'Add to Queue' }));
  await waitFor(() => expect(queued).toHaveLength(1));
};

beforeEach(() => {
  queued.length = 0;
  created.length = 0;
  prefillData = undefined;
});

describe('the counter, for a patient with no panel history', () => {
  it('starts on Cash and sends no panel fields', async () => {
    prefillData = { autoSelectLastPanel: true, panelClinicId: null };
    const user = userEvent.setup();
    open();

    await submit(user);
    expect(sent().billingType).toBe('Self-pay');
    expect(sent().panelClinicId).toBeUndefined();
    expect(sent().panelEmployerId).toBeUndefined();
  });
});

describe('the counter, for a patient who came in on a panel before', () => {
  beforeEach(() => {
    prefillData = {
      autoSelectLastPanel: true,
      panelClinicId: 'panel-1',
      panelName: 'Contoh TPA',
      panelActive: true,
      employerId: 'emp-1',
      employerName: 'Syarikat Contoh',
      employerActive: true,
      memberReference: 'MC-0012345',
      relationship: 'CHILD',
    };
  });

  it('fills the panel, employer, relationship and card number', async () => {
    const user = userEvent.setup();
    open();

    await waitFor(() => expect(screen.getByDisplayValue('MC-0012345')).toBeTruthy());
    expect(screen.getByText('Contoh TPA')).toBeTruthy();
    expect(screen.getByText('Syarikat Contoh')).toBeTruthy();
    expect(screen.getByText('Child')).toBeTruthy();

    await submit(user);
    expect(sent()).toMatchObject({
      billingType: 'Contoh TPA',
      panelClinicId: 'panel-1',
      panelEmployerId: 'emp-1',
      panelRelationship: 'CHILD',
      panelMemberReference: 'MC-0012345',
    });
  });

  /**
   * THE SUBTLE ONE. If the pre-fill re-applies, switching to Cash snaps back to
   * Panel and the visit is registered against a panel the person said it was
   * not on — which is a wrong bill, not a cosmetic annoyance.
   */
  it('lets the person override it, and does not snap back', async () => {
    const user = userEvent.setup();
    open();
    await waitFor(() => expect(screen.getByDisplayValue('MC-0012345')).toBeTruthy());

    // antd's button-style radio sets `pointer-events: none` on the input
    // itself, so the label is what a person — and this test — clicks.
    await user.click(screen.getByText('Cash'));
    expect(screen.queryByDisplayValue('MC-0012345')).toBeNull();

    await submit(user);
    expect(sent().billingType).toBe('Self-pay');
    expect(sent().panelClinicId).toBeUndefined();
    // And no panel field leaks through on a self-pay visit — the server would
    // refuse an employer without a panel.
    expect(sent().panelEmployerId).toBeUndefined();
    expect(sent().panelMemberReference).toBeUndefined();
  });

  /** The employer belongs to a panel, so changing the panel cannot keep it. */
  it('clears the employer when the panel changes', async () => {
    const user = userEvent.setup();
    open();
    await waitFor(() => expect(screen.getByText('Syarikat Contoh')).toBeTruthy());

    await user.click(screen.getByLabelText('Which panel'));
    await user.click(await screen.findByTitle('Contoh Insurer'));

    await submit(user);
    expect(sent().panelClinicId).toBe('panel-2');
    expect(sent().panelEmployerId).toBeUndefined();
  });

  it('does not pre-select when the clinic has turned the setting off', async () => {
    prefillData = { ...prefillData, autoSelectLastPanel: false };
    const user = userEvent.setup();
    open();

    await submit(user);
    expect(sent().billingType).toBe('Self-pay');
  });

  /**
   * Named, not silently dropped — otherwise the form is simply empty and
   * somebody concludes the patient was always self-pay.
   */
  it('says so when the remembered panel has been switched off', async () => {
    prefillData = { ...prefillData, panelActive: false };
    open();
    await waitFor(() =>
      expect(screen.getByText(/last came in on Contoh TPA, which is switched off/)).toBeTruthy(),
    );
    // And it is not pre-selected, because the picker does not offer it.
    expect(screen.queryByDisplayValue('MC-0012345')).toBeNull();
  });
});

describe('quick-add at the counter', () => {
  it('adds an employer by name and selects it', async () => {
    prefillData = {
      autoSelectLastPanel: true,
      panelClinicId: 'panel-1',
      panelName: 'Contoh TPA',
      panelActive: true,
      employerId: null,
      memberReference: null,
      relationship: null,
    };
    const user = userEvent.setup();
    open();

    await waitFor(() => expect(screen.getByPlaceholderText('Or add a new employer')).toBeTruthy());
    await user.type(screen.getByPlaceholderText('Or add a new employer'), 'Syarikat Baru');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(created).toHaveLength(1));
    // The NAME only: a payment term is a contract fact somebody looks up later,
    // and an employer without one takes the panel's.
    expect(created[0]).toEqual({ panelClinicId: 'panel-1', name: 'Syarikat Baru' });

    await submit(user);
    expect(sent().panelEmployerId).toBe('emp-new');
  });
});
