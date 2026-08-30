# Admin System — Owner Visual Review Pack

Thirteen review boards covering the five Admin modules, built from the browser-UAT screenshots taken against the synthetic UAT clinic **Klinik Contoh (UAT)**.

**Start with the five RC boards.** They answer the question this pass was about — whether the five modules read as one Kuwick Admin rather than a new product bolted onto the old Management and Settings. The eight original boards are kept below as the module-by-module record.

**Branch:** `claude/kuwick-2-visual-audit-k9uk5z` · **Not merged.** These are for visual acceptance before merge.

Every name, identifier and address in these screens is synthetic — invented names, reserved `000000-00-xxxx` identifiers, and `.invalid` email addresses that cannot route.

---

## Release-candidate boards — start here

Every tile on these five is photographed **inside the Admin shell**, including the
screens that were written for `/management` or `/settings` years ago. That is the
point: a tile tagged MANAGEMENT (EXISTING) is saying that component was not
rebuilt, was not copied, and still serves its original URL — it is simply
reachable from Admin now, and looks like it belongs there.

| # | Board | Tiles | View |
|---|---|---|---|
| RC-01 | Operation — one performance picture | 6 | [ADMIN-RC-01-OPERATIONS.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/ADMIN-RC-01-OPERATIONS.png) |
| RC-02 | Stock — eleven doors, one ledger | 6 | [ADMIN-RC-02-STOCK.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/ADMIN-RC-02-STOCK.png) |
| RC-03 | Panel — control tower and receivables ledger | 6 | [ADMIN-RC-03-PANEL.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/ADMIN-RC-03-PANEL.png) |
| RC-04 | HR — nine screens, one employee, one roster | 6 | [ADMIN-RC-04-HR.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/ADMIN-RC-04-HR.png) |
| RC-05 | Finance — one workspace, one invoice source | 6 | [ADMIN-RC-05-FINANCE.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/ADMIN-RC-05-FINANCE.png) |

### The twelve workflow captures

The brief names twelve workflows that a screen alone does not prove. These were
driven in a real browser against the seeded clinic — the day-end shots below are
a genuine count, a genuine variance and a genuine close, not a staged form.

| # | Workflow | Image |
|---|---|---|
| 1 | Stock transfer discrepancy — sent 40, received 36 | [rc-01-stock-transfer-discrepancy.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-01-stock-transfer-discrepancy.png) |
| 2 | Stock take — count, submit, approve | [rc-02-stock-take-submit-and-approve.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-02-stock-take-submit-and-approve.png) |
| 3 | Panel rejected → re-claim → reconciliation | [rc-03-panel-reclaim-and-reconciliation.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-03-panel-reclaim-and-reconciliation.png) · [work queue](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-03a-panel-work-queue-rejected.png) · [record outcome](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-03b-panel-record-outcome.png) · [the re-claim chain](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-03c-panel-reclaim-chain.png) |
| 4 | HR employee detail | [rc-04-hr-employee-detail.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-04-hr-employee-detail.png) · [payroll history & documents](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-04b-hr-employee-payroll-history.png) |
| 5 | Leave → roster impact | [rc-05-hr-leave-roster-impact.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-05-hr-leave-roster-impact.png) · [leave requests](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-05a-hr-leave-requests.png) |
| 6 | Payroll run — statutory NOT READY | [rc-06-payroll-statutory-not-ready.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-06-payroll-statutory-not-ready.png) |
| 7 | Day-end — counted money and variance | [rc-07-day-end-counted-money-and-variance.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-07-day-end-counted-money-and-variance.png) · [open, expected](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-07a-day-end-open-with-expected.png) · [variance blocks close](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-07b-day-end-variance-blocks-close.png) |
| 8 | Day-end — closed and locked | [rc-08-day-end-closed-and-locked.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-08-day-end-closed-and-locked.png) |
| 9 | Outstanding / receivable aging | [rc-09-outstanding-invoice-aging.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-09-outstanding-invoice-aging.png) |
| 10 | Drug profitability | [rc-10-drug-profitability.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-10-drug-profitability.png) |
| 11 | Procedure profitability — COST NOT CONFIGURED | [rc-11-procedure-profitability-cost-not-configured.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-11-procedure-profitability-cost-not-configured.png) |
| 12 | Credit note — creation and approval | [rc-12-credit-note-creation-and-approval.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-12-credit-note-creation-and-approval.png) |
| 13 | Marketing — the manual sending queue | [rc-13-marketing-sending-queue.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-13-marketing-sending-queue.png) · [audience & templates](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-21-marketing-consolidated.png) |

Thirteen rather than twelve: the sending queue is the capability §H found had no
UI at all, so it is shown rather than described.

**Day-end, in detail.** Today at Contoh Central is seeded OPEN with takings in
all four tender buckets, a RM40 card refund and a panel invoice that bills but
puts nothing in the drawer. Expected comes out at **RM562.90**. The script counts
cash **RM20 short** and every other bucket exactly; the screen refuses to close
until the difference is explained, and the closed state freezes the expected
figures, disables count and close, and puts reopening behind its own permission.

### The reused screens, shot inside Admin

Twenty-one captures named `rc-ia-*` show each mounted screen in the Admin shell.
They exist so the claim in §A can be checked rather than taken on trust:
[items & pricing](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-01-stock-items-in-admin.png) ·
[stock by location](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-02-stock-by-location-in-admin.png) ·
[purchase orders](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-03-stock-purchase-orders-in-admin.png) ·
[suppliers](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-04-stock-suppliers-in-admin.png) ·
[near expiry](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-05-stock-near-expiry-in-admin.png) ·
[slow moving](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-06-stock-slow-moving-in-admin.png) ·
[stock value](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-07-stock-value-in-admin.png) ·
[panel companies](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-08-panel-companies-in-admin.png) ·
[claim batches](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-09-panel-batches-in-admin.png) ·
[roles & access](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-10-hr-roles-and-access-in-admin.png) ·
[staff benefits](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-11-hr-staff-benefits.png) ·
[sales](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-12-finance-sales-in-admin.png) ·
[invoices](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-13-finance-invoices-in-admin.png) ·
[tax / SST](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-14-finance-tax-sst.png) ·
[inter-company](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-15-finance-inter-company.png) ·
[e-Invoice — not built](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-16-finance-e-invoice-not-built.png) ·
[patient analysis](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-17-operation-patient-analysis-in-admin.png) ·
[procedure analysis](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-18-operation-procedure-analysis-in-admin.png) ·
[doctor performance](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-19-operation-doctor-performance-in-admin.png) ·
[waiting times](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-20-operation-wait-times-in-admin.png) ·
[marketing](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ia-21-marketing-consolidated.png)

### iPad landscape (1194×834)

The six screens somebody actually holds a tablet in front of:
[stock attention](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ipad-01-stock-attention.png) ·
[stock take](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ipad-02-stock-take.png) ·
[panel work queue](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ipad-03-panel-work-queue.png) ·
[day-end](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ipad-04-day-end.png) ·
[HR today](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ipad-05-hr-today.png) ·
[outstanding](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/rc-ipad-06-outstanding.png)

---

## The original module boards


| # | Board | Screens | View |
|---|---|---|---|
| 01 | Operation | 4 | [ADMIN-01-OPERATIONS.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/ADMIN-01-OPERATIONS.png) |
| 02A | Stock — what needs attention | 4 | [ADMIN-02A-STOCK.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/ADMIN-02A-STOCK.png) |
| 02B | Stock — the controlled workflows | 4 | [ADMIN-02B-STOCK.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/ADMIN-02B-STOCK.png) |
| 03 | Panel | 6 | [ADMIN-03-PANEL.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/ADMIN-03-PANEL.png) |
| 04A | HR — people, hours and access | 6 | [ADMIN-04A-HR.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/ADMIN-04A-HR.png) |
| 04B | HR — payroll and incentives | 4 | [ADMIN-04B-HR.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/ADMIN-04B-HR.png) |
| 05A | Finance — the day and the money | 4 | [ADMIN-05A-FINANCE.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/ADMIN-05A-FINANCE.png) |
| 05B | Finance — what is owed and what it earned | 4 | [ADMIN-05B-FINANCE.png](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/ADMIN-05B-FINANCE.png) |

Split into A/B where one sheet of readable screens was not enough. Four to six per board, at a size where the numbers can be read — a contact sheet of ten thumbnails is a sheet nobody can approve from.

These eight predate the integration pass and are kept as the module-by-module
record. Where a screen appears on both an original board and an RC board, the RC
version is the current one: it was re-shot inside the Admin shell.

---

## Two kinds of screen, labelled on every tile

- **ADMIN (NEW)** — built on this branch.
- **MANAGEMENT / SETTINGS (EXISTING)** — pre-existing screens this branch did not build and did not change. They are in the pack because the review list asks for them (item pricing, stock quantity, procurement, roles, leave, roster, sales, drug movement, invoices) and because showing them against the same clinic is how the modules read as one system. Nothing here claims them as new work.

---

## What each screenshot proves

### ADMIN-01-OPERATIONS.png

| Source file | Screen | What it proves |
|---|---|---|
| `desktop--operation-01-overview.png` | Operations overview · **new** | Four period presets, branch scope, KPIs, activity by day, doctor productivity — with the column named **BILLED UNDER DOCTOR** and the disclaimer that it is not the doctor's income, commission, or anything they personally earn. |
| `desktop--operation-02-segment-pl.png` | Segment P&L · **new** | Service lines driven by configurable mapping rules, not five hardcoded reports. Unclassified revenue is its own line; margin is stated as contribution with overheads explicitly not allocated; lines with no cost on record are counted and disclosed. |
| `desktop--operation-03-programmes.png` | Programme dashboard · **new** | Enrolment, dispensing and contribution per programme — and a panel naming the clinical indicators the system **cannot** derive (control rate, dose-ladder progression) rather than estimating them. |
| `desktop--operation-04-marketing.png` | Marketing & audience · **new** | Audience built from live data, message rendered from a template, and the statement that Kuwick has no messaging integration and sends nothing. PREPARED and OPENED are defined where the history is read. |

### ADMIN-02A-STOCK.png

| Source file | Screen | What it proves |
|---|---|---|
| `desktop--stock-01-what-needs-attention.png` | Exception board & valuation · **new** | Eight exception tiles answering "what needs attention today", then valuation at cost with potential self-pay value beside it, labelled not profit and not a forecast, and weighted-average/FIFO explicitly not implemented. |
| `desktop--stock-04-movement-ledger.png` | Movement ledger · **new** | Every balance change with actor, type, reason and note. Append-only, enforced by a database trigger; corrections are compensating movements, never edits. |
| `desktop--stock-06-levels-by-branch.png` | Stock quantity by branch · *existing* | Live quantity per item per branch — the figure the ledger above derives. |
| `desktop--stock-05-items-and-pricing.png` | Item catalogue & pricing · *existing* | Cost and sell price per item: the cost basis every margin figure in the pack resolves back to. |

### ADMIN-02B-STOCK.png

| Source file | Screen | What it proves |
|---|---|---|
| `desktop--stock-02-transfers.png` | Branch transfers · **new** | Sent / in transit / received, with in-transit stock on neither shelf, and a discrepancy that stays missing rather than being balanced away. |
| `desktop--stock-09-receive-transfer-modal.png` | Receiving a transfer · **new** | The receiving branch confirms what actually arrived. The sender cannot alter this number, and a difference needs a reason. |
| `desktop--stock-03-stock-take.png` | Stock take · **new** | Count → submit → **a second person approves** → the ledger is corrected. Typing a count changes nothing on its own. |
| `desktop--stock-07-purchase-orders.png` | Procurement · *existing* | Purchase orders and goods receiving — the other way stock legitimately arrives. |

### ADMIN-03-PANEL.png

| Source file | Screen | What it proves |
|---|---|---|
| `desktop--panel-01-to-submit.png` | Submission queue · **new** | Each claim checked against that panel's own documented requirements before anybody opens the portal, with one claim flagged incomplete. States plainly that Kuwick submits to no portal. |
| `desktop--panel-03-work-queue.png` | Work queue — rejected & overdue · **new** | Rejections and overdue claims with an owner, an age and the panel's reason. |
| `desktop--panel-05-adjudicate-claim.png` | Recording what the panel said · **new** | Approved, rejected and the reason — the point at which "sent" becomes "adjudicated". The modal states that approval is not payment. |
| `desktop--panel-06-write-off-receivable.png` | Writing off a receivable · **new** | Abandoning a claim as uncollectable, with the name and reason kept on the claim's record. |
| `desktop--panel-04-reconciliation.png` | Reconciliation · **new** | Expected receivable = received + outstanding + rejected + written off, per panel, with aging and collection rate — and an explicit RECONCILES: Yes. |
| `desktop--panel-02-configuration.png` | Panel configuration · **new** | Portal, submission method, payment terms, claim fee, per-visit limit, itemisation requirement and rejection handling — the configuration that drives the checklist. |

**Note on re-claiming.** The seeded rejected claim has already been re-claimed under a new number, so the workspace correctly hides its Re-claim button — a second replacement for one rejection is the same money claimed twice. The write-off modal is shown in its place.

### ADMIN-04A-HR.png

| Source file | Screen | What it proves |
|---|---|---|
| `desktop--hr-01-today.png` | Workforce today · **new** | On duty now, finished, late, on leave, rostered — then the three things blocked on a manager. States that the roster is read from the provider roster and changed there. |
| `desktop--hr-02-employees.png` | Employee directory · **new** | User account, employment profile and clinical credential as three separate facts about one person — a doctor "may sign", a stock controller is "non-clinical". |
| `desktop--hr-03-timesheets.png` | Timesheets · **new** | What payroll will read, with approved and unapproved overtime in separate columns and the statement that a long day is not automatically overtime. |
| `desktop--hr-07-leave-requests.png` | Leave requests · *existing* | The approval queue feeding the same balances payroll reads. |
| `desktop--hr-06-roles-and-permissions.png` | Roles & permissions · *existing* | The permission model gating every screen in this pack. |
| `desktop--hr-08-provider-roster.png` | Provider roster · *existing* | The one canonical roster. HR reads it and links back; it keeps no second copy. |

### ADMIN-04B-HR.png

| Source file | Screen | What it proves |
|---|---|---|
| `desktop--hr-04-payroll.png` | Payroll runs · **new** | Statutory column reads **Not calculated** and a banner states EPF/SOCSO/EIS/PCB are not built in. See "Malaysia Payroll Statutory Readiness" in the readiness document. |
| `desktop--hr-09-payroll-run-detail.png` | Payroll run detail · **new** | Per-employee lines, with the exception blocking approval **named** rather than counted, and approval disabled until it is resolved. |
| `desktop--hr-05-incentives.png` | Doctor incentives · **new** | Threshold and per-procedure rules, versioned so a paid incentive is never recalculated with today's rules. |
| `desktop--hr-10-incentive-run-detail.png` | Incentive run detail · **new** | What each doctor earned under the rule version in force when it was calculated. |

### ADMIN-05A-FINANCE.png

| Source file | Screen | What it proves |
|---|---|---|
| `desktop--finance-01-overview.png` | Finance overview · **new** | Received, patient receivable, panel receivable, service tax and unreconciled days — then the days not yet closed, each with a way in. Unmapped revenue reported as "not classified", never assumed exempt. |
| `desktop--finance-02-day-end.png` | Day-end closing · **new** | Expected derived from the payment ledger, counted typed by a named person per tender, variance measured not assumed, and a blank tender meaning "not counted" rather than zero. |
| `desktop--finance-03-payments.png` | Payment report · **new** | Every movement of money bucketed by the day it moved, with the statement that a reversal is not a refund and both halves stay on the ledger counting for nothing. |
| `desktop--finance-06-sales-report.png` | Sales report · *existing* | Billed revenue — the invoice side, kept separate from the money side. |

### ADMIN-05B-FINANCE.png

| Source file | Screen | What it proves |
|---|---|---|
| `desktop--finance-04-outstanding.png` | Outstanding receivables · **new** | Patient and panel money aged separately and never added into one figure, with per-invoice balances and per-panel collection history. |
| `desktop--finance-08-invoice-listing.png` | Invoice listing · *existing* | Every invoice raised and its status — the document side of the ledger. |
| `desktop--finance-05-credit-notes.png` | Credit notes · **new** | The original invoice left exactly as issued; the reduction is its own dated, approvable document. Raising and issuing are separate permissions and both names are recorded. |
| `desktop--finance-07-drug-movement.png` | Drug movement & margin · *existing* | What was dispensed and what it cost, at standard cost — the basis stated rather than implied. |

---

## Regenerating the pack

```bash
# 1. Seed the synthetic clinic (rebuilds only its own tenant)
cd apps/api
KUWICK_ADMIN_UAT_SEED=yes npx tsx prisma/seed-admin-uat.ts

# 2. Capture the twenty Admin pages, then the review extras
CHROME_PATH=/opt/pw-browsers/chromium npx tsx prisma/admin-uat-shots.ts
CHROME_PATH=/opt/pw-browsers/chromium npx tsx prisma/admin-uat-review-shots.ts

# 3. Capture the release-candidate pack: the mounted screens, the twelve
#    workflows, and the iPad set. This one DRIVES the day-end — it counts the
#    drawer short and closes the day — so re-run the seed (step 1) before it if
#    you want a fresh open day to close again.
CHROME_PATH=/opt/pw-browsers/chromium npx tsx prisma/admin-rc-shots.ts

# 4. Compose all thirteen boards
cd ../.. && node tools/build-review-boards.mjs
```

Both servers must be running. The board layout and every caption live in `tools/build-review-boards.mjs`.

---

## The rest of the pack

Alongside the boards, the same directory holds every individual full-resolution
screenshot: the original `desktop--*` set for the twenty Admin pages, the
`ipad-landscape--*` / `ipad-portrait--*` responsive captures, and this pass's
`rc-*` release-candidate pack (workflows, mounted screens and the tablet set).
