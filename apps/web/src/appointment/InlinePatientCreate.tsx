import { Button, DatePicker, Form, Input, Select, Space, message } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { ApiError } from '../core/api-client';
import { useCreatePatient } from '../core/hooks/usePatients';
import type { Patient } from '../core/types';

interface NewPatientValues {
  name: string;
  identifierType: 'NRIC' | 'PASSPORT';
  identifierValue: string;
  phone?: string;
  dob?: Dayjs;
  gender?: string;
}

/**
 * FINAL-UAT — "+ Add new patient" INSIDE the booking flow.
 *
 * A walk-in who isn't on file was a dead end here: the receptionist had to
 * abandon the half-assembled booking, register the patient on another page,
 * and start again. This is the walk-in queue drawer's own mini-registration
 * (same fields, same POST /patients), inline; the created patient is handed
 * straight back so the booking continues from where it stood.
 *
 * The server refuses a duplicate IC with a sentence naming the existing
 * record (final-UAT hardening) — surfaced verbatim, because "try a different
 * spelling" is exactly the second-record failure that sentence prevents.
 */
export function InlinePatientCreate({
  initialName,
  onCreated,
  onCancel,
}: {
  initialName?: string;
  onCreated: (patient: Patient) => void;
  onCancel: () => void;
}) {
  const createPatient = useCreatePatient();
  const [form] = Form.useForm<NewPatientValues>();

  const submit = async (values: NewPatientValues) => {
    try {
      const created = await createPatient.mutateAsync({
        name: values.name.trim(),
        identifierType: values.identifierType,
        identifierValue: values.identifierValue.trim(),
        phone: values.phone?.trim() || undefined,
        dob: values.dob ? values.dob.format('YYYY-MM-DD') : undefined,
        gender: values.gender?.trim() || undefined,
      });
      message.success(`${created.name} is registered — continuing the booking.`);
      onCreated(created);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not register the patient.');
    }
  };

  return (
    <Form
      form={form}
      layout="vertical"
      size="small"
      className="kw-flow-new-patient"
      data-testid="inline-patient-create"
      onFinish={submit}
      initialValues={{ name: initialName, identifierType: 'NRIC' }}
    >
      <div className="kw-flow-step" style={{ marginBottom: 8 }}>
        New patient
      </div>
      <Form.Item name="name" label="Full name" rules={[{ required: true, whitespace: true }]}>
        <Input autoFocus placeholder="As on the IC" />
      </Form.Item>
      <Space.Compact style={{ width: '100%' }}>
        <Form.Item name="identifierType" label="ID type" style={{ width: 120 }}>
          <Select
            options={[
              { value: 'NRIC', label: 'NRIC' },
              { value: 'PASSPORT', label: 'Passport' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="identifierValue"
          label="ID number"
          style={{ flex: 1 }}
          rules={[{ required: true, whitespace: true }]}
        >
          <Input placeholder="12 digits for NRIC" />
        </Form.Item>
      </Space.Compact>
      <Space.Compact style={{ width: '100%' }}>
        <Form.Item name="phone" label="Mobile" style={{ flex: 1 }}>
          <Input placeholder="Optional" />
        </Form.Item>
        <Form.Item name="dob" label="Date of birth" style={{ flex: 1 }}>
          <DatePicker
            style={{ width: '100%' }}
            disabledDate={(value) => value.isAfter(dayjs(), 'day')}
          />
        </Form.Item>
      </Space.Compact>
      <Form.Item name="gender" label="Sex">
        <Input placeholder="Optional — e.g. Female" />
      </Form.Item>
      <Space>
        <Button
          type="primary"
          size="small"
          htmlType="submit"
          loading={createPatient.isPending}
          data-testid="create-and-continue"
        >
          Create &amp; continue
        </Button>
        <Button size="small" onClick={onCancel}>
          Back to search
        </Button>
      </Space>
    </Form>
  );
}
