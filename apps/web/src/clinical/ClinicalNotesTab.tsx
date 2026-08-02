import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Dropdown,
  Input,
  Modal,
  Segmented,
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
import { RichTextEditor } from './RichTextEditor';
import { VisitAttachmentsPanel } from './VisitAttachmentsPanel';
import { VisitObservationsPanel } from './VisitObservationsPanel';
import { useAuthStore } from '../core/auth-store';
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
// pulling in a types package for one browser API (D-025: browser Web Speech
// API only, no paid dependency).
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

// Which roles may write a doctor's narrative. Mirrors the server rule in
// clinical-authorization.ts — this only hides the editor for clarity; the
// server is the actual control and returns 403 regardless.
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

interface ClinicalNotesTabProps {
  visitId: string;
  // Canvas layout needs the whole record visible without page scroll —
  // compact shrinks paddings and the editor's minimum height.
  compact?: boolean;
}

// C0 (D-051) — the narrative entry surface.
//
// Vitals are NO LONGER part of this form: they live in
// VisitObservationsPanel with their own recorder attribution, so a staff
// member taking a BP can never become the author of the doctor's narrative.
export function ClinicalNotesTab({ visitId, compact }: ClinicalNotesTabProps) {
  const { data: notes, isLoading } = useClinicalNotes(visitId);
  const createNote = useCreateClinicalNote(visitId);
  const updateNote = useUpdateClinicalNote(visitId);
  const signNote = useSignClinicalNote(visitId);
  const amendNote = useAmendClinicalNote(visitId);
  const staff = useAuthStore((state) => state.staff);

  const [language, setLanguage] = useState<NoteLanguage>('EN');
  const [listening, setListening] = useState(false);
  const [notesHtml, setNotesHtml] = useState('');
  const [activeNoteId, setActiveNoteId] = useState<string>();
  const [draftType, setDraftType] = useState<ClinicalNoteType>('DOCTOR_NARRATIVE');
  const [isNewDraft, setIsNewDraft] = useState(false);
  const [amendOpen, setAmendOpen] = useState(false);
  const [amendReason, setAmendReason] = useState('');

  const canWriteNarrative = Boolean(staff && DOCTOR_ROLES.includes(staff.role));

  const activeNote = useMemo(
    () => (isNewDraft ? undefined : (notes?.find((n) => n.id === activeNoteId) ?? notes?.[0])),
    [isNewDraft, notes, activeNoteId],
  );

  // Sync the editor from the selected note. Keyed on the note ID (not the
  // object) so a background refetch can't wipe what's being typed.
  useEffect(() => {
    if (isNewDraft) {
      return;
    }
    if (activeNote) {
      setLanguage(activeNote.noteLanguage);
      setNotesHtml(activeNote.notes ?? '');
      setDraftType(activeNote.noteType);
    } else {
      setLanguage('EN');
      setNotesHtml('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNote?.id, isNewDraft]);

  const isSigned = activeNote?.status === 'SIGNED';
  // A legacy note has no recorded author, so editing it would attribute
  // someone else's historical text to whoever is logged in now. Permanently
  // read-only; corrections go through an attributed amendment.
  const isLegacy = Boolean(activeNote?.legacyAuthorUnknown);
  const isLocked = isSigned || isLegacy;
  const readOnly = isLocked || (!canWriteNarrative && draftType === 'DOCTOR_NARRATIVE' && !isNewDraft);

  // "Add Note" opens a LOCAL draft — no empty row is inserted in the
  // database. The row (and its authorship) is created on first save.
  const startNewDraft = (noteType: ClinicalNoteType) => {
    setIsNewDraft(true);
    setActiveNoteId(undefined);
    setDraftType(noteType);
    setNotesHtml('');
    setLanguage('EN');
  };

  const handleSave = async () => {
    try {
      if (activeNote && !isNewDraft) {
        await updateNote.mutateAsync({
          id: activeNote.id,
          dto: { notes: notesHtml, noteLanguage: language, expectedVersion: activeNote.version },
        });
      } else {
        const created = await createNote.mutateAsync({
          notes: notesHtml,
          noteLanguage: language,
          noteType: draftType,
        });
        setActiveNoteId(created.id);
        setIsNewDraft(false);
      }
      message.success('Clinical note saved');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to save clinical note');
    }
  };

  const handleSign = async () => {
    if (!activeNote) return;
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
        dto: { amendmentReason: amendReason, notes: notesHtml, noteLanguage: language },
      });
      setActiveNoteId(created.id);
      setAmendOpen(false);
      setAmendReason('');
      message.success('Amendment created — the original signed note is unchanged');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create amendment');
    }
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
    // No .lang set — lets the browser's speech engine auto-detect rather
    // than locking to whatever the Notes language toggle happens to be.
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(' ');
      setNotesHtml((current) => (current ? `${current}<p>${transcript}</p>` : `<p>${transcript}</p>`));
    };
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
  };

  const insertAbbreviation = (expansion: string) => {
    setNotesHtml((current) => (current ? `${current}<p>${expansion}</p>` : `<p>${expansion}</p>`));
  };

  return (
    <>
      <VisitObservationsPanel visitId={visitId} compact={compact} />
      <VisitAttachmentsPanel visitId={visitId} compact={compact} />

      {/* Note history: a single selector rather than an unbounded row of
          timestamp buttons, showing who wrote each entry and its state. */}
      <Space wrap style={{ marginBottom: compact ? 6 : 8, width: '100%' }}>
        <Select
          size="small"
          style={{ minWidth: 340 }}
          placeholder="No notes yet"
          value={isNewDraft ? '__draft__' : activeNote?.id}
          loading={isLoading}
          onChange={(value) => {
            if (value === '__draft__') return;
            setIsNewDraft(false);
            setActiveNoteId(value);
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
        {/* Every clinical user can document a remark — this is how a
            non-doctor records "patient refused medication". It can never be
            signed and never renders as a doctor's note. */}
        <Button size="small" icon={<EditOutlined />} onClick={() => startNewDraft('STAFF_REMARK')}>
          Add Staff Remark
        </Button>
      </Space>

      {/* Provenance for the selected entry — the medicolegal record. */}
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
      {!canWriteNarrative && draftType === 'DOCTOR_NARRATIVE' && !activeNote && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 6 }}
          message="Only a doctor may write the clinical narrative."
          description="You can record vitals, upload attachments, and add a staff remark."
        />
      )}

      <Card
        size="small"
        title={draftType === 'STAFF_REMARK' ? 'Staff Remark' : 'Clinical Notes'}
        styles={compact ? { header: { padding: '4px 12px', minHeight: 28 }, body: { padding: 8 } } : undefined}
        extra={
          <Space>
            {isNewDraft && draftType === 'STAFF_REMARK' && (
              <Segmented
                size="small"
                value={draftType}
                options={[{ label: 'Staff Remark', value: 'STAFF_REMARK' }]}
              />
            )}
            <Select
              size="small"
              value={language}
              onChange={setLanguage}
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
        <RichTextEditor content={notesHtml} onChange={setNotesHtml} compact={compact} />
      </Card>

      <Space style={{ marginTop: compact ? 8 : 16 }} wrap>
        <Button
          type="primary"
          loading={updateNote.isPending || createNote.isPending}
          onClick={handleSave}
          disabled={readOnly}
        >
          Save Clinical Note
        </Button>
        {activeNote && !isLocked && activeNote.noteType === 'DOCTOR_NARRATIVE' && (
          <Button
            icon={<SafetyCertificateOutlined />}
            loading={signNote.isPending}
            onClick={handleSign}
          >
            Sign
          </Button>
        )}
        {/* Both signed and legacy notes are locked, so both are corrected the
            same way — via an attributed amendment. */}
        {isLocked && (
          <Button icon={<EditOutlined />} onClick={() => setAmendOpen(true)}>
            Add Amendment
          </Button>
        )}
        {activeNote && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            v{activeNote.version} · last saved {dayjs(activeNote.updatedAt).format('HH:mm')}
          </Text>
        )}
      </Space>

      <Modal
        title="Add Amendment"
        open={amendOpen}
        onCancel={() => setAmendOpen(false)}
        onOk={handleAmend}
        okText="Create Amendment"
        confirmLoading={amendNote.isPending}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="The original note stays unchanged."
          description="This creates a new entry linked to it — recorded against you, with your name, the reason and the time — shown chronologically in the record."
        />
        <Input.TextArea
          rows={3}
          value={amendReason}
          onChange={(e) => setAmendReason(e.target.value)}
          placeholder="Reason for the amendment (required) — e.g. BP transcribed incorrectly"
        />
      </Modal>
    </>
  );
}
