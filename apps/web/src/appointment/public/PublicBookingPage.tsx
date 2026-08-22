import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  ConfigProvider,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Radio,
  Result,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
import { PublicBookingError, publicBooking, publicMediaSrc, type PublicSlot } from './publicBookingApi';
import { setClinicTimeZone, formatClinicDate, formatClinicTime, clinicDayjs } from '../../clinical/clinicTime';
import { publicBookingTheme } from '../appointment-theme';

const { Title, Text, Paragraph } = Typography;

const REASON_WORDS: Record<string, string> = {
  CLINIC_CLOSED: 'The clinic is closed that day.',
  PUBLIC_HOLIDAY: 'The clinic is closed for the public holiday.',
  ON_LEAVE: 'That doctor is away that day.',
  PROVIDER_BLOCKED: 'That doctor is not available that day.',
  NOT_ROSTERED: 'Nobody is available for this that day.',
  OUTSIDE_SERVICE_HOURS: 'This is not offered at that time of day.',
  OUTSIDE_BOOKING_WINDOW: 'That is outside the clinic’s booking hours.',
  TOO_LATE_TO_BOOK: 'That is too soon — please pick a later day.',
  TOO_FAR_AHEAD: 'That is further ahead than this clinic takes bookings.',
  FULLY_BOOKED: 'Everything is taken that day.',
  SERVICE_NOT_BOOKABLE: 'That is not available to book online.',
  NOT_QUALIFIED: 'That doctor does not offer this.',
};

const DAYPARTS = ['Morning', 'Afternoon', 'Evening', 'Late night'] as const;
type Daypart = (typeof DAYPARTS)[number];

// §39 — Late night exists because the clinic does: a 24-hour roster offers
// 23:00, and calling that "Evening" buries it under twenty earlier chips.
function daypart(start: string): Daypart {
  const hour = clinicDayjs(start).hour();
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  if (hour < 22) return 'Evening';
  return 'Late night';
}

/** "Today · 8:30 PM" / "Tomorrow · 9:00 AM" — the next-available hint (§36–37). */
function hintLabel(dayOffset: number, start: string): string {
  return `${dayOffset === 0 ? 'Today' : 'Tomorrow'} · ${formatClinicTime(start)}`;
}

const STEP_TITLES = [
  'Choose a service',
  'Choose a doctor',
  'Pick a time',
  'Your details',
  'Review & confirm',
];

/**
 * PUBLIC BOOKING — mobile first, and no account required (§31).
 *
 * Six steps in the order a patient thinks in: what, who, when, who am I, the
 * clinic's questions, done. There is deliberately no sign-up: asking somebody
 * to create an account before they can book an appointment is the single most
 * effective way to make them ring instead.
 *
 * EVERY TIME COMES FROM THE SERVER. The slot list is the availability engine's
 * answer — the same one the front desk sees — so a time offered here is a time
 * the booking will be allowed to take. When a day offers nothing, the page says
 * WHY in the patient's words rather than showing an empty list.
 */
export function PublicBookingPage() {
  // The patient product wears its own theme — teal primary, 44px touch
  // targets — without touching the staff console's.
  return (
    <ConfigProvider theme={publicBookingTheme}>
      <PublicBookingPageInner />
    </ConfigProvider>
  );
}

function PublicBookingPageInner() {
  const { slug = '', serviceSlug } = useParams<{ slug: string; serviceSlug?: string }>();
  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState<string>();
  const [staffId, setStaffId] = useState<string>();
  const [date, setDate] = useState<Dayjs>(() => dayjs());
  const [slot, setSlot] = useState<PublicSlot | null>(null);
  const [form] = Form.useForm();
  const [answers] = Form.useForm();
  const [idempotencyKey] = useState(
    () => `public-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  // Phase 6B — the service DETAIL sheet: more than the card, without making
  // the card itself any harder to tap.
  const [detailServiceId, setDetailServiceId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    status: string;
    scheduledStart: string;
    scheduledEnd: string;
    manageUrl: string;
    message: string;
  } | null>(null);
  // §24 — when a day is empty the page goes LOOKING instead of shrugging:
  // scan forward day by day (same engine, same endpoint) until something is
  // free or a fortnight is exhausted. State keyed by what was scanned so a
  // stale probe never labels a different service's day.
  const [nextFree, setNextFree] = useState<{
    key: string;
    date: string;
    slotCount: number;
  } | null>(null);
  const [probing, setProbing] = useState(false);
  // §36–37 — "Today · 8:30 PM" on the doctor tiles. Keyed 'ANY' for the
  // any-doctor tile, staffId for each person; asked of the SAME engine, today
  // then tomorrow, and simply absent when neither day has anything.
  const [hints, setHints] = useState<{ key: string; byId: Record<string, string> }>({
    key: '',
    byId: {},
  });
  // §42 — the review step holds the validated answers, so Back re-fills the
  // form and Confirm books exactly what was reviewed.
  const [details, setDetails] = useState<Record<string, string> | null>(null);
  const [extraAnswers, setExtraAnswers] = useState<Record<string, unknown>>({});
  const daysStripRef = useRef<HTMLDivElement>(null);

  // V3.1.1 — THE STRIP FOLLOWS THE SELECTION. A date picked anywhere (chip,
  // calendar picker, "next free day") centres its own chip in the strip, so
  // the strip can never sit on "Today" while Wednesday is what is being
  // booked. Horizontal only, scrolled on the strip itself — never
  // scrollIntoView, which would also drag the page vertically.
  useEffect(() => {
    if (step !== 2) return;
    const strip = daysStripRef.current;
    if (!strip) return;
    const chip = strip.querySelector<HTMLElement>(`[data-date="${date.format('YYYY-MM-DD')}"]`);
    if (!chip) return;
    const target = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [date, step]);

  const { data: page, isLoading, error } = useQuery({
    queryKey: ['public-page', slug, serviceSlug],
    queryFn: () => publicBooking.page(slug, serviceSlug),
    retry: false,
  });

  // The whole page renders in the CLINIC's clock, not the phone's. A patient
  // in Singapore booking a Malaysian clinic must see the hours the clinic
  // keeps, and an hour's difference is a missed appointment.
  useEffect(() => {
    if (page?.clinic.timeZone) setClinicTimeZone(page.clinic.timeZone);
  }, [page]);

  useEffect(() => {
    if (page?.selectedServiceId) {
      setServiceId(page.selectedServiceId);
      setStep(1);
    }
  }, [page]);

  const service = page?.services.find((row) => row.id === serviceId);

  const { data: providers } = useQuery({
    queryKey: ['public-providers', slug, serviceId],
    queryFn: () => publicBooking.providers(slug, serviceId!),
    enabled: Boolean(serviceId),
  });

  const { data: availability, isFetching: loadingSlots } = useQuery({
    queryKey: ['public-availability', slug, serviceId, staffId, date.format('YYYY-MM-DD')],
    queryFn: () =>
      publicBooking.availability(slug, {
        serviceId: serviceId!,
        date: date.format('YYYY-MM-DD'),
        staffId,
      }),
    enabled: Boolean(serviceId) && step >= 2,
  });

  const { data: fields } = useQuery({
    queryKey: ['public-fields', slug, serviceId],
    queryFn: () => publicBooking.formFields(slug, serviceId!),
    enabled: Boolean(serviceId) && step >= 3,
  });

  const book = useMutation({
    mutationFn: (body: Record<string, unknown>) => publicBooking.book(slug, body),
    onSuccess: (result) => setConfirmation(result),
  });

  const grouped = useMemo(() => {
    const slots = availability?.slots ?? [];
    const parts = Object.fromEntries(
      DAYPARTS.map((part) => [part, slots.filter((entry) => daypart(entry.start) === part)]),
    ) as Record<Daypart, PublicSlot[]>;
    return { ...parts, total: slots.length };
  }, [availability]);

  // The next-available hints for the doctor step. Sequential and shallow on
  // purpose: at most two days per tile, stopped the moment the step is left.
  useEffect(() => {
    if (step !== 1 || !serviceId || !providers) return;
    const key = `${serviceId}:${providers.map((row) => row.id).join(',')}`;
    if (hints.key === key) return;
    let cancelled = false;
    (async () => {
      const byId: Record<string, string> = {};
      const targets: { id: string; staffId?: string }[] = [
        { id: 'ANY', staffId: undefined },
        ...providers.map((row) => ({ id: row.id, staffId: row.id })),
      ];
      for (const target of targets) {
        for (let ahead = 0; ahead <= 1; ahead += 1) {
          try {
            const answer = await publicBooking.availability(slug, {
              serviceId,
              date: dayjs().add(ahead, 'day').format('YYYY-MM-DD'),
              staffId: target.staffId,
            });
            if (cancelled) return;
            if (answer.slots.length > 0) {
              byId[target.id] = hintLabel(ahead, answer.slots[0].start);
              break;
            }
          } catch {
            break;
          }
        }
      }
      if (!cancelled) setHints({ key, byId });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, serviceId, providers, slug]);

  const probeKey = `${serviceId ?? ''}:${staffId ?? 'ANY'}:${date.format('YYYY-MM-DD')}`;
  useEffect(() => {
    if (!serviceId || step !== 2) return;
    if (loadingSlots || !availability || (availability.slots?.length ?? 0) > 0) return;
    let cancelled = false;
    setProbing(true);
    setNextFree(null);
    (async () => {
      for (let ahead = 1; ahead <= 14; ahead += 1) {
        const day = date.add(ahead, 'day');
        try {
          const answer = await publicBooking.availability(slug, {
            serviceId,
            date: day.format('YYYY-MM-DD'),
            staffId,
          });
          if (cancelled) return;
          if (answer.slots.length > 0) {
            setNextFree({
              key: probeKey,
              date: day.format('YYYY-MM-DD'),
              slotCount: answer.slots.length,
            });
            setProbing(false);
            return;
          }
        } catch {
          break;
        }
      }
      if (!cancelled) setProbing(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeKey, step, loadingSlots, availability, slug]);

  if (isLoading) {
    return (
      <div className="kw-public-booking">
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }

  if (error || !page) {
    return (
      <div className="kw-public-booking">
        <Result
          status="404"
          title="This booking page is not available"
          subTitle="Check the link, or ring the clinic to book."
        />
      </div>
    );
  }

  if (confirmation) {
    const requested = confirmation.status === 'REQUESTED';
    const providerName = slot
      ? providers?.find((row) => row.id === slot.staffId)?.fullName
      : undefined;
    // Add to calendar: an .ics built from the confirmed facts and nothing
    // else — instants straight from the server, no third party involved.
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Kuwick//Booking//EN',
      'BEGIN:VEVENT',
      `UID:${confirmation.manageUrl.split('/').pop()}@kuwick`,
      `DTSTART:${dayjs(confirmation.scheduledStart).utc().format('YYYYMMDD[T]HHmmss[Z]')}`,
      `DTEND:${dayjs(confirmation.scheduledEnd).utc().format('YYYYMMDD[T]HHmmss[Z]')}`,
      `SUMMARY:${(service?.name ?? 'Appointment').replace(/[,;]/g, ' ')} — ${page.clinic.displayName.replace(/[,;]/g, ' ')}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    return (
      <div className="kw-public-booking">
        <div className="kw-public-done" data-testid="public-confirmation">
          <div className={`kw-public-done-badge${requested ? ' kw-public-done-badge--wait' : ''}`}>
            {requested ? '…' : '✓'}
          </div>
          <Title level={4} style={{ margin: '8px 0 0' }}>
            {requested ? 'Your request has been sent' : 'Appointment confirmed'}
          </Title>
          <Text type="secondary">{confirmation.message}</Text>

          <div className="kw-public-done-card">
            <div className="kw-public-done-when">
              <div className="kw-public-done-date">
                {formatClinicDate(confirmation.scheduledStart)}
              </div>
              <div className="kw-public-done-time">
                {formatClinicTime(confirmation.scheduledStart)} –{' '}
                {formatClinicTime(confirmation.scheduledEnd)}
              </div>
            </div>
            <div className="kw-public-done-lines">
              <Text strong>{service?.name}</Text>
              {providerName ? <Text>{providerName}</Text> : null}
              <Text type="secondary">{page.clinic.displayName}</Text>
            </div>
          </div>

          <Space wrap className="kw-public-done-actions">
            <Button type="primary" href={confirmation.manageUrl}>
              Manage my appointment
            </Button>
            <Button
              href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`}
              download="appointment.ics"
            >
              Add to calendar
            </Button>
          </Space>

          {/* §43 — labelled sections, and ONLY when there is something true
              to put in them. No invented addresses, no placeholder phone. */}
          {service?.preInstructions ? (
            <div className="kw-public-after">
              <div className="kw-public-section">Before your appointment</div>
              <div className="kw-public-instructions">{service.preInstructions}</div>
            </div>
          ) : null}
          <div className="kw-public-after">
            <div className="kw-public-section">Need help?</div>
            <Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
              Use <Text strong>Manage my appointment</Text> above to change or cancel — keep that
              link safe, it is yours alone. For anything else, ring {page.clinic.displayName}.
            </Paragraph>
          </div>
        </div>
      </div>
    );
  }

  // §42 — details are VALIDATED on the way into the review step and booked
  // from what was reviewed, never from a form the patient can no longer see.
  const toReview = async () => {
    const values = await form.validateFields();
    const extra = fields?.length ? await answers.validateFields() : {};
    setDetails(values);
    setExtraAnswers(extra);
    setStep(4);
  };

  const submit = async () => {
    if (!slot || !serviceId || !details) return;
    await book.mutateAsync({
      serviceId,
      staffId: slot.staffId,
      scheduledStart: slot.start,
      scheduledEnd: slot.end,
      name: details.name,
      phone: details.phone,
      email: details.email,
      identifier: details.identifier,
      reason: details.reason,
      idempotencyKey,
      answers: (fields ?? []).map((field) => ({
        fieldId: field.id,
        answer:
          extraAnswers[field.id] === undefined || extraAnswers[field.id] === null
            ? undefined
            : Array.isArray(extraAnswers[field.id])
              ? (extraAnswers[field.id] as unknown[]).join(', ')
              : String(extraAnswers[field.id]),
      })),
    });
  };

  return (
    <div className="kw-public-booking" data-testid="public-booking">
      <header className="kw-public-hero">
        {page.clinic.logoUrl ? (
          <img src={publicMediaSrc(page.clinic.logoUrl) ?? undefined} alt="" className="kw-public-logo" />
        ) : (
          <span className="kw-public-mark" aria-hidden>
            {page.clinic.displayName
              .split(/\s+/)
              .slice(0, 2)
              .map((word) => word[0] ?? '')
              .join('')
              .toUpperCase()}
          </span>
        )}
        <div className="kw-public-hero-text">
          <Title level={4} className="kw-public-clinic-name">
            {page.clinic.displayName}
          </Title>
          {page.clinic.introText ? (
            <Text type="secondary" className="kw-public-intro">
              {page.clinic.introText}
            </Text>
          ) : null}
        </div>
      </header>

      {/* §35 — one quiet line and a sliver of progress, not a stepper that
          owns half a phone screen. */}
      <div className="kw-public-progress" data-testid="public-progress">
        <span className="kw-public-progress-text">
          <small>Step {step + 1} of 5 · </small>
          {STEP_TITLES[step]}
        </span>
        <div className="kw-public-progress-bar" aria-hidden>
          <span style={{ width: `${((step + 1) / 5) * 100}%` }} />
        </div>
      </div>

      {book.isError ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            book.error instanceof PublicBookingError
              ? book.error.message
              : 'That booking could not be made. Please try another time.'
          }
        />
      ) : null}

      {step === 0 ? (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Title level={5} className="kw-public-step-title" style={{ margin: 0 }}>
            What would you like to book?
          </Title>
          {page.services.length === 0 ? (
            <Alert
              type="info"
              message="Nothing is available to book online just now"
              description="Please ring the clinic."
            />
          ) : null}
          {page.services.map((row) => (
            <div key={row.id} className="kw-public-service-wrap">
              {row.description || row.preInstructions || row.photoUrl ? (
                <button
                  type="button"
                  className="kw-public-service-info"
                  aria-label={`About ${row.name}`}
                  onClick={() => setDetailServiceId(row.id)}
                >
                  i
                </button>
              ) : null}
            <button
              type="button"
              className="kw-public-service"
              onClick={() => {
                setServiceId(row.id);
                setStep(1);
              }}
            >
              {row.photoUrl ? (
                <img src={publicMediaSrc(row.photoUrl) ?? undefined} alt="" className="kw-public-service-photo" loading="lazy" />
              ) : null}
              <span className="kw-public-service-body">
                <span className="kw-public-service-name">{row.name}</span>
                {row.description ? (
                  <span className="kw-public-service-desc">{row.description}</span>
                ) : null}
                <span className="kw-public-service-chips">
                  <Tag>{row.durationMinutes} min</Tag>
                  {row.requiresApproval ? <Tag color="orange">Confirmed by the clinic</Tag> : null}
                  {row.paymentRule === 'DEPOSIT' ? (
                    <Tag color="blue">RM {Number(row.depositAmount).toFixed(0)} deposit</Tag>
                  ) : null}
                </span>
              </span>
              <span className="kw-public-service-side">
                {row.price ? (
                  <span className="kw-public-service-price">
                    {row.price.display === 'FROM' ? 'from ' : ''}RM{' '}
                    {Number(row.price.amount).toFixed(2)}
                  </span>
                ) : null}
                <span className="kw-public-service-go" aria-hidden>
                  →
                </span>
              </span>
            </button>
            </div>
          ))}
        </Space>
      ) : null}

      {step === 1 ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Title level={5} className="kw-public-step-title" style={{ margin: 0 }}>
            Choose a doctor
          </Title>
          <div className="kw-public-providers" role="radiogroup" aria-label="Choose a doctor">
            <button
              type="button"
              role="radio"
              aria-checked={!staffId}
              className={`kw-public-provider${!staffId ? ' kw-public-provider--on' : ''}`}
              onClick={() => setStaffId(undefined)}
            >
              <span className="kw-public-provider-avatar kw-public-provider-avatar--any" aria-hidden>
                ⚡
              </span>
              <span className="kw-public-provider-body">
                <span className="kw-public-provider-name">Any available doctor</span>
                <span className="kw-public-provider-sub">
                  Fastest appointment
                  {hints.byId.ANY ? ` · ${hints.byId.ANY}` : ''}
                </span>
              </span>
            </button>
            {(providers ?? []).map((provider) => (
              <button
                key={provider.id}
                type="button"
                role="radio"
                aria-checked={staffId === provider.id}
                className={`kw-public-provider${staffId === provider.id ? ' kw-public-provider--on' : ''}`}
                onClick={() => setStaffId(provider.id)}
              >
                <span className="kw-public-provider-avatar" aria-hidden>
                  {provider.fullName
                    .replace(/^Dr\.?\s+/i, '')
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((word) => word[0] ?? '')
                    .join('')
                    .toUpperCase()}
                </span>
                <span className="kw-public-provider-body">
                  <span className="kw-public-provider-name">{provider.fullName}</span>
                  {provider.professionalType === 'MEDICAL_DOCTOR' || hints.byId[provider.id] ? (
                    <span className="kw-public-provider-sub">
                      {provider.professionalType === 'MEDICAL_DOCTOR' ? 'Doctor' : null}
                      {provider.professionalType === 'MEDICAL_DOCTOR' && hints.byId[provider.id]
                        ? ' · '
                        : null}
                      {hints.byId[provider.id] ? `Next available · ${hints.byId[provider.id]}` : null}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
          <Space>
            <Button onClick={() => setStep(0)}>Back</Button>
            <Button type="primary" onClick={() => setStep(2)}>
              Continue
            </Button>
          </Space>
        </Space>
      ) : null}

      {step === 2 ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div className="kw-public-context">
            <Text strong>{service?.name}</Text>
            <Text type="secondary">
              {staffId
                ? providers?.find((row) => row.id === staffId)?.fullName ?? 'Your doctor'
                : 'Any available doctor'}
              {' · '}
              {date.format('dddd, D MMM')}
            </Text>
          </div>
          {/* §38 — date CHIPS that keep their words: "Wed 26" is never
              squeezed into "W…". The fortnight scrolls sideways with snap
              stops, and the wrapper's end-fade says so (V3.1 §1) — a chip at
              the edge is a signposted "more this way", never an accident. */}
          <div className="kw-public-days-wrap">
            <div className="kw-public-days" role="group" aria-label="Pick a day" ref={daysStripRef}>
              {Array.from({ length: 14 }, (_, offset) => {
                const day = dayjs().add(offset, 'day');
                const on = date.isSame(day, 'day');
                return (
                  <button
                    key={offset}
                    type="button"
                    data-date={day.format('YYYY-MM-DD')}
                    className={`kw-public-day${on ? ' kw-public-day--on' : ''}`}
                    aria-pressed={on}
                    onClick={() => setDate(day)}
                  >
                    <span className="kw-public-day-dow">
                      {offset === 0 ? 'Today' : day.format('ddd')}
                    </span>
                    <span className="kw-public-day-num">{day.format('D MMM')}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {/* Patients read "Wed, 26 Aug 2026", never raw ISO — the array keeps
              typed ISO parseable (and the wire format is untouched). */}
          <DatePicker
            value={date}
            onChange={(value) => value && setDate(value)}
            allowClear={false}
            format={['ddd, D MMM YYYY', 'YYYY-MM-DD', 'D MMM YYYY']}
            style={{ width: '100%' }}
            disabledDate={(value) => value.isBefore(dayjs().startOf('day'))}
          />

          {loadingSlots ? <Skeleton active paragraph={{ rows: 3 }} /> : null}
          {!loadingSlots && grouped.total === 0 ? (
            <div className="kw-public-empty">
              <Text strong>No appointments on {date.format('D MMM')}</Text>
              <Text type="secondary">
                {REASON_WORDS[availability?.reason ?? ''] ?? 'Please try another day.'}
              </Text>
              {probing ? (
                <Text type="secondary">Looking for the next free day…</Text>
              ) : nextFree && nextFree.key === probeKey ? (
                <>
                  <Text>
                    Next available:{' '}
                    <Text strong>{dayjs(nextFree.date).format('ddd, D MMM')}</Text>
                    {` · ${nextFree.slotCount} time${nextFree.slotCount === 1 ? '' : 's'} free`}
                  </Text>
                  <Space wrap>
                    <Button type="primary" onClick={() => setDate(dayjs(nextFree.date))}>
                      See next available
                    </Button>
                    {staffId ? (
                      <Button onClick={() => setStaffId(undefined)}>
                        See any available doctor
                      </Button>
                    ) : null}
                  </Space>
                </>
              ) : (
                <Space wrap>
                  {staffId ? (
                    <Button onClick={() => setStaffId(undefined)}>See any available doctor</Button>
                  ) : null}
                  <Button onClick={() => setDate(date.add(1, 'day'))}>Try the next day</Button>
                </Space>
              )}
            </div>
          ) : null}

          {DAYPARTS.map((part) =>
            grouped[part].length > 0 ? (
              <div key={part}>
                <span className="kw-public-daypart">{part}</span>
                <div className="kw-public-slots">
                  {grouped[part].map((entry) => (
                    <Button
                      key={entry.start}
                      type={slot?.start === entry.start ? 'primary' : 'default'}
                      onClick={() => {
                        setSlot(entry);
                        setStep(3);
                      }}
                    >
                      {formatClinicTime(entry.start)}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null,
          )}

          <Button onClick={() => setStep(1)}>Back</Button>
        </Space>
      ) : null}

      {step === 3 ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="success"
            message={`${formatClinicDate(slot?.start ?? '')} at ${formatClinicTime(slot?.start ?? '')}`}
            description={service?.name}
          />
          <Title level={5} className="kw-public-step-title" style={{ margin: '4px 0 0' }}>
            Your details
          </Title>
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            initialValues={details ?? undefined}
          >
            <Form.Item
              name="name"
              label="Your full name"
              rules={[{ required: true, message: 'Please tell us your name.' }]}
            >
              <Input autoComplete="name" />
            </Form.Item>
            <Form.Item
              name="phone"
              label="Mobile number"
              rules={[
                { required: page.form.requirePhone, message: 'The clinic needs a number to reach you.' },
              ]}
            >
              <Input inputMode="tel" autoComplete="tel" placeholder="01X-XXX XXXX" />
            </Form.Item>
            {page.form.requireEmail ? (
              <Form.Item
                name="email"
                label="Email"
                rules={[{ required: true, type: 'email', message: 'A valid email, please.' }]}
              >
                <Input inputMode="email" autoComplete="email" />
              </Form.Item>
            ) : null}
            <Form.Item
              name="identifier"
              label="IC or passport number"
              rules={[{ required: page.form.requireNric, message: 'The clinic needs this.' }]}
              extra="This helps the clinic find your existing record."
            >
              <Input />
            </Form.Item>
            {page.form.showReasonField ? (
              <Form.Item name="reason" label="What would you like to be seen about?">
                <Input.TextArea rows={3} />
              </Form.Item>
            ) : null}
          </Form>

          {fields?.length ? (
            <>
              <Title level={5} className="kw-public-step-title" style={{ margin: '4px 0 0' }}>
                Appointment questions
              </Title>
              <Form
                form={answers}
                layout="vertical"
                requiredMark={false}
                initialValues={extraAnswers}
              >
                {fields.map((field) => (
                  <Form.Item
                    key={field.id}
                    name={field.id}
                    label={field.label}
                    extra={field.helpText ?? undefined}
                    rules={[{ required: field.required, message: 'Please answer this.' }]}
                    valuePropName={field.fieldType === 'YES_NO' ? 'checked' : 'value'}
                  >
                    {field.fieldType === 'LONG_TEXT' ? (
                      <Input.TextArea rows={3} />
                    ) : field.fieldType === 'YES_NO' ? (
                      <Checkbox>Yes</Checkbox>
                    ) : field.fieldType === 'NUMBER' ? (
                      <InputNumber style={{ width: '100%' }} />
                    ) : field.fieldType === 'DATE' ? (
                      <DatePicker style={{ width: '100%' }} />
                    ) : field.fieldType === 'SINGLE_CHOICE' ? (
                      <Radio.Group options={field.options} />
                    ) : field.fieldType === 'MULTI_CHOICE' ? (
                      <Checkbox.Group options={field.options} />
                    ) : (
                      <Input />
                    )}
                  </Form.Item>
                ))}
              </Form>
            </>
          ) : null}

          <Space>
            <Button onClick={() => setStep(2)}>Back</Button>
            <Button type="primary" onClick={toReview}>
              Review booking
            </Button>
          </Space>
        </Space>
      ) : null}

      {/* §42 — the review step: everything the patient is about to commit
          to, on one card, before anything is sent. */}
      {step === 4 && slot ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }} data-testid="public-review">
          <Title level={5} className="kw-public-step-title" style={{ margin: 0 }}>
            Check your booking
          </Title>
          <div className="kw-public-done-card" style={{ maxWidth: 'none' }}>
            <div className="kw-public-done-when">
              <div className="kw-public-done-date">{formatClinicDate(slot.start)}</div>
              <div className="kw-public-done-time">
                {formatClinicTime(slot.start)} – {formatClinicTime(slot.end)}
              </div>
            </div>
            <div className="kw-public-done-lines">
              <Text strong>{service?.name}</Text>
              <Text>
                {providers?.find((row) => row.id === slot.staffId)?.fullName ?? 'Your doctor'}
              </Text>
              <Text type="secondary">{page.clinic.displayName}</Text>
              <Text type="secondary">For {details?.name}</Text>
              {details?.phone ? <Text type="secondary">{details.phone}</Text> : null}
            </div>
          </div>

          {service && service.paymentRule !== 'NONE' ? (
            <Alert
              type="warning"
              showIcon
              message={
                service.paymentRule === 'DEPOSIT'
                  ? `A deposit of RM ${Number(service.depositAmount).toFixed(2)} is payable`
                  : 'Full payment is taken for this service'
              }
              description="The clinic will take this when you arrive."
            />
          ) : null}

          {service?.requiresApproval ? (
            <Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
              The clinic confirms this booking personally — you will hear back once it is
              accepted.
            </Paragraph>
          ) : null}

          <Space className="kw-public-cta">
            <Button onClick={() => setStep(3)}>Back</Button>
            <Button type="primary" loading={book.isPending} onClick={submit}>
              Confirm appointment
            </Button>
          </Space>

          {/* V3.1 §2 — the page finishes with the clinic's own words, never
              invented filler: the service's configured instructions, and
              where the manage link will come from. */}
          {service?.preInstructions ? (
            <div className="kw-public-after">
              <div className="kw-public-section">Before your appointment</div>
              <div className="kw-public-instructions">{service.preInstructions}</div>
            </div>
          ) : null}
          <div className="kw-public-after">
            <div className="kw-public-section">What happens next</div>
            <Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
              {service?.requiresApproval
                ? `${page.clinic.displayName} will confirm your request, and your booking page link for changes will be on the confirmation.`
                : 'Your confirmation appears immediately, with a private link to change or cancel the booking.'}
            </Paragraph>
          </div>
        </Space>
      ) : null}
      {/* Phase 6B — the service DETAIL sheet: the larger image, the whole
          description and the preparation notes, with its own Book CTA. A
          bottom sheet on the phone it is designed for. */}
      <Drawer
        open={Boolean(detailServiceId)}
        onClose={() => setDetailServiceId(null)}
        placement="bottom"
        height="auto"
        rootClassName="kw-public-detail"
        title={null}
        closable
        destroyOnHidden
      >
        {(() => {
          const row = page.services.find((item) => item.id === detailServiceId);
          if (!row) return null;
          const photo = publicMediaSrc(row.photoUrl);
          return (
            <div data-testid="public-service-detail">
              {photo ? <img src={photo} alt="" className="kw-public-detail-photo" /> : null}
              <Title level={4} style={{ margin: '10px 0 4px' }}>
                {row.name}
              </Title>
              <Space size={6} wrap style={{ marginBottom: 8 }}>
                <Tag>{row.durationMinutes} min</Tag>
                {row.price ? (
                  <Tag color="green">
                    {row.price.display === 'FROM' ? 'from ' : ''}RM {Number(row.price.amount).toFixed(2)}
                  </Tag>
                ) : null}
                {row.paymentRule === 'DEPOSIT' ? (
                  <Tag color="blue">RM {Number(row.depositAmount).toFixed(0)} deposit</Tag>
                ) : null}
                {row.requiresApproval ? <Tag color="orange">Confirmed by the clinic</Tag> : null}
              </Space>
              {row.description ? (
                <Paragraph style={{ marginBottom: 10 }}>{row.description}</Paragraph>
              ) : null}
              {row.preInstructions ? (
                <>
                  <div className="kw-public-section">Before you come</div>
                  <div className="kw-public-instructions">{row.preInstructions}</div>
                </>
              ) : null}
              <Button
                type="primary"
                block
                size="large"
                style={{ marginTop: 14 }}
                onClick={() => {
                  setServiceId(row.id);
                  setDetailServiceId(null);
                  setStep(1);
                }}
              >
                Book this service
              </Button>
            </div>
          );
        })()}
      </Drawer>
    </div>
  );
}