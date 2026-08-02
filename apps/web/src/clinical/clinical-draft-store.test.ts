import { describe, expect, it, beforeEach } from 'vitest';
import {
  DraftState,
  NEW_DRAFT_ID,
  describeSaveStatus,
  draftKey,
  draftKeysForVisit,
  hasUnsavedDrafts,
  isDraftDirty,
  shouldRefreshBaseline,
  shouldSyncFromServer,
  useClinicalDraftStore,
} from './clinical-draft-store';

// C1 (D-052). These tests encode the loss paths confirmed in the C0 code —
// they are the regression net for "a doctor's typed text disappeared".

const scope = {
  tenantId: 'tenant-1',
  clinicId: 'clinic-1',
  patientId: 'patient-1',
  visitId: 'visit-1',
  noteId: 'note-1' as string | undefined,
};

const draft = (over: Partial<DraftState> = {}): DraftState => ({
  content: 'text',
  language: 'EN',
  noteType: 'DOCTOR_NARRATIVE',
  baseline: 'text',
  baselineVersion: 1,
  ...over,
});

beforeEach(() => {
  useClinicalDraftStore.getState().clearAll();
});

describe('draft keying and isolation', () => {
  it('never collides across patients, visits, branches or tenants', () => {
    const base = draftKey(scope);
    expect(base).not.toBe(draftKey({ ...scope, patientId: 'patient-2' }));
    expect(base).not.toBe(draftKey({ ...scope, visitId: 'visit-2' }));
    expect(base).not.toBe(draftKey({ ...scope, clinicId: 'clinic-2' }));
    expect(base).not.toBe(draftKey({ ...scope, tenantId: 'tenant-2' }));
    expect(base).not.toBe(draftKey({ ...scope, noteId: 'note-2' }));
  });

  it('gives the local Add Note draft its own key per visit', () => {
    const newDraft = draftKey({ ...scope, noteId: undefined });
    expect(newDraft.endsWith(`::${NEW_DRAFT_ID}`)).toBe(true);
    expect(newDraft).not.toBe(draftKey({ ...scope, visitId: 'visit-2', noteId: undefined }));
  });

  it("does not surface one patient's draft under another", () => {
    const store = useClinicalDraftStore.getState();
    const a = draftKey(scope);
    const b = draftKey({ ...scope, patientId: 'patient-2', visitId: 'visit-2' });
    store.setContent(a, 'Patient A private text');

    expect(useClinicalDraftStore.getState().drafts[b]).toBeUndefined();
    expect(draftKeysForVisit(useClinicalDraftStore.getState().drafts, 'visit-2')).toHaveLength(0);
  });
});

describe('dirty state', () => {
  it('is dirty only when content differs from the confirmed baseline', () => {
    expect(isDraftDirty(draft({ content: 'a', baseline: 'a' }))).toBe(false);
    expect(isDraftDirty(draft({ content: 'a ', baseline: 'a' }))).toBe(true);
    expect(isDraftDirty(undefined)).toBe(false);
  });

  it('stays dirty when a save fails, because the baseline never moved', () => {
    const store = useClinicalDraftStore.getState();
    const key = draftKey(scope);
    store.syncFromServer(key, 'note-1', draft({ content: 'saved', baseline: 'saved' }));
    store.setContent(key, 'saved + unsaved edit');
    // A failed save must NOT call markSaved…
    expect(isDraftDirty(useClinicalDraftStore.getState().drafts[key])).toBe(true);
    // …and the text is untouched.
    expect(useClinicalDraftStore.getState().drafts[key].content).toBe('saved + unsaved edit');
  });

  it('clears dirty only after a confirmed save', () => {
    const store = useClinicalDraftStore.getState();
    const key = draftKey(scope);
    store.syncFromServer(key, 'note-1', draft({ content: 'a', baseline: 'a' }));
    store.setContent(key, 'a+b');
    expect(isDraftDirty(useClinicalDraftStore.getState().drafts[key])).toBe(true);

    store.markSaved(key, 'a+b', 2);
    expect(isDraftDirty(useClinicalDraftStore.getState().drafts[key])).toBe(false);
    expect(useClinicalDraftStore.getState().drafts[key].baselineVersion).toBe(2);
  });

  it('keeps typing made during an in-flight save, leaving the draft dirty', () => {
    const store = useClinicalDraftStore.getState();
    const key = draftKey(scope);
    store.syncFromServer(key, 'note-1', draft({ content: 'a', baseline: 'a' }));
    store.setContent(key, 'a+b'); // what was sent
    store.setContent(key, 'a+b+c'); // typed while the request was in flight
    store.markSaved(key, 'a+b', 2); // server confirmed only 'a+b'

    const after = useClinicalDraftStore.getState().drafts[key];
    expect(after.content).toBe('a+b+c');
    expect(after.baseline).toBe('a+b');
    expect(isDraftDirty(after)).toBe(true);
  });
});

describe('server synchronisation — the confirmed loss paths', () => {
  it('does NOT overwrite the editor on a same-note refetch while dirty', () => {
    expect(shouldSyncFromServer({ incomingNoteId: 'note-1', loadedNoteId: 'note-1', isDirty: true })).toBe(false);
  });

  it('does NOT overwrite the editor on a same-note refetch while clean either', () => {
    // Content is refreshed through refreshBaseline, never by replacing the
    // editor wholesale, so a clean refetch is still not a "sync".
    expect(shouldSyncFromServer({ incomingNoteId: 'note-1', loadedNoteId: 'note-1', isDirty: false })).toBe(false);
  });

  it('adopts a genuinely different note when the draft is clean', () => {
    expect(shouldSyncFromServer({ incomingNoteId: 'note-2', loadedNoteId: 'note-1', isDirty: false })).toBe(true);
  });

  it('refuses to adopt a different note while dirty — the guard must run first', () => {
    expect(shouldSyncFromServer({ incomingNoteId: 'note-2', loadedNoteId: 'note-1', isDirty: true })).toBe(false);
  });

  it('refreshes the baseline for a clean same-note refetch when the server text changed', () => {
    expect(
      shouldRefreshBaseline({
        incomingNoteId: 'note-1',
        loadedNoteId: 'note-1',
        isDirty: false,
        serverContent: 'updated by a colleague',
        baseline: 'original',
      }),
    ).toBe(true);
  });

  it('never refreshes the baseline while dirty', () => {
    expect(
      shouldRefreshBaseline({
        incomingNoteId: 'note-1',
        loadedNoteId: 'note-1',
        isDirty: true,
        serverContent: 'updated by a colleague',
        baseline: 'original',
      }),
    ).toBe(false);
  });
});

describe('local Add Note draft', () => {
  it('promotes to the server note id on first save without losing the text', () => {
    const store = useClinicalDraftStore.getState();
    const fromKey = draftKey({ ...scope, noteId: undefined });
    const toKey = draftKey({ ...scope, noteId: 'note-new' });

    store.setContent(fromKey, '<p>Freshly typed</p>');
    store.promoteNewDraft(fromKey, toKey, 'note-new', '<p>Freshly typed</p>', 1);

    const state = useClinicalDraftStore.getState();
    expect(state.drafts[fromKey]).toBeUndefined();
    expect(state.drafts[toKey].content).toBe('<p>Freshly typed</p>');
    expect(isDraftDirty(state.drafts[toKey])).toBe(false);
    expect(state.loadedNoteId[toKey]).toBe('note-new');
  });

  it('reuses the single local draft rather than stacking blank ones', () => {
    const store = useClinicalDraftStore.getState();
    const key = draftKey({ ...scope, noteId: undefined });
    store.setContent(key, '');
    store.setContent(key, '');
    expect(Object.keys(useClinicalDraftStore.getState().drafts)).toEqual([key]);
  });
});

describe('save status never lies', () => {
  it('does not show Saved while saving or after a failure', () => {
    expect(describeSaveStatus({ kind: 'saving' }).label).toBe('Saving…');
    expect(describeSaveStatus({ kind: 'error', message: 'x' }).label).toBe('Save failed');
    expect(describeSaveStatus({ kind: 'conflict', message: 'x' }).label).toBe('Conflict detected');
    expect(describeSaveStatus({ kind: 'dirty' }).label).toBe('Unsaved changes');
    expect(describeSaveStatus({ kind: 'saved', at: '10:42' }).label).toBe('Saved at 10:42');
  });
});

describe('clearing', () => {
  it('wipes every draft on logout / tenant switch', () => {
    const store = useClinicalDraftStore.getState();
    store.setContent(draftKey(scope), 'a');
    store.setContent(draftKey({ ...scope, tenantId: 'tenant-2' }), 'b');
    expect(Object.keys(useClinicalDraftStore.getState().drafts)).toHaveLength(2);

    store.clearAll();
    expect(useClinicalDraftStore.getState().drafts).toEqual({});
    expect(useClinicalDraftStore.getState().loadedNoteId).toEqual({});
  });

  it('reports unsaved work across all open drafts', () => {
    const store = useClinicalDraftStore.getState();
    const key = draftKey(scope);
    store.syncFromServer(key, 'note-1', draft({ content: 'a', baseline: 'a' }));
    expect(hasUnsavedDrafts(useClinicalDraftStore.getState().drafts)).toBe(false);
    store.setContent(key, 'a+edit');
    expect(hasUnsavedDrafts(useClinicalDraftStore.getState().drafts)).toBe(true);
  });
});

// The store must never put patient text into browser storage: clinic machines
// are shared, and persisted drafts would outlive the session and the user.
describe('memory-only storage', () => {
  it('writes nothing to localStorage or sessionStorage', () => {
    const store = useClinicalDraftStore.getState();
    store.setContent(draftKey(scope), 'Sensitive patient narrative');
    store.markSaved(draftKey(scope), 'Sensitive patient narrative', 1);

    const dumps = [
      typeof localStorage !== 'undefined' ? JSON.stringify(localStorage) : '',
      typeof sessionStorage !== 'undefined' ? JSON.stringify(sessionStorage) : '',
    ].join('');
    expect(dumps).not.toContain('Sensitive patient narrative');
    expect(dumps).not.toContain('clinical-draft');
  });
});
