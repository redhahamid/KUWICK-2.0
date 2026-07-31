import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Drawer, Form, Input, InputNumber, message, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { platformApi } from './api';
import { SubscriptionPlan } from './types';
import { ApiError } from '../core/api-client';

const { Title } = Typography;

interface PlanFormValues {
  name: string;
  description?: string;
  priceMyr: number;
  durationDays: number;
  maxUsers?: number;
  maxPatients?: number;
  maxStorageMb?: number;
}

export function PlatformPlansPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null);
  const [form] = Form.useForm<PlanFormValues>();

  const { data: plans, isLoading } = useQuery({
    queryKey: ['platform', 'plans'],
    queryFn: () => platformApi.get<SubscriptionPlan[]>('/platform/plans'),
  });

  const save = useMutation({
    mutationFn: (values: PlanFormValues) =>
      editing
        ? platformApi.patch<SubscriptionPlan>(`/platform/plans/${editing.id}`, values)
        : platformApi.post<SubscriptionPlan>('/platform/plans', values),
    onSuccess: () => {
      message.success(editing ? 'Plan updated' : 'Plan created');
      form.resetFields();
      setOpen(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['platform', 'plans'] });
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to save plan'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => platformApi.delete(`/platform/plans/${id}`),
    onSuccess: () => {
      message.success('Plan deleted');
      queryClient.invalidateQueries({ queryKey: ['platform', 'plans'] });
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to delete plan'),
  });

  const openEdit = (plan: SubscriptionPlan) => {
    setEditing(plan);
    form.setFieldsValue({
      name: plan.name,
      description: plan.description ?? undefined,
      priceMyr: Number(plan.priceMyr),
      durationDays: plan.durationDays,
      maxUsers: plan.maxUsers ?? undefined,
      maxPatients: plan.maxPatients ?? undefined,
      maxStorageMb: plan.maxStorageMb ?? undefined,
    });
    setOpen(true);
  };

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          Subscription Plans
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null);
            form.resetFields();
            setOpen(true);
          }}
        >
          Create Plan
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={plans}
        columns={[
          {
            title: 'Name',
            render: (_: unknown, plan: SubscriptionPlan) => (
              <div>
                <div style={{ fontWeight: 500 }}>{plan.name}</div>
                <div style={{ fontSize: 12, color: '#8b93a8' }}>{plan.description ?? ''}</div>
              </div>
            ),
          },
          { title: 'Price (RM)', render: (_: unknown, plan: SubscriptionPlan) => Number(plan.priceMyr).toFixed(2) },
          { title: 'Duration', render: (_: unknown, plan: SubscriptionPlan) => `${plan.durationDays} Days` },
          {
            title: 'Limits',
            render: (_: unknown, plan: SubscriptionPlan) => (
              <div style={{ fontSize: 12 }}>
                <div>Users: {plan.maxUsers ?? '∞'}</div>
                <div>Patients: {plan.maxPatients ?? '∞'}</div>
                <div>Storage: {plan.maxStorageMb ? `${plan.maxStorageMb} MB` : '∞'}</div>
              </div>
            ),
          },
          {
            title: 'Status',
            render: (_: unknown, plan: SubscriptionPlan) => (
              <Tag color={plan.active ? 'green' : 'default'}>{plan.active ? 'Active' : 'Inactive'}</Tag>
            ),
          },
          {
            title: 'Actions',
            render: (_: unknown, plan: SubscriptionPlan) => (
              <Space>
                <Button type="link" size="small" onClick={() => openEdit(plan)}>
                  Edit
                </Button>
                <Popconfirm title="Delete this plan?" onConfirm={() => remove.mutate(plan.id)}>
                  <Button type="link" size="small" danger>
                    Delete
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        title={editing ? 'Edit Plan' : 'Create Plan'}
        open={open}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Form.Item name="name" label="Plan Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Basic Plan" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="A basic plan for small clinics..." />
          </Form.Item>
          <Form.Item name="priceMyr" label="Price (RM)" rules={[{ required: true }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="durationDays" label="Duration (Days)" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="maxUsers" label="Max Users (blank = unlimited)">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="maxPatients" label="Max Patients (blank = unlimited)">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="maxStorageMb" label="Max Storage MB (blank = unlimited)">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={save.isPending} block>
            {editing ? 'Save Changes' : 'Create Plan'}
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
