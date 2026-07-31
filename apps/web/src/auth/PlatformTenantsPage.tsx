import { useEffect, useState } from 'react';
import { Button, Drawer, Form, Input, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { usePlatformAuthStore } from '../core/platform-auth-store';
import { ApiError } from '../core/api-client';

const { Title } = Typography;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

interface Tenant {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  createdAt: string;
}

interface CreateTenantFormValues {
  name: string;
  slug: string;
}

async function platformRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { accessToken } = usePlatformAuthStore.getState();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    throw new ApiError(response.statusText, response.status, null);
  }
  return (await response.json()) as T;
}

// Real auth (D-034). Minimal by design — the owner is sharing screenshots
// of their real day-to-day tenant-management flow (Klinik Hijraa CMS-style),
// so this stays a plain list/create until that reference arrives rather
// than guessing at a richer UI now.
export function PlatformTenantsPage() {
  const admin = usePlatformAuthStore((state) => state.admin);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<CreateTenantFormValues>();

  const loadTenants = async () => {
    setLoading(true);
    try {
      const data = await platformRequest<Tenant[]>('/platform/tenants');
      setTenants(data);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to load tenants');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (values: CreateTenantFormValues) => {
    setCreating(true);
    try {
      await platformRequest('/platform/tenants', { method: 'POST', body: JSON.stringify(values) });
      message.success('Tenant created');
      form.resetFields();
      setOpen(false);
      await loadTenants();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create tenant');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Tenants
          </Title>
          <Typography.Text type="secondary">Signed in as {admin?.fullName ?? admin?.email}</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Add Tenant
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={tenants}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Slug', render: (_: unknown, r: Tenant) => r.slug ?? '—' },
          { title: 'Status', render: (_: unknown, r: Tenant) => <Tag color={r.status === 'active' ? 'green' : 'default'}>{r.status}</Tag> },
        ]}
      />
      <Drawer title="Add Tenant" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="Clinic Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Klinik Hijraa Bangi" />
          </Form.Item>
          <Form.Item
            name="slug"
            label="Login Slug"
            rules={[{ required: true, pattern: /^[a-z0-9-]+$/, message: 'Lowercase letters, numbers, and hyphens only' }]}
          >
            <Input placeholder="e.g. hijraa-bangi" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={creating} block>
            Create Tenant
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
