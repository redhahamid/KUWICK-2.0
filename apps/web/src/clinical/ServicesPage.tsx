import { useState } from 'react';
import { Button, Drawer, Form, InputNumber, Input, message, Space, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useServices, useCreateService } from './hooks/useServices';
import { CreateServiceDto } from './types';
import { ApiError } from '../core/api-client';

const { Title } = Typography;

export function ServicesPage() {
  const { data: services, isLoading } = useServices();
  const createService = useCreateService();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<CreateServiceDto>();

  const handleSubmit = async (values: CreateServiceDto) => {
    try {
      await createService.mutateAsync(values);
      message.success('Service created');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create service');
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Services
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Add Service
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={services}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Default Duration (min)', dataIndex: 'durationMinutesDefault' },
          { title: 'Price (RM)', dataIndex: 'price' },
          { title: 'Active', dataIndex: 'active', render: (value: boolean) => (value ? 'Yes' : 'No') },
        ]}
      />
      <Drawer title="Add Service" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="durationMinutesDefault"
            label="Default Duration (minutes)"
            rules={[{ required: true }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="price" label="Price (RM)">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createService.isPending} block>
            Create
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
