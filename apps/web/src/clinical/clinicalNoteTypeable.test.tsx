// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicalNotesTab } from './ClinicalNotesTab';
import { useClinicalDraftStore } from './clinical-draft-store';

// ===========================================================================
// D1 — THE EDITOR MUST BE TYPEABLE.
//
// Reported from production: the editor rendered with its toolbar, accepted no
// input, and "Save Clinical Note" stayed disabled. The selector read
// "No notes yet".
//
// Root cause: the Canvas decided who may author a doctor's narrative from the
// ROLE ALONE, while the server decides it from the role OR a verified medical
// registration with signing enabled. A credentialed OWNER_ADMIN — the owner
// who is also the GP, which describes most single-doctor clinics here — was
// allowed by the server and refused by the browser. On a visit with no notes
// the refusal meant no implicit draft was opened, which made the editor
// read-only, which silently swallowed every keystroke.
//
// The fix is one source of truth: the server publishes the capability and the
// Canvas renders it. These tests hold both halves.
// ===========================================================================

const { get, post, patch, MockApiError } = vi.hoisted(() => {
  class MockApiError extends Error {}
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn(), MockApiError };
});
vi.mock('../core/api-client', () => ({
  ApiError: MockApiError,
  apiClient: { get, post, patch, delete: vi.fn() },
  downloadFile: vi.fn(),
  fetchBlobUrl: vi.fn(async () => 'blob:x'),
}));

/** The session under test — swapped per case. */
let sessionStaff: Record<string, unknown> = {};
vi.mock('../core/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ staff: sessionStaff, tenant: { id: 'tenant-1' } }),
}));

/** An UNCONTROLLED stand-in, so "did the keystroke land" is a real question. */
vi.mock('./RichTextEditor', () => ({
  RichTextEditor: ({
    content,
    onChange,
    editable,
  }: {
    content: string;
    onChange: (html: string) => void;
    editable?: boolean;
  }) => (
    <textarea
      aria-label="Clinical note"
      data-editable={editable ? 'true' : 'false'}
      readOnly={!editable}
      value={content}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const renderNotes = () =>
  render(
    <Harness>
      <ClinicalNotesTab visitId="visit-1" patientId="patient-1" />
    </Harness>,
  );

const editor = () => screen.getByLabelText('Clinical note') as HTMLTextAreaElement;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  useClinicalDraftStore.setState({ drafts: {} });
  // A visit with NO notes — the exact state that was reported.
  get.mockImplementation(async (url: string) =>
    String(url).includes('clinical-notes') ? [] : [],
  );
  post.mockResolvedValue({ id: 'note-1', version: 1, status: 'DRAFT', notes: '<p>x</p>' });
});

describe('a credentialed OWNER_ADMIN — the owner who is also the GP', () => {
  beforeEach(() => {
    sessionStaff = {
      id: 'owner-1',
      role: 'OWNER_ADMIN',
      clinicId: 'clinic-1',
      fullName: 'Nadia Owner',
      // What the server now publishes: it said yes.
      canAuthorNarrative: true,
    };
  });

  it('can type into the editor on a visit with no notes', async () => {
    renderNotes();
    const box = await screen.findByLabelText('Clinical note');
    expect(box).toHaveAttribute('data-editable', 'true');

    await userEvent.type(box, 'Fever x3 days, chest clear.');
    expect(editor().value).toContain('Fever x3 days');
  });

  it('no "create note" ceremony — the draft opens by itself', async () => {
    renderNotes();
    await screen.findByLabelText('Clinical note');
    // Nothing had to be pressed first.
    expect(editor()).toHaveAttribute('data-editable', 'true');
  });

  it('Save enables once there is content, and was disabled before', async () => {
    renderNotes();
    const box = await screen.findByLabelText('Clinical note');
    const save = screen.getByRole('button', { name: 'Save Clinical Note' });
    expect(save).toBeDisabled();

    await userEvent.type(box, 'URTI.');
    await waitFor(() => expect(save).toBeEnabled());
  });

  it('the typed draft survives a remount — it is not lost to a refetch', async () => {
    const { unmount } = renderNotes();
    await userEvent.type(await screen.findByLabelText('Clinical note'), 'Cough, no fever.');
    unmount();

    renderNotes();
    await waitFor(() => expect(editor().value).toContain('Cough, no fever.'));
  });

  it('no read-only explanation is shown, because it is not read-only', async () => {
    const { container } = renderNotes();
    await screen.findByLabelText('Clinical note');
    expect(container.querySelector('[data-readonly-reason="true"]')).toBeNull();
  });
});

describe('an ordinary doctor', () => {
  beforeEach(() => {
    sessionStaff = { id: 'dr-a', role: 'DOCTOR_RESIDENT', clinicId: 'clinic-1', fullName: 'Dr Amira' };
  });

  it('can still type when the session predates the capability field', async () => {
    // Absent means "fall back to the role", never "no". A session minted
    // before the server published the flag must not lock a doctor out.
    renderNotes();
    const box = await screen.findByLabelText('Clinical note');
    expect(box).toHaveAttribute('data-editable', 'true');
    await userEvent.type(box, 'Reviewed.');
    expect(editor().value).toContain('Reviewed.');
  });
});

describe('somebody who genuinely may not author a narrative', () => {
  beforeEach(() => {
    sessionStaff = {
      id: 'fd-1',
      role: 'FRONT_DESK_CLINICAL_STAFF',
      clinicId: 'clinic-1',
      fullName: 'Aminah Counter',
      canAuthorNarrative: false,
    };
  });

  it('is TOLD why, rather than typing into a box that discards it', async () => {
    // The defect was not only "read-only" — it was read-only and silent. A
    // paragraph typed and then discovered never to have existed is the worst
    // version of this.
    const { container } = renderNotes();
    await screen.findByLabelText('Clinical note');
    const reason = container.querySelector('[data-readonly-reason="true"]');
    expect(reason).not.toBeNull();
    expect(reason?.textContent).toMatch(/not permitted to write a doctor/i);
    expect(reason?.textContent).toMatch(/Add Staff Remark/i);
  });

  it('the editor refuses input, and says so before the first keystroke', async () => {
    renderNotes();
    const box = await screen.findByLabelText('Clinical note');
    expect(box).toHaveAttribute('data-editable', 'false');
  });
});
