// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasPatientHeader, headerAllergyState } from '../CanvasPatientHeader';

// The band reads the patient's alerts, so the tests supply them. Defaults to
// none, which is what the pre-existing cases here assume.
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn(), postFile: vi.fn() },
  downloadFile: vi.fn(),
  fetchBlobUrl: vi.fn(),
}));

beforeEach(() => {
  get.mockReset();
  get.mockImplementation(async () => []);
});
import { Patient } from '../../core/types';
import { Visit } from '../types';

// ===========================================================================
// KW2-C2 — THE PATIENT HEADER
//
// The approved header (spec p.4) removes two buttons as duplicates and keeps
// three that exist nowhere else. What these tests hold is the removal (a
// duplicate creeping back is how "one function, one home" dies) and the
// allergy states, where the difference between "asked and none" and "never
// asked" is clinical rather than cosmetic.
// ===========================================================================

const patient = (over: Partial<Patient> = {}): Patient =>
  ({
    id: 'p1',
    name: 'Aisyah Ujian',
    dob: '1985-01-01',
    gender: 'Female',
    identifierType: 'NRIC',
    identifierValue: '000000-00-1001',
    ...over,
  }) as Patient;

const visit = (over: Partial<Visit> = {}): Visit =>
  ({
    id: 'v1',
    visitNumber: 'V-000004',
    checkInAt: '2026-08-09T09:59:00.000Z',
    checkOutAt: null,
    presentingComplaint: 'Fever & productive cough ×3 days',
    ...over,
  }) as Visit;

// A2: the allergy chip inside the band is a live control (quick-record)
// and holds a mutation, so the band now needs a QueryClient like any screen.
/**
 * b1.5 FIX 1 — the header reads alerts from the API, so these tests supply
 * them. Without a mock the query fails and the chip correctly says "No alerts",
 * which is what the earlier tests here rely on.
 */
const alert = (id: string, type: string, label: string) => ({
  id,
  patientId: 'p1',
  type,
  label,
  note: null,
  active: true,
  createdAt: '2026-08-01T00:00:00Z',
  createdByStaffId: 's1',
  createdByName: 'Dr A',
  deactivatedAt: null,
  deactivatedByName: null,
});

const renderHeader = (over: Partial<Parameters<typeof CanvasPatientHeader>[0]> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CanvasPatientHeader
        patient={patient()}
        visit={visit()}
        onBookAppointment={vi.fn()}
        completionAction={<button type="button">Complete Consultation</button>}
        {...over}
      />
    </QueryClientProvider>,
  );

describe('one function, one home', () => {
  it('1. there is no Documents button — it lives in the canvas card', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: /documents/i })).not.toBeInTheDocument();
  });

  it('2. there is no Investigations button — task orders ARE the investigations', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: /investigation/i })).not.toBeInTheDocument();
  });

  it('3. the three unique actions are all present', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: /appointment/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hold/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /complete consultation/i })).toBeInTheDocument();
  });

  it('4. Hold is disabled where the page cannot offer it', () => {
    // KW2-C2 — the reason changed, the rendering did not. It used to be "not
    // built yet"; it is now "this visit has no queue ticket, or your role may
    // not pause a consultation". A button that silently does nothing is still
    // worse than one that says it is unavailable.
    renderHeader();
    expect(screen.getByRole('button', { name: /hold/i })).toBeDisabled();
  });
});

// ===========================================================================
// KW2-C2 — HOLD and RESUME in the header.
//
// The owner's rule is that nothing changes silently. The header's share of
// that is: say plainly that the patient is paused, name who paused them, and
// never offer both directions at once.
// ===========================================================================
describe('hold and resume', () => {
  it('an offered Hold is live and calls back', async () => {
    const onHold = vi.fn();
    renderHeader({ onHold });
    const button = screen.getByRole('button', { name: /hold/i });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it('a held patient is not described as being in consultation', () => {
    // The pill is the one place a doctor glances to know where the visit
    // stands. Leaving it claiming "In Consult" for a patient who is back in
    // the waiting room is the deviation, not fixing it.
    renderHeader({ heldByName: 'Dr Amira Rahman', onResume: vi.fn() });
    expect(screen.queryByText('In Consult')).not.toBeInTheDocument();
    expect(screen.getByText('On hold · Dr Amira Rahman')).toBeInTheDocument();
  });

  it('the pause is amber, never green', () => {
    const { container } = renderHeader({ heldByName: 'Dr Amira Rahman', onResume: vi.fn() });
    expect(container.querySelector('.kw2-state-held')).not.toBeNull();
  });

  it('Hold gives way to Resume — never both at once', () => {
    // A live "Hold" beside a held patient invites a second pause on a
    // consultation that is already paused.
    renderHeader({ heldByName: 'Dr Amira Rahman', onResume: vi.fn(), onHold: vi.fn() });
    expect(screen.getByRole('button', { name: /resume/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^Hold$/ })).not.toBeInTheDocument();
  });

  it('Resume calls back', async () => {
    const onResume = vi.fn();
    renderHeader({ heldByName: 'Dr Amira Rahman', onResume });
    await userEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('neither direction can be pressed while one is in flight', async () => {
    const onHold = vi.fn();
    renderHeader({ onHold, holdPending: true });
    const button = screen.getByRole('button', { name: /hold/i });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('a completed visit still reads as completed, not as held', () => {
    renderHeader({ visit: visit({ checkOutAt: '2026-08-09T11:00:00.000Z' }), heldByName: 'Dr A' });
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });
});

describe('allergy state — three answers, not two', () => {
  // Read from ALERTS now. `patient.allergies` is gone: one clinical fact had
  // two stores, and the header chip wrote to the one with no author.
  it('5. a recorded allergy is stated in full and marked', async () => {
    get.mockImplementation(async (url: string) =>
      String(url).includes('/alerts')
        ? [alert('a1', 'ALLERGY', 'NSAIDs'), alert('a2', 'ALLERGY', 'Penicillin')]
        : [],
    );
    renderHeader();
    expect(await screen.findByText(/NSAIDs, Penicillin/)).toBeInTheDocument();
  });

  it('6. asked-and-none reads as a negative answer', async () => {
    get.mockImplementation(async (url: string) =>
      String(url).includes('/alerts') ? [alert('a1', 'NO_KNOWN_ALLERGY', 'No known allergy')] : [],
    );
    renderHeader();
    expect(await screen.findByText(/No known allergy/)).toBeInTheDocument();
  });

  it('7. NEVER ASKED is its own state, and says so', async () => {
    // The failure this prevents, and the one the retirement had to be careful
    // about: with no allergy record at all, the chip must NOT read as a
    // negative answer nobody gave.
    renderHeader();
    expect(await screen.findByText(/Allergy not asked/)).toBeInTheDocument();
    expect(screen.queryByText(/No known allergy/)).not.toBeInTheDocument();
  });

  it('8. the three states are distinguishable as data, not only as pixels', () => {
    expect(headerAllergyState([], false)).toBe('NONE_RECORDED');
    expect(headerAllergyState([], true)).toBe('NONE_KNOWN');
    expect(headerAllergyState(['NSAIDs'], false)).toBe('PRESENT');
    // An allergy outranks a stale negative rather than contradicting it.
    expect(headerAllergyState(['NSAIDs'], true)).toBe('PRESENT');
  });
});

describe('what the band says about the visit', () => {
  it('9. an open consult reads In Consult; a closed one reads Completed', () => {
    const { unmount } = renderHeader();
    expect(screen.getByText('In Consult')).toBeInTheDocument();
    unmount();
    renderHeader({ visit: visit({ checkOutAt: '2026-08-09T11:00:00.000Z' }) });
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('10. the payer chip says CASH when there is no panel', () => {
    renderHeader();
    expect(screen.getByText('CASH')).toBeInTheDocument();
  });

  it('11. a panel visit names the panel instead', () => {
    renderHeader({ visit: visit({ panelClinic: { name: 'AIA' } as never }) });
    expect(screen.getByText(/Panel · AIA/)).toBeInTheDocument();
    expect(screen.queryByText('CASH')).not.toBeInTheDocument();
  });

  it('12. autosave is shown only once something has been saved', () => {
    const { unmount } = renderHeader();
    expect(screen.queryByText(/Autosave/)).not.toBeInTheDocument();
    unmount();
    renderHeader({ autosaveLabel: '16:41' });
    expect(screen.getByText(/Autosave ✓ 16:41/)).toBeInTheDocument();
  });

  it('13. the presenting complaint is carried in the band', () => {
    renderHeader();
    expect(screen.getByText('Fever & productive cough ×3 days')).toBeInTheDocument();
  });
});

// ===========================================================================
// b1.5 PHASE D — THE IDENTITY STRIP OPENS THE PROFILE, AND SAYS WHAT IS ON FILE.
// ===========================================================================

describe('the identity strip is a way in, not just a label', () => {
  it('opens the profile when the patient is clicked', async () => {
    const onOpenProfile = vi.fn();
    renderHeader({ onOpenProfile });
    await userEvent.click(screen.getByRole('button', { name: /Open Aisyah Ujian's record/i }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });

  it('is a real button, so a keyboard reaches it', async () => {
    // A clickable div is invisible to half the clinic.
    const onOpenProfile = vi.fn();
    renderHeader({ onOpenProfile });
    const control = screen.getByRole('button', { name: /Open Aisyah Ujian's record/i });
    control.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpenProfile).toHaveBeenCalled();
  });

  it('states that there are no alerts rather than showing nothing', async () => {
    // An indicator that only appears when something is wrong leaves its
    // absence ambiguous between "nothing recorded" and "nobody looked".
    renderHeader({ onOpenProfile: vi.fn() });
    expect(await screen.findByRole('button', { name: /No active patient alerts/i })).toBeInTheDocument();
  });

  it('FIX 1 — the alert chip opens the ALERTS view, never the profile', async () => {
    // It used to open the whole profile, so a doctor checking why a patient
    // was flagged landed in an editable demographics form. Two intents, two
    // controls.
    const onOpenProfile = vi.fn();
    renderHeader({ onOpenProfile });
    await userEvent.click(await screen.findByRole('button', { name: /patient alert/i }));
    expect(await screen.findByTestId('patient-alerts')).toBeInTheDocument();
    expect(onOpenProfile).not.toHaveBeenCalled();
  });

  it('the alerts open UNDER THE CHIP, not in a centred modal', async () => {
    // The allergy chip beside it had already settled the shape — click, the
    // answer opens under it, click away and it is gone. Two adjacent chips in
    // one band behaving differently is the defect; dimming the consultation to
    // answer "what is this patient flagged for?" is the cost.
    renderHeader({ onOpenProfile: vi.fn() });
    await userEvent.click(await screen.findByRole('button', { name: /patient alert/i }));
    const view = await screen.findByTestId('patient-alerts-popover');
    expect(view).toBeInTheDocument();
    // Anchored, not masked: a popover has no dialog role and no backdrop.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.ant-modal-mask')).toBeNull();
  });

  it('FIX 2 — a labelled "Patient details" control opens the profile', async () => {
    // A control a doctor has to guess at is one half of them never find.
    const onOpenProfile = vi.fn();
    renderHeader({ onOpenProfile });
    await userEvent.click(screen.getByRole('button', { name: 'Patient details' }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
    // And it does NOT drag the alerts open with it.
    expect(screen.queryByTestId('patient-alerts-popover')).toBeNull();
  });

  it('is honestly disabled where the screen cannot offer it', () => {
    // No handler means no profile to open. The control says so by being
    // disabled rather than silently doing nothing when clicked.
    renderHeader({ onOpenProfile: undefined });
    expect(screen.getByRole('button', { name: /Open Aisyah Ujian's record/i })).toBeDisabled();
  });
});

// ===========================================================================
// b1.5 FIX 1 — NON-ALLERGY ALERTS ARE READABLE WITHOUT CLICKING.
//
// The chip said "1 alert" and a doctor had to open it to learn that meant DM.
// Information you have to click for is information you do not have
// mid-consult, which is the opposite of what an alert is for.
// ===========================================================================

describe('the alert chip shows what the alerts SAY', () => {
  it('renders the labels inline, not a count', async () => {
    get.mockImplementation(async (url: string) =>
      String(url).includes('/alerts') ? [alert('a1', 'MEDICAL', 'DM'), alert('a2', 'MEDICAL', 'HPT')] : [],
    );
    renderHeader({});

    expect(await screen.findByText(/DM/)).toBeInTheDocument();
    expect(screen.getByText(/HPT/)).toBeInTheDocument();
    // The thing it replaced.
    expect(screen.queryByText('2 alerts')).toBeNull();
  });

  it('collapses only the REMAINDER when there are many', async () => {
    get.mockImplementation(async (url: string) =>
      String(url).includes('/alerts')
        ? ['DM', 'HPT', 'OKU', 'Asthma', 'Deaf'].map((label, i) => alert(`a${i}`, 'MEDICAL', label))
        : [],
    );
    renderHeader({});

    // The first three are readable; only the tail becomes a number.
    expect(await screen.findByText(/DM, HPT, OKU/)).toBeInTheDocument();
    expect(screen.getByText(/\+2 more/)).toBeInTheDocument();
    // Never the whole set behind a count.
    expect(screen.queryByText('5 alerts')).toBeNull();
  });

  it('gives a screen reader the FULL list, including the collapsed tail', async () => {
    // The one user who cannot glance at the band should not be the one who has
    // to click.
    get.mockImplementation(async (url: string) =>
      String(url).includes('/alerts')
        ? ['DM', 'HPT', 'OKU', 'Asthma'].map((label, i) => alert(`a${i}`, 'MEDICAL', label))
        : [],
    );
    renderHeader({});

    expect(await screen.findByRole('button', { name: /Patient alerts: DM, HPT, OKU, Asthma/ })).toBeInTheDocument();
  });

  it('an ALLERGY alert stays out of this chip — it belongs to the red one', async () => {
    get.mockImplementation(async (url: string) =>
      String(url).includes('/alerts')
        ? [alert('a1', 'ALLERGY', 'AUGMENTIN'), alert('a2', 'MEDICAL', 'DM')]
        : [],
    );
    renderHeader({});

    const chip = await screen.findByRole('button', { name: /Patient alerts:/ });
    expect(chip.textContent).toContain('DM');
    expect(chip.textContent).not.toContain('AUGMENTIN');
  });

  it('still says so plainly when there are none', async () => {
    get.mockImplementation(async () => []);
    renderHeader({});
    expect(await screen.findByRole('button', { name: /No active patient alerts/ })).toBeInTheDocument();
  });
});
