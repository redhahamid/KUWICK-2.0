import { Button, Drawer, Form, Input, Select, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useClinics } from '../core/hooks/useClinics';
import { useStaff } from '../hr/hooks/useStaff';
import { useAddToQueue } from './hooks/useQueueTickets';
import { Patient } from '../core/types';
import { AddToQueueDto } from './types';
import { ApiError } from '../core/api-client';

interface AddToQueueDrawerProps {
  patient: Patient | null;
  onClose: () => void;
}

const BILLING_TYPE_OPTIONS = [
  { value: 'Self-pay', label: 'Self-pay' },
  { value: 'Panel', label: 'Panel' },
];

export function AddToQueueDrawer({ patient, onClose }: AddToQueueDrawerProps) {
  const { data: clinics } = useClinics();
  const { data: staff } = useStaff();
  const addToQueue = useAddToQueue();
  const [form] = Form.useForm<Omit<AddToQueueDto, 'patientId'>>();
  const navigate = useNavigate();

  const handleSubmit = async (values: Omit<AddToQueueDto, 'patientId'>) => {
    if (!patient) return;
    try {
      await addToQueue.mutateAsync({ ...values, patientId: patient.id });
      message.success('Added to today\'s queue');
      form.resetFields();
      onClose();
      navigate('/queue');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to add to queue');
    }
  };

  return (
    <Drawer title={patient ? `Add ${patient.name} to Daily Queue` : 'Add to Daily Queue'} open={Boolean(patient)} onClose={onClose} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item name="clinicId" label="Clinic" rules={[{ required: true }]}>
          <Select options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))} />
        </Form.Item>
        <Form.Item name="staffId" label="Doctor" rules={[{ required: true }]}>
          <Select options={staff?.map((member) => ({ value: member.id, label: member.fullName }))} />
        </Form.Item>
        <Form.Item name="billingType" label="Billing Type" rules={[{ required: true }]}>
          <Select options={BILLING_TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item name="presentingComplaint" label="Presenting Complaint">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={addToQueue.isPending} block>
          Add to Queue
        </Button>
      </Form>
    </Drawer>
  );
}
