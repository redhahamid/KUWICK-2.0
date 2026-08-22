import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { CopyOutlined, PrinterOutlined, DownloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../core/api-client';
import { useBookingPage, useSaveBookingPage } from '../hooks/useBookingPage';
import { permissionHint, useCan } from '../../core/hooks/useCan';
import { useAppointmentServices } from '../hooks/useServiceConfig';
import { qrSvg } from './qr';
import { MediaUploadField, useMediaPreviewUrl } from '../media/MediaUploadField';
import { KuwickStatusTag } from '../../design-system/kuwick';

const { Text, Paragraph } = Typography;

/**
 * THE LIVE PREVIEW — the patient's phone, drawn from the form's CURRENT
 * values rather than the saved row, so "what will this look like?" is
 * answered while typing and not after publishing. Purely presentational:
 * nothing here persists, fetches, or bypasses what the real public page
 * enforces server-side. The service list is the clinic's real bookable
 * catalogue — the same rows the public page would offer.
 */
function BookingPagePreview({
  active,
  displayName,
  introText,
  logoUrl,
  language,
  services,
}: {
  active?: boolean;
  displayName?: string;
  introText?: string;
  logoUrl?: string;
  language?: string;
  services: { id: string; name: string; durationMinutesDefault: number }[];
}) {
  const bm = language === 'ms';
  // media:// refs need the authed blob route; plain URLs pass through.
  const logoPreview = useMediaPreviewUrl(logoUrl ?? null);
  const monogram = (displayName ?? '')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
  return (
    <aside className="kw-bp-preview" aria-hidden data-testid="booking-page-preview">
      <div className="kw-bp-preview-label">Live preview — patient's phone</div>
      <div className="kw-bp-phone" data-off={active ? undefined : 'true'}>
        <div className="kw-bp-phone-notch" />
        {!active ? (
          <div className="kw-bp-phone-offline">
            <span>Not published</span>
          </div>
        ) : null}
        <div className="kw-bp-phone-screen">
          <div className="kw-bp-mini-hero">
            <span className="kw-bp-mini-mark">
              {logoPreview ? <img src={logoPreview} alt="" /> : monogram || 'KH'}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="kw-bp-mini-name">{displayName || 'Your clinic name'}</div>
              {introText ? <div className="kw-bp-mini-intro">{introText}</div> : null}
            </div>
          </div>
          <div>
            <div className="kw-bp-mini-progress">
              {bm ? 'Langkah 1 daripada 5 · Pilih perkhidmatan' : 'Step 1 of 5 · Choose a service'}
            </div>
            <div className="kw-bp-mini-bar">
              <span />
            </div>
          </div>
          <div className="kw-bp-mini-q">
            {bm ? 'Apa yang anda ingin tempah?' : 'What would you like to book?'}
          </div>
          {services.length > 0 ? (
            <>
              {services.slice(0, 4).map((service) => (
                <div key={service.id} className="kw-bp-mini-service">
                  <span>
                    {service.name}
                    <small>{service.durationMinutesDefault} min</small>
                  </span>
                  <span style={{ color: '#0f6b78' }}>→</span>
                </div>
              ))}
              {services.length > 4 ? (
                // Say the preview is a preview — UAT read the missing fifth
                // service as missing DATA rather than a shortened mock-up.
                <div className="kw-bp-mini-more">
                  {bm
                    ? `Pratonton — 4 daripada ${services.length} perkhidmatan`
                    : `Preview — showing 4 of ${services.length} services`}
                </div>
              ) : null}
            </>
          ) : (
            <div className="kw-bp-mini-empty">
              Services marked bookable appear here — set them up under Services.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

interface BookingPageSettingsProps {
  clinicId?: string;
}

/**
 * THE BOOKING PAGE — its link, its fields, its messages and its sharing (§39).
 *
 * ONE page with tabs, not four settings screens. These are one decision to the
 * person making them: "what does my booking link look like and what does it
 * ask for". Split across screens, a clinic could publish a confirmation
 * message referring to a field it had turned off.
 *
 * THE PAGE IS OFF UNTIL SOMEBODY TURNS IT ON. A public URL that goes live by
 * migration is a URL nobody decided to publish.
 */
export function BookingPageSettings({ clinicId }: BookingPageSettingsProps) {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [dirty, setDirty] = useState(false);
  const { data, isFetching } = useBookingPage(clinicId);
  const save = useSaveBookingPage();
  const canConfigure = useCan('appointment.configure');

  useEffect(() => {
    if (!data) return;
    const page = data.page as (typeof data.page & {
      patientRescheduleMode?: string | null;
      patientCancelMode?: string | null;
      patientChangeCutoffMinutes?: number | null;
      allowPatientReschedule?: boolean;
      allowPatientCancel?: boolean;
      patientChangeCutoffHours?: number;
    }) | null;
    // Phase 7 — the tri-state, seeded from the stored policy or the frozen
    // booleans (true was always instant, false was always "ring us"). A NEW
    // page starts on the recommended workflow: request approval.
    const modeOf = (stored: string | null | undefined, legacy: boolean | undefined) =>
      stored ?? (legacy === undefined ? 'REQUEST_APPROVAL' : legacy ? 'INSTANT' : 'NOT_ALLOWED');
    const cutoffMinutes =
      page?.patientChangeCutoffMinutes ?? (page?.patientChangeCutoffHours ?? 4) * 60;
    const cutoff =
      cutoffMinutes % (24 * 60) === 0 && cutoffMinutes > 0
        ? { cutoffValue: cutoffMinutes / (24 * 60), cutoffUnit: 'days' }
        : cutoffMinutes % 60 === 0
          ? { cutoffValue: cutoffMinutes / 60, cutoffUnit: 'hours' }
          : { cutoffValue: cutoffMinutes, cutoffUnit: 'minutes' };
    form.setFieldsValue({
      ...(page ?? {
        slug: '',
        displayName: '',
        language: 'en',
        requirePhone: true,
        requireEmail: false,
        requireNric: false,
        showReasonField: true,
        active: false,
      }),
      patientRescheduleMode: modeOf(page?.patientRescheduleMode, page?.allowPatientReschedule),
      patientCancelMode: modeOf(page?.patientCancelMode, page?.allowPatientCancel),
      ...cutoff,
    });
    setDirty(false);
  }, [data, form]);

  const publicOrigin = typeof window === 'undefined' ? '' : window.location.origin;
  const slug = Form.useWatch('slug', form) as string | undefined;
  const generalUrl = slug ? `${publicOrigin}/book/${slug}` : '';

  // The preview mirrors the FORM, live — including edits not yet saved.
  const watchActive = Form.useWatch('active', form) as boolean | undefined;
  const watchDisplayName = Form.useWatch('displayName', form) as string | undefined;
  const watchIntroText = Form.useWatch('introText', form) as string | undefined;
  const watchLogoUrl = Form.useWatch('logoUrl', form) as string | undefined;
  const watchLanguage = Form.useWatch('language', form) as string | undefined;
  const { data: bookableServices } = useAppointmentServices({ bookableOnly: true });

  const qr = useMemo(() => (generalUrl ? qrSvg(generalUrl, 200) : null), [generalUrl]);

  const submit = async () => {
    if (!clinicId) return;
    const values = await form.validateFields();
    // Phase 7 — value × unit → minutes; the legacy booleans ride along so an
    // older reader of the row still sees a truthful coarse answer.
    const unitMinutes =
      values.cutoffUnit === 'days' ? 24 * 60 : values.cutoffUnit === 'hours' ? 60 : 1;
    const cutoffMinutes = Math.round((values.cutoffValue ?? 0) * unitMinutes);
    const { cutoffValue: _v, cutoffUnit: _u, ...rest } = values;
    try {
      await save.mutateAsync({
        ...rest,
        clinicId,
        patientChangeCutoffMinutes: cutoffMinutes,
        patientChangeCutoffHours: Math.max(0, Math.round(cutoffMinutes / 60)),
        allowPatientReschedule: values.patientRescheduleMode !== 'NOT_ALLOWED',
        allowPatientCancel: values.patientCancelMode !== 'NOT_ALLOWED',
      });
      setDirty(false);
      message.success('Booking page saved');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'That could not be saved.');
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success('Link copied');
    } catch {
      // A clipboard permission refusal is not an error worth a red toast — the
      // link is on screen and can be selected.
      message.info('Copy the link from the box above.');
    }
  };

  const downloadQrPng = () => {
    if (!qr || !generalUrl) return;
    // The SVG the page already shows, rasterised in the browser at print
    // resolution — nothing leaves the machine.
    const blob = new Blob([qr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 800;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, 800, 800);
      context.drawImage(image, 0, 0, 800, 800);
      URL.revokeObjectURL(url);
      const link = document.createElement('a');
      link.download = 'booking-qr.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    image.src = url;
  };

  const printQr = () => {
    if (!qr) return;
    const frame = window.open('', '_blank', 'width=420,height=560');
    if (!frame) return;
    frame.document.write(
      `<title>Booking QR</title><body style="font-family:sans-serif;text-align:center;padding:32px">
       <h2>${form.getFieldValue('displayName') ?? ''}</h2>
       <p>Scan to book an appointment</p>${qr}
       <p style="font-size:12px;color:#667085">${generalUrl}</p></body>`,
    );
    frame.document.close();
    frame.print();
  };

  if (!clinicId) return <Empty description="Choose a branch to set up its booking page." />;

  return (
    <div className="kw-booking-page-settings" data-testid="booking-page-settings">
      <Form
        form={form}
        layout="vertical"
        onValuesChange={() => setDirty(true)}
        disabled={isFetching && !data}
      >
        {data?.page ? (
          <div className="kw-bp-status">
            <div className="kw-bp-status-left">
              <span
                className="kw-bp-live-dot"
                style={{ color: data.page.active ? '#16a34a' : '#98a2b3' }}
              >
                {data.page.active ? 'LIVE' : 'OFFLINE'}
              </span>
              <Text className="kw-bp-status-url" copyable={{ text: generalUrl }}>
                {generalUrl}
              </Text>
            </div>
            <Space>
              <Button size="small" onClick={() => copy(generalUrl)} icon={<CopyOutlined />}>
                Copy link
              </Button>
              <Button size="small" onClick={() => window.open(generalUrl, '_blank', 'noopener')}>
                Open page
              </Button>
            </Space>
          </div>
        ) : null}
        <div className="kw-bp-layout">
          <div className="kw-bp-config">
        <Tabs
          items={[
            {
              key: 'general',
              label: 'General',
              children: (
                <>
                  <Form.Item
                    name="active"
                    valuePropName="checked"
                    label="The booking page is live"
                    extra="Off means the link returns nothing. It starts off, because a public page that goes live by itself is a page nobody decided to publish."
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    name="displayName"
                    label="Clinic name, as patients see it"
                    rules={[{ required: true, message: 'Patients need to know whose page this is.' }]}
                  >
                    <Input placeholder="Klinik Hijraa Bangi" />
                  </Form.Item>
                  <Form.Item
                    name="slug"
                    label="Link ending"
                    rules={[
                      { required: true, message: 'The link needs an ending.' },
                      {
                        pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/,
                        message: 'Lowercase letters, numbers and hyphens only.',
                      },
                    ]}
                  >
                    <Input addonBefore={`${publicOrigin}/book/`} placeholder="hijraa-bangi" />
                  </Form.Item>
                  <Form.Item name="logoUrl" label="Logo" valuePropName="value" trigger="onChange">
                    <MediaUploadField
                      kind="CLINIC_LOGO"
                      hint="Shown at the top of the booking page. JPG, PNG or WebP, up to 2 MB."
                    />
                  </Form.Item>
                  <Form.Item name="language" label="Language">
                    <Select
                      options={[
                        { value: 'en', label: 'English' },
                        { value: 'ms', label: 'Bahasa Malaysia' },
                      ]}
                      style={{ width: 200 }}
                    />
                  </Form.Item>
                  <Form.Item name="introText" label="What the page says at the top">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                </>
              ),
            },
            {
              key: 'details',
              label: 'Patient details',
              children: (
                <>
                  <Paragraph type="secondary" style={{ fontSize: 12 }}>
                    A patient's name is always asked for. Everything else is the clinic's choice —
                    and every extra required field is a patient who gives up halfway.
                  </Paragraph>
                  <Form.Item name="requirePhone" valuePropName="checked" label="Require a phone number">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="requireEmail" valuePropName="checked" label="Require an email address">
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    name="requireNric"
                    valuePropName="checked"
                    label="Require an IC or passport number"
                    extra="Asking for it makes matching to an existing record far more reliable. Not asking never stops a booking — it lands on the reconciliation list instead."
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item name="showReasonField" valuePropName="checked" label="Ask why they are coming">
                    <Switch />
                  </Form.Item>
                  <Alert
                    type="info"
                    showIcon
                    message="The page never says whether somebody already exists"
                    description="Matching happens on the server and the patient sees the same confirmation either way — otherwise the page becomes a way to test a list of IC numbers against your records."
                  />
                </>
              ),
            },
            {
              key: 'communication',
              label: 'Communication',
              children: (
                <>
                  <Form.Item
                    name="confirmationMessage"
                    label="Confirmation message"
                    tooltip="Shown on the booking page's own confirmation screen, right after a patient books."
                  >
                    <Input.TextArea
                      rows={3}
                      placeholder="Your appointment is confirmed. Please arrive 10 minutes early."
                    />
                  </Form.Item>

                  {/* PHASE 8 — one store. Templates and reminder timing moved
                      to Clinic Settings; this tab links there instead of
                      keeping a second editor that could disagree with it. */}
                  <Text strong>Message templates &amp; reminders</Text>
                  <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                    The wording of every WhatsApp message (in English and Bahasa Malaysia) and the
                    reminder schedule
                    {data?.reminderRules.length
                      ? ` — currently ${data.reminderRules.length} reminder rule${
                          data.reminderRules.length === 1 ? '' : 's'
                        } —`
                      : ' — currently no reminder rules —'}{' '}
                    live in one place for the whole clinic.
                  </Paragraph>
                  <Button
                    onClick={() => navigate('/settings/scheduling/communication')}
                    data-testid="open-communication-settings"
                  >
                    Open Communication &amp; Reminders
                  </Button>
                </>
              ),
            },
            {
              key: 'policies',
              label: 'Appointment Changes',
              children: (
                <>
                  {/* PHASE 7 — three answers, not two. "Request clinic
                      approval" is the recommended clinic workflow: the
                      patient asks, the booking stands until you decide. */}
                  <Form.Item name="patientRescheduleMode" label="Patient rescheduling">
                    <Radio.Group>
                      <Space direction="vertical" size={4}>
                        <Radio value="NOT_ALLOWED">Not allowed — the page says to ring you</Radio>
                        <Radio value="REQUEST_APPROVAL">
                          Request clinic approval (recommended) — you approve or decline each request
                        </Radio>
                        <Radio value="INSTANT">Allow instantly — the patient moves it themselves</Radio>
                      </Space>
                    </Radio.Group>
                  </Form.Item>
                  <Form.Item name="patientCancelMode" label="Patient cancellation">
                    <Radio.Group>
                      <Space direction="vertical" size={4}>
                        <Radio value="NOT_ALLOWED">Not allowed — the page says to ring you</Radio>
                        <Radio value="REQUEST_APPROVAL">
                          Request clinic approval (recommended) — a reason is always required
                        </Radio>
                        <Radio value="INSTANT">Allow instantly</Radio>
                      </Space>
                    </Radio.Group>
                  </Form.Item>
                  <Form.Item
                    label="Changes and requests close before the appointment"
                    extra="After this, the manage-booking page asks them to ring you instead."
                  >
                    <Space.Compact>
                      <Form.Item name="cutoffValue" noStyle>
                        <InputNumber min={0} max={720} style={{ width: 90 }} />
                      </Form.Item>
                      <Form.Item name="cutoffUnit" noStyle>
                        <Select
                          style={{ width: 110 }}
                          options={[
                            { value: 'minutes', label: 'minutes' },
                            { value: 'hours', label: 'hours' },
                            { value: 'days', label: 'days' },
                          ]}
                        />
                      </Form.Item>
                    </Space.Compact>
                  </Form.Item>
                </>
              ),
            },
            {
              key: 'sharing',
              label: 'Sharing',
              children: (
                <>
                  {!data?.page ? (
                    <Alert
                      type="info"
                      showIcon
                      message="Save the page first"
                      description="The link and its QR code appear once the page has a name and an ending."
                    />
                  ) : (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                      <Card size="small" title="Your booking link">
                        <Space wrap>
                          <Input readOnly value={generalUrl} style={{ width: 340 }} />
                          <Button icon={<CopyOutlined />} onClick={() => copy(generalUrl)}>
                            Copy
                          </Button>
                          <Button onClick={() => window.open(generalUrl, '_blank', 'noopener')}>
                            Open
                          </Button>
                        </Space>
                      </Card>

                      <Card
                        size="small"
                        title="QR code"
                        extra={
                          <Space>
                            <Button size="small" icon={<DownloadOutlined />} onClick={downloadQrPng}>
                              Download PNG
                            </Button>
                            <Button size="small" icon={<PrinterOutlined />} onClick={printQr}>
                              Print
                            </Button>
                          </Space>
                        }
                      >
                        {qr ? (
                          <div
                            data-testid="booking-qr"
                            // Generated in the browser: no external service
                            // sees the clinic's URL, and the print sheet works
                            // without an internet connection.
                            dangerouslySetInnerHTML={{ __html: qr }}
                          />
                        ) : (
                          <Text type="secondary">That link is too long to encode as a QR code.</Text>
                        )}
                      </Card>

                      <Card size="small" title="Service links">
                        {/* EVERY public bookable service, generated from the
                            catalogue — never hand-maintained. A service
                            without a link ending is listed too, saying how to
                            get one, so this list can never read as "a service
                            is missing" when it is merely link-less. */}
                        {data.links?.services.length ? (
                          <Space direction="vertical" style={{ width: '100%' }}>
                            {data.links.services.map((service) => (
                              <Space key={service.serviceId} wrap>
                                <Tag>{service.name}</Tag>
                                {service.path ? (
                                  <>
                                    <Input
                                      readOnly
                                      value={`${publicOrigin}/book${service.path}`}
                                      style={{ width: 320 }}
                                    />
                                    <Button
                                      size="small"
                                      icon={<CopyOutlined />}
                                      onClick={() => copy(`${publicOrigin}/book${service.path}`)}
                                    />
                                  </>
                                ) : (
                                  <Text type="secondary">
                                    Bookable on the main page — add a link ending in its service
                                    editor for a direct link.
                                  </Text>
                                )}
                              </Space>
                            ))}
                          </Space>
                        ) : (
                          <Text type="secondary">
                            No services are open for online booking yet — enable one under
                            Appointments ▸ Services.
                          </Text>
                        )}
                      </Card>
                    </Space>
                  )}
                </>
              ),
            },
          ]}
        />

        <Space style={{ marginTop: 16 }}>
          <Button
            type="primary"
            loading={save.isPending}
            disabled={!canConfigure}
            title={
              canConfigure
                ? undefined
                : permissionHint('change how appointments and services are configured')
            }
            onClick={submit}
          >
            Save booking page
          </Button>
          <Text type={dirty ? 'warning' : 'secondary'}>
            {dirty ? 'Unsaved changes' : 'Everything saved'}
          </Text>
        </Space>
          </div>

          <BookingPagePreview
            active={watchActive}
            displayName={watchDisplayName}
            introText={watchIntroText}
            logoUrl={watchLogoUrl}
            language={watchLanguage}
            services={bookableServices ?? []}
          />
        </div>
      </Form>
    </div>
  );
}
