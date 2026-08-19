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
    manageUrl: string;
    message: string;
  } | null>(null);

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
    return (
      <div className="kw-public-booking">
        <Result
          status={confirmation.status === 'REQUESTED' ? 'info' : 'success'}
          title={
            confirmation.status === 'REQUESTED'
              ? 'Your request has been sent'
              : 'Your appointment is booked'
          }
          subTitle={confirmation.message}
          extra={
            <Card size="small" style={{ textAlign: 'left', maxWidth: 460, margin: '0 auto' }}>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Text strong>{formatClinicDate(confirmation.scheduledStart)}</Text>
                <Text>{formatClinicTime(confirmation.scheduledStart)}</Text>
                <Text type="secondary">
                  {service?.name} at {page.clinic.displayName}
                </Text>
                {service?.preInstructions ? (
                  <Alert
                    type="info"
                    style={{ marginTop: 8 }}
                    message="Before you come"
                    description={service.preInstructions}
                  />
                ) : null}
                <Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Keep this link to change or cancel your appointment:
                  </Text>
                  <br />
                  <a href={`/book${confirmation.manageUrl.replace(`/${slug}`, `/${slug}`)}`}>
                    Manage my appointment
                  </a>
                </Paragraph>
              </Space>
            </Card>
          }
        />
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
      <header className="kw-public-header">
        {page.clinic.logoUrl ? (
          <img src={page.clinic.logoUrl} alt="" className="kw-public-logo" />
        ) : null}
        <Title level={4} style={{ margin: 0 }}>
          {page.clinic.displayName}
        </Title>
        {page.clinic.introText ? <Text type="secondary">{page.clinic.introText}</Text> : null}
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
            <Card
              key={row.id}
              size="small"
              hoverable
              onClick={() => {
                setServiceId(row.id);
                setStep(1);
              }}
            >
              <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
                <Space direction="vertical" size={2}>
                  <Text strong>{row.name}</Text>
                  {row.description ? (
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      {row.description}
                    </Text>
                  ) : null}
                  <Space size={4}>
                    <Tag>{row.durationMinutes} min</Tag>
                    {row.requiresApproval ? <Tag color="orange">Confirmed by the clinic</Tag> : null}
                  </Space>
                </Space>
                {row.price ? (
                  <Text strong>
                    {row.price.display === 'FROM' ? 'from ' : ''}RM{' '}
                    {Number(row.price.amount).toFixed(2)}
                  </Text>
                ) : null}
              </Space>
            </Card>
          ))}
        </Space>
      ) : null}

      {step === 1 ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Radio.Group
            value={staffId ?? 'ANY'}
            onChange={(event) =>
              setStaffId(event.target.value === 'ANY' ? undefined : event.target.value)
            }
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <Radio value="ANY">
              <Text strong>Any available doctor</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Usually the soonest appointment
              </Text>
            </Radio>
            {(providers ?? []).map((provider) => (
              <Radio key={provider.id} value={provider.id}>
                {provider.fullName}
              </Radio>
            ))}
          </Radio.Group>
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
            <Alert
              type="info"
              showIcon
              message="Nothing free that day"
              description={
                REASON_WORDS[availability?.reason ?? ''] ?? 'Please try another day.'
              }
            />
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
              <Text strong>A few questions from the clinic</Text>
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
