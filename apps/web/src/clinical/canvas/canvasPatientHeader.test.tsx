// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CanvasPatientHeader, headerAllergyState } from '../CanvasPatientHeader';
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
    allergies: [],
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
const renderHeader = (over: Partial<Parameters<typeof CanvasPatientHeader>[0]> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CanvasPatientHeader
        patient={patient()}
        visit={visit()}
        onBookAppointment={vi.fn()}
        onCompleteConsultation={vi.fn()}
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
  it('5. a recorded allergy is stated in full and marked', () => {
    renderHeader({ patient: patient({ allergies: ['NSAIDs', 'Penicillin'] }) });
    expect(screen.getByText(/NSAIDs, Penicillin/)).toBeInTheDocument();
  });

  it('6. asked-and-none reads as a negative answer', () => {
    renderHeader({ patient: patient({ allergies: [] }) });
    expect(screen.getByText(/No known allergy/)).toBeInTheDocument();
  });

  it('7. NEVER ASKED is its own state, and says so', () => {
    // The failure this prevents: a new patient's blank allergy field reading
    // as "no known allergy" — a negative answer nobody gave.
    renderHeader({ patient: patient({ allergies: null as never }) });
    expect(screen.getByText(/Allergy not asked/)).toBeInTheDocument();
    expect(screen.queryByText(/No known allergy/)).not.toBeInTheDocument();
  });

  it('8. the three states are distinguishable as data, not only as pixels', () => {
    expect(headerAllergyState({ allergies: null as never })).toBe('NONE_RECORDED');
    expect(headerAllergyState({ allergies: [] })).toBe('NONE_KNOWN');
    expect(headerAllergyState({ allergies: ['NSAIDs'] })).toBe('PRESENT');
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
    await userEvent.click(screen.getByRole('button', { name: /Open Aisyah Ujian's profile/i }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });

  it('is a real button, so a keyboard reaches it', async () => {
    // A clickable div is invisible to half the clinic.
    const onOpenProfile = vi.fn();
    renderHeader({ onOpenProfile });
    const control = screen.getByRole('button', { name: /Open Aisyah Ujian's profile/i });
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

  it('the alert chip opens the same profile', async () => {
    const onOpenProfile = vi.fn();
    renderHeader({ onOpenProfile });
    await userEvent.click(await screen.findByRole('button', { name: /patient alert/i }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });

  it('is honestly disabled where the screen cannot offer it', () => {
    // No handler means no profile to open. The control says so by being
    // disabled rather than silently doing nothing when clicked.
    renderHeader({ onOpenProfile: undefined });
    expect(screen.getByRole('button', { name: /Open Aisyah Ujian's profile/i })).toBeDisabled();
  });
});
