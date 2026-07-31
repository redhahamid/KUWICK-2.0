import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../core/auth-store';
import { ApiError } from '../core/api-client';

const { Title, Text } = Typography;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

interface LoginFormValues {
  slug: string;
  email: string;
  password: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
  staff: { id: string; fullName: string; role: string };
  tenant: { id: string; name: string; slug: string | null };
}

// Real auth (D-034). Deliberately a raw fetch, not apiClient — login is the
// one call that must never carry a stale/expired Authorization header, and
// keeping it separate avoids any coupling to apiClient's refresh-retry logic.
export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const handleSubmit = async (values: LoginFormValues) => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        throw new ApiError('Invalid clinic, email, or password', response.status, null);
      }
      const data = (await response.json()) as LoginResponse;
      setSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        staff: data.staff,
        tenant: { id: data.tenant.id, name: data.tenant.name, slug: data.tenant.slug },
      });
      navigate('/appointments');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f5f5f5' }}>
      <Card style={{ width: 380 }}>
        <Title level={3} style={{ textAlign: 'center', marginBottom: 4 }}>
          Kuwick 2.0
        </Title>
        <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 24 }}>
          Sign in to your clinic
        </Text>
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
        <Form layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="slug" label="Clinic" rules={[{ required: true, message: 'Enter your clinic code' }]}>
            <Input placeholder="e.g. smoke-test-clinic" autoComplete="organization" />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, message: 'Enter your email' }]}>
            <Input placeholder="you@clinic.com" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Enter your password' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block>
            Sign In
          </Button>
        </Form>
      </Card>
    </div>
  );
}
