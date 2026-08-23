import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Input,
  InputNumber,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { Link } from 'react-router-dom';
import { permissionHint, useCan } from '../../core/hooks/useCan';
import { useClinics } from '../../core/hooks/useClinics';
import { ApiError, apiClient } from '../../core/api-client';
import { useBookingPage, useSaveReminderRules } from '../hooks/useBookingPage';
import {
  MessageTemplateRow,
  TEMPLATE_KEY_WORDS,
  messageContextFor,
  renderAppointmentMessage,
  templateBody,
  useMessageTemplates,
} from '../messages/appointmentMessages';

const { Text, Paragraph } = Typography;

const REMINDER_CHOICES = [
  { value: 2880, label: '2 days before' },
  { value: 1440, label: '1 day before' },
  { value: 240, label: '4 hours before' },
  { value: 120, label: '2 hours before' },
  { value: 60, label: '1 hour before' },
];

function offsetLabel(minutes: number): string {
  const preset = REMINDER_CHOICES.find((choice) => choice.value === minutes);
  if (preset) return preset.label;
  if (minutes % 1440 === 0) return `${minutes / 1440} days before`;
  if (minutes % 60 === 0) return `${minutes / 60} hours before`;
  return `${minutes} minutes before`;
}

/**
 * THE CONSOLE'S OWN NAVIGATION (approved mockup 6).
 *
 * The mockup draws a dark sub-navigation down the left of the Communication
 * Centre: Overview, Templates, Reminders with the message types nested under
 * it, and a Broadcast entry marked "Soon". Every entry below points at
 * something that ALREADY EXISTS in the one message store — the nested items
 * are the real template keys, "Reminders" is the real reminder-rule set. No
 * second configuration store was created to satisfy a picture: selecting
 * "Confirmation" simply preselects BOOKING_CONFIRMATION in the same editor,
 * writing through the same endpoint, as the Select above it always did.
 *
 * Two entries are deliberately honest rather than decorative:
 *   No-show   — the message store has no NO_SHOW template. The entry says
 *               so and offers the nearest real thing, instead of opening an
 *               editor that would write to nothing.
 *   Broadcast — "Soon" in the mockup, and disabled here, because no
 *               broadcast capability exists.
 */
/** One honest line per moment: when this wording is used, in the desk's words. */
const TEMPLATE_HINTS: Record<string, string> = {
  BOOKING_CONFIRMATION: 'Offered right after a booking is made.',
  BOOKING_REQUEST_RECEIVED: 'Offered when a patient asks for a slot the clinic must approve.',
  BOOKING_APPROVED: 'Offered when the clinic accepts a request.',
  REMINDER: 'Put on the Reminder Centre worklist by the timing rules below.',
  RESCHEDULE_REQUEST_RECEIVED: 'Offered when a patient asks to move an appointment.',
  RESCHEDULE_APPROVED: 'Offered when the clinic agrees to move it.',
  RESCHEDULE_DECLINED: 'Offered when the clinic cannot move it.',
  CANCELLATION_REQUEST_RECEIVED: 'Offered when a patient asks to cancel.',
  CANCELLATION_CONFIRMED: 'Offered once the cancellation is recorded.',
};

const NAV_TEMPLATES: { key: string; label: string; templateKey?: string }[] = [
  { key: 'tpl:BOOKING_CONFIRMATION', label: 'Confirmation', templateKey: 'BOOKING_CONFIRMATION' },
  { key: 'tpl:REMINDER', label: 'Reminder', templateKey: 'REMINDER' },
  { key: 'tpl:RESCHEDULE_APPROVED', label: 'Reschedule', templateKey: 'RESCHEDULE_APPROVED' },
  { key: 'tpl:CANCELLATION_CONFIRMED', label: 'Cancellation', templateKey: 'CANCELLATION_CONFIRMED' },
  { key: 'no-show', label: 'No-show' },
];

/**
 * THE COMMUNICATION CENTRE — one component, two doors.
 *
 * Final-UAT: "keep everything inside the Appointment module; avoid
 * unnecessary page switching". The full templates + reminder-rules editor
 * now renders INSIDE Appointments → Booking Page → Communication, and the
 * Clinic Settings page renders this SAME component — one store, one editor,
 * however it is reached. Everything stays honest about the transport:
 * no WhatsApp API is connected, so templates feed the modal a person sends
 * from, and reminder rules build a worklist a person works through.
 */
export function CommunicationCentre({ clinicId }: { clinicId?: string }) {
  const canConfigure = useCan('appointment.configure');
  const { data: clinics } = useClinics();
  const clinic = clinics?.find((row) => row.id === clinicId);
  const { data: templatesDoc, isLoading } = useMessageTemplates(clinicId);
  const { data: bookingPage } = useBookingPage(clinicId);
  const queryClient = useQueryClient();

  // Which room of the console is open. 'templates' is the front door, so the
  // editor is on screen the moment the page opens.
  const [section, setSection] = useState<string>('templates');
  // Template | Preview, the mockup's own pair: the stored wording, or the
  // message as the patient will read it.
  const [pane, setPane] = useState<'preview' | 'template'>('preview');

  // ---- template editor state ----------------------------------------------
  const [templateKey, setTemplateKey] = useState('BOOKING_CONFIRMATION');
  const [language, setLanguage] = useState('en');
  const [body, setBody] = useState('');
  const [seededFor, setSeededFor] = useState('');

  const current: MessageTemplateRow | undefined = templatesDoc?.templates.find(
    (row) => row.templateKey === templateKey && row.language === language,
  );

  // Re-seed the editor whenever the pair (or clinic) changes — but never
  // mid-edit on a background refetch.
  useEffect(() => {
    const key = `${clinicId}:${templateKey}:${language}`;
    if (!templatesDoc || seededFor === key) return;
    setSeededFor(key);
    setBody(templateBody(templatesDoc, templateKey, language));
  }, [templatesDoc, clinicId, templateKey, language, seededFor]);

  const saveTemplate = useMutation({
    mutationFn: (payload: { body: string | null }) =>
      apiClient.put<MessageTemplateRow>('/appointment-message-templates', {
        clinicId,
        templateKey,
        language,
        body: payload.body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointment-message-templates'] });
    },
  });

  const save = async (nextBody: string | null) => {
    try {
      const saved = await saveTemplate.mutateAsync({ body: nextBody });
      setBody(saved.body);
      message.success(
        nextBody === null ? 'Back to the built-in wording.' : 'Template saved for this clinic.',
      );
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not save the template.');
    }
  };

  // The preview renders through the ONE renderer, against this clinic's real
  // identity — so a missing phone or a switched-off booking page shows up
  // here exactly as it will in a real message: the line disappears.
  const preview = useMemo(() => {
    if (!clinic) return '';
    // 02:30Z = a 10:30 morning slot in the clinic's own clock (KL) — the
    // sample must read like a real appointment whatever the BROWSER's zone.
    const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    inAWeek.setUTCHours(2, 30, 0, 0);
    return renderAppointmentMessage(
      body,
      messageContextFor({
        appointment: {
          id: 'a1b2c3d4-sample',
          scheduledStart: inAWeek,
          manageToken: clinic.bookingSlug ? 'sample-token' : null,
          patient: { name: 'Aisyah binti Rahman' },
          staff: { fullName: 'Dr Aina' },
          service: { name: 'GP Consultation' },
        },
        clinic,
      }),
    );
  }, [body, clinic]);

  const openSection = (key: string) => {
    setSection(key);
    const entry = NAV_TEMPLATES.find((row) => row.key === key);
    // A nested entry is a shortcut INTO the editor, not a second editor.
    if (entry?.templateKey) setTemplateKey(entry.templateKey);
  };

  const showEditor = section === 'templates' || section.startsWith('tpl:');
  const customisedCount = (templatesDoc?.templates ?? []).filter((row) => row.isCustom).length;

  const insertPlaceholder = (token: string) => {
    setBody((previous) => `${previous}${previous.endsWith(' ') || previous === '' ? '' : ' '}{${token}}`);
  };

  // ---- reminder rules -----------------------------------------------------
  const [offsets, setOffsets] = useState<number[]>([]);
  const [customValue, setCustomValue] = useState<number | null>(null);
  const [customUnit, setCustomUnit] = useState<'minutes' | 'hours' | 'days'>('hours');
  const [rulesSeededFor, setRulesSeededFor] = useState<string>();
  const saveReminders = useSaveReminderRules();

  useEffect(() => {
    if (!bookingPage || !clinicId || rulesSeededFor === clinicId) return;
    setRulesSeededFor(clinicId);
    setOffsets(bookingPage.reminderRules.map((rule) => rule.offsetMinutes));
  }, [bookingPage, clinicId, rulesSeededFor]);

  const addCustom = () => {
    if (!customValue || customValue <= 0) return;
    const minutes =
      customUnit === 'days'
        ? customValue * 1440
        : customUnit === 'hours'
          ? customValue * 60
          : customValue;
    setOffsets((previous) => (previous.includes(minutes) ? previous : [...previous, minutes]));
    setCustomValue(null);
  };

  const saveRules = async () => {
    if (!clinicId) return;
    try {
      await saveReminders.mutateAsync({ clinicId, offsets });
      message.success('Reminder rules saved. They feed the Reminder Centre on the appointment List.');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not save the reminder rules.');
    }
  };

  return (
    <div data-testid="communication-centre" className="kw-comms">
      {/* THE DARK SUB-NAVIGATION (approved mockup 6). It is INTERNAL to this
          console — the app's own top navigation and the Appointment tabs are
          untouched, and nothing here becomes a permanent global sidebar. */}
      <nav className="kw-comms-nav" aria-label="Communication Centre">
        <span className="kw-comms-nav-title">Communication Centre</span>
        <button
          type="button"
          className="kw-comms-nav-item"
          data-active={section === 'overview' || undefined}
          onClick={() => setSection('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          className="kw-comms-nav-item"
          data-active={section === 'templates' || undefined}
          onClick={() => setSection('templates')}
        >
          Templates
        </button>
        <button
          type="button"
          className="kw-comms-nav-item"
          data-active={section === 'reminders' || undefined}
          onClick={() => setSection('reminders')}
        >
          Reminders
        </button>
        <div className="kw-comms-nav-group">
          {NAV_TEMPLATES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="kw-comms-nav-item kw-comms-nav-item--child"
              data-active={section === entry.key || undefined}
              onClick={() => openSection(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {/* "Soon" in the mockup, and genuinely not built — so it is visible
            and unusable rather than a button that lies. */}
        <button type="button" className="kw-comms-nav-item" disabled>
          Broadcast <span className="kw-comms-soon">Soon</span>
        </button>
      </nav>

      <div className="kw-comms-main">
      {/* The transport truth, kept as a LINE rather than the banner that used
          to dominate the screen — and in the shell, because it is true of
          every section, not only the one being edited. */}
      <div className="kw-comms-honesty">
        <strong>WhatsApp automation is not connected</strong> — your team sends these from Kuwick
        through WhatsApp on their own device. Kuwick records that a message window was opened,
        never that it was delivered.
      </div>
      {section === 'overview' ? (
        <div className="kw-settings-grid" data-testid="communication-overview">
          <Card title="What this clinic says, and when" className="kw-settings-card">
            <div className="kw-comms-stats">
              <span>
                <strong>{Object.keys(TEMPLATE_KEY_WORDS).length}</strong>
                Message moments
              </span>
              <span>
                <strong>{customisedCount}</strong>
                Customised wordings
              </span>
              <span>
                <strong>{offsets.length}</strong>
                Reminder rules
              </span>
            </div>
            <Paragraph type="secondary" className="kw-settings-note" style={{ marginTop: 12 }}>
              Every figure above is read from the one message store this console writes to.
              A moment with no custom wording uses Kuwick&apos;s built-in text, in the
              patient&apos;s language.
            </Paragraph>
          </Card>
        </div>
      ) : null}

      {section === 'no-show' ? (
        <div className="kw-settings-grid">
          <Card title="No-show message" className="kw-settings-card">
            <Paragraph type="secondary" className="kw-settings-note">
              There is no no-show template in the message store, so there is nothing here to
              edit — and Kuwick will not open an editor that writes nowhere. A missed
              appointment is marked on the appointment List (Mark as no-show), which records the
              status and the actor; to say something to the patient afterwards, use any of the
              nine templates from the appointment&apos;s own drawer.
            </Paragraph>
          </Card>
        </div>
      ) : null}

      {showEditor ? (
        <div className="kw-comms-workspace" data-testid="message-templates-card">
          {/* Compact workspace header (approved mockup 6): what is being
              written, whether it is this clinic's own wording, and the one
              action that matters — not a page of explanation. */}
          <header className="kw-comms-head">
            <div className="kw-comms-head-text">
              <h3>{TEMPLATE_KEY_WORDS[templateKey] ?? 'Message'}</h3>
              <span>{TEMPLATE_HINTS[templateKey] ?? 'Sent by a person, from this wording.'}</span>
            </div>
            <div className="kw-comms-head-actions">
              {current?.isCustom ? (
                <Tag color="blue">Customised</Tag>
              ) : (
                <Tag>Built-in wording</Tag>
              )}
              {current?.isCustom ? (
                <Popconfirm
                  title="Back to the built-in wording?"
                  description="Your custom wording for this template and language is forgotten."
                  okText="Reset"
                  onConfirm={() => save(null)}
                  disabled={!canConfigure}
                >
                  <Button size="small" disabled={!canConfigure}>
                    Reset
                  </Button>
                </Popconfirm>
              ) : null}
              <Button
                type="primary"
                loading={saveTemplate.isPending}
                disabled={!canConfigure || !clinicId}
                title={
                  canConfigure
                    ? undefined
                    : permissionHint('change how appointments and services are configured')
                }
                onClick={() => save(body)}
              >
                Save template
              </Button>
            </div>
          </header>

          <div className="kw-comms-body">
            {/* Controls, in the mockup's own order and width. */}
            <aside className="kw-comms-controls">
              <label className="kw-comms-label">Message</label>
              <Select
                value={templateKey}
                onChange={setTemplateKey}
                style={{ width: '100%' }}
                options={Object.entries(TEMPLATE_KEY_WORDS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />

              <label className="kw-comms-label">Channel</label>
              {/* One real channel, so one option and no pretending. */}
              <Select
                value="whatsapp"
                disabled
                style={{ width: '100%' }}
                options={[{ value: 'whatsapp', label: 'WhatsApp — opened by a person' }]}
              />

              <label className="kw-comms-label">Language</label>
              <Segmented
                block
                value={language}
                onChange={(value) => setLanguage(String(value))}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'ms', label: 'Bahasa Malaysia' },
                ]}
              />

              {templateKey === 'REMINDER' ? (
                <>
                  <label className="kw-comms-label">Timing</label>
                  <div className="kw-comms-timing">
                    {offsets.length > 0 ? (
                      offsets
                        .slice()
                        .sort((a, b) => b - a)
                        .map((value) => (
                          <Tag key={value} className="kw-comms-timing-tag">
                            {offsetLabel(value)}
                          </Tag>
                        ))
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        No reminder rules yet.
                      </Text>
                    )}
                    <Button size="small" type="link" onClick={() => setSection('reminders')}>
                      Edit timing
                    </Button>
                  </div>
                </>
              ) : null}

              <label className="kw-comms-label">Variables</label>
              <div className="kw-comms-vars">
                {(templatesDoc?.placeholders ?? []).map((token) => (
                  <button
                    key={token}
                    type="button"
                    className="kw-comms-var"
                    onClick={() => insertPlaceholder(token)}
                  >
                    {`{${token}}`}
                  </button>
                ))}
              </div>
              <Text type="secondary" className="kw-comms-varnote">
                Tap to insert. A line whose fact is missing — no phone on file, no booking
                link — is left out of the message entirely.
              </Text>
            </aside>

            {/* The composer is the centre of the workspace. */}
            <section className="kw-comms-composer">
              <label className="kw-comms-label">Message</label>
              <Input.TextArea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="kw-comms-textarea"
                maxLength={1000}
                data-testid="template-body"
              />
              <div className="kw-comms-count">Characters: {body.length}</div>
            </section>

            {/* Template | Preview, and a preview that looks like the thing
                the patient will actually receive. */}
            <aside className="kw-comms-previewpane">
              <Segmented
                block
                value={pane}
                onChange={(value) => setPane(value as 'preview' | 'template')}
                options={[
                  { value: 'template', label: 'Template' },
                  { value: 'preview', label: 'Preview' },
                ]}
              />
              <div className="kw-comms-phone" data-testid="template-preview">
                <div className="kw-comms-phone-head">
                  <span className="kw-comms-phone-avatar" aria-hidden>
                    {(clinic?.patientFacingName ?? clinic?.name ?? 'K').slice(0, 1)}
                  </span>
                  <span className="kw-comms-phone-name">
                    {clinic?.patientFacingName ?? clinic?.name ?? 'Your clinic'}
                  </span>
                </div>
                <div className="kw-comms-phone-body">
                  <div className="kw-comms-bubble" data-raw={pane === 'template' || undefined}>
                    {pane === 'preview'
                      ? preview || 'Nothing to preview yet.'
                      : body || 'Nothing written yet.'}
                  </div>
                </div>
              </div>
              <Text type="secondary" className="kw-comms-previewnote">
                {pane === 'preview'
                  ? 'Filled with this clinic’s real identity and a sample appointment.'
                  : 'The stored wording, placeholders and all.'}
              </Text>
            </aside>
          </div>

        </div>
      ) : null}

      <div className="kw-settings-grid" hidden={section !== 'reminders' && section !== 'overview'}>
        <Card
          hidden={section !== 'reminders'}
          title="Reminder rules"
          className="kw-settings-card"
          data-testid="reminder-rules-card"
        >
          <Paragraph type="secondary" className="kw-settings-note">
            Each rule puts upcoming appointments on the <strong>Reminder Centre</strong> worklist
            (Appointments → List) once its moment passes, using the Appointment reminder template
            above. The booking confirmation is its own template and is offered right after a
            booking is made — that is the &ldquo;immediately&rdquo; message.
          </Paragraph>

          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              value={offsets}
              onChange={setOffsets}
              options={[
                ...REMINDER_CHOICES,
                // Keep any stored custom offset visible and removable.
                ...offsets
                  .filter((value) => !REMINDER_CHOICES.some((choice) => choice.value === value))
                  .map((value) => ({ value, label: offsetLabel(value) })),
              ]}
              placeholder="No reminders"
            />

            <Space.Compact>
              <InputNumber
                min={1}
                max={60 * 24 * 30}
                value={customValue}
                onChange={setCustomValue}
                placeholder="Custom"
                style={{ width: 110 }}
              />
              <Select
                value={customUnit}
                onChange={setCustomUnit}
                style={{ width: 110 }}
                options={[
                  { value: 'minutes', label: 'minutes' },
                  { value: 'hours', label: 'hours' },
                  { value: 'days', label: 'days' },
                ]}
              />
              <Button onClick={addCustom} disabled={!customValue}>
                Add
              </Button>
            </Space.Compact>

            <Button
              type="primary"
              onClick={saveRules}
              loading={saveReminders.isPending}
              disabled={!canConfigure || !clinicId}
              title={canConfigure ? undefined : permissionHint('change how appointments and services are configured')}
            >
              Save reminder rules
            </Button>
          </Space>
        </Card>

        <Card
          hidden={section !== 'overview'}
          title="Where messages are sent from"
          className="kw-settings-card"
        >
          <Paragraph type="secondary" className="kw-settings-note" style={{ marginBottom: 8 }}>
            Today, three places — all by a person, all through these templates:
          </Paragraph>
          <ul className="kw-settings-note" style={{ paddingLeft: 18, margin: 0, color: 'inherit' }}>
            <li>
              <Text>
                An appointment&apos;s drawer — <em>WhatsApp patient</em> — for any of the nine
                messages.
              </Text>
            </li>
            <li>
              <Text>
                The appointment <Link to="/appointments/list">List</Link>&apos;s reminder button on
                each row.
              </Text>
            </li>
            <li>
              <Text>
                The <em>Reminder Centre</em> worklist the rules above build.
              </Text>
            </li>
          </ul>
        </Card>
      </div>
      </div>
    </div>
  );
}
