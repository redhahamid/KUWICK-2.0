import { useState } from 'react';
import { Button, DatePicker, Drawer, Form, Input, message, Select, Space, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { usePatients, useCreatePatient } from './hooks/usePatients';
import { CreatePatientDto } from './types';
import { ApiError } from './api-client';

const { Title } = Typography;

interface PatientFormValues extends Omit<CreatePatientDto, 'dob'> {
  dob?: dayjs.Dayjs;
}

export function PatientsPage() {
  const { data: patients, isLoading } = usePatients();
  const createPatient = useCreatePatient();
  const [open, setOpen] = useState(false);
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
          { title: 'Name', dataIndex: 'name' },
          { title: 'Identifier Type', dataIndex: 'identifierType' },
          { title: 'Identifier', dataIndex: 'identifierValue' },
          { title: 'Gender', dataIndex: 'gender', render: (value: string | null) => value ?? '—' },
        ]}
      />
      <Drawer title="Add Patient" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ identifierType: 'NRIC' }}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="identifierType" label="Identifier Type" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'NRIC', label: 'NRIC' },
                { value: 'PASSPORT', label: 'Passport' },
              ]}
            />
          </Form.Item>
          <Form.Item name="identifierValue" label="Identifier Value" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="dob" label="Date of Birth">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="gender" label="Gender">
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createPatient.isPending} block>
            Create
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
