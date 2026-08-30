# Complete visual UAT pack — Administration

Every page, subpage, modal and workflow of the Administration system on branch
`claude/kuwick-2-visual-audit-k9uk5z`, as **individual full-resolution files**.

Each image is 3360 × 2132 (1680 × 1050 at 2× density). Column headers and RM
figures are legible at 100% — there is no contact sheet to zoom into. Open them
directly from this directory, or click through the tables below.

**Data:** the synthetic UAT clinic *Klinik Contoh (UAT)* — two branches, three
panel companies with different fee and payment-term rules, eight employees, one
posted stock take and one still counting, a rejected claim already re-claimed
and another still awaiting a decision, and an open trading day with takings in
all four tender buckets. Every name is invented, every identifier is in the
reserved `000000-00-xxxx` form, every email is on the `.invalid` TLD.

**The inventory that goes with these images** — what is implemented, what is an
engine without configuration, what is not built, and the answers to the twelve
questions — is in
[`docs/ADMIN_VISUAL_UAT_INVENTORY.md`](../../../ADMIN_VISUAL_UAT_INVENTORY.md).

**Sign in to reproduce:** `owner@admin-uat.kuwick.invalid` / `AdminUat!2026`.

---

## Regenerating

```bash
cd apps/api
export CHROME_PATH=/opt/pw-browsers/chromium

# Rebuild the tenant. Clearing it needs the DATABASE OWNER — every table is
# FORCE ROW LEVEL SECURITY, so a delete issued as the application role matches
# nothing and reports success.
KUWICK_ADMIN_UAT_SEED=yes \
ADMIN_UAT_RESET_URL='postgresql://<owner>:<pass>@127.0.0.1:5432/kuwick_dev?schema=public' \
npx tsx prisma/seed-admin-uat.ts

# In this order. 04 DRIVES the day-end — it counts the drawer short, saves the
# variance reason, closes the day and opens the reopen dialog — so it must run
# after 01–03 and before 05, and a second full pack needs the re-seed above.
for s in 01-operation-stock 02-panel 03-hr 04-finance 05-workflows-responsive; do
  npx tsx prisma/full-uat/$s.ts
done
```

Both servers must be running. Each script writes a `manifest-*.json` listing
what it captured **and what it could not** — a capture that fails is recorded,
never silently skipped.

---

## 1 · Operation

| # | Screen | File |
|---|---|---|
| 01 | Operations overview | `01-operation-overview.png` |
| 02 | Overview, period filter changed | `02-operation-overview-period-filter.png` |
| 03 | Segment P&L | `03-operation-segment-pnl.png` |
| 04 | Programmes | `04-operation-programmes.png` |
| 05 | Marketing, before an audience is built | `05-operation-marketing-empty.png` |
| 06 | Marketing, audience built | `06-operation-marketing-audience-built.png` |
| 07 | **Prepared message queue** (manual WhatsApp) | `07-operation-marketing-prepared-queue.png` |
| 08 | Patient analysis, inside Admin | `08-operation-patient-analysis.png` |
| 09 | Procedure analysis, inside Admin | `09-operation-procedure-analysis.png` |
| 10 | Doctor performance, inside Admin | `10-operation-doctor-performance.png` |
| 11 | Waiting times, inside Admin | `11-operation-waiting-times.png` |

## 2 · Stock

| # | Screen | File |
|---|---|---|
| 12 | Attention board | `12-stock-attention-board.png` |
| 13 | View — below minimum (low stock) | `13-stock-view-below-minimum.png` |
| 14 | View — negative stock | `14-stock-view-negative.png` |
| 15 | View — expired | `15-stock-view-expired.png` |
| 16 | Near expiry | `16-stock-near-expiry.png` |
| 17 | Slow moving | `17-stock-slow-moving.png` |
| 18 | Stock valuation | `18-stock-valuation.png` |
| 19 | Stock by location | `19-stock-by-location.png` |
| 20 | Item catalogue & pricing | `20-stock-item-catalogue-pricing.png` |
| 21 | Item — create | `21-stock-item-create.png` |
| 22 | Item — edit | `22-stock-item-edit.png` |
| 23 | Suppliers | `23-stock-suppliers.png` |
| 24 | Movement ledger | `24-stock-movement-ledger.png` |
| 25 | Transfers | `25-stock-transfers-list.png` |
| 26 | **Receive transfer — discrepancy** | `26-stock-transfer-receive-modal.png` |
| 27 | Stock take list | `27-stock-take-list.png` |
| 28 | Stock take — posted, with variance | `28-stock-take-count-detail.png` |
| 28b | Stock take list — one posted, one still counting | `28b-stock-take-counting-in-progress.png` |
| 28c | Count in progress — 3 of 6 counted, a −2 variance with its reason, "Submit for approval" live | `28c-stock-take-counting-detail.png` |
| 29 | Purchase orders | `29-stock-purchase-orders.png` |
| 30 | New purchase order | `30-stock-purchase-order-create.png` |
| 31 | Receive purchase order | `31-stock-purchase-order-receive.png` |
| 32 | Procurement requests | `32-stock-procurement-requests.png` |

## 3 · Panel

| # | Screen | File |
|---|---|---|
| 40 | Submission queue | `40-panel-submission-queue.png` |
| 41 | Claim readiness checklist | `41-panel-claim-readiness-checklist.png` |
| 42 | Mark submitted | `42-panel-mark-submitted-modal.png` |
| 43 | Work queue | `43-panel-work-queue.png` |
| 44 | Work queue, resolved included | `44-panel-work-queue-include-resolved.png` |
| 45 | **Re-claim chain columns** | `45-panel-reclaim-chain-columns.png` |
| 46 | Record panel outcome | `46-panel-record-outcome-modal.png` |
| 47 | Write off | `47-panel-write-off-modal.png` |
| 48 | **Re-claim** | `48-panel-reclaim-modal.png` |
| 49 | Reconciliation + aging | `49-panel-reconciliation.png` |
| 50 | Panel configuration | `50-panel-configuration.png` |
| 51 | Configuration, every rule column | `51-panel-configuration-all-columns.png` |
| 52 | Panel companies | `52-panel-companies.png` |
| 53 | Claim batches | `53-panel-claim-batches.png` |

## 4 · HR

| # | Screen | File |
|---|---|---|
| 60 | HR Today | `60-hr-today-dashboard.png` |
| 61 | Employee directory | `61-hr-employee-directory.png` |
| 62 | **Employee record** — employment, person, pay basis, statutory | `62-hr-employee-profile-top.png` |
| 63 | Employee record — attendance, payroll history, documents | `63-hr-employee-profile-payroll-history.png` |
| 64 | Staff management *(legacy URL — no Admin door)* | `64-hr-staff-management-legacy.png` |
| 65 | Add staff form *(legacy URL)* | `65-hr-add-staff-form-legacy.png` |
| 66 | Timesheets | `66-hr-attendance-timesheets.png` |
| 67 | Overtime approval | `67-hr-attendance-overtime-approval.png` |
| 68 | Leave requests | `68-hr-leave-requests.png` |
| 69 | Leave request form | `69-hr-leave-request-form.png` |
| 70 | Roster — month | `70-hr-roster-month.png` |
| 71 | Roster — shift editor | `71-hr-roster-shift-edit.png` |
| 72 | Payroll landing | `72-hr-payroll-landing.png` |
| 73 | New payroll run | `73-hr-payroll-new-run-modal.png` |
| 74 | **Payroll run detail, employee by employee** | `74-hr-payroll-run-detail.png` |
| 75 | **Payroll breakdown, every column** | `75-hr-payroll-employee-breakdown.png` |
| 76 | **NOT READY FOR LIVE MALAYSIAN PAYROLL** | `76-hr-payroll-statutory-notready-banner.png` |
| 77 | Doctor incentives | `77-hr-incentives-overview.png` |
| 78 | Incentive run detail | `78-hr-incentive-run-detail.png` |
| 79 | Incentive rules *(read-only)* | `79-hr-incentive-rules.png` |
| 80 | Staff benefits | `80-hr-staff-benefits.png` |
| 81 | Benefit — dependants and uses | `81-hr-staff-benefit-member-detail.png` |
| 82 | Roles & access | `82-hr-roles-and-access.png` |
| 83 | Custom role — permission matrix | `83-hr-custom-role-permission-matrix.png` |
| 84 | Per-staff access *(legacy URL)* | `84-hr-staff-access-drawer-legacy.png` |

## 5 · Finance

| # | Screen | File |
|---|---|---|
| 90 | Finance overview | `90-finance-overview.png` |
| 91 | Sales report | `91-finance-sales-report.png` |
| 92 | Sales breakdowns — day, panel, category, doctor | `92-finance-sales-breakdowns.png` |
| 93 | **Day-end — OPEN**, expected derived | `93-finance-day-end-OPEN.png` |
| 94 | **Day-end — counted, RM20 variance** | `94-finance-day-end-COUNTED-variance.png` |
| 95 | Day-end — reason required before close | `95-finance-day-end-variance-reason-required.png` |
| 96 | **Day-end — CLOSED and locked** | `96-finance-day-end-CLOSED-locked.png` |
| 97 | Day-end — reopen | `97-finance-day-end-reopen-modal.png` |
| 98 | Payment ledger — refunds and reversals | `98-finance-payment-ledger.png` |
| 99 | Invoice listing | `99-finance-invoice-listing.png` |
| 100 | Outstanding receivables + aging | `100-finance-outstanding-receivables.png` |
| 101 | Credit notes | `101-finance-credit-notes.png` |
| 102 | Credit note — approve a draft | `102-finance-credit-note-approve-DRAFT.png` |
| 103 | SST / tax | `103-finance-tax-sst.png` |
| 104 | **Drug profitability** | `104-finance-profitability-drugs.png` |
| 105 | **Procedure profitability — COST NOT CONFIGURED** | `105-finance-profitability-procedures-no-cost.png` |
| 106 | Profitability — lowest margin ranking | `106-finance-profitability-lowest-margin.png` |
| 107 | Inter-company | `107-finance-inter-company.png` |
| 108 | **e-Invoice (LHDN) — NOT IMPLEMENTED** | `108-finance-e-invoice-NOT-IMPLEMENTED.png` |

## 6 · Cross-module workflows

| Workflow | Frames |
|---|---|
| **A** Invoice → payment → day-end → finance | `wfA-1-invoice-listing` · `wfA-2-payment-ledger` · `wfA-3-day-end-same-money` · `wfA-4-finance-overview-rollup` |
| **B** Panel visit → submission → response → re-claim → reconciliation | `wfB-1-submission-queue` · `wfB-2-work-queue-rejected` · `wfB-3-reclaim-chain` · `wfB-4-reconciliation` · `wfB-5-panel-receivable-in-finance` |
| **C** PO → goods received → ledger → transfer → receive → balance | `wfC-1-purchase-orders` · `wfC-2-movement-ledger` · `wfC-3-transfers` · `wfC-4-receive-confirms-what-arrived` · `wfC-5-stock-balance-by-location` |
| **D** Roster → attendance → leave → payroll | `wfD-1-roster` · `wfD-2-attendance` · `wfD-3-leave` · `wfD-4-payroll-reads-them` |
| **E** Doctor work → incentive run → payroll | `wfE-1-doctor-productivity` · `wfE-2-incentive-rules-and-runs` · `wfE-3-incentive-run-detail` · `wfE-4-incentive-column-in-payroll` |

## 7 · Responsive

`responsive-desktop-1680--*`, `responsive-ipad-landscape--*`,
`responsive-ipad-portrait--*` for: operation-overview · stock-overview ·
panel-work-queue · hr-employee-directory · hr-payroll-run-detail · hr-roster ·
finance-overview · finance-day-end · finance-outstanding.
