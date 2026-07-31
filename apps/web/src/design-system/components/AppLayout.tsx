import { useMemo } from 'react';
import { Avatar, Dropdown, Layout, Menu, Space, Typography } from 'antd';
import { ArrowLeftOutlined, LogoutOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../core/auth-store';

const { Header, Content } = Layout;
const { Text } = Typography;

function navItem(path: string, label: string) {
  return { key: path, label: <Link to={path}>{label}</Link> };
}

// Everyday operational screens — always visible in the top nav, mirroring
// the audited kuwick.com top-level nav (Dashboard/Appointments/Patients/
// ...). No general "Dashboard" route exists yet, so it's omitted rather
// than invented.
const PRIMARY_NAV_ITEMS = [
  navItem('/appointments', 'Appointments'),
  navItem('/patients', 'Patients'),
  navItem('/queue', 'Queue'),
  navItem('/procedure-queue', 'Tasks'),
];

// Management — HR, Stock, Panel, Finance, Operation: director/admin-staff
// screens, not daily clinical/front-desk operation. Reached via the user
// menu's "Management" entry, matching Klinik Hijraa CMS's own admin-panel
// separation (docs/DECISIONS.md D-018: hand-maintained for now, becomes
// role-driven once RBAC exists). The grouped sub-nav itself lives in
// ManagementLayout's left Sider, not here.

// Top horizontal nav instead of a left Sider — frees the full viewport
// width for the Patient Dashboard's Canvas/Flow content (user feedback:
// the 220px-wide left sidebar was eating into space Canvas layout needs).
export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const staff = useAuthStore((state) => state.staff);
  const tenant = useAuthStore((state) => state.tenant);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  const inManagement = location.pathname.startsWith('/management');

  const handleLogout = () => {
    clearAuth();
    navigate('/login');
  };

  const userMenuItems = useMemo(
    () =>
      inManagement
        ? [
            { key: 'back', icon: <ArrowLeftOutlined />, label: 'Back to Main Menu', onClick: () => navigate('/appointments') },
            { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', onClick: handleLogout },
          ]
        : [
            {
              key: 'management',
              icon: <SettingOutlined />,
              label: 'Management',
              onClick: () => navigate('/management/operation/clinics'),
            },
            { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', onClick: handleLogout },
          ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inManagement, navigate],
  );

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Header
        style={{
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 24px',
          borderBottom: '1px solid #f0f0f0',
          height: 56,
          lineHeight: '56px',
        }}
      >
        <img src="/kuwick-logo.png" alt="Kuwick" style={{ height: 22, flexShrink: 0 }} />

        {inManagement && (
          <>
            <Link to="/appointments" style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <ArrowLeftOutlined /> Back
            </Link>
            <Text strong style={{ flex: 1 }}>
              Management
            </Text>
          </>
        )}

        {!inManagement && (
          <Menu
            mode="horizontal"
            theme="light"
            items={PRIMARY_NAV_ITEMS}
            selectedKeys={[location.pathname]}
            style={{ flex: 1, minWidth: 0, borderBottom: 'none' }}
          />
        )}

        <Space size={12} style={{ flexShrink: 0 }}>
          <div style={{ textAlign: 'right', lineHeight: 1.2 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{staff?.fullName}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {tenant?.name}
            </Text>
          </div>
          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <Avatar style={{ cursor: 'pointer', backgroundColor: '#4338ca' }} icon={<UserOutlined />} />
          </Dropdown>
        </Space>
      </Header>
      <Content
        style={{
          padding: inManagement ? 0 : 24,
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: inManagement ? 'hidden' : 'auto',
        }}
      >
        <Outlet />
      </Content>
    </Layout>
  );
}
