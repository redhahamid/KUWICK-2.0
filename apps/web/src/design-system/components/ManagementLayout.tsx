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
const MENU_GROUPS = [
  {
    type: 'group' as const,
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
    type: 'group' as const,
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
    type: 'group' as const,
    label: 'HR',
    children: [
      item('/management/hr/staff', 'Staff'),
      item('/management/hr/attendance', 'Attendance'),
      item('/management/hr/leave-requests', 'Leave Requests'),
      item('/management/hr/public-holidays', 'Public Holidays'),
    ],
  },
  {
    type: 'group' as const,
    label: 'Stock',
    children: [
      item('/management/stock/items', 'Items'),
      item('/management/stock/suppliers', 'Suppliers'),
      item('/management/stock/levels', 'Stock Levels'),
      item('/management/stock/low-stock', 'Low Stock'),
      item('/management/stock/negative-stock', 'Negative Stock'),
      item('/management/stock/procurement-requests', 'Procurement Requests'),
      item('/management/stock/purchase-orders', 'Purchase Orders'),
    ],
  },
  {
    type: 'group' as const,
    label: 'Panel',
    children: [item('/management/panel/clinics', 'Panel Clinics'), item('/management/panel/claims', 'Panel Claims')],
  },
];

export const MANAGEMENT_PATHS = new Set(MENU_GROUPS.flatMap((group) => group.children.map((child) => child.key)));

export function ManagementLayout() {
  const location = useLocation();

  return (
    <Layout style={{ height: '100%', background: '#fff' }}>
      <Sider width={220} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
        <Menu
          mode="inline"
          items={MENU_GROUPS}
          selectedKeys={[location.pathname]}
          style={{ height: '100%', borderRight: 'none' }}
        />
      </Sider>
      <Content style={{ padding: '0 24px', overflowY: 'auto' }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
