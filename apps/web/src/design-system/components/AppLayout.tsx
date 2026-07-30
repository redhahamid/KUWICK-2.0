import { useState } from 'react';
import { Layout, Menu, Input, Typography } from 'antd';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useTenantStore } from '../../core/tenant-store';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

function navItem(path: string, label: string) {
  return { key: path, label: <Link to={path}>{label}</Link> };
}

// Hand-maintained for now; becomes role-driven once RBAC exists
// (docs/DECISIONS.md D-018) — see docs/UI_DESIGN_SYSTEM.md §4.
const NAV_ITEMS = [
  navItem('/appointments', 'Appointments'),
  navItem('/clinics', 'Clinics'),
  navItem('/patients', 'Patients'),
  navItem('/staff', 'Staff'),
  navItem('/services', 'Services'),
  navItem('/doctor-schedules', 'Doctor Schedules'),
  navItem('/doctor-service-qualifications', 'Qualifications'),
  navItem('/slot-capacity-configs', 'Slot Capacity'),
  navItem('/items', 'Items'),
  navItem('/suppliers', 'Suppliers'),
  navItem('/stock-levels', 'Stock Levels'),
  navItem('/low-stock', 'Low Stock'),
  navItem('/negative-stock', 'Negative Stock'),
  navItem('/procurement-requests', 'Procurement Requests'),
  navItem('/purchase-orders', 'Purchase Orders'),
];

export function AppLayout() {
  const location = useLocation();
  const tenantId = useTenantStore((state) => state.tenantId);
  const setTenantId = useTenantStore((state) => state.setTenantId);
  const [draftTenantId, setDraftTenantId] = useState(tenantId ?? '');

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={220}>
        <div style={{ padding: 16, fontWeight: 600, fontSize: 16 }}>Kuwick 2.0</div>
        <Menu mode="inline" items={NAV_ITEMS} selectedKeys={[location.pathname]} />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
            padding: '0 24px',
          }}
        >
          {/* Interim tenant context (docs/DECISIONS.md D-017) — replaced
              by a real session once auth exists. */}
          <Text type="secondary">Tenant ID:</Text>
          <Input
            style={{ width: 340 }}
            placeholder="paste a tenant UUID"
            value={draftTenantId}
            onChange={(event) => setDraftTenantId(event.target.value)}
            onBlur={() => setTenantId(draftTenantId.trim() || null)}
            onPressEnter={() => setTenantId(draftTenantId.trim() || null)}
          />
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}

export function linkItem(path: string, label: string) {
  return { key: path, label: <Link to={path}>{label}</Link> };
}
