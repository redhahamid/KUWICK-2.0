import { useEffect, useMemo, useState } from 'react';
import { Alert, Input, Modal, Segmented, Select, Space, Typography, message } from 'antd';
import { WhatsAppOutlined } from '@ant-design/icons';
import { useClinics } from '../../core/hooks/useClinics';
import { useLogCommunication } from '../hooks/useAppointmentDetail';
import {
  TEMPLATE_KEY_WORDS,
  messageContextFor,
  renderAppointmentMessage,
  templateBody,
  useMessageTemplates,
  whatsappLinkForMessage,
} from './appointmentMessages';

export interface MessagePatientModalProps {
  open: boolean;
  onClose: () => void;
  clinicId: string;
  appointment: {
    id: string;
    scheduledStart: string | Date;
    manageToken?: string | null;
    patient: { name: string; phone: string | null };
    staff: { fullName: string };
    service: { name: string };
  } | null;
  /** Which template the picker starts on. Default REMINDER. */
  defaultTemplateKey?: string;
  /**
   * What the communication log records. The reminder WORKLIST passes its
   * rule's own key (REMINDER_1440) so the due list clears; everywhere else
   * the selected template key is the honest record.
   */
  logTemplateKey?: string;
  onLogged?: () => void;
}

/**
 * PHASE 8 — "Message patient", the same three-step everywhere: pick the
 * message type, read the rendered words, open WhatsApp. The message comes
 * from the clinic's templates through the ONE renderer; the log records that
 * a window was OPENED, which is the only claim a wa.me link supports.
 */
export function MessagePatientModal(props: MessagePatientModalProps) {
  const { open, onClose, clinicId, appointment } = props;
  const { data: clinics } = useClinics();
  const clinic = clinics?.find((row) => row.id === clinicId);
  const { data: templatesDoc } = useMessageTemplates(open ? clinicId : undefined);
  const logCommunication = useLogCommunication();

  const [templateKey, setTemplateKey] = useState(props.defaultTemplateKey ?? 'REMINDER');
  const [language, setLanguage] = useState('en');
  const [text, setText] = useState('');
  const [edited, setEdited] = useState(false);
  const [seededFor, setSeededFor] = useState<string>();

  // Re-seed per opening: the page language is the default tongue, the
  // caller's template the default type, and any hand-edit is forgotten.
  useEffect(() => {
    if (!open || !appointment) return;
    const seedKey = `${appointment.id}`;
    if (seededFor === seedKey) return;
    setSeededFor(seedKey);
    setTemplateKey(props.defaultTemplateKey ?? 'REMINDER');
    setLanguage(clinic?.bookingLanguage === 'ms' ? 'ms' : 'en');
    setEdited(false);
  }, [open, appointment, clinic?.bookingLanguage, props.defaultTemplateKey, seededFor]);
  useEffect(() => {
    if (!open) setSeededFor(undefined);
  }, [open]);

  const rendered = useMemo(() => {
    if (!appointment) return '';
    const body = templateBody(templatesDoc, templateKey, language);
    if (!body) return '';
    return renderAppointmentMessage(
      body,
      messageContextFor({ appointment, clinic }),
    );
  }, [appointment, clinic, templatesDoc, templateKey, language]);

  // The textarea shows the rendered words until somebody edits them.
  useEffect(() => {
    if (!edited) setText(rendered);
  }, [rendered, edited]);

  const phone = appointment?.patient.phone ?? null;
  const link = whatsappLinkForMessage(phone, text);

  const send = async () => {
    if (!appointment || !link) return;
    // Opened FIRST: if the popup is blocked or the person changes their mind,
    // nothing is recorded. A "sent" mark for a message that never opened is
    // worse than no mark.
    window.open(link, '_blank', 'noopener,noreferrer');
    try {
      await logCommunication.mutateAsync({
        appointmentId: appointment.id,
        channel: 'WHATSAPP',
        template: props.logTemplateKey ?? templateKey,
        destination: phone ?? undefined,
      });
      message.success('WhatsApp opened — noted in history');
      props.onLogged?.();
    } catch {
      message.error('WhatsApp opened, but the message could not be recorded.');
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={appointment ? `Message ${appointment.patient.name}` : 'Message patient'}
      okText="Open WhatsApp"
      okButtonProps={{
        icon: <WhatsAppOutlined />,
        disabled: !link || !text.trim(),
        loading: logCommunication.isPending,
      }}
      onOk={send}
      destroyOnHidden
      data-testid="message-patient-modal"
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          <Select
            value={templateKey}
            onChange={(value) => {
              setTemplateKey(value);
              setEdited(false);
            }}
            style={{ minWidth: 260 }}
            options={Object.entries(TEMPLATE_KEY_WORDS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Segmented
            value={language}
            onChange={(value) => {
              setLanguage(String(value));
              setEdited(false);
            }}
            options={[
              { value: 'en', label: 'English' },
              { value: 'ms', label: 'Bahasa Malaysia' },
            ]}
          />
        </Space>

        <Input.TextArea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setEdited(true);
          }}
          autoSize={{ minRows: 5, maxRows: 10 }}
          data-testid="message-preview"
        />

        {phone ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Opens WhatsApp to {phone} on this device. Kuwick records that the window was opened —
            it cannot know whether the message was delivered.
          </Typography.Text>
        ) : (
          <Alert
            type="warning"
            showIcon
            message="This patient has no usable phone number on file."
          />
        )}
      </Space>
    </Modal>
  );
}
