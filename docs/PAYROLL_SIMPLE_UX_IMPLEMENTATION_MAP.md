# Payroll Simple UX — implementation map

The owner's verdict after UAT on Render: *"The existing Excel payroll is easier to
understand and easier to use than Kuwick."*

This maps every payroll surface to where it goes. The engine does not move. The
finding of this audit is that **the backend already composes everything the
simplified workflow needs** — `GET /workforce/payroll/runs/:id/journey` returns
itemised pay items with provenance, server-computed totals carrying their own
`addsUp` / `discrepancy` verdict, per-employee readiness state, the EPF basis
beside Kuwick's own assessment, and the contractor list that must stay out of
payroll. Nothing below needs a new data model. Every gap is a screen that had
the figures and did not put them beside each other.

## What was actually wrong

Not the numbers. The **route**. `HR → Payroll` landed on a dashboard —
hero, three explanatory cards, a recent-runs table — and the month's work was
one click further in. An owner opening payroll to pay people first had to read
a page about payroll.

| Owner's question | Where the answer lived | Clicks |
|---|---|---|
| Who am I paying? | `payroll/:id?step=prepare` register | 3 |
| What did this person earn? | drawer, after finding the row | 4 |
| Why is this person not ready? | `payroll/readiness`, a separate page | 3 |
| What is deducted? | drawer, third section | 4 |
| Is anything wrong? | `?step=review` | 4 |
| Where is last month? | landing page table | 1 |

Six answers, five destinations. The spreadsheet answers all six on one row.

## Route map

| Route | Current | New | Verdict |
|---|---|---|---|
| `/admin/hr/payroll` | `PayrollHomePage` — hero + attention/setup/feeding cards + recent runs | `PayrollMonthPage` — resolves the current month and renders the workspace directly | **replace** |
| `/admin/hr/payroll/:id` | `PayrollRunPage` — owns header, stage bar, four stages | Same URL, renders the shared `PayrollWorkspace` | **keep, refactored** |
| `/admin/hr/payroll/history` | *(did not exist)* | `PayrollHistoryPage` — month, status, employees, gross, net, cost, approved by/date | **new, secondary** |
| `/admin/hr/payroll/readiness` | `PayrollReadinessPage` — a whole page of who is not ready | Redirect to the month workspace; readiness now sits **beside the employee it affects** | **hide, redirect** |
| `/admin/hr/payroll/all` | `PayrollPage` — legacy all-runs table | Redirect to `/history` | **hide, redirect** |
| `/admin/hr/payroll/ytd-opening` | `YtdOpeningImportPage` | Moves under Payroll settings | **reposition** |
| `/admin/hr/incentives` | `IncentivesPage` | Unchanged route; leaves primary nav, reached from the incentive figure it produces | **keep, demote** |
| `/admin/hr/locum` | `LocumPage` | Unchanged route; leaves primary nav | **keep, demote** |
| `/admin/hr/benefits` | `BenefitsPage` | Unchanged route; leaves primary nav, reached from Employees | **keep, demote** |
| `/admin/hr/reports` | `PayrollReportsPage` | Unchanged | **keep** |
| `/admin/hr/settings/payroll` | `PayrollSettingsPage` | Unchanged — set-once administration | **keep** |

No route is deleted. Every demoted URL keeps resolving, and `covers` in
`AdminLayout` keeps it lighting the section that now owns it, so bookmarks do
not land somewhere unlit.

## Component map

| Component | Current purpose | New location | Verdict | Canonical source |
|---|---|---|---|---|
| `PayrollHomePage` | Landing dashboard | — | **deleted**; its readiness content moves onto the rows | `payroll/home` |
| `PayrollStartGate` | Decides whether the month may start | Inside the month header's start state | **keep** | `payroll/home.setup` |
| `PayrollRunPage` | Route + workspace + four stages | Split: route shell + `PayrollWorkspace` | **simplify** | `runs/:id/journey` |
| `PayrollWorkspace` | *(new)* | Month header, stage bar, stage bodies — mounted by both routes | **new** | `runs/:id/journey` |
| `PayrollMonthHeader` | *(new)* | Period, employees, gross, employee deductions, employer contributions, NET | **new** | `journey.pay.totals` |
| `PayrollGrid` | Flat one-band register | Grouped bands, per-row status, column chooser, mobile cards | **rebuild** | `runs/:id` lines + `journey.pay.rows` |
| `PayrollEmployeeDrawer` | 3 sections + net | 4 sections (Earnings / Deductions / Statutory / Result), add earning + add deduction, employer cost | **extend** | `journey.pay.rows[].items` |
| `PayrollInputsDrawer` | Separate manual-entry drawer | Folded into the employee drawer as a compact inline editor | **absorb** | `POST payroll/inputs` |
| `PayrollExceptionCentre` | Review-stage blockers/warnings | Unchanged in Review; its rows also project onto the register | **keep** | `journey.review.attention` |
| `PayrollReadinessPage` | Standalone readiness page | — | **hidden**; redirect | `payroll/readiness` |
| `PayrollStepper` | Four stages | Unchanged — already Payroll Details / Review / Approve / Finalise | **keep** | — |
| `PayrollSnapshotPanel`, `PayrollVariancePanel` | Finalise-stage detail | Unchanged | **keep** | `snapshots`, `variance` |

## Security implications

Nothing in this pass touches authority. Recorded so the reviewer can check:

- **No arithmetic moves to the browser.** The register renders `journey.pay.rows`
  and foots with `journey.pay.totals`, which the server computes and marks
  `addsUp` / `discrepancy`. The new register asserts the server's verdict rather
  than forming its own.
- **`+ Add earning` is `POST /workforce/payroll/inputs`**, unchanged. The service
  already refuses to overwrite a canonically-sourced figure ("This OVERTIME
  figure came from ATTENDANCE and is maintained there"), and the drawer now
  reads `item.editable` so it never offers an edit the server will refuse.
- **Approval identity stays server-side.** `journey.approval.youMayApprove` and
  `whyNot` come from the same rule the server enforces with; the screen never
  offers a button the server would reject, and no approver id is selectable.
- **Contractors stay out.** `journey.employees.contractors` is rendered as an
  exclusion note, never as a payable row.
- **Snapshots stay frozen.** History reads the approved snapshot; the register is
  read-only once `approvedAt` is set.
- **Branch scope is unchanged** — every query still carries `clinicId` from
  `useClinicFilter`.

## Backend gaps found

One, and it is small: the month workspace wants to reach a run **by period**
without the caller knowing its id. `GET /workforce/payroll/home?period=` already
returns `run.id` for the period, so the month page resolves the id from the home
payload and no new endpoint is needed.

No other gap. The journey endpoint already carries every figure, every source
and every verdict the simplified workflow renders.

---

# What was actually built

Written after the work, against the running product rather than the plan.

## The one change that mattered

`HR → Payroll` opens on the month's register. Everything else in this pass
follows from that: the landing dashboard is gone, readiness moved onto the rows
it is about, history moved behind a control beside the month picker, and the
four stages became the only navigation inside a month.

## Backend

Small and additive; no engine, schema, migration or statutory logic was touched.
`payroll-journey.service.ts` gained figures it already had the inputs for, so
that no screen has to work anything out:

- `pay.rows[]` — `position`, `state`, `reason`, `blockers`, `warnings`,
  `fixLink` (the employee/exception join, done once on the server),
  `epfEmployee`, `epfEmployer`, `socsoEmployee`, `socsoEmployer`, `eisEmployee`,
  `eisEmployer`, `hrdLevy`, `employerContributions`, and the two grouped columns
  the register opens with, `additionalEarnings` and `socsoEis`.
- `pay.totals` — `employerContributions`, `employerCost`, `additionalEarnings`,
  `socsoEis`, `socsoEisNotCalculated`, and per-scheme `epfEmployee`,
  `socsoEmployee`, `eisEmployee`, so a column headed EPF foots on EPF.
- `payroll-exception.ts` — one machine plural (`1 day(s)`) made English.

## Frontend

| File | Change |
|---|---|
| `PayrollMonthPage.tsx` | **New.** `/admin/hr/payroll`: resolves the period's run and mounts the workspace, or shows the month's start state. Period lives in the URL. |
| `PayrollRunPage.tsx` | Split into `PayrollWorkspace` (mounted by both routes) and a thin `/payroll/:id` shell. Review trimmed to the decision it supports; Approve's vocabulary unified on *approve*; Finalise gained the register export and cost report. |
| `PayrollMonthHeader.tsx` | **New.** Month, status, headcount and the four figures. |
| `PayrollGrid.tsx` | **Rebuilt.** Journey-driven, grouped bands, one column definition that both the header and the totals row derive from, per-row status with a Fix, a column chooser, a condensed set at iPad portrait, and cards on a phone. No browser arithmetic. |
| `PayrollEmployeeDrawer.tsx` | **Rebuilt.** Four sections; earnings are the register's own columns with itemised provenance; inline add-earning/deduction editor. |
| `PayrollHistoryPage.tsx` | **New.** Secondary; month, status, headcount, gross, net, cost, approver. |
| `PayrollStepper.tsx` | A tick means the stage's work is finished, not that you scrolled past it. |
| `PayrollHomePage.tsx`, `PayrollReadinessPage.tsx` | **Deleted.** Their URLs redirect. |
| `AdminLayout.tsx`, `WorkAreaTabs.tsx` | Five HR sections; Medical Benefits under Employees. |
| `DetailDrawer.tsx`, `PayrollInputsDrawer.tsx` | antd 6 `width` deprecation removed. |

## Synthetic UAT world

`seed-admin-uat.ts`: 8 people → **11 employees + 1 contractor**. The locum is
now `engagement: CONTRACTOR`, which is what keeps a contractor out of payroll —
the field was never set, so the world had been asserting the opposite of the
rule the product enforces. New: a clinic manager with two days' unpaid leave and
a responsibility allowance, a staff nurse with a procedure incentive and rest-day
overtime, a pharmacy assistant with a payroll-routed claim reimbursement, and an
accounts assistant with commission and a bonus.

Two seed defects were found and fixed (see `PAYROLL_SIMPLE_UX_UAT.md`): payroll
line columns written from a hand-kept list of names rather than from the priced
components, and PCB_MISSING raised on "nobody typed one" rather than on "could
not be worked out".

## Guarantees added

- `apps/api/test/payroll-register-reconciliation.e2e-spec.ts` — six cases over
  HTTP: every row adds up left to right; the grouped columns equal their
  components; every total foots on its own column and on the run's stored
  figures; drawer and register are one row; an unknown scheme is counted, never
  summed as nil; approval moves no figure.
- `payrollGrid.test.tsx` — nine cases, including that the totals row stays
  aligned as optional columns are switched on, that the footer prints the
  server's total rather than a sum of the visible rows, that a blocker and its
  Fix are on the row, and that a phone gets cards.
- A seed invariant that fails when a priced component is missing from its
  column — verified to fire by reintroducing the old code.
