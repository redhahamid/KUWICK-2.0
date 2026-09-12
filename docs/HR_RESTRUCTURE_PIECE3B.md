# HR restructure — Piece 3b: Settings on Slate

The seven Settings screens on the kit and shell from 3a, plus the one screen
the mockups add — Statutory rates — reading the same tables the calculation
reads. No Prisma schema change, no migration, no new feature: every number on
these pages already existed in code or in a row; what is new is that a screen
can show it. `[D]` marks what was read in the code or the database, `[A]`
marks an assumption.

## 1. What moved, and what is new

| Screen | Route | State after 3b |
|---|---|---|
| Settings landing | `/admin/hr/settings` | 3a. The *Statutory rates checked* row now opens the new page and reads the clinic's check. |
| Statutory rates | `/admin/hr/settings/statutory` | **New page** on `settings-statutory.html`. No seventh card: reached from the checklist row and from Payroll policies, as decided. |
| Payroll items | `/admin/hr/settings/payroll-items` | Rebuilt: per-row switches, no drawer. |
| Payroll policies | `/admin/hr/settings/payroll` | Rebuilt: three approval choices as sentences, the pay bases, links to the other homes. |
| Company & statutory | `/admin/hr/settings/company` | Rebuilt on the kit; logic unchanged. |
| Attendance & leave policies | `/admin/hr/settings/attendance-leave` | `AttendanceRulesPanel` restyled once in place, not forked. |
| Public holidays | `/admin/hr/settings/public-holidays` | Rebuilt on the kit; logic unchanged. |
| Opening balances | `/admin/hr/settings/opening-balances` | Rebuilt on the kit; state and helpers unchanged. |

Kit additions in `apps/web/src/admin/hr/ui/`: `Table.tsx` (the HR fork of
`DataTable`, deferred from 3a) and, in `slate.css`, the table overrides and
the field, key/value, rate-grid, choice, notice, popover and breadcrumb
classes the mockups use. Everything stays under `.kw-hrSlate`; the isolation
guards from 3a still hold.

### API, all additive

| Change | File | Why |
|---|---|---|
| `GET /workforce/payroll/statutory-rates` | `statutory-settings.service.ts` (new), `workforce.controller.ts` | The EPF parts, SOCSO and EIS bands, PCB constants and HRD rates, with each schedule's registry stamp. Read-only by construction: the service has no setter. `hr.payroll.view`. |
| `POST /workforce/payroll/statutory-check` | same | Records that a named person at this clinic looked at the tables today. `hr.payroll.approve`. Audited as `statutory.checked`. |
| `updatedAt` on the approval policy | `payroll.service.ts`, `payroll-approval-rule.ts` | "Changed 10 Sep" on the Payroll policies card and page. `[D]` the row had it; the DTO did not. |
| `updatedAt` on the effective attendance policy | `attendance-policy.service.ts` | Same, for Attendance & leave. `[D]` taken from the clinic's own row when it has one, else the group default's. |
| `updatedAt` on each pay rule set | `payroll-policy.service.ts` | "Changed" on *How pay is worked out*. |
| `'statutory.checked'` | `finance/admin-audit.ts` | A new audit action, nothing else. |

## 2. Statutory rates

**Where the figures come from.** `[D]` `src/statutory/epf-third-schedule.ts`
(`EPF_PARTS`, parts A–F, RM5,000 step), `socso-act4.ts` and `eis-act800.ts`
(65 wage bands each, ceiling RM6,000, amounts in cents), `pcb-2026.ts` (the
non-resident flat rate) and `hrd-levy.ts` (1% mandatory, 0.5% optional). The
service reads the same constants the calculation reads and returns them; it
cannot return anything else. The in-force dates on the panels are the
registry's `effectiveFrom` for the schedule in force today, not typed.

**Checked is not verified.** The registry carries a verification state per
schedule — whether Kuwick's transcription was checked against the authority's
document — and `meetsApprovalBar` reads it. Nothing in 3b moves it. What the
clinic records is a separate fact, per the decision on this piece: *a named
person here looked at these tables on this date*. Both are returned and both
are shown; the head chip is the clinic's, the panel notes carry the
registry's own evidence line.

**Where the check is kept, without a schema change.** `[D]` `StatutoryRuleSet`
already has `verifiedAt`, `verifiedByStaffId`, `verificationStatus`,
`verificationNote` and `sourceUrl`. The clinic's check is one row per tenant
named *Clinic check of the statutory registry*, updated in place:
`verifiedAt` = now, `verifiedByStaffId` = the actor, `verificationNote` = a
hash of the registry's schedule ids and dates, `sourceUrl` =
`src/statutory/registry.ts`. The hash is what makes the chip honest: when a
schedule changes, the stored hash no longer matches and the page says
*Checked before the current edition*, the landing row drops back to *Needs
attention*, and *Mark as checked* is offered again. `[A]` Using this table for
a tenant fact is a reading of its purpose, not something its comments say;
the row's name and `sourceUrl` make it unmistakable in the data, and the
existing refusal of tenant edits to the rules themselves (`upsertStatutoryRules`
throws) is untouched.

**The panels.** EPF is a grid of employee group × employee % / employer % /
wage ceiling, built from the parts the schedule names for Malaysian under 60,
60 and over, and non-Malaysian. SOCSO & EIS shows the approximate percentages
the mockup shows and offers the actual band tables in a drawer — *View SOCSO
table*, *View EIS table* — because the exact ringgit amounts follow the band,
not a percentage, and the mockup says so. PCB lists where each input comes
from (the employee's Statutory tab, TP3 on joining, TP1 forms) and counts the
employees whose monthly tax questions are unanswered, from
`usePayrollReadiness` — the same readiness items the payroll gate reads —
with *Fix in Employees*. HRD shows each employer's registration and levy
class and the employer numbers, with *Missing* in gold and *Edit in
Company & statutory* as the only way to change them.

## 3. Payroll items

Every row is a pay component from `GET /workforce/pay-components`, with one
switch per treatment: EPF · SOCSO · EIS · PCB · HRD · Prorate · OT base ·
Unpaid-leave base, editable in the row without a drawer, and a ninth for
*In use*.

**A treatment change is a dated version.** `[D]` `PayComponentService.upsert`
refuses a change to any treatment field on an open version without an
`effectiveFrom`, closes the old version the day before, opens a new one, and
refuses a date any approved run already covers. So flipping a switch does not
save; it opens a popover asking for the month it takes effect (default: next
month) and a reason, and *Save* sends the whole row with the one flag changed
— the server resets unspecified flags to defaults, so the client never sends
a partial row. *In use* has no date: `[D]` the active flag is not a treatment
field.

**System items are on/off only.** `[D]` the server allows a `systemControlled`
row to change only `active`. Their treatment switches are drawn disabled with
the reason in the tooltip, and a lock beside the item's name carries the same
sentence on hover. Every seeded catalogue row is system-controlled, so in the
demo tenant every treatment switch is disabled; a clinic-defined component
gets live switches.

**Recurring and Reimbursement are derived chips, read-only**, as decided.
`[D]` *Reimbursement* is an addition that reaches net pay only
(`includeIn === 'NET_ONLY'`); *Recurring* is not a property of a component
at all — it is a fact about an employee's record — so no chip at component
level. The *Kind* column is drawn only when some row has a chip to show: the
seeded catalogue has none, and a column of dashes says nothing. (An earlier
draft also put a *Deduction* chip there; it repeated the *Adds or deducts*
column and is gone.)

**One verdict for the list.** The page head carries one chip — *Unchecked*,
*Checked*, or *n of m checked* — from the rows' `verificationStatus`, in the
place Statutory rates keeps its own. The per-row *Checked* column of the
first build was the same sentence seventeen times. The catalogue's own
verification notice — no treatment on the page has been checked against
KWSP, PERKESO, LHDN or HRD Corp — is one grey line under the table, in the
server's words, not a banner over it.

## 4. Payroll policies

Who may approve a run, as three sentences with a radio each (STANDARD ·
MAKER_CHECKER · DUAL_APPROVAL — the values are the existing API's), the
self-approval switch, and the existing *inert* lines shown as a notice when
the chosen rule cannot take effect. *Changed <date>* reads the new
`updatedAt`. *How pay is worked out* lists each rule set from
`GET /workforce/payroll-policies` with its proration, overtime and unpaid
leave bases and the employee count, and repeats that endpoint's own notice
that the bases are recorded but not yet applied. *Also decided in Settings*
points at Statutory rates (with the clinic's check chip), Attendance & leave,
Payroll items and Company & statutory — one home each, no second editor.

## 5. Attendance & leave, Company & statutory, Public holidays, Opening balances

`AttendanceRulesPanel` is restyled once, in place: Panel and PanelHead, the
*Rules for* selector as a field row, *In force: …* as a status chip, the two
rule notices as kit notices, the form on the three-column grid; the button is
still *Save attendance rules* and the form still posts what it posted.
`Company & statutory`, `Public holidays` and `Opening balances` are the same
screens on `HrPage`, `Panel`, `Table` and `Drawer`, with their state, calls
and validations unchanged — the employer editor still writes the bank account
write-only, the import still refuses months an approved run wrote.

## 6. Where the result differs from the mockup, and why

| Mockup | Result | Why |
|---|---|---|
| A single employer under HRD Corp levy and Employer numbers | One block per employer | `[D]` the demo tenant has two legal employers; the mockup assumes one. Nothing to choose between. |
| EPF *In force from 1 Jan 2026*, SOCSO *1 Oct 2024* | *1 Oct 2025* on both | `[D]` the registry's `effectiveFrom` for the schedules in force today. The page shows the registry, not the mockup's placeholder. |
| *1 employee currently on 9%* under EPF | Not shown | `[A]` no endpoint aggregates the EPF employee rate across employees; the fact is per employee on the Statutory tab. Reported, not invented. |
| *Registered with HRD Corp — No / Yes* toggle in the HRD panel | Read-only registration per employer, *Edit in Company & statutory* | One editor per fact, as decided in Piece 2. |
| *View table* once | *View SOCSO table* and *View EIS table* | Two schedules, two tables. |
| *← Settings* | *Settings* without the arrow | The copy rule from Piece 1: no arrows in labels. |
| *Checked 3 Sep 2026* only | *Checked 12 Sep 2026 · Dr Aisyah Rahman* | The decision on this piece: show who. |
| Sidebar without a branch selector | *All branches* selector at the top of the rail | Kept from 3a; accepted there. |
| Panel note under EPF is one line | Two: the mockup's line, then the registry's evidence line | Both facts on the page, as decided. |

`[D]` The Payroll items, Payroll policies, Attendance & leave, Company &
statutory, Public holidays and Opening balances screens have no Slate mockup
PNG in `docs/design/hr-slate/`; they are built on the kit and on
`settings-statutory.html`'s patterns, and shown as screenshots rather than
side by side.

## 7. What the mockups want that the API did not have

| Wanted | Found | Done |
|---|---|---|
| *Changed <date>* on Payroll policies, Attendance & leave, the pay rule sets | `[D]` `updatedAt` on the rows; the DTOs returned derived shapes without it | Added to the three DTOs. |
| The rates themselves | `[D]` in `src/statutory/*`, read by the calculation, never returned | New read-only endpoint. |
| Who checked and when | `[D]` no tenant-level fact existed; `StatutoryRuleSet` has the columns | New endpoint on the existing table; no schema change. |
| *1 employee on 9%* | Not in any endpoint; per-employee only | Not built. Reported above. |
| A count of employees with unanswered tax questions | `[D]` derivable from `usePayrollReadiness` items | Derived on the page; no endpoint. |

## 8. What the browser gate caught

Two things the screenshots showed that nothing else did, and two the full
Playwright run added.

**The search glyph.** The kit's icons are unsized SVGs that take their size
from the container's rule, and `.hr-search` had none — so the first
screenshot of Payroll items and Public holidays had a 300×150 black disc for
a magnifying glass. One rule, `.hr-search svg`, and the box is the mockup's
280px field.

**The breadcrumb.** The first build drew *Settings / Payroll items* under
the title; the mockup's `<main>` draws it above. `HrPage` gained a `crumb`
prop that renders before the head, and the seven pages moved their
breadcrumb into it.

**The frame the walk waits for.** `gotoAdmin` in `e2e/support/admin.ts`
waited for `.kw-admin`, the wrapper `AdminShell` draws, and a page rebuilt
on `HrPage` draws none — so the route walk over the five modules, the
three sideways-scroll walks and the two attendance-rules tests all timed
out on Payroll items and Attendance & leave, screens the failure
screenshots show fully rendered. 3a never met this: the Settings landing
is not on the walk's route list, and `hr-navigation.spec.ts` waits for the
rail. The helper now accepts `.kw-admin` or `.hr-pageHead` — the same
promise, a titled page rather than a spinner — and the spec files are
untouched. `.hr-table` also gained `overflow-x: auto`, so the twelve
columns of Payroll items scroll inside their panel at iPad widths; the
three sideways-scroll walks are green with the table in place.

**A seed that is a day old.** `[D]` The demo tenant's open trading day and
today's clock-ins are dated when `seed-admin-uat.ts` runs. This run began
after midnight UTC, so *Day-end closing* found no takings and the Today
page found nobody on duty — both tests say to re-run the seed, and both
passed once it was, with nothing in this piece changed. The seed's reset
needs the database owner (`ADMIN_UAT_RESET_URL`), which the container has.

## 9. Gates

| Gate | Command | Result |
|---|---|---|
| API unit | `npm run test:api` | 127 suites, 2727 tests, green |
| API e2e | `cd apps/api && npx jest --config test/jest-e2e.json --runInBand` | 40 suites: 39 green on the full run; `payroll-synthetic-month` failed in its `beforeAll` and passed 14/14 on its own — see below |
| Web unit | `cd apps/web && npx vitest run` | 99 files, 1714 tests, green — including the 3a isolation guards and the card-label-equals-title guard, both re-pointed at `HrPage` |
| Browser | `CHROME_PATH=/opt/pw-browsers/chromium npx playwright test` | 101 tests: 98 green, 2 skipped, 1 failed — `canvas-appointment.spec.ts:40`, the follow-up booked from the consultation not appearing in the Appointments module, which fails identically on master and was recorded as pre-existing in Piece 1. Run twice: the first run's nine failures are §8; the second, after the helper fix and a re-seed, is this row |

**The one red suite, and why it is not this piece's.** `[D]` The full API
e2e run failed `payroll-synthetic-month.e2e-spec.ts` in `beforeAll`: the
sixth `POST /workforce/employees/:staffId` returned 500 on
`employee_profiles_tenant_id_employee_no_key` — a duplicate employee number
inside the run's own fresh tenant. The spec draws every employee number as
`S-<Math.random() × 1,000,000>`; the endpoint stores what it is sent; the
index is `(tenant_id, employee_no)`. None of the three is in this piece's
diff, no migration ran, and the suite passed 14 of 14 when re-run alone
immediately afterwards. What is not established is how five numbers in a
million-wide space met a sixth by chance — the odds are long enough that
the mechanism deserves a look rather than a shrug. Proposed, not done here:
give the spec a per-run counter for the employee number instead of
`Math.random`, which removes the possibility whatever the cause. Done on
acceptance: `makeEmployee` now numbers its employees from a per-run counter,
and the suite is green with it.

**After the acceptance corrections** (one chip for the list, the lock, the
Kind column, the spec's counter): API unit unchanged; API e2e 40 suites, 455
tests, green on one run with the counter in place; web unit 99 files, 1714
tests, green; the admin-shell walk, the HR navigation spec and the HR
workforce spec, 25 tests, green.

## 10. Not in this piece

Every other HR screen (3c onward). The overtime and public-holiday pricing
modes on Payroll policies (§6 of the prompt, 3d). The leave policy screen
(separate work). The Opening balances number fields still use the old
`kw-fieldLabel` label class — cosmetic, and the page reads correctly on the
kit; it is noted rather than restyled so the import form's markup stays the
one its tests know.
