# Admin System — Owner Visual Review Pack

Eight review boards covering the five Admin modules, built from the browser-UAT screenshots taken against the synthetic UAT clinic **Klinik Contoh (UAT)**.

**Branch:** `claude/kuwick-2-visual-audit-k9uk5z` · **Not merged.** These are for visual acceptance before merge.

Every name, identifier and address in these screens is synthetic — invented names, reserved `000000-00-xxxx` identifiers, and `.invalid` email addresses that cannot route.

---

## The boards

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

# 3. Compose the boards
cd ../.. && node tools/build-review-boards.mjs
```

Both servers must be running. The board layout and every caption live in `tools/build-review-boards.mjs`.

---

## The rest of the pack

Alongside the boards, the same directory holds the 46 individual full-resolution screenshots, including responsive captures of four key screens at **iPad landscape (1194×834)** and **iPad portrait (834×1194)** — `ipad-landscape--*.png` and `ipad-portrait--*.png`.
