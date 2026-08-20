import { useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Modal,
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
  PhoneOutlined,
  RightOutlined,
  SwapOutlined,
  UserOutlined,
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
import { getDoctorColor } from './doctor-color';
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
  const isInClinic = status === AppointmentStatus.CHECKED_IN;
  const isCompleted = status === AppointmentStatus.COMPLETED;
  const isReleased =
    status === AppointmentStatus.CANCELLED || status === AppointmentStatus.NO_SHOW;
  const initials = (appointment?.patient.name ?? '')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

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

  // Patient record, WhatsApp and Call are QUICK ACTIONS beside the header
  // (§21) — the three reaches a receptionist makes mid-phone-call — so the
  // ••• menu holds only the occasional and the destructive.
  const moreItems = [
    appointment?.patient.phone ? { key: 'reminder', label: 'Record reminder sent' } : null,
    onBookFollowUp ? { key: 'follow-up', label: 'Book a follow-up' } : null,
    appointment?.visitId ? { key: 'record', label: 'Open clinical record' } : null,
    { key: 'history', label: showHistory ? 'Hide history' : 'View history' },
    canCheckIn || canCancel ? { type: 'divider' as const, key: 'd1' } : null,
    canCheckIn ? { key: 'no-show', danger: true, label: 'Mark as no-show' } : null,
    canCancel ? { key: 'cancel', danger: true, label: 'Cancel appointment' } : null,
  ].filter(Boolean) as { key: string; label: string }[];

  // Recorded as MANUAL: the receptionist sent it themselves, and calling
  // that anything else would claim a gateway Kuwick does not have.
  const openWhatsApp = async () => {
    if (!appointment || !whatsapp) return;
    window.open(whatsapp, '_blank', 'noopener');
    await run('Reminder recorded', () =>
      logCommunication.mutateAsync({
        appointmentId: appointment.id,
        channel: 'WHATSAPP',
        template: 'REMINDER_MANUAL',
        destination: appointment.patient.phone ?? undefined,
      }),
    );
  };

  const onMore = async (key: string) => {
    if (!appointment) return;
    switch (key) {
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
      case 'history':
        setShowHistory((previous) => !previous);
        break;
      case 'no-show':
        Modal.confirm({
          title: 'Mark as a no-show?',
          content: 'The slot is released and the miss is counted in the clinic’s no-show rate.',
          okText: 'No-show',
          okButtonProps: { danger: true },
          onOk: () => run('Marked as no-show', () => noShow.mutateAsync({ id: appointment.id })),
        });
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
      width={440}
      rootClassName="kw-apt3-drawer"
      destroyOnHidden
      title={
        appointment ? (
          <div className="kw-apt-head">
            <Avatar size={40} className="kw-apt-avatar">
              {initials}
            </Avatar>
            <div className="kw-apt-head-text">
              <div className="kw-apt-head-name">{appointment.patient.name}</div>
              <div className="kw-apt-head-meta">
                {appointment.patient.identifierValue}
                {appointment.patient.phone ? ` · ${appointment.patient.phone}` : ''}
              </div>
            </div>
          </div>
        ) : (
          'Appointment'
        )
      }
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
              ) : null}
              {canCheckIn ? (
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  loading={checkIn.isPending}
                  onClick={() =>
                    run('Patient checked in', () => checkIn.mutateAsync({ id: appointment.id }))
                  }
                >
                  Check in
                </Button>
              ) : null}
              {(isInClinic || isCompleted) && appointment.visitId ? (
                <Button
                  type="primary"
                  icon={<RightOutlined />}
                  onClick={() => navigate(`/clinical/canvas/${appointment.visitId}`)}
                >
                  Open visit
                </Button>
              ) : null}
              {isReleased && onBookFollowUp ? (
                <Button type="primary" onClick={() => onBookFollowUp(appointment.patientId)}>
                  Book again
                </Button>
              ) : null}
              {canCancel && !isInClinic ? (
                <Button icon={<SwapOutlined />} onClick={() => onReschedule(appointment.id)}>
                  Reschedule
                </Button>
              ) : null}
            </Space>
            <Space>
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
          {/* §21 — the three reaches a receptionist makes while the patient
              is still on the phone, one press from the header. Call only
              renders when there is a number to dial. */}
          <div className="kw-apt-quick">
            <Button
              size="small"
              icon={<UserOutlined />}
              onClick={() => navigate(`/patients/${appointment.patientId}`)}
            >
              Patient record
            </Button>
            {whatsapp ? (
              <Button size="small" icon={<WhatsAppOutlined />} onClick={openWhatsApp}>
                WhatsApp
              </Button>
            ) : null}
            {appointment.patient.phone ? (
              <Button
                size="small"
                icon={<PhoneOutlined />}
                href={`tel:${appointment.patient.phone}`}
              >
                Call
              </Button>
            ) : null}
          </div>

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

          {/* Where the patient IS right now — the loudest thing in the
              drawer once they are in the building. */}
          {appointment.queueTicket && !isCompleted ? (
            <button
              type="button"
              className="kw-apt-queue"
              onClick={() =>
                appointment.visitId
                  ? navigate(`/clinical/canvas/${appointment.visitId}`)
                  : undefined
              }
            >
              <span className="kw-apt-queue-number">{appointment.queueTicket.displayNumber}</span>
              <span className="kw-apt-queue-state">
                {sentence(appointment.queueTicket.status)}
                {appointment.visit ? ` · Visit #${appointment.visit.visitNumber}` : ''}
              </span>
              {appointment.visitId ? <RightOutlined aria-hidden /> : null}
            </button>
          ) : null}
          {isCompleted && appointment.visit ? (
            <button
              type="button"
              className="kw-apt-queue kw-apt-queue--done"
              onClick={() =>
                appointment.visitId
                  ? navigate(`/clinical/canvas/${appointment.visitId}`)
                  : undefined
              }
            >
              <CheckCircleOutlined aria-hidden />
              <span className="kw-apt-queue-state">
                Visit #{appointment.visit.visitNumber} completed
                {appointment.visit.checkOutAt
                  ? ` · ${formatClinicTime(appointment.visit.checkOutAt)}`
                  : ''}
              </span>
              <RightOutlined aria-hidden />
            </button>
          ) : null}

          {/* THE APPOINTMENT, said once and said big: when, what, with whom. */}
          <div className="kw-apt-section">Booking</div>
          <div className="kw-apt-summary">
            <div className="kw-apt-when">
              <div className="kw-apt-date">{formatClinicDate(appointment.scheduledStart)}</div>
              <div className="kw-apt-time">
                {formatClinicTime(appointment.scheduledStart)} –{' '}
                {formatClinicTime(appointment.scheduledEnd)}
              </div>
            </div>
            <div className="kw-apt-what">
              <div className="kw-apt-service">{appointment.service.name}</div>
              <div className="kw-apt-provider">
                {/* The provider's identity dot — the same colour as their
                    calendar edge and roster avatar. */}
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    marginRight: 6,
                    background: getDoctorColor(appointment.staffId),
                  }}
                />
                {appointment.staff.fullName}
              </div>
            </div>
          </div>

          <Descriptions
            className="kw-apt-meta"
            column={1}
            size="small"
            colon={false}
            styles={{ label: { width: 110 } }}
          >
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
          </Descriptions>

          {/* §21 — labelled sections instead of dividers: a quiet uppercase
              word above each block, so the drawer scans like a record card. */}
          {appointment.patientNote ? (
            <>
              <div className="kw-apt-section">Patient message</div>
              <Paragraph style={{ marginBottom: 0 }}>{appointment.patientNote}</Paragraph>
            </>
          ) : null}

          {appointment.notes ? (
            <>
              <div className="kw-apt-section">Internal note</div>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {appointment.notes}
              </Paragraph>
            </>
          ) : null}

          {appointment.formAnswers.length > 0 ? (
            <>
              <div className="kw-apt-section">Booking answers</div>
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
            <>
              <div className="kw-apt-section">Instructions</div>
              <div className="kw-apt-instructions">{appointment.service.preInstructions}</div>
            </>
          ) : null}

          {showHistory ? (
            <>
              <div className="kw-apt-section">History</div>
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
