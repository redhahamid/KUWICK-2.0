import type { HubCategory } from '../design-system/components/HubShell';

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
export const ADMIN_CATEGORIES: HubCategory[] = [
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
      { path: '/admin/stock/new-item-requests', label: 'New Item Requests' },
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
      { path: '/admin/panel/import', label: 'Import claims' },
      { path: '/admin/panel/configuration', label: 'Panel configuration' },
      { path: '/admin/panel/batches', label: 'Claim batches' },
      { path: '/admin/panel/companies', label: 'Panel companies' },
    ],
  },
  {
    key: 'hr',
    label: 'HR',
    // A workspace, not a set of pages: somebody spends a morning moving
    // between attendance, leave and payroll and needs to know where they are
    // the whole time.
    layout: 'rail',
    // CLICKING "HR" AND TYPING /admin/hr HAVE TO LAND IN THE SAME PLACE.
    // Without this the module tab went to the first rail entry, Employees,
    // while the bare URL redirected to Payroll — the same gesture, two
    // answers. Payroll is the answer: paying people is why this module is
    // opened at all. Employees keeps its seat first in the rail because that
    // is the order the work is set up in, not the order it is done in.
    landing: '/admin/hr/payroll',
    settings: { path: '/admin/hr/settings', label: 'Settings' },
    items: [
      /*
       * SIX DESTINATIONS, PLUS SETTINGS. NAMED FOR THE WORK.
       *
       * This row read: Today · Employees · Timesheets · Leave · Claims ·
       * Roster · Payroll · Doctor incentives · Locum sessions · Staff
       * benefits · Reports · Payroll settings — twelve, and the owner who
       * designed the system was still asking "why are there so many tabs?"
       *
       * It went to six, and the six still had two problems. "Overview" is a
       * word for a screen, not for work: nobody arrives at a clinic meaning to
       * do an overview. And "Attendance & Leave" bundled three different
       * decisions — was somebody here, may somebody be away, do we owe
       * somebody money back — behind one label, so two of the three were
       * invisible until you clicked the third.
       *
       * Six now, each the name of a thing a clinic manager comes here to do.
       * Payroll is where HR opens, because paying people is why this module
       * is opened at all.
       *
       * Settings is deliberately NOT one of the six. It is set up once and
       * then rarely opened; giving it a permanent seat put configuration in
       * front of somebody trying to run a Tuesday.
       *
       * `covers` keeps every absorbed URL lighting the section that now owns
       * it — a bookmark that lands somewhere unlit teaches people the
       * navigation is lying to them.
       */
      {
        // "Employees" rather than "People": it is the word on the button that
        // adds one, on the payroll register's first column, and in every
        // sentence the product writes about them.
        path: '/admin/hr/employees',
        label: 'Employees',
        // Medical Benefits joins the section that owns the employee record.
        // It is a benefits workflow opened when a claim comes up, not a place
        // somebody goes weekly, and a permanent seat beside Payroll made it
        // look like a sixth kind of monthly work.
        covers: ['/admin/hr/benefits'],
      },
      {
        // Doctor incentives and locum sessions are payroll INPUTS. They had
        // seats in this rail as though they were places you go, which is how
        // an owner ends up believing there are three payrolls.
        path: '/admin/hr/payroll',
        label: 'Payroll',
        covers: ['/admin/hr/incentives', '/admin/hr/locum'],
      },
      {
        // Was somebody meant to work, and did they? Roster and the timesheet
        // are two halves of that one question, so they are tabs inside this
        // rather than two rail entries.
        path: '/admin/hr/attendance',
        label: 'Attendance',
      },
      { path: '/admin/hr/leave', label: 'Leave' },
      { path: '/admin/hr/claims', label: 'Claims' },
      { path: '/admin/hr/reports', label: 'Reports' },
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
      { path: '/admin/finance/panel-money', label: 'Panel money' },
      { path: '/admin/finance/credit-notes', label: 'Credit notes' },
      { path: '/admin/finance/tax', label: 'Tax / SST' },
      { path: '/admin/finance/profitability', label: 'Profitability' },
      { path: '/admin/finance/inter-company', label: 'Inter-company' },
      { path: '/admin/finance/e-invoice', label: 'e-Invoice (LHDN)' },
    ],
  },
];
