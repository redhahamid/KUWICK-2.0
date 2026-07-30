import { useState } from 'react';
import { Button, Drawer, Form, InputNumber, Input, Radio, Select, message, Space, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useServices, useCreateService } from './hooks/useServices';
import { CreateServiceDto, Service, ServiceOrderType } from './types';
import { ApiError } from '../core/api-client';

const { Title } = Typography;

type TypeFilter = 'ALL' | ServiceOrderType;

export function ServicesPage() {
  const { data: services, isLoading } = useServices();
  const createService = useCreateService();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
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

  const filtered = services?.filter((service) => {
    const matchesType = typeFilter === 'ALL' || service.orderType === typeFilter;
    const matchesSearch =
      !search ||
      service.name.toLowerCase().includes(search.toLowerCase()) ||
      service.code?.toLowerCase().includes(search.toLowerCase());
    return matchesType && matchesSearch;
  });

  const taskCount = services?.filter((s) => s.orderType === 'TASK_ORDER').length ?? 0;
  const standardCount = services?.filter((s) => s.orderType === 'STANDARD_SERVICE').length ?? 0;

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Services &amp; Procedures
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Add Service
        </Button>
      </Space>

      <Space style={{ marginBottom: 16, width: '100%' }} wrap>
        <Input
          style={{ width: 260 }}
          placeholder="Search name or Code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Radio.Group
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          optionType="button"
          buttonStyle="solid"
          options={[
            { label: `All Services (${services?.length ?? 0})`, value: 'ALL' },
            { label: `Task Flow Services (${taskCount})`, value: 'TASK_ORDER' },
            { label: `Standard Services (${standardCount})`, value: 'STANDARD_SERVICE' },
          ]}
        />
      </Space>

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={filtered}
        columns={[
          { title: 'No.', render: (_: unknown, __: Service, index: number) => index + 1 },
          { title: 'Code', render: (_: unknown, r: Service) => r.code ?? '—' },
          { title: 'Service Name', dataIndex: 'name' },
          { title: 'Category', render: (_: unknown, r: Service) => r.category ?? '—' },
          { title: 'Default Duration (min)', dataIndex: 'durationMinutesDefault' },
          { title: 'Price (RM)', dataIndex: 'price' },
          { title: 'Active', dataIndex: 'active', render: (value: boolean) => (value ? 'Yes' : 'No') },
        ]}
      />
      <Drawer title="Add Service" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ orderType: 'STANDARD_SERVICE' }}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="orderType" label="Type">
            <Select
              options={[
                { value: 'STANDARD_SERVICE', label: 'Standard Service' },
                { value: 'TASK_ORDER', label: 'Task Order' },
              ]}
            />
          </Form.Item>
          <Form.Item name="code" label="Code (e.g. XRAYCHEST)">
            <Input />
          </Form.Item>
          <Form.Item name="category" label="Category (e.g. Laboratory, Imaging, Procedure)">
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
