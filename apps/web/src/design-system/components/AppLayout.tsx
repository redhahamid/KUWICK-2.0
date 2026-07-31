import { useMemo, useState } from 'react';
import { Avatar, Dropdown, Layout, Menu, Input, Space, Typography } from 'antd';
import { ArrowLeftOutlined, LogoutOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTenantStore } from '../../core/tenant-store';

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
  const tenantId = useTenantStore((state) => state.tenantId);
  const setTenantId = useTenantStore((state) => state.setTenantId);
  const [draftTenantId, setDraftTenantId] = useState(tenantId ?? '');

  const inManagement = location.pathname.startsWith('/management');

  const userMenuItems = useMemo(
    () =>
      inManagement
        ? [
            { key: 'back', icon: <ArrowLeftOutlined />, label: 'Back to Main Menu', onClick: () => navigate('/appointments') },
            { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', disabled: true },
          ]
        : [
            {
              key: 'management',
              icon: <SettingOutlined />,
              label: 'Management',
              onClick: () => navigate('/management/operation/clinics'),
            },
            { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', disabled: true },
          ],
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
        <div style={{ fontWeight: 600, fontSize: 16, flexShrink: 0 }}>Kuwick 2.0</div>

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
          {/* Interim tenant context (docs/DECISIONS.md D-017) — replaced
              by a real session once auth exists. */}
          <Text type="secondary">Tenant ID:</Text>
          <Input
            style={{ width: 260 }}
            placeholder="paste a tenant UUID"
            value={draftTenantId}
            onChange={(event) => setDraftTenantId(event.target.value)}
            onBlur={() => setTenantId(draftTenantId.trim() || null)}
            onPressEnter={() => setTenantId(draftTenantId.trim() || null)}
          />
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
