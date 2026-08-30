# Admin integration pass — what changed, and what is still missing

Branch `claude/kuwick-2-visual-audit-k9uk5z`. **Not merged.**

This pass had one central instruction: *the owner must experience one Kuwick
Admin system, not "new Admin" plus "old Management/Settings" as two products.*
The architecture is frozen, the five domains were not rebuilt, and no
speculative feature was added.

---

## §A — One Admin information architecture

### The finding, restated

Roughly a third of the screens the Admin rail names were built years earlier and
live under `/management`, `/settings` or `/appointments`. Reaching item pricing
from Admin ▸ Stock meant leaving Admin and arriving in what read as a different
application.

That is a **navigation and presentation** defect. The wrong fix would have been
a second item catalogue.

### What was done

Fourteen Admin routes now **mount** a component written for another hub — same
import, same hooks, same endpoints, same rows:

| Admin route | Component | Originally |
|---|---|---|
| `/admin/operation/patients` | `PatientAnalysisPage` | Management |
| `/admin/operation/procedures` | `ProcedureAnalysisPage` | Management |
| `/admin/operation/doctors` | `DoctorPerformancePage` | Management |
| `/admin/operation/wait-times` | `WaitTimesPage` | Management |
| `/admin/stock/items` | `ItemsPage` | Management |
| `/admin/stock/locations` | `StockLevelsPage` | Management |
| `/admin/stock/purchase-orders` | `PurchaseOrdersPage` | Management |
| `/admin/stock/procurement-requests` | `ProcurementRequestsPage` | Management |
| `/admin/stock/suppliers` | `SuppliersPage` | Management |
| `/admin/panel/batches` | `PanelClaimsPage` | Management |
| `/admin/panel/companies` | `PanelClinicsPage` | Management |
| `/admin/hr/leave` | `LeaveRequestsPage` | Management |
| `/admin/hr/access` | `RolesSettingsPage` | Settings |
| `/admin/hr/roster` | `RosterPage` (wrapped) | Appointments |

Three more render an existing component with a **prop** rather than a copy:
`/admin/stock/near-expiry`, `/admin/stock/slow-moving` and `/admin/stock/value`
all open `StockOverviewPage` on a different question.

Seven are genuinely new screens: Staff Benefits, Tax/SST, Profitability,
Inter-company, e-Invoice, plus the Roster wrapper and Stock Value.

**Every original URL still resolves to its original hub.** Bookmarks, deep links
and the redirects in `App.tsx` are untouched, and `e2e/admin-integration.spec.ts`
asserts it.

### The two dead nav entries

Slow Moving and Stock Value were `?view=slowMovers` and `?panel=value` query
strings. `HubShell` highlights on an **exact pathname match**, so both navigated
correctly and then highlighted nothing — which reads to a user as a dead link.
Both are real paths now.

### Visual coherence (§I)

`HubShell` takes a `scopeClass`; Admin passes `kw-hub--admin`. Scoped to that
class, three presentational differences are closed:

- **Header** — `PageHeader` adopts `AdminShell`'s 19px/650 title and 12.5px
  subtitle.
- **Surface** — antd `Card` drops its shadow for `.kw-adminSection`'s hairline
  border and tinted head. Modals and drawers portal to `<body>` and so keep
  their elevation.
- **Density** — tables get the Admin header tint and 12.5px rows.

Scoped, so `/management` keeps the look its users know and there is still
exactly one of each component. No page's markup was rewritten.

**What is NOT fixed:** a mounted page still uses its own heading text — Items &
Pricing opens a page titled "Inventory", Stock by Location one titled "Stock
Levels". Renaming them would change `/management` too. Flagged, not changed.

---

## §B — Stock

All eleven screens the brief lists are reachable from Admin ▸ Stock. No stock
control was weakened: the ledger is still append-only (enforced by trigger), a
transfer discrepancy still stays missing rather than being balanced away by the
sender, the stock-take path is still count → recount/submit → approval →
posting, and the standard-cost limitation is still disclosed on every screen
that shows a valuation.

---

## §C — Panel

### Defect found: a mislabelled money column

The work queue's **"Claimed"** column was rendering `expectedReceivable`, which
is claimed **plus** the panel's admin fee. On a panel carrying an 8% fee that is
RM108 displayed under a heading saying RM100 — on the screen whose entire job is
reconciling against what the panel says it received. Claimed, fee and receivable
are now three columns.

### Google-Sheet use cases

| Use case | Where |
|---|---|
| Claimed | Work queue · `Claimed` |
| Fee | Work queue · `Fee` |
| Receivable | Work queue · `Receivable` |
| Paid | Work queue · `Received` |
| Outstanding | Work queue · `Outstanding`, and Reconciliation |
| Original claim number | Work queue · `Replaces` (added) |
| Replacement claim number | Work queue · `Replaced by` — now the claim number, not the batch |
| Resubmission date | Work queue · `Resubmitted` (added), showing **not sent yet** when a re-claim is prepared but unsent |
| Reason / remarks | Work queue · `Reason`, plus the rejection reason on the superseded claim |
| Resolved status / date | Work queue · `Resolved` (added), with an **Include resolved** toggle |
| Payment terms / aging | Work queue · `Terms` and `Due` (added), aged per panel |

Panel Configuration now also shows claim-number format, account reference and
the panel's instructions.

**Lifecycle is unchanged and still distinguishes** submitted-through-a-portal
from adjudicated from paid. `PanelClaimStatus` carries all fifteen states.
**No browser automation into panel portals.**

---

## §D — HR

### NOT READY FOR LIVE MALAYSIAN PAYROLL

An undismissable banner sits above everything on the payroll screen whenever no
statutory rate set has been verified. EPF/KWSP, SOCSO/PERKESO, EIS and PCB are
**not implemented**; statutory columns render blank, not zero; approval is
labelled "Approve without statutory figures". No formula was guessed.

### The employee record

Opening a row in the directory opens the whole record: employment, person, pay
basis, statutory position, attendance and payroll history — composed in **one
read** (`GET /workforce/employees/:id/record`) from the tables that already own
each fact. There is no second employee record behind it.

Pay stays behind `hr.payroll.view`. Bank account numbers and statutory
identifier **values** are never returned — only whether they are on file.

**Documents say plainly that no employee document store exists** rather than
rendering an empty list, which would read as "none uploaded".

Employee identity, login account and clinical provider identity remain three
separate facts about one person.

### Two screens that were empty because the seed was, not the product

HR ▸ Roster opened on a month grid reading "no provider is on the monthly
roster yet", and HR ▸ Roles & Access on an empty table. Both were honest empty
states over data that did not exist. The UAT seed now writes three weeks of
weekday shifts through the **same** `provider_shifts` table the Appointments
calendar books against — not an HR-only schedule — with the providers switched
to `ROSTER_LINKED`, the mode that board is about. It also creates two custom
roles (Branch Manager, Panel Claims Clerk), neither carrying clinical authority,
which is the rule that screen exists to state.

---

## §E — Finance

One workspace with eleven entries. Sales, Invoices and e-Invoice reuse the
existing screens; there is **one invoice source**. New: Tax/SST, Profitability,
Inter-company.

**e-Invoice (LHDN) is not built.** The page says so and lists what exists
(invoice numbering, tax codes, buyer details) against what is missing (LHDN
submission, validation, QR, consolidated returns).

---

## §F — Day-end, proved with real data

The board showed an almost-empty closing day. The cause was arithmetic, not a
defect: every seeded trading day was in the past and already closed, so the
screen opened on today and correctly reported nothing.

**Today at Contoh Central is now an open trading day** — cash, card, QR, bank
transfer, a RM40 card refund and a panel invoice that bills but puts nothing in
the drawer. Expected: **RM562.90**. No closing row is seeded, because the state
the workflow starts from is "nobody has counted this yet".

A seed invariant fails the build if today is empty, if a bucket is missing, if
the refund is not netted, or if the day arrives already closed.

The flow is **driven**, not staged — by `prisma/admin-rc-shots.ts` for the
screenshots and by `e2e/admin-integration.spec.ts` as a test. Both read the
expected figures off the screen, count cash RM20 short, are refused a close
until a reason is given, close the day, and assert the result is locked.

### Two defects this found

- A closed day reported **"Refunded RM0.00"** directly above a movements table
  listing a RM40 refund. The frozen columns carry no refund total and a zero
  stood in for one. Zero is a claim — "no money was handed back today" — and it
  was false.
- The variance tile still read **"Needs an explanation"** after the day was
  closed and the explanation given.

---

## §G — Profitability

`GET /finance/profitability` reports per drug and per procedure: quantity,
revenue, direct cost, contribution, margin %, branch, period. Five rankings.
Revenue uses the same formula as `segment.service.ts`, to the cent.

**Contribution is never called net profit.** Rent, salaries, equipment and every
other overhead are unallocated, and the screen says so twice.

**`ServiceCatalog` has no cost column anywhere in the schema.** So every
procedure reports **COST NOT CONFIGURED**, its contribution and margin are
dashes, and its revenue is excluded from the totals — which are reported
alongside the revenue that has no cost basis. Treating unknown as RM0 would
report every procedure as pure profit.

A defect fixed here: the summary tiles rendered "Direct cost RM0.00" and
"Contribution RM0.00" three inches above a banner saying six rows have no cost
on record. The table got this right and the summary contradicted it — and the
summary is the version somebody screenshots for a meeting.

---

## §H — Operation / marketing regression audit

| Capability | State |
|---|---|
| Audience building from live data | Present — programme, recency, lapse, age |
| Programme segmentation | Present — Operation ▸ Programmes, and as an audience criterion |
| Message templates with placeholders | Present |
| **Manual WhatsApp opening / sending queue** | **Was missing from the UI. Restored.** |
| Prepared / opened history | Present, and now reachable |
| Patient-app sharing / promotional material | Present in Appointments ▸ Booking Page (link, QR, printable poster) |

`POST /operations/marketing/prepare` and `PATCH …/dispatches/:id/opened`
existed as endpoints **with no UI**, so the audience builder could not reach a
message and the history table could only ever be empty. The queue is back: one
row per patient, a `wa.me` link, and a record of the click.

**Nothing is sent.** The furthest any screen claims is OPENED, which is a click
this system witnesses. No provider acknowledgement is claimed because there is
no provider.

Marketing now also names where the rest of patient outreach lives, rather than
rebuilding it.

---

## Defects found and fixed in this pass

All ten were found by driving the product or by the guardrail, not by reading
the code.

| # | Defect | Where |
|---|---|---|
| 1 | **"Claimed" showed claimed + fee.** On an 8% panel, RM108 under a heading saying RM100 — on the reconciliation screen. | Panel work queue |
| 2 | **Two screens disagreed by RM40 about one stat.** "Patient receivable" meant "as at this instant" on the overview and "as at end of today" on Outstanding. | Finance overview vs Outstanding |
| 3 | **A closed day reported "Refunded RM0.00"** directly above a movements table listing a RM40 refund. | Day-end |
| 4 | **A closed day said "the day cannot be closed until the difference is explained"**, next to the explanation that closed it. | Day-end |
| 5 | **Profitability's summary tiles read "Direct cost RM0.00" and "Contribution RM0.00"** above a banner saying six rows have no cost on record. | Finance ▸ Profitability |
| 6 | **A `<ul>` inside a `<p>`.** The payroll exceptions list broke out of its band and logged a React error on every render. | `AdminNotice`, all modules |
| 7 | **Two nav entries highlighted nothing.** `?view=` query strings against a rail that matches on exact pathname — a working link that reads as dead. | Admin ▸ Stock |
| 8 | **The drawer count form was unreadable.** Four columns in a 360px sidebar; the hint wrapped to five lines into the expected figure. | Day-end |
| 9 | **"Include resolved" included nothing.** A re-claimed original ends up `RESUBMITTED`, a status in neither branch of the work-state filter, so the re-claim chain could not be seen on any view of the screen. | Panel work queue |
| 10 | **The rejection reason pushed the re-claim columns off screen.** As the widest column it sat in front of "Replaced by" and "Resubmitted". | Panel work queue |

Plus two screens that were empty because the seed was, not the product: HR ▸
Roster and HR ▸ Roles & Access.

---

## Unresolved product gaps

These are stated rather than papered over.

1. **e-Invoice (LHDN) is not implemented.** No submission, no validation, no QR,
   no consolidated return.
2. **Malaysian statutory payroll is not implemented.** No EPF/SOCSO/EIS/PCB
   schedule exists and none is guessed. Payroll is not fit to pay staff with.
3. **No service or procedure has a cost basis.** `ServiceCatalog` has no cost
   column, so procedure profitability can report revenue and nothing else. Adding
   one is a product decision (standard cost? consumables roll-up? doctor time?),
   not a schema oversight to fix silently.
4. **Stock costing is standard cost only.** Weighted-average and FIFO are not
   implemented and every screen says so.
5. **`marketing_audiences` is a table nothing writes.** A named, saved audience
   cannot be reused — the builder is live-query only, and a dispatch carries a
   free-text audience name. Building saved-audience CRUD was judged a new
   feature, not a regression fix.
6. **No employee document store.** Contracts, offer letters, IC copies and
   certificates have nowhere to live.
7. **Mounted screens keep their own page titles.** "Items & Pricing" in the rail
   opens a page headed "Inventory". Changing it would change `/management` too.
8. **Inter-company is billing-reference only.** It flags inter-company transfers
   with no billing reference; it does not raise or settle an inter-company
   invoice.
