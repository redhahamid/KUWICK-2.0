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
  address?: string;
  phone?: string;
  email?: string;
  registrationNo?: string;
  startAsTrial?: boolean;
  ownerFullName: string;
  ownerEmail: string;
  ownerPassword: string;
}

interface EditClinicFormValues {
  name: string;
  registrationNo?: string;
  address?: string;
  phone?: string;
  email?: string;
}

export function PlatformClinicsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setClinicSession = useAuthStore((state) => state.setSession);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlatformTenant | null>(null);
  const [form] = Form.useForm<CreateClinicFormValues>();
  const [editForm] = Form.useForm<EditClinicFormValues>();

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

  const updateTenant = useMutation({
    mutationFn: ({ id, values }: { id: string; values: EditClinicFormValues }) =>
      platformApi.patch<PlatformTenant>(`/platform/tenants/${id}`, values),
    onSuccess: () => {
      message.success('Clinic updated');
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (error) => message.error(error instanceof ApiError ? error.message : 'Failed to update clinic'),
  });

  const openEdit = (tenant: PlatformTenant) => {
    setEditing(tenant);
    editForm.setFieldsValue({
      name: tenant.name,
      registrationNo: tenant.registrationNo ?? undefined,
      address: tenant.clinics?.[0]?.address ?? undefined,
      phone: tenant.clinics?.[0]?.phone ?? undefined,
      email: tenant.clinics?.[0]?.email ?? undefined,
    });
  };

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
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            // A previously abandoned attempt's values persist in the form
            // instance even with destroyOnHidden — always open clean.
            form.resetFields();
            setOpen(true);
          }}
        >
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
                <Button type="link" size="small" onClick={() => openEdit(tenant)}>
                  Edit
                </Button>
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
      <Modal title="Edit Clinic" open={Boolean(editing)} onCancel={() => setEditing(null)} footer={null} destroyOnHidden>
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(values) => editing && updateTenant.mutate({ id: editing.id, values })}
        >
          <Form.Item name="name" label="Clinic Name" rules={[{ required: true }]}>
            <Input placeholder="Clinic Name" />
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
          <Form.Item name="registrationNo" label="Registration No. (SSM/MEPCSA)">
            <Input placeholder="202401000001" />
          </Form.Item>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={updateTenant.isPending}>
              Save
            </Button>
          </Space>
        </Form>
      </Modal>

      <Modal title="Create Clinic" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(values) => createTenant.mutate(values)}>
          <Form.Item name="name" label="Clinic Name" rules={[{ required: true }]}>
            <Input placeholder="Clinic Name" />
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
          <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12, marginBottom: 12 }}>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>
              Owner Admin Login
            </Text>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
              The clinic owner signs in with these and can then create logins for their own staff (Management → HR →
              Staff).
            </Text>
            <Form.Item name="ownerFullName" label="Owner Full Name" rules={[{ required: true, message: 'Enter the owner’s name' }]}>
              <Input placeholder="Dr. Aisyah Binti Ahmad" />
            </Form.Item>
            <Space style={{ display: 'flex' }} styles={{ item: { flex: 1 } }}>
              <Form.Item
                name="ownerEmail"
                label="Owner Login Email"
                rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}
              >
                <Input placeholder="owner@clinic.com" />
              </Form.Item>
              <Form.Item
                name="ownerPassword"
                label="Owner Password"
                rules={[{ required: true, min: 8, message: 'At least 8 characters' }]}
              >
                <Input.Password placeholder="Min 8 characters" />
              </Form.Item>
            </Space>
          </div>
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
