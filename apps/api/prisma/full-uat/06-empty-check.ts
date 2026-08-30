/**
 * A SWEEP, NOT A CAPTURE. Opens every route the pack photographs and reports
 * any screen whose table rendered antd's empty state.
 *
 * This exists because an empty table in a review pack is indistinguishable
 * from a feature that does not work, and three of them shipped in the first
 * pass before this caught them: procurement requests and the DRAFT credit note
 * were seeded only at Contoh Bandar, which the branch-pinned owner account
 * cannot see; no stock transfer carried the inter-company flag, so a working
 * screen listed nothing; and HR Today read "Nobody is rostered" because the
 * roster skipped weekends and the pack happened to regenerate on a Sunday.
 *
 * Run it after seeding and before capturing. One route is expected to report
 * empty — the marketing prepared-message queue, which is empty until somebody
 * builds an audience, and the pack photographs it both ways on purpose.
 */
import { launch, open, settle } from './harness';

const ROUTES = [
  '/admin/operation', '/admin/operation/segments', '/admin/operation/programmes',
  '/admin/operation/marketing', '/admin/operation/patients', '/admin/operation/procedures',
  '/admin/operation/doctors', '/admin/operation/wait-times',
  '/admin/stock', '/admin/stock/items', '/admin/stock/locations', '/admin/stock/transfers',
  '/admin/stock/stock-take', '/admin/stock/movements', '/admin/stock/purchase-orders',
  '/admin/stock/procurement-requests', '/admin/stock/suppliers', '/admin/stock/near-expiry',
  '/admin/stock/slow-moving', '/admin/stock/value',
  '/admin/panel', '/admin/panel/configuration', '/admin/panel/batches', '/admin/panel/companies',
  '/admin/hr', '/admin/hr/employees', '/admin/hr/attendance', '/admin/hr/leave',
  '/admin/hr/roster', '/admin/hr/payroll', '/admin/hr/incentives', '/admin/hr/benefits',
  '/admin/hr/roles', '/admin/hr/access',
  '/admin/finance', '/admin/finance/sales', '/admin/finance/day-end', '/admin/finance/payments',
  '/admin/finance/invoices', '/admin/finance/outstanding', '/admin/finance/credit-notes',
  '/admin/finance/tax', '/admin/finance/profitability', '/admin/finance/inter-company',
];

async function main() {
  const { browser, page } = await launch();
  const empty: string[] = [];
  for (const route of ROUTES) {
    await open(page, route);
    await settle(page, 400);
    const tables = await page.locator('.ant-table').count();
    const blanks = await page.locator('.ant-table .ant-empty').count();
    if (tables > 0 && blanks > 0) {
      const labels = await page.locator('.ant-table .ant-empty .ant-empty-description, .ant-table .ant-empty').allInnerTexts();
      empty.push(`${route}  — ${blanks}/${tables} table(s) empty: ${labels.join(' / ').slice(0, 120).replace(/\s+/g, ' ')}`);
    }
  }
  console.log(empty.length === 0 ? 'No empty tables.' : `EMPTY TABLES (${empty.length}):`);
  for (const line of empty) console.log('  ' + line);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
