import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Space,
  Switch,
  Typography,
  message,
} from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '../core/api-client';
import { Service } from './types';

export interface ServiceBookingValues {
  bookable: boolean;
  durationMinutesDefault: number;
  slotIntervalMinutes: number | null;
  bookingFee: number;
  bookingDescription: string | null;
  bookingPhotoUrl: string | null;
  requiresApproval: boolean;
  concurrentLimit: number | null;
}

/**
 * SETTINGS → CLINICAL → SERVICES & PROCEDURES → "Booking"
 *
 * The BOOKING half of a service, deliberately its own drawer rather than more
 * fields on the Edit form.
 *
 * They are edited by different people for different reasons: a clinical lead
 * renames and reprices; whoever runs the public booking page decides what
 * patients can see, what it costs to hold a slot, and how many rooms there
 * are. Two forms means a booking change cannot carry a price change with it,
 * and a price change cannot publish a service to the public page by accident.
 */
export function ServiceBookingDrawer({
  service,
  open,
  onClose,
}: {
  service: Service | null;
  open: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm<ServiceBookingValues>();
  const [bookable, setBookable] = useState(false);
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: (values: Partial<ServiceBookingValues>) =>
      apiClient.patch<Service>(`/services/${service?.id}/booking`, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });

  useEffect(() => {
    if (!service) return;
    setBookable(Boolean(service.bookable));
    form.setFieldsValue({
      bookable: Boolean(service.bookable),
      durationMinutesDefault: service.durationMinutesDefault,
      slotIntervalMinutes: service.slotIntervalMinutes ?? null,
      bookingFee: Number(service.bookingFee ?? 0),
      bookingDescription: service.bookingDescription ?? null,
      bookingPhotoUrl: service.bookingPhotoUrl ?? null,
      requiresApproval: Boolean(service.requiresApproval),
      concurrentLimit: service.concurrentLimit ?? null,
    });
  }, [service, form]);

  const submit = async (values: ServiceBookingValues) => {
    try {
      await save.mutateAsync(values);
      message.success('Booking settings saved.');
      onClose();
    } catch (error) {
      message.error(
        error instanceof ApiError ? error.message : 'Could not save the booking settings.',
      );
    }
  };

  return (
    <Drawer
      title={service ? `Booking — ${service.name}` : 'Booking'}
      open={open}
      onClose={onClose}
      destroyOnHidden
      width={520}
      extra={
        <Button type="primary" onClick={() => form.submit()} loading={save.isPending}>
          Save
        </Button>
      }
    >
      <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item name="bookable" valuePropName="checked" className="kw-booking-toggle">
          <Space size={10}>
            <Switch
              checked={bookable}
              onChange={(next) => {
                setBookable(next);
                form.setFieldValue('bookable', next);
              }}
              aria-label="Patients can book this"
            />
            <Typography.Text strong>Patients can book this</Typography.Text>
          </Space>
        </Form.Item>

        {!bookable && (
          <Alert
            type="info"
            showIcon
            className="kw-settings-alert"
            message="Not offered for booking"
            description="These settings are saved either way, so you can set them up before turning it on."
          />
        )}

        <div className="kw-booking-config-body" data-off={!bookable}>
          <Typography.Paragraph className="kw-booking-config-hint">
            Duration is how long the appointment runs. The interval is how often a slot starts —
            leave it empty for back-to-back slots.
          </Typography.Paragraph>

          <Space size={16} wrap>
            <Form.Item
              name="durationMinutesDefault"
              label="Duration"
              rules={[{ required: true, message: 'How long does it take?' }]}
            >
              <InputNumber min={1} max={720} step={5} addonAfter="min" />
            </Form.Item>
            <Form.Item name="slotIntervalMinutes" label="Slot every">
              <InputNumber min={1} max={720} step={5} addonAfter="min" placeholder="Same as duration" />
            </Form.Item>
          </Space>

          <Space size={16} wrap>
            <Form.Item
              name="bookingFee"
              label="Booking fee"
              tooltip="What the patient pays to hold the slot. Zero is normal."
            >
              <InputNumber min={0} step={1} precision={2} addonBefore="RM" />
            </Form.Item>
            <Form.Item
              name="concurrentLimit"
              label="How many at one time"
              tooltip="Rooms or machines — how many of these can run at once across the whole clinic. Leave empty when the doctor is the only limit."
            >
              <InputNumber min={1} max={100} placeholder="No limit" />
            </Form.Item>
          </Space>

          <Form.Item
            name="requiresApproval"
            label="Approval"
            valuePropName="checked"
            tooltip="On: the booking waits in the Requests tab for someone to accept it. Off: it is confirmed straight away."
          >
            <Switch checkedChildren="Needs approval" unCheckedChildren="Books instantly" />
          </Form.Item>

          <Form.Item
            name="bookingDescription"
            label="What patients read"
            tooltip="The sentence under the service name on the public booking page."
          >
            <Input.TextArea rows={3} maxLength={500} showCount placeholder="e.g. A 30-minute consultation with one of our doctors." />
          </Form.Item>

          <Form.Item name="bookingPhotoUrl" label="Photo (optional)">
            <Input placeholder="https://…" maxLength={2048} />
          </Form.Item>
        </div>
      </Form>
    </Drawer>
  );
}
