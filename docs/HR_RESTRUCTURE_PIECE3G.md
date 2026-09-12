# HR restructure — Piece 3g: the portal, the UAT world and the checklist

The employee's portal on the kit and shell from 3a, after `portal-home.html`,
`portal-leave.html` and `portal-claims.html`; the seed the owner tests
against; and the checklist they follow. No Prisma schema change and no
migration: the clock-in proof the prompt's §7 asks for needs columns that
are not there, and that question is put to the owner rather than answered in
code (§7 below). `[D]` marks what was read in the code or the database,
`[A]` marks an assumption.

## 1. What moved, and what is new

| Screen | Route | State after 3g |
|---|---|---|
| Home | `/my` | Rebuilt on `portal-home.html`: the greeting with today's shift, Clock in / Clock out, three figures, the last three paid months with their PDFs, four quick actions, what happened lately. |
| Payslips | `/my/payslips` | Paid months, newest first: the lines in a drawer, the PDF HR issued. |
| Leave | `/my/leave` | Rebuilt on `portal-leave.html`: the form with a live preview of the days, the balance after, who else is away and any public holiday inside the dates; balances by type; every request with its decision. |
| Claims | `/my/claims` | Rebuilt on `portal-claims.html`: mileage priced from the distance, the receipt required before the button works, every claim with where its money is, the medical benefit. |
| Attendance | `/my/attendance` | The month's punches against the roster, the clock button, a correction request per day, and the roster itself. |
| Profile | `/my/profile` | Read-only, on the kit. The bank account says it is changed through HR. |
| Schedule | `/my/schedule` | Lands on Attendance. The mockups carry no Schedule tab. |

Deleted: `MySchedulePage.tsx`, `my-kuwick.css` (454 lines of the old portal's own styling — the portal is the kit now).

Screenshots beside the mockups: `docs/screenshots/hr-slate-3g/` (three side-by-sides, the other tabs, two phone shots).

### API, all additive

| Change | File | Why |
|---|---|---|
| `GET /me/home` grows `clinicName`, `latestPayslip` (with net and paid date), `payslips` (the last three paid), `leave` (annual left, medical used), `claims` (what is approved and waiting to be paid, and with which payroll), `recent` | `me.service.ts` | The Home mockup's three figures, its payslip list and its *Recent* strip. Summed on the server. |
| `GET /me/leave/balances` | `me.service.ts`, `leave.service.ts` (`balancesForSelf`) | The Balances panel. `[D]` The admin `balancesFor` demanded `hr.view`; the same row computation now has a second door for the person themselves, so the two can never disagree. |
| `GET /me/leave/preview?leaveType&startDate&endDate&halfDay` | `me.service.ts` | The strip under the form: the days the engine will deduct, the balance after, colleagues away over the dates, public holidays inside them. Read-only. |
| `GET /me/benefits` | `me.service.ts` | The medical benefit bar. `[D]` `StaffBenefitAccount` and its usages existed with no self-service door. |
| `GET /me/payslips/:runId/pdf` | `me.controller.ts`, `payroll-payslip.service.ts` (`payslipForSelf`) | The PDF from the portal: identity-checked (the line must be theirs), PAID runs only, audited as a download with `self: true`. |
| `GET /me/payslips` and `/me/payslips/:runId` list PAID runs only | `me.service.ts` | Prompt §7: the payslip appears in the portal once the run is Paid. `[D]` Until now the list also showed APPROVED runs, which a correction can still reopen. |
| `GET /me/claims` rows carry `submittedAt` and `payrollPeriod` | `me.service.ts` | *Submitted 5 Sep* and *Paid Aug* on the row. |
| Recording a run paid closes the claims it carried and stamps the run's `paymentDate` | `payroll-payment.service.ts` | `[D]` A claim routed to payroll was left `IN_PAYROLL` after the money went out, so the portal (and the claims queue) kept saying *will be paid with your salary*. Now `PAID` with the payment date. The e2e that asserted the old state asserts the new one. |

## 2. The portal shell

A slate bar — KUWICK · My Kuwick · the clinic · the person · initials — and
five pill tabs, Home · Payslips · Leave · Claims · Attendance, over a page
held to 960px. The waiting counts (a leave request undecided, a claim
undecided, a correction undecided) sit on the tabs in gold, as the admin rail
does. At phone width the bar keeps the initials, the pills spread to fill the
row at 44px tall, and the primary button is 48px, which the browser
guarantees from the earlier portal work still check.

## 3. Home

The greeting keeps a doctor's title (*Hi, Dr Meera*) and greets everybody
else by first name. The line under it is the day, the branch and today's
shift (or the next one). The figures: the last paid month's net with
*Download PDF*; annual leave left, *of* the entitlement, with the medical
days used; the claims approved and waiting, and which payroll they ride on.
Then the last three paid months with a PDF each, the four quick actions the
mockup names, and *Recent* — decisions on leave and claims and paid months,
newest first, a teal dot for the last fortnight. Nothing on the page adds
anything up.

## 4. Leave

Type · Half day? · From · To · Reason on native controls; the attachment
field says plainly that an MC cannot be attached yet (§7). Under the form,
as the dates are typed, the server's preview: *3 days · Balance after: 11 of
14*, in gold *Wan Azman is also away on 21 Sep*, and a public holiday named
if one falls inside. The days are the calendar days the balance engine
deducts — `[D]` `leaveDays` counts every day of the range and a half day is
recorded on the request but still counts one — so the figure shown is the
figure that comes off, and the strip says *(half day, counted as one)*
rather than pretend. Submit is refused while the person already has leave
over the dates. On the right, Balances by type (*10 of 16 left*, *Unpaid
taken 1 day (Aug)*) and My requests with Waiting · Approved · Not approved.

## 5. Claims

*Mileage* is a type on the form and `TRAVEL` on the API: From · To ·
Distance, and the amount worked out at RM0.60 a kilometre, shown as *RM
25.20 · 42 × RM 0.60*; the journey and the kilometres are written into the
description the manager reads. Any other type takes an amount. The receipt
is required: the button stays disabled until a file is chosen, and the
chosen file shows as the mockup's card with Remove. `[D]` The API keeps the
receipt's name, type and size against the claim; the bytes have no store
yet, as before. My claims lists each with *Submitted d MMM* and a chip —
Waiting · Approved · Paid Aug · Not approved — and the medical benefit bar
reads *RM 380.00 of RM 1,000.00 used this year*.

## 6. The UAT world and the checklist

`apps/api/prisma/seed-hr-uat.ts` rebuilds the admin UAT tenant (as a child
process), completes what a real month needs — the contract executive's
salary, tax standing for the three profiles the base seed leaves blank, the
year's public holidays, a Mon–Fri roster for the three portal accounts, the
resident doctor's leave, claims and benefit — and then runs June, July and
August **through the engine over the API**: create, calculate, approve,
prepare the payment, record it paid on the 28th. Every figure the owner
compares with a real payslip is the product's own; the base seed's
hand-built August lines are replaced by the engine's. `[D]` In-process
bootstrapping was tried first and fails under `tsx`, which emits no decorator
metadata; the API must be running against the database when the seed runs,
which is the UAT's situation anyway.

The HR UAT world is not the world the browser suite asserts on: `admin-hr.spec.ts` expects the base seed's August, calculated and blocked. Seed the base world before `npx playwright test`; seed the HR world for the owner.

`docs/HR_UAT_CHECKLIST.md` (in Malay, for the owner) carries the accounts
and their passwords, the twelve steps with a URL each, the placeholder
values to replace, the worked-cases table from 3d, and what is not yet
possible.

## 7. Where the result differs from the mockup, and why

| Mockup | Result | Why |
|---|---|---|
| *Mon 21 Sep 2026* in the date fields | The browser's own date control, in its locale | Native controls, so the phone shows its date picker. |
| *3 working days* | *3 days* | `[D]` The balance engine deducts calendar days; the strip shows what will be deducted. |
| MC drop zone that takes a file | The zone says the MC goes to the manager | `[D]` No attachment on a leave request in the schema. |
| Receipt thumbnail | The image itself when a photo is chosen, the mockup's placeholder otherwise | — |
| *All →* | *All* | No arrows in link copy. |
| No badge on the tabs | A gold count for what is waiting | The shell's convention; reported. |
| Schedule tab (old portal) | Folded into Attendance | The mockups have five tabs. |
| Annual leave *10 of 16*; three payslips *Aug, Jul, Jun* | The seeded policy gives 14; the three months are the engine's | `[D]` Demo data, not a divergence in the screen. |
| Clock in with selfie and GPS | Clock in | §8. |

## 8. Questions that stay open (from the 3d report)

Schema, beyond §6 — one migration proposed, awaiting the owner's OK:
`AttendanceRecord.source / proofUrl / lat / lng`, a clock-in radius and a
clinic's latitude and longitude on the attendance policy, `selfieConsentAt`
on the employee profile, an attachment on `LeaveRequest`, and a mileage rate
(and distance) for claims. Until then: clock in records the punch without
proof, the MC goes to the manager, the mileage rate is a constant.

## 9. Tests

| Where | What |
|---|---|
| `test/me-self-service.e2e-spec.ts` | Paid-only payslips (approved is hidden, paid is shown, the colleague is refused, the PDF route refuses a colleague); balances and a preview with a colleague's clash and a public holiday; the medical benefit before and after an account. |
| `test/payroll-payslip.e2e-spec.ts` | The employee's own PDF: refused while approved, served once paid, refused to somebody else, audited with `self: true`. |
| `test/payroll-synthetic-month.e2e-spec.ts` | The payroll-routed claim reads PAID once the run is recorded paid. |
| `src/me/portal.test.tsx` (new) | Money and greeting helpers, mileage and the claim chip; Home renders the server's figures and clocks in from the one button; Leave renders balances, requests and the preview, and sends the dates and the half-day flag. |
| `e2e/my-kuwick.spec.ts` | The five tabs and the routes on the kit; the leave preview appears as the dates are typed. |

## 10. Gates

| Gate | Command | Result |
|---|---|---|
| API unit | `npm run test:api` | 130 suites, 2,764 tests, green |
| API e2e | `cd apps/api && npx jest --config test/jest-e2e.json` | 41 suites, 465 tests, green. In the full run two suites (`payroll-synthetic-month`, `payroll-snapshot`) hit Jest's 5-second timeout on app bootstrap while Postgres and both dev servers were cold-starting after a container restart; re-run alone, both green (34 tests) |
| Web unit | `cd apps/web && npx vitest run` | 100 files, 1,724 tests, green. The first full run failed one guard, the kit's isolation test, which now counts the portal as the kit's territory |
| Browser | `CHROME_PATH=/opt/pw-browsers/chromium npx playwright test` | 101 tests: 97 green, 2 skipped (the two scaffolds), 3 failed in the full run, none a regression: `canvas-appointment.spec.ts:40`, pre-existing since Piece 1 and identical on master; `admin-hr.spec.ts:117`, which asserts the base seed's August (calculated, with the contract executive's salary blocker) and was run against the HR UAT world, where that month is paid and the salary recorded — green once the base world CI uses is seeded; `appointment-module.spec.ts:364`, whose fixture day on the staging tenant was full of the appointments today's three earlier runs had booked (that tenant is not reset by either seed) — green once that residue was cancelled. Run the browser suite on the base world, not after `seed-hr-uat.ts` |

## 11. Not in this piece

Attendance, Leave and Claims for the manager on the kit (3e). Reports (3f).
The clock-in proof, the MC attachment and the mileage rate (schema; §8).
Real storage for receipt bytes.
