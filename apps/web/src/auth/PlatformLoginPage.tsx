import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { usePlatformAuthStore } from '../core/platform-auth-store';
import { ApiError } from '../core/api-client';

const { Title, Text } = Typography;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

interface PlatformLoginFormValues {
  email: string;
  password: string;
}

interface PlatformLoginResponse {
  accessToken: string;
  admin: { id: string; email: string; fullName: string };
}

// Real auth (D-034). A wholly separate login from clinic staff — manages
// tenants themselves, so there's no clinic/slug field here at all.
export function PlatformLoginPage() {
  const navigate = useNavigate();
  const setSession = usePlatformAuthStore((state) => state.setSession);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const handleSubmit = async (values: PlatformLoginFormValues) => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/platform/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        throw new ApiError('Invalid email or password', response.status, null);
      }
      const data = (await response.json()) as PlatformLoginResponse;
      setSession({ accessToken: data.accessToken, admin: data.admin });
      navigate('/platform/tenants');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#1f1f1f' }}>
      <Card style={{ width: 380 }}>
        <Title level={3} style={{ textAlign: 'center', marginBottom: 4 }}>
          Kuwick Platform
        </Title>
        <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 24 }}>
          Platform administrator sign-in
        </Text>
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
        <Form layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="email" label="Email" rules={[{ required: true, message: 'Enter your email' }]}>
            <Input placeholder="owner@kuwick.dev" autoComplete="username" />
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
