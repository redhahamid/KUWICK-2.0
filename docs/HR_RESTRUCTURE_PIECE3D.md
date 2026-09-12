# HR restructure — Piece 3d: Payroll on Slate

The month, the person's month and the payslip on the kit and shell from 3a,
after `payroll.html`, `employee-payroll.html` and `payslip.html`, plus the
one schema change the prompt's §6 permits: how a rule set prices overtime,
rest days and public holidays. `[D]` marks what was read in the code or the
database, `[A]` marks an assumption.

## 1. What moved, and what is new

| Screen | Route | State after 3d |
|---|---|---|
| Payroll month | `/admin/hr/payroll?period=YYYY-MM` | Rebuilt on `payroll.html`: month ‹ › on a segmented control, four figures, the four stages Prepare · Review · Approve · Pay, the grid, a footer that names who is blocked. |
| Payroll run | `/admin/hr/payroll/:id` | The same workspace, by run id. History and Export CSV as page actions. |
| Employee payroll | `/admin/hr/payroll/:runId/employees/:staffId` | New page on `employee-payroll.html`, replacing the drawer: earnings and deductions with their sources, the net against last month, employer contributions, what fed the month, year to date, adjust. |
| Payslip PDF | `GET /workforce/payroll/runs/:id/payslips/:staffId/pdf` | Redrawn on `payslip.html`. Same route, same approved snapshot, same hash line. |
| Settings › Payroll policies | `/admin/hr/settings/payroll` | Rule sets gain a mode — statutory or clinic rate — a group they apply to, and the four clinic amounts; a gold notice names anybody a clinic rate would underpay. |

Deleted: `PayrollMonthHeader.tsx`, `PayrollEmployeeDrawer.tsx`.

### The one migration

`20260912090000_payroll_policy_overtime_mode` — the §6 change and nothing
else. `payroll_policies` gains `overtime_mode` (enum `STATUTORY` |
`CLINIC_RATE`, default `STATUTORY`), four nullable `DECIMAL(12,2)` amounts
(`clinic_overtime_hourly`, `clinic_public_holiday_shift`,
`clinic_rest_day_shift`, `clinic_session_rate`) and a nullable
`workforce_category`, with two partial unique indexes so one group has at most
one rule set per employer and one tenant-wide. No backfill: every existing
policy is statutory with no amounts, which is what every run has computed so
far. Applied to `kuwick_dev` and, by the e2e global setup, to `kuwick_test`.
Staging was not touched (the 28P01 issue stands). `EmployeeRecurringItem`'s
migration was not touched.

### API

| Change | File | Why |
|---|---|---|
| Rule set modes, amounts, group; the floor assessment; `categories` | `payroll-policy.service.ts`, `dto/upsert-payroll-policy.dto.ts` | §2. `list()` returns per rule set `overtimeMode`, `clinicRates`, `workforceCategory`, `appliesTo`, `employeeCount`, `employeeNames` and `floor {assessed, below[]}`; `upsert()` refuses a clinic-rate rule set with no amount, an amount of zero or less, and a second rule set for the same group (409). |
| Which rule set an employee is on | `payroll-policy-resolution.ts` (new) | Assigned → group (employer-scoped, then tenant-wide) → default → none. `[D]` `employee_profiles.payroll_policy_id` was already in the schema; the group is `workforceCategoryOf(staff)`, derived from the role and never stored. |
| Clinic pricing held to the Act | `overtime-pricing.ts` | §2 and §3. A day is priced by the Act, then by the clinic rate when the rule set has one for that kind of day; within the First Schedule the higher figure is paid and a shortfall is reported. |
| `CLINIC_RATE_BELOW_STATUTORY` | `payroll-exception.ts` | BLOCKING, not overridable, deep link to Settings › Payroll. |
| Recurring items reach the run | `payroll-materialisation.ts`, `payroll.service.ts` | §3. `[D]` `PayrollInputSource.RECURRING` and `PayrollInputKind.RECURRING` existed with nothing writing them. |
| The rule set and the priced days in the breakdown | `payroll.service.ts` | `breakdown.overtimePolicy {ruleSet, how, mode, clinicRates}`; each priced day carries `dayType`, `hourlyRate`, `dayPay`, `pricedBy`. The employee page and the payslip read them. |
| Journey rows carry `claims`, `otherIncome`, `overtimeHours`, `unpaidDays` | `payroll-journey.service.ts` | The grid's columns. Summed on the server; the grid never computes money. |
| Payslip composition: identifier, prepared by, approved by, paid date, net in words, HRD levy | `payroll-payslip.service.ts`, `finance/money-words.ts` (new) | §6. |
| Payslip layout | `payroll-payslip-pdf.ts` | §6. |
| Demo world | `prisma/seed-admin-uat.ts` | A *Doctors* rule set (clinic rate, RM500 a public-holiday shift, the placeholder the owner will replace) and three recurring items on Dr Meera Kaur: housing RM800 from April 2025, phone RM100 from January 2026, a salary advance recovered at RM200 over four months from September 2026. |

## 2. Rule sets: statutory or clinic rate

A rule set now says how it prices the days beyond the normal ones.

**Mode A, statutory.** The Employment Act's arithmetic, exactly as every run
has done so far: a day is the monthly wage over 26, an hour is a day over the
normal hours (rounded to the sen), 1.5× on a working day, s.60(3) for a rest
day, two days' wages for a public holiday under s.60D(3). `[D]` This is the
existing `priceOvertime`, untouched in what it computes.

**Mode B, clinic rate.** Four amounts, set here and never typed into the
grid: RM per hour of approved overtime, RM per public-holiday shift, RM per
rest-day shift, RM per session — a rest day or holiday worked for at most
half the normal hours. `[A]` The session definition: the prompt names a
session rate without saying what a session is; half the normal hours is the
reading that lets a morning clinic on a Sunday be priced as one session and a
full Sunday as a shift. A kind of day with no amount falls back to the Act's
formula for that day, so a rule set that only prices public-holiday shifts
(the doctors' case) still prices an ordinary extra hour lawfully.

**Who is on which.** An employee assigned a rule set on their record is on
that one. Otherwise the rule set naming their group — doctors, clinical
staff, admin, management, other — applies, the employer-scoped one before the
tenant-wide one; otherwise the default; otherwise the Act. `[D]` Dr Aisyah
Rahman is `OWNER_ADMIN`, which `workforceCategoryOf` reads as *management*,
so she is on the standard rule set, not *Doctors*, unless assigned by hand on
her record. Reported rather than special-cased.

**The floor is not configurable.** For wages of RM4,000 a month or less the
First Schedule applies, and s.60I(2) makes the Act's rates a minimum under
any clinic rate. Two places say so:

- *Settings*, in gold: the list assesses every employee within the threshold
  on each clinic-rate rule set against their own wage and names the shortfall
  in the Act's words — *An hour of overtime: RM20.00 against the Act's
  RM23.07.* The editor states the Act's figures for a RM4,000 wage beside the
  four inputs.
- *Payroll*, as a block: when the month's actual days come out cheaper at
  the clinic rate than at the Act's, the employee is paid the Act's figure and
  `CLINIC_RATE_BELOW_STATUTORY` blocks approval until the rate is raised or
  the employee moved to a statutory rule set. Not overridable: an override
  would be an agreement to pay below the Act.

Above the threshold the clinic rate is the contract price and the scope is
contractual, as before. `[D]` An explicit *not paid* classification still
wins over any rule set.

## 3. The engine

**Recurring items.** An item in force in the month — `effectiveFrom` on or
before the last day, `effectiveTo` null or on or after the first — becomes a
`payroll_input_entries` row with source `RECURRING`, kind `RECURRING`, the
item's id as `sourceRecordId`, the item's component and label, and a
provenance sentence (*Recurring allowance (housing) of 800.00 a month from 1
Apr 2025, on the employee record, recorded by …*). `[A]` A month is never
prorated: an item that starts on the 20th pays the full month, because the
record says "a month" and the prompt's proration bases are the ones the
Settings notice says are recorded but not yet applied. Ending the item
removes the row at the next calculation; the same idempotent materialisation
the attendance and leave rows use.

**Days, not hours, are priced.** Each approved overtime record is a day of a
kind — a working day, a rest day, a public holiday — and is priced as that
kind under the employee's rule set. The payslip line reads *Overtime, 6.5 h
at RM14.87* or *Public holiday, 31 Aug 2026*, grouped by kind.

**Worked cases**, printed by `payroll-worked-cases.spec.ts` for August 2026
(31 days, one public holiday, 8 normal hours):

| Wage | Case | Gross | EPF ee / er | SOCSO ee / er | EIS ee / er | PCB | Net |
|---|---|---|---|---|---|---|---|
| 2,900 | basic only | 2,900.00 | 319.00 / 377.00 | 14.25 / 49.85 | 5.70 / 5.70 | 0.00 | 2,561.05 |
| 2,900 | mode A: 6.5 h at 1.5× (RM14.87/h) + one public holiday | 3,268.06 | 319.00 / 377.00 | 16.25 / 56.85 | 6.50 / 6.50 | 0.00 | 2,926.31 |
| 2,900 | mode B: front desk, RM20/h and RM250 a holiday shift | +394.98, 2 days below the Act → blocked | | | | | |
| 2,900 | one day unpaid (RM93.55 = 2,900 ÷ 31) | 2,806.45 | 311.00 / 367.00 | 14.25 / 49.85 | 5.70 / 5.70 | 0.00 | 2,475.50 |
| 2,900 | + mileage claim RM42.00, not taxed | 2,942.00 | 319.00 / 377.00 | 14.25 / 49.85 | 5.70 / 5.70 | 0.00 | 2,603.05 |
| 5,600 | basic only | 5,600.00 | 616.00 / 672.00 | 27.75 / 97.15 | 11.10 / 11.10 | 0.00 | 4,945.15 |
| 5,600 | mode A: 6.5 h at 1.5× (RM28.72/h) + one public holiday | 6,310.78 | 616.00 / 672.00 | 29.75 / 104.15 | 11.90 / 11.90 | 0.00 | 5,653.13 |
| 5,600 | mode B: doctors, RM500 a holiday shift | +500.00, contractual | | | | | |
| 5,600 | one day unpaid (RM180.65) | 5,419.35 | 605.00 / 660.00 | 27.25 / 95.35 | 10.90 / 10.90 | 0.00 | 4,776.20 |
| 5,600 | + mileage claim RM42.00 | 5,642.00 | 616.00 / 672.00 | 27.75 / 97.15 | 11.10 / 11.10 | 0.00 | 4,987.15 |
| 9,500 | basic only | 9,500.00 | 1,045.00 / 1,140.00 | 29.75 / 104.15 | 11.90 / 11.90 | 37.00 | 8,376.35 |
| 9,500 | mode A: 6.5 h at 1.5× (RM48.72/h) + one public holiday | 10,705.78 | 1,045.00 / 1,140.00 | 29.75 / 104.15 | 11.90 / 11.90 | 186.35 | 9,432.78 |
| 9,500 | mode B: doctors, RM500 a holiday shift | +500.00, contractual | | | | | |
| 9,500 | one day unpaid (RM306.45 = 9,500 ÷ 31) | 9,193.55 | 1,012.00 / 1,104.00 | 29.75 / 104.15 | 11.90 / 11.90 | 27.80 | 8,112.10 |
| 9,500 | + mileage claim RM42.00 | 9,542.00 | 1,045.00 / 1,140.00 | 29.75 / 104.15 | 11.90 / 11.90 | 37.00 | 8,418.35 |

`[D]` Unpaid leave is s.18A — the monthly wage over the days in the month,
not over 26 — so one day at RM9,500 is RM306.45, where `employee-payroll.html`
shows RM365.38 (9,500 ÷ 26). The code's figure is the one shown; see §9.
`[D]` A public holiday under mode A is two days at the daily rate as already
rounded to the sen (2 × 111.54 = 223.08), not 2 × 2,900 ÷ 26 rounded once.

## 4. The month

**Four figures.** Gross, statutory (employee deductions), net, and who is
ready — with the headcount, the blocked and the number to check. Server sums.

**The stages** are Prepare · Review · Approve · Pay on the kit's steps; the
keys and the guards behind them are the existing ones (`prepare / review /
approve / complete`), and a blocking exception pins the stage it belongs to.
`[D]` The four new exception codes from §2 and the earlier statutory ones map
to Prepare, because they are fixed on the record or in Settings, not in
review.

**The grid** is the mockup's fourteen columns in three groups — Basic ·
Other income · OT h · Unpaid d · Claims · Gross | EPF · SOCSO · EIS · PCB ·
Other deductions | Net — with three kinds of cell:

- grey, *from the record*: Basic, OT h, Unpaid d, each with a *Fix* link to
  Attendance or Leave when the month has a problem there. Accepted deviation
  from the mockup, which draws OT h and Unpaid d white: overtime is only what
  Attendance approved and the user does not compute.
- white, *editable*: Other income and Other deductions. A typed figure is
  the total the cell should show; the difference from the fixed part (the
  recurring items, claims apart) is written as one hand-keyed input —
  `ALLOWANCE` for income, `OTHER_DEDUCTION` for a deduction — labelled from
  the grid, and a figure below the fixed part is refused, because the
  recurring part is on the record and the grid is not where it is changed.
  One row is edited at a time; *Save draft* writes the input and works the
  month out again so the row's statutory figures follow.
- auto: Claims, Gross, the four statutory figures, Net.

Each row carries its status chip (Ready · Blocked · Check) and the name links
to the person's month. Search and All · Blocked · Check filter the rows; the
legend explains the three cell kinds. Below the grid, a note names the
timesheet the month read, and the footer names who is blocked and holds
*Continue to review* until nobody is.

**Review** keeps the exception centre — blockers, warnings, overrides with
reasons — and the month's totals; **Approve** keeps the statement, the
checks and the one button with its lock reason, verbatim; **Pay** is the old
Finalise: payslips, the payment listing, the statutory outputs and the report
links.

**Not started** is the month before anybody has run it: dashes in the four
figures, the start gate naming who is missing what, and the start button.

## 5. The person's month

`/admin/hr/payroll/:runId/employees/:staffId`, from the grid or from ‹ prev ·
n of m · next › at the top of the page.

**Head.** Name, the facts line (position, employer, bank), a *Payslip PDF*
button enabled once the run is locked, and *Mark as checked*, which records
that this person's unchecked warnings were looked at: an override of each
with one reason, logged with the user's name — the existing mechanism, per
the owner's answer. A chip *Checked by …* shows once done; nothing in the
figures changes.

**Earnings and deductions.** Each line names its source — attendance,
leave, claim, incentive, recurring, or typed — and the overtime lines are
grouped by kind of day with the hours and the rate. Unpaid leave is shown as a
negative earning with the note that wages are smaller, not deducted twice.
Deductions carry the formula the breakdown recorded (the EPF part, the
SOCSO band, the PCB source). The totals are the line's `grossPay` and
`deductionTotal`; the net box shows the change against the previous month's
approved figure, and the employer strip EPF · SOCSO · EIS · HRD.

**The right column.** *What fed this month*: days worked, approved
overtime, leave, claims, the rule set and how it was resolved, with a warning
when overtime is still pending in Attendance. *Year to date* from
`GET /workforce/payroll/employees/:staffId/ytd`. *Adjust this month*: a
one-off item opens the inputs drawer; *Override PCB* asks for a reason and
writes a hand-keyed PCB input for this month only.

## 6. The payslip

The PDF is composed from the approved snapshot, as before, and drawn after
`payslip.html`: the employer block with an initials mark, *Payslip* with the
period and a *Paid <date>* or *Approved <date>* tag; eight facts (employee no,
NRIC or passport, position, department, bank, EPF, SOCSO, tax no); earnings
and deductions side by side, overtime grouped by kind of day, unpaid leave in
red with its days, the statutory lines labelled EPF · SOCSO · EIS · PCB / MTD
· LINDUNG 24 JAM, and *Not calculated* in amber where a figure is provisional;
the employer's contributions as a strip; the net in a box with the amount in
words and *Paid to <bank> on <date>*; *Prepared by* and *Approved by* with
the name typed in italic, the position and the date; the footer *Private and
confidential* / *Generated by Kuwick · Run #YYYY-MM*, and under it the trace
line — revision, hash prefix, verdict — that the audit relies on.

`[D]` The identifier is on the profile (`identifierType`, `identifierValue`)
and was write-only on every admin DTO; it is read into the payslip only,
which is the employee's own document. `[D]` Prepared by is the run's creator
at the time it was last calculated, Approved by its approver, each with the
position from their employee profile; a run approved before the approver
column was kept falls back to the last approval in the payload. `[D]`
`hrdLevy` was on the line; it is now on the strip. The amount in words is
`ringgitInWords` in `finance/money-words.ts`.

No year-to-date block: the mockup has none, and the figures are on the
person's month.

## 7. Kit additions

`slate.css` gains the grid block (`.hr-grid` with `is-record / is-editable /
is-auto` cells, `.hr-grid__grp`, `.hr-inp`, `tr.is-editing`, `.hr-legend`,
`.hr-fixLink`, `.hr-panel__foot`, `.hr-scrollX`), the person's-month block
(`.hr-two`, `.hr-slip`, `.hr-li*`, `.hr-src`, `.hr-tot`, `.hr-netBox*`,
`.hr-emp*`, `.hr-warn`, `.hr-adjust`, `.hr-crumb__back`), the form choices
box for the rule set editor (`.hr-form__choices`, `.hr-choice`), and small
rules: `.hr-eff` and segmented buttons no longer wrap, `a.hr-who` is a link,
`.hr-btn:disabled` is drawn disabled. `tokens.ts` and `index.css` untouched;
`admin-shell.spec.ts` unchanged.

## 8. Tests

| Where | What |
|---|---|
| `overtime-pricing.spec.ts` | Mode B: clinic rates per kind of day, fallback to the Act, the floor within the First Schedule, contractual above it. |
| `payroll-policy-resolution.spec.ts` (new) | Assigned → group (employer before tenant) → default → none. |
| `payroll-materialisation.spec.ts` | Recurring items materialise and disappear; a changed label updates the row. |
| `payroll-worked-cases.spec.ts` (new) | The table in §3, asserted to the sen. |
| `money-words.spec.ts` (new) | Ringgit and sen in words. |
| `payroll-exception.spec.ts` | The new deep link is a mounted route. |
| `test/payroll-rule-sets.e2e-spec.ts` (new, 7) | A clerk at RM3,000 on a front-desk rule set priced below the Act: the 400 and 409 refusals, the gold sentence in Settings, the block with its cause, the Act's figures on the inputs, the recurring housing row, a doctor's RM500 shift with `overtimePolicy` naming the rule set, the block clearing when the rate is raised, the ended item disappearing. |
| `payrollGrid.test.tsx` | Rewritten for the new grid: column order and kinds, grouped figures, statuses and Fix links, left-out rows, the name link, edit inputs, phone cards, `planGridEdit`. |
| `payrollJourney.test.tsx` | Repointed at the new page and columns: the guards that the grid never computes money still read the source. |
| `e2e/admin-hr.spec.ts` | Selectors follow the kit (`.hr-stats`, `.hr-chip`, `.hr-step`). |

## 9. Where the result differs from the mockup, and why

| Mockup | Result | Why |
|---|---|---|
| OT h and Unpaid d white | Grey, from the record, with *Fix* | Overtime is what Attendance approved; the user does not compute. Accepted by the owner. |
| Every cell typed freely | One row in edit at a time; *Save draft* writes the input and recalculates | `[D]` A figure is an input row with a provenance; the month must be worked out again for the statutory columns to follow. |
| Unpaid leave RM365.38 on RM9,500 | RM306.45 | `[D]` s.18A: the wage over the days in the month, not over 26. |
| *Add note for payslip* | Not drawn | `[D]` No field for a payslip note on the line or the run. Needs schema; not asked. |
| Signature images | Typed name in italic, position, date | `[D]` No signature image in the schema. Owner's answer: later. |
| Bank account ending in digits | Bank name only | `[D]` The account number is write-only on every DTO and the last four are not kept separately. |
| No trace line on the payslip | Kept | The revision, hash and verdict line is what the audit reads. |
| YTD *Net paid* | Not shown | `[D]` The year-to-date endpoint returns gross and the deductions, not the net paid. |
| The doctors on *Doctors* | Dr Meera Kaur alone | `[D]` Dr Aisyah Rahman is `OWNER_ADMIN`, read as management, so she is on the standard rule set unless assigned by hand on her record; Dr Faiz Ismail is the locum contractor and not on payroll. |
| The seeded August in the screenshots | Engine figures after one recalculation | `[D]` `seed-admin-uat.ts` hand-builds the August lines (gross 57,198.34); the first recalculation replaces them with the engine's (gross 48,530.00). The pack was shot after recalculation, and the world re-seeded after. Reconciling the seed with the engine is 3g. |
| Inter / Inter Tight | Chromium's fallback sans; Helvetica in the PDF | The container's proxy does not serve the faces; pdfkit ships Helvetica. |

## 10. What the mockups want that the API did not have

| Wanted | Found | Done |
|---|---|---|
| Statutory or clinic rates per group | `[D]` Proration bases only | §6 migration, DTO, service, engine, Settings. |
| The floor under a clinic rate | Not on the API | Settings assessment and the blocking exception. |
| Recurring items in the month | `[D]` Model, service and screen from 3c; nothing in the run | Materialised. |
| Other income, OT hours, unpaid days, claims per row | `[D]` Gross, salary earned, overtime, deductions | Summed on the server. |
| The rule set and rate on each priced day | `[D]` Multiplier and amount | `overtimePolicy` and `pricedBy`, `hourlyRate`, `dayPay`, `dayType`. |
| NRIC, prepared by, approved by, paid date, net in words, HRD levy on the payslip | `[D]` On the profile, the run, the line — not in the payslip document | Composed. |
| Year to date on the person's month | `[D]` Endpoint existed; no hook | `useEmployeeYtd`. |

## 11. Gates

| Gate | Command | Result |
|---|---|---|
| API unit | `npm run test:api` | 130 suites, 2,764 tests, green |
| API e2e | `cd apps/api && npx jest --config test/jest-e2e.json` | 41 suites, 462 tests, green. One wording fix on the way: `payroll-stage2` reads the Settings notice for *NOT yet applied*, which the rewritten notice had lower-cased; restored, suite re-run green |
| Web unit | `cd apps/web && npx vitest run` | 99 files, 1,718 tests, green. Run alongside the API unit gate it timed out once in a clinical modal test that passes alone and in the clean run |
| Browser | `CHROME_PATH=/opt/pw-browsers/chromium npx playwright test` | 101 tests: 98 green, 2 skipped (the two scaffolds), 1 failed — `canvas-appointment.spec.ts:40`, pre-existing since Piece 1 and identical on master. *Day-end closing* ran this time because the world had just been re-seeded |

## 12. Not in this piece

The portal, clock in, the UAT seed reconciled with the engine and the UAT
checklist (3g). Attendance, Leave and Claims on the kit (3e). Reports (3f).
A payslip note, a signature image and the account's last four digits — each
a schema change, none asked. Proration of a recurring item that starts
mid-month, and the proration bases themselves, which stay recorded and not
applied.
