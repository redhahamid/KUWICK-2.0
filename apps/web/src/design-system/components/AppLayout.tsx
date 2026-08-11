import { useMemo, useState } from 'react';
import { Avatar, Dropdown, Layout, Menu, Space, Typography } from 'antd';
import { ArrowLeftOutlined, BarChartOutlined, LogoutOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../core/auth-store';
import { canViewDispensary } from '../../clinical/dispensary/dispensaryAccess';
import { NotificationBell } from './NotificationBell';
import { ClinicChatWidget } from '../../clinical/ClinicChatWidget';

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
  // KW2-C2 — the nav band from the approved canvas (spec p.2). Two items are
  // NEW here and both point at screens that already exist: "Dashboard" is the
  // Executive Dashboard under Management, "Schedules" is Doctor Schedules.
  // This is a reskin plus items, not a routing change — every 1.0 route is
  // still reachable at the same URL.
  navItem('/management/reports', 'Dashboard'),
  navItem('/appointments', 'Appointments'),
  navItem('/patients', 'Patients'),
  navItem('/queue', 'Queue'),
  navItem('/procedure-queue', 'Tasks'),
  navItem('/management/operation/doctor-schedules', 'Schedules'),
];

/**
 * e-Invoice LHDN is in the approved nav and has no screen behind it yet.
 *
 * Rendered disabled with the reason rather than omitted or linked to nothing:
 * omitting it hides a commitment the clinic has been shown, and a live link
 * to a 404 teaches staff that nav items lie. It becomes a route when the
 * LHDN submission work lands.
 */
const EINVOICE_NAV_ITEM = {
  key: 'einvoice',
  disabled: true,
  label: <span title="LHDN e-Invoice submission is not built yet">e-Invoice LHDN</span>,
};

// G4.5d5b-3 — Dispensary sits beside Queue for the roles that can open it,
// and is absent for the rest. A link that always refuses is its own defect:
// staff learn to ignore refusals, and "not you" stops being distinguishable
// from "something is broken". The SERVER still authorises every request —
// this only decides what is offered.
const DISPENSARY_NAV_ITEM = navItem('/dispensary', 'Dispensary');

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
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);

  const navItems = useMemo(
    () =>
      canViewDispensary(staff?.role)
        ? [...PRIMARY_NAV_ITEMS, DISPENSARY_NAV_ITEM, EINVOICE_NAV_ITEM]
        : [...PRIMARY_NAV_ITEMS, EINVOICE_NAV_ITEM],
    [staff?.role],
  );

  const inManagement = location.pathname.startsWith('/management');
  const inSettings = location.pathname.startsWith('/settings');
  const inHub = inManagement || inSettings;

  const handleLogout = () => {
    clearAuth();
    navigate('/login');
  };

  const userMenuItems = useMemo(
    () =>
      inHub
        ? [
            { key: 'back', icon: <ArrowLeftOutlined />, label: 'Back to Main Menu', onClick: () => navigate('/appointments') },
            inManagement
              ? { key: 'settings', icon: <SettingOutlined />, label: 'Clinic Settings', onClick: () => navigate('/settings') }
              : { key: 'management', icon: <BarChartOutlined />, label: 'Management', onClick: () => navigate('/management/reports') },
            { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', onClick: handleLogout },
          ]
        : [
            {
              key: 'management',
              icon: <BarChartOutlined />,
              label: 'Management',
              onClick: () => navigate('/management/reports'),
            },
            {
              key: 'settings',
              icon: <SettingOutlined />,
              label: 'Clinic Settings',
              onClick: () => navigate('/settings'),
            },
            { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', onClick: handleLogout },
          ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inHub, inManagement, navigate],
  );

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      <Header
        style={{ display: 'flex', alignItems: 'center', gap: 16, height: 54, lineHeight: '54px' }}
        className="kw-app-header kw-app-header-navy"
      >
        <img src="/kuwick-logo.png" alt="Kuwick" style={{ height: 22, flexShrink: 0 }} />

        {inHub && (
          <>
            <Link
              to="/appointments"
              className="kw-app-header-back"
              style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
            >
              <ArrowLeftOutlined /> <span className="kw-app-header-back-label">Back</span>
            </Link>
            {/* minWidth 0 so this truncates instead of pushing the user menu
                off the right edge of a phone, where it was unreachable. */}
            <Text strong style={{ flex: 1, minWidth: 0 }} ellipsis>
              {inSettings ? 'Clinic Settings' : 'Management'}
            </Text>
          </>
        )}

        {!inHub && (
          <Menu
            mode="horizontal"
            theme="dark"
            items={navItems}
            selectedKeys={[location.pathname]}
            style={{ flex: 1, minWidth: 0, borderBottom: 'none', background: 'transparent' }}
          />
        )}

        <Space size={12} style={{ flexShrink: 0 }}>
          {/* The clinic switcher, as a pill (spec p.2). One clinic today shows
              its name and nothing to press — a switcher offering one option
              is a control that teaches people it does nothing. */}
          {tenant?.name && <span className="kw-app-clinic-pill">{tenant.name}</span>}
          <NotificationBell unreadChatCount={unreadChat} onOpenChat={() => setChatOpen(true)} />
          {/* Hidden on a phone by CSS, not removed: the same name and clinic
              are in the avatar's dropdown, and this block is what pushed the
              avatar itself past the right edge where nobody could tap it. */}
          <div className="kw-app-header-identity" style={{ textAlign: 'right', lineHeight: 1.2 }}>
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
          padding: inHub ? 0 : 24,
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: inHub ? 'hidden' : 'auto',
        }}
      >
        <Outlet />
      </Content>
      <ClinicChatWidget open={chatOpen} onOpenChange={setChatOpen} onUnreadChange={setUnreadChat} />
    </Layout>
  );
}
