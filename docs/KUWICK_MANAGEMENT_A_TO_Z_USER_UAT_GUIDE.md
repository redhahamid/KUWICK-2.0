# Kuwick 2.0 — Management A–Z user guide and owner UAT

**Who this is for:** the clinic owner. Not a developer. It assumes you know how your clinic runs and
nothing at all about how Kuwick is built.

**What it covers:** the five Management areas under **Administration** — Operation, Stock, Panel, HR
(including Payroll) and Finance — as they actually exist in the build you are testing. Every screen named
here was opened, and every figure quoted was read off the running system. Where something is missing,
partial, or deliberately restricted, this guide says so in the same breath as the thing it does.

**What it is not:** it is not a specification, and it does not describe anything Kuwick cannot do today.
If you find a screen behaving differently from this guide, the guide is wrong and that is a UAT finding
worth writing down.

**Not in scope for this round:** appointments and the calendar, public booking, the queue, registration,
and the clinical/consultation workspace. They exist and Management reads their data, but you are not being
asked to test them here.

---

## Contents

1. [Before you start](#1-before-you-start)
2. [How to read this guide, and how to record a result](#2-how-to-read-this-guide)
3. [First-time setup — the order that actually works](#3-first-time-setup)
4. [Operation](#4-operation)
5. [Stock](#5-stock)
6. [Panel](#6-panel)
7. [HR](#7-hr)
8. [Payroll](#8-payroll)
9. [Finance](#9-finance)
10. [Cross-module tests](#10-cross-module-tests)
11. [Master UAT checklist](#11-master-uat-checklist)
12. [What is supported, partly supported, and not yet](#12-support-status)

---

## 1 · Before you start

### Signing in — WHICH SYNTHETIC CLINIC ARE YOU LOOKING AT?

**Read this first.** There are **two** synthetic UAT worlds in this repository, built by two different
seeds, with **different sign-ins**. Using the wrong one gives "Invalid credentials" on a perfectly healthy
deployment — which is exactly what happened once, and cost an afternoon.

Look at the clinic name in the header. It tells you which world you are in and therefore which
address to use:

| The header says | Seeded by | Owner sign-in |
| --- | --- | --- |
| **Kuwick / Klinik UAT Staging (Synthetic)** — a single branch | `seed-staging-uat.ts` (`npm run seed:staging`) — **this is what a Railway UAT deployment gets** | `owner@uat.kuwick.invalid` |
| **Klinik Contoh (UAT)** — two branches, Contoh Central and Contoh Bandar | `seed-admin-uat.ts` (`KUWICK_ADMIN_UAT_SEED=yes`) — the local Management fixture | `owner@admin-uat.kuwick.invalid` |

**Passwords are never committed.** `seed-staging-uat.ts` prints its password once at the end of the seed
run — it is whatever `STAGING_SEED_PASSWORD` was set to, or a generated one. One password covers all five
staging accounts, so if any of them works, the owner's works too. `seed-admin-uat.ts` uses
`AdminUat!2026` (or `$ADMIN_UAT_PASSWORD`).

If the staging password has been lost, **do not re-run the seed** — that rebuilds patients, visits and
stock positions and would erase UAT findings mid-review. Reset the owner alone:

```bash
railway run --service kuwick-api \
  bash -c 'KUWICK_UAT_OWNER_RESET=yes UAT_OWNER_PASSWORD="<choose one>" \
           npx tsx prisma/reset-uat-owner.ts --workspace=apps/api'
```

It writes two rows — the owner's login and the staff record behind it — and refuses to run against any
database holding a tenant that is not marked synthetic. Every other account keeps the password it has.

#### The accounts in each world

**Staging (a Railway UAT deployment)** — `owner@`, `frontdesk@`, `finance@`, `doctor@`, `stock@`, all
`@uat.kuwick.invalid`. **`doctor@` is a doctor, not an administrator: every Management module correctly
refuses it.** If Management looks locked, check which account you are signed in as before anything else.

**Local Management fixture** — the clinic is **Klinik Contoh (UAT)** with two branches, **Contoh Central**
and **Contoh Bandar**:

| Account | What it is for |
| --- | --- |
| `owner@admin-uat.kuwick.invalid` | The owner. Sees everything. Use this one unless a test says otherwise. |
| `finance@admin-uat.kuwick.invalid` | Finance staff — for testing that pay is hidden from them |
| `stock@admin-uat.kuwick.invalid` | Stock staff |
| `panel@admin-uat.kuwick.invalid` | Panel staff |

Everything in both worlds is synthetic — invented people, invented money. There is no real patient,
employee, identity-card number, bank account or supplier anywhere in either of them.

> **What the two worlds contain is not the same, and this guide describes the second one.** The staging
> seed builds a clinic, its staff, a medicine catalogue, a panel and eight clinical/queue scenarios with
> their invoices. It does **not** build the two-branch Management history this guide's figures come from:
> no payroll run, no attendance month, no stock transfers or stock takes, no panel claim workspace with a
> rejection and a re-claim. On a staging-seeded environment the Management screens will open and be
> correct, but many will be **empty or thin**, and the specific amounts quoted throughout this guide will
> not appear. To follow this guide figure for figure, the environment has to be seeded with
> `seed-admin-uat.ts`.

After signing in, go to **Administration**. You will see five areas across the top:

> **Operation · Stock · Panel · HR · Finance**

and, at the very top left, a branch selector reading **All branches**. Almost every screen in Management
respects it. Changing it is the fastest way to see whether a number is real.

### The one habit worth having

When a figure looks wrong, **write down what you did, what you expected, and what you saw**. A screenshot
helps enormously. "Finance is wrong" cannot be fixed; "Finance → Sales for September showed RM2,131.10 but
I expected RM2,091.10 because of the RM40 refund" can be fixed in ten minutes.

---

## 2 · How to read this guide

Each area has two parts.

**The explanation** — what the screens are for, where to click, what to type, what happens afterwards, and
what Kuwick deliberately will not do.

**The tests** — numbered cases (O-01, STK-01, PNL-01, HR-01, PAY-01, FIN-01, X-01…) in this shape:

| | |
| --- | --- |
| **Do this** | the action, in order |
| **You should see** | what a correct system shows |
| **Check** | the specific thing that proves it |
| **Pass / Fail** | your verdict |
| **Comment** | anything that surprised you |

A test **fails** if what you see contradicts the "You should see" column. A test does **not** fail because
a feature is missing that this guide already told you is missing — that is a known limitation, and
[section 12](#12-support-status) lists them all.

---

## 3 · First-time setup

This is the order for a **brand-new clinic**. The UAT clinic already has all of it done, so you can read
this section to understand the dependencies and then test the pieces from
[SETUP-01](#setup-tests) onward. Each step says what breaks if you skip it.

The dependency order is real: later steps genuinely cannot be completed without the earlier ones.

### Step 1 — The employing company (legal employer)

| | |
| --- | --- |
| **Where** | Administration → HR → Employees → *Employing companies*, or `/admin/hr/employers` |
| **What to enter** | Company name, registration number, and the filing numbers you have: EPF (KWSP), SOCSO (PERKESO), LHDN, HRD Corp. Bank details if you pay staff from a company account. |
| **Why it is required** | Every statutory return is filed **by a company**, not by a clinic. Payroll cannot produce an EPF or SOCSO listing without knowing whose employer number goes on it. |
| **Who** | Owner |
| **If missing** | Payroll refuses to calculate for that employee — "No employing company is recorded" — and blocks the run. |
| **Confirm it worked** | The company appears in the list with its numbers. The bank account shows only its **last four digits** — that is deliberate, not a bug. |

### Step 2 — Branches

| | |
| --- | --- |
| **Where** | Clinic settings (created with your account; the UAT clinic already has two) |
| **Why** | Stock is held per branch, payroll runs per branch, and every Management figure can be filtered by branch. |
| **If missing** | Everything still works, but you cannot compare branches or run payroll for one. |

### Step 3 — People and what they may see

| | |
| --- | --- |
| **Where** | Administration → HR → Employees; permissions at `/admin/hr/access` |
| **What to enter** | Each person's name, role, and home branch. |
| **Why** | **Home branch is not decoration.** A member of clinical staff with no home branch loses access rather than silently getting access to every branch — Kuwick fails closed. |
| **If missing** | People cannot sign in, or cannot see the branch they work at. |
| **Confirm** | Sign in as that person and check they see their branch and nothing they should not. |

### Step 4 — Employee records

| | |
| --- | --- |
| **Where** | Administration → HR → Employees → open a person |
| **What to enter** | Employee number, position, employment type, start date, **date of birth**, bank details, and the employing company from step 1. |
| **Why DOB matters** | EPF, SOCSO and EIS all change at age 60. Without a date of birth every statutory figure would be a guess, so Kuwick refuses to guess. |
| **If missing** | Payroll blocks that person with "Date of birth is missing". |

### Step 5 — Salary

| | |
| --- | --- |
| **Where** | Employee → **Salary** tab → *Record a change* |
| **What to enter** | Amount, basis (monthly), the date it takes effect, and why. |
| **Why dated** | Recording a raise closes the old rate rather than replacing it, so a payroll run for an earlier month still uses the rate that was true then. |
| **If missing** | "Salary setup is incomplete" — that person is left out of the run entirely rather than paid a figure nobody chose. |

### Step 6 — Statutory standing

| | |
| --- | --- |
| **Where** | Employee → **Employment** tab → statutory standing |
| **What to enter** | EPF membership (this carries citizenship, which the law turns on), SOCSO and EIS applicability, LINDUNG 24 JAM participation, tax residence, MTD category, number of qualifying children, designated rest day. |
| **Why** | These decide which table each contribution is read from. |
| **If missing** | Payroll blocks with a named reason per person. "Not recorded" is never treated as "no" — see [PAY-05](#pay-tests). |

### Step 7 — Pay components and payroll settings

| | |
| --- | --- |
| **Where** | Administration → HR → Payroll settings |
| **What is there** | The pay-component catalogue (basic, allowance, overtime, incentive, commission, bonus, locum fee, unpaid leave, zakat, advances…), each with its own statutory treatment, and the approval policy. |
| **Why** | Whether a component is EPF wages, SOCSO wages, taxable, or part of the overtime rate is decided **once, per component, with a date and a source** — not per payroll run. |
| **If missing** | The seeded catalogue covers the ordinary cases; a component you invent without treatment would be paid with no statutory treatment behind it, which Kuwick refuses. |

### Step 7a — Attendance rules (late, overtime, breaks)

| | |
| --- | --- |
| **Where** | Administration → HR → Payroll settings → *Attendance rules* |
| **What to enter** | The grace before an arrival counts as late; the grace before an early finish counts as short; the **minimum** extra time before it is even an overtime candidate; how overtime rounds; whether early clock-in counts; unpaid break length and the shift length after which a break applies; the longest shift a single punch pair may span. |
| **Why** | A twenty-four-hour clinic and a nine-to-five practice do not agree about when 09:06 is late, and neither is wrong. Hard-coding one answer makes the other clinic's timesheet a fiction. |
| **Who** | Owner. A **group default** is set with no branch chosen; a branch can override any single field and inherits the rest. |
| **If missing** | Kuwick's own defaults apply — nothing breaks and nothing is silently mis-paid; the figures are simply computed on a policy nobody chose. |
| **Confirm it worked** | Clock somebody in a few minutes late and check the timesheet agrees with your grace period. |

> **The minimum is applied BEFORE the rounding, not after.** Twelve minutes over on a fifteen-minute minimum
> is not overtime; rounding it up to fifteen first and then comparing would pay it. This is the kind of
> difference nobody notices for a year and then notices for every month of that year.

### Step 8 — Panel companies and their fees

| | |
| --- | --- |
| **Where** | Administration → Panel → Panel companies, then Panel configuration |
| **What to enter** | Each panel company, and **how its fee is treated** — see [section 6](#6-panel). |
| **If missing** | Claims still work, but the fee treatment shows as **Unconfigured** and Kuwick will not guess whether the fee comes off what you receive or is added to it. |

### Step 9 — Stock: items, suppliers, opening balances

| | |
| --- | --- |
| **Where** | Administration → Stock → Items & Pricing, then Suppliers |
| **What to enter** | Item name, code, unit, cost price, selling price, reorder level; then your suppliers. |
| **Why cost matters** | Stock value is *cost × quantity*. An item with no cost contributes nothing to the value figure, and the screen counts those for you. |
| **If missing** | Dispensing still reduces stock, but valuation understates. |

### Step 10 — Finance configuration

| | |
| --- | --- |
| **Where** | Administration → Finance |
| **What is there** | Tax/SST codes, day-end closing, payment tenders. |
| **Note** | Kuwick does not connect to LHDN MyInvois or to any bank. See [section 12](#12-support-status). |

<a name="setup-tests"></a>
### Setup tests

| ID | Do this | You should see |
| --- | --- | --- |
| **SETUP-01** | HR → Employees → *Employing companies* | Klinik Contoh Sdn Bhd with EPF/SOCSO/LHDN numbers; a second company, Contoh Wellness Sdn Bhd, deliberately **missing** SOCSO and LHDN numbers |
| **SETUP-02** | Look at the bank account on either company | Only "on file" and the last four digits — never the full number |
| **SETUP-03** | Open any employee → Salary tab | A history of dated rates, each with a reason and who recorded it; not a single editable box |
| **SETUP-04** | HR → Payroll settings | The pay components with their statutory treatment, and each schedule's verification status |
| **SETUP-05** | Panel → Panel configuration | Fee treatment per panel, including at least one **Unconfigured** |

---

## 4 · Operation

**What it is for.** Operation is *management* operations — how busy the clinic is, who is doing the work,
where the bottlenecks are. It is **not** the queue and not a day-to-day working screen.

**Where the numbers come from.** Operation reads visits, appointments and invoices that other parts of
Kuwick already recorded. It does not recalculate Finance, Payroll, Panel or Stock, and it cannot change
anything — every screen here is read-only.

### The screens

| Screen | What it answers | Watch out for |
| --- | --- | --- |
| **Overview** | How many visits and patients, new vs returning, where they came from, busiest hour, activity by day, doctor productivity | "Revenue" here is **billed value of the visits in this period** — see the box below |
| **Segment P&L** | Profit and loss by service segment | Revenue that cannot be mapped to a segment is shown as *unmapped* rather than hidden |
| **Programmes** | Care programmes and enrolment | |
| **Marketing** | Audience, templates, dispatch history | Kuwick prepares messages; it does not send them for you |
| **Patient Analysis** | New vs returning, patient mix | |
| **Procedure Analysis** | Which services and procedures are being done | |
| **Doctor Performance** | Visits and billed value per doctor | Deliberately **not** a league table — read the note below |
| **Waiting Times** | How long patients waited | Shows its **coverage**: if only some visits have queue timings, it says so |

> **"Revenue" in Operation is not the same number as Finance's sales, and both are right.**
>
> Operation asks *"what did the work we did this month bill?"* — every invoice raised on this month's
> visits, cancelled ones excluded, dated by the **visit**.
> Finance asks *"what money came in?"* — invoices that are **paid**, dated by the **payment**.
>
> In the UAT clinic for September these are RM1,114.50 and RM1,116.10. Neither is wrong; a visit near the
> month boundary, or one still unpaid, lands in one and not the other. If you need "what did we earn",
> use Finance. If you need "how much work did we do", use Operation.

> **Doctor Performance does not rank doctors.** The screen states it in its own words: *"Billed under
> doctor is the value of invoices raised on visits this doctor attended. It is NOT the doctor's income,
> NOT their commission, and includes charges (medication, procedures, panel share) they do not personally
> earn."* Treat it as workload, not merit.

<a name="operation-tests"></a>
### Operation tests

| ID | Do this | You should see | Check |
| --- | --- | --- | --- |
| **O-01** | Administration → Operation → Overview, period **This month** | Visits, Patients, Revenue, Panel portion, Average bill, Average wait | New + returning equals total patients |
| **O-02** | Change the period to **Today**, then **This quarter** | Every figure changes together | No figure stays frozen while others move |
| **O-03** | Change the branch selector from *All branches* to **Contoh Central**, then **Contoh Bandar** | The figures change for each branch | The two branches' visits add up to the all-branches figure |
| **O-04** | Read the *Average wait* tile | A figure **and** its coverage, or a dash with "from 0 visits (0%)" | It never shows an average without telling you how much data it rests on |
| **O-05** | Open **Doctor Performance** | Visits and billed value per doctor, with the explanatory note | The note about billed ≠ income is present |
| **O-06** | Open **Waiting Times** | Wait indicators with their sample size | If there is no queue data it says so rather than showing zero |
| **O-07** | Open **Patient Analysis** and **Procedure Analysis** | Populated tables | Totals agree with the Overview for the same period |
| **O-08** | Compare Operation's Revenue with Finance → Sales for the same month | Two different figures | You can explain the difference using the box above — this is a **pass** |

---

## 5 · Stock

**What it is for.** Everything the clinic holds: what is on the shelf, what it cost, what is expiring,
what needs ordering, and every movement in and out.

**The one rule that matters.** Every quantity change is a **movement** with a cause. Stock levels are the
running total of movements — never typed in directly. When a doctor dispenses a medicine during a
consultation, that reduces stock **exactly once**, automatically.

### The screens

| Screen | What it is for |
| --- | --- |
| **What needs attention** | The exception board: negative stock, below minimum, expired batches, near expiry, slow movers |
| **Items & Pricing** | The item master — name, code, unit, cost, price, reorder level |
| **Stock by Location** | What each branch holds |
| **Transfers** | Moving stock between branches |
| **Purchase Orders** | Ordering from suppliers, and receiving against the order |
| **Procurement Requests** | A branch asking for stock before a PO exists |
| **New Item Requests** | Asking for an item that is not in the catalogue yet |
| **Suppliers** | Supplier master and terms |
| **Stock Take** | Counting the shelf and recording the variance |
| **Movement Ledger** | Every movement, with its cause and reference |
| **Near Expiry** / **Slow Moving** / **Stock Value** | Three questions an owner asks separately |

### The ordering flow, in order

1. **Procurement Request** — a branch says what it needs (optional; you may go straight to a PO).
2. **Purchase Order** — you order from a supplier. Nothing changes on the shelf yet.
3. **Goods Receipt** — you record what actually arrived, with batch numbers and expiry dates. **This is
   the moment stock increases**, and the moment a supplier payable appears in Finance.
4. **Dispensing** — a consultation reduces stock automatically.
5. **Stock Take** — you count, and the difference is recorded as a variance with a reason.
6. **Adjustment / wastage / expiry write-off** — a deliberate change, always with a reason.

> **What Stock Value does and does not claim.** The screen says it itself: stock is valued at *each item's
> current cost price × quantity on hand*. **Weighted-average and FIFO costing are not implemented, and the
> figure does not claim to be either.** It also shows *Potential self-pay value* — what the stock would
> fetch if every unit sold at the cash price — which is explicitly **not profit and not a forecast**.

<a name="stock-tests"></a>
### Stock tests

| ID | Do this | You should see | Check |
| --- | --- | --- | --- |
| **STK-01** | Stock → What needs attention | An exception board with a view selector | Each view either lists rows or says nothing needs attention |
| **STK-02** | Choose **Slow Moving** | Six rows, including *Discontinued Cough Syrup* **twice** — once per branch | Each row names its **branch** and its own quantity (18 at Central, 10 at Bandar). Two rows for one item across two branches is correct |
| **STK-03** | Stock → Items & Pricing | The item master with unit, cost, price | An item with no cost is flagged rather than silently valued at zero |
| **STK-04** | Stock → Movement Ledger | Every movement with type, quantity (signed), and what caused it | No movement exists without a cause |
| **STK-05** | Filter the ledger to **DISPENSED** | Dispensing rows, each negative, each naming its prescription | One prescription line produces exactly one movement |
| **STK-06** | Stock → Purchase Orders → open one | The ordered quantity and what has been received | An unreceived PO has **not** changed stock |
| **STK-07** | Stock → Stock Take | Past counts with their variances | A variance is recorded, not silently corrected |
| **STK-08** | Stock → Near Expiry | Batches with their expiry dates | Sorted so the soonest expiry is actionable (FEFO) |
| **STK-09** | Stock → Stock Value | Total at cost, potential self-pay value, items without a cost | The costing-method note is present and honest |
| **STK-10** | Change branch to Contoh Central | Stock figures change | Branch filtering is real |

---

## 6 · Panel

**What it is for.** Panel companies (insurers, employers, managed-care) that pay for their members'
visits. Panel tracks what you claimed, what they approved, what they actually paid, and what is still owed.

### The five words that matter

Read this once and the whole module makes sense.

| Word | Meaning | UAT clinic |
| --- | --- | --- |
| **Claimed** | What you asked the panel for | RM1,130.00 |
| **Panel fee** | The panel's own charge for handling the claim | RM67.20 across the claims |
| **Expected receivable** | What you should actually get, after the fee is applied | RM1,072.80 |
| **Approved** | What the panel agreed to pay | RM410.40 |
| **Received** | Money actually in the bank | RM350.40 |
| **Outstanding** | Still owed to you | RM439.20 |

### Fee direction — the part that catches people out

A panel fee can work in two opposite directions, and getting it backwards changes what you are owed.

| Treatment | What it means | The sum |
| --- | --- | --- |
| **Withheld from claim** | The panel keeps its fee out of what it pays you | claimed − fee = expected receivable |
| **Added to receivable** | The fee is charged on top, and you receive more | claimed + fee = expected receivable |
| **No fee** | This panel charges nothing | claimed = expected receivable |
| **Unconfigured** | Nobody has told Kuwick which of the above applies | **Kuwick applies nothing and says so** |

> **Unconfigured is a real state, not a mistake to hide.** In the UAT clinic two claims have an
> unconfigured fee treatment, worth RM10.00 between them. Kuwick counts that RM10.00 as fees *at stake* but
> **does not apply it** to your expected receivable, and flags the two claims. Guessing a direction would
> silently change what you think you are owed. Configure the panel and the figure resolves.

### The claim life-cycle

Panel master → fee configuration → **claim created** from a panel visit → gathered into a **batch** →
you submit it at the panel's own portal → you **record that you submitted it** → the panel responds:
**approved**, **rejected**, or partially → a rejection can be **resubmitted** or **charged to the patient**
or **written off** → money arrives and is **allocated** to claims → what is left is **outstanding** and ages.

> **Kuwick does not submit claims electronically.** There is no connection to any panel's system. You
> submit at the panel's own portal exactly as you do today, and then record in Kuwick that you did, with
> the reference. Everything Kuwick shows about submission is a record of what a person did, never a claim
> that a computer did it.

<a name="panel-tests"></a>
### Panel tests

| ID | Do this | You should see | Check |
| --- | --- | --- | --- |
| **PNL-01** | Panel → Claim workspace | Work queue, awaiting payment, and the reconciliation totals | The five words above all appear with figures |
| **PNL-02** | Read the reconciliation totals | Claimed 1,130.00 · expected 1,072.80 · received 350.40 · outstanding 439.20 | received + outstanding + rejected + written off = expected + over-recovered |
| **PNL-03** | Panel → Panel configuration | Each panel's fee treatment | At least one **Unconfigured**, and it is visibly flagged |
| **PNL-04** | Find the unresolved fee-treatment count | 2 claims | Their fees are **not** included in expected receivable |
| **PNL-05** | Open a rejected claim → timeline | Every state change with who and when | A rejection carries its reason category |
| **PNL-06** | Resubmit a rejected claim | The claim returns to the submission queue | The original rejection stays in the timeline — history is not erased |
| **PNL-07** | Panel → Claim batches | Batches with their submission record | A batch marked submitted shows **who** recorded it and **when** |
| **PNL-08** | Record a receipt against an outstanding claim | Outstanding falls by exactly what you allocated | The totals still balance after |
| **PNL-09** | Panel → Panel companies | The panel master | |
| **PNL-10** | Compare Panel outstanding with Finance → Panel money | Finance shows the same position | Finance is reading Panel's figure, not its own |

---

## 7 · HR

**What it is for.** The people side: who works here, when they worked, what they are owed, and what feeds
Payroll.

### The screens, and which of them reach Payroll

| Screen | What it is for | Reaches Payroll? |
| --- | --- | --- |
| **Today** | The day at a glance — who is in, who is on leave | No |
| **Employees** | The employee record: employment, salary, statutory standing, tax, documents | **Yes** — salary and statutory standing decide every figure |
| **Timesheets** | Attendance, hours, overtime | **Yes** — approved overtime is paid; unapproved is not |
| **Leave** | Leave requests and balances | **Yes** — unpaid leave reduces the month's wages |
| **Claims** | Staff expense claims | **Yes** — if the claim's payment route is payroll |
| **Roster** | Who is scheduled | No (planning) |
| **Doctor incentives** | Incentive runs for doctors | **Yes** — an approved incentive becomes a payroll input |
| **Locum sessions** | Sessions worked by locums | **Yes** — a settled session becomes a payroll input |
| **Staff benefits** | Benefit accounts and usage | No |
| **Reports** | The payroll report catalogue | No (read-only) |
| **Payroll settings** | Components, schedules, approval policy | Configuration |

> **The employee directory has no salary column, deliberately.** Pay is behind a separate permission from
> "can see HR". Someone who manages employee records cannot necessarily see what anybody earns, and cannot
> set a salary either.

> **Unapproved overtime is shown separately and is not paid.** A long day is not automatically overtime.
> The timesheet shows approved and unapproved overtime in two columns so nobody is paid for hours that
> were never agreed — and payroll warns you if unapproved hours exist when you run it.

### Two people use HR, and they use two different products

Everything above is the **owner/manager** side, inside Administration. There is a second half, and it is the
one most of your staff will ever see.

<a name="my-kuwick"></a>
#### My Kuwick — what a member of staff gets

Any member of staff who can sign in has **My Kuwick** at `/my`, reachable from the menu under their own name.
It is designed for a phone, because that is where it is used: clocking in at the door, photographing a
receipt in a car park, checking next week's shift on a bus.

| Screen | What they can do |
| --- | --- |
| **Home** | One big **Clock in / Clock out** button, today's shift, what is waiting on somebody else, their latest payslip |
| **My schedule** | Their own shifts, month by month, read from the one roster. **Read-only** — the roster is written by whoever manages it |
| **My attendance** | What the clock recorded against what they were rostered for, and **Ask for a fix** when a punch is wrong |
| **My leave** | Request leave, and see what was decided |
| **My claims** | Submit a claim with a receipt from the phone camera, and read in plain words where the money is |
| **My payslips** | Their own payslips, **approved months only** |
| **My profile** | Who Kuwick thinks they are. No salary on it |

> **Three things My Kuwick will not do, on purpose.**
> An employee cannot edit their own attendance — they *ask*, and a manager decides, and the original punch
> stays on the record. An employee cannot see a payslip for a month that is still being worked on, because
> the figures in it can still change. And an employee cannot see anybody else's anything: there is no screen,
> no field and no URL through which one member of staff can reach another's hours, leave, claims or pay.

#### Adding somebody, and the staff who never got finished

**HR → Employees → + Add Employee** is four steps: the person, their employment, whether they get a login,
and a review. Only the first step is required; the rest can be finished later from their own page.

Two things it deliberately does not ask for. **Salary** and the **Malaysian statutory profile** (EPF, SOCSO,
EIS, PCB, LINDUNG) are recorded *with the date they take effect from*, and the form has no such date to give
them — putting a salary box there would mean inventing "from today", and the employee record and the payroll
run would then disagree about what somebody is paid. Both are on the employee's own page once they exist.

If any staff record has no employment profile, a warning at the top of **Employees** names those people and
clicking any of them opens the form that finishes them. Those people can sign in and be rostered; payroll
leaves them out — not with a refusal, simply absent, which is much harder to notice.

#### The roster holds everybody, not only the doctors

**HR → Roster** is the same board the Appointments calendar books against. It now carries the whole
workforce, with a filter across the top — **Everyone / Doctors / Clinical / Admin / Finance / Other** — and
every chip carries its count, so choosing one does not make the rest look empty.

A receptionist's shift is a real shift and **not** appointment capacity: only staff who are registered
providers can be booked into. A 23:00–07:00 night shift is **one** shift on the day it starts, marked as
crossing midnight, and two shifts in one day are two entries in one cell.

#### How lateness and overtime are actually decided

Under **HR → Payroll settings** the clinic sets its own attendance rules: the grace before an arrival counts
as late, the minimum extra time before it is even an overtime candidate, how overtime rounds, whether early
arrival counts, and unpaid breaks. A twenty-four-hour clinic and a nine-to-five practice do not agree about
when 09:06 is late, and neither is wrong. A group sets a default; a branch can override it.

Three rules hold whatever those settings are:

- **Extra time is not overtime** until a manager approves it, and never your own.
- **Short time is never deducted automatically.** Leaving at 16:30 on a 17:00 shift raises an exception for a
  manager to resolve; the system cannot know whether it was approved early release, half-day leave or unpaid
  time, and guessing costs somebody real money.
- **Attendance never invents an expected shift.** It reads the roster and never writes back to it.

<a name="hr-tests"></a>
### HR tests

| ID | Do this | You should see | Check |
| --- | --- | --- | --- |
| **HR-01** | HR → Employees | The directory | **No salary column** |
| **HR-02** | Open an employee | Tabs: Overview, Employment, Salary, Attendance, Leave, Claims, Payroll, Tax, Documents | "Last paid" reads only an **approved** month |
| **HR-03** | Employee → Salary | Dated rates, each with reason and author | A new rate closes the old one rather than overwriting it |
| **HR-04** | Employee → Employment → statutory standing | EPF membership, SOCSO/EIS, LINDUNG, tax residence, MTD category, rest day | Facts nobody entered read **"Not recorded"**, never "No" or "0" |
| **HR-05** | HR → Timesheets | Approved and unapproved overtime in separate columns | The note "a long day is not automatically overtime" is present |
| **HR-06** | HR → Leave | Requests and balances | |
| **HR-07** | HR → Claims | Staff claims with their approval state and payment route | An approved claim names how it will be paid |
| **HR-08** | HR → Doctor incentives | The incentive run and its results | A **paid** incentive is never recalculated with today's rules |
| **HR-09** | HR → Locum sessions | Sessions with their rate and settlement | |
| **HR-10** | Sign in as `finance@…` and open HR → Employees | You can see the directory | You **cannot** see anybody's salary |
| **HR-11** | HR → Employees → **+ Add Employee**, complete the four steps without a login | The person appears in the directory | The review step says salary and statutory details are recorded separately, *with the date they take effect from* |
| **HR-12** | Add another, this time switching on **Give them a login** | They appear, and can sign in with the password you set | An email with no password is refused rather than half-created |
| **HR-13** | HR → Today | Five counts across the top and five tiles under *Waiting for a decision* | **Every tile opens the work** — click one and you land on the queue it counts |
| **HR-14** | HR → Today, before the morning shift has clocked in | *Rostered, not clocked in* | Somebody whose shift has not started yet reads "Not due yet", not as missing |
| **HR-15** | HR → Roster, choose **Everyone**, then **Doctors** | The board narrows | Every chip still shows its own count — the others do not read as empty |
| **HR-15a** | HR → Roster with the branch picker on **All branches** | *"A roster belongs to one branch"* and the branches as buttons | Choosing one on the board draws it — you are not sent back to the header to hunt for the picker |
| **HR-15b** | HR → Roster, in the current month | The board opens on **today**, whose column carries a dark date pill | Today is **fully** visible, not half-hidden under the Provider column on the left |
| **HR-16** | HR → Roster, look at the night nurse | 23:00–07:00 shifts | **One** entry per night, marked as crossing midnight — not two half-shifts on two days |
| **HR-17** | HR → Timesheets | *Attendance fixes requested* at the top, if any | Approving one keeps the original punch on the record and names you as the approver |
| **HR-18** | HR → Payroll settings → *Attendance rules* | Seven numbers, two switches, and a tag saying whose rules are in force | Change *Late after*, save, reload — the new value is still there |
| **HR-19** | HR-18, then switch *Rules for* to one branch | The branch inherits until you save it | Saving a branch changes that branch only; the other one still reads the group default |

<a name="employee-tests"></a>
### Employee tests — sign in as a member of staff

Sign in as `nurse@hr-uat.kuwick.invalid` (password `HrUat!2026`) — or any staff account — and go to **My
Kuwick** from the menu under your name. Best done on a phone, or with the browser window narrowed.

| ID | Do this | You should see | Check |
| --- | --- | --- | --- |
| **ESS-01** | Open My Kuwick | Your name, your branch, today's shift | **No** Administration rail, branch picker or patient list |
| **ESS-02** | Tap **Clock in**, then **Clock out** | The card changes to "On duty · Since HH:MM", then back | The times are the **clinic's**, not your device's |
| **ESS-03** | My schedule → previous and next month | Your shifts, grouped by day | A 23:00 shift says "(next morning)" rather than looking like a typo |
| **ESS-04** | My attendance → **Ask for a fix** on a day with a missing punch | A form asking what the times should have been and why | It says nothing changes until a manager decides |
| **ESS-05** | As the manager, HR → Timesheets, approve that fix | The attendance record updates | The **original** punch is still on the record, and you are named as approver |
| **ESS-06** | My leave → **Request leave**, choose **Unpaid** | A note that unpaid leave is deducted for the days approved | It appears in HR → Leave for the manager — the same record, not a copy |
| **ESS-07** | My claims → **New claim**, attach a photo | The claim appears reading *"Waiting for your manager."* | Plain words, not "SUBMITTED / payoutStatus PENDING" |
| **ESS-08** | As the manager, approve it **Pay with salary** | The employee's screen reads *"Approved. It will be paid with your salary."* | It appears **once** in payroll and Finance never reimburses it separately |
| **ESS-09** | My payslips, while September is still open | *"No payslip yet"* and an explanation | A month being worked on is **not** shown — its figures can still change |
| **ESS-10** | Sign in as a **second** member of staff | Only their own schedule, leave, claims and payslips | Nothing of the first person's is reachable — not by any screen, field or URL |

---

## 8 · Payroll

Payroll is the most detailed part of Kuwick and the part where a mistake costs the most, so this section is
long. It sits under **HR → Payroll**.

Payroll has been through its own separate validation programme; its full evidence pack is
`docs/payroll-final-uat/` (46 screens) and its record is
`docs/MALAYSIA_PAYROLL_FINAL_VALIDATION.md`.

### A · One-time setup

Everything in [section 3](#3-first-time-setup) steps 1, 4, 5, 6 and 7 is payroll setup. In addition:

| Setting | What it means | If left blank | Blocking? |
| --- | --- | --- | --- |
| **EPF membership** | Whether the person is an EPF member and their citizenship, which the Act turns on | Kuwick cannot choose an EPF table | **Blocks** |
| **Date of birth** | EPF, SOCSO and EIS all change at 60 | Every statutory figure would be a guess | **Blocks** |
| **LINDUNG 24 JAM** | Whether they joined the scheme (voluntary for locals, mandatory for foreign workers) | Kuwick will not assume either way | **Blocks**, from 1 June 2026 onward |
| **Tax residence + MTD category** | Which PCB table applies | PCB cannot be calculated — but you may type the figure in by hand instead | **Blocks** until one or the other |
| **Qualifying children, disability** | MTD reliefs | Read as **not recorded**, not as zero | Advisory |
| **Bank account** | Where the pay goes | They cannot appear on a payment listing | Advisory |
| **EPF contribution basis** | Which of their wages EPF is contributed on — see D below | Everything the law makes liable | Advisory |
| **Opening / YTD balances** | What was already paid and taxed this year, if you start mid-year | Monthly tax is computed as though every month were January, and is wrong all year | Advisory but important |
| **TP1 / TP3** | Employee-declared reliefs, and previous employment in the same year | Tax is over-deducted | Advisory |
| **Approval policy** | One approver, or two | Defaults apply | — |

### B · The monthly workflow

```
Attendance & leave  →  Overtime approved  →  Claims  →  Incentives  →  Locum
        ↓
   Get ready (readiness)  →  Run payroll  →  Exceptions  →  Review
        ↓
   Approve  →  Snapshot frozen  →  Payslips  →  Record payment  →  Statutory listings  →  Reports
```

**Step by step:**

1. **Get ready** (`HR → Payroll → Get ready`). Before creating a run, this lists every employee and what is
   missing for them. Fix things here and the run starts clean.
2. **Run payroll.** Kuwick calculates every payslip from the records — never from figures typed into the
   run.
3. **Exceptions.** Anything that could not be worked out, or that is worth knowing, appears here with the
   person's name, what it means, what happens if you ignore it, and how to fix it. **Blocking** items stop
   approval; **warnings** do not.
4. **Review the six steps** — Employees, Attendance & leave, Earnings, Deductions, Review, Approve.
5. **Approve.** The figures freeze into a sealed, hashed record. This is the moment the month becomes a
   fact.
6. **Payslips** are issued from that frozen record, never from figures that can still move.
7. **Record the payment** — see G below.
8. **Statutory listings** — see H below.

### C · Additional income

Pay is always itemised. The earnings side reads:

```
Basic salary                     RM3,200.00
Fixed monthly allowance            RM250.00
Overtime                            RM70.00
Procedure incentive                RM300.00
Commission                         RM300.00
Locum                              RM680.00
Bonus                                    —
----------------------------------------------
Total earnings                   RM4,800.00
```

Each row keeps its own type, description, amount, source, the period it was earned in, its approval record
where it had one, its statutory classification and its history. Kuwick never collapses them into "other
income", because a lump sum cannot be checked and cannot be taxed correctly.

Most rows arrive automatically: overtime from the approved timesheet, incentives from the incentive run,
locum from settled sessions, unpaid leave from the leave record. You can add one by hand where it has no
upstream source, and the payslip will say it was entered by hand.

### D · The EPF contribution basis

This is the one place where you, the owner, deliberately choose something the law would otherwise decide.

**Two separate things, kept separate:**

- **Kuwick's statutory assessment** — which of the wages the EPF Act makes contributable. Decided per pay
  component, dated, with a source. You do not change this per employee.
- **Your selected contribution basis** — which of those wages you have chosen to contribute on.

**Your three choices**, per employee, effective from a date, with a reason and your name on it:

1. **Basic salary only**
2. **Basic + selected additional income** (tick the components)
3. **All applicable earnings** — the default, and what every employee has unless you choose otherwise

**A worked example from the UAT clinic** (Nurul Hidayah, August 2026):

| | Amount |
| --- | --- |
| Basic salary | RM3,200.00 |
| Fixed monthly allowance | RM250.00 |
| **Total earnings (gross)** | **RM3,450.00** |
| Kuwick's assessed EPF wages | RM3,450.00 |
| **Owner-selected basis: basic salary only** | **RM3,200.00** |
| Difference | RM250.00 |
| EPF employee (on RM3,200) | RM352.00 |
| EPF employer (on RM3,200) | RM416.00 |

Kuwick calculates on **your** figure, RM3,200.

**Warning, not blocking.** Because you chose it deliberately, payroll continues — you can review, approve
and finalise the month. What Kuwick will not do is call it correct. The advisory on the run reads:

> Gross earnings RM3450.00. Kuwick assesses EPF wages of RM3450.00; the employer-selected contribution
> basis is RM3200.00, a difference of RM250.00 — excluding Fixed monthly allowance RM250.00. Selected from
> 2026-08-01 by Dr Aisyah Rahman: "…". Both the employee's share and the clinic's are calculated on the
> selected basis, so they are lower than Kuwick assesses as due. This is the employer's decision and it is
> recorded as one: Kuwick does not treat it as meeting the Act, and any shortfall against the Act stays the
> employer's to make good.

The run's own gate says: **"3 warning(s) noted; none of them prevents approval."**

**A tick cannot add what the law excludes.** Overtime is outside EPF wages by the Act. If you tick it, the
basis does not grow — Kuwick tells you the tick did nothing rather than silently ignoring it.

**The difference is kept for ever.** The approved record freezes the mode, which components were included,
Kuwick's assessment, your basis, the difference, and who chose it when and why. The EPF filing listing
flags the affected row, so whoever keys it into KWSP can see that the wages figure is a decision.

### E · Exceptions — what blocks and what does not

| Exception | Means | Fix | Can payroll continue? |
| --- | --- | --- | --- |
| Salary setup is incomplete | No salary on file for the month | Record the salary | **No** |
| Date of birth is missing | Age decides EPF/SOCSO/EIS | Add the DOB | **No** |
| No employing company | Nothing could be filed for them | Assign the company | **No** |
| Monthly tax (PCB) is missing | No tax profile, and no figure typed | Record the profile, type the figure, or record them as not paying PCB | **No** |
| Statutory figure unknown | A contribution could not be worked out | Complete the standing | **No** |
| Salary / statutory / EPF-basis changed mid-period | Two answers would both look right | Date the change to the 1st of a month | **No** |
| Unknown pay component | An input names a component with no treatment | Fix the component or the input | **No** |
| Deductions exceed earnings | Net pay would be negative | Reduce or spread the deduction | **No** |
| **EPF basis below the assessment** | You chose a lower basis deliberately | Nothing required | **Yes — warning** |
| Unapproved overtime | Hours clocked but not approved | Approve or reject on the timesheet | **Yes — warning** |
| Missing clock-in/out | Incomplete hours | Correct the timesheet | **Yes — warning** |
| HRD registration not recorded | The levy cannot be included in employer cost | Record the registration class | **Yes — warning** |
| Employee in no branch | They are in no branch's run | Set a home branch, or run all branches | **Yes — warning** |

The rule behind the rule: **a deliberate decision warns; an unknown fact blocks.**

### F · Reopen and correction

An approved month can be **reopened** to correct it. When you do:

- the approvals are cleared — anybody who signed is asked to sign again;
- **revision 1 stays exactly as it was**, and keeps serving payslips and statutory listings until you
  approve again;
- every run report carries a banner saying these are candidate figures while an approved record stands;
- approving again creates **revision 2** beside revision 1. Nothing is overwritten, everything is dated.

A month that has been **paid** cannot be reopened — money has left, and a correction after that is an
adjustment, on the record.

### G · Payment — what "paid" actually means

Kuwick is deliberately careful with this word. There are three rungs:

| Rung | What it means | What Kuwick did |
| --- | --- | --- |
| **Listing prepared** | A list of who gets paid what exists | Kuwick produced it |
| **Listing downloaded** | Somebody took it to the bank | Kuwick recorded that it left |
| **Payment recorded** | A person states the transfer was made, with the date and the bank's reference | Kuwick recorded **their statement** |

> **Kuwick does not pay anybody.** There is no bank connection. The listing is for keying or cross-checking
> at your own bank, and it says so on its face. "Paid" appears only after a person recorded the actual
> transfer with its reference.

### H · Statutory — what Kuwick calculates, and what it never submits

| Scheme | Kuwick calculates | Kuwick prepares | Kuwick submits |
| --- | --- | --- | --- |
| **EPF (KWSP)** | Yes — Third Schedule, by Part and age | A listing per employee | **No** |
| **SOCSO (PERKESO)** | Yes — Act 4, by category and age | A listing | **No** |
| **EIS / SIP** | Yes — Act 800 | A listing | **No** |
| **LINDUNG 24 JAM** | Yes — from 1 June 2026, phase 1 | A listing | **No** |
| **PCB / MTD (LHDN)** | Yes — HASiL's Computerised Calculation, cumulative | A summary | **No** |
| **HRD Corp levy** | Yes — 1% (s.14) or 0.5% (s.15) | Employer cost only | **No** |

You file at each authority's own portal, then record in Kuwick that you did, with the reference. Only then
does a scheme read as filed.

### I · Payroll reports

| Report | When you use it |
| --- | --- |
| Payroll register | The month, person by person, every column |
| Cost to the clinic | What the month cost — wages plus employer contributions and the levy |
| Statutory totals | What each scheme is owed, for checking before filing |
| Monthly tax (PCB) summary | Tax per person, showing whether it was calculated or entered |
| Year to date | The cumulative position, with previous-employment money listed apart |
| Overtime | Day by day, naming the Employment Act provision that priced each |
| Unpaid leave | Absence as a wage reduction — deliberately no deductions column |
| Payment status | Where the money stands, in the language above |
| Payroll history and corrections | What was reopened, corrected and re-approved |

<a name="pay-tests"></a>
### Payroll tests

| ID | Do this | You should see | Check |
| --- | --- | --- | --- |
| **PAY-01** | HR → Payroll | The month, and what it needs before anybody is paid | Last month's figure is labelled if it is not approved |
| **PAY-02** | Payroll → **Get ready** | Per-employee checklists | 4 people blocked, for two different reasons, each named |
| **PAY-03** | Open the August run → **Review** | The exception centre | 4 blocking items; approval is impossible |
| **PAY-04** | Read one blocking exception | Person, cause, consequence, what to do, and a link that works | The link lands on the right screen |
| **PAY-05** | Employee → statutory standing of a blocked person | Relief facts read **"Not recorded"** | Never "0" or "No" for something nobody entered |
| **PAY-06** | Fix the blockers the way the exceptions say, then recalculate | The blockers clear | Nothing else changed silently |
| **PAY-07** | Walk steps 1–4 (Employees, Attendance, Earnings, Deductions) | Every earning itemised; EPF/SOCSO/EIS/LINDUNG/PCB shown apart | Total earnings = the sum of its rows |
| **PAY-08** | Look at Hafiz Osman (age 60+) | EPF employee RM0.00, employer still contributing; **no EIS** | The age cliff is real, not a rate tweak |
| **PAY-09** | Approve the run | A frozen, hashed record with the approver and time | The status becomes Approved |
| **PAY-10** | Open a payslip | Earnings itemised, deductions itemised, net pay | It says which approved revision it came from |
| **PAY-11** | Payment → prepare the listing | A listing exists, saying it is **not** a bank file | Nothing says "paid" |
| **PAY-12** | Record the transfer with a date and reference | Only now does it read paid | The person who recorded it is named |
| **PAY-13** | Statutory listings | Per-scheme figures, each schedule named | Everything reads "not filed — prepared only" |
| **PAY-14** | Record the EPF filing with a reference | EPF reads filed, with its date | Other schemes are unchanged |
| **PAY-15** | Reopen the month with a reason | Back at review; revision 1 still serves payslips | Reports carry the candidate-figures banner |
| **PAY-16** | Recalculate and approve again | Revision 2 exists beside revision 1 | Neither is overwritten |
| **PAY-17** | Employee → Salary → EPF contribution basis | The selection, since when, by whom, and why | |
| **PAY-18** | Set a basis of **Basic salary only** for someone with an allowance, from the 1st, with a reason | It saves, and says it is not treating this as meeting the Act | |
| **PAY-19** | Recalculate | EPF drops to the selected basis; an **advisory** appears naming gross, assessment, selection, difference, component, date, and who chose it | The gate says warnings do not prevent approval |
| **PAY-20** | Approve that month | It approves | A deliberate difference does not block |
| **PAY-21** | Statutory listings → EPF | The affected row is flagged with the selected basis and the assessment | |
| **PAY-22** | Tick **overtime** into an EPF basis | The basis does not grow | Kuwick says the tick added nothing |
| **PAY-23** | Try to set a basis effective inside an already-approved month | Refused, with the reason | Approved history cannot be repriced |
| **PAY-24** | HR → Reports → each report | Every report populated | Figures agree with the run |
| **PAY-25** | Sign in as `finance@…`, open HR → Payroll | Refused or pay hidden | Payroll is not visible to finance staff |

---

## 9 · Finance

**What it is for.** The money: what you billed, what you collected, what is still owed to you, and what you
owe others.

### Seven words, kept apart

| Word | Meaning |
| --- | --- |
| **Billed** | What you charged, whether or not anyone has paid |
| **Collected** | Money actually received |
| **Receivable** | Billed but not yet collected — owed **to** you |
| **Refunded** | Money given back |
| **Written off** | Given up on, deliberately and on the record |
| **Payable** | Owed **by** you — to suppliers |
| **Paid** | You have actually paid it |

> **Billed is not collected, and the three sales figures do not add up on purpose.** In the UAT clinic,
> Finance → Sales shows billed RM2,131.10, patient-paid RM976.10, and panel-covered RM1,115.00. Those come
> to RM40.00 short of the billed figure — because one invoice was **refunded** by RM40.00. The gap is the
> refund, and the screens are answering three different questions rather than one badly.

### The screens

| Screen | What it answers | Note |
| --- | --- | --- |
| **Overview** | The money position at a glance | |
| **Sales** | What was billed, split cash vs panel | See the box above |
| **Day-end closing** | Counting the drawer and closing the day | **One branch at a time** — see the box below. A closed day can be reopened, with a reason, on the record |
| **Payments** | Every collection and its tender | |
| **Invoices** | The invoice list | |
| **Outstanding** | Patient receivables | |
| **Supplier payables** | What you owe suppliers, from goods received | Comes from Stock's receipts |
| **Panel money** | The panel position | **Read from Panel**, not recalculated |
| **Credit notes** | Credits raised, approved, voided | |
| **Tax / SST** | Tax codes and the tax report | |
| **Profitability** | Revenue against cost | Does **not** include payroll — see below |
| **Inter-company** | Between your companies | States what it does not do, on screen |
| **e-Invoice (LHDN)** | The e-Invoice screen | **Does not submit to MyInvois** — it says so itself |

> **Where Payroll cost appears in Finance — and where it does not.** Payroll publishes an approved,
> verified summary of what each month cost (net pay, employer contributions, the levy) for Finance to
> consume. That contract exists and is correct: with a month approved, it carries that month's figures and
> they match the payroll run to the cent. **But no Finance screen displays it yet.** To see what a month
> cost the clinic today, use HR → Reports → *Cost to the clinic*. This is recorded as a known gap in
> [section 12](#12-support-status).

> **A drawer belongs to one branch; the list of open days belongs to the group.** Finance answers these
> two questions differently and deliberately. **Overview → Days not yet closed** spans every branch you can
> see, and each row names its branch — so a day left open at the *other* clinic cannot hide from you.
> **Day-end closing** counts one physical drawer, so it needs to know whose: on "All branches" it asks you
> to pick one rather than showing you somebody's zeros. The fastest route is Overview → **Close this day**,
> which carries the branch with it.

<a name="finance-tests"></a>
### Finance tests

| ID | Do this | You should see | Check |
| --- | --- | --- | --- |
| **FIN-01** | Finance → Overview | The money position | Figures are populated, not zeroes |
| **FIN-02** | Finance → Sales | Billed, cash, panel, and a daily breakdown | Cash + panel ≠ billed by exactly the RM40.00 refund — this is a **pass** |
| **FIN-03** | Finance → Payments | Collections with their tender (cash, card, QR) | A reversed payment is visible as reversed, not deleted |
| **FIN-04** | Finance → Outstanding | Patient receivables | |
| **FIN-05** | Finance → Panel money | The panel position and its aging | The same outstanding figure Panel shows |
| **FIN-06** | Finance → Supplier payables | What is owed to suppliers | Traceable to goods received in Stock |
| **FIN-07** | Finance → Day-end closing, on "All branches" | A note asking which branch — **not** an error, and **not** a screen of zeros | Choosing a branch in the header loads that branch's drawer, and the branch name appears under the title |
| **FIN-07b** | Finance → Overview → *Days not yet closed* → **Close this day** | The day-end screen for **that row's branch**, on that date | The BRANCH column names each branch; the unreconciled-days tile counts every branch's open days, not just one |
| **FIN-07c** | Count the drawer short, then close | The close is refused until you explain the difference | Reopening a closed day needs a reason, and the reopen is on the record |
| **FIN-08** | Finance → Credit notes | Credit notes and their state | An approved credit note affects what is collectable |
| **FIN-09** | Finance → Profitability | Revenue against cost | It states what it does not include |
| **FIN-10** | Finance → e-Invoice | The screen loads | It states plainly that it does **not** submit to MyInvois |
| **FIN-11** | Finance → Inter-company | The screen loads | It states what stays outside Kuwick |
| **FIN-12** | Change the branch selector | Finance figures change | Branch filtering is real |
| **FIN-13** | Sign in as `finance@…` | Finance is fully usable | HR salary and Payroll are not reachable |

---

## 10 · Cross-module tests

These are the tests that prove the modules are one system rather than five.

| ID | Do this | You should see | Check |
| --- | --- | --- | --- |
| **X-01** | HR → Doctor incentives: note an approved incentive. Open the payroll run for that month → Earnings, find that person | The incentive appears as its **own row**, once | Not twice, and not folded into "other income" |
| **X-02** | Approve a payroll month. Compare HR → Reports → *Cost to the clinic* with the payroll run's own employer-cost total | The same figure | Payroll's approved summary matches its own lines to the cent. *(Note: no Finance screen shows this yet — section 12.)* |
| **X-03** | Panel → record a receipt against an outstanding claim. Then open Finance → Panel money | Outstanding falls by what you allocated, in **both** places | Finance did not compute its own answer |
| **X-04** | Stock → receive goods against a PO. Then Finance → Supplier payables | Stock rises; a payable appears | One receipt, one payable |
| **X-05** | Change the branch selector, then the period, and revisit Operation, Stock, Panel, Finance | Every module's figures respond to both | No module ignores the context |
| **X-06** | Dispense a medicine in a consultation, then Stock → Movement Ledger | **One** negative movement naming that prescription | Never two |
| **X-07** | HR → Timesheets: approve an overtime entry. Recalculate payroll | Overtime appears in earnings, priced by the Employment Act provision | Unapproved hours stay unpaid |

---

## 11 · Master UAT checklist

Print this, or keep it open while you test.

| ID | Module | Scenario | Expected result | Pass | Fail | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| SETUP-01 | Setup | Employing companies exist | Two companies, one deliberately missing filing numbers | ☐ | ☐ | |
| SETUP-02 | Setup | Employer bank account | Last four digits only | ☐ | ☐ | |
| SETUP-03 | Setup | Salary history | Dated rates with reasons | ☐ | ☐ | |
| SETUP-04 | Setup | Pay components | Treatment and verification shown | ☐ | ☐ | |
| SETUP-05 | Setup | Panel fee treatment | Includes an Unconfigured | ☐ | ☐ | |
| O-01 | Operation | Overview populated | Visits, patients, revenue, mix | ☐ | ☐ | |
| O-02 | Operation | Period switching | All figures move together | ☐ | ☐ | |
| O-03 | Operation | Branch switching | Branches sum to all-branches | ☐ | ☐ | |
| O-04 | Operation | Average wait honesty | Shows coverage or a dash | ☐ | ☐ | |
| O-05 | Operation | Doctor performance | Workload, with the "not income" note | ☐ | ☐ | |
| O-06 | Operation | Waiting times | Sample size stated | ☐ | ☐ | |
| O-07 | Operation | Patient/procedure analysis | Agrees with Overview | ☐ | ☐ | |
| O-08 | Operation | Revenue vs Finance sales | Difference explainable | ☐ | ☐ | |
| STK-01 | Stock | Exception board | Lists or says nothing needs attention | ☐ | ☐ | |
| STK-02 | Stock | Slow movers per branch | Same item twice, each naming its branch | ☐ | ☐ | |
| STK-03 | Stock | Item master | Items without cost are flagged | ☐ | ☐ | |
| STK-04 | Stock | Movement ledger | Every movement has a cause | ☐ | ☐ | |
| STK-05 | Stock | Dispensing | One prescription, one movement | ☐ | ☐ | |
| STK-06 | Stock | Purchase orders | Unreceived PO changes nothing | ☐ | ☐ | |
| STK-07 | Stock | Stock take | Variance recorded | ☐ | ☐ | |
| STK-08 | Stock | Near expiry | Soonest first | ☐ | ☐ | |
| STK-09 | Stock | Stock value | Costing method stated honestly | ☐ | ☐ | |
| STK-10 | Stock | Branch filter | Figures change | ☐ | ☐ | |
| PNL-01 | Panel | Claim workspace | The five words with figures | ☐ | ☐ | |
| PNL-02 | Panel | Reconciliation balances | received+outstanding+rejected+written off = expected+over-recovered | ☐ | ☐ | |
| PNL-03 | Panel | Fee treatment | Shown per panel | ☐ | ☐ | |
| PNL-04 | Panel | Unconfigured fees | Not applied; flagged | ☐ | ☐ | |
| PNL-05 | Panel | Claim timeline | Every change, with who and when | ☐ | ☐ | |
| PNL-06 | Panel | Resubmission | History preserved | ☐ | ☐ | |
| PNL-07 | Panel | Batch submission record | Who recorded it, when | ☐ | ☐ | |
| PNL-08 | Panel | Receipt allocation | Outstanding falls correctly | ☐ | ☐ | |
| PNL-09 | Panel | Panel master | Loads | ☐ | ☐ | |
| PNL-10 | Panel | Finance agreement | Same outstanding | ☐ | ☐ | |
| HR-01 | HR | Directory | No salary column | ☐ | ☐ | |
| HR-02 | HR | Employee record | Tabs present; last paid = approved only | ☐ | ☐ | |
| HR-03 | HR | Salary history | Dated, reasoned | ☐ | ☐ | |
| HR-04 | HR | Statutory standing | "Not recorded" where blank | ☐ | ☐ | |
| HR-05 | HR | Timesheets | Approved vs unapproved OT | ☐ | ☐ | |
| HR-06 | HR | Leave | Requests and balances | ☐ | ☐ | |
| HR-07 | HR | Staff claims | Route named | ☐ | ☐ | |
| HR-08 | HR | Incentives | Paid ones never recalculated | ☐ | ☐ | |
| HR-09 | HR | Locum | Sessions and settlement | ☐ | ☐ | |
| HR-10 | HR | Pay confidentiality | Finance cannot see salary | ☐ | ☐ | |
| PAY-01…25 | Payroll | See [section 8](#pay-tests) | | ☐ | ☐ | |
| FIN-01…13 | Finance | See [section 9](#finance-tests) | | ☐ | ☐ | |
| X-01…07 | Cross-module | See [section 10](#10-cross-module-tests) | | ☐ | ☐ | |

---

<a name="12-support-status"></a>
## 12 · What is supported, partly supported, and not yet

Read this before you decide something is broken.

### Operation

| | |
| --- | --- |
| **Supported** | Visits, unique patients, new vs returning, appointment/walk-in mix, busiest hour, activity by day, branch and provider workload, patient and procedure analysis, segment P&L, programmes, marketing preparation, drill-downs and exports |
| **Partially supported** | **Waiting times** — the screens exist and are honest about coverage, but they depend on queue timings being captured; where they are not, coverage reads 0% |
| **Not yet** | No-show / cancellation / reschedule analytics as a dedicated view; bottleneck detection beyond busiest-hour |
| **Do not use yet** | — |

### Stock

| | |
| --- | --- |
| **Supported** | Item master, units, cost and price, per-branch balances, movement ledger, batches and expiry, FEFO-oriented near-expiry, reorder levels, suppliers, procurement requests, purchase orders, goods receipt, transfers, stock takes with variance, adjustments, wastage and expiry write-off, dispensing consumption, valuation, exception board, reports |
| **Partially supported** | **Valuation is standard cost only** — cost price × quantity. Weighted-average and FIFO costing are not implemented and the screen says so |
| **Not yet** | Supplier returns as a first-class flow; landed-cost apportionment |
| **Do not use yet** | — |

### Panel

| | |
| --- | --- |
| **Supported** | Panel master, contracts and price overrides, exclusions, claim creation, batching, submission **recording**, responses, rejection with reason categories, resubmission, charge-to-patient, write-off, expected receivable with fee direction, receipts and allocation, outstanding, aging, reconciliation, imports, reports |
| **Partially supported** | **Unconfigured fee treatment** is deliberately left unapplied and flagged, not guessed |
| **Not yet** | **No electronic submission to any panel.** You submit at the panel's portal and record it here |
| **Do not use yet** | — |

### HR

| | |
| --- | --- |
| **Supported** | Employee master, employment and legal employer, branch, dated salary history, statutory standing with history, attendance and timesheets, overtime approval, leave, staff claims with payment routing, roster, doctor incentives, locum sessions, staff benefits, reports, audit and permissions |
| **Partially supported** | — |
| **Not yet** | — |
| **Do not use yet** | — |

### Payroll

| | |
| --- | --- |
| **Supported** | EPF (Third Schedule by Part and age), SOCSO (Act 4 categories), EIS (Act 800), LINDUNG 24 JAM phase 1 (from 1 June 2026), PCB/MTD by HASiL's Computerised Calculation with cumulative year-to-date, HRD Corp levy (s.14 / s.15), Employment Act overtime and part-month rules, itemised earnings, employer-selected EPF contribution basis, readiness, exceptions, review, approval with sealed hashed snapshots, payslips, the payment honesty ladder, statutory listings with submission recording, thirteen reports, reopen and revision history, full audit |
| **Partially supported** | LINDUNG phases 2 and 3 (phase 1 only); EA First Schedule special work categories; pay-component statutory treatment ships as DRAFT with no verification bar; CP38 directions only via the opening import |
| **Not yet** | Final-pay / termination runs; mid-year employer transfers; **no bank payment file**; **no authority submission files**; no bank-statement import; special MTD schemes (REP, knowledge worker, C-suite) — enter those by hand |
| **Do not use yet** | Do not rely on Kuwick to *submit* anything to KWSP, PERKESO, LHDN or HRD Corp. It prepares; you file |

### Finance

| | |
| --- | --- |
| **Supported** | Overview, sales (cash vs panel), collections and tenders, invoices, patient receivables, day-end closing with counted amounts and audited reopening, credit notes, supplier payables from goods received, panel money consumed from Panel, tax codes and report, profitability, reports |
| **Partially supported** | **Payroll cost is not shown in Finance.** The approved payroll summary exists, is verified, and matches payroll to the cent — but no Finance screen displays it yet. Use HR → Reports → *Cost to the clinic* |
| **Not yet** | **e-Invoice does not submit to LHDN MyInvois**; bank reconciliation; supplier settlement beyond payable recording; inter-company settlement |
| **Do not use yet** | Do not treat the e-Invoice screen as having filed anything |

### Across all of Management

| | |
| --- | --- |
| **Supported** | Tenant isolation, branch scoping, role-based permissions enforced on the server, salary confidentiality, audit logging of consequential reads and writes, append-only history for payroll and money records |
| **Not yet** | — |
| **Note** | Every figure in this UAT clinic is synthetic. Nothing here is real patient, staff, bank or supplier data |

---

## Where the evidence lives

| | |
| --- | --- |
| Management screenshots (43, desktop + iPad) | `docs/management-integrated-uat/` |
| Payroll journey screenshots (46) | `docs/payroll-final-uat/` |
| Payroll validation record | `docs/MALAYSIA_PAYROLL_FINAL_VALIDATION.md` |
| What was converged, and from where | `docs/MANAGEMENT_CONVERGENCE_SOURCE_MAP.md` |
| The integration checkpoint and its verdicts | `docs/MANAGEMENT_INTEGRATION_CHECKPOINT.md` |
