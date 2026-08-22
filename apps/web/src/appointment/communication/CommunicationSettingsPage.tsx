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
import { PageHeader } from '../../design-system/components/PageHeader';
import { permissionHint, useCan } from '../../core/hooks/useCan';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
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
 * SETTINGS → APPOINTMENTS & SCHEDULING → COMMUNICATION & REMINDERS
 *
 * The CANONICAL home of what Kuwick says to patients and when. One store:
 * the nine templates (per language) live in appointment_message_templates,
 * the reminder offsets in appointment_reminder_rules — the Booking Page tab
 * links here rather than keeping a second copy.
 *
 * Everything on this screen is honest about the transport: there is no
 * WhatsApp API connected, so templates feed the SAME modal a person sends
 * from, and reminder rules build a worklist a person works through.
 */
export function CommunicationSettingsPage() {
  const { clinicId, clinics, showSelector, setClinicId } = useClinicFilter();
  const canConfigure = useCan('appointment.configure');
  const clinic = clinics?.find((row) => row.id === clinicId);
  const { data: templatesDoc, isLoading } = useMessageTemplates(clinicId);
  const { data: bookingPage } = useBookingPage(clinicId);
  const queryClient = useQueryClient();

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
      message.success('Reminder rules saved. They feed the Reminders due list on the appointment List.');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not save the reminder rules.');
    }
  };

  return (
    <div className="kw-settings-page" data-testid="communication-settings">
      <PageHeader
        title="Communication & reminders"
        subtitle="What Kuwick says to patients, in the clinic's own words — and when to nudge them."
      />

      {showSelector && (
        <Select
          className="kw-settings-clinic"
          placeholder="Choose a branch"
          value={clinicId}
          onChange={setClinicId}
          options={clinics?.map((row) => ({ value: row.id, label: row.name }))}
        />
      )}

      <Alert
        type="info"
        showIcon
        className="kw-settings-alert"
        message="WhatsApp automation is not connected"
        description="Messages are sent by your team from Kuwick — the calendar, the list and the Reminders due worklist — through WhatsApp on their own device, prefilled from these templates. Kuwick records that a message window was opened; it will only ever claim Sent or Delivered if a messaging provider that confirms delivery is connected."
      />

      <div className="kw-settings-grid">
        <Card
          title="Message templates"
          className="kw-settings-card"
          loading={isLoading}
          data-testid="message-templates-card"
          extra={current?.isCustom ? <Tag color="blue">Customised</Tag> : <Tag>Default</Tag>}
        >
          <Paragraph type="secondary" className="kw-settings-note">
            Nine moments, two languages, one wording each. Every message anybody sends from Kuwick
            is filled from these — change a template here and the whole clinic speaks the new
            words.
          </Paragraph>

          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap>
              <Select
                value={templateKey}
                onChange={setTemplateKey}
                style={{ minWidth: 260 }}
                options={Object.entries(TEMPLATE_KEY_WORDS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
              <Segmented
                value={language}
                onChange={(value) => setLanguage(String(value))}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'ms', label: 'Bahasa Malaysia' },
                ]}
              />
            </Space>

            <Input.TextArea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              autoSize={{ minRows: 5, maxRows: 12 }}
              maxLength={1000}
              showCount
              data-testid="template-body"
            />

            <div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                Tap to insert — a line whose fact is missing (no phone on file, no booking link) is
                left out of the message entirely:
              </Text>
              <Space size={[4, 6]} wrap>
                {(templatesDoc?.placeholders ?? []).map((token) => (
                  <Tag
                    key={token}
                    style={{ cursor: 'pointer', fontFamily: 'monospace' }}
                    onClick={() => insertPlaceholder(token)}
                  >
                    {`{${token}}`}
                  </Tag>
                ))}
              </Space>
            </div>

            <Card size="small" title="Preview" data-testid="template-preview">
              <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                {preview || <Text type="secondary">Nothing to preview yet.</Text>}
              </Paragraph>
            </Card>

            <Space>
              <Button
                type="primary"
                loading={saveTemplate.isPending}
                disabled={!canConfigure || !clinicId}
                title={canConfigure ? undefined : permissionHint('change how appointments and services are configured')}
                onClick={() => save(body)}
              >
                Save template
              </Button>
              {current?.isCustom ? (
                <Popconfirm
                  title="Back to the built-in wording?"
                  description="Your custom wording for this template and language is forgotten."
                  okText="Reset"
                  onConfirm={() => save(null)}
                  disabled={!canConfigure}
                >
                  <Button disabled={!canConfigure}>Reset to default</Button>
                </Popconfirm>
              ) : null}
            </Space>
          </Space>
        </Card>

        <Card
          title="Reminder rules"
          className="kw-settings-card"
          data-testid="reminder-rules-card"
        >
          <Paragraph type="secondary" className="kw-settings-note">
            Each rule puts upcoming appointments on the <strong>Reminders due</strong> worklist
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

        <Card title="Where messages are sent from" className="kw-settings-card">
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
                The <em>Reminders due</em> worklist the rules above build.
              </Text>
            </li>
          </ul>
          <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
            The public booking page&apos;s own confirmation screen and its settings stay on the{' '}
            <Link to="/appointments/booking-page">Booking Page</Link> tab — this screen is the one
            store for message wording and reminder timing.
          </Paragraph>
        </Card>
      </div>
    </div>
  );
}
