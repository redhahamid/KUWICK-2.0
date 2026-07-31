import { useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, message, Typography } from 'antd';
import { CloudOutlined, LockOutlined, MailOutlined, SafetyCertificateOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../core/auth-store';
import { ApiError } from '../core/api-client';

const { Title, Text, Paragraph } = Typography;

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

const FEATURE_BULLETS = [
  { icon: <SafetyCertificateOutlined />, title: 'Secure & Reliable', body: 'Enterprise-grade security to protect your data' },
  { icon: <CloudOutlined />, title: 'Cloud Based', body: 'Access your clinic anytime, anywhere' },
  { icon: <ThunderboltOutlined />, title: 'Designed for Clinics', body: 'Built specifically for daily clinic operations' },
];

// Real auth (D-034). Deliberately a raw fetch, not apiClient — login is the
// one call that must never carry a stale/expired Authorization header, and
// keeping it separate avoids any coupling to apiClient's refresh-retry logic.
//
// Branded split-panel layout matches kuwick.com's own login screen (owner-
// supplied reference screenshot) — logo, reception photo, and feature
// bullets on the left, the actual form on the right. "Forgot password" has
// no reset flow yet (contacting the clinic admin is the real path today),
// and "Continue with Google" is omitted entirely rather than shipped as a
// dead button — no OAuth integration exists.
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
    <div style={{ display: 'flex', minHeight: '100vh', background: '#fff' }}>
      <style>{'@media (max-width: 880px) { .kuwick-login-side { display: none !important; } }'}</style>
      <div
        style={{
          flex: '1 1 45%',
          maxWidth: 560,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '48px 56px',
          overflow: 'hidden',
          backgroundImage: 'url(/login-side-photo.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'right center',
        }}
        className="kuwick-login-side"
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(100deg, #f4f8ff 0%, #f4f8ff 42%, rgba(244,248,255,0.55) 62%, rgba(244,248,255,0.05) 78%)',
          }}
        />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <img src="/kuwick-logo.png" alt="Kuwick" style={{ height: 32, display: 'block', marginBottom: 48 }} />
          <Title level={2} style={{ maxWidth: 380, lineHeight: 1.25, marginBottom: 12 }}>
            All-in-one clinic management made <span style={{ color: '#2f5bf6' }}>effortless.</span>
          </Title>
          <Paragraph style={{ maxWidth: 340, color: '#5b6472', fontSize: 15 }}>
            Smart appointment, patient, financial and inventory management — built for modern clinics.
          </Paragraph>
          <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {FEATURE_BULLETS.map((item) => (
              <div key={item.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: '#fff',
                    boxShadow: '0 1px 4px rgba(20,30,60,0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#2f5bf6',
                    flexShrink: 0,
                  }}
                >
                  {item.icon}
                </div>
                <div>
                  <Text strong style={{ display: 'block' }}>
                    {item.title}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {item.body}
                  </Text>
                </div>
              </div>
            ))}
          </div>
        </div>
        <Text type="secondary" style={{ position: 'relative', zIndex: 1, fontSize: 12 }}>
          © 2026 Kuwick Sdn Bhd. All rights reserved.
        </Text>
      </div>

      <div style={{ flex: '1 1 55%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <Title level={3} style={{ marginBottom: 4 }}>
            Welcome back 👋
          </Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 28 }}>
            Sign in to continue to your account
          </Text>
          {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
          <Form layout="vertical" onFinish={handleSubmit} initialValues={{ remember: true }}>
            <Form.Item name="slug" label="Clinic" rules={[{ required: true, message: 'Enter your clinic code' }]}>
              <Input placeholder="e.g. smoke-test-clinic" autoComplete="organization" />
            </Form.Item>
            <Form.Item name="email" label="Email" rules={[{ required: true, message: 'Enter your email' }]}>
              <Input prefix={<MailOutlined style={{ color: '#9aa4b2' }} />} placeholder="name@clinic.com" autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Enter your password' }]}>
              <Input.Password prefix={<LockOutlined style={{ color: '#9aa4b2' }} />} autoComplete="current-password" />
            </Form.Item>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, marginTop: -8 }}>
              <Form.Item name="remember" valuePropName="checked" noStyle>
                <Checkbox>Remember me</Checkbox>
              </Form.Item>
              <a
                onClick={(event) => {
                  event.preventDefault();
                  message.info('Contact your clinic administrator to reset your password.');
                }}
              >
                Forgot password?
              </a>
            </div>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              Log in
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
}
