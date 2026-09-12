# HR restructure — Piece 3g: the portal, the UAT world and the checklist

The employee's portal on the kit and shell from 3a, after `portal-home.html`,
`portal-leave.html` and `portal-claims.html`; the seed the owner tests
against; and the checklist they follow. Delivered in two halves. The first
had no schema change: the clock-in proof the prompt's §7 asks for needs
columns that were not there, and that question was put to the owner. The
owner said yes to **one 3g migration** (§8), and the second half carries it:
a punch with a selfie and a position judged against the branch's radius, the
MC on a medical request, the receipt's bytes on a claim, and the mileage
rate the clinic sets. `[D]` marks what was read in the code or the database,
`[A]` marks an assumption.

## 1. What moved, and what is new

| Screen | Route | State after 3g |
|---|---|---|
| Home | `/my` | Rebuilt on `portal-home.html`: the greeting with today's shift, Clock in / Clock out (with the consent screen, the phone's position and the front camera, §3), three figures, the last three paid months with their PDFs, four quick actions, what happened lately. |
| Payslips | `/my/payslips` | Paid months, newest first: the lines in a drawer, the PDF HR issued. |
| Leave | `/my/leave` | Rebuilt on `portal-leave.html`: the form with a live preview of the days, the balance after, who else is away and any public holiday inside the dates; the MC drop zone, required when the policy says so; balances by type; every request with its decision and its certificate. |
| Claims | `/my/claims` | Rebuilt on `portal-claims.html`: mileage priced from the distance at the clinic's rate, the receipt uploaded and required before the button works (when the policy says so), every claim with where its money is, its kilometres and rate and its receipt, the medical benefit. |
| Attendance | `/my/attendance` | The month's punches against the roster, the selfie kept with each punch, an *Outside clinic · 6.9 km away* chip in gold when a punch was further than the branch's radius, *Entered by HR* when it was, the clock button, a correction request per day, and the roster itself. |
| Profile | `/my/profile` | Read-only, on the kit. The bank account says it is changed through HR. |
| Schedule | `/my/schedule` | Lands on Attendance. The mockups carry no Schedule tab. |

Deleted: `MySchedulePage.tsx`, `my-kuwick.css` (454 lines of the old portal's own styling — the portal is the kit now).

Screenshots beside the mockups: `docs/screenshots/hr-slate-3g/` (three side-by-sides, the other tabs, two phone shots, and from the second half the consent screen, the camera, a punch with its selfie on the timesheet, the MC zone and the two policies in Settings).

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

### The 3g migration (second half) — `20260912160000_attendance_proof_leave_attachments_mileage`

One migration, as the owner allowed, and nothing in it touches an existing
column's meaning. Every new table has row-level security like the rest.

| Table | Change |
|---|---|
| `attendance_records` | `source` (PORTAL · QR · DEVICE · MANUAL, default PORTAL), `proof_url`, `clock_out_proof_url`, `lat`, `lng`, `clock_out_lat`, `clock_out_lng` (six decimals), `distance_metres`, `outside_clinic` |
| `attendance_policies` | `geofence_lat`, `geofence_lng`, `geofence_radius_metres` (default 150) |
| `employee_profiles` | `selfie_consent_at` |
| `leave_request_attachments` (new) | mirrors `staff_claim_attachments` |
| `staff_claims` | `distance_km`, `mileage_rate` (the rate frozen on the claim when it was sent) |
| `claim_policies` (new) | one row per clinic: `mileage_rate_per_km` (default 0.60), `receipt_required` (default true) |
| `staff_files` (new) | the bytes of a selfie, a receipt or an MC: `kind`, name, type, size, `data`, owner |

| Change | File | Why |
|---|---|---|
| `POST /me/files?kind=RECEIPT\|MEDICAL_CERTIFICATE\|SELFIE` (multipart, 8 MB, jpeg/png/webp/pdf; no PDF selfie), `GET /me/files/:id` (own files only) | `me.controller.ts`, `staff-file.service.ts` | The bytes have a store. A file is the person's; nobody else's token reads it from here. |
| `GET /workforce/staff-files/:id` | `workforce.controller.ts` | HR reads the selfie, the receipt or the MC behind `hr.view`. |
| `POST /me/consent/selfie` | `me.controller.ts`, `me.service.ts` | Dated on the profile; audited `selfieConsent.given`. A selfie sent without it is refused (400) — the punch itself is not. |
| `POST /me/attendance/clock` takes `lat`, `lng`, `proofFileId`; `POST /workforce/attendance/clock` also `source` | `clock.dto.ts`, `self-service.dto.ts`, `attendance-record.service.ts` | The punch keeps the position and the photo. `source` is MANUAL when HR clocks somebody else, PORTAL otherwise. |
| The branch's radius is judged on the server | `attendance-geofence.ts` (+ spec) | Haversine; *outside* only when both the fence and the punch are known; a punch outside is kept and flagged, never refused. One distance per day, the furthest punch. |
| Geofence on the policy: `geofenceLat`, `geofenceLng` (both or neither, ranges checked), `geofenceRadiusMetres` (20–5000) | `save-attendance-policy.dto.ts`, `attendance-policy.service.ts`, `attendance-policy.ts` | Resolved per branch like every other field; the point is read from one row, never mixed from two. |
| `GET /me/leave/balances` rows carry `requiresAttachment`; `POST /me/leave` takes `attachmentFileId` and refuses a request without one when the entitlement asks for it | `me.service.ts` | `[D]` `LeaveEntitlement.requiresAttachment` existed and nothing read it on the portal side. |
| `GET/PUT /workforce/claim-policy` (read `hr.view`, save `settings.manage`, audited), `GET /me/claim-policy` | `claim-policy.service.ts`, `save-claim-policy.dto.ts` | The rate and the receipt rule are the clinic's, not a constant. |
| `POST /me/claims` takes `distanceKm` and `receiptFileId`; mileage is priced on the server (`round2(km × rate)`) and the rate frozen on the row; a claim without a receipt is refused when the policy requires one | `me.service.ts` | The amount the manager approves is the server's arithmetic, not the phone's. |
| Timesheet and history rows carry `source`, `proofUrl`, `clockOutProofUrl`, `outsideClinic`, `distanceMetres` | `attendance-record.service.ts`, `me.service.ts` | For the chip and the thumbnail. |
| `seed-hr-uat.ts` | | Central's geofence (a placeholder point in Kuala Lumpur, 150 m — replace in Settings) and the default claims policy. |

## 2. The portal shell

A slate bar — KUWICK · My Kuwick · the clinic · the person · initials — and
five pill tabs, Home · Payslips · Leave · Claims · Attendance, over a page
held to 960px. The waiting counts (a leave request undecided, a claim
undecided, a correction undecided) sit on the tabs in gold, as the admin rail
does. At phone width the bar keeps the initials, the pills spread to fill the
row at 44px tall, and the primary button is 48px, which the browser
guarantees from the earlier portal work still check.

## 3. Home, and the clock button

The greeting keeps a doctor's title (*Hi, Dr Meera*) and greets everybody
else by first name. The line under it is the day, the branch and today's
shift (or the next one). The figures: the last paid month's net with
*Download PDF*; annual leave left, *of* the entitlement, with the medical
days used; the claims approved and waiting, and which payroll they ride on.
Then the last three paid months with a PDF each, the four quick actions the
mockup names, and *Recent* — decisions on leave and claims and paid months,
newest first, a teal dot for the last fortnight. Nothing on the page adds
anything up.

**Clock in** (`clock.tsx`, on Home and on Attendance) does three things in
order and gives up on each gracefully rather than refuse the punch. First,
once, consent: a short screen says what the photo is for (proof that you
were here, shown to your manager and HR, nothing else) with *I agree* and
*Not now, clock without a photo*; the answer is dated on the profile.
Second, the phone's position, if it will say within eight seconds. Third,
the front camera in a drawer — *Take photo and clock in*, or *Skip the
photo*; a JPEG at most 640px on its long side goes up as the person's own
file and the punch carries its id. No camera, no permission, no position:
the punch goes in and the message says what it went in without. The server
judges the position against the branch's radius; outside is recorded and
shown, never rejected. `[A]` Phase 1 of the prompt's §7 (no device): QR and
device sources exist in the enum for later and nothing writes them yet.

## 4. Leave

Type · Half day? · From · To · Reason on native controls; the attachment
zone takes the MC (jpeg, png, webp or pdf) and is required — the button
waits for the file — when the leave policy says that kind needs one
(`[D]` the entitlement's `requiresAttachment`, which the seeded policy sets
for medical leave); for any other kind it says *Not needed*. The certificate
goes up first as the person's own file and the request points at it, so a
failed upload leaves no request behind. Under the form,
as the dates are typed, the server's preview: *3 days · Balance after: 11 of
14*, in gold *Wan Azman is also away on 21 Sep*, and a public holiday named
if one falls inside. The days are the calendar days the balance engine
deducts — `[D]` `leaveDays` counts every day of the range and a half day is
recorded on the request but still counts one — so the figure shown is the
figure that comes off, and the strip says *(half day, counted as one)*
rather than pretend. Submit is refused while the person already has leave
over the dates. On the right, Balances by type (*10 of 16 left*, *Unpaid
taken 1 day (Aug)*) and My requests with Waiting · Approved · Not approved,
each with its certificate (a thumbnail for a photo, the file name for a PDF).

## 5. Claims

*Mileage* is a type on the form and `TRAVEL` on the API: From · To ·
Distance, and the amount worked out at the clinic's rate as the distance is
typed, shown as *RM 25.20 · 42 × RM 0.60*; the journey and the kilometres
are written into the description the manager reads, and the kilometres and
the rate go to the server as numbers, which prices the claim again and
freezes the rate on it. Any other type takes an amount. The receipt is
required when the clinic's policy says so (the seeded default): the button
stays disabled until a file is chosen, the chosen file shows as the mockup's
card with Remove, and it goes up as the person's own file before the claim
is sent. My claims lists each with *Submitted d MMM · 42 km × RM 0.60* and
its receipt, and a chip — Waiting · Approved · Paid Aug · Not approved — and
the medical benefit bar reads *RM 380.00 of RM 1,000.00 used this year*.

## 5a. Settings › Attendance & leave policies

The attendance rules panel gains the branch's point and radius — *Clinic
latitude*, *Clinic longitude*, *Counts as at the clinic within 150 m* — with
*Use where this device is now* to fill the point from the phone or laptop of
whoever is standing in the clinic, and a note that a punch outside is marked,
never refused. Both halves of the point or neither; the panel says so before
the round trip and the server says so again. Under it, a **Claims** panel:
the mileage rate in RM per km and *A receipt is required*, saved behind
`settings.manage` with an optional reason. `[A]` The Settings mockup has six
cards and none for claims, so the panel lives on the Attendance & leave
policies page rather than behind a seventh card; the owner may want the card.

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
| MC drop zone that takes a file | The same, required for medical leave, *Not needed* for the rest | Second half; the policy decides which kinds need one. |
| Receipt thumbnail | The image itself when a photo is chosen, the mockup's placeholder otherwise | — |
| *All →* | *All* | No arrows in link copy. |
| No badge on the tabs | A gold count for what is waiting | The shell's convention; reported. |
| Schedule tab (old portal) | Folded into Attendance | The mockups have five tabs. |
| Annual leave *10 of 16*; three payslips *Aug, Jul, Jun* | The seeded policy gives 14; the three months are the engine's | `[D]` Demo data, not a divergence in the screen. |
| Clock in with selfie and GPS | Clock in, with the consent screen, the position and the camera drawer | Second half. The mockup has no consent screen; the photo cannot be kept without one. |

## 8. The questions, answered

Two were put to the owner after the first half. **One 3g migration** —
`AttendanceRecord.source / proofUrl / lat / lng`, the geofence on the
policy, `selfieConsentAt` on the profile, an attachment on `LeaveRequest`,
the mileage rate and the distance on a claim — was allowed, and is the
migration in §1. **The bank account stays changed through HR only.**

What the second half settles, `[A]` unless marked: the photo is proof and
nothing else (no matching, no sharing) and the consent screen says so; a
punch is never refused for being outside, for having no position or for
having no photo — the timesheet shows what it lacked; one distance a day,
the furthest punch, so the flag always has the number that earned it; the
receipt rule and the rate are the clinic's (`claim_policies`), the seeded
defaults RM0.60 and required; a file is 8 MB at most and is read back only
through the owner's token or `hr.view`; Central's geofence point in the seed
is a placeholder in Kuala Lumpur for the owner to replace.

## 9. Tests

| Where | What |
|---|---|
| `test/me-self-service.e2e-spec.ts` | Paid-only payslips (approved is hidden, paid is shown, the colleague is refused, the PDF route refuses a colleague); balances and a preview with a colleague's clash and a public holiday; the medical benefit before and after an account. Second half: a file uploaded and read back by its owner only; a selfie refused before consent; a clock-in with proof and a position inside the radius and a clock-out outside it (source, proof, distance and the flag on the row); the MC the policy asks for (refused without, kept with); a mileage claim priced by the clinic and refused without a receipt. |
| `src/workforce/attendance-geofence.spec.ts` (new) | The distance, the judgement with and without a fence or a punch position, plausible points. |
| `test/payroll-payslip.e2e-spec.ts` | The employee's own PDF: refused while approved, served once paid, refused to somebody else, audited with `self: true`. |
| `test/payroll-synthetic-month.e2e-spec.ts` | The payroll-routed claim reads PAID once the run is recorded paid. |
| `src/me/portal.test.tsx` (new) | Money and greeting helpers, mileage at the clinic's rate and the claim chip; Home renders the server's figures and clocks in from the one button — bare when the browser has no camera and no position, after the consent screen the first time (*Not now* clocks without a photo, *I agree* records the consent); Leave renders balances, requests and the preview, sends the dates and the half-day flag, holds a medical request until the MC is chosen and then sends the file first, and shows the certificate on a decided request. |
| `e2e/my-kuwick.spec.ts` | The five tabs and the routes on the kit; the leave preview appears as the dates are typed. |

## 10. Gates

| Gate | Command | Result |
|---|---|---|
| API unit | `npm run test:api` | First half: 130 suites, 2,764 tests, green. Second half: 131 suites, 2,768 tests, green |
| API e2e | `cd apps/api && npx jest --config test/jest-e2e.json` | First half: 41 suites, 465 tests, green (two suites hit Jest's 5-second bootstrap timeout while the container was cold-starting; green alone). Second half: 41 suites, 470 tests, green in one run |
| Web unit | `cd apps/web && npx vitest run` | First half: 100 files, 1,724 tests, green (one guard, the kit's isolation test, now counts the portal as the kit's territory). Second half: 100 files, 1,728 tests, green |
| Browser | `CHROME_PATH=/opt/pw-browsers/chromium npx playwright test` | 101 tests: 97 green, 2 skipped (the two scaffolds), 3 failed in the full run, none a regression: `canvas-appointment.spec.ts:40`, pre-existing since Piece 1 and identical on master; `admin-hr.spec.ts:117`, which asserts the base seed's August (calculated, with the contract executive's salary blocker) and was run against the HR UAT world, where that month is paid and the salary recorded — green once the base world CI uses is seeded; `appointment-module.spec.ts:364`, whose fixture day on the staging tenant was full of the appointments today's three earlier runs had booked (that tenant is not reset by either seed) — green once that residue was cancelled. Run the browser suite on the base world, not after `seed-hr-uat.ts` |

## 11. Not in this piece

Attendance, Leave and Claims for the manager on the kit (3e), where the
selfie thumbnails, the *Outside clinic* chip and the receipt image reach HR.
Reports (3f). QR and device clock-in (the enum has the values; nothing
writes them).
