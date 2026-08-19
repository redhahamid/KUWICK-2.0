import { HubCategory, HubShell } from './HubShell';

// M1 (owner-approved layout revision) — Management categories per the
// focused audit: Executive Dashboard is the landing (no submenu of its
// own), then five work groups. Category membership is config here, not
// path-prefix — e.g. Drug Movement keeps its /reports/ URL but belongs to
// Inventory, and Doctor Schedules keeps its /operation/ URL but belongs to
// HR & Incentives. Config-only pages moved to CMS Settings (SettingsLayout);
// their old URLs redirect in App.tsx.
const MANAGEMENT_CATEGORIES: HubCategory[] = [
  {
    key: 'executive',
    label: 'Executive Dashboard',
    items: [{ path: '/management/reports', label: 'Executive Dashboard' }],
  },
  {
    key: 'finance',
    label: 'Finance & Sales',
    items: [
      { path: '/management/reports/day-end', label: 'Day-End Closing' },
      { path: '/management/reports/sales', label: 'Sales Analysis' },
      { path: '/management/reports/invoices', label: 'Invoice Listing' },
    ],
  },
  {
    key: 'operations',
    label: 'Clinic Operations',
    items: [
      { path: '/management/reports/patients', label: 'Patient Analysis' },
      { path: '/management/reports/procedures', label: 'Procedure & Service Analysis' },
      { path: '/management/reports/wait-times', label: 'Waiting Times' },
      { path: '/management/reports/doctors', label: 'Doctor Performance' },
    ],
  },
  {
    key: 'hr',
    label: 'HR & Incentives',
    items: [
      { path: '/management/hr/staff', label: 'Staff' },
      // The roster moved to Appointments ▸ Roster & Availability, so that one
      // screen is the only thing writing provider schedules. Leave and
      // attendance stay here: they are HR facts the roster READS.
      { path: '/appointments/roster', label: 'Roster & Availability' },
      { path: '/management/hr/attendance', label: 'Attendance' },
      { path: '/management/hr/leave-requests', label: 'Leave Requests' },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    items: [
      { path: '/management/stock/health', label: 'Stock Health' },
      { path: '/management/stock/stock-take', label: 'Stock Take' },
      { path: '/management/stock/procurement-requests', label: 'Procurement Requests' },
      { path: '/management/stock/purchase-orders', label: 'Purchase Orders' },
      { path: '/management/stock/items', label: 'Items' },
      { path: '/management/stock/suppliers', label: 'Suppliers' },
      { path: '/management/reports/drug-movement', label: 'Drug Movement' },
    ],
  },
  {
    key: 'panel',
    label: 'Panel & Claims',
    items: [
      { path: '/management/panel/clinics', label: 'Panel Companies' },
      { path: '/management/panel/claims', label: 'Panel Claims' },
    ],
  },
];

export function ManagementLayout() {
  return <HubShell title="Management" categories={MANAGEMENT_CATEGORIES} />;
}
