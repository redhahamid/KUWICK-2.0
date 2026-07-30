import { useState } from 'react';
import { Button, Drawer, Form, Input, message, Space, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useClinics, useCreateClinic } from './hooks/useClinics';
import { CreateClinicDto } from './types';
import { ApiError } from './api-client';

const { Title } = Typography;

export function ClinicsPage() {
  const { data: clinics, isLoading } = useClinics();
  const createClinic = useCreateClinic();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<CreateClinicDto>();

  const handleSubmit = async (values: CreateClinicDto) => {
    try {
      await createClinic.mutateAsync(values);
      message.success('Clinic created');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create clinic');
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Clinics
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Add Clinic
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={clinics}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Address', dataIndex: 'address', render: (value: string | null) => value ?? '—' },
          { title: 'Timezone', dataIndex: 'timezone' },
        ]}
      />
      <Drawer title="Add Clinic" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="address" label="Address">
            <Input />
          </Form.Item>
          <Form.Item name="timezone" label="Timezone" tooltip="Defaults to Asia/Kuala_Lumpur">
            <Input placeholder="Asia/Kuala_Lumpur" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createClinic.isPending} block>
            Create
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
