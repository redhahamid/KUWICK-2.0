import { useMemo } from 'react';
import { Avatar, Dropdown, Layout, Menu } from 'antd';
import { LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { usePlatformAuthStore } from '../core/platform-auth-store';

const { Header, Content } = Layout;

function navItem(path: string, label: string) {
  return { key: path, label: <Link to={path}>{label}</Link> };
}

// System Owner console shell (D-037) — top nav mirrors the owner's real
// system (Dashboard | Clinics | Plans | Subscriptions | Panel Clinics |
// Procedures | Document Templates | Settings). Diagnoses from the
// reference stays absent until the global-diagnoses catalog phase lands.
const NAV_ITEMS = [
  navItem('/platform/dashboard', 'Dashboard'),
  navItem('/platform/clinics', 'Clinics'),
  navItem('/platform/plans', 'Plans'),
  navItem('/platform/subscriptions', 'Subscriptions'),
  navItem('/platform/panel-clinics', 'Panel Clinics'),
  navItem('/platform/procedures', 'Procedures'),
  navItem('/platform/document-templates', 'Document Templates'),
  navItem('/platform/statutory-tables', 'Statutory Tables'),
  navItem('/platform/settings', 'Settings'),
];

export function PlatformLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const admin = usePlatformAuthStore((state) => state.admin);
  const clearAuth = usePlatformAuthStore((state) => state.clearAuth);

  const userMenuItems = useMemo(
    () => [
      {
        key: 'logout',
        icon: <LogoutOutlined />,
        label: 'Log Out',
        onClick: () => {
          clearAuth();
          // D-049 — one login for everyone: back to the unified form, same
          // as a clinic staff logout.
          navigate('/login');
        },
      },
    ],
    [clearAuth, navigate],
  );

  return (
    <Layout style={{ minHeight: '100vh', background: '#f7f8fa' }}>
      <Header
        style={{
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          padding: '0 24px',
          borderBottom: '1px solid #f0f0f0',
          height: 56,
          lineHeight: '56px',
        }}
      >
        <img src="/kuwick-logo.png" alt="Kuwick" style={{ height: 22, flexShrink: 0 }} />
        <Menu
          mode="horizontal"
          items={NAV_ITEMS}
          selectedKeys={[location.pathname]}
          style={{ flex: 1, minWidth: 0, borderBottom: 'none' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ textAlign: 'right', lineHeight: 1.2 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{admin?.fullName}</div>
            <div style={{ fontSize: 11, color: '#8b93a8', textTransform: 'uppercase' }}>System Owner</div>
          </div>
          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <Avatar style={{ cursor: 'pointer', backgroundColor: '#151a2c' }} icon={<UserOutlined />} />
          </Dropdown>
        </div>
      </Header>
      <Content style={{ padding: 24, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
