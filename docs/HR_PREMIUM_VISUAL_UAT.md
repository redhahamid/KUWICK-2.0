# HR premium frontend — visual UAT

What was checked, on what, and what is still true afterwards. Every screen was
opened in a real browser against the synthetic UAT tenant **Klinik Contoh
(UAT)** and compared, side by side, with the twelve-screen reference sheet.
Screenshots for each row are in `docs/screenshots/hr-premium-final/`.

## The world it was reviewed against

| Fact | Value |
|---|---|
| Tenant | Klinik Contoh (UAT) — every name invented, every address `.invalid` |
| Branches | Contoh Central, Contoh Bandar |
| Staff | 13 staff records, 8 with an employment profile |
| Payroll | August 2026, **CALCULATED**, 6 employees, gross RM40,959.40, net RM33,358.55 |
| States present | ready · blocked on salary · blocked on monthly tax · unapproved overtime · missing punch · approved and unpaid leave · claim by payroll · claim by finance · contractor excluded from payroll · benefit healthy / nearly spent / overdrawn |

## Screen by screen

| # | Screen | Reference asked for | Result |
|---|---|---|---|
| 1 | HR Overview | Total staff · on duty · on leave · payroll status; Today's Workforce, Needs Attention, Payroll Readiness, Leave This Week | **Matches.** Twelve counter tiles became four figures and four work panels. Every old exception count survives as a named row that opens the work. |
| 2 | People | who / role / branch / employment / payroll readiness / current status / action | **Matches.** Database-shaped columns (legacy role enum, leave policy, professional type) moved to the column picker. |
| 3 | Employee profile | Overview · Employment · Pay · Attendance · Leave & Claims · Documents, with Personal Information, Employment, Payroll Readiness, Salary Information, Recent Activity | **Matches.** Nine tabs became six; nothing was dropped. The readiness score names what is outstanding beside it. |
| 4 | Add employee | Four stages — Personal, Employment, Pay & Statutory, Review — full page, photo | **Matches, with one honest gap.** The five-step drawer is gone. Photographs are not stored anywhere in Kuwick, so the slot shows the generated avatar and says so rather than offering an upload that loses the file. |
| 5 | Attendance | tabs, then date / branch / status / Export, then five figures, then the sheet | **Matches.** The day-by-day detail is a drawer instead of a second table below the first. |
| 6 | Roster | month, branch, copy last month, add shift, people × days, clear states | **Matches.** The canonical roster component is unchanged; the permanent "One roster" banner is gone. |
| 7 | Leave | Requests · Calendar · Balances, requests first, approvals obvious | **Matches.** Calendar and Balances are new; balances come from one new read that runs the same computation as the per-person one. |
| 8 | Claims | employee, type, date, amount, payment route, status, action | **Matches.** It no longer looks like a separate application. |
| 9 | Payroll register | month + status, four stages, people down, money across, totals below | **Matches, and now adds up.** Stage names are the reference's own: Payroll Details · Review · Approve · Finalise. The row reconciles left to right — see the defect below. |
| 10 | Payroll employee detail | right drawer — Earnings, Deductions, Statutory, NET PAY, provenance | **Matches.** Row expansion is gone; a regression test pins that. Zakat appears only where somebody has one. |
| 11 | Review & approval | Blockers, then Warnings, then summary; Fix / Review / Acknowledge / View; Proceed to Approval | **Matches.** |
| 12 | Reports | categories and cards, not a dropdown; only what exists | **Matches.** Thirteen server-served reports as cards, four working views that are screens marked as such, and the named absences kept with their reasons. |
| 13 | Medical Benefits | (not illustrated) same visual language as the rest | **Rebuilt.** Filter bar, person cell, usage meter, detail drawer — and a new "nearly used up" answer the old table could not give. |
| 14 | Settings | landing plus checklist, not a wall of configuration | **Rebuilt.** The one-time checklist plus six areas, each on its own page. |

## Responsive

| Width | Checked | Result |
|---|---|---|
| Desktop 1680 | every screen | Full experience. |
| Laptop 1366 | Overview, register | Rail, four panels and the register all hold. Stage hints give way to the labels below 1200px; a stage carrying a blocker keeps an amber number so the signal survives. |
| iPad landscape 1180 | Overview, People, register, Attendance, Reports | Rail present; workspace grid one column below 1080. |
| iPad portrait 820 | Overview, People, register, Leave, Settings | Rail present. Money tables scroll sideways with the employee and net-pay columns pinned. |
| Mobile 390 | Overview, People, Attendance, register | Rail becomes the hub's tab strip plus a section picker. Stat strips go two across; stages wrap two by two; the register keeps the person and their net pay and scrolls the rest. Type is never shrunk to fit. |

## Two defects the visual pass found

**The register did not add up across.** `grossPay` is basic LESS unpaid leave
plus the additions — s.18A makes an incomplete month's wages smaller, it does
not take a deduction from them. The Unpaid leave column sat AFTER Gross, where
a deduction goes, so basic plus the four additions came to RM41,094.88 against
a printed gross of RM40,959.40 and the RM135.48 that explains the gap was on
the wrong side of it. Nothing looked broken; a register that does not add up is
simply one somebody stops trusting. The column is before Gross now, and the
employee drawer shows the same figure under Earnings rather than posting a
"Total deductions" that never touches net pay. Pinned by
`payrollGrid.test.tsx` → *"puts every column that makes up gross to the LEFT of
it, so a row adds up"*.

**A residual could hide off the register.** Basic plus allowances plus overtime
plus incentives plus bonus does not reach gross when somebody has a reimbursed
claim or a mileage payment. "Claims & other" is a column now, filled from the
engine's own `pay.rows[].otherEarnings` — never a subtraction done in the
browser.

## What is deliberately not there

- **No employee photograph.** There is no column and no file store. The avatar
  is generated from the name and is stable per person.
- **No employee document files.** The Documents tab lists which identity and
  statutory documents have been sighted well enough to record a number from,
  and says plainly that copies are not held.
- **"Scheduled shifts" needs a branch.** A roster is drawn for one branch at a
  time, so on "All branches" that one figure reads "—" with the reason rather
  than a number that silently means one branch.
- **No bank payment file, no authority submission files.** Unchanged, and still
  stated on the screens that would otherwise imply them.
