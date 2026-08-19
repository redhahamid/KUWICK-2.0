import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Popconfirm,
  Skeleton,
  Space,
  Timeline,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  EllipsisOutlined,
  FileTextOutlined,
  SwapOutlined,
  WhatsAppOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { AppointmentStatus } from '@kuwick/shared';
import { KuwickStatusTag } from '../../design-system/kuwick';
import { formatClinicDate, formatClinicDateTime, formatClinicTime } from '../../clinical/clinicTime';
import { SOURCE_LABELS, type AppointmentSource } from '../types';
import { paymentChip, sentence, statusChip } from '../appointment-presentation';
import { CHECK_IN_FROM_STATUSES, NON_CANCELLABLE_STATUSES } from '../appointment-status.constants';
import {
  useAppointmentDetail,
  useLogCommunication,
  useRejectAppointment,
} from '../hooks/useAppointmentDetail';
import {
  useArrivedAppointment,
  useCancelAppointment,
  useConfirmAppointment,
  useNoShowAppointment,
} from '../hooks/useAppointments';
import { whatsappLink } from '../whatsappReminder';
import { ApiError } from '../../core/api-client';

const { Text, Paragraph } = Typography;

interface AppointmentDrawerProps {
  appointmentId: string | null;
  open: boolean;
  onClose: () => void;
  onReschedule: (appointmentId: string) => void;
  onBookFollowUp?: (patientId: string) => void;
}

const EVENT_WORDS: Record<string, string> = {
  CREATED: 'Booked',
  STATUS_CHANGED: 'Status changed',
  TIME_CHANGED: 'Time changed',
  PROVIDER_CHANGED: 'Provider changed',
  SERVICE_CHANGED: 'Service changed',
  RESCHEDULED: 'Rescheduled',
  CANCELLED: 'Cancelled',
  CHECKED_IN: 'Checked in',
  OVERRIDE_APPLIED: 'Booking rule overridden',
  PAYMENT_CHANGED: 'Payment updated',
  PATIENT_LINKED: 'Patient matched',
  COMMUNICATION_SENT: 'Message sent',
  NOTE_ADDED: 'Note added',
};

/**
 * THE APPOINTMENT DRAWER — everything about one booking, on the right.
 *
 * A DRAWER rather than a permanently reserved panel (§8). The calendar uses
 * the full width when nothing is selected, which on a 13-inch laptop is the
 * difference between five provider columns and three; a panel that is empty
 * most of the time is a panel that costs the grid a third of its width for
 * nothing.
 *
 * ONE PRIMARY ACTION before arrival — Check in — because that is what the
 * counter presses forty times a day. Everything else is secondary or lives
 * under More, so the button somebody needs is never one of six.
 */
export function AppointmentDrawer({
  appointmentId,
  open,
  onClose,
  onReschedule,
  onBookFollowUp,
}: AppointmentDrawerProps) {
  const navigate = useNavigate();
  const { data: appointment, isLoading } = useAppointmentDetail(appointmentId ?? undefined);
  const [showHistory, setShowHistory] = useState(false);

  const checkIn = useArrivedAppointment();
  const confirm = useConfirmAppointment();
  const noShow = useNoShowAppointment();
  const cancel = useCancelAppointment();
  const reject = useRejectAppointment();
  const logCommunication = useLogCommunication();

  const status = appointment?.status as AppointmentStatus | undefined;
  const canCheckIn = status ? CHECK_IN_FROM_STATUSES.includes(status) : false;
  const canCancel = status ? !NON_CANCELLABLE_STATUSES.includes(status) : false;
  const isRequest = status === AppointmentStatus.REQUESTED;

  const whatsapp = useMemo(() => {
    if (!appointment?.patient.phone) return null;
    return whatsappLink({
      phone: appointment.patient.phone,
      patientName: appointment.patient.name,
      clinicName: '',
      scheduledStart: appointment.scheduledStart,
    });
  }, [appointment]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      message.success(label);
    } catch (error) {
      // The server's own sentence, not a generic one: it is written for a
      // front desk and says what to do instead.
      message.error(error instanceof ApiError ? error.message : `Could not ${label.toLowerCase()}.`);
    }
  };

  const moreItems = [
    whatsapp
      ? {
          key: 'whatsapp',
          icon: <WhatsAppOutlined />,
          label: 'WhatsApp patient',
        }
      : null,
    appointment?.patient.phone ? { key: 'reminder', label: 'Record reminder sent' } : null,
    onBookFollowUp ? { key: 'follow-up', label: 'Book a follow-up' } : null,
    appointment?.visitId ? { key: 'record', label: 'Open clinical record' } : null,
    { key: 'patient', label: 'Open patient record' },
    { key: 'history', label: showHistory ? 'Hide history' : 'View history' },
    canCancel ? { type: 'divider' as const, key: 'd1' } : null,
    canCancel ? { key: 'cancel', danger: true, label: 'Cancel appointment' } : null,
  ].filter(Boolean) as { key: string; label: string }[];

  const onMore = async (key: string) => {
    if (!appointment) return;
    switch (key) {
      case 'whatsapp':
        if (whatsapp) window.open(whatsapp, '_blank', 'noopener');
        // Recorded as MANUAL: the receptionist sent it themselves, and calling
        // that anything else would claim a gateway Kuwick does not have.
        await run('Reminder recorded', () =>
          logCommunication.mutateAsync({
            appointmentId: appointment.id,
            channel: 'WHATSAPP',
            template: 'REMINDER_MANUAL',
            destination: appointment.patient.phone ?? undefined,
          }),
        );
        break;
      case 'reminder':
        await run('Reminder recorded', () =>
          logCommunication.mutateAsync({
            appointmentId: appointment.id,
            channel: 'WHATSAPP',
            template: 'REMINDER_MANUAL',
          }),
        );
        break;
      case 'follow-up':
        onBookFollowUp?.(appointment.patientId);
        break;
      case 'record':
        navigate(`/clinical/canvas/${appointment.visitId}`);
        break;
      case 'patient':
        navigate(`/patients/${appointment.patientId}`);
        break;
      case 'history':
        setShowHistory((previous) => !previous);
        break;
      case 'cancel':
        await run('Appointment cancelled', () =>
          cancel.mutateAsync({
            id: appointment.id,
            input: { cancellationReason: 'CLINIC_REQUEST' },
          }),
        );
        onClose();
        break;
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={420}
      destroyOnHidden
      title={appointment ? appointment.patient.name : 'Appointment'}
      extra={
        status ? <KuwickStatusTag {...statusChip(status)} /> : null
      }
      footer={
        appointment ? (
          <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
            <Space wrap>
              {isRequest ? (
                <>
                  <Button
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    loading={confirm.isPending}
                    onClick={() =>
                      run('Request accepted', () => confirm.mutateAsync({ id: appointment.id }))
                    }
                  >
                    Accept request
                  </Button>
                  <Popconfirm
                    title="Decline this request?"
                    description="The patient's slot is released and they are not booked in."
                    okText="Decline"
                    onConfirm={() =>
                      run('Request declined', () => reject.mutateAsync({ id: appointment.id }))
                    }
                  >
                    <Button>Decline</Button>
                  </Popconfirm>
                </>
              ) : (
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  disabled={!canCheckIn}
                  loading={checkIn.isPending}
                  onClick={() =>
                    run('Patient checked in', () => checkIn.mutateAsync({ id: appointment.id }))
                  }
                >
                  Check in
                </Button>
              )}
              <Button
                icon={<SwapOutlined />}
                disabled={!canCancel}
                onClick={() => onReschedule(appointment.id)}
              >
                Reschedule
              </Button>
            </Space>
            <Space>
              {canCheckIn ? (
                <Popconfirm
                  title="Mark as a no-show?"
                  okText="No-show"
                  onConfirm={() =>
                    run('Marked as no-show', () => noShow.mutateAsync({ id: appointment.id }))
                  }
                >
                  <Button>No-show</Button>
                </Popconfirm>
              ) : null}
              <Dropdown
                menu={{ items: moreItems, onClick: ({ key }) => onMore(key) }}
                trigger={['click']}
              >
                <Button icon={<EllipsisOutlined />} aria-label="More actions" />
              </Dropdown>
            </Space>
          </Space>
        ) : null
      }
    >
      {isLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
      {!isLoading && !appointment ? <Empty description="Appointment not found" /> : null}

      {appointment ? (
        <div data-testid="appointment-drawer">
          {appointment.overriddenRule ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="Booked against the clinic's rules"
              description={`${appointment.overrideReason} — ${sentence(appointment.overriddenRule)}`}
            />
          ) : null}

          {appointment.rescheduledFrom ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={`Moved from ${formatClinicDateTime(appointment.rescheduledFrom.scheduledStart)}`}
            />
          ) : null}

          <Descriptions column={1} size="small" colon={false} styles={{ label: { width: 130 } }}>
            <Descriptions.Item label="When">
              <Text strong>{formatClinicDate(appointment.scheduledStart)}</Text>
              <br />
              {formatClinicTime(appointment.scheduledStart)} –{' '}
              {formatClinicTime(appointment.scheduledEnd)}
            </Descriptions.Item>
            <Descriptions.Item label="Service">{appointment.service.name}</Descriptions.Item>
            <Descriptions.Item label="Provider">{appointment.staff.fullName}</Descriptions.Item>
            <Descriptions.Item label="MRN / IC">
              {appointment.patient.identifierValue}
            </Descriptions.Item>
            <Descriptions.Item label="Phone">
              {appointment.patient.phone ?? <Text type="secondary">Not recorded</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="Booked">
              {formatClinicDateTime(appointment.createdAt)} ·{' '}
              {SOURCE_LABELS[appointment.source as AppointmentSource] ?? appointment.source}
              {appointment.sourceDetail ? ` (${appointment.sourceDetail})` : ''}
            </Descriptions.Item>
            <Descriptions.Item label="Payment">
              <KuwickStatusTag {...paymentChip(appointment.paymentStatus)} />
              {Number(appointment.bookingFeeAmount) > 0
                ? ` RM ${Number(appointment.bookingFeeAmount).toFixed(2)}`
                : ''}
            </Descriptions.Item>
            <Descriptions.Item label="Reminder">
              {appointment.reminderSentAt ? (
                formatClinicDateTime(appointment.reminderSentAt)
              ) : (
                <Text type="secondary">Not sent</Text>
              )}
            </Descriptions.Item>
            {appointment.queueTicket ? (
              <Descriptions.Item label="Queue">
                <Text strong>{appointment.queueTicket.displayNumber}</Text> ·{' '}
                {sentence(appointment.queueTicket.status)}
              </Descriptions.Item>
            ) : null}
            {appointment.visit ? (
              <Descriptions.Item label="Visit">#{appointment.visit.visitNumber}</Descriptions.Item>
            ) : null}
          </Descriptions>

          {appointment.patientNote ? (
            <>
              <Divider titlePlacement="start" plain style={{ margin: '12px 0 8px' }}>
                What the patient said
              </Divider>
              <Paragraph style={{ marginBottom: 0 }}>{appointment.patientNote}</Paragraph>
            </>
          ) : null}

          {appointment.notes ? (
            <>
              <Divider titlePlacement="start" plain style={{ margin: '12px 0 8px' }}>
                Internal note
              </Divider>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {appointment.notes}
              </Paragraph>
            </>
          ) : null}

          {appointment.formAnswers.length > 0 ? (
            <>
              <Divider titlePlacement="start" plain style={{ margin: '12px 0 8px' }}>
                Booking answers
              </Divider>
              <Descriptions column={1} size="small" colon={false}>
                {appointment.formAnswers.map((answer) => (
                  <Descriptions.Item key={answer.id} label={answer.label}>
                    {answer.answer ?? <Text type="secondary">—</Text>}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </>
          ) : null}

          {appointment.service.preInstructions ? (
            <Alert
              style={{ marginTop: 12 }}
              type="info"
              icon={<FileTextOutlined />}
              showIcon
              message="Before the appointment"
              description={appointment.service.preInstructions}
            />
          ) : null}

          {showHistory ? (
            <>
              <Divider titlePlacement="start" plain style={{ margin: '16px 0 8px' }}>
                History
              </Divider>
              <Timeline
                items={appointment.events.map((event) => ({
                  key: event.id,
                  children: (
                    <div>
                      <Text strong>{EVENT_WORDS[event.eventType] ?? event.eventType}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatClinicDateTime(event.occurredAt)}
                        {event.actorLabel ? ` · ${event.actorLabel}` : ''}
                      </Text>
                      {event.reason ? (
                        <>
                          <br />
                          <Text style={{ fontSize: 12 }}>{event.reason}</Text>
                        </>
                      ) : null}
                    </div>
                  ),
                }))}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
