import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  ConfigProvider,
  Input,
  Modal,
  Result,
  Skeleton,
  Space,
  Typography,
  message,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { PublicBookingError, publicBooking, publicMediaSrc } from './publicBookingApi';
import {
  clinicDayjs,
  formatClinicDate,
  formatClinicDateTime,
  formatClinicTime,
  setClinicTimeZone,
} from '../../clinical/clinicTime';
import { AvailabilityCalendar } from './AvailabilityCalendar';
import { statusChip } from '../appointment-presentation';
import { KuwickStatusTag } from '../../design-system/kuwick';
import { publicBookingTheme } from '../appointment-theme';

const { Title, Text, Paragraph } = Typography;

/**
 * MANAGE MY BOOKING (§42).
 *
 * Reached by a token in the URL — 32 random bytes, one appointment. The page
 * shows only that appointment and only the details the patient already knows:
 * their own name, their time, their doctor, and the clinic's instructions.
 * There is no clinical record here and no way to reach another patient's, and
 * that is deliberate rather than incidental: this link travels by SMS and gets
 * forwarded.
 *
 * Rescheduling goes through the SAME availability engine the front desk uses,
 * and it ISSUES A NEW TOKEN — so a link somebody forwarded cannot be used to
 * move the appointment a second time.
 */
export function ManageBookingPage() {
  // Same visual language as the confirmation the patient came from.
  return (
    <ConfigProvider theme={publicBookingTheme}>
      <ManageBookingPageInner />
    </ConfigProvider>
  );
}

function ManageBookingPageInner() {
  // The SLUG is in the route and it is load-bearing: appointments are behind
  // row-level security, so the server cannot look a token up without a tenant
  // to scope by, and the slug is what resolves one. See the service.
  const { slug = '', token = '' } = useParams<{ slug: string; token: string }>();
  const queryClient = useQueryClient();
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState<Dayjs>(() => dayjs());
  const [newToken, setNewToken] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['manage-booking', slug, newToken ?? token],
    queryFn: () => publicBooking.manage(slug, newToken ?? token),
    retry: false,
  });

  useEffect(() => {
    if (data?.clinic.timeZone) setClinicTimeZone(data.clinic.timeZone);
  }, [data]);

  // Phase 7 — request-mode actions. The reason is the patient's case.
  const [requestingCancel, setRequestingCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const requestChange = useMutation({
    mutationFn: (body: {
      type: 'RESCHEDULE' | 'CANCELLATION';
      reason: string;
      scheduledStart?: string;
      scheduledEnd?: string;
    }) => publicBooking.requestChange(slug, newToken ?? token, body),
    onSuccess: () => {
      message.success('Your request has been sent to the clinic.');
      setRequestingCancel(false);
      setCancelReason('');
      setRescheduling(false);
      queryClient.invalidateQueries({ queryKey: ['manage-booking'] });
    },
    onError: (failure) =>
      message.error(
        failure instanceof PublicBookingError ? failure.message : 'That request could not be sent.',
      ),
  });

  const cancel = useMutation({
    mutationFn: () => publicBooking.cancelByToken(slug, newToken ?? token),
    onSuccess: () => {
      message.success('Your appointment has been cancelled.');
      queryClient.invalidateQueries({ queryKey: ['manage-booking'] });
    },
    onError: (failure) =>
      message.error(
        failure instanceof PublicBookingError ? failure.message : 'That could not be cancelled.',
      ),
  });

  if (isLoading) {
    return (
      <div className="kw-public-booking">
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="kw-public-booking">
        <Result
          status="404"
          title="This link is not valid"
          subTitle="It may have expired, or the appointment may already have been changed. Please ring the clinic."
        />
      </div>
    );
  }

  const { appointment, can } = data;
  const policy = data.policy;
  const pending = data.pendingRequests ?? [];
  const cutoffWords = describeCutoffMinutes(policy?.cutoffMinutes ?? data.cutoffHours * 60);

  return (
    <div className="kw-public-booking" data-testid="manage-booking">
      <header className="kw-public-hero">
        {data.clinic.logoUrl ? (
          <img src={publicMediaSrc(data.clinic.logoUrl) ?? undefined} alt="" className="kw-public-logo" />
        ) : (
          <span className="kw-public-mark" aria-hidden>
            {data.clinic.displayName
              .split(/\s+/)
              .slice(0, 2)
              .map((word) => word[0] ?? '')
              .join('')
              .toUpperCase()}
          </span>
        )}
        <Title level={4} style={{ margin: 0 }}>
          {data.clinic.displayName}
        </Title>
      </header>

      <div style={{ marginBottom: 8 }}>
        <KuwickStatusTag {...statusChip(appointment.status)} />
      </div>
      <div className="kw-public-done-card" style={{ maxWidth: 'none' }}>
        <div className="kw-public-done-when">
          <div className="kw-public-done-date">
            {formatClinicDate(appointment.scheduledStart)}
          </div>
          <div className="kw-public-done-time">
            {formatClinicTime(appointment.scheduledStart)} –{' '}
            {formatClinicTime(appointment.scheduledEnd)}
          </div>
        </div>
        <div className="kw-public-done-lines">
          <Text strong>{appointment.serviceName}</Text>
          <Text>{appointment.providerName}</Text>
          <Text type="secondary">For {appointment.patientName}</Text>
        </div>
      </div>

      {appointment.preInstructions ? (
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="Before you come"
          description={appointment.preInstructions}
        />
      ) : null}

      {Number(appointment.bookingFeeAmount) > 0 ? (
        <Alert
          style={{ marginTop: 12 }}
          type={appointment.paymentStatus === 'PAID' ? 'success' : 'warning'}
          showIcon
          message={
            appointment.paymentStatus === 'PAID'
              ? `Deposit of RM ${Number(appointment.bookingFeeAmount).toFixed(2)} received`
              : `A deposit of RM ${Number(appointment.bookingFeeAmount).toFixed(2)} is payable`
          }
        />
      ) : null}

      {/* Phase 7 — where a request stands. The clinic answers; this shows it. */}
      {pending.map((row) => (
        <Alert
          key={row.id}
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          data-testid="pending-request"
          message={
            row.type === 'CANCELLATION'
              ? 'Your cancellation request is with the clinic'
              : 'Your reschedule request is with the clinic'
          }
          description={
            <>
              {row.type === 'RESCHEDULE' && row.requestedStart ? (
                <div>
                  Requested: {formatClinicDate(row.requestedStart)} ·{' '}
                  {formatClinicTime(row.requestedStart)}
                </div>
              ) : null}
              <div>Your reason: {row.reason}</div>
              <div>Your appointment stays as booked until the clinic decides.</div>
            </>
          }
        />
      ))}
      {data.lastDecision && pending.length === 0 ? (
        <Alert
          style={{ marginTop: 12 }}
          type={data.lastDecision.status === 'APPROVED' ? 'success' : 'warning'}
          showIcon
          message={
            data.lastDecision.status === 'APPROVED'
              ? `The clinic approved your ${data.lastDecision.type === 'CANCELLATION' ? 'cancellation' : 'reschedule'} request`
              : `The clinic could not ${data.lastDecision.type === 'CANCELLATION' ? 'cancel this appointment' : 'make that change'}`
          }
          description={data.lastDecision.decisionNote ?? undefined}
        />
      ) : null}

      {policy?.changeable &&
      (policy.reschedule === 'REQUEST_APPROVAL' || policy.cancel === 'REQUEST_APPROVAL') ? (
        <>
          <Space style={{ marginTop: 16 }} wrap>
            {policy.reschedule === 'REQUEST_APPROVAL' ? (
              <Button type="primary" onClick={() => setRescheduling(true)}>
                Request a new time
              </Button>
            ) : null}
            {policy.cancel === 'REQUEST_APPROVAL' ? (
              <Button danger onClick={() => setRequestingCancel(true)}>
                Request cancellation
              </Button>
            ) : null}
          </Space>
          <Paragraph type="secondary" style={{ margin: '10px 0 0', fontSize: 12.5 }}>
            {data.clinic.displayName} reviews changes before they happen. Requests close{' '}
            {cutoffWords} before your appointment.
          </Paragraph>
        </>
      ) : null}

      {can.reschedule || can.cancel ? (
        <>
          <Space style={{ marginTop: 16 }} wrap>
            {can.reschedule ? (
              <Button type="primary" onClick={() => setRescheduling(true)}>
                Change the time
              </Button>
            ) : null}
            {can.cancel ? (
              <Button
                danger
                loading={cancel.isPending}
                onClick={() =>
                  Modal.confirm({
                    title: 'Cancel this appointment?',
                    content: 'The clinic will be told, and your slot is released to somebody else.',
                    okText: 'Cancel appointment',
                    okButtonProps: { danger: true },
                    cancelText: 'Keep it',
                    onOk: () => cancel.mutateAsync(),
                  })
                }
              >
                Cancel
              </Button>
            ) : null}
          </Space>
          {/* The policy, stated while it still helps — not only after it has
              already shut the door. */}
          <Paragraph type="secondary" style={{ margin: '10px 0 0', fontSize: 12.5 }}>
            Online changes close {data.cutoffHours} hour{data.cutoffHours === 1 ? '' : 's'} before
            your appointment; after that, ring {data.clinic.displayName}.
          </Paragraph>
        </>
      ) : policy?.changeable &&
        (policy.reschedule === 'REQUEST_APPROVAL' || policy.cancel === 'REQUEST_APPROVAL') ? null : (
        // §27 — no dead buttons: when nothing can be changed the page SAYS
        // why in the patient's words, which is more useful than two grey
        // controls that refuse to explain themselves.
        <Paragraph type="secondary" style={{ marginTop: 16, fontSize: 13 }}>
          {appointment.status === 'CANCELLED'
            ? 'This appointment has been cancelled. Ring the clinic if you would like to book again.'
            : appointment.status === 'COMPLETED'
              ? 'This appointment has already taken place.'
              : `Online changes close ${cutoffWords} before the appointment. Please ring the clinic and they will help.`}
        </Paragraph>
      )}

      {/* Phase 7 — the cancellation REQUEST, reason required. */}
      <Modal
        open={requestingCancel}
        onCancel={() => setRequestingCancel(false)}
        title="Request cancellation"
        okText="Send request"
        okButtonProps={{ danger: true, disabled: cancelReason.trim().length < 3 }}
        confirmLoading={requestChange.isPending}
        onOk={() => requestChange.mutate({ type: 'CANCELLATION', reason: cancelReason.trim() })}
        destroyOnHidden
      >
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          Your appointment stays booked until {data.clinic.displayName} confirms the cancellation.
        </Paragraph>
        <Input.TextArea
          rows={3}
          value={cancelReason}
          onChange={(event) => setCancelReason(event.target.value)}
          placeholder="Tell the clinic why (required)"
          maxLength={500}
        />
      </Modal>

      {/* V3.1 §4 — the rest of what THIS booking already carries, in the
          confirmation's own section language. Nothing invented: the clinic's
          configured message, the patient's own words and answers, and the
          after-visit instructions once the visit has happened. */}
      {data.confirmationMessage ? (
        <div className="kw-public-after">
          <div className="kw-public-section">From the clinic</div>
          <div className="kw-public-instructions">{data.confirmationMessage}</div>
        </div>
      ) : null}

      {appointment.note ? (
        <div className="kw-public-after">
          <div className="kw-public-section">Your message to the clinic</div>
          <Paragraph style={{ margin: 0, fontSize: 13 }}>{appointment.note}</Paragraph>
        </div>
      ) : null}

      {appointment.answers.length > 0 ? (
        <div className="kw-public-after">
          <div className="kw-public-section">Your answers</div>
          <div className="kw-public-instructions">
            {appointment.answers.map((entry) => (
              <div key={entry.label} style={{ display: 'flex', gap: 8 }}>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {entry.label}:
                </Text>
                <Text style={{ fontSize: 13 }}>{entry.answer ?? '—'}</Text>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {appointment.status === 'COMPLETED' && appointment.postInstructions ? (
        <div className="kw-public-after">
          <div className="kw-public-section">After your appointment</div>
          <div className="kw-public-instructions">{appointment.postInstructions}</div>
        </div>
      ) : null}

      <div className="kw-public-after">
        <div className="kw-public-section">Need help?</div>
        <Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
          This page is yours alone — keep the link safe. For anything it cannot do, ring{' '}
          {data.clinic.displayName}.
        </Paragraph>
      </div>

      <RescheduleModal
        open={rescheduling}
        slug={slug}
        token={newToken ?? token}
        mode={policy?.reschedule === 'REQUEST_APPROVAL' ? 'request' : 'instant'}
        onRequest={(body) => requestChange.mutate({ type: 'RESCHEDULE', ...body })}
        requesting={requestChange.isPending}
        onClose={() => setRescheduling(false)}
        onMoved={(issued) => {
          setNewToken(issued);
          setRescheduling(false);
          message.success('Your appointment has been moved.');
        }}
        date={date}
        setDate={setDate}
        currentDate={
          appointment?.scheduledStart
            ? clinicDayjs(appointment.scheduledStart).format('YYYY-MM-DD')
            : undefined
        }
      />
    </div>
  );
}

function RescheduleModal({
  open,
  slug,
  token,
  mode = 'instant',
  onRequest,
  requesting = false,
  onClose,
  onMoved,
  date,
  setDate,
  currentDate,
}: {
  open: boolean;
  slug: string;
  token: string;
  /** Phase 7 — 'request' collects a reason and sends a request; nothing moves. */
  mode?: 'instant' | 'request';
  onRequest?: (body: { scheduledStart: string; scheduledEnd: string; reason: string }) => void;
  requesting?: boolean;
  onClose: () => void;
  onMoved: (token: string) => void;
  date: Dayjs;
  setDate: (value: Dayjs) => void;
  /** The appointment's CURRENT clinic-date, marked on the calendar. */
  currentDate?: string;
}) {
  const [slot, setSlot] = useState<{ scheduledStart: string; scheduledEnd: string } | null>(null);
  const [reason, setReason] = useState('');
  const [month, setMonth] = useState(() => dayjs().format('YYYY-MM'));
  // A date is "chosen" only once the patient taps one — opening the modal on
  // today's month with today preselected invited booking the wrong day.
  const [dateChosen, setDateChosen] = useState(false);

  /**
   * THE SAME ENGINE. The times offered here are the clinic's own slot grid,
   * asked for through the token — not a list of round hours this page invented.
   * A page that guesses produces a patient pressing a time the server then
   * refuses, which is the failure the whole "one path" rule exists to prevent.
   */
  const { data: availability, isFetching } = useQuery({
    queryKey: ['manage-availability', slug, token, date.format('YYYY-MM-DD')],
    queryFn: () => publicBooking.availabilityForToken(slug, token, date.format('YYYY-MM-DD')),
    enabled: open && dateChosen,
  });

  // Final-UAT — the same colour-coded month the booking flow uses, through
  // the token (same doctor, same service, this appointment excluded from its
  // own way).
  const { data: monthData, isFetching: loadingMonth } = useQuery({
    queryKey: ['manage-month', slug, token, month],
    queryFn: () => publicBooking.monthAvailabilityForToken(slug, token, month),
    enabled: open,
    placeholderData: (previous) => previous,
  });

  const move = useMutation({
    mutationFn: (body: { scheduledStart: string; scheduledEnd: string }) =>
      publicBooking.rescheduleByToken(slug, token, body),
    onSuccess: (result) => onMoved(result.manageToken),
    onError: (failure) =>
      message.error(
        failure instanceof PublicBookingError
          ? failure.message
          : 'That time could not be taken. Please pick another.',
      ),
  });

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={mode === 'request' ? 'Request a new time' : 'Choose a new time'}
      okText={mode === 'request' ? 'Send request' : 'Move my appointment'}
      okButtonProps={{
        disabled: !slot || (mode === 'request' && reason.trim().length < 3),
      }}
      confirmLoading={mode === 'request' ? requesting : move.isPending}
      onOk={() => {
        if (!slot) return;
        if (mode === 'request') {
          onRequest?.({ ...slot, reason: reason.trim() });
        } else {
          move.mutate(slot);
        }
      }}
      destroyOnHidden
    >
      <Paragraph type="secondary" style={{ fontSize: 13 }}>
        {mode === 'request'
          ? 'Pick the time you would prefer and tell the clinic why. Your appointment stays as booked until they confirm.'
          : 'Pick a date and a time. Your appointment keeps the same doctor and the same service.'}
      </Paragraph>
      <AvailabilityCalendar
        month={month}
        onMonthChange={setMonth}
        data={monthData}
        loading={loadingMonth}
        selectedDate={dateChosen ? date.format('YYYY-MM-DD') : null}
        markedDate={currentDate ?? null}
        onSelectDate={(dateKey) => {
          setDate(dayjs(dateKey));
          setDateChosen(true);
          setSlot(null);
        }}
      />

      {dateChosen && isFetching ? (
        <Skeleton active paragraph={{ rows: 2 }} style={{ marginTop: 12 }} />
      ) : null}

      {dateChosen && !isFetching && (availability?.slots.length ?? 0) === 0 ? (
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="Nothing free that day"
          description="Please pick another date, or ring the clinic."
        />
      ) : null}

      {dateChosen ? (
        <div className="kw-public-slots" style={{ marginTop: 12 }}>
          {(availability?.slots ?? []).map((entry) => (
            <Button
              key={entry.start}
              type={slot?.scheduledStart === entry.start ? 'primary' : 'default'}
              onClick={() => setSlot({ scheduledStart: entry.start, scheduledEnd: entry.end })}
            >
              {formatClinicTime(entry.start)}
            </Button>
          ))}
        </div>
      ) : null}

      {mode === 'request' ? (
        <Input.TextArea
          style={{ marginTop: 12 }}
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Tell the clinic why (required)"
          maxLength={500}
        />
      ) : null}
    </Modal>
  );
}

/** "4 hours" / "90 minutes" / "2 days" — the cutoff in the patient's units. */
function describeCutoffMinutes(minutes: number): string {
  if (minutes % (24 * 60) === 0 && minutes > 0) {
    const days = minutes / (24 * 60);
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (minutes % 60 === 0 && minutes > 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minutes`;
}
