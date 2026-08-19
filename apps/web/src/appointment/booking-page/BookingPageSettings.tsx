import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { CopyOutlined, PrinterOutlined, DownloadOutlined } from '@ant-design/icons';
import { ApiError } from '../../core/api-client';
import { useBookingPage, useSaveBookingPage, useSaveReminderRules } from '../hooks/useBookingPage';
import { qrSvg } from './qr';
import { KuwickStatusTag } from '../../design-system/kuwick';

const { Text, Paragraph } = Typography;

const REMINDER_CHOICES = [
  { value: 2880, label: '2 days before' },
  { value: 1440, label: '1 day before' },
  { value: 240, label: '4 hours before' },
  { value: 120, label: '2 hours before' },
  { value: 60, label: '1 hour before' },
];

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
  const [dirty, setDirty] = useState(false);
  const { data, isFetching } = useBookingPage(clinicId);
  const save = useSaveBookingPage();
  const saveReminders = useSaveReminderRules();
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([]);

  useEffect(() => {
    if (!data) return;
    form.setFieldsValue(
      data.page ?? {
        slug: '',
        displayName: '',
        language: 'en',
        requirePhone: true,
        requireEmail: false,
        requireNric: false,
        showReasonField: true,
        active: false,
        allowPatientReschedule: true,
        allowPatientCancel: true,
        patientChangeCutoffHours: 4,
      },
    );
    setReminderOffsets(data.reminderRules.map((rule) => rule.offsetMinutes));
    setDirty(false);
  }, [data, form]);

  const publicOrigin = typeof window === 'undefined' ? '' : window.location.origin;
  const slug = Form.useWatch('slug', form) as string | undefined;
  const generalUrl = slug ? `${publicOrigin}/book/${slug}` : '';

  const qr = useMemo(() => (generalUrl ? qrSvg(generalUrl, 200) : null), [generalUrl]);

  const submit = async () => {
    if (!clinicId) return;
    const values = await form.validateFields();
    try {
      await save.mutateAsync({ ...values, clinicId });
      await saveReminders.mutateAsync({ clinicId, offsets: reminderOffsets });
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
              <KuwickStatusTag
                tone={data.page.active ? 'success' : 'neutral'}
                label={data.page.active ? 'LIVE' : 'Not published'}
              />
              <Text className="kw-bp-status-url" copyable={{ text: generalUrl }}>
                {generalUrl}
              </Text>
            </div>
            <Space>
              <Button size="small" onClick={() => window.open(generalUrl, '_blank', 'noopener')}>
                Open page
              </Button>
            </Space>
          </div>
        ) : null}
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
                  <Form.Item name="logoUrl" label="Logo URL">
                    <Input placeholder="https://…" />
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
                  <Form.Item name="confirmationMessage" label="Confirmation message">
                    <Input.TextArea
                      rows={3}
                      placeholder="Your appointment is confirmed. Please arrive 10 minutes early."
                    />
                  </Form.Item>
                  <Text strong>Reminders</Text>
                  <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                    Choose as many as you want, or none. These build the counter's reminder
                    worklist — Kuwick has no message gateway, so a person still presses send, and
                    that is recorded honestly rather than as an automatic delivery.
                  </Paragraph>
                  <Select
                    mode="multiple"
                    style={{ width: '100%', maxWidth: 420 }}
                    value={reminderOffsets}
                    onChange={(value) => {
                      setReminderOffsets(value);
                      setDirty(true);
                    }}
                    options={REMINDER_CHOICES}
                    placeholder="No reminders"
                  />
                </>
              ),
            },
            {
              key: 'policies',
              label: 'What patients may change',
              children: (
                <>
                  <Form.Item
                    name="allowPatientReschedule"
                    valuePropName="checked"
                    label="Patients may move their own appointment"
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    name="allowPatientCancel"
                    valuePropName="checked"
                    label="Patients may cancel their own appointment"
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item
                    name="patientChangeCutoffHours"
                    label="Up to how many hours before"
                    extra="After this, the manage-booking page asks them to ring you instead."
                  >
                    <InputNumber min={0} max={720} addonAfter="hours" />
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
                        {data.links?.services.length ? (
                          <Space direction="vertical" style={{ width: '100%' }}>
                            {data.links.services.map((service) => (
                              <Space key={service.serviceId} wrap>
                                <Tag>{service.name}</Tag>
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
                              </Space>
                            ))}
                          </Space>
                        ) : (
                          <Text type="secondary">
                            Give a service its own link ending on the Services tab to get a direct
                            link that preselects it.
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
          <Button type="primary" loading={save.isPending} onClick={submit}>
            Save booking page
          </Button>
          <Text type={dirty ? 'warning' : 'secondary'}>
            {dirty ? 'Unsaved changes' : 'Everything saved'}
          </Text>
        </Space>
      </Form>
    </div>
  );
}
