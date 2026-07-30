import { useState } from 'react';
import { Button, Drawer, Form, Input, message, Space, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useCreateSupplier, useSuppliers } from './hooks/useSuppliers';
import { CreateSupplierDto } from './types';
import { ApiError } from '../core/api-client';

const { Title } = Typography;

export function SuppliersPage() {
  const { data: suppliers, isLoading } = useSuppliers();
  const createSupplier = useCreateSupplier();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<CreateSupplierDto>();

  const handleSubmit = async (values: CreateSupplierDto) => {
    try {
      await createSupplier.mutateAsync(values);
      message.success('Supplier created');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create supplier');
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Suppliers
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Add Supplier
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={suppliers}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Contact', dataIndex: 'contactName', render: (value: string | null) => value ?? '—' },
          { title: 'Phone', dataIndex: 'phone', render: (value: string | null) => value ?? '—' },
          { title: 'Email', dataIndex: 'email', render: (value: string | null) => value ?? '—' },
          { title: 'Active', dataIndex: 'active', render: (value: boolean) => (value ? 'Yes' : 'No') },
        ]}
      />
      <Drawer title="Add Supplier" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="contactName" label="Contact Name">
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Phone">
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createSupplier.isPending} block>
            Create
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
