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
  EditOutlined,
  ExclamationCircleOutlined,
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

interface ClinicalNotesTabProps {
  visitId: string;
  patientId: string;
  compact?: boolean;
}

// C0 (D-051) — narrative entry with real authorship.
// C1 (D-052) — unsaved-text safety around it.
export function ClinicalNotesTab({ visitId, patientId, compact }: ClinicalNotesTabProps) {
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
    if (!notes || initialisedFor.current === visitId) {
      return;
    }
    initialisedFor.current = visitId;
    if (notes.length > 0) {
      setSelectedNoteId(notes[0].id);
    }
  }, [notes, visitId]);

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

  const content = draft?.content ?? '';
  const language: NoteLanguage = draft?.language ?? 'EN';
  const draftType: ClinicalNoteType = draft?.noteType ?? 'DOCTOR_NARRATIVE';

  const isSigned = activeNote?.status === 'SIGNED';
  const isLegacy = Boolean(activeNote?.legacyAuthorUnknown);
  const isLocked = isSigned || isLegacy;
  const readOnly = isLocked || (!canWriteNarrative && draftType === 'DOCTOR_NARRATIVE' && !isNewDraft);

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

  const handleSave = async () => {
    setSaveStatus({ kind: 'saving' });
    const attempted = content;
    try {
      if (activeNote && !isNewDraft) {
        const saved = await updateNote.mutateAsync({
          id: activeNote.id,
          dto: { notes: attempted, noteLanguage: language, expectedVersion: activeNote.version },
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

  const handleSign = async () => {
    if (!activeNote) return;
    if (dirty) {
      message.warning('Save your changes before signing.');
      return;
    }
    try {
      await signNote.mutateAsync({ id: activeNote.id, dto: { expectedVersion: activeNote.version } });
      message.success('Note signed');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to sign note');
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
    <>
      <VisitObservationsPanel visitId={visitId} compact={compact} />
      <VisitAttachmentsPanel visitId={visitId} compact={compact} />

      <Space wrap style={{ marginBottom: compact ? 6 : 8, width: '100%' }}>
        <Select
          size="small"
          style={{ minWidth: 340 }}
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
        styles={compact ? { header: { padding: '4px 12px', minHeight: 28 }, body: { padding: 8 } } : undefined}
        extra={
          <Space>
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
        {activeNote && !isLocked && activeNote.noteType === 'DOCTOR_NARRATIVE' && (
          <Button icon={<SafetyCertificateOutlined />} loading={signNote.isPending} onClick={handleSign}>
            Sign
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
    </>
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
