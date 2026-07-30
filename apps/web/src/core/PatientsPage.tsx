import { useState } from 'react';
import { Button, DatePicker, Drawer, Form, Input, message, Select, Space, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { usePatients, useCreatePatient } from './hooks/usePatients';
import { CreatePatientDto, Patient } from './types';
import { ApiError } from './api-client';
import { AddToQueueDrawer } from '../clinical/AddToQueueDrawer';

const { Title } = Typography;

interface PatientFormValues extends Omit<CreatePatientDto, 'dob'> {
  dob?: dayjs.Dayjs;
}

export function PatientsPage() {
  const { data: patients, isLoading } = usePatients();
  const createPatient = useCreatePatient();
  const [open, setOpen] = useState(false);
  const [queuingPatient, setQueuingPatient] = useState<Patient | null>(null);
  const [form] = Form.useForm<PatientFormValues>();

  const handleSubmit = async (values: PatientFormValues) => {
    try {
      await createPatient.mutateAsync({ ...values, dob: values.dob?.format('YYYY-MM-DD') });
      message.success('Patient created');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create patient');
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Patients
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Add Patient
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={patients}
        columns={[
          {
            title: 'Name',
            dataIndex: 'name',
            render: (value: string, record) => <Link to={`/patients/${record.id}`}>{value}</Link>,
          },
          { title: 'Identifier Type', dataIndex: 'identifierType' },
          { title: 'Identifier', dataIndex: 'identifierValue' },
          { title: 'Phone', dataIndex: 'phone', render: (value: string | null) => value ?? '—' },
          { title: 'Gender', dataIndex: 'gender', render: (value: string | null) => value ?? '—' },
          {
            title: 'Actions',
            render: (_, record: Patient) => (
              <Button size="small" onClick={() => setQueuingPatient(record)}>
                Add to Daily Queue
              </Button>
            ),
          },
        ]}
      />
      <Drawer title="Add Patient" open={open} onClose={() => setOpen(false)} destroyOnHidden width={420}>
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ identifierType: 'NRIC' }}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="identifierType" label="ID Type" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'NRIC', label: 'NRIC' },
                { value: 'PASSPORT', label: 'Passport' },
              ]}
            />
          </Form.Item>
          <Form.Item name="identifierValue" label="ID Number" rules={[{ required: true }]}>
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
          <Form.Item name="allergies" label="Known Allergies">
            <Select mode="tags" open={false} placeholder="Type an allergy and press Enter" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createPatient.isPending} block>
            Create
          </Button>
        </Form>
      </Drawer>
      <AddToQueueDrawer patient={queuingPatient} onClose={() => setQueuingPatient(null)} />
    </>
  );
}
