import { useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Skeleton,
  Space,
  Timeline,
  Tooltip,
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
import {
  ARRIVABLE_FROM_STATUSES,
  CHECK_IN_FROM_STATUSES,
  NON_CANCELLABLE_STATUSES,
} from '../appointment-status.constants';
import {
  useAppointmentDetail,
  useChangeRequests,
  useDecideChangeRequest,
  useLogCommunication,
  useRejectAppointment,
} from '../hooks/useAppointmentDetail';
import {
  useCancelAppointment,
  useConfirmAppointment,
  useMarkArrivedAppointment,
  useNoShowAppointment,
} from '../hooks/useAppointments';
import { CheckInRegistrationDrawer } from '../checkin/CheckInRegistrationDrawer';
import { MessagePatientModal } from '../messages/MessagePatientModal';
import { permissionHint, useCan } from '../../core/hooks/useCan';
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
  CHANGE_REQUESTED: 'Patient requested a change',
  CHANGE_REQUEST_APPROVED: 'Request approved',
  CHANGE_REQUEST_DECLINED: 'Request declined',
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

  const markArrived = useMarkArrivedAppointment();
  // Phase 7 — the patient's pending question, and the clinic's answer.
  const { data: changeRequests } = useChangeRequests(appointmentId ?? undefined);
  const decideRequest = useDecideChangeRequest(appointmentId ?? undefined);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState('');
  const pendingRequests = (changeRequests ?? []).filter((row) => row.status === 'PENDING');
  // Phase 4 — Check in opens the registration REVIEW; nothing is created
  // until Confirm & add to queue inside it.
  const [registering, setRegistering] = useState(false);
  const confirm = useConfirmAppointment();
  const noShow = useNoShowAppointment();
  const cancel = useCancelAppointment();
  const reject = useRejectAppointment();
  const logCommunication = useLogCommunication();

  const status = appointment?.status as AppointmentStatus | undefined;
  const canCheckIn = status ? CHECK_IN_FROM_STATUSES.includes(status) : false;
  const canCancel = status ? !NON_CANCELLABLE_STATUSES.includes(status) : false;

  // Phase 1 — what THIS ACCOUNT may do, from the server-published permission
  // set. Status says whether the action makes sense; permission says whether
  // this person may take it. A button that fails only after the click taught
  // UAT nothing except distrust, so the ones below disable with the reason.
  const permEdit = useCan('appointment.edit');
  const permCheckIn = useCan('appointment.check_in');
  const permCancel = useCan('appointment.cancel');
  const permNoShow = useCan('appointment.no_show');
  const permReschedule = useCan('appointment.reschedule');
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

  // PHASE 8 — messaging goes through the template modal: the clinic's own
  // wording (or the defaults), rendered by the ONE renderer against the
  // patient-facing clinic identity. The drawer no longer composes any
  // message text itself — that is how "appointment at on" happened.
  const [messaging, setMessaging] = useState(false);
  const messageDefaultTemplate =
    status === AppointmentStatus.REQUESTED
      ? 'BOOKING_REQUEST_RECEIVED'
      : status === AppointmentStatus.CANCELLED
        ? 'CANCELLATION_CONFIRMED'
        : 'REMINDER';

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
  const canMarkArrived = status ? ARRIVABLE_FROM_STATUSES.includes(status) : false;
  const moreItems = [
    canMarkArrived
      ? {
          key: 'mark-arrived',
          label: 'Mark arrived',
          disabled: !permCheckIn,
          title: permCheckIn
            ? 'Records that the patient is at the desk — registration and the queue happen at Register / Check in'
            : permissionHint('mark a patient as arrived'),
        }
      : null,
    appointment?.patient.phone ? { key: 'reminder', label: 'Record a manual reminder' } : null,
    onBookFollowUp ? { key: 'follow-up', label: 'Book a follow-up' } : null,
    appointment?.visitId ? { key: 'record', label: 'Open clinical record' } : null,
    { key: 'history', label: showHistory ? 'Show recent activity only' : 'Show full history' },
    canCheckIn || canCancel ? { type: 'divider' as const, key: 'd1' } : null,
    canCheckIn
      ? {
          key: 'no-show',
          danger: true,
          label: 'Mark as no-show',
          disabled: !permNoShow,
          title: permNoShow ? undefined : permissionHint('mark an appointment as a no-show'),
        }
      : null,
    canCancel
      ? {
          key: 'cancel',
          danger: true,
          label: 'Cancel appointment',
          disabled: !permCancel,
          title: permCancel ? undefined : permissionHint('cancel an appointment'),
        }
      : null,
  ].filter(Boolean) as { key: string; label: string }[];

  const onMore = async (key: string) => {
    if (!appointment) return;
    switch (key) {
      case 'mark-arrived':
        await run('Marked as arrived', () => markArrived.mutateAsync({ id: appointment.id }));
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
                  <Tooltip title={permEdit ? undefined : permissionHint('accept a booking request')}>
                    <Button
                      type="primary"
                      icon={<CheckCircleOutlined />}
                      loading={confirm.isPending}
                      disabled={!permEdit}
                      onClick={() =>
                        run('Request accepted', () => confirm.mutateAsync({ id: appointment.id }))
                      }
                    >
                      Accept request
                    </Button>
                  </Tooltip>
                  <Popconfirm
                    title="Decline this request?"
                    description="The patient's slot is released and they are not booked in."
                    okText="Decline"
                    disabled={!permEdit}
                    onConfirm={() =>
                      run('Request declined', () => reject.mutateAsync({ id: appointment.id }))
                    }
                  >
                    <Tooltip
                      title={permEdit ? undefined : permissionHint('decline a booking request')}
                    >
                      <Button disabled={!permEdit}>Decline</Button>
                    </Tooltip>
                  </Popconfirm>
                </>
              ) : null}
              {canCheckIn ? (
                <Tooltip title={permCheckIn ? undefined : permissionHint('check a patient in')}>
                  <Button
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    disabled={!permCheckIn}
                    onClick={() => setRegistering(true)}
                  >
                    Register / Check in
                  </Button>
                </Tooltip>
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
                <Tooltip
                  title={permReschedule ? undefined : permissionHint('move an appointment')}
                >
                  <Button
                    icon={<SwapOutlined />}
                    disabled={!permReschedule}
                    onClick={() => onReschedule(appointment.id)}
                  >
                    Reschedule
                  </Button>
                </Tooltip>
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
            {appointment.patient.phone ? (
              <Button size="small" icon={<WhatsAppOutlined />} onClick={() => setMessaging(true)}>
                WhatsApp patient
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

          {/* PHASE 7 — a patient request is the loudest thing after the
              queue: it is the one item on this booking waiting on a HUMAN. */}
          {pendingRequests.map((request) => {
            const permitted = request.type === 'RESCHEDULE' ? permReschedule : permCancel;
            const permWord =
              request.type === 'RESCHEDULE' ? 'move an appointment' : 'cancel an appointment';
            return (
              <Alert
                key={request.id}
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                data-testid="change-request-panel"
                message={
                  request.type === 'RESCHEDULE'
                    ? 'The patient asks to reschedule'
                    : 'The patient asks to cancel'
                }
                description={
                  <div>
                    {request.type === 'RESCHEDULE' && request.requestedStart ? (
                      <div>
                        {formatClinicDateTime(appointment.scheduledStart)} →{' '}
                        <Text strong>{formatClinicDateTime(request.requestedStart)}</Text>
                      </div>
                    ) : null}
                    <div>Reason: {request.reason}</div>
                    <Space style={{ marginTop: 8 }}>
                      <Tooltip title={permitted ? undefined : permissionHint(permWord)}>
                        <Button
                          size="small"
                          type="primary"
                          disabled={!permitted}
                          loading={decideRequest.isPending}
                          onClick={() =>
                            run(
                              request.type === 'RESCHEDULE'
                                ? 'Request approved — appointment moved'
                                : 'Request approved — appointment cancelled',
                              () => decideRequest.mutateAsync({ id: request.id, decision: 'approve' }),
                            )
                          }
                        >
                          Approve
                        </Button>
                      </Tooltip>
                      <Tooltip title={permitted ? undefined : permissionHint(permWord)}>
                        <Button
                          size="small"
                          disabled={!permitted}
                          onClick={() => {
                            setDeclineNote('');
                            setDecliningId(request.id);
                          }}
                        >
                          Decline…
                        </Button>
                      </Tooltip>
                    </Space>
                  </div>
                }
              />
            );
          })}

          <Modal
            open={Boolean(decliningId)}
            onCancel={() => setDecliningId(null)}
            title="Decline this request"
            okText="Decline request"
            confirmLoading={decideRequest.isPending}
            onOk={() =>
              decliningId &&
              run('Request declined', async () => {
                await decideRequest.mutateAsync({
                  id: decliningId,
                  decision: 'decline',
                  note: declineNote.trim() || undefined,
                });
                setDecliningId(null);
              })
            }
          >
            <Paragraph type="secondary" style={{ fontSize: 13 }}>
              The appointment stays exactly as booked. Your message reaches the patient on their
              manage-booking page — offer an alternative here if you have one.
            </Paragraph>
            <Input.TextArea
              rows={3}
              value={declineNote}
              onChange={(event) => setDeclineNote(event.target.value)}
              placeholder="e.g. We could do 15:30 the same day — ring us and we will hold it."
              maxLength={500}
            />
          </Modal>

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
            {/* Worded as what was OBSERVED: WhatsApp was opened with the
                message prefilled. A bare timestamp under "Reminder" read as
                "reminder sent", which a wa.me open cannot prove. When a real
                automated channel exists one day, IT may say Sent/Delivered —
                this row, fed by the manual action, never will. */}
            <Descriptions.Item label="Communication">
              {appointment.reminderSentAt ? (
                `WhatsApp opened · ${formatClinicDateTime(appointment.reminderSentAt)}`
              ) : (
                <Text type="secondary">—</Text>
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

          {/* PHASE 5E — the ACTIVITY is part of the record, not a hidden
              tab: booked, reminded, requested, approved — chronological, in
              plain words, with who. The last few are always visible; the
              full history is one menu press away. Technical codes never
              reach the screen (EVENT_WORDS, with a sentence-case fallback). */}
          <div className="kw-apt-section">Activity</div>
          <Timeline
            className="kw-apt-activity"
            items={(showHistory
              ? [...appointment.events].reverse()
              : [...appointment.events].slice(0, 5).reverse()
            ).map((event) => ({
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
          {!showHistory && appointment.events.length > 5 ? (
            <Button
              size="small"
              type="link"
              style={{ padding: 0 }}
              onClick={() => setShowHistory(true)}
            >
              Show all {appointment.events.length} entries
            </Button>
          ) : null}

          {/* Mounted only while open, so its data hooks (staff, panels) run
              only when the desk actually starts a registration. */}
          {registering ? (
            <CheckInRegistrationDrawer
              appointmentId={appointment.id}
              onClose={() => setRegistering(false)}
            />
          ) : null}

          {/* Same rule: the template fetch runs only when messaging starts. */}
          {messaging ? (
            <MessagePatientModal
              open
              onClose={() => setMessaging(false)}
              clinicId={appointment.clinicId}
              appointment={appointment}
              defaultTemplateKey={messageDefaultTemplate}
            />
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
