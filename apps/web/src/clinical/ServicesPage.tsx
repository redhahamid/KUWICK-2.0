import { useEffect, useState } from 'react';
import { Button, Card, Drawer, Form, InputNumber, Input, Radio, Select, Space, Switch, Table, Typography, message } from 'antd';
import { FileTextOutlined, PlusOutlined } from '@ant-design/icons';
import { useServices, useCreateService, useUpdateService } from './hooks/useServices';
import { useCreateFormTemplate, useFormTemplateForService, useUpdateFormTemplate } from './hooks/useFormTemplates';
import { FormFieldBuilder } from './FormFieldBuilder';
import { CreateServiceDto, FormField, Service, ServiceOrderType } from './types';
import { ApiError } from '../core/api-client';
import { PageHeader } from '../design-system/components/PageHeader';

const { Text } = Typography;

type TypeFilter = 'ALL' | ServiceOrderType;

function ResultFormBuilder({ service }: { service: Service }) {
  const { data: template, isLoading } = useFormTemplateForService(service.id);
  const createTemplate = useCreateFormTemplate(service.id);
  const updateTemplate = useUpdateFormTemplate(service.id);
  const [fields, setFields] = useState<FormField[]>([]);

  useEffect(() => {
    setFields(template?.fields ?? []);
  }, [template]);

  const handleSave = async () => {
    try {
      if (template) {
        await updateTemplate.mutateAsync({ id: template.id, dto: { fields } });
      } else {
        await createTemplate.mutateAsync({ name: `${service.name} Result Form`, serviceCatalogId: service.id, fields });
      }
      message.success('Result form saved');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to save result form');
    }
  };

  if (isLoading) return null;

  return (
    <Card
      size="small"
      title={
        <Space>
          <FileTextOutlined /> Result Form Builder
        </Space>
      }
      style={{ marginTop: 16 }}
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Define the fields staff fill in when completing a {service.name} task — shown instead of a bare free-text
        result box.
      </Text>
      <FormFieldBuilder fields={fields} onChange={setFields} />
      <Button
        type="primary"
        style={{ marginTop: 12 }}
        loading={createTemplate.isPending || updateTemplate.isPending}
        disabled={fields.length === 0}
        onClick={handleSave}
      >
        Save Result Form
      </Button>
    </Card>
  );
}

export function ServicesPage() {
  const { data: services, isLoading } = useServices();
  const createService = useCreateService();
  const updateService = useUpdateService();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [form] = Form.useForm<CreateServiceDto>();

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (service: Service) => {
    setEditing(service);
    form.setFieldsValue({
      name: service.name,
      code: service.code ?? undefined,
      orderType: service.orderType,
      category: service.category ?? undefined,
      durationMinutesDefault: service.durationMinutesDefault,
      price: Number(service.price),
    });
    setOpen(true);
  };

  const handleSubmit = async (values: CreateServiceDto) => {
    try {
      if (editing) {
        await updateService.mutateAsync({ id: editing.id, dto: values });
        message.success('Service updated');
      } else {
        await createService.mutateAsync(values);
        message.success('Service created');
      }
      form.resetFields();
      setOpen(false);
      setEditing(null);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to save service');
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
      <PageHeader
        title="Services &amp; Procedures"
        extra={
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add Service
        </Button>
          </>
        }
      />

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
          {
            title: 'Actions',
            render: (_: unknown, r: Service) => (
              <Button size="small" onClick={() => openEdit(r)}>
                Edit
              </Button>
            ),
          },
        ]}
      />
      <Drawer
        title={editing ? `Edit Service — ${editing.name}` : 'Add Service'}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnHidden
        width={editing?.orderType === 'TASK_ORDER' ? 560 : undefined}
      >
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
          {editing && (
            <Form.Item name="active" label="Active" valuePropName="checked" initialValue={editing.active}>
              <Switch />
            </Form.Item>
          )}
          <Button type="primary" htmlType="submit" loading={createService.isPending || updateService.isPending} block>
            {editing ? 'Save Changes' : 'Create'}
          </Button>
        </Form>
        {editing && editing.orderType === 'TASK_ORDER' && <ResultFormBuilder service={editing} />}
      </Drawer>
    </>
  );
}
