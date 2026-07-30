import { useState } from 'react';
import { Button, Drawer, Form, Input, InputNumber, message, Space, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useCreateItem, useItems } from './hooks/useItems';
import { CreateItemDto } from './types';
import { ApiError } from '../core/api-client';

const { Title } = Typography;

export function ItemsPage() {
  const { data: items, isLoading } = useItems();
  const createItem = useCreateItem();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<CreateItemDto>();

  const handleSubmit = async (values: CreateItemDto) => {
    try {
      await createItem.mutateAsync(values);
      message.success('Item created');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create item');
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Items
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Add Item
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={items}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Category', dataIndex: 'category', render: (value: string | null) => value ?? '—' },
          { title: 'Unit', dataIndex: 'unitOfMeasure', render: (value: string | null) => value ?? '—' },
          { title: 'Sell Price (RM)', dataIndex: 'sellPrice' },
          { title: 'Cost (RM)', dataIndex: 'cost', render: (value: string | null) => value ?? '—' },
          { title: 'Active', dataIndex: 'active', render: (value: boolean) => (value ? 'Yes' : 'No') },
        ]}
      />
      <Drawer title="Add Item" open={open} onClose={() => setOpen(false)} destroyOnHidden width={420}>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="category" label="Category">
            <Input />
          </Form.Item>
          <Form.Item name="unitOfMeasure" label="Unit of Measure">
            <Input placeholder="e.g. tablet, box, ml" />
          </Form.Item>
          <Form.Item name="sellPrice" label="Sell Price (RM)" rules={[{ required: true }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="cost" label="Cost (RM)">
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="doseDefault" label="Default Dose">
            <Input />
          </Form.Item>
          <Form.Item name="frequencyDefault" label="Default Frequency">
            <Input />
          </Form.Item>
          <Form.Item name="durationDefault" label="Default Duration">
            <Input />
          </Form.Item>
          <Form.Item name="instruction" label="Instruction">
            <Input />
          </Form.Item>
          <Form.Item name="indication" label="Indication">
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createItem.isPending} block>
            Create
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
