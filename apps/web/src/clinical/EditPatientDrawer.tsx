import { Button, DatePicker, Drawer, Form, Input, Select, message } from 'antd';
import dayjs from 'dayjs';
import { useUpdatePatient } from '../core/hooks/usePatients';
import { Patient, UpdatePatientDto } from '../core/types';
import { ApiError } from '../core/api-client';

interface EditPatientDrawerProps {
  patient: Patient | null;
  open: boolean;
  onClose: () => void;
}

interface EditPatientFormValues extends Omit<UpdatePatientDto, 'dob'> {
  dob?: dayjs.Dayjs;
}

export function EditPatientDrawer({ patient, open, onClose }: EditPatientDrawerProps) {
  return (
    <Drawer title="Edit Patient" open={open} onClose={onClose} destroyOnHidden width={420}>
      {patient && <EditPatientForm patient={patient} onClose={onClose} />}
    </Drawer>
  );
}

/**
 * The drawer body — a child on purpose (A1): `Form.useForm` and its `<Form>`
 * mount and unmount together with the drawer's content (destroyOnHidden), so
 * the instance is never left connected to nothing. Mounting fresh per open
 * also replaces the old setFieldsValue effect: the patient's current values
 * ARE the initial values of this mount.
 */
function EditPatientForm({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const updatePatient = useUpdatePatient();
  const [form] = Form.useForm<EditPatientFormValues>();

  const handleSubmit = async (values: EditPatientFormValues) => {
    try {
      await updatePatient.mutateAsync({
        id: patient.id,
        dto: { ...values, dob: values.dob?.format('YYYY-MM-DD') },
      });
      message.success('Patient updated');
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to update patient');
    }
  };

  return (
    <Form
      form={form}
      layout="vertical"
      onFinish={handleSubmit}
      initialValues={{
        name: patient.name,
        identifierType: patient.identifierType,
        identifierValue: patient.identifierValue,
        phone: patient.phone ?? undefined,
        gender: patient.gender ?? undefined,
        race: patient.race ?? undefined,
        address: patient.address ?? undefined,
        emergencyContactName: patient.emergencyContactName ?? undefined,
        emergencyContactPhone: patient.emergencyContactPhone ?? undefined,
        dob: patient.dob ? dayjs(patient.dob) : undefined,
      }}
    >
      <Form.Item name="name" label="Name" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="identifierType" label="ID Type">
        <Select
          options={[
            { value: 'NRIC', label: 'NRIC' },
            { value: 'PASSPORT', label: 'Passport' },
          ]}
        />
      </Form.Item>
      <Form.Item name="identifierValue" label="ID Number">
        <Input />
      </Form.Item>
      <Form.Item name="phone" label="Phone">
        <Input />
      </Form.Item>
      <Form.Item name="dob" label="Date of Birth">
        <DatePicker style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="gender" label="Gender">
        <Input />
      </Form.Item>
      <Form.Item name="race" label="Race">
        <Input />
      </Form.Item>
      <Form.Item name="address" label="Address">
        <Input.TextArea rows={2} />
      </Form.Item>
      <Form.Item name="emergencyContactName" label="Emergency Contact Name">
        <Input />
      </Form.Item>
      <Form.Item name="emergencyContactPhone" label="Emergency Contact Phone">
        <Input />
      </Form.Item>
      {/* Allergies are recorded as ALERTS now, from the header chip or the
          alerts view — with an author and a timestamp this free-text field
          never had. A second box here would put the same clinical fact back
          into two stores, which is the duplication that was just removed. */}
      <Button type="primary" htmlType="submit" loading={updatePatient.isPending} block>
        Save
      </Button>
    </Form>
  );
}
