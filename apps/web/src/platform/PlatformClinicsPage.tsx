import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Form, Input, message, Modal, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { platformApi } from './api';
import { LoginAsResponse, PlatformTenant } from './types';
import { useAuthStore } from '../core/auth-store';
import { ApiError } from '../core/api-client';

const { Title, Text } = Typography;

interface CreateClinicFormValues {
  name: string;
  slug: string;
  address?: string;
  phone?: string;
  email?: string;
  registrationNo?: string;
  startAsTrial?: boolean;
}

export function PlatformClinicsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setClinicSession = useAuthStore((state) => state.setSession);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<CreateClinicFormValues>();

  const { data: tenants, isLoading } = useQuery({
    queryKey: ['platform', 'tenants'],
    queryFn: () => platformApi.get<PlatformTenant[]>('/platform/tenants'),
  });

  const createTenant = useMutation({
    mutationFn: (values: CreateClinicFormValues) => platformApi.post<PlatformTenant>('/platform/tenants', values),
    onSuccess: () => {
      message.success('Clinic created');
      form.resetFields();
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to create clinic'),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      platformApi.patch<PlatformTenant>(`/platform/tenants/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform'] }),
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to update clinic'),
  });

  // "Login As" (D-037) — swaps the clinic-staff auth store to the
  // impersonated session and enters the clinic app. Logging out of that
  // session returns to /login like any staff member; the platform-admin
  // session in its separate store is untouched.
  const loginAs = useMutation({
    mutationFn: (id: string) => platformApi.post<LoginAsResponse>(`/platform/tenants/${id}/login-as`),
    onSuccess: (data) => {
      setClinicSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        staff: data.staff,
        tenant: data.tenant,
      });
      message.success(`Signed in to ${data.tenant.name} as ${data.staff.fullName}`);
      navigate('/appointments');
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Login As failed'),
  });

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          Clinics Management
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Create Clinic
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={tenants}
        columns={[
          {
            title: 'Name / Contact',
            render: (_: unknown, tenant: PlatformTenant) => (
              <div>
                <Text strong>{tenant.name}</Text>
                <div style={{ fontSize: 12, color: '#8b93a8' }}>
                  {tenant.clinics?.[0]?.address ?? '—'}
                  {tenant.clinics?.[0]?.email ? ` · ${tenant.clinics[0].email}` : ''}
                </div>
              </div>
            ),
          },
          { title: 'Slug', render: (_: unknown, tenant: PlatformTenant) => tenant.slug ?? '—' },
          {
            title: 'Status',
            render: (_: unknown, tenant: PlatformTenant) => (
              <Tag color={tenant.status === 'active' ? 'green' : 'red'}>{tenant.status}</Tag>
            ),
          },
          {
            title: 'Subscription',
            render: (_: unknown, tenant: PlatformTenant) => {
              const subscription = tenant.subscriptions?.[0];
              if (!subscription) return <Text type="secondary">None</Text>;
              return (
                <div>
                  <Text>{subscription.plan?.name ?? 'Trial'}</Text>
                  <div style={{ fontSize: 12, color: '#8b93a8' }}>
                    Exp: {new Date(subscription.endsAt).toLocaleDateString()}
                  </div>
                </div>
              );
            },
          },
          {
            title: 'Stats',
            render: (_: unknown, tenant: PlatformTenant) => (
              <div style={{ fontSize: 12 }}>
                <div>{tenant._count?.staff ?? 0} users</div>
                <div>{tenant._count?.patients ?? 0} patients</div>
              </div>
            ),
          },
          {
            title: 'Actions',
            render: (_: unknown, tenant: PlatformTenant) => (
              <Space>
                <Button type="link" size="small" onClick={() => loginAs.mutate(tenant.id)} loading={loginAs.isPending}>
                  Login As
                </Button>
                {tenant.status === 'active' ? (
                  <Popconfirm
                    title="Suspend this clinic? Its staff will not be able to log in."
                    onConfirm={() => setStatus.mutate({ id: tenant.id, status: 'suspended' })}
                  >
                    <Button type="link" size="small" danger>
                      Suspend
                    </Button>
                  </Popconfirm>
                ) : (
                  <Button
                    type="link"
                    size="small"
                    onClick={() => setStatus.mutate({ id: tenant.id, status: 'active' })}
                  >
                    Reactivate
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal title="Create Clinic" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(values) => createTenant.mutate(values)}>
          <Form.Item name="name" label="Clinic Name" rules={[{ required: true }]}>
            <Input placeholder="Clinic Name" />
          </Form.Item>
          <Form.Item
            name="slug"
            label="Login Slug"
            rules={[{ required: true, pattern: /^[a-z0-9-]+$/, message: 'Lowercase letters, numbers, and hyphens only' }]}
          >
            <Input placeholder="e.g. klinik-alpha" />
          </Form.Item>
          <Form.Item name="address" label="Address">
            <Input placeholder="Full Address" />
          </Form.Item>
          <Space style={{ display: 'flex' }} styles={{ item: { flex: 1 } }}>
            <Form.Item name="phone" label="Phone Number">
              <Input placeholder="+6012..." />
            </Form.Item>
            <Form.Item name="email" label="Clinic Email">
              <Input placeholder="info@clinic.com" />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex', alignItems: 'center' }} styles={{ item: { flex: 1 } }}>
            <Form.Item name="registrationNo" label="Registration No. (SSM/MEPCSA)">
              <Input placeholder="202401000001" />
            </Form.Item>
            <Form.Item name="startAsTrial" valuePropName="checked" style={{ marginTop: 24 }}>
              <Checkbox>Start as Trial</Checkbox>
            </Form.Item>
          </Space>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={createTenant.isPending}>
              Create
            </Button>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
