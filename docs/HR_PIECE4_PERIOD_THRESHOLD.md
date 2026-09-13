# Piece 4 — Periodic hours threshold, a third overtime mode

**Status: specified, not started. Do not build until the owner says UAT is
finished.** Raised 13 Sep 2026 during the owner's HR UAT; every decision below
is the owner's own answer to a question this document originally left open, and
is marked as such.

`[D]` marks what was read in the code. `[O]` marks an owner decision. `[A]`
marks an assumption still to be confirmed.

## 1. Why

Some clinics do not price overtime by the day at all. They set a **ceiling of
hours for a period** and pay every hour beyond it at one flat rate, with no
1.5× / 2.0× / 3.0× multipliers and no distinction between an ordinary day, a
rest day and a public holiday.

The clinic that raised this is one configuration among many:

- 45 hours a week, over 6 working days and one day off
- hours beyond the ceiling paid at RM50 an hour
- a public holiday worked: all of that day's hours become excess, **and** the
  week's ceiling drops by 45 ÷ 6 = 7.5 hours for each such day (one public
  holiday in the week → ceiling 37.5)
- the doctors on this rule have no overtime at all; other staff stay on the
  Employment Act

**Nothing in that paragraph is a constant.** 45, 6, 7.5 and RM50 are all
settings. 7.5 is never stored — it is `thresholdHours ÷ thresholdWorkingDays`,
so a clinic on 40 over 5 gets 8. The next clinic will be monthly, or 48 over 6,
or pay RM35.

## 2. What exists today

`[D]` The engine cannot do this, and not because a wire is missing — there is
no concept of a period anywhere in it.

`priceOvertime` in `apps/api/src/workforce/overtime-pricing.ts` is a pure map
over days:

```ts
const priced = days.map((day) => priceDay(day, classify(day.date), context))
```

No cross-day state at all. `[D]` The only weekly concept in the whole workforce
module is `restDayOfWeek` — which day of the week is the rest day.

What is already there and reusable:

| Fact | Where |
|---|---|
| Hours worked each day (`workedMinutes`) | Computed from the punches, no roster needed |
| Normal hours a day, configurable | `PayrollPolicy.overtimeHoursPerDay` (7.5) |
| Working days a month, configurable | `PayrollPolicy.overtimeDays` (26) |
| Day classification: normal / rest / public holiday | `classifyDay` |
| Divisors frozen on every run | `orpOvertimeDays`, `orpHoursPerDay` on `PayrollRun` |
| Two modes on one enum | `OvertimeMode { STATUTORY, CLINIC_RATE }` |

## 3. Prerequisite — do the punch fix first

`[D]` A periodic threshold sums `workedMinutes` across a period, and
`workedMinutes` is currently wrong for anybody who punches a break: a day keeps
one clock-in and one clock-out, so four punches read as first-to-last and the
unpaid gap counts as worked. See the separate task *Store every punch of a day
and pay the sum of the pairs*.

Building this mode on today's `workedMinutes` would produce a ceiling measured
against inflated hours. **Sequence the punch fix ahead of this piece.**

## 4. The owner's decisions

### (a) Week boundaries against the payroll month `[O]`

**A week belongs to the month containing its LAST day.** A week running Mon 29
Sep – Sun 5 Oct is priced in the **October** run.

The owner's reasoning, recorded because it constrains the implementation: a 45
hour ceiling only means anything if a whole week is counted, and clipping at the
month boundary both loses the excess and cannot be explained to a doctor.

Consequences to build:

1. The October run must read attendance from **29 September**, outside its own
   `workDate >= period AND < periodEnd` window. `[D]` Today that window is the
   calendar month (`periodEnd = monthEnd(period)`).
2. The September run must **not** price those days.
3. **A guard so one day can never be paid by two runs** `[O]` — an explicit
   requirement, not a nicety. `[D]` The existing unique index
   `payroll_input_entries_source_record_key` is
   `(tenant, staff, period, component_code, source_record_id)`, which stops a
   week being materialised twice *inside one period* and does nothing across
   periods. A week key must be unique per `(tenant, staff, component_code)`
   **regardless of period** — a second partial unique index, plus a materialisation-
   time check that names the run already carrying that week rather than failing
   on a constraint violation nobody can read.

`[A]` Which day starts the week is a setting (`thresholdWeekStartsOn`), default
Monday, to be confirmed with the owner.

### (b) Rest days become ordinary hours `[O]`

Accepted: under this mode a rest day is simply hours in the bucket. No s.60(3)
day-rate pricing, no 2.0×.

Note this is a genuine behaviour change from **both** existing modes, not an
addition. `classifyDay` still matters, but only for the public-holiday options
below.

### (c) The two public-holiday options are independent `[O]`

Two separate settings, either, both or neither:

| Setting | Effect |
|---|---|
| `thresholdHolidayAllHoursExcess` | Every hour worked on a public holiday is excess, paid at the flat rate |
| `thresholdHolidayReducesCeiling` | The period's ceiling drops by `thresholdHours ÷ thresholdWorkingDays` for each public holiday worked |

`[O]` **When both are on, the public holiday's hours must not also consume the
ceiling** — otherwise they are counted twice. The clinic that raised this runs
both on.

### (d) The Employment Act floor: refuse `[O]`

**The threshold mode may not be applied to an employee on RM4,000 a month or
less.** A new blocking exception with a message that says exactly that.

`[O]` Explicitly **not** the approach `CLINIC_RATE` takes (price both ways, pay
the higher, block if the clinic rate was lower). The owner's reasoning: pricing
twice and silently taking the higher hides a misconfiguration instead of
reporting it.

`[D]` The rule the refusal enforces: `overtimeScope` in
`apps/api/src/statutory/employment-act.ts` returns `withinFirstSchedule: true`
for `monthlyWagesCents <= FIRST_SCHEDULE_WAGE_CEILING_CENTS`, and s.60I(2)
makes the Act's figures a floor for those employees. A threshold mode pays
nothing for hours under the ceiling, which on a rest day is below the Act.

## 5. Schema

| Change | Detail |
|---|---|
| `OvertimeMode` | Add `PERIOD_THRESHOLD` |
| `PayrollPolicy` | `thresholdPeriod` (WEEKLY/MONTHLY) · `thresholdHours` · `thresholdWorkingDays` · `thresholdExcessHourly` · `thresholdWeekStartsOn` · `thresholdHolidayAllHoursExcess` · `thresholdHolidayReducesCeiling` |
| `PayrollRun` | Freeze the threshold **as applied**, alongside `orpOvertimeDays` / `orpHoursPerDay` |
| Pay component catalogue | One new row for the payslip line — see §8 |

**On freezing.** `[D]` Clinic rates are *not* frozen on a run today; they are
re-read on every calculation. Period-level arithmetic is far harder to
reconstruct after the fact than a per-day multiplier, so the threshold, the
working days and the flat rate must be stored on the run the way the divisors
already are.

One migration. No new tables, so no new RLS policies — but follow the runbook
and re-provision the app role anyway.

## 6. Engine

A new layer above `priceDay`: bucket the days into periods, sum the hours,
compute the ceiling, take the excess, price it at the flat rate.

```
ceiling = thresholdHours
        − (thresholdHours ÷ thresholdWorkingDays) × publicHolidaysWorked   [if (c) option 2 on]

consumed = Σ workedHours of days that are NOT public holidays               [if (c) option 1 on]
         = Σ workedHours of every day                                       [otherwise]

excess   = max(0, consumed − ceiling)
         + Σ workedHours of public holidays worked                          [if (c) option 1 on]

pay      = excess × thresholdExcessHourly
```

Things that are not arithmetic:

- **Approval.** `[D]` Both existing modes pay only hours whose day carries
  `overtimeApproved`. Decide whether a periodic excess needs approval at all,
  and if so what is approved — a day, or the period. The manager's *Pending ·
  approve* button is per day, which does not obviously map onto a weekly excess.
  **This is the one design question §4 did not settle.** Put it to the owner
  before writing the engine.
- **Materialisation.** `[D]` `materialiseOvertimeDays` produces one
  `PayrollInputEntry` per attendance row, keyed on that row's id. A periodic
  excess belongs to no single day. A new materialiser with a synthetic source
  key per bucket (the period's start date is the obvious one), satisfying
  `payroll_input_entries_derived_has_source`, plus the cross-period guard from
  §4(a).
- **Exceptions.** One INFO row per period naming the ceiling applied, the hours
  worked, the public holidays counted and the hours over — so the Review stage
  can show the arithmetic. Plus the blocking one from §4(d).

## 7. Screens

### Attendance — a weekly rollup, and somewhere to see it

`[D]` `TimesheetTotals` is a **month** total; the Monthly summary's **Worked**
column is hours for the month. There is no weekly view anywhere.

New: a rollup and a surface showing, per person per period — hours worked, the
ceiling in force, public holidays in the period, and hours over. **Without this
nobody can check a doctor's payslip**: the number appears nowhere else.

### Payroll register — a column of its own `[O]`

`[D]` `GRID_COLUMNS` carries **OT h** (`overtimeHours`, display only, with a
*fix* link to Attendance). For a threshold employee that column is misleading:
it holds overtime measured against roster shift ends, which this mode does not
use. `[O]` A separate column, blank for non-threshold employees, rather than
changing what an existing column means row by row.

### Settings

A third radio in the rule-set drawer plus its seven fields, and guidance text
that states the RM4,000 refusal before somebody configures their way into it.

### Reports

`[D]` The snapshot carries `overtimeTiers` derived from `pricing.days` — one
tier per day. A threshold line has no tier. The overtime report needs to handle
that or it will render oddly.

## 8. The payslip line, and the catalogue migration

`[O]` The result appears as its **own named row** carrying the arithmetic, not
as "Overtime":

> **Locum hours** — 12.5 hours over 37.5 × RM50.00 — **RM625.00**

`[D]` This is the cheap part and needs no payslip change. The payslip builds its
earnings from component lines as `{ code, label, amountCents }` and prints the
**label**; nothing in it special-cases the word "Overtime". That word comes from
`materialiseOvertimeDays` hardcoding `componentCode: 'OVERTIME'` and
`label: dayTypeLabel(...)`. The new materialiser sets its own code and label.

**Two conditions, and the second is the one that gets missed:**

1. `[D]` The component code must exist in the catalogue or the run blocks with
   `UNKNOWN_COMPONENT` (*"Payroll input … is not a known pay component"*).
2. `[D]` **A data migration is required for tenants whose catalogue is already
   seeded.** `[O]` Called out by the owner. The **Seed the catalogue** button in
   `apps/web/src/admin/hr/PayrollItemsPage.tsx` only renders when
   `rows.length === 0`, so adding a row to `SEED_PAY_COMPONENTS` reaches new
   tenants only. Every existing clinic needs the row inserted by migration, with
   its statutory flags shipped unverified like every other seeded row.

The clinic sets that component's EPF / SOCSO / EIS / PCB / HRD, Prorate, OT base
and Unpaid-leave base switches itself. This is money paid to an employee and is
almost certainly wages — but the product asserts nothing about any component's
treatment, and this one is no exception.

## 9. Tests

The part that cannot be trimmed. At minimum: ceiling arithmetic; each public
holiday option alone and both together (including that PH hours do not consume
the ceiling when both are on); a week straddling a month boundary priced once
and only in the later month; the cross-period double-pay guard actually
refusing; the RM4,000 refusal; re-calculation of an open month not duplicating
a period's input.

## 10. Estimate

One full piece, comparable in size to 3d. Not a field.

| Part | Estimate |
|---|---|
| Schema, migration, DTO, run snapshot, catalogue data migration | 1 day |
| Engine: period rollup, buckets, PH ceiling, refusal, materialiser + cross-period guard | 2–3 days |
| Exceptions + Review surfacing | 0.5 day |
| Attendance: weekly rollup + screen | 1 day |
| Settings: third radio + seven fields + guidance | 0.5 day |
| Register column, employee payroll page, payslip, reports | 1 day |
| Tests | 1–1.5 days |
| **Total** | **7–8.5 days of focused work** |

Excludes the punch fix in §3, which is its own piece and comes first.

## 11. Still open

1. **Does a periodic excess need approval, and what gets approved — the day or
   the period?** (§6.) Blocking for the engine.
2. Which day starts the week (`thresholdWeekStartsOn` default).
3. `[D]` Rule sets are **not** effective-dated — there is no `effectiveFrom` on
   `PayrollPolicy` and the rates are re-read on every calculation. Moving an
   employee onto or off this mode mid-month reprices the whole open month.
   Whether that is acceptable here, or whether this mode needs dating the way
   salary and statutory standing have it, is worth deciding before the first
   clinic switches.
