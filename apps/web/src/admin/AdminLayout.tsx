import { HubCategory, HubShell } from '../design-system/components/HubShell';

/**
 * THE FIVE MODULES, as one product.
 *
 * Operation, Stock, Panel, HR, Finance — the brief's own top-level list, in the
 * brief's own order. Each category's LANDING page is the one that answers that
 * module's first question, so opening a module tells you what needs doing
 * before it tells you anything else:
 *
 *   Operation  how is the clinic performing?
 *   Stock      what requires attention today?
 *   Panel      what is unsubmitted, rejected, and outstanding?
 *   HR         who is working, absent, and waiting for a decision?
 *   Finance    did yesterday reconcile, and what is outstanding?
 *
 * ONE ADMIN, NOT TWO PRODUCTS.
 *
 * Roughly a third of the screens below were built before this programme and
 * live under /management or /settings. Whether a screen was implemented in
 * this wave or two years ago is an implementation detail, and it was leaking
 * into the owner's experience: reaching item pricing from Admin ▸ Stock meant
 * leaving Admin and arriving in what felt like a different application.
 *
 * So they are MOUNTED HERE TOO. The same component, the same API, the same
 * data — rendered inside this shell, reachable from this rail. Their original
 * URLs still work and still resolve to the Management shell, because deep
 * links, bookmarks and the redirects in App.tsx all point at them; nothing was
 * moved, only given a second, better-placed door.
 *
 * What was NOT done, deliberately: no screen was copied, no query re-written,
 * no second roster / item catalogue / claim record / employee record created.
 * A duplicated screen is a screen that drifts.
 */
const ADMIN_CATEGORIES: HubCategory[] = [
  {
    key: 'operation',
    label: 'Operation',
    items: [
      { path: '/admin/operation', label: 'Overview' },
      { path: '/admin/operation/segments', label: 'Segment P&L' },
      { path: '/admin/operation/programmes', label: 'Programmes' },
      { path: '/admin/operation/marketing', label: 'Marketing' },
      // Pre-existing analysis screens. Clinic performance is one subject, and
      // it was split across two hubs.
      { path: '/admin/operation/patients', label: 'Patient Analysis' },
      { path: '/admin/operation/procedures', label: 'Procedure Analysis' },
      { path: '/admin/operation/doctors', label: 'Doctor Performance' },
      { path: '/admin/operation/wait-times', label: 'Waiting Times' },
    ],
  },
  {
    key: 'stock',
    label: 'Stock',
    items: [
      { path: '/admin/stock', label: 'What needs attention' },
      { path: '/admin/stock/items', label: 'Items & Pricing' },
      { path: '/admin/stock/locations', label: 'Stock by Location' },
      { path: '/admin/stock/transfers', label: 'Transfers' },
      { path: '/admin/stock/purchase-orders', label: 'Purchase Orders' },
      { path: '/admin/stock/procurement-requests', label: 'Procurement Requests' },
      { path: '/admin/stock/suppliers', label: 'Suppliers' },
      { path: '/admin/stock/stock-take', label: 'Stock Take' },
      { path: '/admin/stock/movements', label: 'Movement Ledger' },
      { path: '/admin/stock/near-expiry', label: 'Near Expiry' },
      // Slow movers and stock value are VIEWS of the attention board rather
      // than screens of their own. They get REAL paths, not a query string:
      // this rail highlights on an exact pathname match, so `?view=` items
      // would have navigated correctly and then highlighted nothing, which
      // reads as a dead link. Routed to the same component with a prop.
      { path: '/admin/stock/slow-moving', label: 'Slow Moving' },
      { path: '/admin/stock/value', label: 'Stock Value' },
    ],
  },
  {
    key: 'panel',
    label: 'Panel',
    items: [
      { path: '/admin/panel', label: 'Claim workspace' },
      { path: '/admin/panel/configuration', label: 'Panel configuration' },
      { path: '/admin/panel/batches', label: 'Claim batches' },
      { path: '/admin/panel/companies', label: 'Panel companies' },
    ],
  },
  {
    key: 'hr',
    label: 'HR',
    items: [
      { path: '/admin/hr', label: 'Today' },
      { path: '/admin/hr/employees', label: 'Employees' },
      { path: '/admin/hr/attendance', label: 'Timesheets' },
      { path: '/admin/hr/leave', label: 'Leave' },
      { path: '/admin/hr/roster', label: 'Roster' },
      { path: '/admin/hr/payroll', label: 'Payroll' },
      { path: '/admin/hr/incentives', label: 'Doctor incentives' },
      { path: '/admin/hr/benefits', label: 'Staff benefits' },
      { path: '/admin/hr/access', label: 'Roles & access' },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    items: [
      { path: '/admin/finance', label: 'Overview' },
      { path: '/admin/finance/sales', label: 'Sales' },
      { path: '/admin/finance/day-end', label: 'Day-end closing' },
      { path: '/admin/finance/payments', label: 'Payments' },
      { path: '/admin/finance/invoices', label: 'Invoices' },
      { path: '/admin/finance/receivables', label: 'Outstanding' },
      { path: '/admin/finance/payables', label: 'Supplier payables' },
      { path: '/admin/finance/credit-notes', label: 'Credit notes' },
      { path: '/admin/finance/tax', label: 'Tax / SST' },
      { path: '/admin/finance/profitability', label: 'Profitability' },
      { path: '/admin/finance/inter-company', label: 'Inter-company' },
      { path: '/admin/finance/e-invoice', label: 'e-Invoice (LHDN)' },
    ],
  },
];

export function AdminLayout() {
  // `kw-hub--admin` is what makes a mounted Management screen look native:
  // see the "ONE ADMIN" block in index.css. It normalises the older header,
  // card and table idioms to this hub's, and only inside this hub.
  return <HubShell scopeClass="kw-hub--admin" title="Administration" categories={ADMIN_CATEGORIES} />;
}
