import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Radio,
  Result,
  Segmented,
  Skeleton,
  Space,
  Steps,
  Tag,
  Typography,
} from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
import { PublicBookingError, publicBooking, type PublicSlot } from './publicBookingApi';
import { setClinicTimeZone, formatClinicDate, formatClinicTime, clinicDayjs } from '../../clinical/clinicTime';

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

function daypart(start: string): 'Morning' | 'Afternoon' | 'Evening' {
  const hour = clinicDayjs(start).hour();
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

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
    return {
      Morning: slots.filter((entry) => daypart(entry.start) === 'Morning'),
      Afternoon: slots.filter((entry) => daypart(entry.start) === 'Afternoon'),
      Evening: slots.filter((entry) => daypart(entry.start) === 'Evening'),
      total: slots.length,
    };
  }, [availability]);

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

          {service?.preInstructions ? (
            <Alert
              type="info"
              style={{ marginTop: 16, textAlign: 'left' }}
              message="Before your appointment"
              description={service.preInstructions}
            />
          ) : null}
          <Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
            Keep the link above safe — it is how you change or cancel this appointment.
          </Paragraph>
        </div>
      </div>
    );
  }

  const submit = async () => {
    const details = await form.validateFields();
    const extra = fields?.length ? await answers.validateFields() : {};
    if (!slot || !serviceId) return;
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
          extra[field.id] === undefined || extra[field.id] === null
            ? undefined
            : Array.isArray(extra[field.id])
              ? extra[field.id].join(', ')
              : String(extra[field.id]),
      })),
    });
  };

  return (
    <div className="kw-public-booking" data-testid="public-booking">
      <header className="kw-public-hero">
        {page.clinic.logoUrl ? (
          <img src={page.clinic.logoUrl} alt="" className="kw-public-logo" />
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
        <Title level={3} className="kw-public-clinic-name">
          {page.clinic.displayName}
        </Title>
        {page.clinic.introText ? (
          <Text type="secondary" className="kw-public-intro">
            {page.clinic.introText}
          </Text>
        ) : null}
      </header>

      <Steps
        size="small"
        current={step}
        responsive
        items={[
          { title: 'Service' },
          { title: 'Doctor' },
          { title: 'Time' },
          { title: 'Your details' },
        ]}
        style={{ marginBottom: 16 }}
      />

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
          {page.services.length === 0 ? (
            <Alert
              type="info"
              message="Nothing is available to book online just now"
              description="Please ring the clinic."
            />
          ) : null}
          {page.services.map((row) => (
            <button
              key={row.id}
              type="button"
              className="kw-public-service"
              onClick={() => {
                setServiceId(row.id);
                setStep(1);
              }}
            >
              {row.photoUrl ? (
                <img src={row.photoUrl} alt="" className="kw-public-service-photo" />
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
          ))}
        </Space>
      ) : null}

      {step === 1 ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div className="kw-public-providers" role="radiogroup" aria-label="Choose a doctor">
            <button
              type="button"
              role="radio"
              aria-checked={!staffId}
              className={`kw-public-provider${!staffId ? ' kw-public-provider--on' : ''}`}
              onClick={() => setStaffId(undefined)}
            >
              <span className="kw-public-provider-avatar kw-public-provider-avatar--any" aria-hidden>
                ✦
              </span>
              <span className="kw-public-provider-body">
                <span className="kw-public-provider-name">Any available doctor</span>
                <span className="kw-public-provider-sub">Usually the soonest appointment</span>
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
          <Segmented
            block
            options={[0, 1, 2, 3, 4, 5, 6].map((offset) => {
              const day = dayjs().add(offset, 'day');
              return { value: offset, label: `${day.format('ddd')} ${day.format('D')}` };
            })}
            onChange={(value) => setDate(dayjs().add(Number(value), 'day'))}
          />
          <DatePicker
            value={date}
            onChange={(value) => value && setDate(value)}
            allowClear={false}
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

          {(['Morning', 'Afternoon', 'Evening'] as const).map((part) =>
            grouped[part].length > 0 ? (
              <div key={part}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {part}
                </Text>
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
          <Title level={5} style={{ margin: '4px 0 0' }}>
            Your details
          </Title>
          <Form form={form} layout="vertical" requiredMark={false}>
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
              <Title level={5} style={{ margin: '4px 0 0' }}>
                Appointment questions
              </Title>
              <Form form={answers} layout="vertical" requiredMark={false}>
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

          <Space>
            <Button onClick={() => setStep(2)}>Back</Button>
            <Button type="primary" loading={book.isPending} onClick={submit}>
              Confirm appointment
            </Button>
          </Space>
        </Space>
      ) : null}
    </div>
  );
}
