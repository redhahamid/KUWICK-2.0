import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Modal,
  Result,
  Skeleton,
  Space,
  Typography,
  message,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { PublicBookingError, publicBooking } from './publicBookingApi';
import {
  formatClinicDate,
  formatClinicDateTime,
  formatClinicTime,
  setClinicTimeZone,
} from '../../clinical/clinicTime';
import { statusChip } from '../appointment-presentation';
import { KuwickStatusTag } from '../../design-system/kuwick';

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
  const { token = '' } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState<Dayjs>(() => dayjs());
  const [newToken, setNewToken] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['manage-booking', newToken ?? token],
    queryFn: () => publicBooking.manage(newToken ?? token),
    retry: false,
  });

  useEffect(() => {
    if (data?.clinic.timeZone) setClinicTimeZone(data.clinic.timeZone);
  }, [data]);

  const cancel = useMutation({
    mutationFn: () => publicBooking.cancelByToken(newToken ?? token),
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

  return (
    <div className="kw-public-booking" data-testid="manage-booking">
      <header className="kw-public-header">
        {data.clinic.logoUrl ? (
          <img src={data.clinic.logoUrl} alt="" className="kw-public-logo" />
        ) : null}
        <Title level={4} style={{ margin: 0 }}>
          {data.clinic.displayName}
        </Title>
      </header>

      <Card>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <KuwickStatusTag {...statusChip(appointment.status)} />
          <Title level={5} style={{ margin: 0 }}>
            {formatClinicDate(appointment.scheduledStart)}
          </Title>
          <Text style={{ fontSize: 18 }}>
            {formatClinicTime(appointment.scheduledStart)} –{' '}
            {formatClinicTime(appointment.scheduledEnd)}
          </Text>
          <Descriptions column={1} size="small" colon={false}>
            <Descriptions.Item label="Service">{appointment.serviceName}</Descriptions.Item>
            <Descriptions.Item label="With">{appointment.providerName}</Descriptions.Item>
            <Descriptions.Item label="For">{appointment.patientName}</Descriptions.Item>
          </Descriptions>
        </Space>
      </Card>

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

      <Space style={{ marginTop: 16 }} wrap>
        <Button
          type="primary"
          disabled={!can.reschedule}
          onClick={() => setRescheduling(true)}
        >
          Change the time
        </Button>
        <Button
          danger
          disabled={!can.cancel}
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
      </Space>

      {!can.reschedule && !can.cancel ? (
        <Paragraph type="secondary" style={{ marginTop: 12, fontSize: 13 }}>
          Changes have to be made at least {data.cutoffHours} hours before your appointment. Please
          ring the clinic.
        </Paragraph>
      ) : null}

      <RescheduleModal
        open={rescheduling}
        token={newToken ?? token}
        onClose={() => setRescheduling(false)}
        onMoved={(issued) => {
          setNewToken(issued);
          setRescheduling(false);
          message.success('Your appointment has been moved.');
        }}
        date={date}
        setDate={setDate}
      />
    </div>
  );
}

function RescheduleModal({
  open,
  token,
  onClose,
  onMoved,
  date,
  setDate,
}: {
  open: boolean;
  token: string;
  onClose: () => void;
  onMoved: (token: string) => void;
  date: Dayjs;
  setDate: (value: Dayjs) => void;
}) {
  const [slot, setSlot] = useState<{ scheduledStart: string; scheduledEnd: string } | null>(null);

  /**
   * THE SAME ENGINE. The times offered here are the clinic's own slot grid,
   * asked for through the token — not a list of round hours this page invented.
   * A page that guesses produces a patient pressing a time the server then
   * refuses, which is the failure the whole "one path" rule exists to prevent.
   */
  const { data: availability, isFetching } = useQuery({
    queryKey: ['manage-availability', token, date.format('YYYY-MM-DD')],
    queryFn: () => publicBooking.availabilityForToken(token, date.format('YYYY-MM-DD')),
    enabled: open,
  });

  const move = useMutation({
    mutationFn: (body: { scheduledStart: string; scheduledEnd: string }) =>
      publicBooking.rescheduleByToken(token, body),
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
      title="Choose a new time"
      okText="Move my appointment"
      okButtonProps={{ disabled: !slot }}
      confirmLoading={move.isPending}
      onOk={() => slot && move.mutate(slot)}
      destroyOnHidden
    >
      <Paragraph type="secondary" style={{ fontSize: 13 }}>
        Pick a date and a time. Your appointment keeps the same doctor and the same service.
      </Paragraph>
      <DatePicker
        value={date}
        onChange={(value) => {
          if (!value) return;
          setDate(value);
          setSlot(null);
        }}
        allowClear={false}
        style={{ width: '100%' }}
        disabledDate={(value) => value.isBefore(dayjs().startOf('day'))}
      />

      {isFetching ? <Skeleton active paragraph={{ rows: 2 }} style={{ marginTop: 12 }} /> : null}

      {!isFetching && (availability?.slots.length ?? 0) === 0 ? (
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="Nothing free that day"
          description="Please try another day, or ring the clinic."
        />
      ) : null}

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
    </Modal>
  );
}
