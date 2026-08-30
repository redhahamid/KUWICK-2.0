/**
 * THE OWNER REVIEW BOARDS.
 *
 * The screenshots are 3360×2132 files on somebody's disk. An owner reviewing
 * five modules should not be opening thirty of those one at a time, and a
 * contact sheet that shrinks ten of them onto one page is worse than useless
 * — a screen you cannot read is a screen you cannot approve.
 *
 * So: four to six per board, each one wide enough to read the numbers, with a
 * caption saying which screen it is and what it proves. Composed as an HTML
 * page and photographed by the same Chromium the UAT ran in, because that
 * gives real type for the captions instead of pixels stretched by an image
 * tool.
 *
 *   node tools/build-review-boards.mjs
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = resolve(import.meta.dirname, '..');
const SHOTS = join(ROOT, 'docs', 'screenshots', 'admin');
const OUT = join(ROOT, 'docs', 'screenshots', 'admin');
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';

/** One tile: the file, what it is, and what it proves. */
const BOARDS = [
  {
    file: 'ADMIN-01-OPERATIONS.png',
    title: 'Operation',
    question: 'How is the clinic performing?',
    tiles: [
      ['desktop--operation-01-overview.png', 'Operations overview', 'Period presets, KPIs, activity by day, and doctor productivity labelled BILLED — never doctor income.', 'Admin (new)'],
      ['desktop--operation-02-segment-pl.png', 'Segment P&L', 'Service lines as configuration, not five hardcoded reports. Unclassified revenue shown separately; margin is contribution, not net profit.', 'Admin (new)'],
      ['desktop--operation-03-programmes.png', 'Programme dashboard', 'Enrolment, dispensing and contribution — and the clinical indicators it CANNOT derive, listed by name.', 'Admin (new)'],
      ['desktop--operation-04-marketing.png', 'Marketing & audience', 'Builds the list and renders the message. Kuwick sends nothing, and the screen says so.', 'Admin (new)'],
    ],
  },
  {
    file: 'ADMIN-02A-STOCK.png',
    title: 'Stock — what needs attention',
    question: 'What requires attention today, and what are the shelves worth?',
    tiles: [
      ['desktop--stock-01-what-needs-attention.png', 'Exception board & valuation', 'Eight exception tiles, then valuation at cost with potential self-pay value beside it — labelled not profit, not a forecast.', 'Admin (new)'],
      ['desktop--stock-04-movement-ledger.png', 'Movement ledger', 'Every balance change with who and why. Append-only, enforced by the database.', 'Admin (new)'],
      ['desktop--stock-06-levels-by-branch.png', 'Stock quantity by branch', 'Live quantity per item per branch — derived from the ledger above.', 'Management (existing)'],
      ['desktop--stock-05-items-and-pricing.png', 'Item catalogue & pricing', 'Cost and sell price per item. The cost basis every margin figure resolves to.', 'Management (existing)'],
    ],
  },
  {
    file: 'ADMIN-02B-STOCK.png',
    title: 'Stock — the controlled workflows',
    question: 'Nothing changes a balance without a second pair of eyes.',
    tiles: [
      ['desktop--stock-02-transfers.png', 'Branch transfers', 'Sent, in transit, received. A discrepancy stays missing rather than being balanced away.', 'Admin (new)'],
      ['desktop--stock-09-receive-transfer-modal.png', 'Receiving a transfer', 'The receiver confirms what actually arrived. The sender cannot alter this number.', 'Admin (new)'],
      ['desktop--stock-03-stock-take.png', 'Stock take', 'Count → submit → a second person approves → the ledger is corrected. Typing a count changes nothing.', 'Admin (new)'],
      ['desktop--stock-07-purchase-orders.png', 'Procurement', 'Purchase orders and goods receiving — the other way stock legitimately arrives.', 'Management (existing)'],
    ],
  },
  {
    file: 'ADMIN-03-PANEL.png',
    title: 'Panel',
    question: 'What is unsubmitted, what was rejected, and what money is still owed?',
    tiles: [
      ['desktop--panel-01-to-submit.png', 'Submission queue', 'Each claim checked against that panel’s own requirements BEFORE somebody opens the portal. Kuwick submits nothing and says so.', 'Admin (new)'],
      ['desktop--panel-03-work-queue.png', 'Work queue — rejected & overdue', 'Every rejection has an owner and an age. A rejected claim nobody owns is money written off by accident.', 'Admin (new)'],
      ['desktop--panel-05-adjudicate-claim.png', 'Recording what the panel said', 'Approved, rejected and the reason — the moment "sent" becomes "adjudicated".', 'Admin (new)'],
      ['desktop--panel-06-write-off-receivable.png', 'Writing off a receivable', 'The other end of a rejection: stop pursuing it, with a reason on the record. The seeded rejection has already been re-claimed, so the board correctly offers this instead.', 'Admin (new)'],
      ['desktop--panel-04-reconciliation.png', 'Reconciliation', 'Expected = received + outstanding + rejected + written off. The screen states whether it balances.', 'Admin (new)'],
      ['desktop--panel-02-configuration.png', 'Panel configuration', 'Portal, terms, fee rules, document requirements, rejection handling — what drives the checklist.', 'Admin (new)'],
    ],
  },
  {
    file: 'ADMIN-04A-HR.png',
    title: 'HR — people, hours and access',
    question: 'Who is working, who is absent, and what is waiting on a manager?',
    tiles: [
      ['desktop--hr-01-today.png', 'Workforce today', 'On duty, late, on leave, rostered — then the three things blocked on a manager.', 'Admin (new)'],
      ['desktop--hr-02-employees.png', 'Employee directory', 'Account, employment and clinical credential kept as three separate facts about one person.', 'Admin (new)'],
      ['desktop--hr-03-timesheets.png', 'Timesheets', 'What payroll will read. Unapproved overtime is shown separately and is not paid.', 'Admin (new)'],
      ['desktop--hr-07-leave-requests.png', 'Leave requests', 'Approval queue feeding the same balances payroll reads.', 'Management (existing)'],
      ['desktop--hr-06-roles-and-permissions.png', 'Roles & permissions', '73 permissions, role bundles and individual grants — what gates every screen in this pack.', 'Settings (existing)'],
      ['desktop--hr-08-provider-roster.png', 'Provider roster', 'The canonical roster. HR reads it and links back to it; it does not keep a second copy.', 'Settings (existing)'],
    ],
  },
  {
    file: 'ADMIN-04B-HR.png',
    title: 'HR — payroll and incentives',
    question: 'Can this run be approved, and what would it pay?',
    tiles: [
      ['desktop--hr-04-payroll.png', 'Payroll runs', 'Statutory reads NOT CALCULATED, because no rate table is configured. The system refuses to print a figure it cannot stand behind.', 'Admin (new)'],
      ['desktop--hr-09-payroll-run-detail.png', 'Payroll run detail', 'Per employee, with the exception that blocks approval NAMED rather than counted.', 'Admin (new)'],
      ['desktop--hr-05-incentives.png', 'Doctor incentives', 'Threshold and per-procedure rules, versioned so a paid incentive is never recalculated with today’s rules.', 'Admin (new)'],
      ['desktop--hr-10-incentive-run-detail.png', 'Incentive run detail', 'What each doctor earned, under the rule version in force when it was calculated.', 'Admin (new)'],
    ],
  },
  {
    file: 'ADMIN-05A-FINANCE.png',
    title: 'Finance — the day and the money',
    question: 'Did yesterday reconcile, and how did the money arrive?',
    tiles: [
      ['desktop--finance-01-overview.png', 'Finance overview', 'Received, patient receivable, panel receivable, service tax, unreconciled days — then the days still open, with a way into each.', 'Admin (new)'],
      ['desktop--finance-02-day-end.png', 'Day-end closing', 'Expected is derived, counted is typed by a named person, variance is the difference and must be explained.', 'Admin (new)'],
      ['desktop--finance-03-payments.png', 'Payment report', 'Every movement of money, by the day it moved. A reversal is not a refund, and the screen says so.', 'Admin (new)'],
      ['desktop--finance-06-sales-report.png', 'Sales report', 'Billed revenue by day and category — the invoice side, kept separate from the money side.', 'Management (existing)'],
    ],
  },
  {
    file: 'ADMIN-05B-FINANCE.png',
    title: 'Finance — what is owed and what it earned',
    question: 'What is outstanding, and are the revenue and tax figures right?',
    tiles: [
      ['desktop--finance-04-outstanding.png', 'Outstanding receivables', 'Patient and panel money aged separately, because they are chased by different people.', 'Admin (new)'],
      ['desktop--finance-08-invoice-listing.png', 'Invoice listing', 'Every invoice raised, with its status — the document side of the ledger.', 'Management (existing)'],
      ['desktop--finance-05-credit-notes.png', 'Credit notes', 'The original invoice is left exactly as issued; the reduction is its own dated, approvable document.', 'Admin (new)'],
      ['desktop--finance-07-drug-movement.png', 'Drug movement & margin', 'What was dispensed and what it cost, at standard cost — weighted-average and FIFO are not implemented and it does not claim to be either.', 'Management (existing)'],
    ],
  },
];

/**
 * THE RELEASE-CANDIDATE BOARDS.
 *
 * The eight boards above answer "was each module built". These five answer the
 * question the owner asked second, which is harder and more important:
 *
 *   "Do these five modules read as ONE Kuwick Admin, or as a new product
 *    bolted onto the old Management and Settings?"
 *
 * So every tile here is shot INSIDE the Admin shell, including the screens
 * that were written for /management years ago. Where a tile carries the
 * MANAGEMENT / SETTINGS tag it is saying something specific: this component
 * was not rebuilt, was not copied, and is the same one the old URL still
 * serves — it is simply reachable from here now, and looks like it belongs.
 */
const RC_BOARDS = [
  {
    file: 'ADMIN-RC-01-OPERATIONS.png',
    title: 'Operation — one performance picture',
    question: 'Clinic performance was split across two hubs. It is now one.',
    tiles: [
      ['desktop--operation-01-overview.png', 'Operations overview', 'Period presets, KPIs, activity by day, doctor productivity labelled BILLED — never doctor income.', 'Admin (new)'],
      ['desktop--operation-02-segment-pl.png', 'Segment P&L', 'Service lines as configuration. Unclassified revenue shown separately; margin is contribution, never net profit.', 'Admin (new)'],
      ['rc-ia-21-marketing-consolidated.png', 'Marketing — audience, templates, sending queue', 'Audience building, programme segmentation and message templates, plus the manual WhatsApp queue that had no UI and could not be reached. Kuwick still sends nothing and the screen still says so.', 'Admin (new)'],
      ['rc-ia-17-operation-patient-analysis-in-admin.png', 'Patient analysis, inside Admin', 'The pre-existing report, mounted in the Admin shell. Same component, same endpoint, same rows — one door closer.', 'Management (existing)'],
      ['rc-ia-19-operation-doctor-performance-in-admin.png', 'Doctor performance, inside Admin', 'Was under Management ▸ Reports. Nothing about it was rebuilt; the old URL still resolves.', 'Management (existing)'],
      ['rc-ia-20-operation-wait-times-in-admin.png', 'Waiting times, inside Admin', 'Operational quality belongs beside operational performance. Mounted, not duplicated.', 'Management (existing)'],
    ],
  },
  {
    file: 'ADMIN-RC-02-STOCK.png',
    title: 'Stock — eleven doors, one ledger',
    question: 'Every stock screen the brief lists, reachable from Admin ▸ Stock.',
    tiles: [
      ['rc-01-stock-transfer-discrepancy.png', 'Transfer discrepancy', 'Sent 40, received 36. The receiver states what arrived; the shortfall stays missing rather than being balanced away by the sender.', 'Admin (new)'],
      ['rc-02-stock-take-submit-and-approve.png', 'Stock take — count, submit, approve', 'Counting changes nothing. A second person approves, and only then does the ledger move.', 'Admin (new)'],
      ['rc-ia-01-stock-items-in-admin.png', 'Items & pricing, inside Admin', 'THE catalogue — the one every margin figure resolves to. Reaching it no longer means leaving Admin. Not a second item record.', 'Management (existing)'],
      ['rc-ia-02-stock-by-location-in-admin.png', 'Stock by location, inside Admin', 'Live quantity per item per branch, derived from the same append-only ledger.', 'Management (existing)'],
      ['rc-ia-07-stock-value-in-admin.png', 'Stock value', 'The attention board opened on valuation. A prop, not a fourth copy of the board — and standard cost is disclosed as standard cost.', 'Admin (new)'],
      ['rc-ia-03-stock-purchase-orders-in-admin.png', 'Purchase orders, inside Admin', 'Procurement and goods receiving, the other way stock legitimately arrives.', 'Management (existing)'],
    ],
  },
  {
    file: 'ADMIN-RC-03-PANEL.png',
    title: 'Panel — the control tower and the receivables ledger',
    question: 'Opened ≠ accepted ≠ paid. Every screen here keeps the three apart.',
    tiles: [
      ['rc-03a-panel-work-queue-rejected.png', 'Work queue — claimed, fee, receivable', 'Claimed, the panel’s admin fee and the resulting receivable are now three columns. One column headed "Claimed" was showing claimed PLUS fee.', 'Admin (new)'],
      ['rc-03c-panel-reclaim-chain.png', 'The re-claim chain, both ends', 'SJ-2026-0442 rejected on formulary grounds and RESOLVED by raising SJ-2026-0517 the next day. Original claim number, replacement, resubmission date and resolved date, in adjacent columns — the Google Sheet\u2019s own layout. Hidden by default so a settled claim is never chased twice.', 'Admin (new)'],
      ['rc-03b-panel-record-outcome.png', 'Recording what the panel said', 'The moment "we submitted" becomes "they adjudicated". Neither is "they paid".', 'Admin (new)'],
      ['rc-03-panel-reclaim-and-reconciliation.png', 'Reconciliation', 'Expected = received + outstanding + rejected + written off, and the screen states whether it balances.', 'Admin (new)'],
      ['desktop--panel-02-configuration.png', 'Panel configuration', 'Submission method, portal link, payment terms, fee rule, required documents, claim-number format, re-claim rule, instructions.', 'Admin (new)'],
      ['rc-ia-09-panel-batches-in-admin.png', 'Claim batches & companies, inside Admin', 'The existing batch workflow in the Admin shell, driving the same batches as the workspace above. Panel Companies is mounted beside it on the same rail.', 'Management (existing)'],
    ],
  },
  {
    file: 'ADMIN-RC-04-HR.png',
    title: 'HR — nine screens, one employee, one roster',
    question: 'What does the system know about a person, and what will it not pretend to know?',
    tiles: [
      ['rc-04-hr-employee-detail.png', 'Employee record', 'Employment, person, pay basis, statutory position, attendance and payroll history — composed in ONE read from the tables that own each fact.', 'Admin (new)'],
      ['rc-04b-hr-employee-payroll-history.png', 'Payroll history & documents', 'Every run this person appeared on, with statutory marked NOT COMPUTED. Documents state that no employee document store exists rather than showing an empty list.', 'Admin (new)'],
      ['rc-06-payroll-statutory-not-ready.png', 'NOT READY FOR LIVE MALAYSIAN PAYROLL', 'The banner is the deliverable. EPF/KWSP, SOCSO, EIS and PCB are not implemented, statutory columns are blank rather than zero, and approval is labelled "without statutory figures".', 'Admin (new)'],
      ['rc-05-hr-leave-roster-impact.png', 'Roster, inside Admin', 'The Appointments roster component, rendered in the Admin shell. There is exactly one shift table and one component that writes it.', 'Appointments (existing)'],
      ['rc-ia-11-hr-staff-benefits.png', 'Staff benefits', 'Allowance, dependants and every dated use that makes up the balance. Derived, never a stored running total.', 'Admin (new)'],
      ['rc-ia-10-hr-roles-and-access-in-admin.png', 'Roles & access, inside Admin', 'The permission model that gates every screen in this pack, reachable from HR.', 'Settings (existing)'],
    ],
  },
  {
    file: 'ADMIN-RC-05-FINANCE.png',
    title: 'Finance — one workspace, one invoice source',
    question: 'Did today reconcile, what is owed, and what actually earns?',
    tiles: [
      ['rc-07-day-end-counted-money-and-variance.png', 'Day-end — counted money, real variance', 'Expected RM562.90 derived from payments with the RM40 refund netted. A named person counted RM542.90. The RM20 difference must be explained before the day can close.', 'Admin (new)'],
      ['rc-08-day-end-closed-and-locked.png', 'Day-end — closed and locked', 'Closed by name and timestamp, expected figures FROZEN, count and close disabled, reopen a separate permission that leaves its own record.', 'Admin (new)'],
      ['rc-10-drug-profitability.png', 'Drug profitability', 'Per item: units, revenue, direct cost, contribution and margin — ranked five ways. Contribution, never net profit.', 'Admin (new)'],
      ['rc-11-procedure-profitability-cost-not-configured.png', 'Procedure profitability', 'No service has a cost basis in this schema, so every row reads COST NOT CONFIGURED and is excluded from the totals. Treating unknown as RM0 would report procedures as pure profit.', 'Admin (new)'],
      ['rc-09-outstanding-invoice-aging.png', 'Outstanding & aging', 'Patient money and panel money aged separately and never summed into one headline.', 'Admin (new)'],
      ['rc-ia-13-finance-invoices-in-admin.png', 'Invoice listing, inside Admin', 'The existing invoice report, mounted here. There is one invoice source and this is it.', 'Management (existing)'],
    ],
  },
];

const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f6f9; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #101828; }
  .board { width: 2400px; padding: 44px 44px 52px; }
  header { border-bottom: 2px solid #184a6b; padding-bottom: 18px; margin-bottom: 28px; display: flex; align-items: baseline; justify-content: space-between; gap: 28px; }
  .brand { font-size: 15px; letter-spacing: 0.14em; text-transform: uppercase; color: #667085; font-weight: 600; }
  h1 { font-size: 40px; margin: 6px 0 0; letter-spacing: -0.02em; }
  .question { font-size: 19px; color: #475467; margin-top: 8px; font-style: italic; }
  .meta { text-align: right; font-size: 13.5px; color: #667085; line-height: 1.7; white-space: nowrap; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 30px; }
  .tile { background: #fff; border: 1px solid #d0d5dd; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; }
  .shot { width: 100%; display: block; border-bottom: 1px solid #e4e7ec; background: #fff; }
  .cap { padding: 15px 18px 17px; }
  .cap h2 { font-size: 21px; margin: 0 0 6px; letter-spacing: -0.01em; }
  .cap p { font-size: 15px; line-height: 1.5; margin: 0; color: #475467; }
  .tag { display: inline-block; font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 8px; border-radius: 4px; margin-left: 10px; vertical-align: 3px; }
  .tag.new { background: #e6f4ea; color: #10693a; }
  .tag.existing { background: #eef2f6; color: #475467; }
  .missing { padding: 60px 20px; text-align: center; color: #b42318; font-size: 17px; background: #fef3f2; }
  footer { margin-top: 30px; font-size: 13.5px; color: #667085; border-top: 1px solid #d0d5dd; padding-top: 14px; }
`;

/** Crop tall full-page shots so the tile shows the part worth reading. */
const MAX_TILE_HEIGHT = 1180;

function tileHtml([file, title, proves, origin]) {
  const path = join(SHOTS, file);
  const isNew = origin.startsWith('Admin');
  if (!existsSync(path)) {
    return `<div class="tile"><div class="missing">Missing screenshot:<br><code>${file}</code></div>
      <div class="cap"><h2>${title}</h2><p>${proves}</p></div></div>`;
  }
  const data = readFileSync(path).toString('base64');
  return `<div class="tile">
    <div style="max-height:${MAX_TILE_HEIGHT}px; overflow:hidden;">
      <img class="shot" src="data:image/png;base64,${data}">
    </div>
    <div class="cap">
      <h2>${title}<span class="tag ${isNew ? 'new' : 'existing'}">${origin}</span></h2>
      <p>${proves}</p>
    </div>
  </div>`;
}

const stamp = new Date().toISOString().slice(0, 10);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });

  for (const board of [...BOARDS, ...RC_BOARDS]) {
    const html = `<!doctype html><meta charset="utf-8"><style>${CSS}</style>
      <div class="board">
        <header>
          <div>
            <div class="brand">Kuwick 2.0 · Admin system · owner visual review</div>
            <h1>${board.title}</h1>
            <div class="question">${board.question}</div>
          </div>
          <div class="meta">
            Branch <b>claude/kuwick-2-visual-audit-k9uk5z</b><br>
            Synthetic UAT clinic — Klinik Contoh (UAT)<br>
            Captured ${stamp} at 1680×1050, 2× density
          </div>
        </header>
        <div class="grid">${board.tiles.map(tileHtml).join('')}</div>
        <footer>
          <b>ADMIN (NEW)</b> — built on this branch. &nbsp;·&nbsp;
          <b>MANAGEMENT / SETTINGS (EXISTING)</b> — pre-existing screens this branch did not build and did not change, shown against the same clinic so the modules read as one system.
          Every name, identifier and address in these screens is synthetic.
        </footer>
      </div>`;

    const page = await browser.newPage({ viewport: { width: 2400, height: 1400 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const out = join(OUT, board.file);
    await page.locator('.board').screenshot({ path: out });
    await page.close();
    console.log(`  ${board.file}  (${board.tiles.length} tiles)`);
  }

  await browser.close();
  console.log(`\nWritten to ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
