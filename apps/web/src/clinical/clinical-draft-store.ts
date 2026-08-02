import { create } from 'zustand';
import { ClinicalNoteType, NoteLanguage } from './types';

// C1 (D-052) — unsaved clinical-note safety.
//
// MEMORY ONLY. This store deliberately uses NO zustand `persist` middleware
// and touches no localStorage, sessionStorage, IndexedDB or cookie. Clinical
// drafts contain patient information and are often typed on shared clinic
// machines; leaving them in browser storage would outlive the session and the
// user. A browser refresh therefore loses an unsaved draft — after the
// beforeunload warning — which is the accepted C1 trade-off. Crash/offline
// recovery needs a separately designed secure solution.
//
// The working copy lives here rather than in ClinicalNotesTab's local state
// because a doctor's typed text must not depend on a component staying
// mounted: switching Canvas ⇄ Flow remounts the tab, and switching notes
// would otherwise discard whatever was in progress.

export const NEW_DRAFT_ID = 'new';

export interface DraftScope {
  tenantId: string;
  clinicId: string | null;
  patientId: string;
  visitId: string;
  // Undefined = the local "Add Note" draft that has no server row yet.
  noteId: string | undefined;
}

// Every level of context is in the key. Two patients, two visits, two
// branches or two tenants can never collide, so a draft can never surface
// under the wrong record — the failure mode that would matter most here.
export function draftKey(scope: DraftScope): string {
  return [
    scope.tenantId,
    scope.clinicId ?? '-',
    scope.patientId,
    scope.visitId,
    scope.noteId ?? NEW_DRAFT_ID,
  ].join('::');
}

export interface DraftState {
  // What the doctor currently sees in the editor.
  content: string;
  language: NoteLanguage;
  noteType: ClinicalNoteType;
  // The last content confirmed to be on the server — either freshly loaded
  // or freshly saved. Dirtiness is derived from this rather than a separate
  // boolean, so a failed save cannot accidentally clear it.
  baseline: string;
  // Version the baseline came from, for C0 optimistic concurrency.
  baselineVersion: number | null;
}

export function isDraftDirty(draft: DraftState | undefined): boolean {
  if (!draft) {
    return false;
  }
  return draft.content !== draft.baseline;
}

// The core rule C1 exists to enforce.
//
// The editor may be replaced from the server ONLY when the note being shown
// genuinely changed and nothing is at risk. A refetch that returns the same
// note — window focus, background invalidation, a poll, a newly created note
// arriving at the top of the list — must never replace what is being typed.
export function shouldSyncFromServer(params: {
  incomingNoteId: string | undefined;
  loadedNoteId: string | undefined;
  isDirty: boolean;
}): boolean {
  const { incomingNoteId, loadedNoteId, isDirty } = params;
  if (incomingNoteId === loadedNoteId) {
    // Same note → a refetch, not a navigation. Refreshing the baseline while
    // clean is handled separately; the editor content is never touched here.
    return false;
  }
  return !isDirty;
}

// Same note, clean draft: it is safe to adopt newer server content (e.g. a
// colleague's correction landed) because nothing local is lost.
export function shouldRefreshBaseline(params: {
  incomingNoteId: string | undefined;
  loadedNoteId: string | undefined;
  isDirty: boolean;
  serverContent: string;
  baseline: string;
}): boolean {
  return (
    params.incomingNoteId === params.loadedNoteId &&
    !params.isDirty &&
    params.serverContent !== params.baseline
  );
}

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; message: string };

// Never report "Saved" while a request is in flight or after it failed — a
// doctor reading "Saved" for text that never reached the server is the worst
// lie this screen can tell.
export function describeSaveStatus(status: SaveStatus): {
  label: string;
  tone: 'default' | 'warning' | 'success' | 'error';
} {
  switch (status.kind) {
    case 'saving':
      return { label: 'Saving…', tone: 'default' };
    case 'saved':
      return { label: `Saved at ${status.at}`, tone: 'success' };
    case 'dirty':
      return { label: 'Unsaved changes', tone: 'warning' };
    case 'error':
      return { label: 'Save failed', tone: 'error' };
    case 'conflict':
      return { label: 'Conflict detected', tone: 'error' };
    default:
      return { label: '', tone: 'default' };
  }
}

interface ClinicalDraftState {
  drafts: Record<string, DraftState>;
  // Which server note each key was last synchronised from, so a refetch of
  // the same note is distinguishable from a genuine note change.
  loadedNoteId: Record<string, string | undefined>;

  setContent: (key: string, content: string) => void;
  setLanguage: (key: string, language: NoteLanguage) => void;
  setNoteType: (key: string, noteType: ClinicalNoteType) => void;
  syncFromServer: (key: string, noteId: string | undefined, draft: DraftState) => void;
  refreshBaseline: (key: string, content: string, version: number | null) => void;
  markSaved: (key: string, savedContent: string, version: number | null) => void;
  discard: (key: string) => void;
  promoteNewDraft: (fromKey: string, toKey: string, noteId: string, savedContent: string, version: number | null) => void;
  // Wipe everything — logout, auth loss, or a tenant/branch switch. Drafts
  // must never survive a change of who is looking at the screen.
  clearAll: () => void;
}

const blankDraft = (): DraftState => ({
  content: '',
  language: 'EN',
  noteType: 'DOCTOR_NARRATIVE',
  baseline: '',
  baselineVersion: null,
});

export const useClinicalDraftStore = create<ClinicalDraftState>()((set) => ({
  drafts: {},
  loadedNoteId: {},

  setContent: (key, content) =>
    set((state) => {
      const existing = state.drafts[key] ?? blankDraft();
      return { drafts: { ...state.drafts, [key]: { ...existing, content } } };
    }),

  setLanguage: (key, language) =>
    set((state) => {
      const existing = state.drafts[key] ?? blankDraft();
      return { drafts: { ...state.drafts, [key]: { ...existing, language } } };
    }),

  setNoteType: (key, noteType) =>
    set((state) => {
      const existing = state.drafts[key] ?? blankDraft();
      return { drafts: { ...state.drafts, [key]: { ...existing, noteType } } };
    }),

  syncFromServer: (key, noteId, draft) =>
    set((state) => ({
      drafts: { ...state.drafts, [key]: draft },
      loadedNoteId: { ...state.loadedNoteId, [key]: noteId },
    })),

  refreshBaseline: (key, content, version) =>
    set((state) => {
      const existing = state.drafts[key];
      if (!existing) {
        return state;
      }
      // Only reached when the draft is clean, so moving content and baseline
      // together cannot discard an edit.
      return {
        drafts: { ...state.drafts, [key]: { ...existing, content, baseline: content, baselineVersion: version } },
      };
    }),

  markSaved: (key, savedContent, version) =>
    set((state) => {
      const existing = state.drafts[key];
      if (!existing) {
        return state;
      }
      // Baseline moves to what the server confirmed. The working content is
      // left alone: if the doctor kept typing during the request, those newer
      // keystrokes stay and the draft correctly remains dirty.
      return {
        drafts: { ...state.drafts, [key]: { ...existing, baseline: savedContent, baselineVersion: version } },
      };
    }),

  discard: (key) =>
    set((state) => {
      const drafts = { ...state.drafts };
      const loaded = { ...state.loadedNoteId };
      delete drafts[key];
      delete loaded[key];
      return { drafts, loadedNoteId: loaded };
    }),

  // First successful save of a local "Add Note" draft: the working copy moves
  // from the `new` key onto the real note id, so the editor keeps its text
  // and the next save targets the right record.
  promoteNewDraft: (fromKey, toKey, noteId, savedContent, version) =>
    set((state) => {
      const draft = state.drafts[fromKey] ?? blankDraft();
      const drafts = { ...state.drafts, [toKey]: { ...draft, baseline: savedContent, baselineVersion: version } };
      delete drafts[fromKey];
      const loaded = { ...state.loadedNoteId, [toKey]: noteId };
      delete loaded[fromKey];
      return { drafts, loadedNoteId: loaded };
    }),

  clearAll: () => set({ drafts: {}, loadedNoteId: {} }),
}));

export function hasUnsavedDrafts(drafts: Record<string, DraftState>): boolean {
  return Object.values(drafts).some((draft) => isDraftDirty(draft));
}

// Keys belonging to a different patient/visit than the one given — used to
// prove isolation in tests and to scope "do you have unsaved work here?".
export function draftKeysForVisit(drafts: Record<string, DraftState>, visitId: string): string[] {
  return Object.keys(drafts).filter((key) => key.split('::')[3] === visitId);
}
