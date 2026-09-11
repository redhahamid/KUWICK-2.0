# Payroll Simple UX — owner UAT record

The owner's verdict on the previous build was: *"The existing Excel payroll is
easier to understand and easier to use than Kuwick."*

This is the walk that decides whether that is still true — performed as an owner
would perform it, against the synthetic admin UAT tenant, in a real browser.
Every step is a thing a clinic owner has to be able to DO, and the assertion is
what they would have to see for it to have worked. The test is **not** "can the
route load".

Reproduce with the API and web dev servers running against the seeded database:

```bash
node apps/web/uat-payroll.mjs
```

## The walk — 21 / 21 PASS

| # | Step | Verdict |
|---|---|---|
| 1 | Sign in as the clinic owner | PASS |
| 2 | `HR → Payroll` lands on the month, not on a dashboard about payroll | PASS |
| 3 | The month totals are readable without opening anything | PASS |
| 4 | Every employee and their net pay are visible at once | PASS |
| 5 | The register foots, and its total equals the month header | PASS |
| 6 | Basic, OT, incentive, claims and unpaid leave are told apart | PASS |
| 7 | Opening an employee keeps the register behind it | PASS |
| 8 | One employee's salary is explained without leaving payroll | PASS |
| 9 | The drawer agrees with the register row it was opened from | PASS |
| 10 | An allowed manual earning can be added from the drawer | PASS |
| 11 | A figure that came from attendance says so, and is corrected there | PASS |
| 12 | Unpaid leave reduces the wage rather than being deducted twice | PASS |
| 13 | A blocked employee is marked on their own row, with a way to fix it | PASS |
| 14 | Review says what needs looking at, and does not repeat the register | PASS |
| 15 | Review totals equal the register totals | PASS |
| 16 | Approve states what is being approved, and refuses while blocked | PASS |
| 17 | Approve does not tick itself before it has happened | PASS |
| 18 | Finalise is honest about what it does not do | PASS |
| 19 | History is reachable, and is not the payroll landing page | PASS |
| 20 | An approved month is frozen when reopened from history | PASS |
| 21 | No console errors anywhere in the walk | PASS |

## What the walk found, and what was fixed because of it

Six defects were found by running this and by reading the screenshots. None of
them were caught by the unit or e2e suites, because all six were true of what
the product SHOWED rather than of what it computed.

1. **A calculated PCB of RM0.00 was reported as "missing"** and blocked the run.
   Seven of ten people carried a red *Blocked* chip for a monthly tax figure
   that was correct. The service was right (`pcbCents === null`); the seeded
   world raised the exception on "nobody typed one", so the fixture contradicted
   the product and the first Recalculate would have cleared seven blockers.
   *Fixed in `seed-admin-uat.ts`, which now mirrors the service.*

2. **Three earnings columns were silently empty.** The seed wrote the payroll
   line's columns from a hand-kept list of person keys while pricing the payslip
   from a `lines` array; adding an employee put their allowance, incentive and
   bonus in no column at all. Gross was still right, so every total-level check
   passed and the money surfaced on the register as an unexplained residual.
   *Fixed by deriving the columns from the lines, plus a new seed invariant that
   fails when a priced component is missing from its column — verified to fire
   by reintroducing the old code.*

3. **The drawer did not explain the register.** It listed only itemised input
   rows, so an employee whose overtime was materialised from an approved
   timesheet showed `Overtime 98.48` on the register and nothing about overtime
   in the drawer — the one question the drawer exists to answer.
   *Fixed: the earnings lines are the register's own columns, with the itemised
   rows supplying provenance.*

4. **The Statutory section listed six figures and totalled three of them**, and
   included the employer's own EPF share among the employee's deductions.
   *Fixed: employee-borne only, with the employer's side in Result.*

5. **A green tick appeared on Approve for an unapproved, blocked run.** The rule
   was `index < currentIndex` — "you have scrolled past this" — which is the
   exact defect the comment above it claimed had been fixed.
   *Fixed: each stage now answers its own question; a tick means settled.*

6. **Review's counts did not add up.** "10 employees · 7 ready · 4 blockers"
   invites 7 + 4 = 11 and does not resolve: three populations were in one strip.
   *Fixed: Ready and Blocked partition the run exactly, and the person the run
   left out has a count of their own.*

Also corrected: a `1 day(s)` machine plural in exception copy, a "0 days worked"
chip beside a full month's salary, two redundant "nothing here" rows, a band
label that drifted off the right edge of a scrolled register, a row tint that
made a normal month read as an error screen, an empty state that spent a third
of a laptop screen saying "not yet", and two `antd` Drawer deprecation warnings
on the payroll workspace.

## The UX acceptance test (§30)

| Question | Answer |
|---|---|
| Can a new owner find September payroll immediately? | Yes — `HR → Payroll` is the month. |
| Can they see all employees and net pay immediately? | Yes — the register is the landing screen. |
| Can they understand one employee's salary without visiting other modules? | Yes — the drawer itemises every column, with provenance. |
| Can they tell basic vs OT vs incentive vs commission vs claim? | Yes — columns, with commission and bonus grouped under Incentive and claims under Additional; the drawer splits them. |
| Can they see UPL clearly? | Yes — its own column, left of Gross, in red with a minus. |
| Can they understand EPF/SOCSO/EIS/PCB without entering Settings? | Yes — columns on the register, itemised in the drawer. |
| Can they fix a missing bank account from the payroll workflow? | Yes — the Fix on the row deep-links to the remedy. |
| Can they identify blocker vs warning? | Yes — red *Blocked* vs amber *Check*, and separate sections in Review. |
| Can they approve payroll in a clear linear flow? | Yes — four stages, each with one decision. |
| Can they retrieve payslips after finalisation? | Yes — Finalise carries payslips, payment listing, statutory summary, register export and cost report. |
| Can they understand what Kuwick does NOT submit? | Yes — "not a bank file", and nothing is called Submitted or Filed until a person records the filing. |
| Can they return to a historical month? | Yes — History beside the month picker. |
| **Does the workflow feel simpler than the source Excel?** | **Yes** — see below. |

### On the last question

A spreadsheet's advantage was never its arithmetic; it was that one row holds
everything you need to understand one person's salary, and the bottom row is
the sum of the rows above it. Kuwick made an owner assemble that row in their
head out of six screens, then opened on a page ABOUT payroll rather than on the
payroll.

It now opens on the month, on a register that reads person → earnings →
deductions → net and foots to the same figures printed at the top. What the
spreadsheet cannot do — pull an approved overtime hour in once and say where it
came from, refuse to guess a statutory figure it cannot price, keep an approved
month frozen — happens without the owner being asked to think about any of it.

The one thing it asks that a spreadsheet does not: three people cannot be paid
until a tax profile is recorded. That is the product refusing to make up a
number, and it names the person and the remedy on their own row.
