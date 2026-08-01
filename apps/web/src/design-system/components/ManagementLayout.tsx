import { useMemo, useState } from 'react';
import { Layout, Menu } from 'antd';
import { Link, Outlet, useLocation } from 'react-router-dom';

const { Sider, Content } = Layout;

function item(path: string, label: string) {
  return { key: path, label: <Link to={path}>{label}</Link> };
}

// Klinik Hijraa CMS's own admin panel groups exactly this way (Operation,
// Stock, Panel, Finance — HR folded in here as its own group per the
// owner's phrasing) — director/admin-staff screens, kept out of the
// primary top nav which is for daily clinical/front-desk operation.
// Finance has no pages yet (e-Invoice pending owner's kuwick.com reference
// screenshots, DECISIONS.md D-032) so its group is omitted until there's
// something to link to.
// Collapsible submenus (not `type: 'group'`, which antd always renders
// fully expanded) — with 5 groups and up to 9 items each, an always-open
// list ran off the bottom of the Sider with no way to scroll to it.
const MENU_GROUPS = [
  {
    key: 'reports',
    label: 'Reports',
    children: [
      item('/management/reports', 'Executive Dashboard'),
      item('/management/reports/day-end', 'Day-End Closing'),
      item('/management/reports/sales', 'Sales Analysis'),
      item('/management/reports/patients', 'Patient Analysis'),
      item('/management/reports/procedures', 'Procedure Analysis'),
      item('/management/reports/doctors', 'Doctor Performance'),
      item('/management/reports/invoices', 'Invoice Listing'),
      item('/management/reports/drug-movement', 'Drug Movement'),
      item('/management/reports/wait-times', 'Waiting Times'),
    ],
  },
  {
    key: 'operation',
    label: 'Operation',
    children: [
      item('/management/operation/clinics', 'Clinics'),
      item('/management/operation/services', 'Services'),
      item('/management/operation/doctor-schedules', 'Doctor Schedules'),
      item('/management/operation/qualifications', 'Qualifications'),
      item('/management/operation/slot-capacity', 'Slot Capacity'),
      item('/management/operation/diagnoses', 'Diagnoses Directory'),
      item('/management/operation/rooms', 'Rooms & Stations'),
      item('/management/operation/queue-display', 'Queue Screen'),
      item('/management/operation/document-templates', 'Document Templates'),
    ],
  },
  {
    key: 'hr',
    label: 'HR',
    children: [
      item('/management/hr/staff', 'Staff'),
      item('/management/hr/attendance', 'Attendance'),
      item('/management/hr/leave-requests', 'Leave Requests'),
      item('/management/hr/public-holidays', 'Public Holidays'),
    ],
  },
  {
    key: 'stock',
    label: 'Stock',
    children: [
      item('/management/stock/items', 'Items'),
      item('/management/stock/suppliers', 'Suppliers'),
      item('/management/stock/levels', 'Stock Levels'),
      item('/management/stock/low-stock', 'Low Stock'),
      item('/management/stock/negative-stock', 'Negative Stock'),
      item('/management/stock/near-expiry', 'Near-Expiry Stock'),
      item('/management/stock/stock-take', 'Stock Take'),
      item('/management/stock/procurement-requests', 'Procurement Requests'),
      item('/management/stock/purchase-orders', 'Purchase Orders'),
    ],
  },
  {
    key: 'panel',
    label: 'Panel',
    children: [item('/management/panel/clinics', 'Panel Clinics'), item('/management/panel/claims', 'Panel Claims')],
  },
];

export const MANAGEMENT_PATHS = new Set(MENU_GROUPS.flatMap((group) => group.children.map((child) => child.key)));

function groupKeyForPath(pathname: string): string | undefined {
  return MENU_GROUPS.find((group) => group.children.some((child) => child.key === pathname))?.key;
}

export function ManagementLayout() {
  const location = useLocation();
  const activeGroupKey = useMemo(() => groupKeyForPath(location.pathname), [location.pathname]);
  const [openKeys, setOpenKeys] = useState<string[]>(activeGroupKey ? [activeGroupKey] : ['reports']);

  return (
    <Layout style={{ height: '100%', background: '#fff' }}>
      <Sider width={220} theme="light" style={{ borderRight: '1px solid #f0f0f0', overflowY: 'auto', height: '100%' }}>
        <Menu
          mode="inline"
          items={MENU_GROUPS}
          selectedKeys={[location.pathname]}
          openKeys={openKeys}
          // Accordion behaviour — only the most recently opened group stays
          // expanded, so the list of visible items stays short regardless
          // of how many groups exist.
          onOpenChange={(keys) => setOpenKeys(keys.length > 0 ? [keys[keys.length - 1]] : [])}
          style={{ borderRight: 'none' }}
        />
      </Sider>
      <Content style={{ padding: '0 24px', overflowY: 'auto' }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
