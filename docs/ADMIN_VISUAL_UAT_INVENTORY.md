# Administration — complete visual UAT inventory

Branch `claude/kuwick-2-visual-audit-k9uk5z`. **Not merged. No PR.**

Every screenshot is an individual file in
[`docs/screenshots/admin/full-uat/`](https://github.com/redhahamid/KUWICK-2.0/tree/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/full-uat),
captured at 1680×1050 with 2× density — a 3360px-wide image in which a column
header and an RM figure are legible at 100%. There is no contact sheet to zoom
into.

All figures come from the synthetic UAT clinic **Klinik Contoh (UAT)**: two
branches, three panel companies with deliberately different fee and term rules,
eight employees, a posted stock take and one still counting, a rejected claim
already re-claimed and another still awaiting a decision, and an open trading
day. Every name is invented, every identifier is in the reserved
`000000-00-xxxx` form, and every address is on the `.invalid` TLD.

**How the columns are meant to be read.**

- **IMPLEMENTED** — the screen or workflow exists and does what its name says.
- **ENGINE EXISTS BUT NOT READY** — the server-side calculation is written and
  unit-tested, but the configuration it needs does not exist and cannot be
  entered through the product.
- **NOT IMPLEMENTED** — there is nothing. Where an endpoint exists with no UI,
  the row says so, because an endpoint nobody can reach is not a feature.
- **BACKEND VERIFIED** means the numbers on the screen were re-derived from the
  database by the seed's own invariant checks, or the behaviour is covered by
  an API integration test against real PostgreSQL.
- **PRODUCTION READY** is deliberately harsher than "implemented". It means: a
  clinic could run this in anger on Monday.

---

## 1 · OPERATION

| Screen / workflow | Implemented? | Visually verified | Backend verified | Test coverage | Production ready | Known limitation |
|---|---|---|---|---|---|---|
| Operation overview | Yes | `01`, `02` | Yes — figures re-derived by seed invariants | `admin-operations.spec.ts` | Yes | Doctor productivity is labelled BILLED, never doctor income |
| Period filter (Today / month / quarter / custom) | Yes | `02` | Yes | Covered by the overview spec | Yes | No "this year" preset |
| Segment P&L | Yes | `03` | Yes | `admin-operations.spec.ts` | Yes | Margin is contribution; overheads are not allocated |
| Programmes | Yes | `04` | Yes | `admin-operations.spec.ts` | Yes | Names the clinical indicators it cannot derive rather than estimating them |
| Marketing — audience builder | Yes | `05`, `06` | Yes | `admin-operations.spec.ts` | Yes | Live query only; a named audience cannot be saved and reused |
| Marketing — prepared message queue | Yes | `07` | Yes | Not covered by a browser spec | Yes, with the caveat below | Kuwick sends nothing. The furthest any screen claims is OPENED |
| Patient analysis | Yes (legacy component) | `08` | Yes | — | Yes | — |
| Procedure analysis | Yes (legacy component) | `09` | Yes | — | Yes | — |
| Doctor performance | Yes (legacy component) | `10` | Yes | — | Yes | — |
| Waiting times | Yes (legacy component) | `11` | Yes | — | Yes | Thin data in the UAT clinic |

## 2 · STOCK

| Screen / workflow | Implemented? | Visually verified | Backend verified | Test coverage | Production ready | Known limitation |
|---|---|---|---|---|---|---|
| Attention board | Yes | `12` | Yes — ledger reconciles to levels | `admin-stock.spec.ts` | Yes | — |
| Low stock / below minimum | Yes, as a VIEW of the board | `13` | Yes | `admin-stock.spec.ts` | Yes | Not a separate page |
| Negative stock | Yes, as a view | `14` | Yes | `admin-stock.spec.ts` | Yes | Not a separate page |
| Expired | Yes, as a view | `15` | Yes | — | Yes | — |
| Near expiry | Yes | `16` | Yes | — | Yes | — |
| Slow moving | Yes | `17` | Yes | — | Yes | — |
| Stock valuation | Yes | `18` | Yes | — | Yes | **Standard cost only.** Weighted-average and FIFO are not implemented and the screen says so |
| Stock by location | Yes (legacy component) | `19` | Yes | — | Yes | — |
| Item catalogue & pricing | Yes (legacy component) | `20` | Yes | `catalogue-findability.spec.ts` | Yes | Page is titled "Inventory"; the rail says "Items & Pricing" |
| Item create | Yes (legacy) | `21` | Yes | — | Yes | — |
| Item edit | Yes (legacy) | `22` | Yes | — | Yes | — |
| **Price change history** | **NOT IMPLEMENTED** | — | — | — | No | No audit of who changed a price or when |
| Suppliers | Yes (legacy component) | `23` | Yes | — | Yes | — |
| Movement ledger | Yes | `24` | Yes — append-only enforced by DB trigger | `admin-stock.spec.ts` | Yes | — |
| Transfer list | Yes | `25` | Yes | `admin-stock.spec.ts` | Yes | — |
| Receive transfer / discrepancy | Yes | `26` | Yes — sent 40, received 36, shortfall stays missing | `admin-stock.spec.ts` | Yes | — |
| **New transfer** | **NOT IMPLEMENTED in Admin** | — | — | — | No | Transfers can be received but not raised from this screen |
| Stock take list | Yes | `27` | Yes | `admin-stock.spec.ts` | Yes | — |
| Stock take — posted detail | Yes | `28` | Yes | `admin-stock.spec.ts` | Yes | — |
| Stock take — count in progress | Yes | `28b`, `28c` | Yes — lines counted, one variance with a typed reason, lines still uncounted | `admin-stock.spec.ts` | Yes | The list is branch-scoped, and the owner account is bound to one branch (see §Branch scope below) |
| Purchase orders | Yes (legacy component) | `29` | Yes | — | Yes | — |
| New purchase order | Yes (legacy) | `30` | Yes | — | Yes | — |
| Receive purchase order | Yes (legacy) | `31` | Yes | `inventory-receiving.e2e-spec.ts` | Yes | — |
| Procurement requests | Yes (legacy component) | `32` | Yes | — | Yes | — |

## 3 · PANEL

| Screen / workflow | Implemented? | Visually verified | Backend verified | Test coverage | Production ready | Known limitation |
|---|---|---|---|---|---|---|
| Submission queue | Yes | `40` | Yes | `admin-panel.spec.ts` | Yes | — |
| Claim readiness checklist | Yes | `41` | Yes | `admin-panel.spec.ts` | Yes | Reason for "not ready" is per-panel configuration |
| Mark submitted | Yes | `42` | Yes | `admin-panel.spec.ts` | Yes | **Kuwick never submits.** A person opens the portal; this records that they did |
| Work queue | Yes | `43` | Yes | `admin-panel.spec.ts` | Yes | — |
| Include-resolved view | Yes | `44` | Yes | — | Yes | — |
| Re-claim chain columns | Yes | `45` | Yes | — | Yes | Columns sit right of the fold; the table scrolls |
| Record panel outcome | Yes | `46` | Yes | `admin-panel.spec.ts` | Yes | — |
| Write off | Yes | `47` | Yes | `admin-panel.spec.ts` | Yes | Separate permission |
| Re-claim | Yes | `48` | Yes | — | Yes | Refused on a claim already re-claimed — a second replacement would double-count |
| Reconciliation | Yes | `49` | Yes — expected = received + outstanding + rejected + written off | `admin-panel.spec.ts` | Yes | — |
| Aging / outstanding | Yes | `49`, `100` | Yes | `admin-finance.spec.ts` | Yes | Aged per panel's own payment term |
| Panel configuration | Yes | `50`, `51` | Yes | `admin-panel.spec.ts` | Yes | — |
| Panel companies | Yes (legacy component) | `52` | Yes | — | Yes | — |
| Claim batches | Yes (legacy component) | `53` | Yes | — | Yes | — |
| **Record payment received (remittance)** | **Endpoint + hook exist, NO UI** | — | Endpoint tested | — | **No** | Panel money received cannot be recorded from any screen |
| **Claim history / audit trail** | **Endpoint exists, NO UI** | — | `ClaimEvent` rows are written | — | **No** | The timeline is recorded and unreadable |

## 4 · HR

### A. Workforce

| Screen / workflow | Implemented? | Visually verified | Backend verified | Test coverage | Production ready | Known limitation |
|---|---|---|---|---|---|---|
| HR Today dashboard | Yes | `60` | Yes | `admin-hr.spec.ts` | Yes | — |
| Employee directory | Yes | `61` | Yes | `admin-hr.spec.ts` | Yes | Shows no salary — the endpoint does not return one to this screen |
| Employee profile / record | Yes | `62`, `63` | Yes — one read composed from the owning tables | `admin-hr.spec.ts` | Yes | Read-only |
| Employment information | Yes | `62` | Yes | — | Yes | — |
| Bank information | Partial | `62` | Yes | — | Yes | Presence only. The account NUMBER is never returned by the endpoint |
| Statutory identifiers | Partial | `62` | Yes | — | Yes | Presence only, and they never imply a rate |
| Branch / department / position | Yes | `62` | Yes | — | Yes | — |
| Account vs employee vs clinical provider | Yes | `61`, `62` | Yes | `admin-hr.spec.ts` — asserts they stay three separate facts | Yes | — |
| **Add / edit employee FROM ADMIN** | **NOT REACHABLE from Admin** | `64`, `65` at the legacy URL | Endpoint + hook exist | — | **No** | `useUpsertEmployee` is never called by an Admin screen. The form lives at `/management/hr/staff` and the Admin rail has no door to it |
| **Employee documents** | **NOT IMPLEMENTED** | `63` shows the disclosure | — | — | No | No model, no upload, no retention rule. The screen says so rather than showing an empty list |

### B. Attendance

| Screen / workflow | Implemented? | Visually verified | Backend verified | Test coverage | Production ready | Known limitation |
|---|---|---|---|---|---|---|
| Timesheets | Yes | `66` | Yes | `admin-hr.spec.ts` | Yes | — |
| Individual staff attendance | Yes | `62` (in the record) | Yes | — | Yes | Summary + last 30 days |
| Late / missing punch | Yes | `66` | Yes | — | Yes | — |
| Overtime + approval | Yes | `66`, `67` | Yes | `admin-hr.spec.ts` — unapproved OT shown separately and not paid | Yes | — |
| **Attendance correction** | **Endpoint exists, NO UI** | `66` shows a "Corrected" tag | Endpoint tested | — | **No** | A corrected punch can be seen but not made |

### C. Leave

| Screen / workflow | Implemented? | Visually verified | Backend verified | Test coverage | Production ready | Known limitation |
|---|---|---|---|---|---|---|
| Leave requests + approval | Yes (legacy component) | `68` | Yes | — | Yes | — |
| Leave request form | Yes (legacy) | `69` | Yes | — | Yes | — |
| Leave balance | Yes | `62` links to it | Yes — derived from policy + stored rows + requests | `workforce-payroll.e2e-spec.ts` | Yes | Not surfaced as its own Admin screen |
| Leave blocks booking | Yes | `70` | Yes — `slot-availability.service.ts` and `provider-shift.service.ts` both read `leaveRequest` | `appointment` specs | Yes | — |
| **Leave type / policy configuration** | **Endpoints exist, NO UI** | — | Endpoints tested | — | **No** | Entitlements cannot be created or edited anywhere in the product |

### D. Roster

| Screen / workflow | Implemented? | Visually verified | Backend verified | Test coverage | Production ready | Known limitation |
|---|---|---|---|---|---|---|
| Monthly roster board | Yes | `70` | Yes | `appointment-module.spec.ts` | Yes | **One** shift table; HR renders the Appointments component |
| Shift editing | Yes | `71` | Yes | — | Yes | Pick day cells, then "Add shift" |
| Provider roster | Yes | `70` | Yes | — | Yes | — |
| **Non-clinical staff roster** | **NOT IMPLEMENTED** | — | — | — | No | The board rosters PROVIDERS. A counter assistant has attendance but no roster |
| Leave shown on the board | Yes | `70` | Yes | — | Yes | Read from HR, never re-entered |

### E. Payroll

| Screen / workflow | Implemented? | Visually verified | Backend verified | Test coverage | Production ready | Known limitation |
|---|---|---|---|---|---|---|
| Payroll landing | Yes | `72`, `76` | Yes | `admin-hr.spec.ts` | **No — see banner** | NOT READY FOR LIVE MALAYSIAN PAYROLL |
| New payroll run | Yes | `73` | Yes | `workforce-payroll.e2e-spec.ts` | No | — |
| Run list | Yes | `72` | Yes | — | No | — |
| Run detail, employee by employee | Yes | `74` | Yes | `workforce-payroll.e2e-spec.ts` | No | — |
| One employee's breakdown | Yes | `75` | Yes | — | No | Per-row, not a separate payslip view |
| Basic / OT / allowance / incentive | Yes | `74`, `75` | Yes | `payroll-calculation.spec.ts` | No | — |
| Unpaid leave deduction | Yes | `74`, `75` | Yes — pro-rated from the leave rows | `payroll-calculation.spec.ts` | No | — |
| Gross / net / employer cost | Yes | `74` | Yes | `payroll-calculation.spec.ts` | No | — |
| **EPF / SOCSO / EIS / PCB** | **ENGINE EXISTS BUT NOT READY** | `74`, `76` | Arithmetic unit-tested against SYNTHETIC rates | `payroll-calculation.spec.ts` | **No** | No Malaysian rate table is built in, none can be entered, none is verified. Columns render BLANK, never zero |
| Payroll approval | Yes | `74` | Yes | `workforce-payroll.e2e-spec.ts` | No | Button reads "Approve **without statutory figures**" and is blocked by exceptions |
| Locked state after approval | Yes | — | Yes — the database refuses recalculation | `workforce-payroll.e2e-spec.ts` | Yes | A correction is an adjustment row |
| Payroll exception | Yes | `74` | Yes | `workforce-payroll.e2e-spec.ts` | Yes | Named, not counted |
| **Statutory rate-table configuration UI** | **NOT IMPLEMENTED** | `76` | Read endpoint only | — | **No** | The list is read-only. Payroll cannot be made ready from inside the product |
| **PAYSLIP** | **NOT IMPLEMENTED** | — | — | — | **No** | Nothing generates, renders, prints or emails a payslip anywhere |

### F. Doctor incentives

| Screen / workflow | Implemented? | Visually verified | Backend verified | Test coverage | Production ready | Known limitation |
|---|---|---|---|---|---|---|
| Incentive overview + runs | Yes | `77` | Yes | `admin-hr.spec.ts` | Yes | — |
| Calculated run detail | Yes | `78` | Yes | `incentive-calculation.spec.ts` | Yes | — |
| Approved historical run | Yes | `78` | Yes — rule VERSION frozen at calculation | `admin-hr.spec.ts` | Yes | A paid incentive is never recalculated with today's rules |
| Rule list (threshold, per-procedure, resident vs locum) | Yes, read-only | `79` | Yes | `incentive-calculation.spec.ts` | Partly | — |
| **Rule configuration UI** | **Endpoint exists, NO UI** | `79` | Endpoint tested | — | **No** | Rules can be read and applied but not created or edited on screen |

### G. Staff benefits

| Screen / workflow | Implemented? | Visually verified | Backend verified | Test coverage | Production ready | Known limitation |
|---|---|---|---|---|---|---|
| Benefit overview | Yes | `80` | Yes | — | Yes | Read-only |
| Member / dependant detail | Yes | `81` | Yes | — | Yes | — |
| Annual limit + utilisation | Yes | `80`, `81` | Yes — balance DERIVED from dated uses | — | Yes | No stored running total to drift |
| **Setting an allowance / recording a use** | **NOT IMPLEMENTED here** | — | — | — | No | A use is recorded at billing; the allowance is payroll-adjacent and has no editor |

### H. Roles & access

| Screen / workflow | Implemented? | Visually verified | Backend verified | Test coverage | Production ready | Known limitation |
|---|---|---|---|---|---|---|
| Role list | Yes | `82` | Yes | `rls-enforcement.e2e-spec.ts` | Yes | — |
| Custom role + permission matrix | Yes | `83` | Yes — server holds a closed catalogue | — | Yes | Clinical authority is NOT grantable via a custom role |
| Per-user assignment + branch scope | Yes (legacy component) | `84` | Yes | — | Yes | Reachable from `/management/hr/staff`, not from Admin |
| **Trusted computers / device management** | **NOT IMPLEMENTED** | — | — | — | No | Not part of this product |

## 5 · FINANCE

| Screen / workflow | Implemented? | Visually verified | Backend verified | Test coverage | Production ready | Known limitation |
|---|---|---|---|---|---|---|
| Finance overview | Yes | `90` | Yes | `admin-finance.spec.ts` | Yes | Patient and panel receivables are never summed into one headline |
| Sales report | Yes (legacy component) | `91`, `92` | Yes | — | Yes | — |
| Daily sales | Yes, as a section | `92` | Yes | — | Yes | Not a separate page |
| Panel vs non-panel sales | Yes, as a section | `92` | Yes | — | Yes | — |
| Revenue by category | Yes, as a section | `92` | Yes | — | Yes | — |
| Sales by doctor | Yes, as a section | `92` | Yes | — | Yes | Billed under a doctor, never doctor income |
| Sales by panel company | Yes, as a section | `92` | Yes | — | Yes | — |
| **Monthly sales / payment-method report** | Partial | `98` | Yes | — | Partly | The payment ledger buckets by tender; there is no month-on-month report |
| Day-end — OPEN | Yes | `93` | Yes — expected derived from PAYMENTS with the refund netted | `admin-integration.spec.ts` | Yes | — |
| Day-end — counted, variance | Yes | `94` | Yes | `admin-integration.spec.ts` | Yes | — |
| Day-end — reason required | Yes | `95` | Yes — server refuses the close without one | `admin-integration.spec.ts` | Yes | — |
| Day-end — CLOSED and locked | Yes | `96` | Yes — figures frozen; write buttons dead | `admin-finance.spec.ts`, `admin-integration.spec.ts` | Yes | — |
| Day-end — reopen | Yes | `97` | Yes — separate permission, own record | `finance-payments-dayend.e2e-spec.ts` | Yes | — |
| Payment ledger, refunds and reversals | Yes | `98` | Yes — append-only | `admin-finance.spec.ts` | Yes | A reversal is not a refund and the screen says so |
| Invoice listing + paid/partial/unpaid | Yes (legacy component) | `99` | Yes | — | Yes | — |
| **Invoice detail drill-down** | **NOT IMPLEMENTED** | — | — | — | No | The listing does not open an invoice |
| Outstanding receivables + aging | Yes | `100` | Yes | `admin-finance.spec.ts` | Yes | Patient and panel money aged separately |
| Credit notes | Yes | `101` | Yes | `admin-finance.spec.ts` | Yes | Original invoice left exactly as issued |
| Credit note — approve a draft | Yes | `102` | Yes | `admin-finance.spec.ts` | Yes | — |
| **Credit note — CREATE** | **Endpoint + hook exist, NO UI** | — | Endpoint tested | — | **No** | `useCreateCreditNote` is called by nothing. A credit note can be approved but not raised anywhere in the product |
| **Debit note** | **NOT IMPLEMENTED** | — | — | — | No | No model, no endpoint, no screen |
| SST / tax report | Yes | `103` | Yes — summed from what each line charged | — | Yes | Warns on unclassified lines |
| Drug profitability | Yes | `104` | Yes — same revenue formula as segment P&L | `admin-integration.spec.ts` | Yes | Standard cost only |
| Procedure profitability | Yes | `105` | Yes | `admin-integration.spec.ts` | Yes | **No service has a cost basis**; every row reads COST NOT CONFIGURED |
| Missing-cost handling | Yes | `105` | Yes — excluded from totals, reported separately | `admin-integration.spec.ts` | Yes | Never treated as RM0 cost |
| Profitability rankings (5) | Yes | `106` | Yes | — | Yes | Rows with no margin sort last |
| Inter-company | Partial | `107` | Yes | — | Partly | Flags transfers with no billing reference; does not raise or settle an inter-company invoice |
| **e-Invoice (LHDN)** | **NOT IMPLEMENTED** | `108` | — | — | **No** | No MyInvois credentials, no submission, no validation, no document UUID, no consolidated return. The page exists to say exactly this |

## 6 · CROSS-MODULE WORKFLOWS

| Workflow | Frames | Complete end to end? | Known break |
|---|---|---|---|
| **A.** Invoice → payment → day-end → finance report | `wfA-1` … `wfA-4` | Yes | — |
| **B.** Panel visit → submission → response → re-claim → reconciliation | `wfB-1` … `wfB-5` | **No — one step has no screen** | Money RECEIVED from a panel cannot be recorded: the remittance endpoint has no UI |
| **C.** PO → goods received → ledger → transfer → receive → balance | `wfC-1` … `wfC-5` | Yes | Raising a NEW transfer has no Admin screen |
| **D.** Roster → attendance → leave → payroll input | `wfD-1` … `wfD-4` | Yes | Payroll output is not payable — see §4E |
| **E.** Doctor work → incentive run → payroll | `wfE-1` … `wfE-4` | Yes | Incentive rules cannot be edited on screen |

## 7 · RESPONSIVE

Nine screens × three widths, `responsive-<width>--<screen>.png`:
desktop-1680, ipad-landscape (1194×834), ipad-portrait (834×1194).

Operation overview · Stock overview · Panel work queue · HR employee directory ·
HR payroll run detail · HR roster · Finance overview · Day-end closing ·
Outstanding receivables.

The browser suite also asserts that the page body never scrolls sideways at any
of the three widths, over all 27 Admin routes (`admin-shell.spec.ts`).

---

## The pack

**141 individual screenshots**, each 3360 × 2132, in
[`docs/screenshots/admin/full-uat/`](https://github.com/redhahamid/KUWICK-2.0/tree/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/full-uat)
with a
[full index](https://github.com/redhahamid/KUWICK-2.0/blob/claude/kuwick-2-visual-audit-k9uk5z/docs/screenshots/admin/full-uat/README.md).

| Section | Shots |
|---|---|
| 1 · Operation | 11 |
| 2 · Stock | 23 |
| 3 · Panel | 14 |
| 4 · HR | 25 |
| 5 · Finance | 19 |
| 6 · Cross-module workflows (A–E) | 22 |
| 7 · Responsive (9 screens × 3 widths) | 27 |

Each capture script writes a `manifest-*.json` recording what it captured **and
what it could not**. Nothing is silently omitted: if an image is missing from
this pack, a manifest names it and says why.

The five earlier RC boards remain in the parent directory for anyone who wants
the module-at-a-glance view, but they are no longer the review artefact — these
files are.

---

## Branch scope — read every screenshot in this pack as ONE branch

This surfaced while capturing the stock-take workflow and it changes how the
whole pack should be read, so it belongs here rather than in a footnote.

A staff member whose record names a branch is **pinned to that branch**, and
the branch picker is not shown to them at all — `useClinicFilter` resolves the
branch from the staff record and only offers a picker when it genuinely cannot
know (a multi-branch tenant, and a person tied to no single branch). In the UAT
data the owner, Dr Aisyah Rahman, is the principal doctor at Contoh Central, so
**every screenshot in this pack shows Contoh Central and nothing else.** The
group total is not what is on screen.

That is the product behaving as designed — D-045, "once log in supposed to
under that clinic" — but it has a consequence worth stating plainly:

> **An owner of a two-branch group who is also a doctor at one of them cannot,
> with that account, see the other branch.** Nothing on screen says so either;
> the header reads "Viewing: Contoh Central" with no control next to it and no
> indication that another branch exists.

The seeded finance user (Chandra Devi, tied to no branch) *does* get the picker
and *does* see both. So the capability exists and the account model decides who
gets it. Whether a clinic owner should be branch-pinned is a product decision
for you, not something this pass should have changed on its own.

| | |
|---|---|
| **Implemented?** | Yes — branch resolution and the picker both work |
| **Visually verified** | Every shot in this pack; `28b`/`28c` are where it bit |
| **Known limitation** | An owner tied to a branch has no way to reach the other one, and no on-screen hint that one exists |
| **Production ready** | Yes for a single-branch clinic. For a multi-branch owner, decide the account model first |

---

## Everything the owner's list named that has NO screen

Collected in one place, because a gap spread across five tables is a gap nobody
adds up. Each of these was looked for and is genuinely absent — none is a
selector that failed.

| Asked for | State | Where the work is |
|---|---|---|
| **Payslip** | Nothing at all | — |
| **Statutory rate-table configuration** | Read-only list | `GET/POST /workforce/payroll/statutory-rules` exists; no create form |
| **Add / edit employee from Admin** | Reachable only at `/management/hr/staff` | `useUpsertEmployee` exists and is called by nothing |
| **Leave type / policy configuration** | Nothing | `GET/POST /workforce/leave/policies` exists; no UI |
| **Attendance correction** | Read-only tag | `PATCH /workforce/attendance/:id/correct` exists; no UI |
| **Incentive rule configuration** | Read-only list | `POST /workforce/incentives/rules` exists; no UI |
| **Panel payment received (remittance)** | Nothing | `POST /panel-workspace/remittances` and `useRecordRemittance` exist; no UI |
| **Claim history / audit trail** | Nothing | `ClaimEvent` rows are written; `timeline()` exists; no UI |
| **Credit note — create** | Nothing | `POST /finance/credit-notes` and `useCreateCreditNote` exist; no UI |
| **New stock transfer** | Nothing in Admin | Receiving exists; raising does not |
| **Invoice detail drill-down** | Nothing | Listing only |
| **Debit note** | Nothing | No model, no endpoint |
| **Price change history** | Nothing | No audit of who changed a price |
| **e-Invoice (LHDN)** | Honest placeholder page | Nothing behind it |
| **Trusted computers / device management** | Nothing | Not part of this product |
| **Non-clinical staff rostering** | Nothing | The board rosters providers only |
| **Employee document store** | Honest disclosure on the record | No model |

**Nine of these are endpoints with no screen.** That is the single clearest
signal about where this branch is: the server is further along than the product.

---

# The twelve questions, answered

### 1. Is the HR system currently a complete HRIS, or only a foundation?

**A foundation, and a good one — not a complete HRIS.**

What is genuinely there: the data model separates account, employment and
clinical credential correctly; attendance with overtime approval works; leave
approval works and really does block booking; there is one roster and it is the
same one the calendar books against; the payroll engine computes gross, unpaid
leave pro-ration, overtime, incentives, deductions and net, and it locks an
approved run so a correction has to be an adjustment.

What makes it a foundation rather than a product: **you cannot administer it
from inside itself.** An employee cannot be created or edited from Admin. A
leave policy cannot be created at all. A statutory rate table cannot be entered.
An incentive rule cannot be edited. Each of those has a working endpoint and no
screen — so the system can *run* a clinic's HR only if somebody sets it up
through the API first.

### 2. What exact HR features are missing versus a practical Malaysian SME HR/payroll system?

| Missing | Severity |
|---|---|
| **Payslip** — generate, render, print, email, or store | Blocker |
| **EPF/KWSP, SOCSO/PERKESO, EIS, PCB rate tables** and any UI to enter them | Blocker |
| **Borang E / EA form / CP8D** and any statutory submission file (EPF i-Akaun, SOCSO ASSIST, LHDN e-Data PCB) | Blocker |
| **Bank payment / giro file** (e.g. a bulk credit file for the payroll run) | Blocker |
| **Employee self-service** — payslip access, leave application, claim submission | Major |
| Add/edit employee from the HR module | Major |
| Leave policy and leave type configuration | Major |
| Attendance correction UI | Major |
| Incentive rule configuration UI | Major |
| Non-clinical staff rostering | Moderate |
| Employee document store (contract, offer letter, IC, certificates) | Moderate |
| Probation / confirmation workflow, appraisal, disciplinary record | Moderate |
| Claims and expense reimbursement | Moderate |
| Bonus / thirteenth-month and its statutory treatment | Moderate |
| Resignation, final pay and clearance | Moderate |

### 3. Can payroll be used for a real Malaysian salary run?

**No.** It can produce an internal costing figure. It cannot pay anybody
legally: there are no statutory deductions, no payslip, no statutory forms and
no bank file. The screen says so in a red banner above everything, and the
approve button is labelled "Approve **without statutory figures**".

### 4. Are KWSP, SOCSO, EIS and PCB compliant and production ready?

**No — and to be precise about which of the three labels applies: ENGINE EXISTS
BUT NOT READY.**

The arithmetic is implemented in `payroll-calculation.ts` and unit-tested, but
tested against **synthetic rates invented for the test**. No Malaysian schedule
is built into the product, none can be entered through any screen, none has been
checked against KWSP/PERKESO/LHDN published tables, and nothing has been
verified by anybody. Until a rate set exists AND is marked verified, every
statutory column renders **blank, never zero** — because zero is a claim and it
would be false.

Nothing on this branch should be read as EPF/SOCSO/EIS/PCB compliance.

### 5. Is a payslip generated?

**No.** Nothing in the product generates, renders, prints, emails or stores a
payslip. The word appears only in explanatory copy warning that runs must not be
used as the basis of one.

### 6. Does leave automatically affect roster and appointments?

**Yes, and this is verified in code, not assumed.** `slot-availability.service.ts`
and `provider-shift.service.ts` both read `leaveRequest` directly. Approved leave
appears on the roster board automatically and blocks booking; it is never
re-entered as a second record. The roster page states the rule on screen.

### 7. Does attendance feed payroll?

**Yes.** `payroll.service.ts` reads `attendanceRecord` for the period and uses
worked minutes, overtime minutes and unpaid days. Unapproved overtime is
excluded — it is shown separately on the timesheet and does not reach a payslip
until somebody other than the claimant approves it.

### 8. Does doctor incentive feed payroll?

**Yes, and only once it is safe to.** `payroll.service.ts` reads
`incentiveResult` rows **restricted to runs whose status is APPROVED or PAID**,
so a draft or recalculating incentive run cannot leak into a salary.

### 9. Which Finance workflows are fully operational?

Fully operational: day-end closing end to end (open → count → variance →
mandatory reason → close → frozen → permissioned reopen); the payment ledger
including refunds and reversals kept distinct; patient and panel receivables
aged separately; credit notes create/approve/issue leaving the original invoice
untouched; SST/tax summed from what each line actually charged; drug and
procedure profitability with honest missing-cost handling; sales reporting.

Not fully operational: **e-Invoice (nothing)**, **debit notes (nothing)**,
**invoice detail drill-down (nothing)**, **inter-company (flags only, cannot
raise or settle)**, and **month-on-month sales reporting**.

### 10. Which Panel processes remain manual, outside Kuwick?

- **Submitting the claim.** Kuwick never contacts a panel portal or API. A
  person opens the portal and keys it; Kuwick records that they did. This is
  deliberate — the brief forbade browser automation into panel portals.
- **Receiving the panel's response.** Somebody reads the adjudication and enters
  it on the Record-outcome screen.
- **Recording money received.** Currently manual *and* unsupported: the
  remittance endpoint exists but no screen calls it, so panel receipts cannot be
  recorded anywhere in the UI. This is the single biggest gap in the module.
- **Chasing.** Kuwick ages and prioritises; the phone call is a person's.

Kuwick is the control tower and the receivables ledger, exactly as specified —
but the ledger currently has no way to book a receipt.

### 11. Which screens still depend on legacy Management/Settings components?

Fifteen Admin routes render a component built for another hub. They are
**mounted, not copied** — same import, same endpoints, same rows — and each
original URL still resolves:

`/admin/operation/patients` · `/procedures` · `/doctors` · `/wait-times` ·
`/admin/stock/items` · `/locations` · `/purchase-orders` ·
`/procurement-requests` · `/suppliers` · `/admin/panel/batches` · `/companies` ·
`/admin/hr/leave` · `/admin/hr/access` · `/admin/finance/sales` · `/invoices`.

Plus `/admin/hr/roster`, which wraps the Appointments roster component.

The one visible seam: a mounted page keeps its own heading, so "Items & Pricing"
in the rail opens a page headed "Inventory". Renaming it would change
`/management` too, so it is reported rather than changed.

### 12. Are there any duplicate sources of truth?

**No duplicates were introduced, and I checked rather than assumed.** There is
one item catalogue, one stock ledger (append-only, enforced by database
trigger), one invoice source, one claim record, one employee record, one shift
table, one payment ledger.

Two things worth naming that are *not* duplicates but could be mistaken for
them:

- **`marketing_audiences` is a table nothing writes.** Dead, not duplicate — the
  audience builder is live-query only. It should either be used or dropped.
- **The invoice settlement mirror** (`patientPaidAmount` / `status` / `paidAt`
  on the invoice) is written only from the payment ledger, by one service, so
  the two representations cannot drift.

One *near* miss, already fixed on this branch: the Finance overview and
Outstanding disagreed by RM40 about the same stat because one defaulted to "as
at this instant" and the other to "as at end of today". Same source, two
readings of it — now one rule in one place.
