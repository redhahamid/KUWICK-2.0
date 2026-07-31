import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Form, InputNumber, message, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { platformApi } from './api';
import { PlatformTenant, SubscriptionPlan, TenantSubscription, TenantSubscriptionStatus } from './types';
import { ApiError } from '../core/api-client';

const { Title, Text } = Typography;

const STATUS_COLORS: Record<TenantSubscriptionStatus, string> = {
  TRIAL: 'blue',
  ACTIVE: 'green',
  EXPIRED: 'orange',
  CANCELLED: 'red',
};

interface ActivateFormValues {
  tenantId: string;
  planId: string;
}

interface ExtendState {
  subscription: TenantSubscription;
  extraDays: number;
}

export function PlatformSubscriptionsPage() {
  const queryClient = useQueryClient();
  const [activateOpen, setActivateOpen] = useState(false);
  const [extendState, setExtendState] = useState<ExtendState | null>(null);
  const [form] = Form.useForm<ActivateFormValues>();

  const { data: subscriptions, isLoading } = useQuery({
    queryKey: ['platform', 'subscriptions'],
    queryFn: () => platformApi.get<TenantSubscription[]>('/platform/subscriptions'),
  });
  const { data: tenants } = useQuery({
    queryKey: ['platform', 'tenants'],
    queryFn: () => platformApi.get<PlatformTenant[]>('/platform/tenants'),
  });
  const { data: plans } = useQuery({
    queryKey: ['platform', 'plans'],
    queryFn: () => platformApi.get<SubscriptionPlan[]>('/platform/plans'),
  });

  const activate = useMutation({
    mutationFn: (values: ActivateFormValues) => platformApi.post<TenantSubscription>('/platform/subscriptions', values),
    onSuccess: () => {
      message.success('Subscription activated');
      form.resetFields();
      setActivateOpen(false);
      queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to activate subscription'),
  });

  const extend = useMutation({
    mutationFn: ({ subscription, extraDays }: ExtendState) =>
      platformApi.patch<TenantSubscription>(`/platform/subscriptions/${subscription.id}/extend`, { extraDays }),
    onSuccess: () => {
      message.success('Subscription extended');
      setExtendState(null);
      queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to extend subscription'),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => platformApi.patch<TenantSubscription>(`/platform/subscriptions/${id}/cancel`),
    onSuccess: () => {
      message.success('Subscription cancelled');
      queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to cancel subscription'),
  });

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          All Tenant Subscriptions
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setActivateOpen(true)}>
          Create Subscription
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={subscriptions}
        columns={[
          { title: 'Clinic', render: (_: unknown, s: TenantSubscription) => s.tenant?.name ?? <Text type="secondary">—</Text> },
          { title: 'Plan', render: (_: unknown, s: TenantSubscription) => s.plan?.name ?? 'Trial' },
          {
            title: 'Status',
            render: (_: unknown, s: TenantSubscription) => <Tag color={STATUS_COLORS[s.status]}>{s.status}</Tag>,
          },
          { title: 'Ends At', render: (_: unknown, s: TenantSubscription) => new Date(s.endsAt).toLocaleDateString() },
          {
            title: 'Actions',
            render: (_: unknown, s: TenantSubscription) => (
              <Space>
                <Button type="link" size="small" onClick={() => setExtendState({ subscription: s, extraDays: 30 })}>
                  Extend
                </Button>
                {s.status !== 'CANCELLED' && (
                  <Popconfirm title="Cancel this subscription?" onConfirm={() => cancel.mutate(s.id)}>
                    <Button type="link" size="small" danger>
                      Cancel
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="Manually Activate Subscription"
        open={activateOpen}
        onCancel={() => setActivateOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          Assign a plan to a tenant. This will override any existing active subscription.
        </Text>
        <Form form={form} layout="vertical" onFinish={(values) => activate.mutate(values)}>
          <Form.Item name="tenantId" label="Tenant / Clinic" rules={[{ required: true }]}>
            <Select
              placeholder="Select a Clinic"
              showSearch
              optionFilterProp="label"
              options={(tenants ?? []).map((tenant) => ({ value: tenant.id, label: tenant.name }))}
            />
          </Form.Item>
          <Form.Item name="planId" label="Plan" rules={[{ required: true }]}>
            <Select
              placeholder="Select a Plan"
              options={(plans ?? [])
                .filter((plan) => plan.active)
                .map((plan) => ({ value: plan.id, label: `${plan.name} — RM${Number(plan.priceMyr).toFixed(2)} / ${plan.durationDays} days` }))}
            />
          </Form.Item>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setActivateOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={activate.isPending}>
              Activate
            </Button>
          </Space>
        </Form>
      </Modal>

      <Modal
        title={`Extend — ${extendState?.subscription.tenant?.name ?? ''}`}
        open={!!extendState}
        onCancel={() => setExtendState(null)}
        onOk={() => extendState && extend.mutate(extendState)}
        okText="Extend"
        confirmLoading={extend.isPending}
      >
        <Form layout="vertical">
          <Form.Item label="Extra Days">
            <InputNumber
              min={1}
              value={extendState?.extraDays}
              onChange={(value) => extendState && setExtendState({ ...extendState, extraDays: value ?? 1 })}
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
