// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsultationFooter } from './ConsultationFooter';
import { DoctorPhaseStatus, Visit } from './types';

// ===========================================================================
// G4.5d3c-3a (D-089) — CONSULTATION FOOTER, IN A DOM
//
// The requirements that are not expressible as a pure function: that nothing
// offers completion before eligibility is known, that a review button moves
// focus to a real section, that cancelling writes nothing, and — the one that
// matters most — that no state this footer enters can reach the Clinical Note
// editor's text.
// ===========================================================================

const { get, patch } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));

vi.mock('../core/api-client', async () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly body: unknown,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return { ApiError, apiClient: { get, patch } };
});

vi.mock('../hr/hooks/useStaff', () => ({
  useStaff: () => ({ data: [{ id: 'dr-a', fullName: 'Amira Rahman', role: 'DOCTOR_RESIDENT' }] }),
}));

const { ApiError } = await import('../core/api-client');

const VISIT = { id: 'visit-1', checkOutAt: null } as Visit;

const STATUS = (over: Partial<DoctorPhaseStatus> = {}): DoctorPhaseStatus => ({
  visitId: 'visit-1',
  completed: false,
  doctorCompletedAt: null,
  doctorCompletedByStaffId: null,
  queueStatus: 'IN_CONSULTATION',
  blockers: [],
  destination: 'DISPENSARY',
  routingReason: 'DISPENSARY_REQUIRED',
  ...over,
});

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * The Clinical Note editor, standing in for the real one.
 *
 * It is deliberately UNCONTROLLED and counts its own mounts: if anything the
 * footer does remounts the subtree or pushes a server seed through it, the
 * typed text disappears and the mount count moves. That is exactly the C1
 * failure this checkpoint must not reintroduce.
 */
let mounts = 0;
function FakeNoteEditor() {
  mounts += 1;
  return (
    <div id="kw-anchor-note">
      <label htmlFor="note">Clinical note</label>
      <textarea id="note" defaultValue="" />
    </div>
  );
}

function renderFooter(onReview = vi.fn()) {
  const result = render(
    <Harness>
      <div>
        <FakeNoteEditor />
        <div id="kw-anchor-orders">orders</div>
        <div id="kw-anchor-medications">medications</div>
        <ConsultationFooter visit={VISIT} onReview={onReview} />
      </div>
    </Harness>,
  );
  return { ...result, onReview };
}

const note = () => screen.getByLabelText('Clinical note') as HTMLTextAreaElement;

beforeEach(() => {
  mounts = 0;
  get.mockReset();
  patch.mockReset();
});

describe('1. loading', () => {
  it('no completion action flashes before the status resolves', async () => {
    let release: (value: DoctorPhaseStatus) => void = () => {};
    get.mockReturnValue(new Promise<DoctorPhaseStatus>((resolve) => (release = resolve)));
    renderFooter();

    expect(screen.getByText('Checking consultation status…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /complete/i })).not.toBeInTheDocument();

    release(STATUS());
    expect(await screen.findByRole('button', { name: 'Complete & Send to Dispensary' })).toBeInTheDocument();
  });

  it('the loading state is announced, not just drawn', () => {
    get.mockReturnValue(new Promise(() => {}));
    renderFooter();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});

describe('2. a failed read preserves the Canvas', () => {
  it('says so, offers no action, and does not touch the editor', async () => {
    get.mockRejectedValue(new ApiError('boom', 500, null));
    renderFooter();
    await userEvent.type(note(), 'Patient reports chest pain since Tuesday.');

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Consultation status unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /complete/i })).not.toBeInTheDocument();
    expect(note().value).toBe('Patient reports chest pain since Tuesday.');
    expect(mounts).toBe(1);
  });
});

describe('3/7/8/9. blocked', () => {
  const blockers = (...codes: string[]) =>
    STATUS({
      blockers: codes.map((code) => ({ code, message: 'server text' })) as never,
      destination: null,
      routingReason: null,
    });

  it('shows every blocker together, in the approved order, with no completion action', async () => {
    get.mockResolvedValue(
      blockers('MEDICATION_SUPPLY_DEFERRED', 'SIGNED_NOTE_REQUIRED', 'PROCEDURE_PENDING'),
    );
    renderFooter();

    const alert = await screen.findByRole('alert');
    const lines = within(alert)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(lines).toEqual([
      'Clinical note must be signed before completing consultation.',
      'A procedure is still pending or in progress.',
      'Deferred medication supply must be resolved.',
    ]);
    expect(screen.queryByRole('button', { name: /^Complete/ })).not.toBeInTheDocument();
  });

  it('38. blockers carry alert semantics so a screen reader is told', async () => {
    get.mockResolvedValue(blockers('SIGNED_NOTE_REQUIRED'));
    renderFooter();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });

  it('the disabled completion is explained by visible text, not by an absent button alone', async () => {
    get.mockResolvedValue(blockers('SIGNED_NOTE_REQUIRED'));
    renderFooter();
    expect(await screen.findByText(/Consultation cannot be completed yet/)).toBeInTheDocument();
  });
});

describe('10–13. review actions', () => {
  const blockers = (...codes: string[]) =>
    STATUS({
      blockers: codes.map((code) => ({ code, message: 's' })) as never,
      destination: null,
      routingReason: null,
    });

  it.each([
    ['10. Review and Sign Clinical Note', 'SIGNED_NOTE_REQUIRED', 'note'],
    ['11. Review Orders', 'PROCEDURE_PENDING', 'orders'],
    ['12. Review Medications', 'MEDICATION_SUPPLY_UNCONFIRMED', 'medications'],
  ])('%s hands off to the existing section', async (label, code, anchor) => {
    get.mockResolvedValue(blockers(code));
    const { onReview } = renderFooter();
    await userEvent.click(await screen.findByRole('button', { name: label.replace(/^\d+\. /, '') }));
    expect(onReview).toHaveBeenCalledWith(anchor);
  });

  it('13. the procedure blocker offers no Send to Procedure control', async () => {
    get.mockResolvedValue(blockers('PROCEDURE_PENDING'));
    renderFooter();
    await screen.findByRole('button', { name: 'Review Orders' });
    expect(screen.queryByRole('button', { name: /send to procedure/i })).not.toBeInTheDocument();
  });

  it('the footer grows no second signing control', async () => {
    get.mockResolvedValue(blockers('SIGNED_NOTE_REQUIRED'));
    renderFooter();
    const footer = await screen.findByRole('region', { name: 'Consultation completion' });
    // "Review and Sign" navigates; it must not itself be a sign action.
    expect(within(footer).queryByRole('button', { name: /^sign/i })).not.toBeInTheDocument();
  });

  it('reviewing does not disturb unsaved note text', async () => {
    get.mockResolvedValue(blockers('SIGNED_NOTE_REQUIRED'));
    renderFooter();
    await userEvent.type(note(), 'Draft in progress');
    await userEvent.click(await screen.findByRole('button', { name: 'Review and Sign Clinical Note' }));
    expect(note().value).toBe('Draft in progress');
    expect(mounts).toBe(1);
  });
});

describe('19. the doctor is never offered Complete Visit', () => {
  it.each([
    ['DISPENSARY_REQUIRED'],
    ['PATIENT_PAYMENT_REQUIRED'],
    ['BILLING_REVIEW_REQUIRED'],
    ['NO_DOWNSTREAM_WORK'],
  ])('%s renders no Complete Visit control', async (reason) => {
    get.mockResolvedValue(STATUS({ routingReason: reason as never }));
    renderFooter();
    await screen.findByRole('button', { name: /^Complete/ });
    expect(screen.queryByRole('button', { name: /complete visit/i })).not.toBeInTheDocument();
  });
});

describe('20–23. confirmation', () => {
  it('21. the approved title and summary appear, and the destination is not a choice', async () => {
    get.mockResolvedValue(STATUS({ routingReason: 'BILLING_REVIEW_REQUIRED', destination: 'PAYMENT' }));
    renderFooter();
    await userEvent.click(await screen.findByRole('button', { name: 'Complete & Send for Billing Review' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Complete consultation and send for Billing Review?')).toBeInTheDocument();
    expect(within(dialog).getByText('Billing responsibility has not been confirmed.')).toBeInTheDocument();
    // No radio, no select, no alternative destination.
    expect(within(dialog).queryAllByRole('radio')).toHaveLength(0);
    expect(within(dialog).queryAllByRole('combobox')).toHaveLength(0);
    expect(within(dialog).queryByText(/payment required/i)).not.toBeInTheDocument();
  });

  it('22. cancelling performs no write', async () => {
    get.mockResolvedValue(STATUS());
    renderFooter();
    await userEvent.click(await screen.findByRole('button', { name: 'Complete & Send to Dispensary' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(patch).not.toHaveBeenCalled();
  });

  it('23. a submission in flight cannot be sent twice', async () => {
    get.mockResolvedValue(STATUS());
    let finish: (value: unknown) => void = () => {};
    patch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderFooter();

    await userEvent.click(await screen.findByRole('button', { name: 'Complete & Send to Dispensary' }));
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Complete & Send to Dispensary',
    });
    await userEvent.click(confirm);
    await userEvent.click(confirm);
    await userEvent.click(confirm);
    expect(patch).toHaveBeenCalledTimes(1);

    finish({ ...STATUS(), alreadyCompleted: false, reason: 'DISPENSARY_REQUIRED' });
  });

  it('37. focus returns to the trigger when the dialog closes', async () => {
    get.mockResolvedValue(STATUS());
    renderFooter();
    const trigger = await screen.findByRole('button', { name: 'Complete & Send to Dispensary' });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('36. the whole flow is operable from the keyboard', async () => {
    get.mockResolvedValue(STATUS());
    renderFooter();
    const trigger = await screen.findByRole('button', { name: 'Complete & Send to Dispensary' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('24–28. completed state', () => {
  const completed = STATUS({
    completed: true,
    doctorCompletedAt: '2026-08-03T10:03:00.000Z',
    doctorCompletedByStaffId: 'dr-a',
    destination: 'DISPENSARY',
    routingReason: 'DISPENSARY_REQUIRED',
    queueStatus: 'READY_FOR_DISPENSARY',
  });

  it('24/25. the stored completion and the server queue status are shown, with no action', async () => {
    get.mockResolvedValue(completed);
    renderFooter();

    expect(await screen.findByText('Doctor phase completed')).toBeInTheDocument();
    expect(screen.getByText('Dr Amira Rahman')).toBeInTheDocument();
    expect(screen.getByText('Dispensary')).toBeInTheDocument();
    expect(screen.getByText('Ready for Dispensary')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Complete/ })).not.toBeInTheDocument();
  });

  it('26. a NULL checkOutAt is shown as awaiting overall completion', async () => {
    get.mockResolvedValue(completed);
    renderFooter();
    expect(await screen.findByText('Awaiting overall completion')).toBeInTheDocument();
    expect(screen.queryByText(/visit completed/i)).not.toBeInTheDocument();
  });

  it('17/28. a billing-review completion never reads Payment', async () => {
    get.mockResolvedValue(
      STATUS({ ...completed, destination: 'PAYMENT', routingReason: 'BILLING_REVIEW_REQUIRED' }),
    );
    renderFooter();
    expect(await screen.findByText('Billing Review')).toBeInTheDocument();
    expect(screen.queryByText('Payment')).not.toBeInTheDocument();
  });

  it('27. an already-completed report says so and sends no second mutation', async () => {
    get.mockResolvedValue(STATUS());
    patch.mockResolvedValue({ alreadyCompleted: true, destination: 'DISPENSARY' });
    renderFooter();

    await userEvent.click(await screen.findByRole('button', { name: 'Complete & Send to Dispensary' }));
    const dialog = await screen.findByRole('dialog');
    // The refetch after the mutation now returns the completed record.
    get.mockResolvedValue(completed);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Complete & Send to Dispensary' }));

    expect(await screen.findByText('Consultation was already completed.')).toBeInTheDocument();
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('the completed summary is announced as status, not as an alert', async () => {
    get.mockResolvedValue(completed);
    renderFooter();
    await screen.findByText('Doctor phase completed');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });
});

describe('31–35. C1 draft safety', () => {
  const typed = 'O/E: chest clear, no added sounds. Plan: review in 3/7.';

  it('31. the status preview leaves the note untouched and does not remount it', async () => {
    get.mockResolvedValue(STATUS());
    renderFooter();
    await userEvent.type(note(), typed);
    await screen.findByRole('button', { name: 'Complete & Send to Dispensary' });
    expect(note().value).toBe(typed);
    expect(mounts).toBe(1);
  });

  it('32. a successful mutation leaves the note untouched', async () => {
    get.mockResolvedValue(STATUS());
    patch.mockResolvedValue({ alreadyCompleted: false, destination: 'DISPENSARY' });
    renderFooter();
    await userEvent.type(note(), typed);

    await userEvent.click(await screen.findByRole('button', { name: 'Complete & Send to Dispensary' }));
    const dialog = await screen.findByRole('dialog');
    get.mockResolvedValue(STATUS({ completed: true, doctorCompletedAt: '2026-08-03T10:03:00.000Z', doctorCompletedByStaffId: 'dr-a' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Complete & Send to Dispensary' }));

    await screen.findByText('Doctor phase completed');
    expect(note().value).toBe(typed);
    expect(mounts).toBe(1);
  });

  it('33. a failed mutation leaves the note untouched and says nothing changed', async () => {
    get.mockResolvedValue(STATUS());
    patch.mockRejectedValue(new ApiError('The server refused.', 500, null));
    renderFooter();
    await userEvent.type(note(), typed);

    await userEvent.click(await screen.findByRole('button', { name: 'Complete & Send to Dispensary' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Complete & Send to Dispensary' }));

    expect(await screen.findByText(/Nothing on this record has been changed/)).toBeInTheDocument();
    expect(note().value).toBe(typed);
    expect(mounts).toBe(1);
  });

  it('34/35. a refetch never reseeds or remounts the note', async () => {
    get.mockResolvedValue(STATUS());
    renderFooter();
    await userEvent.type(note(), typed);
    await screen.findByRole('button', { name: 'Complete & Send to Dispensary' });

    // Whatever the footer's own query does, the editor is not in its subtree
    // and cannot be reached by it.
    get.mockResolvedValue(STATUS({ routingReason: 'PATIENT_PAYMENT_REQUIRED', destination: 'PAYMENT' }));
    await waitFor(() => expect(note().value).toBe(typed));
    expect(mounts).toBe(1);
  });
});

describe('stale preview, fresh refusal', () => {
  it('the write’s blockers replace the stale button, and no text is lost', async () => {
    get.mockResolvedValue(STATUS());
    patch.mockRejectedValue(
      new ApiError('Sign the clinical note before completing the consultation.', 400, {
        blockers: [
          { code: 'SIGNED_NOTE_REQUIRED', message: 'server text' },
          { code: 'PROCEDURE_PENDING', message: 'server text' },
        ],
      }),
    );
    renderFooter();
    await userEvent.type(note(), 'unsaved');

    await userEvent.click(await screen.findByRole('button', { name: 'Complete & Send to Dispensary' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Complete & Send to Dispensary' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Clinical note must be signed before completing consultation.',
      'A procedure is still pending or in progress.',
    ]);
    expect(screen.queryByRole('button', { name: /^Complete/ })).not.toBeInTheDocument();
    expect(note().value).toBe('unsaved');
  });

  it('a raw server error never reaches the doctor as schema text', async () => {
    get.mockResolvedValue(STATUS());
    patch.mockRejectedValue(
      new ApiError('Invalid `prisma.visit.update()` invocation: constraint "visits_pkey"', 500, null),
    );
    renderFooter();
    await userEvent.click(await screen.findByRole('button', { name: 'Complete & Send to Dispensary' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Complete & Send to Dispensary' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Consultation not completed/)).toBeInTheDocument();
    expect(alert.textContent).not.toMatch(/prisma|constraint|visits_pkey/i);
  });
});
