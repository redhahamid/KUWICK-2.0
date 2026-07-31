import { useState } from 'react';
import { Alert, Button, Form, Input, Typography } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
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
// tenants themselves, so there's no clinic/slug field here at all. Styled
// as a dark variant of the clinic LoginPage's branding (same logo lockup)
// so the two are recognizably part of the same product, but never visually
// confusable — this is the system-owner console, not a clinic's own login.
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
      navigate('/platform/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'radial-gradient(circle at 30% 20%, #1c2540 0%, #0b0e1a 65%)',
      }}
    >
      <div style={{ width: 380, padding: 40, background: '#151a2c', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.45)' }}>
        <div style={{ background: '#fff', borderRadius: 10, padding: '8px 16px', width: 'fit-content', margin: '0 auto 28px' }}>
          <img src="/kuwick-logo.png" alt="Kuwick" style={{ height: 24, display: 'block' }} />
        </div>
        <Title level={4} style={{ textAlign: 'center', marginBottom: 4, color: '#fff' }}>
          Platform Console
        </Title>
        <Text style={{ display: 'block', textAlign: 'center', marginBottom: 24, color: '#8b93a8' }}>
          System owner sign-in
        </Text>
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
        <Form layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="email" label={<span style={{ color: '#c3c9d9' }}>Email</span>} rules={[{ required: true, message: 'Enter your email' }]}>
            <Input prefix={<MailOutlined style={{ color: '#6b7280' }} />} placeholder="owner@kuwick.dev" autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            label={<span style={{ color: '#c3c9d9' }}>Password</span>}
            rules={[{ required: true, message: 'Enter your password' }]}
          >
            <Input.Password prefix={<LockOutlined style={{ color: '#6b7280' }} />} autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block size="large">
            Sign In
          </Button>
        </Form>
      </div>
    </div>
  );
}
