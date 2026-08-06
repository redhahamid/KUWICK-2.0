// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { ClinicalNotesTab, FOCUS_MODE_CLASS } from './ClinicalNotesTab';
import { useClinicalDraftStore } from './clinical-draft-store';

// ===========================================================================
// G4.5d3c-3c — FOCUS MODE
//
// The requirement the owner stated explicitly: Focus Mode must not remount
// the editor or lose the draft. That is not a detail — C1 (D-052) and D-078
// both exist because unsaved clinical text has been lost to remounts before,
// and a mode that widens the note by rebuilding the layout would reintroduce
// exactly that.
//
// So these tests are mostly about what does NOT happen.
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

vi.mock('../core/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      staff: { id: 'dr-a', role: 'DOCTOR_RESIDENT', clinicId: 'clinic-1', fullName: 'Dr Amira' },
      tenant: { id: 'tenant-1' },
    }),
}));

/**
 * A stand-in for the rich-text editor that COUNTS ITS MOUNTS and holds its
 * text uncontrolled. If Focus Mode rebuilt the tree, this unmounts, the count
 * moves and the text disappears — which is precisely the failure being
 * defended against.
 */
let editorMounts = 0;
vi.mock('./RichTextEditor', async () => {
  const { useEffect } = await import('react');
  return {
    editorSurfaceClass: (fill: boolean, editable: boolean) =>
      !fill ? 'kw-editor-min' : editable ? 'kw-editor-fill' : 'kw-editor-signed',
    RichTextEditor: ({ onChange }: { onChange: (html: string) => void }) => {
      // MOUNTS, not renders. A re-render is fine and expected — the whole
      // point is that the component instance and its DOM node survive.
      useEffect(() => {
        editorMounts += 1;
      }, []);
      return (
        <div>
          <label htmlFor="rte">Clinical note body</label>
          <textarea id="rte" defaultValue="" onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    },
  };
});

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const renderNotes = () => {
  get.mockResolvedValue([]);
  return render(
    <Harness>
      <ClinicalNotesTab visitId="visit-1" patientId="patient-1" compact embedded />
    </Harness>,
  );
};

const editor = () => screen.getByLabelText('Clinical note body') as HTMLTextAreaElement;
const toggle = () => screen.getByRole('button', { name: /focus mode/i });

beforeEach(() => {
  editorMounts = 0;
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  message.destroy();
  document.body.classList.remove(FOCUS_MODE_CLASS);
  useClinicalDraftStore.setState({ drafts: {}, loadedNoteId: {} });
});

describe('entering and leaving Focus Mode', () => {
  it('1. the toggle exists on the note', async () => {
    renderNotes();
    expect(await screen.findByRole('button', { name: 'Focus Mode' })).toBeInTheDocument();
  });

  it('2. it drives a body class, which is what the layout reacts to', async () => {
    renderNotes();
    await userEvent.click(await screen.findByRole('button', { name: 'Focus Mode' }));
    expect(document.body.classList.contains(FOCUS_MODE_CLASS)).toBe(true);
  });

  it('3. leaving removes it again', async () => {
    renderNotes();
    await userEvent.click(await screen.findByRole('button', { name: 'Focus Mode' }));
    await userEvent.click(screen.getByRole('button', { name: 'Exit Focus Mode' }));
    expect(document.body.classList.contains(FOCUS_MODE_CLASS)).toBe(false);
  });

  it('4. it announces its state as a toggle, not a navigation', async () => {
    renderNotes();
    const button = await screen.findByRole('button', { name: 'Focus Mode' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: 'Exit Focus Mode' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('5. Escape leaves it — a mode with no keyboard exit is a trap', async () => {
    renderNotes();
    await userEvent.click(await screen.findByRole('button', { name: 'Focus Mode' }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.body.classList.contains(FOCUS_MODE_CLASS)).toBe(false));
  });

  it('6. Escape keeps its ordinary meaning when Focus Mode is off', async () => {
    renderNotes();
    await screen.findByRole('button', { name: 'Focus Mode' });
    await userEvent.keyboard('{Escape}');
    expect(document.body.classList.contains(FOCUS_MODE_CLASS)).toBe(false);
  });

  it('7. unmounting the Canvas leaves no class behind', async () => {
    const { unmount } = renderNotes();
    await userEvent.click(await screen.findByRole('button', { name: 'Focus Mode' }));
    unmount();
    expect(document.body.classList.contains(FOCUS_MODE_CLASS)).toBe(false);
  });
});

describe('Focus Mode never costs a keystroke', () => {
  it('8. the editor is not remounted when entering', async () => {
    renderNotes();
    await screen.findByRole('button', { name: 'Focus Mode' });
    const before = editorMounts;
    await userEvent.click(toggle());
    expect(editorMounts).toBe(before);
  });

  it('9. the editor is not remounted when leaving', async () => {
    renderNotes();
    await userEvent.click(await screen.findByRole('button', { name: 'Focus Mode' }));
    const before = editorMounts;
    await userEvent.click(screen.getByRole('button', { name: 'Exit Focus Mode' }));
    expect(editorMounts).toBe(before);
  });

  it('10. unsaved text survives entering Focus Mode', async () => {
    renderNotes();
    await screen.findByRole('button', { name: 'Focus Mode' });
    await userEvent.type(editor(), 'Patient reports chest pain since Tuesday.');
    await userEvent.click(toggle());
    expect(editor().value).toBe('Patient reports chest pain since Tuesday.');
  });

  it('11. unsaved text survives leaving Focus Mode', async () => {
    renderNotes();
    await screen.findByRole('button', { name: 'Focus Mode' });
    await userEvent.type(editor(), 'On examination: chest clear.');
    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole('button', { name: 'Exit Focus Mode' }));
    expect(editor().value).toBe('On examination: chest clear.');
  });

  it('12. the draft store still holds the text after a round trip', async () => {
    renderNotes();
    await screen.findByRole('button', { name: 'Focus Mode' });
    await userEvent.type(editor(), 'Plan: review in one week.');
    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole('button', { name: 'Exit Focus Mode' }));

    const drafts = Object.values(useClinicalDraftStore.getState().drafts);
    expect(drafts.some((draft) => draft.content.includes('Plan: review in one week.'))).toBe(true);
  });

  it('13. toggling saves nothing and signs nothing', async () => {
    renderNotes();
    await screen.findByRole('button', { name: 'Focus Mode' });
    await userEvent.type(editor(), 'Draft only.');
    await userEvent.click(toggle());
    await userEvent.click(screen.getByRole('button', { name: 'Exit Focus Mode' }));
    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('14. repeated toggling still never remounts', async () => {
    renderNotes();
    await screen.findByRole('button', { name: 'Focus Mode' });
    await userEvent.type(editor(), 'Long note in progress');
    const before = editorMounts;
    for (let i = 0; i < 4; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: /focus mode/i }));
    }
    expect(editorMounts).toBe(before);
    expect(editor().value).toBe('Long note in progress');
  });
});
