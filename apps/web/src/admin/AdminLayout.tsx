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
 * The existing Management area is untouched and keeps its URLs. This is an
 * addition, not a replacement — the reports a clinic already relies on continue
 * to work while the new modules are taken through UAT.
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
    ],
  },
  {
    key: 'stock',
    label: 'Stock',
    items: [
      { path: '/admin/stock', label: 'What needs attention' },
      { path: '/admin/stock/transfers', label: 'Transfers' },
      { path: '/admin/stock/stock-take', label: 'Stock take' },
      { path: '/admin/stock/movements', label: 'Movement ledger' },
    ],
  },
  {
    key: 'panel',
    label: 'Panel',
    items: [
      { path: '/admin/panel', label: 'Claim workspace' },
      { path: '/admin/panel/configuration', label: 'Panel configuration' },
    ],
  },
  {
    key: 'hr',
    label: 'HR',
    items: [
      { path: '/admin/hr', label: 'Today' },
      { path: '/admin/hr/employees', label: 'Employees' },
      { path: '/admin/hr/attendance', label: 'Timesheets' },
      { path: '/admin/hr/payroll', label: 'Payroll' },
      { path: '/admin/hr/incentives', label: 'Doctor incentives' },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    items: [
      { path: '/admin/finance', label: 'Overview' },
      { path: '/admin/finance/day-end', label: 'Day-end closing' },
      { path: '/admin/finance/payments', label: 'Payments' },
      { path: '/admin/finance/receivables', label: 'Outstanding' },
      { path: '/admin/finance/credit-notes', label: 'Credit notes' },
    ],
  },
];

export function AdminLayout() {
  return <HubShell title="Administration" categories={ADMIN_CATEGORIES} />;
}
