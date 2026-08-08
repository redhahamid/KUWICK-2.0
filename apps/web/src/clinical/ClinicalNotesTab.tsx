import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Dropdown,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  AudioOutlined,
  CompressOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  ExpandOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  useAmendClinicalNote,
  useClinicalNotes,
  useCreateClinicalNote,
  useSignClinicalNote,
  useUpdateClinicalNote,
} from './hooks/useClinicalNote';
import { autosaveLabel, useAutosave } from './hooks/useAutosave';
import { useBeforeUnloadGuard } from './hooks/useUnsavedGuard';
import { RichTextEditor } from './RichTextEditor';
import { VisitAttachmentsPanel } from './VisitAttachmentsPanel';
import { VisitObservationsPanel } from './VisitObservationsPanel';
import { useAuthStore } from '../core/auth-store';
import {
  DraftState,
  SaveStatus,
  describeSaveStatus,
  draftKey,
  isDraftDirty,
  shouldRefreshBaseline,
  shouldSyncFromServer,
  useClinicalDraftStore,
} from './clinical-draft-store';
import { ClinicalNote, ClinicalNoteType, NoteLanguage } from './types';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

// A hardcoded starter set, not a per-tenant configurable dictionary — no
// admin screen manages this (Clinical 2a plan, judgment call #4).
const SMART_ABBREVIATIONS: Record<string, string> = {
  SOB: 'Shortness of breath',
  'N/V': 'Nausea and vomiting',
  URTI: 'Upper respiratory tract infection',
  HTN: 'Hypertension',
  DM: 'Diabetes mellitus',
  Fx: 'Fracture',
  Hx: 'History of presenting complaint',
  Tx: 'Treatment',
  Dx: 'Diagnosis',
  'c/o': 'Complains of',
};

// TypeScript's bundled DOM lib doesn't ship SpeechRecognition types (still
// vendor-prefixed/experimental) — minimal shape declared here rather than
// pulling in a types package for one browser API (D-025).
interface SpeechRecognitionResultLike {
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

// Mirrors the server rule in clinical-authorization.ts. This only hides the
// editor for clarity; the server is the actual control and returns 403.
const DOCTOR_ROLES = ['DOCTOR_RESIDENT', 'DOCTOR_LOCUM'];

function noteLabel(note: ClinicalNote): string {
  const when = dayjs(note.createdAt).format('D MMM YYYY, HH:mm');
  if (note.legacyAuthorUnknown) {
    return `${when} · Author not recorded — legacy note · Read-only`;
  }
  const who = note.authorNameSnapshot ?? 'Unknown';
  const amendment = note.entryType === 'AMENDMENT' ? ' · Amendment' : '';
  const state =
    note.status === 'SIGNED'
      ? ` · Signed by ${note.signerNameSnapshot ?? '—'}`
      : note.noteType === 'STAFF_REMARK'
        ? ' · Staff remark'
        : ' · Draft';
  return `${when} · ${who}${amendment}${state}`;
}

// A signed or legacy note is read-only, so it must never own an editable
// draft — otherwise selecting one could carry the previous note's text in.
function isReadOnlyNote(note: ClinicalNote | undefined): boolean {
  return Boolean(note && (note.status === 'SIGNED' || note.legacyAuthorUnknown));
}

/** The body class Focus Mode drives. Exported so a test can assert on it. */
export const FOCUS_MODE_CLASS = 'kw-note-focus';

/**
 * G4.5d3c-3c — Focus Mode, implemented as a class on <body> and nothing else.
 *
 * The obvious implementation — render a different, wider layout when focus is
 * on — is the wrong one, and dangerously so. Swapping the tree around the
 * editor unmounts `RichTextEditor`, which destroys the TipTap instance: the
 * doctor's cursor position and undo history go with it, and any draft state
 * held below this component in the tree goes too. C1 (D-052) and D-078 both
 * exist because unsaved clinical text has been lost to remounts before.
 *
 * A class on <body> changes only what CSS does with the boxes that are
 * already there. React re-renders nothing structural, TipTap is never told
 * anything happened, and entering or leaving Focus Mode mid-sentence cannot
 * cost a character.
 *
 * The cleanup removes the class on unmount as well as on toggle — leaving
 * Canvas while focused must not leave the rest of the application with its
 * rail hidden.
 */
function useFocusMode(active: boolean): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const { body } = document;
    if (active) {
      body.classList.add(FOCUS_MODE_CLASS);
    } else {
      body.classList.remove(FOCUS_MODE_CLASS);
    }
    return () => body.classList.remove(FOCUS_MODE_CLASS);
  }, [active]);
}

interface ClinicalNotesTabProps {
  visitId: string;
  patientId: string;
  compact?: boolean;
  /**
   * D-077 — true when the Canvas already shows vitals and attachments in its
   * own compact strips above this component, so they must not be rendered a
   * second time. Flow leaves it false and keeps the full panels.
   */
  embedded?: boolean;
}

// C0 (D-051) — narrative entry with real authorship.
// C1 (D-052) — unsaved-text safety around it.
export function ClinicalNotesTab({ visitId, patientId, compact, embedded }: ClinicalNotesTabProps) {
  const { data: notes, isLoading } = useClinicalNotes(visitId);
  const createNote = useCreateClinicalNote(visitId);
  const updateNote = useUpdateClinicalNote(visitId);
  const signNote = useSignClinicalNote(visitId);
  const amendNote = useAmendClinicalNote(visitId);
  const staff = useAuthStore((state) => state.staff);
  const tenant = useAuthStore((state) => state.tenant);

  const [listening, setListening] = useState(false);
  // C1 — the ACTIVE note is explicit and only ever changes because the user
  // asked. It is never re-derived from notes[0], so a newer note arriving
  // from another session cannot steal the selection mid-consultation.
  const [selectedNoteId, setSelectedNoteId] = useState<string>();
  const [isNewDraft, setIsNewDraft] = useState(false);
  const [amendOpen, setAmendOpen] = useState(false);
  const [amendReason, setAmendReason] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [conflictOpen, setConflictOpen] = useState(false);
  const initialisedFor = useRef<string | undefined>(undefined);
  // G4.5d3c-3c — Focus Mode. Local state driving a BODY CLASS, deliberately:
  // see the note beside `useFocusMode` for why this must never become a
  // conditional render.
  const [focusMode, setFocusMode] = useState(false);
  useFocusMode(focusMode);

  // Subscribed to the whole store: this component reads drafts, loadedNoteId
  // and every action, and the store only changes while this editor is in use.
  const draftStore = useClinicalDraftStore((state) => state);
  const canWriteNarrative = Boolean(staff && DOCTOR_ROLES.includes(staff.role));

  const scope = useMemo(
    () => ({
      tenantId: tenant?.id ?? 'unknown-tenant',
      clinicId: staff?.clinicId ?? null,
      patientId,
      visitId,
      noteId: isNewDraft ? undefined : selectedNoteId,
    }),
    [tenant?.id, staff?.clinicId, patientId, visitId, isNewDraft, selectedNoteId],
  );
  const key = draftKey(scope);
  const draft = draftStore.drafts[key];
  const dirty = isDraftDirty(draft);

  const activeNote = useMemo(
    () => (isNewDraft ? undefined : notes?.find((n) => n.id === selectedNoteId)),
    [isNewDraft, notes, selectedNoteId],
  );

  // Pick an initial note ONCE per visit. After this the selection is the
  // user's; refetches never move it.
  useEffect(() => {
    // Wait for the session before deciding: canWriteNarrative below depends
    // on it, and initialising early would latch the wrong answer for good.
    if (!notes || !staff || initialisedFor.current === visitId) {
      return;
    }
    initialisedFor.current = visitId;
    if (notes.length > 0) {
      setSelectedNoteId(notes[0].id);
      return;
    }
    // G0a — a visit with no notes used to render an editor bound to nothing:
    // the doctor faced an empty selector reading "No notes yet" and had to
    // find "Add Note" before they could type. Open ONE local draft instead,
    // so the first consultation of a visit starts by typing.
    //
    // This creates NO database row. The row, and its authorship, are still
    // created only on first successful save (C0 rule, unchanged). content
    // and baseline are both '' so the draft starts clean — this must never
    // raise a false "unsaved changes" prompt.
    //
    // Only for staff who may write the narrative. FRONT_DESK_CLINICAL_STAFF
    // must not be handed the doctor's editor (C0); they still use "Add Staff
    // Remark" deliberately.
    if (!canWriteNarrative) {
      return;
    }
    setIsNewDraft(true);
    setSelectedNoteId(undefined);

    // D-078 — SEED, never overwrite.
    //
    // This effect runs once per mount, and `initialisedFor` is a ref, so a
    // REMOUNT re-runs it. Switching Canvas <-> Flow remounts this component,
    // and on a visit with no saved notes the blank seed below was landing on
    // top of a draft the doctor had already typed: `syncFromServer` replaces
    // `drafts[key]` unconditionally. Measured before the guard: 61 characters
    // of unsaved clinical text became 0 on a single view switch.
    //
    // The store is keyed by draftKey and survives the remount by design, so
    // if a draft already exists for this key it IS the doctor's work and must
    // be left exactly as it is.
    const blankKey = draftKey({ ...scope, noteId: undefined });
    if (draftStore.drafts[blankKey]) {
      return;
    }
    draftStore.syncFromServer(blankKey, undefined, {
      content: '',
      language: 'EN',
      noteType: 'DOCTOR_NARRATIVE',
      baseline: '',
      baselineVersion: null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, visitId, staff, canWriteNarrative]);

  // Load server content into the editor — but only when it is safe.
  useEffect(() => {
    if (isNewDraft || !activeNote) {
      return;
    }
    const loaded = draftStore.loadedNoteId[key];
    const serverContent = activeNote.notes ?? '';

    if (shouldSyncFromServer({ incomingNoteId: activeNote.id, loadedNoteId: loaded, isDirty: dirty })) {
      const next: DraftState = {
        content: serverContent,
        language: activeNote.noteLanguage,
        noteType: activeNote.noteType,
        baseline: serverContent,
        baselineVersion: activeNote.version,
      };
      draftStore.syncFromServer(key, activeNote.id, next);
      return;
    }
    // Same note, nothing local at risk: adopt a colleague's newer text.
    if (
      draft &&
      shouldRefreshBaseline({
        incomingNoteId: activeNote.id,
        loadedNoteId: loaded,
        isDirty: dirty,
        serverContent,
        baseline: draft.baseline,
      })
    ) {
      draftStore.refreshBaseline(key, serverContent, activeNote.version);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote?.id, activeNote?.version, activeNote?.notes, key, isNewDraft, dirty]);

  // Reflect dirtiness in the status line without clobbering a terminal state
  // the user still needs to see (failure/conflict stay until resolved).
  useEffect(() => {
    setSaveStatus((current) => {
      if (current.kind === 'saving' || current.kind === 'error' || current.kind === 'conflict') {
        return current;
      }
      if (dirty) {
        return { kind: 'dirty' };
      }
      return current.kind === 'saved' ? current : { kind: 'idle' };
    });
  }, [dirty]);

  useBeforeUnloadGuard(dirty);

  // Escape leaves Focus Mode. A mode with no keyboard exit is a trap for
  // anyone not using a mouse, and the toggle button is the only other way
  // out. Bound only WHILE focused, so Escape keeps its normal meaning
  // (closing a modal, clearing a select) the rest of the time.
  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocusMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusMode]);

  const content = draft?.content ?? '';
  const language: NoteLanguage = draft?.language ?? 'EN';
  const draftType: ClinicalNoteType = draft?.noteType ?? 'DOCTOR_NARRATIVE';

  const isSigned = activeNote?.status === 'SIGNED';
  const isLegacy = Boolean(activeNote?.legacyAuthorUnknown);
  const isLocked = isSigned || isLegacy;
  const readOnly = isLocked || (!canWriteNarrative && draftType === 'DOCTOR_NARRATIVE' && !isNewDraft);

  // G4.5d6 — the note writes itself after the doctor stops typing. `handleSave`
  // is reused rather than duplicated so autosave and the manual button cannot
  // drift into two different save semantics.
  const autosave = useAutosave({
    value: content,
    dirty,
    enabled: !readOnly,
    onSave: async () => {
      await handleSaveRef.current();
    },
  });

  // One shared confirmation path for every action that would replace what is
  // in the editor, so two dialogs can never stack on one click.
  const confirmDiscard = useCallback(
    (what: string, proceed: () => void) => {
      if (!dirty) {
        proceed();
        return;
      }
      Modal.confirm({
        title: 'You have unsaved changes',
        icon: <ExclamationCircleOutlined />,
        content: `Your unsaved clinical text will be lost if you ${what} now. Save it first, or discard it deliberately.`,
        okText: 'Discard changes',
        okButtonProps: { danger: true },
        cancelText: 'Continue editing',
        onOk: () => {
          // Scoped to THIS draft only. Another note, visit or patient may
          // also have unsaved work open, and the user agreed to abandon
          // exactly one of them.
          draftStore.discard(key);
          proceed();
        },
      });
    },
    [dirty, draftStore, key],
  );

  const selectNote = (noteId: string) => {
    confirmDiscard('switch notes', () => {
      setIsNewDraft(false);
      setSelectedNoteId(noteId);
      setSaveStatus({ kind: 'idle' });
    });
  };

  // "Add Note" opens ONE local draft — no empty row is inserted in the
  // database. The row and its authorship are created on first save.
  const startNewDraft = (noteType: ClinicalNoteType) => {
    confirmDiscard('start a new note', () => {
      setIsNewDraft(true);
      setSelectedNoteId(undefined);
      setSaveStatus({ kind: 'idle' });
      const newKey = draftKey({ ...scope, noteId: undefined });
      draftStore.syncFromServer(newKey, undefined, {
        content: '',
        language: 'EN',
        noteType,
        baseline: '',
        baselineVersion: null,
      });
    });
  };

  // Held in a ref so the autosave timer always calls the CURRENT closure and
  // never a stale one holding last minute's note text.
  const handleSaveRef = useRef<() => Promise<void>>(async () => {});

  const handleSave = async () => {
    setSaveStatus({ kind: 'saving' });
    const attempted = content;
    try {
      if (activeNote && !isNewDraft) {
        // expectedVersion comes from the DRAFT's baseline, not the live
        // query. After a 409 the query may refetch to the colleague's newer
        // version; using that would make a second Save succeed and silently
        // overwrite their change. Pinning it to the version this draft was
        // actually built from keeps re-saving a stale edit impossible until
        // the doctor deliberately reloads.
        const expectedVersion = draft?.baselineVersion ?? activeNote.version;
        const saved = await updateNote.mutateAsync({
          id: activeNote.id,
          dto: { notes: attempted, noteLanguage: language, expectedVersion },
        });
        draftStore.markSaved(key, attempted, saved.version);
      } else {
        const created = await createNote.mutateAsync({
          notes: attempted,
          noteLanguage: language,
          noteType: draftType,
        });
        // Move the working copy onto the real note id so the editor keeps its
        // text and the next save targets the right record.
        draftStore.promoteNewDraft(key, draftKey({ ...scope, noteId: created.id }), created.id, attempted, created.version);
        setIsNewDraft(false);
        setSelectedNoteId(created.id);
      }
      setSaveStatus({ kind: 'saved', at: dayjs().format('HH:mm') });
    } catch (error) {
      // Nothing is discarded and no baseline moves — the text stays exactly
      // as typed and the draft stays dirty.
      if (error instanceof ApiError && error.status === 409) {
        setSaveStatus({ kind: 'conflict', message: error.message });
        setConflictOpen(true);
        return;
      }
      setSaveStatus({ kind: 'error', message: error instanceof ApiError ? error.message : 'Failed to save' });
      message.error(error instanceof ApiError ? error.message : 'Failed to save clinical note');
    }
  };

  handleSaveRef.current = handleSave;

  /**
   * G4.5d6 — the ONE place a signature is still pressed by hand.
   *
   * A consultation note is finalized by completing the visit. An amendment is
   * usually written after that has already happened, so nothing downstream
   * will ever lock it — and an amendment that stays an editable draft forever
   * is exactly the mutable clinical record the original signing rules exist
   * to prevent. Correcting a closed record is a deliberate act, not routine
   * documentation, so it keeps a deliberate confirmation.
   */
  const handleFinalizeAmendment = async () => {
    if (!activeNote) return;
    if (dirty) {
      message.warning('Save your correction before finalizing it.');
      return;
    }
    try {
      await signNote.mutateAsync({ id: activeNote.id, dto: { expectedVersion: activeNote.version } });
      message.success('Amendment finalized — it can no longer be edited');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to finalize amendment');
    }
  };

  const handleAmend = async () => {
    if (!activeNote) return;
    try {
      const created = await amendNote.mutateAsync({
        id: activeNote.id,
        dto: { amendmentReason: amendReason, notes: '', noteLanguage: language },
      });
      setAmendOpen(false);
      setAmendReason('');
      setIsNewDraft(false);
      setSelectedNoteId(created.id);
      message.success('Amendment created — the original note is unchanged');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create amendment');
    }
  };

  // Reload the server's version, deliberately discarding the local text after
  // the doctor has had the chance to copy it out of the conflict dialog.
  const reloadServerVersion = () => {
    draftStore.discard(key);
    setConflictOpen(false);
    setSaveStatus({ kind: 'idle' });
  };

  const toggleDictation = () => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      message.warning('Dictation is not supported in this browser');
      return;
    }
    if (listening) {
      setListening(false);
      return;
    }
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(' ');
      draftStore.setContent(key, content ? `${content}<p>${transcript}</p>` : `<p>${transcript}</p>`);
    };
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
  };

  const insertAbbreviation = (expansion: string) => {
    draftStore.setContent(key, content ? `${content}<p>${expansion}</p>` : `<p>${expansion}</p>`);
  };

  const status = describeSaveStatus(saveStatus);
  const statusColor =
    status.tone === 'warning' ? '#d46b08' : status.tone === 'error' ? '#cf1322' : status.tone === 'success' ? '#389e0d' : undefined;

  return (
    // G0a — a plain column. The editor's height is set explicitly in CSS
    // (.kw-editor-fill), NOT taken from whatever space the lower sections
    // happen to leave over: under C2 every diagnosis or medication added
    // subtracted directly from the doctor's typing area.
    <div style={compact ? { display: 'flex', flexDirection: 'column', gap: 4 } : undefined}>
      {/* D-077 — the Canvas renders its own compact vitals and image strips
          ABOVE the note, so rendering these here as well printed every vital
          twice on one screen and gave an empty attachments box a large
          placeholder. They stay for the Flow layout, which has no strips. */}
      {!embedded && (
        <>
          <VisitObservationsPanel visitId={visitId} compact={compact} />
          <VisitAttachmentsPanel visitId={visitId} compact={compact} />
        </>
      )}

      <Space wrap style={{ marginBottom: compact ? 6 : 8, width: '100%' }}>
        <Select
          size="small"
          // G2b — was minWidth: 340, which is wider than the 329px content
          // area at 375px and pushed the whole page into a horizontal scroll.
          // maxWidth lets it shrink on a phone and keeps the note label
          // readable everywhere else.
          style={{ width: '100%', maxWidth: 340 }}
          placeholder="No notes yet"
          value={isNewDraft ? '__draft__' : selectedNoteId}
          loading={isLoading}
          onChange={(value) => {
            if (value === '__draft__') return;
            selectNote(value);
          }}
          options={[
            ...(isNewDraft ? [{ value: '__draft__', label: 'New draft (unsaved)' }] : []),
            ...(notes ?? []).map((n) => ({ value: n.id, label: noteLabel(n) })),
          ]}
        />
        {canWriteNarrative && (
          <Button size="small" icon={<PlusOutlined />} onClick={() => startNewDraft('DOCTOR_NARRATIVE')}>
            Add Note
          </Button>
        )}
        <Button size="small" icon={<EditOutlined />} onClick={() => startNewDraft('STAFF_REMARK')}>
          Add Staff Remark
        </Button>
      </Space>

      {activeNote && (
        <div style={{ marginBottom: 6 }}>
          <Space wrap size={6}>
            {activeNote.noteType === 'STAFF_REMARK' && <Tag>Staff remark</Tag>}
            {activeNote.entryType === 'AMENDMENT' && <Tag color="blue">Amendment</Tag>}
            {activeNote.status === 'SIGNED' ? (
              <Tag color="green" icon={<SafetyCertificateOutlined />}>
                Signed
              </Tag>
            ) : (
              <Tag color="gold">Draft</Tag>
            )}
            {activeNote.hasAmendment && <Tag color="purple">Amended</Tag>}
            {activeNote.legacyAuthorUnknown ? (
              <>
                <Tag>Read-only</Tag>
                <Text type="secondary" italic style={{ fontSize: 12 }}>
                  Author not recorded — legacy note
                </Text>
              </>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Entered by <Text strong style={{ fontSize: 12 }}>{activeNote.authorNameSnapshot}</Text>
                {activeNote.authorRoleSnapshot
                  ? ` (${activeNote.authorRoleSnapshot.replace(/_/g, ' ').toLowerCase()})`
                  : ''}{' '}
                · {dayjs(activeNote.createdAt).format('D MMM YYYY, HH:mm')}
              </Text>
            )}
            {activeNote.status === 'SIGNED' && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                · Electronically signed by{' '}
                <Text strong style={{ fontSize: 12 }}>{activeNote.signerNameSnapshot}</Text>{' '}
                {dayjs(activeNote.signedAt!).format('D MMM YYYY, HH:mm')}
              </Text>
            )}
            {activeNote.isLateEntry && (
              <Tooltip title={activeNote.lateEntryReason ?? undefined}>
                <Tag color="orange">Late entry</Tag>
              </Tooltip>
            )}
          </Space>
          {activeNote.entryType === 'AMENDMENT' && activeNote.amendmentReason && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Reason: {activeNote.amendmentReason}
              </Text>
            </div>
          )}
        </div>
      )}

      {isSigned && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 6 }}
          message="This note is signed and cannot be edited."
          description="Corrections must be recorded as an amendment, which is kept as a separate linked entry."
        />
      )}
      {isLegacy && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 6 }}
          message="Legacy note — read-only"
          description="This entry predates authorship tracking, so its author cannot be verified and its content is preserved unchanged. To correct it, add an amendment: that is recorded against you, with a reason, date and time."
        />
      )}
      {saveStatus.kind === 'conflict' && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 6 }}
          message="Conflict — this note changed on the server"
          description="Your text has been kept exactly as you typed it and is still unsaved. Review it before deciding."
          action={
            <Button size="small" onClick={() => setConflictOpen(true)}>
              Review my text
            </Button>
          }
        />
      )}

      <Card
        size="small"
        title={draftType === 'STAFF_REMARK' ? 'Staff Remark' : 'Clinical Notes'}
        styles={
          compact
            ? {
                header: { padding: '4px 12px', minHeight: 28 },
                body: { padding: 8 },
              }
            : undefined
        }
        extra={
          // G2b — `wrap` plus the mobile rule in index.css: this toolbar is
          // 384px unwrapped, wider than a 329px phone content area, and was
          // the last thing forcing the record to scroll sideways at 375px.
          <Space wrap>
            <Select
              size="small"
              value={language}
              onChange={(value) => draftStore.setLanguage(key, value)}
              disabled={readOnly}
              style={{ width: 130 }}
              options={[
                { label: 'ENGLISH', value: 'EN' },
                { label: 'BAHASA MELAYU', value: 'MS' },
              ]}
            />
            <Button
              size="small"
              icon={<AudioOutlined />}
              type={listening ? 'primary' : 'default'}
              disabled={readOnly}
              onClick={toggleDictation}
            >
              {listening ? 'Stop' : 'Dictate'}
            </Button>
            <Dropdown
              disabled={readOnly}
              menu={{
                items: Object.entries(SMART_ABBREVIATIONS).map(([code, expansion]) => ({
                  key: code,
                  label: `${code} — ${expansion}`,
                  onClick: () => insertAbbreviation(expansion),
                })),
              }}
            >
              <Button size="small" type="primary" icon={<ThunderboltOutlined />} disabled={readOnly}>
                Smart Abbreviation
              </Button>
            </Dropdown>
            {/* G4.5d3c-3c — Focus Mode. Available on a signed note too:
                reading a long note benefits from the width exactly as much as
                writing one does, and this control changes no clinical state.
                `aria-pressed` because it is a toggle, not a navigation. */}
            <Button
              size="small"
              className="kw-focus-exit"
              // antd icons carry their own aria-label ("expand"/"compress"),
              // which would otherwise prefix the button's accessible name and
              // have a screen reader announce "expand Focus Mode".
              icon={focusMode ? <CompressOutlined aria-hidden /> : <ExpandOutlined aria-hidden />}
              aria-label={focusMode ? 'Exit Focus Mode' : 'Focus Mode'}
              aria-pressed={focusMode}
              onClick={() => setFocusMode((previous) => !previous)}
            >
              {focusMode ? 'Exit Focus Mode' : 'Focus Mode'}
            </Button>
          </Space>
        }
      >
        <RichTextEditor
          content={content}
          onChange={(html) => {
            // A read-only note must never produce a dirty draft.
            if (readOnly) return;
            draftStore.setContent(key, html);
          }}
          compact={compact}
          fill={compact}
          // G0a — a signed or legacy note must not merely refuse to save an
          // edit, it must not accept keystrokes at all.
          editable={!readOnly}
        />
      </Card>

      <Space style={{ marginTop: compact ? 8 : 16 }} wrap>
        <Button
          type="primary"
          loading={updateNote.isPending || createNote.isPending}
          onClick={handleSave}
          disabled={readOnly || !dirty}
        >
          Save Clinical Note
        </Button>
        {/* Subtle by design: the doctor needs reassurance, not a banner. */}
        {autosaveLabel(autosave.status) && (
          <Text
            type={autosave.status.state === 'FAILED' ? 'danger' : 'secondary'}
            style={{ fontSize: 12 }}
            role="status"
            data-autosave-state={autosave.status.state}
          >
            {autosaveLabel(autosave.status)}
            {autosave.status.state === 'FAILED' && (
              <Button type="link" size="small" onClick={() => void autosave.retry()}>
                Retry
              </Button>
            )}
          </Text>
        )}
        {/* G4.5d6 — no manual Sign on a consultation note. It autosaves while
            the visit is open and is finalized automatically, immutably and
            with full attribution when the visit is completed. The button this
            replaced was pressed in end-of-session batches from memory, or
            held a paid-up patient at the counter while somebody fetched a
            doctor. An AMENDMENT is the exception: it is normally written
            after the visit has already closed, so nothing downstream would
            ever lock it. */}
        {activeNote && !isLocked && activeNote.entryType === 'AMENDMENT' && (
          <Button
            icon={<SafetyCertificateOutlined />}
            loading={signNote.isPending}
            onClick={handleFinalizeAmendment}
          >
            Finalize Amendment
          </Button>
        )}
        {isLocked && (
          <Button icon={<EditOutlined />} onClick={() => confirmDiscard('start an amendment', () => setAmendOpen(true))}>
            Add Amendment
          </Button>
        )}
        {status.label && (
          <Text strong style={{ fontSize: 12, color: statusColor }}>
            {status.label}
          </Text>
        )}
        {activeNote && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            v{activeNote.version}
          </Text>
        )}
      </Space>

      <Modal
        title="Add Amendment"
        open={amendOpen}
        onCancel={() => setAmendOpen(false)}
        onOk={handleAmend}
        okText="Create Amendment"
        okButtonProps={{ disabled: !amendReason.trim() }}
        confirmLoading={amendNote.isPending}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="The original note stays unchanged."
          description="This creates a new entry linked to it — recorded against you, with your name, the reason and the time."
        />
        <Input.TextArea
          rows={3}
          value={amendReason}
          onChange={(e) => setAmendReason(e.target.value)}
          placeholder="Reason for the amendment (required) — e.g. BP transcribed incorrectly"
        />
      </Modal>

      {/* C1 — the doctor's text is never thrown away by a conflict. It is
          shown in full and copyable; reloading the server version is an
          explicit, deliberate act. */}
      <Modal
        title="Conflict — your unsaved text"
        open={conflictOpen}
        onCancel={() => setConflictOpen(false)}
        width={760}
        footer={[
          <Button key="copy" onClick={() => void navigator.clipboard?.writeText(stripHtml(content))}>
            Copy my text
          </Button>,
          <Button key="keep" type="primary" onClick={() => setConflictOpen(false)}>
            Keep editing my version
          </Button>,
          <Button key="reload" danger onClick={reloadServerVersion}>
            Discard mine, reload server version
          </Button>,
        ]}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="This note was changed by someone else while you were editing."
          description="Nothing has been overwritten — not your text, and not theirs. Copy anything you need before reloading."
        />
        <Input.TextArea readOnly value={stripHtml(content)} rows={12} />
      </Modal>
    </div>
  );
}

// Rich-text HTML is never auto-merged (C0/C1 rule). For review and copying,
// a plain-text rendering is what a doctor can actually re-use.
function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
