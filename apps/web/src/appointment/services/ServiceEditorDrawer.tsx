import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Skeleton,
  Space,
  Switch,
  Tabs,
  TimePicker,
  Typography,
  message,
} from 'antd';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { apiClient, ApiError } from '../../core/api-client';
import {
  BookingFieldType,
  useServiceDetail,
  useUpdateServiceConfig,
} from '../hooks/useServiceConfig';

const { Text, Paragraph } = Typography;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const FIELD_TYPES: { value: BookingFieldType; label: string }[] = [
  { value: 'SHORT_TEXT', label: 'Short text' },
  { value: 'LONG_TEXT', label: 'Long text' },
  { value: 'YES_NO', label: 'Yes / No' },
  { value: 'SINGLE_CHOICE', label: 'Pick one' },
  { value: 'MULTI_CHOICE', label: 'Pick any' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'DATE', label: 'Date' },
];

interface ServiceEditorDrawerProps {
  serviceId: string | null;
  clinicId?: string;
  open: boolean;
  onClose: () => void;
}

/**
 * THE SERVICE EDITOR — seven tabs, ONE save (§21).
 *
 * Tabs rather than one very long page, and a single Save rather than one per
 * tab. The person filling this in reads it as one form: they press Save once
 * and expect all of it to land or none of it to. Seven endpoints is how a
 * service ends up with its new duration and its old provider list, with
 * nothing on screen to say so.
 *
 * Unsaved changes are guarded on close, because a drawer is very easy to
 * dismiss by accident and this form holds a lot of typing.
 */
export function ServiceEditorDrawer({
  serviceId,
  clinicId,
  open,
  onClose,
}: ServiceEditorDrawerProps) {
  const [form] = Form.useForm();
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState('basic');
  const { data: service, isLoading } = useServiceDetail(serviceId ?? undefined);
  const update = useUpdateServiceConfig();

  const { data: providers } = useQuery({
    queryKey: ['appointment-service-providers', clinicId],
    queryFn: () =>
      apiClient.get<{ id: string; fullName: string }[]>(
        `/appointment-services/providers?clinicId=${clinicId}`,
      ),
    enabled: Boolean(clinicId) && open,
  });

  useEffect(() => {
    if (!service) return;
    form.setFieldsValue({
      ...service,
      bookableHours: service.bookableHours.map((row) => ({
        dayOfWeek: row.dayOfWeek,
        startTime: dayjs(row.startTime, 'HH:mm'),
        endTime: dayjs(row.endTime, 'HH:mm'),
      })),
      formFields: service.formFields,
      bookingFee: Number(service.bookingFee),
      depositAmount: Number(service.depositAmount),
    });
    setDirty(false);
  }, [service, form]);

  const close = () => {
    if (!dirty) {
      onClose();
      return;
    }
    // A drawer is very easy to dismiss by accident, and this form holds a lot
    // of typing.
    if (window.confirm('You have unsaved changes to this service. Discard them?')) {
      setDirty(false);
      onClose();
    }
  };

  const save = async () => {
    if (!serviceId) return;
    const values = await form.validateFields();
    try {
      await update.mutateAsync({
        id: serviceId,
        bookable: values.bookable,
        bookingDescription: values.bookingDescription,
        bookingPhotoUrl: values.bookingPhotoUrl,
        priceDisplay: values.priceDisplay,
        durationMinutesDefault: values.durationMinutesDefault,
        slotIntervalMinutes: values.slotIntervalMinutes ?? null,
        bufferBeforeMinutes: values.bufferBeforeMinutes ?? 0,
        bufferAfterMinutes: values.bufferAfterMinutes ?? 0,
        concurrentLimit: values.concurrentLimit ?? null,
        minimumNoticeMinutes: values.minimumNoticeMinutes ?? null,
        maxAdvanceDays: values.maxAdvanceDays ?? null,
        requiresApproval: values.requiresApproval,
        bookableHours: (values.bookableHours ?? []).map(
          (row: { dayOfWeek: number; startTime: unknown; endTime: unknown }) => ({
            dayOfWeek: row.dayOfWeek,
            startTime: dayjs(row.startTime as never).format('HH:mm'),
            endTime: dayjs(row.endTime as never).format('HH:mm'),
          }),
        ),
        providerStaffIds: values.providerStaffIds ?? [],
        formFields: values.formFields ?? [],
        bookingPaymentRule: values.bookingPaymentRule,
        depositAmount: values.depositAmount ?? 0,
        bookingFee: values.bookingFee ?? 0,
        preInstructions: values.preInstructions,
        postInstructions: values.postInstructions,
        bookingSlug: values.bookingSlug?.trim() || null,
      });
      setDirty(false);
      message.success('Service saved');
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'That service could not be saved.');
    }
  };

  return (
    <Drawer
      open={open}
      onClose={close}
      width={640}
      destroyOnHidden
      title={service?.name ?? 'Service'}
      footer={
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Text type={dirty ? 'warning' : 'secondary'}>
            {dirty ? 'Unsaved changes' : 'Everything saved'}
          </Text>
          <Space>
            <Button onClick={close}>Cancel</Button>
            <Button type="primary" loading={update.isPending} onClick={save}>
              Save service
            </Button>
          </Space>
        </Space>
      }
    >
      {isLoading ? <Skeleton active paragraph={{ rows: 10 }} /> : null}
      {service ? (
        <Form
          form={form}
          layout="vertical"
          onValuesChange={() => setDirty(true)}
          data-testid="service-editor"
        >
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: 'basic',
                label: 'Basic',
                children: (
                  <>
                    <Form.Item
                      name="bookable"
                      valuePropName="checked"
                      label="Patients and staff may book this"
                      extra="Off means it stays an order a doctor places, not a slot anybody picks."
                    >
                      <Switch />
                    </Form.Item>
                    <Form.Item
                      name="bookingDescription"
                      label="What the patient reads"
                      extra="The clinical name is “CONSULTATION - GENERAL”. This is the sentence under it."
                    >
                      <Input.TextArea rows={3} />
                    </Form.Item>
                    <Form.Item name="bookingPhotoUrl" label="Photo URL">
                      <Input placeholder="https://…" />
                    </Form.Item>
                    <Form.Item name="priceDisplay" label="Show the price">
                      <Radio.Group
                        optionType="button"
                        options={[
                          { value: 'HIDDEN', label: 'Hide it' },
                          { value: 'EXACT', label: 'Exactly' },
                          { value: 'FROM', label: 'From RM…' },
                        ]}
                      />
                    </Form.Item>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      The price itself is the clinical catalogue's — this decides whether the
                      public page prints it. Hidden means hidden: the number is not sent to the
                      browser at all.
                    </Text>
                  </>
                ),
              },
              {
                key: 'scheduling',
                label: 'Scheduling',
                children: (
                  <>
                    <Space size={16} wrap>
                      <Form.Item name="durationMinutesDefault" label="How long it runs">
                        <InputNumber min={5} max={720} step={5} addonAfter="min" />
                      </Form.Item>
                      <Form.Item
                        name="slotIntervalMinutes"
                        label="How often a slot starts"
                        extra="Blank = back to back"
                      >
                        <InputNumber min={5} max={720} step={5} addonAfter="min" />
                      </Form.Item>
                    </Space>
                    <Alert
                      type="info"
                      style={{ marginBottom: 16 }}
                      message="Duration and interval are different numbers"
                      description="A 45-minute service on a 30-minute interval offers 09:00, 09:30, 10:00 — and every one of them still needs 45 free minutes behind it, plus its buffers."
                    />
                    <Space size={16} wrap>
                      <Form.Item name="bufferBeforeMinutes" label="Time needed before">
                        <InputNumber min={0} max={240} step={5} addonAfter="min" />
                      </Form.Item>
                      <Form.Item name="bufferAfterMinutes" label="Time needed after">
                        <InputNumber min={0} max={240} step={5} addonAfter="min" />
                      </Form.Item>
                      <Form.Item
                        name="concurrentLimit"
                        label="How many at once"
                        extra="Blank = the provider is the only limit"
                      >
                        <InputNumber min={1} max={200} />
                      </Form.Item>
                    </Space>
                    <Space size={16} wrap>
                      <Form.Item
                        name="minimumNoticeMinutes"
                        label="Least notice"
                        extra="Blank = use the branch's"
                      >
                        <InputNumber min={0} max={129600} step={30} addonAfter="min" />
                      </Form.Item>
                      <Form.Item
                        name="maxAdvanceDays"
                        label="Furthest ahead"
                        extra="Blank = no limit"
                      >
                        <InputNumber min={1} max={730} addonAfter="days" />
                      </Form.Item>
                    </Space>
                    <Form.Item
                      name="requiresApproval"
                      valuePropName="checked"
                      label="A person has to accept the booking"
                      extra="On means it lands in Requests instead of being confirmed."
                    >
                      <Switch />
                    </Form.Item>

                    <Text strong>Hours this service is offered</Text>
                    <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                      Leave empty for “whenever the provider is free”. Add rows only when the
                      service itself is narrower — microsuction on Tuesday mornings, say.
                    </Paragraph>
                    <Form.List name="bookableHours">
                      {(fields, { add, remove }) => (
                        <>
                          {fields.map((field) => (
                            <Space key={field.key} align="baseline" style={{ marginBottom: 8 }}>
                              <Form.Item name={[field.name, 'dayOfWeek']} noStyle>
                                <Select
                                  style={{ width: 110 }}
                                  options={DAYS.map((label, value) => ({ value, label }))}
                                />
                              </Form.Item>
                              <Form.Item name={[field.name, 'startTime']} noStyle>
                                <TimePicker format="HH:mm" minuteStep={15} needConfirm={false} />
                              </Form.Item>
                              <Form.Item name={[field.name, 'endTime']} noStyle>
                                <TimePicker format="HH:mm" minuteStep={15} needConfirm={false} />
                              </Form.Item>
                              <Button size="small" onClick={() => remove(field.name)}>
                                Remove
                              </Button>
                            </Space>
                          ))}
                          <Button
                            size="small"
                            onClick={() =>
                              add({
                                dayOfWeek: 1,
                                startTime: dayjs('09:00', 'HH:mm'),
                                endTime: dayjs('12:00', 'HH:mm'),
                              })
                            }
                          >
                            Add hours
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: 'providers',
                label: 'Providers',
                children: (
                  <>
                    <Text strong>Who can provide this service?</Text>
                    <Paragraph type="secondary" style={{ fontSize: 12 }}>
                      A service nobody is set up for can never be booked — the slot grid returns
                      nothing and says why.
                    </Paragraph>
                    <Form.Item name="providerStaffIds">
                      <Checkbox.Group style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {(providers ?? []).map((provider) => (
                          <Checkbox key={provider.id} value={provider.id}>
                            {provider.fullName}
                          </Checkbox>
                        ))}
                      </Checkbox.Group>
                    </Form.Item>
                  </>
                ),
              },
              {
                key: 'form',
                label: 'Patient form',
                children: (
                  <>
                    <Paragraph type="secondary" style={{ fontSize: 12 }}>
                      Questions asked when a patient books this online. The ANSWER is stored with
                      the question as it was worded, so rewording one later does not change what an
                      older booking appears to have been asked.
                    </Paragraph>
                    <Form.List name="formFields">
                      {(fields, { add, remove }) => (
                        <>
                          {fields.map((field) => (
                            <Space
                              key={field.key}
                              direction="vertical"
                              style={{
                                width: '100%',
                                marginBottom: 12,
                                padding: 12,
                                border: '1px solid #dce4ea',
                                borderRadius: 8,
                              }}
                            >
                              <Space wrap>
                                <Form.Item name={[field.name, 'label']} noStyle>
                                  <Input placeholder="Question" style={{ width: 260 }} />
                                </Form.Item>
                                <Form.Item name={[field.name, 'fieldType']} noStyle>
                                  <Select options={FIELD_TYPES} style={{ width: 140 }} />
                                </Form.Item>
                                <Form.Item
                                  name={[field.name, 'required']}
                                  valuePropName="checked"
                                  noStyle
                                >
                                  <Checkbox>Required</Checkbox>
                                </Form.Item>
                                <Button size="small" onClick={() => remove(field.name)}>
                                  Remove
                                </Button>
                              </Space>
                              <Form.Item name={[field.name, 'helpText']} noStyle>
                                <Input placeholder="Help text (optional)" />
                              </Form.Item>
                              <Form.Item name={[field.name, 'options']} noStyle>
                                <Select
                                  mode="tags"
                                  placeholder="Choices, for pick-one and pick-any"
                                  style={{ width: '100%' }}
                                />
                              </Form.Item>
                            </Space>
                          ))}
                          <Button
                            size="small"
                            onClick={() =>
                              add({
                                label: '',
                                fieldType: 'SHORT_TEXT',
                                required: false,
                                active: true,
                                options: [],
                              })
                            }
                          >
                            Add a question
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: 'payment',
                label: 'Payment & policies',
                children: (
                  <>
                    <Form.Item name="bookingPaymentRule" label="What the booking asks for">
                      <Radio.Group
                        optionType="button"
                        options={[
                          { value: 'NONE', label: 'Nothing up front' },
                          { value: 'DEPOSIT', label: 'A deposit' },
                          { value: 'FULL', label: 'The full price' },
                        ]}
                      />
                    </Form.Item>
                    <Space size={16} wrap>
                      <Form.Item name="depositAmount" label="Deposit">
                        <InputNumber min={0} step={5} addonBefore="RM" />
                      </Form.Item>
                      <Form.Item
                        name="bookingFee"
                        label="Booking fee"
                        extra="Snapshotted onto each booking"
                      >
                        <InputNumber min={0} step={5} addonBefore="RM" />
                      </Form.Item>
                    </Space>
                    <Alert
                      type="info"
                      showIcon
                      message="Deposits are not counted twice"
                      description="A deposit taken at booking is recorded against the appointment and reconciled with the clinic invoice when the visit is billed."
                    />
                  </>
                ),
              },
              {
                key: 'instructions',
                label: 'Instructions',
                children: (
                  <>
                    <Form.Item
                      name="preInstructions"
                      label="Before the appointment"
                      extra="Shown on the confirmation, the reminder and the manage-booking page."
                    >
                      <Input.TextArea rows={4} placeholder="Fast for 8 hours. Bring your IC." />
                    </Form.Item>
                    <Form.Item name="postInstructions" label="After the appointment">
                      <Input.TextArea rows={4} placeholder="Keep the dressing dry for 24 hours." />
                    </Form.Item>
                  </>
                ),
              },
              {
                key: 'sharing',
                label: 'Sharing',
                children: (
                  <>
                    <Form.Item
                      name="bookingSlug"
                      label="Its own link ending"
                      extra="Gives this service a direct link — /your-clinic/sinus — that preselects it."
                    >
                      <Input addonBefore="/your-clinic/" placeholder="sinus" />
                    </Form.Item>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Lowercase letters, numbers and hyphens. The full link, its QR code and the
                      print sheet are on the Booking Page tab.
                    </Text>
                  </>
                ),
              },
            ]}
          />
        </Form>
      ) : null}
    </Drawer>
  );
}
