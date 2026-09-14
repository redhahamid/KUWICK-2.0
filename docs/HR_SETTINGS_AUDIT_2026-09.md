# Every HR setting, and whether the engine reads it

`[O]` The owner asked for this before piece 4 closes: *"audit every HR setting:
for each field that can be set anywhere in Settings, establish whether the
engine reads it, and report the dead ones. The owner expects more than these
three."*

`[D]` marks what was read in the code, `[A]` an assumption, `[O]` an owner
decision.

## Method, and a correction to my own first pass

`[D]` For each field on each HR settings model, traced from the column to the
code that consumes it, and counted a field **live** only if a calculation or a
decision reads it — not if it is merely saved, typed, defaulted, carried in a
DTO or displayed back. Those four are exactly how a dead setting looks alive.

`[A]` **My first pass got two fields wrong and they are corrected below.** I
reported `overtimeMinimumMinutes` and `overtimeRoundingMinutes` as dead on a
search that stopped at the policy object. They are live: the call is one
function deeper. The method above is what caught it on re-check, and it is
worth saying plainly because a false "this setting does nothing" is as
expensive as a missed one — it invites deleting a control that is holding
money in place.

## Attendance policy

| Field | Read by | Verdict |
|---|---|---|
| `lateGraceMinutes` | `attendance-hours.ts` | **live** |
| `earlyOutGraceMinutes` | `attendance-hours.ts` | **live** |
| `countEarlyClockIn` | `attendance-hours.ts:236` | **live** |
| `maximumShiftHours` | `attendance-hours.ts:245` | **live** |
| `geofenceLat` / `Lng` / `RadiusMetres` | the punch path | **live** |
| `overtimeMinimumMinutes` | `attendance-policy.ts:132` | **live** |
| `overtimeRoundingMinutes` | `attendance-policy.ts:133` | **live** |
| `overtimeRequiresApproval` | nothing | **DEAD** (finding 7) |
| `unpaidBreakMinutes`, `breakAfterMinutes` | `payableMinutes`, which nothing reads | **DEAD** (piece 1) |

`[D]` **The two overtime shaping fields are live, and this is the chain** —
`overtimeCandidateMinutes` (`attendance-policy.ts:131`) applies the minimum and
then the rounding → `attendance-hours.ts:239` → written to the record as
`overtimeMinutes` (`attendance-record.service.ts:167`) → priced at
`overtime-pricing.ts:180` and `:296`. A clinic that sets "overtime starts after
30 minutes, rounded down to 15" gets exactly that, and it reaches pay.

`[D]` **`overtimeRequiresApproval` is dead** (the owner's finding 7), and its
own schema comment is the clearest statement of what it fails to do:

> When true (the default, and the safe direction) approved overtime is the only
> overtime that reaches payroll. A clinic that pays all recorded extra time can
> turn this off deliberately, and the run says which it was.

`[D]` All seven pricing branches gate on `day.overtimeApproved` unconditionally
(`overtime-pricing.ts:180, 228, 242, 261, 296, 308, 334`), and the only writer of
`overtimeApproved: true` is the explicit approve action
(`attendance-record.service.ts:544`). So turning the switch **off** does not pay
recorded extra time — it changes nothing at all, and no run says which it was.
The switch is safe in one direction only, which is why this has not shown up as
wrong pay.

## Payroll policy

| Field | Read by | Verdict |
|---|---|---|
| `overtimeMode` | `payroll-policy-resolution.ts` | **live** |
| `clinicOvertimeHourly` | `payroll-policy-resolution.ts` | **live** |
| `clinicPublicHolidayShift`, `clinicRestDayShift`, `clinicSessionRate` | same | **live** |
| `overtimeHoursPerDay` | `payroll-policy.service.ts:109`, the warning only | **half** |
| `salaryProrationBasis`, `salaryProrationDays` | nothing | **DEAD** |
| `overtimeBasis`, `overtimeDays` | nothing | **DEAD** |
| `unpaidLeaveBasis`, `unpaidLeaveDays` | nothing | **DEAD** |
| `leavePayBasis`, `leavePayDays` | nothing | **DEAD** |
| `terminationBasis`, `terminationDays` | nothing | **DEAD** |

`[D]` **`overtimeHoursPerDay` is the one field that is neither.** It is read —
but only to compute the First Schedule shortfall warning the Settings screen
shows (`clinicRateShortfalls(rates, wages, Number(row.overtimeHoursPerDay))`).
No payroll line is priced from it. `[A]` That makes it the most confusing field
of the group rather than the safest: change it and the screen's warning moves,
which reads as proof the number is in force. It is not.

`[D]` The two that looked live are not. `payroll.service.ts:627` reads
`run.orpOvertimeDays` — the RUN's own column, which the owner already
established is never written — and `payroll-journey.service.ts:437` reads
`line.unpaidDays`, a computed figure on the line. Neither touches the policy
field of the same name. `payroll-calculation.ts:229` says of one of them
outright: *"`unpaidLeaveDaysPerMonth` is GONE from the calculation."*

`[D]` So **ten** payroll-policy fields are stored and applied to nothing, and an
eleventh moves only a warning. Every run prices the ordinary rate from the schema
defaults 26 / 31 / 7.5.

`[O]` The owner's own note on why this is worse than harmless: *"For this
clinic the defaults happen to be the right numbers, which is what makes it
dangerous rather than harmless."*

## Leave policy — one more, and it is new

| Field | Read by | Verdict |
|---|---|---|
| `carryForwardDays` | nothing | **DEAD — new** |

`[D]` **A carry-forward cap that caps nothing.** `carryForwardDays` is read at
`leave.service.ts:63` into the API's list response, written at `:86` and `:96`,
and consulted by no calculation. `[D]` It is also never rendered: there is **no
leave-policy editor anywhere in the web app**. The employee record shows the
policy's name and its annual-leave days (`EmployeeWorkspacePage.tsx:325, 385`)
and nothing else. The balance is computed from
`carriedInDays` on the employee's stored `LeaveBalance` row
(`leave.service.ts:234`), and that row has exactly one writer: the manual adjust
action (`leave.service.ts:329, 338`, from `adjust-leave-balance.dto.ts`).

`[D]` There is no year-end rollover job anywhere in the API — nothing reads a
December balance and writes January's carried-in days. So the policy's cap is
never applied in either direction: nothing carries leave forward automatically,
and a manager adjusting a balance by hand can enter twenty carried-in days under
a policy that says eight, with nothing to object.

`[A]` This is the one I would put in front of the owner first of the new ones.
It is the same shape as the two I wrongly flagged on the attendance policy — a
number a clinic would reasonably believe is being enforced — except that here it
is true, and it governs leave that staff will eventually ask to take or be paid
for.

## Two different problems, and only one is on a screen

`[D]` I checked where each dead field actually appears in the web app, because
it decides what the fix can be. They are not one group:

**Dead and on screen** — a clinic reads these and is misled:

| Field | Where | What it says |
|---|---|---|
| `overtimeRequiresApproval` | `AttendanceRulesPanel.tsx:221` | a switch, with help text that is false in the off position |
| `unpaidBreakMinutes`, `breakAfterMinutes` | `AttendanceRulesPanel.tsx` FIELDS | two editable numbers |
| `unpaidLeaveBasis`, `unpaidLeaveDays` | `PayrollSettingsPage.tsx:379` | the **Unpaid leave** column, e.g. "Calendar days (31)" |

**Dead and API-only** — no screen shows them, no screen edits them:

`salaryProrationBasis`, `salaryProrationDays`, `overtimeBasis`, `overtimeDays`,
`leavePayBasis`, `leavePayDays`, `terminationBasis`, `terminationDays`,
`carryForwardDays`.

`[D]` The eight payroll ones survive only because `PayrollSettingsPage.tsx:187`
resends them unchanged on every edit — a carry-through, not a display. They are
reachable through the API and through nothing else.

`[A]` **This splits piece 4's build in two.** Marking a field on screen fixes the
first group and does nothing for the second: there is no screen to mark. The
second group is a decision about the API surface — implement them or withdraw
them — and it is the owner's, not mine.

## Promised and absent

`[D]` **The payroll cut-off day** (finding 8). There is no field for it on any
screen and no column for it on any model. It is not a dead setting — it is a
setting that was never built, described as though it were.

`[D]` The description that promises it is `HrSettingsPage.tsx:209`, on the
**Payroll policies** card, and it makes **two** false claims in one line:

> Who may approve a run, how overtime and unpaid leave are priced, cut-off day.

`[D]` Only the first clause is true. There is no cut-off day; and unpaid leave is
priced from the run's own computed days, never from the unpaid-leave basis this
card is pointing at.

## The settings that are live, in full

`[D]` Checked and consuming, so that "audit every setting" means every one:

| Model | Fields | Read by |
|---|---|---|
| `ClaimPolicy` | `mileageRatePerKm`, `receiptRequired` | `me.service.ts:762, 767` |
| `LeavePolicy` | `proRateOnJoin` | `leave.service.ts:228, 249` |
| `LeavePolicyEntitlement` | `daysPerYear`, `paid`, `requiresAttachment` | `leave.service.ts:224, 248`, `me.service.ts:654` |
| `PayrollApprovalPolicy` | `mode`, `allowOwnerSelfApproval` | `payroll-approval-rule.ts:70, 108` |

## The count

`[D]` **Fourteen dead fields, one half-live, one promised with no field at
all** — against the three the owner already knew about:

- 1 on the attendance policy (`overtimeRequiresApproval`, finding 7)
- 2 belonging to piece 1 (`unpaidBreakMinutes`, `breakAfterMinutes`)
- 10 on the payroll policy, the group the owner had identified
- **1 new on the leave policy (`carryForwardDays`)**
- 1 half-live (`overtimeHoursPerDay` — moves a warning, prices nothing)
- 1 promised with no field at all (the cut-off day, finding 8)

`[A]` The owner expected more than three and there are more than three, but
**not in the place I first said**. The attendance policy is in better shape than
my first pass claimed; the payroll policy is exactly as bad as the owner
suspected; and the one genuinely new field is on the leave policy, which nobody
had looked at.

## What was built on the back of this, and what was not

`[D]` **Built: the screens stop claiming.** Every dead field that a clinic can
actually see now carries a **Not applied** mark (`hr/ui/NotApplied.tsx`), in the
gold `attn` tone because it is a decision waiting for the account holder rather
than a settled fact:

| Where | What changed |
|---|---|
| `AttendanceRulesPanel.tsx` | the unpaid-break pair marked |
| `AttendanceRulesPanel.tsx` | **the approval switch's help text corrected** — it said off "means extra time reaches payroll without anybody agreeing to it", which is false |
| `PayrollSettingsPage.tsx` | the **Unpaid leave** column marked |
| `HrSettingsPage.tsx` | the Payroll policies card no longer promises a cut-off day, nor unpaid-leave pricing |

`[D]` Pinned by `settingsNotApplied.test.tsx`, including a test that the overtime
minimum and rounding stay **un**marked — the two I first got wrong. If either
ever becomes dead for real, that test fails and somebody decides on purpose.

`[A]` **Not built, and deliberately: none of the fourteen was made live or
deleted.** Applying a dead setting changes what somebody is paid. That is the
account holder's decision, one field at a time, and it is not a thing to do at
the end of a long session on the way past.

`[A]` **Not built, because there is nothing to mark:** the nine API-only fields.
No screen shows them, so on-screen honesty cannot reach them. They need the
other decision — implement or withdraw from the API — and that is the owner's.

`[A]` `[O]` **The one I would put first** is `carryForwardDays`. It is the only
new find that governs something staff will eventually ask for, and it is
currently neither enforced nor visible.
