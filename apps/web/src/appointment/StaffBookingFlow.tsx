import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Collapse,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Segmented,
  Select,
  Space,
  Spin,
  Typography,
  message,
} from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { apiClient, ApiError } from '../core/api-client';
import { usePatient, usePatients, usePatientSearch } from '../core/hooks/usePatients';
import { clinicDayjs, formatClinicDate, formatClinicTime } from '../clinical/clinicTime';
import { useCreateAppointment } from './hooks/useAppointments';
import { useAppointmentServices } from './hooks/useServiceConfig';

const { Text } = Typography;

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

const DAYPARTS = ['Morning', 'Afternoon', 'Evening', 'Late night'] as const;
type Daypart = (typeof DAYPARTS)[number];

/**
 * WHICH PART OF THE DAY A SLOT FALLS IN.
 *
 * A list of thirty times is a list nobody scans. Morning / Afternoon /
 * Evening / Late night is how a receptionist and a patient both already
 * think, and it makes the common request — "anything after four?" —
 * answerable at a glance. Late night exists because the clinic does (§39):
 * a 24-hour roster produces 23:00 slots, and calling those "Evening" buries
 * them under twenty earlier chips.
 */
function daypartOf(start: string): Daypart {
  const hour = clinicDayjs(start).hour();
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  if (hour < 22) return 'Evening';
  return 'Late night';
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
 * NEW APPOINTMENT — a progressive five-step flow (§22).
 *
 *   1 Patient → 2 Service → 3 Doctor → 4 Date & time → 5 Review
 *
 * Each step appears when the one before it is answered, so the drawer is
 * never a wall of empty controls — and never a giant empty drawer either:
 * the first thing on screen is one search box and the patients most
 * recently seen. Only times the SERVER says are free are ever offered —
 * the slot grid comes from the availability engine, so a slot on this
 * screen is a slot the booking will be allowed to take.
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
  // "Recent patients" — the people most likely to be on the phone right now.
  const { data: recentPatients } = usePatients();
  const { data: selectedPatient } = usePatient(patientId);
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
      // "Any available doctor" asks the engine once per eligible provider,
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
      parts: Object.fromEntries(
        DAYPARTS.map((part) => [part, all.filter((entry) => daypartOf(entry.start) === part)]),
      ) as Record<Daypart, { start: string; end: string; staffId: string }[]>,
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

  // The compact progress line (§22) — the first unanswered question. The
  // doctor step defaults to "Any available", which IS an answer, so once a
  // service is chosen the open question is the time.
  const step = !patientId ? 1 : !serviceId ? 2 : !slot ? 4 : 5;
  const STEP_WORDS: Record<number, string> = {
    1: 'Who is it for?',
    2: 'What are they coming in for?',
    4: 'Pick a day and a time',
    5: 'Check it and book',
  };

  const patientInitials = (name: string) =>
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? '')
      .join('')
      .toUpperCase();

  const money = (value: string) => `RM ${Number(value).toFixed(2)}`;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      destroyOnHidden
      title={
        <div className="kw-flow-title">
          <span>New appointment</span>
          <span className="kw-flow-progress">
            Step {step} of 5 · {STEP_WORDS[step]}
          </span>
        </div>
      }
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
        {/* -------- 1 · PATIENT ------------------------------------------ */}
        <div className="kw-flow-step">1 · Patient</div>
        {selectedPatient ? (
          // The chosen patient as a CARD, not a value lost inside a select:
          // name, IC and phone stay in view for the rest of the booking.
          <div className="kw-flow-patient" data-testid="flow-patient-card">
            <Avatar size={36} className="kw-apt-avatar">
              {patientInitials(selectedPatient.name)}
            </Avatar>
            <div className="kw-flow-patient-text">
              <div className="kw-flow-patient-name">{selectedPatient.name}</div>
              <div className="kw-flow-patient-meta">
                {selectedPatient.identifierValue}
                {selectedPatient.phone ? ` · ${selectedPatient.phone}` : ''}
              </div>
            </div>
            <Button size="small" onClick={() => setPatientId(undefined)}>
              Change
            </Button>
          </div>
        ) : (
          <>
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
            {(recentPatients?.length ?? 0) > 0 ? (
              <div className="kw-flow-recent">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Recent patients
                </Text>
                <div className="kw-flow-recent-row">
                  {(recentPatients ?? []).slice(0, 5).map((patient) => (
                    <Button key={patient.id} size="small" onClick={() => setPatientId(patient.id)}>
                      {patient.name}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}

        {/* -------- 2 · SERVICE ------------------------------------------- */}
        {patientId ? (
          <>
            <div className="kw-flow-step">2 · Service</div>
            {(services?.length ?? 0) === 0 ? (
              <Empty description="No service is set up for booking yet. Add one under Services." />
            ) : (
              <div className="kw-flow-services">
                {(services ?? []).map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={
                      'kw-flow-service' + (serviceId === row.id ? ' kw-flow-service--on' : '')
                    }
                    onClick={() => setServiceId(row.id)}
                  >
                    <span className="kw-flow-service-name">{row.name}</span>
                    <span className="kw-flow-service-meta">
                      {row.durationMinutesDefault} min
                      {row.priceDisplay !== 'HIDDEN' && Number(row.price) > 0
                        ? ` · ${row.priceDisplay === 'FROM' ? 'from ' : ''}${money(row.price)}`
                        : ''}
                      {row.bookingPaymentRule === 'DEPOSIT' && Number(row.depositAmount) > 0
                        ? ` · ${money(row.depositAmount)} deposit`
                        : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : null}

        {/* -------- 3 · DOCTOR -------------------------------------------- */}
        {patientId && serviceId ? (
          <>
            <div className="kw-flow-step">3 · Doctor</div>
            {eligibleProviders.length === 0 ? (
              <Alert
                type="warning"
                showIcon
                message="No provider is set up for this service"
                description="Add one under Services ▸ Providers before it can be booked."
              />
            ) : (
              <div className="kw-flow-providers">
                <button
                  type="button"
                  className={'kw-flow-provider' + (staffId === 'ANY' ? ' kw-flow-provider--on' : '')}
                  onClick={() => setStaffId('ANY')}
                >
                  <span className="kw-flow-provider-name">
                    <ThunderboltOutlined aria-hidden /> Any available doctor
                  </span>
                  <span className="kw-flow-provider-meta">Fastest appointment</span>
                </button>
                {eligibleProviders.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    className={
                      'kw-flow-provider' + (staffId === provider.id ? ' kw-flow-provider--on' : '')
                    }
                    onClick={() => setStaffId(provider.id)}
                  >
                    <span className="kw-flow-provider-name">{provider.fullName}</span>
                  </button>
                ))}
              </div>
            )}

            {/* -------- 4 · DATE & TIME ----------------------------------- */}
            <div className="kw-flow-step">4 · Date &amp; time</div>
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

            <div style={{ marginTop: 10 }}>
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
              {DAYPARTS.map((part) =>
                grouped.parts[part].length > 0 ? (
                  <div key={part} style={{ marginBottom: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {part}
                    </Text>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                      {grouped.parts[part].map((entry) => (
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
            </div>
          </>
        ) : null}

        {/* -------- 5 · REVIEW -------------------------------------------- */}
        {ready && slot ? (
          <>
            <div className="kw-flow-step">5 · Review</div>
            <div className="kw-flow-review" data-testid="flow-review">
              <div className="kw-flow-review-when">
                <div className="kw-flow-review-date">{formatClinicDate(slot.start)}</div>
                <div className="kw-flow-review-time">
                  {formatClinicTime(slot.start)} – {formatClinicTime(slot.end)}
                </div>
              </div>
              <div className="kw-flow-review-lines">
                <Text strong>{service?.name}</Text>
                <Text>{providerName(slot.staffId) || 'Provider'}</Text>
                <Text type="secondary">For {selectedPatient?.name}</Text>
                {service && Number(service.depositAmount) > 0 && service.bookingPaymentRule === 'DEPOSIT' ? (
                  <Text type="secondary">Deposit {money(service.depositAmount)}</Text>
                ) : null}
              </div>
            </div>

            <Input.TextArea
              style={{ marginTop: 10 }}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Reason or note — seen by staff only."
            />

            <Collapse
              ghost
              style={{ marginTop: 8 }}
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
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
