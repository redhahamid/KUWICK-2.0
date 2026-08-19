import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Collapse,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Radio,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { apiClient, ApiError } from '../core/api-client';
import { usePatientSearch } from '../core/hooks/usePatients';
import { clinicDayjs, formatClinicDate, formatClinicTime } from '../clinical/clinicTime';
import { useCreateAppointment } from './hooks/useAppointments';
import { useAppointmentServices } from './hooks/useServiceConfig';

const { Text, Title } = Typography;

interface AvailabilityAnswer {
  staffId: string;
  slots: { start: string; end: string }[];
  reason: string | null;
}

/** The refusals, as the front desk should read them. Same words as the server. */
const REASON_WORDS: Record<string, string> = {
  CLINIC_CLOSED: 'The clinic is closed that day.',
  PUBLIC_HOLIDAY: 'That is a public holiday and this branch is closed.',
  SERVICE_NOT_BOOKABLE: 'That service is not set up for booking.',
  ON_LEAVE: 'That doctor is on approved leave.',
  PROVIDER_BLOCKED: 'That doctor is not available that day.',
  NOT_ROSTERED: 'Nobody is rostered for this service that day.',
  NOT_QUALIFIED: 'That doctor is not set up to perform this service.',
  OUTSIDE_SERVICE_HOURS: 'This service is not offered at that time of day.',
  OUTSIDE_BOOKING_WINDOW: "That is outside the clinic's booking hours.",
  TOO_LATE_TO_BOOK: 'That is sooner than the clinic takes bookings.',
  TOO_FAR_AHEAD: 'That is further ahead than the clinic takes bookings.',
  FULLY_BOOKED: 'There is no room left that day.',
};

/**
 * WHICH PART OF THE DAY A SLOT FALLS IN.
 *
 * A list of thirty times is a list nobody scans. Morning / Afternoon / Evening
 * is how a receptionist and a patient both already think, and it makes the
 * common request — "anything after four?" — answerable at a glance.
 */
function daypartOf(start: string): 'Morning' | 'Afternoon' | 'Evening' {
  const hour = clinicDayjs(start).hour();
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

interface StaffBookingFlowProps {
  open: boolean;
  clinicId?: string;
  onClose: () => void;
  /** Pre-filled when the flow was opened by clicking an empty calendar slot. */
  prefill?: { staffId?: string; start?: Dayjs } | null;
  onBooked?: (appointmentId: string) => void;
}

/**
 * NEW APPOINTMENT — in the order a person asks the questions (§15).
 *
 *   Patient → Service → Provider → Date → Time → Reason → Advanced
 *
 * The old form asked for a clinic, a staff id, a service id, a start instant
 * and an end instant, all at once, and left the person to work out which
 * combinations existed. This asks one thing at a time and only ever offers
 * times the SERVER says are free — the slot grid comes from the availability
 * engine, so a slot on this screen is a slot the booking will be allowed to
 * take.
 *
 * Clicking an empty slot on the calendar prefills the provider, the date and
 * the time, so the only questions left are the patient and the service.
 */
export function StaffBookingFlow({
  open,
  clinicId,
  onClose,
  prefill,
  onBooked,
}: StaffBookingFlowProps) {
  const [patientSearch, setPatientSearch] = useState('');
  const [patientId, setPatientId] = useState<string>();
  const [serviceId, setServiceId] = useState<string>();
  const [staffId, setStaffId] = useState<string | 'ANY'>('ANY');
  const [date, setDate] = useState<Dayjs>(() => prefill?.start ?? clinicDayjs(new Date()));
  const [slot, setSlot] = useState<{ start: string; end: string; staffId: string } | null>(null);
  const [note, setNote] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [idempotencyKey] = useState(() => `staff-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const { data: patients, isFetching: searching } = usePatientSearch(patientSearch);
  const { data: services } = useAppointmentServices({ bookableOnly: true });
  const create = useCreateAppointment();

  const service = services?.find((row) => row.id === serviceId);
  const eligibleProviders = service?.providers ?? [];

  useEffect(() => {
    if (prefill?.staffId) setStaffId(prefill.staffId);
    if (prefill?.start) setDate(prefill.start);
  }, [prefill]);

  // Reset the chosen time whenever anything upstream of it changes — a slot
  // picked for Tuesday must not survive a change to Wednesday.
  useEffect(() => {
    setSlot(null);
  }, [serviceId, staffId, date]);

  const dateKey = date.format('YYYY-MM-DD');
  const availabilityEnabled = Boolean(clinicId && serviceId);

  const { data: availability, isFetching: loadingSlots } = useQuery({
    queryKey: ['availability', 'staff-flow', clinicId, serviceId, staffId, dateKey],
    enabled: availabilityEnabled,
    queryFn: async (): Promise<AvailabilityAnswer[]> => {
      if (staffId !== 'ANY') {
        const slots = await apiClient.get<{ start: string; end: string }[]>(
          `/availability?clinicId=${clinicId}&serviceId=${serviceId}&staffId=${staffId}&date=${dateKey}`,
        );
        return [{ staffId, slots, reason: slots.length ? null : 'FULLY_BOOKED' }];
      }
      // "Any available provider" asks the engine once per eligible provider,
      // exactly as the server does — and keeps the real provider on each slot.
      const answers = await Promise.all(
        eligibleProviders.map(async (provider) => {
          const slots = await apiClient.get<{ start: string; end: string }[]>(
            `/availability?clinicId=${clinicId}&serviceId=${serviceId}&staffId=${provider.id}&date=${dateKey}`,
          );
          return { staffId: provider.id, slots, reason: null };
        }),
      );
      return answers;
    },
  });

  const grouped = useMemo(() => {
    const byStart = new Map<string, { start: string; end: string; staffId: string }>();
    for (const answer of availability ?? []) {
      for (const entry of answer.slots) {
        if (!byStart.has(entry.start)) {
          byStart.set(entry.start, { ...entry, staffId: answer.staffId });
        }
      }
    }
    const all = [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start));
    return {
      Morning: all.filter((entry) => daypartOf(entry.start) === 'Morning'),
      Afternoon: all.filter((entry) => daypartOf(entry.start) === 'Afternoon'),
      Evening: all.filter((entry) => daypartOf(entry.start) === 'Evening'),
      total: all.length,
    };
  }, [availability]);

  const providerName = (id: string) =>
    eligibleProviders.find((provider) => provider.id === id)?.fullName ?? '';

  const submit = async (override: boolean) => {
    if (!clinicId || !patientId || !serviceId || !slot) return;
    try {
      const appointment = await create.mutateAsync({
        clinicId,
        patientId,
        staffId: slot.staffId,
        serviceId,
        source: 'FRONT_DESK',
        scheduledStart: slot.start,
        scheduledEnd: slot.end,
        notes: note.trim() || undefined,
        idempotencyKey,
        ...(override ? { override: true, overrideReason: overrideReason.trim() } : {}),
      });
      message.success('Appointment booked');
      onBooked?.(appointment.id);
      reset();
      onClose();
    } catch (error) {
      message.error(
        error instanceof ApiError ? error.message : 'The appointment could not be booked.',
      );
    }
  };

  const reset = () => {
    setPatientSearch('');
    setPatientId(undefined);
    setServiceId(undefined);
    setStaffId('ANY');
    setSlot(null);
    setNote('');
    setOverrideReason('');
  };

  const ready = Boolean(patientId && serviceId && slot);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      destroyOnHidden
      title="New appointment"
      footer={
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="primary"
            disabled={!ready}
            loading={create.isPending}
            onClick={() => submit(Boolean(overrideReason.trim()))}
          >
            Book appointment
          </Button>
        </Space>
      }
    >
      <div data-testid="staff-booking-flow">
        <Title level={5} style={{ marginTop: 0 }}>
          1. Patient
        </Title>
        <Select
          showSearch
          allowClear
          style={{ width: '100%' }}
          placeholder="Search by name, IC or phone"
          filterOption={false}
          value={patientId}
          onSearch={setPatientSearch}
          onChange={setPatientId}
          notFoundContent={searching ? <Spin size="small" /> : <Empty description="No match" />}
          options={(patients ?? []).map((patient) => ({
            value: patient.id,
            label: `${patient.name} · ${patient.identifierValue}${patient.phone ? ` · ${patient.phone}` : ''}`,
          }))}
        />

        <Title level={5}>2. Service</Title>
        <Select
          style={{ width: '100%' }}
          placeholder="Which service?"
          value={serviceId}
          onChange={setServiceId}
          options={(services ?? []).map((row) => ({
            value: row.id,
            label: `${row.name} · ${row.durationMinutesDefault} min`,
          }))}
          notFoundContent={
            <Empty description="No service is set up for booking yet. Add one under Services." />
          }
        />

        {serviceId ? (
          <>
            <Title level={5}>3. Provider</Title>
            <Radio.Group
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
              optionType="button"
              buttonStyle="solid"
              style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
            >
              <Radio.Button value="ANY">Any available</Radio.Button>
              {eligibleProviders.map((provider) => (
                <Radio.Button key={provider.id} value={provider.id}>
                  {provider.fullName}
                </Radio.Button>
              ))}
            </Radio.Group>
            {eligibleProviders.length === 0 ? (
              <Alert
                style={{ marginTop: 8 }}
                type="warning"
                showIcon
                message="No provider is set up for this service"
                description="Add one under Services ▸ Providers before it can be booked."
              />
            ) : null}

            <Title level={5}>4. Date</Title>
            <Space wrap>
              <DatePicker
                value={date}
                onChange={(value) => value && setDate(value)}
                allowClear={false}
                format="ddd D MMM YYYY"
              />
              <Segmented
                options={[
                  { label: 'Today', value: 0 },
                  { label: 'Tomorrow', value: 1 },
                  { label: 'Next week', value: 7 },
                ]}
                onChange={(value) => setDate(clinicDayjs(new Date()).add(Number(value), 'day'))}
              />
            </Space>

            <Title level={5}>5. Available time</Title>
            {loadingSlots ? <Spin /> : null}
            {!loadingSlots && grouped.total === 0 ? (
              <Alert
                type="info"
                showIcon
                message="Nothing free that day"
                description={
                  REASON_WORDS[availability?.find((answer) => answer.reason)?.reason ?? ''] ??
                  'Try another date, or another provider.'
                }
              />
            ) : null}
            {(['Morning', 'Afternoon', 'Evening'] as const).map((part) =>
              grouped[part].length > 0 ? (
                <div key={part} style={{ marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {part}
                  </Text>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                    {grouped[part].map((entry) => (
                      <Button
                        key={entry.start}
                        size="small"
                        type={slot?.start === entry.start ? 'primary' : 'default'}
                        onClick={() => setSlot(entry)}
                      >
                        {formatClinicTime(entry.start)}
                        {staffId === 'ANY' && providerName(entry.staffId) ? (
                          <Text
                            type={slot?.start === entry.start ? undefined : 'secondary'}
                            style={{ fontSize: 11, marginLeft: 6 }}
                          >
                            {providerName(entry.staffId).replace(/^Dr\.?\s*/i, '')}
                          </Text>
                        ) : null}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null,
            )}

            <Title level={5}>6. Reason or note</Title>
            <Input.TextArea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What is this appointment for? Seen by staff only."
            />

            <Collapse
              ghost
              style={{ marginTop: 12 }}
              items={[
                {
                  key: 'advanced',
                  label: 'Advanced',
                  children: (
                    <>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Booking against the clinic's own scheduling rules — a full diary, less
                        notice than usual. It needs a reason, and it is recorded with your name. It
                        can never override approved leave, a closed branch, or a provider who is
                        not set up for the service.
                      </Text>
                      <Input
                        style={{ marginTop: 8 }}
                        value={overrideReason}
                        onChange={(event) => setOverrideReason(event.target.value)}
                        placeholder="Why is this booking being made anyway?"
                      />
                    </>
                  ),
                },
              ]}
            />

            {slot ? (
              <Alert
                style={{ marginTop: 16 }}
                type="success"
                showIcon
                message={`${formatClinicDate(slot.start)} · ${formatClinicTime(slot.start)}–${formatClinicTime(slot.end)}`}
                description={
                  <Space size={4} wrap>
                    <Tag>{service?.name}</Tag>
                    <Tag>{providerName(slot.staffId) || 'Provider'}</Tag>
                  </Space>
                }
              />
            ) : null}
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
