# Kuwick 2.0 — Management User Manual (A–Z)

**Audience:** the clinic owner, practice manager, and senior admin staff of a Malaysian
outpatient clinic. You do not need to be a software person to use this manual.

**Scope:** the **Administration / Management system only** — Operation analytics, Stock
(Inventory), Panel & Claims, HR, Payroll, and Finance. The clinical side of Kuwick
(appointments diary, patient booking, consultation workspace, dispensary counter, queue
screens) is **not** documented here, except where a Management screen depends on facts
those modules create — those dependencies are explained briefly, in place.

**Source of truth:** this manual describes the system **as actually built and deployed**
(the code on `master`, which the Railway UAT deployment tracks), not the original plans.
Where the plans promised something the system does not yet do, this manual says "not yet
implemented" — see Chapter 12 and Appendix A. If this manual and the running system ever
disagree, the running system wins; please report the difference as a documentation defect.

**Companion documents:**
- `MANAGEMENT_FIRST_TIME_SETUP_CHECKLIST.md` — the exact order to set the system up.
- `MANAGEMENT_OWNER_UAT_GUIDE.md` — scripted tests for owner acceptance testing.

---

## Table of contents

1. [Kuwick Management overview](#1-kuwick-management-overview)
2. [Getting in and finding your way](#2-getting-in-and-finding-your-way)
3. [Who can do what — accounts, roles and permissions](#3-who-can-do-what--accounts-roles-and-permissions)
4. [Executive Dashboard](#4-executive-dashboard)
5. [Finance & Sales](#5-finance--sales)
6. [Clinic Operations (Operation analytics)](#6-clinic-operations-operation-analytics)
7. [Inventory (Stock)](#7-inventory-stock)
8. [Panel & Claims](#8-panel--claims)
9. [HR & Incentives](#9-hr--incentives)
10. [Payroll](#10-payroll)
11. [Cross-module consequences every owner should understand](#11-cross-module-consequences-every-owner-should-understand)
12. [What Management does not do yet](#12-what-management-does-not-do-yet)
- [Appendix A — Where the plan and the built system differ](#appendix-a--where-the-plan-and-the-built-system-differ)
- [Appendix B — Glossary](#appendix-b--glossary)

---

## 1. Kuwick Management overview

### 1.1 What Management is

Kuwick has two kinds of screens:

- **Front-of-house screens** where daily work happens: the appointments diary, the queue,
  the doctor's consultation workspace, the dispensary counter, and the billing counter.
  These screens **create facts**: a visit, a prescription, a dispensed medicine, an
  invoice, a payment.
- **Management screens** where you **review, control and act on** those facts: revenue
  reports, stock ordering, panel claims, staff access, leave approvals.

Management is deliberately mostly a *reading and deciding* area. Most numbers you see
there were created somewhere else, by your staff doing their normal work. Very little in
Management is typed in twice.

There is a third area, **Clinic Settings**, for configuration you change a few times a
year (branches, roles, services, consultation tariffs, holidays, queue rooms). It was
split out of Management on purpose so day-to-day review work and set-once configuration
do not share one menu.

### 1.2 The six Management areas (as actually deployed)

When you open **Management**, you see six tabs across the top:

| Tab | What lives there | This manual's chapter |
|---|---|---|
| **Executive Dashboard** | One-page summary: revenue, patients, wait times, doctor leaderboard, panel outstanding | Ch. 4 |
| **Finance & Sales** | Day-End Closing, Sales Analysis, Invoice Listing | Ch. 5 |
| **Clinic Operations** | Patient Analysis, Procedure & Service Analysis, Waiting Times, Doctor Performance | Ch. 6 |
| **HR & Incentives** | Staff, Roster & Availability (a link into Appointments), Attendance, Leave Requests | Ch. 9 |
| **Inventory** | Stock Health, Stock Take, Procurement Requests, Purchase Orders, Items, Suppliers, Drug Movement | Ch. 7 |
| **Panel & Claims** | Panel Companies, Panel Claims | Ch. 8 |

If you were expecting six modules named *Operation, Stock, Panel, HR, Payroll, Finance*:
they map to the tabs above as follows. **Operation** is the "Clinic Operations" reports
tab. **Stock** is "Inventory". **Panel** is "Panel & Claims". **HR** is "HR &
Incentives". **Finance** is "Finance & Sales" plus the billing counter that feeds it.
**Payroll is not built** — see Chapter 10.

### 1.3 How the facts flow into Management

Read this map once; it explains almost every number in the system.

```
Front desk registers a visit (cash or panel)
        │
        ▼
Doctor consults, prescribes, orders procedures ──────────────┐
        │                                                    │
        ▼                                                    ▼
Dispensary dispenses medicine ────────► STOCK goes down      Billing Review prices the bill
   (one stock movement, exactly once,        │               (consultation tariff + item/service
    counted in packs/strips)                 │                prices + panel rules)
                                             │                       │
Purchasing: Purchase Order ► Goods received ►┘                       ▼
   (stock goes up, batch & expiry recorded)              Invoice is PAID at the counter
                                                          │ the cash/panel split is frozen
                                                          │ at this moment
        ┌─────────────────────────────────────────────────┤
        ▼                                                 ▼
FINANCE & SALES reports                          PANEL & CLAIMS
(Day-End, Sales, Invoice Listing —               (each paid panel invoice appears
 all read PAID invoices)                          automatically as "Unclaimed";
                                                  staff batch it, submit it to the
Visits, queue tickets, appointments               panel outside Kuwick, record the
        │                                         panel's answer and the money)
        ▼
CLINIC OPERATIONS reports                        HR facts (staff, leave, holidays)
(patients, procedures, wait times,                feed the appointments roster and
 doctor performance)                              block bookings when someone is away
```

Key one-line dependencies:

- **Clinical dispensing → Stock.** When the dispensary hands out medicine, Kuwick writes
  one stock movement and the shelf count goes down — exactly once, and in *packs*, not
  tablets (Chapter 7.8).
- **Invoice & payment → Finance.** Every ringgit in the Finance & Sales reports comes
  from invoices with status **Paid**, counted on the date they were paid.
- **Paid panel invoice → Panel claim → panel receivable.** A paid invoice with a panel
  portion automatically appears in the Panel Claims worklist; batching, submitting and
  collecting it is Management work (Chapter 8).
- **Visit and appointment facts → Operation analytics.** Patient Analysis and Waiting
  Times read visits and queue tickets; the appointment mix reads the diary.
- **HR leave → the diary.** Approved leave blocks new bookings for that provider.

### 1.4 What is automated versus manual — the honest summary

**Kuwick does automatically:**
- Deducts stock when medicine is dispensed (once, in packs).
- Adds the consultation fee to the bill from your tariff rules (if you configured them).
- Applies panel prices, exclusions, limits and co-payments to split each bill between
  patient and panel.
- Freezes the cash/panel split the moment an invoice is paid, so later configuration
  changes can never rewrite history.
- Lists every settled panel invoice as "Unclaimed" in the claims worklist.
- Adds your configured per-claim fee when you create a claim batch.
- Blocks new bookings on approved leave, and (if switched on per branch) on public
  holidays.
- Aggregates everything into the reports.

**Your staff still do by hand:**
- All purchasing decisions (raising requests, creating purchase orders, receiving goods).
- Stock takes and stock adjustments.
- Choosing which paid invoices go into a claim batch, and when.
- **Submitting claims to the panel — outside Kuwick** (their portal, courier, or email).
  Kuwick only *records* that you submitted, and how. There is **no electronic claim
  submission** of any kind.
- Recording each claim's outcome and the money the panel eventually pays.
- Approving leave and typing in public holidays each year.
- Anything payroll-related — entirely outside Kuwick (Chapter 10).

---

## 2. Getting in and finding your way

### 2.1 Signing in

Go to your clinic's Kuwick web address and sign in at `/login` with your **email address
and password**. One login form serves everybody — clinic staff and the Kuwick platform
operator alike; the system works out which console to show you.

Staff accounts are created by the clinic owner on the **Staff** page (Chapter 9.2).
There is currently **no "forgot password" or password-change screen** — if someone
forgets their password, the owner cannot reset it from the app; contact your Kuwick
support contact. Treat passwords accordingly.

### 2.2 The main navigation

After signing in you land in the everyday area. The top bar shows: **Dashboard**
(which opens the Executive Dashboard), **Appointments**, **Patients**, **Queue**,
**Tasks**, **Roster**, and — for staff allowed to dispense — **Dispensary**. One more
item, **e-Invoice LHDN**, is deliberately greyed out: LHDN e-Invoice submission is not
built yet, and the menu says so rather than hiding the commitment or linking to a dead
page.

**Management** and **Clinic Settings** are reached from the **user menu** in the top bar
(the menu with your account on it). Inside Management, the same user menu offers "Clinic
Settings" and "Back to Main Menu"; inside Settings it offers "Management". The user menu
also shows a small **build** code — the exact version deployed. Quote it when reporting
a problem.

### 2.3 Branch scope — the "Viewing:" label

At the top of Management and Settings you will see **"Viewing: (branch name)"** or
**"Viewing: All Branches"**.

How the branch is chosen:
- A single-branch clinic never has to pick — everything is that branch.
- A staff member whose record has a **Home Clinic** set is locked to that branch.
- An owner/manager account with no home branch in a multi-branch clinic gets a branch
  picker on screens where the branch genuinely matters.

> **Important caution for multi-branch clinics:** on the report pages, only the
> **Executive Dashboard** actually applies a branch filter. Day-End Closing, Sales
> Analysis, Patient Analysis, Procedure Analysis, Doctor Performance, Invoice Listing,
> Drug Movement and Waiting Times always show **the whole company's numbers**, even
> though the "Viewing:" label at the top may name one branch. Do not read a single
> branch's performance off those pages. (Flagged as a defect/spec gap — Appendix A.)

### 2.4 Dates, time and money conventions

- All money is **Malaysian Ringgit (RM)**, two decimal places. There is no
  multi-currency support and no 5-sen cash rounding rule.
- The clinic's timezone is Asia/Kuala_Lumpur (set on each branch).
- **Report-day caution:** the report pages currently group transactions by the
  **international (UTC) calendar day**, which runs 8 hours behind Malaysian time on the
  deployed system. In practice: **a payment taken between midnight and 8:00 in the
  morning appears under the *previous* day** in Day-End Closing and the daily charts,
  and the "Patient Attendance by Hour" chart is shifted (a 9:00 am arrival shows in the
  1:00 am column). A normal daytime clinic will rarely notice; a 24-hour clinic will.
  Treat early-morning figures with this in mind. (Flagged — Appendix A.)
- The date-range presets on reports are **7D / 30D / 90D / This Month / This Year**,
  plus a custom range. "7D" means "today and the 7 days before it" — 8 calendar days.

---

## 3. Who can do what — accounts, roles and permissions

This chapter matters more than any report. Read it before creating staff accounts.

### 3.1 The model in plain words

Every staff member has **one account** (email + password) attached to **one staff
record**. What an account may *do* is decided by **capability roles**, which you tick on
the Staff page's **Access** drawer:

| Capability role | In plain words | Typical person |
|---|---|---|
| **Owner** | Settings, users and roles, billing corrections (discounts, cancelling invoices). **By itself, no clinical authority at all.** | The clinic owner, the practice manager you trust with money |
| **Administrator** (front counter) | Registration, queue, counter billing (raise invoice, take payment), the whole appointments diary | Receptionist / counter staff |
| **Clinical staff** (nurse) | Vitals, allergies, staff remarks, carrying out ordered tasks, dispensing, the diary | Nurse, clinic assistant |
| **Doctor** | The clinical record: notes, diagnoses, prescribing, completing consultations. Also counter billing (for night shifts). | Doctor — **requires a medical registration number on the staff profile first** |

**One person can hold several roles at once.** Dr Aminah who owns the clinic is Owner +
Doctor + Administrator; what she can do is the **union** of everything ticked. This is
the intended design — do not create two accounts for one person.

Two important rules the system enforces:
- **Owner alone is not clinical.** An owner who is not a doctor cannot write notes,
  prescribe, or sign anything clinical — ticking Owner never grants that.
- **Doctor needs a doctor.** The Doctor role cannot be ticked until the person's staff
  profile carries a medical registration (MMC) number, and *signing* clinical notes
  additionally requires the verification and signing switches an owner-admin sets on the
  profile.

On top of roles there are two refinements:

- **Custom roles** (Clinic Settings ▸ Organisation & Branches ▸ Roles & Permissions):
  reusable bundles you name yourself — "Branch Manager", "Locum Coordinator" — built
  from a fixed list of administrative permissions. A custom role can never carry
  clinical authority and never owner powers (that is enforced, not just advised).
- **Individual grants** (on the Access drawer): a single permission given to one named
  person, with a **written reason** the system requires. Only four are grantable this
  way: billing corrections, dispensing, booking-rule override, and roster writing.
  Grants only ever *add*; to take ability away, change the roles.

The system will **refuse to remove the last Owner** — you can never lock the whole
clinic out of Settings.

Older accounts may pre-date this model; they run on their legacy job title (for
example a legacy "FINANCE_STAFF" account can bill and correct billing) until you tick
explicit roles, at which point the ticked roles are the whole answer.

### 3.2 What is actually enforced — an honest statement

The server enforces permissions on the **actions that move money or touch records**:

| Action | Who may do it |
|---|---|
| Raise an invoice, add lines, take payment, classify a visit | Administrator, Doctor, legacy Finance/Panel staff (`billing.counter`) |
| Apply a discount, cancel an invoice | Owner, legacy Finance staff, or a person individually granted `billing.corrections` |
| Verify a panel patient's benefit terms | Owner-admin, front desk, finance |
| **Override** panel benefit terms (a financial correction, reason required) | Owner-admin and finance only |
| Dispense medicine | Doctor, Clinical staff, legacy Stock staff, or an individual grant |
| Create/edit staff, assign roles, create custom roles | Owner (`users.manage`) |
| Change a doctor's professional/signing fields | Only an account whose *job title* is Owner-Admin |
| Clinic settings, service configuration, roster writing, booking-rule override | Owner |

When someone is refused, the screen says **"Your account is not permitted to …"**.
That message is the system working as designed — it is an *intended restriction*, not a
defect. (The UAT guide repeats this rule.)

> **What is NOT gated yet — read this carefully.** Opening the Management and Settings
> menus, and *viewing* every report, is possible for **any signed-in staff member** —
> there is no "reports permission" yet, so a stock clerk's login can technically see
> clinic revenue and doctor performance. The same is true of several *write* actions in
> the back office: adding/editing inventory items, stock adjustments and stock takes,
> raising/approving procurement requests, creating and receiving purchase orders,
> creating/editing panel companies and their price lists, creating/submitting/
> reconciling claim batches, filing and approving leave, and editing public holidays are
> currently controlled **by trust and procedure, not by the software**. Until
> permission-gating reaches those areas (a recorded gap — Appendix A), manage this the
> old-fashioned way: only create logins for people you trust with what a login can
> currently reach, and use the UAT guide's role tests to see the boundary for yourself.

### 3.3 Recommended access for a typical clinic

- **Owner / practice manager:** Owner (+ Doctor if they practise; + Administrator if
  they also work the counter).
- **Receptionist / counter:** Administrator. Add Clinical staff if they also take
  vitals. Give one senior counter person an individual grant of billing corrections if
  you don't want every discount to wait for you.
- **Nurse:** Clinical staff.
- **Doctor / locum:** Doctor (enter their MMC number first; then have the owner-admin
  record verification and enable signing on their profile).
- **Stock / purchasing clerk:** create the account with no capability roles. Today the
  stock screens are reachable regardless (see the caution above); tick nothing so that
  when gating arrives they hold exactly what you choose. Grant `dispense.perform`
  individually only if they genuinely hand out medicine.
- **Claims clerk:** as above; their billing-related power, if any, should be the
  Administrator role or nothing.

---

## 4. Executive Dashboard

**Where:** Management ▸ Executive Dashboard (also the "Dashboard" item in the top bar).
This is Management's landing page.

**What it is for:** a one-page answer to "how is the clinic doing this month?" —
revenue, patients, waiting time, appointment completion, and panel money still owed to
you, with a comparison against the immediately preceding period of the same length.

**Filters:** a date-range bar (default: last 30 days) and — only here, and only for
multi-branch clinics with an unbound login — a branch selector.

**What it shows and where each number comes from:**

| Tile / chart | Meaning | Source |
|---|---|---|
| **Total Revenue** | Sum of all invoices **paid** in the range (patient money + panel billings together) | Paid invoices, by payment date |
| **Patients Seen** | Paid invoices per day, summed | Paid invoices (an invoice ≈ a patient visit) |
| **Avg Wait Time** | Average minutes from joining the queue to being called | Queue tickets |
| **Completed Rate** | % of appointments in the range that ended Completed | Appointments diary |
| **Panel Outstanding** | Money in submitted claim batches not yet fully paid — **always "as of today, all branches"**, ignoring the date range | Panel Claims (same figures as the Outstanding Aging tab) |
| **Revenue Trend** | Two lines per day: **Cash Collected** (money patients actually handed over) and **Panel Owed** (what panels were billed) | Paid invoices |
| **Revenue by Category** donut | Drugs / Services / Consultation / Others split | Invoice lines (see the caution below) |
| **Doctor Performance** leaderboard | Revenue and patient count per doctor; click a row for revenue-per-patient | Paid invoices, by the visit's attending clinician |
| **Waiting & Consultation Time** | Daily average wait and consultation+dispensary minutes | Queue tickets and visit timestamps |
| **Appointments by Status** | Bar per status (Confirmed, Completed, No-show…) | Appointments diary |
| **Panel Claims Outstanding** table | Panel, batch number, status, claimed, outstanding, days outstanding | Claim batches (Submitted / Partially Paid) |

**How to read it — and what not to read into it:**

- Revenue here is **cash-basis**: an invoice raised in June but paid in July counts in
  July. "Panel Owed" is *billed*, not received — the received side lives in Panel &
  Claims.
- The **category split is an estimate by rule**: a line that came from a prescription
  counts as Drugs, from an ordered procedure as Services, a line whose description
  contains the word "consult" as Consultation, everything else as Others. A manual line
  typed as "Dressing set" lands in Others. Treat the donut as indicative, not audited.
- Where discounts are used, the category figures (built from pre-discount line amounts)
  can add up to slightly **more** than Total Revenue (which is post-discount). That is a
  known reporting quirk, not missing money.
- The **doctor leaderboard measures billing, not quality**. It counts invoices whose
  visit named that doctor as attending clinician; visits with no attending doctor appear
  as "Attending clinician not assigned". Do not use it alone for clinical appraisal —
  case mix, panel mix and shift patterns all move these numbers.
- There is **no drill-down**: clicking a number does not open the underlying invoices.
  Use Invoice Listing (Chapter 5.4) to see transactions.

**Actions available:** change the range, pick a branch, click a donut segment to
highlight it, click a leaderboard row, sort the outstanding table. There is no export or
print on this page.

**Empty state:** with no data, tiles show zero and charts say "No data in this range
yet" — a brand-new clinic will look like this until real visits are billed.

---

## 5. Finance & Sales

### 5.1 Where the money facts are born (a two-minute primer)

You will manage Finance better if you know how a bill comes to exist. This happens on
the **Billing Review** screen (front-of-house, reached from the queue), not in
Management — but it drives every Finance number:

1. **The bill is assembled per visit.** Staff press "Create invoice" for the visit;
   invoices are numbered `INV-000001`, `INV-000002`, … per company.
2. **The consultation fee is configuration, not memory.** If you have set up
   **Consultation Tariffs** (Clinic Settings ▸ Clinical ▸ Consultation Tariffs — rules
   like "Standard consultation, 08:00–22:59, charge *General Consultation*"), Kuwick
   adds the right consultation line automatically, based on when the consultation
   *started*. **If no tariff rule is active, no consultation fee is ever charged, and
   nothing warns you** — this is the single most expensive setup omission possible. If a
   rule exists but the visit's time falls outside every band, billing is blocked with a
   "tariff review" message until you fix the configuration — Kuwick never guesses a
   price.
3. **Medicines are charged per pack.** An item's Sell Price is the price of one
   *stock unit* (a strip, a box, a bottle). A 30-tablet course of a 10-per-strip
   medicine is charged as 3 strips — always rounded **up** to whole packs. An item whose
   pack quantity is not set **cannot be billed or dispensed** until someone fills it in
   (Chapter 7.2).
4. **Procedures and services** are billed from completed orders at the service
   catalogue price.
5. **Panel rules are applied** (Chapter 8.5): panel-specific prices, exclusions, the
   visit's verified limit and co-payment split the bill into a **panel portion** and a
   **patient portion**.
6. **Discounts** (line-level or whole-invoice) require the billing-corrections
   permission and a written reason. A whole-invoice discount reduces only the
   **patient's** portion — the panel's contractual receivable is never reduced by a
   counter discount.
7. **Payment is all-or-nothing.** The counter records one payment for exactly the
   remaining patient balance, by method **Cash, Card, QR Payment, Bank Transfer**, or
   **"Panel — No Patient Payment"** (only valid when the patient owes RM 0). There are
   **no partial payments, no split tender, no change calculation, and no printed
   receipt** (drug labels and queue tickets print; invoices do not).
8. **Paying freezes the money.** The invoice becomes **Paid**, and the split — patient
   paid vs panel covered — is snapshotted permanently. A paid invoice can never be
   edited or cancelled. An *unpaid* invoice can be cancelled (with a reason) by someone
   holding billing corrections; lines can be cancelled but never deleted, and cancelled
   lines stay visible in history.

An invoice has exactly three states: **Unpaid → Paid**, or **Unpaid → Cancelled**.
There is no draft and no "partially paid".

> **Auditing gaps to know about:** the system records *when* an invoice was paid but
> **not who took the payment**, and records *why* an invoice was cancelled but **not who
> cancelled it**. Discounts and line cancellations *do* record the person and reason.
> If cashier-level accountability matters to you, keep a manual counter log for now.
> (Appendix A.)

### 5.2 Day-End Closing

**Where:** Management ▸ Finance & Sales ▸ Day-End Closing.

**What it is:** a **read-only summary of one date** — despite the name, *nothing is
closed, locked or signed*. There is no cash-drawer count, no float, no variance entry,
no lock and no cashier sign-off. Use it as the daily reading you reconcile your physical
cash against, outside the system.

**Filter:** one date picker (defaults to today). **The whole company is shown — there
is no branch filter on this page.**

**What it shows** (all from invoices **paid on that date**):
- **Total Sales** — sum of those invoices' totals.
- **Cash Collected (at counter)** — what patients actually handed over that day, split
  in the table by payment method (Cash / Card / QR / Bank Transfer). A fully
  panel-covered invoice appears in no payment-method row, because no patient money
  moved.
- **Panel Billed** — the panel portions of that day's paid invoices: money the panels
  now *owe* you. It is chased in Panel & Claims, not here.
- **Patients (Cash / Panel)** — how many of the day's paid invoices were self-pay vs
  panel.
- A yellow warning when invoices *created* that day are still Unpaid: settle or carry
  them forward. (The banner's wording says "today" even when you are viewing a past
  date — read it as "on the selected date".)

**Actions:** a CSV download on each table. Payment methods print as their system codes
(`CASH`, `BANK_TRANSFER`), not pretty labels.

**What should happen after this screen:** count the physical cash against "Cash
Collected", investigate any unpaid invoices from the day (Invoice Listing, filtered to
Outstanding), and move on. Do **not** expect the page to stop back-dated changes — a
payment recorded later for that date will change the figures retroactively.

### 5.3 Sales Analysis

**Where:** Management ▸ Finance & Sales ▸ Sales Analysis. **Filter:** date range
(default 30 days); whole company.

**Shows:** Total / Panel / Non-Panel sales, average charge per patient (and per
panel/non-panel patient); a daily sales column chart; and four pies — panel vs
non-panel, revenue by category, sales by doctor, sales by panel company.

**How to read it:**
- "Panel Sales" here means **the full value of panel patients' invoices** (including
  any co-payment the patient paid) — a deliberately different cut from Day-End's "Panel
  Billed" (which is only the panel's own share). Don't expect the two pages to match
  ringgit-for-ringgit; they answer different questions.
- The per-patient averages divide by the number of paid invoices, not distinct persons.
- The same category-split caution as the dashboard applies (Chapter 4).

**Actions:** CSV (exports the daily series only, not the pies).

### 5.4 Invoice Listing

**Where:** Management ▸ Finance & Sales ▸ Invoice Listing.

**What it is:** the transaction-level list — every invoice with its number, status
(Paid / Unpaid / Cancelled), patient, doctor, billing type (panel name or self-pay),
total, patient-paid amount, panel amount, payment method and date.

**This is also your outstanding-invoices (debtors) report:** set the status filter to
**Outstanding (Unpaid)**. There is no separate debtors ledger, no per-patient
accumulated balance and no statement of account — outstanding money exists per invoice
only.

**Two reading notes:** the date column is the payment date for paid invoices and the
creation date otherwise (the "Paid" filter therefore filters by payment date, the
others by creation date); and the list is **capped at 500 rows** — narrow the date
range for busy periods, or the CSV will silently export only the first 500.

### 5.5 What Finance does not include

To be explicit, because these are the questions accountants ask: there is **no** SST/GST
(no tax line exists anywhere on an invoice), **no LHDN e-Invoice** (the menu item is
greyed out until it is built), **no refunds or credit/debit notes** (a paid invoice is
final; corrections to a paid record are future work), **no expenses, supplier bills or
payables**, **no profit & loss**, **no general ledger, bank accounts or
reconciliation**, and **no payment gateway**. Kuwick's Finance area is a *sales and
receivables* view. Keep your accounting system; give your accountant the CSVs.

---

## 6. Clinic Operations (Operation analytics)

This is **Management's** Operation area — analytics about how the clinic runs. It is
not the queue or the diary itself; those are front-of-house screens with their own
workflows. Every page here: date-range filter (default 30 days), whole company (see the
branch caution in Chapter 2.3), read-only.

### 6.1 Patient Analysis

**Shows:** Total Visits, Unique Patients, **New / Existing** split, Panel / Cash visit
split; attendance by hour of day and by day of week; pies for gender, age group
(0-12 / 13-17 / 18-39 / 40-59 / 60+), panel vs cash, and by panel company.

**Where the data comes from:** **visits** (everyone who checked in), not invoices — so
it counts patients whether or not they were billed.

**How to read it:**
- **"New" means the patient record was first registered inside the selected range** —
  a genuinely first-ever patient. A patient of two years returning after six months is
  "Existing".
- Panel/cash here is by whether the *visit* had a panel attached, which can differ
  slightly from the money-based split in Finance.
- The hour-of-day chart is affected by the timezone quirk (Chapter 2.4) on the current
  deployment — use it for *relative* peaks, and mentally shift the labels.
- Use the hour/day charts for rostering decisions (when to add a second doctor), the
  new/existing trend for marketing, and the age/gender mix for stocking decisions.

**What not to infer:** nothing here measures outcomes or satisfaction; "unique
patients" within one range cannot be compared across overlapping ranges.

**Actions:** none beyond the range (no CSV on this page).

### 6.2 Procedure & Service Analysis

**Shows:** revenue and count of **ordered procedures/services** (wound dressing, blood
tests, nebuliser…), grouped by service category and by doctor; a detail table by charge
description.

**Where the data comes from:** invoice lines that came from a completed **order**, on
paid invoices. **Consultation fees and medicines are excluded by definition** — this
page is about procedures, not the whole bill.

**How to read it:** "By Doctors" here credits the doctor **who ordered** the procedure
(other pages credit the visit's attending clinician — the numbers can legitimately
differ). "Count" counts billed lines, not units — three dressings billed on one line
count once here.

**Actions:** CSV of the by-description table.

### 6.3 Waiting Times

**Shows:** Visits; **Average Wait to Be Called** (turns red above 30 minutes);
**Average Consultation + Dispensary**; **Average Total Visit**; a wait-time
distribution (0-15 / 15-30 / 30-60 / 60+ minutes); average wait by day.

**Where the data comes from:** timestamps the queue already records — joining the
queue, being called, and visit check-in/check-out. Nothing extra is typed in.

**How to read it:**
- Waits are only *measured* where a queue ticket was actually called — the distribution
  caption says "(N measured)", and N can be smaller than Visits. Intervals longer than
  8 hours (a forgotten check-out) are dropped rather than poisoning the averages.
- Consultation and dispensary time cannot be separated yet — the split would need a
  timestamp the queue doesn't record. Treat the second figure as "time in clinical
  hands".
- Act on it: waits consistently above 30 minutes at specific hours are a rostering
  problem (cross-check the Patient Analysis hour chart), not necessarily a doctor
  problem.

### 6.4 Doctor Performance

**Shows:** a stacked revenue-by-category chart per doctor, and a table — patients,
total sales, then Consultation / Drugs / Services / Others columns and average per
patient.

**Where the data comes from:** paid invoices, attributed to the **visit's attending
clinician**; visits with none show as "Attending clinician not assigned".

**How to read it — and what not to infer:**
- "No. Patients" counts **invoices**, so a patient billed twice counts twice.
- The four category columns are pre-discount and heuristic (Chapter 4), so they may not
  sum exactly to Sales.
- **This is billing throughput, not clinical quality.** The reference system's
  per-doctor "score" was deliberately not built because its formula was not
  recoverable; Kuwick shows the raw, explainable numbers instead. Doctor incentive
  calculation is likewise not built (Chapter 10).

**Actions:** CSV.

*(Two more report pages — Invoice Listing and Drug Movement — belong to Finance and
Inventory respectively and are documented in those chapters.)*

---

## 7. Inventory (Stock)

**Where:** Management ▸ Inventory. Seven entries: Stock Health, Stock Take, Procurement
Requests, Purchase Orders, Items, Suppliers, Drug Movement.

Inventory is per **branch**: every stock balance belongs to one branch, and multi-branch
owners will be asked which branch an action applies to.

> **Multi-branch caution:** the Items page itself has no branch picker, so an
> owner login not tied to a branch will be told "Pick a clinic before adjusting stock"
> when using the quick +/− buttons there — do branch-specific stock work from a
> branch-bound login, or use the Stock Health ▸ Stock In flow, which does have a branch
> field.

### 7.1 The item master (Items)

Every medicine, vaccine and consumable is one **Item**. There is no separate
"medication vs consumable" type — the free-text **Category** (tabs across the list:
e.g. ANTIBIOTIK, Consumables) is the only classification, and you can create categories
inline or via **Manage Categories** (rename moves every item with it; delete is refused
while items still use the category). There are **no barcodes** anywhere in the system.

An item's key fields:

| Field | What it means | Notes |
|---|---|---|
| Code / Ref, Product Name | Identity | Name is required and is the matching key for imports |
| Category | Free-text classification | Drives the list's tabs |
| **Stock Unit** | The package you count on the shelf — "TABLET PER STRIP", "BOTTLE" (bilingual, from Settings ▸ Prescription Vocabulary) | |
| **Quantity per stock unit** | How many doses in one package — 10 tablets per strip | **The most important number on the item — see 7.2** |
| "Dispensed whole" | A declaration that this item leaves as a whole unit (a bottle of syrup) | Sets pack quantity to 1, recorded with who declared it and when |
| **Sell Price (RM)** | **The price of one PACK/stock unit** — not one tablet | Required |
| Cost (RM) | Your purchase cost, for reference only | Nothing computes from it — no stock valuation exists |
| Panel Pricing | Per-panel negotiated prices | See Chapter 8.6 |
| Track batch & expiry | Informational switch | Currently not enforced — batch/expiry fields always appear |
| Active | Whether it can be prescribed/sold | Toggle on the list; **items can never be deleted** — a deactivated item stays on every past prescription and invoice |
| Prescribing defaults | Default dose, frequency, duration, instruction, age-based dose brackets | Used by the doctor's prescribing form |

**Reorder level is not on the item** — the minimum threshold is set **per item per
branch** (Stock Health ▸ Set Min Threshold), because a busy branch and a quiet branch
need different minimums.

### 7.2 Pack quantity — the number that moves money and stock

Kuwick counts the shelf in **packs** (strips, boxes, bottles) but doctors prescribe in
**doses** (tablets, ml). "Quantity per stock unit" is the bridge:

> 30 tablets prescribed ÷ 10 tablets per strip = **3 strips** leave the shelf, and
> **3 × the strip's Sell Price** is billed. Always rounded **up** to whole packs.

If this number is missing, Kuwick **refuses** to price or dispense the item — it will
never silently assume "1" (that assumption once produced a RM1,550 charge for a RM155
course, and the fix was to refuse). Such items are flagged on the Items list by the red
**"needs attention"** counter — "no pack quantity" or "unconfirmed 1". **Clearing this
worklist is part of first-time setup, and any item left on it will fail at the
dispensary.** The count is company-wide over active items and does not shrink when you
filter the list.

### 7.3 CSV import

**Items ▸ Import / Template**: download the template (21 columns; Name and Price to
Patient are mandatory), fill it in Excel, then **Check file** (a dry run that reports
every problem with its spreadsheet line number) and **Apply**.

Rules worth knowing: matching is by **name** (case-insensitive), so re-uploading
updates rather than duplicates; a blank cell means "leave that field alone", never
"clear it"; the whole file is **all-or-nothing** — one bad row and nothing imports;
the special value `DISPENSED_WHOLE` in the pack-quantity column both sets 1 and records
the declaration; unknown units/frequencies are refused with instructions to add them
under Settings ▸ Prescription Vocabulary first. After import, the success message tells
you how many rows arrived without a pack quantity — go straight to the needs-attention
worklist and fix them.

### 7.4 Stock Health — levels, low stock, near expiry, negative stock

One page, four tabs:

- **All Stock** — the balance per item per branch, with two buttons:
  - **Stock In** — record stock that arrives *outside* a purchase order (an opening
    balance, a free sample, an urgent walk-in purchase): branch, item, quantity,
    optional supplier, expiry date and batch number. Creates a batch and a
    goods-received movement, and increases the balance.
  - **Set Min Threshold** — the per-branch reorder level.
- **Low Stock** — items strictly below their threshold, with the shortfall and a
  **Reorder** button that raises a Procurement Request for the shortfall (the button
  becomes "Request pending" once one exists). *Quirk:* an item exactly **at** its
  threshold shows a "Low" tag on the Items list but does not appear on this tab.
- **Near Expiry** — batches expiring within 30/60/90/180 days (default 90), including
  already-expired ones, soonest first. **Caution:** batch quantities are recorded at
  receipt and **never reduced by dispensing** (see 7.9) — a batch may show its full
  received quantity here even after most of it has been dispensed. Use this tab as an
  early-warning list to *physically check the shelf*, not as a precise count of
  expiring stock. The "Supplier" column is only filled for Stock In entries, not
  purchase-order receipts.
- **Negative Stock** — items whose balance is below zero, "pending reconciliation".
  **Negative stock is allowed on purpose** (an owner decision): front-line staff can
  dispense and bill even when the system count hasn't caught up with goods physically
  received. This tab is where you reconcile — investigate each negative line, then fix
  it with a stock take or an adjustment. A perpetually negative item means a missing
  goods-receipt discipline, not a software fault.

### 7.5 Buying stock — the procurement workflow

The intended flow:

> **Low stock ▸ Reorder** (or Procurement Requests ▸ New Request) → request is
> **Pending** → a manager **Approves** (or Rejects) → someone creates a **Purchase
> Order** to the supplier → goods arrive → **Receive** against the PO → stock and
> batches go up.

What each screen does:

- **Procurement Requests** — one item, one branch, one quantity per request. Statuses:
  Pending → Approved / Rejected (and "Converted", see the caution). Approving **only
  records the decision** — it does not create a purchase order or notify anyone.
  > **Caution:** there is currently **no screen that links an approved request to a
  > purchase order** — staff must copy approved requests into a PO by hand, and the
  > request will stay "Approved" forever rather than showing "Converted". The system
  > also does not record *who* requested or approved on the screen. Treat this list as
  > a decision log. (Appendix A.)
- **Purchase Orders** — create with **New Purchase Order**: branch, supplier, and lines
  (item, quantity, unit cost). Statuses: **Ordered → Partially Received → Fully
  Received**. There is **no PO number** (rows show a shortened internal reference), no
  expected delivery date, no notes, no total, **and no way to cancel or close a PO** —
  a mistaken PO simply stays Ordered forever; receive nothing against it and note it in
  your own records. Unit cost is recorded for reference only — it does not update the
  item's cost and feeds no report.
- **Receiving** (the Receive button on an Ordered/Partially-Received PO): for each
  outstanding line enter **quantity received** (capped at what's outstanding — partial
  deliveries are fully supported), **batch number** and **expiry date**. Each received
  line creates a stock batch, a goods-received movement, and increases the balance; the
  PO's status updates itself. A goods-received note is stored internally but **there is
  no screen to view past GRNs** — the PO's received quantities are your visible record.

**No money flows from purchasing.** Receiving goods creates no supplier bill, no
payable and no expense — pay your suppliers from your accounting system.

### 7.6 Stock Take

**Where:** Management ▸ Inventory ▸ Stock Take.

A deliberately simple, single-sitting count — there are no draft sessions, no
count-sheets, and **no separate approval step**; whoever submits *is* the approval, so
have a senior person do it.

1. Pick the **branch** (changing branch clears anything typed).
2. Optionally pick **Counted by**.
3. The table lists every item with its system quantity. **Type the physical count only
   for items that differ** — matching items need no entry.
4. Each typed row shows its variance immediately: "Matched", "+N over", or "N short".
5. Press **Submit Stock Take (N)**. For every row with a variance, Kuwick writes an
   adjustment movement and **sets** the balance to your counted figure; the result
   panel lists exactly what changed.

Notes: a stock take records no reason text per line (unlike the quick +/− adjustment,
which requires one); there is no export of the variance list — screenshot or copy the
result panel if you need a record; and there is no scheduled/cyclical counting feature.

### 7.7 Quick adjustments (and when not to use them)

On the Items list, each row has **+ / −** buttons for small corrections (a breakage, a
shelf count of one item). The modal insists on a **written reason** and tells you
plainly: received goods do **not** go through here — they go through Purchase Orders or
Stock In, where supplier, batch and expiry are captured. Hold your staff to that rule;
it is the difference between an auditable ledger and a mystery.

### 7.8 How dispensing deducts stock (the clinical dependency)

You never deduct dispensed stock manually — the **dispensary counter** does it as part
of handing medicine out:

- Deduction happens **at dispense time**, not when the doctor prescribes.
- It happens **exactly once** per prescription — the system is built so that two staff
  clicking simultaneously cannot double-deduct.
- It deducts **in packs** using the item's pack quantity (30 tablets → 3 strips), and
  the movement records both figures.
- If the shelf shows fewer packs than needed, the dispenser is warned and must
  **acknowledge the shortage** to proceed — which is what drives balances negative
  (7.4) and is allowed by design.
- An item with no pack quantity **fails to dispense** with instructions to fix the
  item — it does not guess.

### 7.9 What the stock ledger records — and doesn't

Every change to a balance writes a permanent movement of one of exactly **three
kinds**: **Goods received** (PO receipt or Stock In), **Adjustment** (stock take or
quick +/−), and **Dispensed**. There is no transfer, wastage, return or write-off
movement type — see 7.11.

**Batches and FEFO:** batches (number, expiry, quantity) are recorded at receipt and
power the Near Expiry list, but **dispensing does not pick or reduce a batch** — Kuwick
does not do FEFO (first-expiry-first-out) for you. **Physically practising FEFO at the
shelf is your team's discipline**; the system will neither enforce nor track which
batch actually left.

There is currently **no stock-card screen** (per-item movement history) in the app,
even though the ledger exists underneath — it is a known gap (Appendix A).

### 7.10 Drug Movement report (fast vs slow moving)

**Where:** Management ▸ Inventory ▸ Drug Movement (page title: "Drug Revenue — Fast vs
Slow Moving"). **Filter:** date range.

**Shows:** drug revenue, units dispensed, and a slow/dead-stock count; a top-10 chart;
and a table classifying each drug **Fast / Medium / Slow Moving**.

**Where the data comes from:** **paid invoice lines that came from prescriptions** — it
measures what you *sold*, not raw shelf movements.

**How to read it:** classification is *relative* — the top third of sellers is Fast,
the bottom third Slow, and never-sold items are Slow; in a quiet fortnight even a good
seller can look "Slow", so judge over 90 days or more. The never-sold list currently
includes **deactivated** items and is company-wide, so expect some noise in "Slow /
Dead" — verify before discarding stock. Use it for purchasing decisions and to find
dead stock to run down before expiry.

### 7.11 What Inventory cannot do today

No **branch-to-branch transfers** (do a minus-adjustment at one branch and a Stock In
at the other, with matching reasons — an honest workaround, not a feature). No
dedicated **wastage/expired write-off** flow (use a minus-adjustment with the reason
written in). No **returns to supplier**. No **stock valuation or costing** reports. No
**PO cancellation**, no **GRN viewer**, no **stock-card screen**, no **supplier
edit/deactivate** in the UI, no **barcodes**, no **FEFO enforcement**, and stock-take
**sessions/approval** don't exist (single-step by design). Suppliers hold only name and
contact — no address, terms or SSM number.

---

## 8. Panel & Claims

**Where:** Management ▸ Panel & Claims — two screens: **Panel Companies** and **Panel
Claims**.

"Panel" here means the employer / insurer / TPA that pays for a patient's visit (AIA,
PM Care, a corporate client…). The lifecycle in one sentence: *a panel patient's paid
invoice creates a receivable, which you claim from the panel in batches, chase, and
mark off as the money arrives.*

### 8.1 Panel Companies (the panel master)

The list of panels your clinic serves. Each panel holds:

| Field | Meaning |
|---|---|
| Panel Name / Code | e.g. "AIA" |
| **Per-Visit Limit (RM)** | Shown to the front desk as a *reference* when registering. **Informational only — the limit that actually splits a bill is captured per visit at verification time** (8.4). |
| **Payment Term (days)** | The panel's promise — "pays within 30 days". Drives the *overdue* flag on aging. A panel with no term is never flagged overdue. |
| **Claim Fee** | An optional per-claim admin fee — a % of the claimed amount or a flat RM — **added automatically** when you create a claim batch. See 8.7 before you set this. |
| Status | Active / Inactive (panels are deactivated, never deleted). |

Per panel, the **Pricing & Exclusions** button opens:
- **Price Overrides** — the panel's negotiated price for a specific medicine or
  service. Used when billing that panel instead of your cash price.
- **Exclusions** — items/services this panel does **not** cover. An excluded line is
  automatically stamped patient-payable on the bill, *on top of* the visit limit.

New clinics start with a few default panel names copied in at creation; everything
money-related is yours to configure. (A panel-wide "cash price + fixed RM markup"
rule exists inside the pricing engine, but **there is currently no screen to set it** —
if you see "cash + panel markup" wording on the item screen, that is why. Practical
effect today: price a panel either per-item/service via overrides, or at cash price.
Appendix A.)

### 8.2 How a visit becomes panel-billed

There is **no patient-level panel membership** in Kuwick — the panel is chosen **per
visit**, at registration (front desk picks Cash or Panel + the panel name when adding
to the queue, on a new visit, or at appointment check-in). A regular AIA patient must
be marked AIA on *each* visit. (Patient-level eligibility is a recorded future item —
Appendix A.)

### 8.3 Verification — the gate money cannot pass without

Choosing a panel only marks the visit **"Not yet verified"**. Before the bill can be
settled, someone must check the patient's cover on the **panel's own portal (outside
Kuwick)** and record the result on the visit's Billing Review screen:

- **Verified** — record the member/GL reference and the terms: coverage (**Unlimited**
  or **Visit limit RM X**) and co-payment (**none**, **fixed RM**, or **a percentage**).
- **Failed** — the panel did not confirm cover; no terms are recorded (Kuwick refuses
  to store guessed figures), and the visit is effectively self-pay unless overridden.
- **Override** — finance/owner can set terms manually with a **mandatory written
  reason**; the originally verified terms are kept forever alongside the override.

Who may do what: front desk, finance and owner-admin can *verify*; **only finance and
owner-admin can override**. Until terms are Verified or Overridden, the bill shows
"Billing responsibility has not been confirmed" and **payment is blocked** — that
message is the system protecting you, not an error. Once a visit is completed, its
terms are locked permanently.

The guarantee-letter (GL) number is recorded as free text in the verification
reference; there is no GL document upload or GL expiry tracking.

### 8.4 How the bill is split — with RM examples

At billing time Kuwick splits every line between panel and patient, in this order:
line discounts → excluded items set aside (always patient-payable) → the covered
amount is capped at the visit limit → the co-payment is taken off the panel's share →
any whole-invoice discount reduces the *patient's* share only.

Worked examples on a **RM 250 bill** (these exact cases are owner-approved and tested
in the system):

| Verified terms | Panel pays | Patient pays |
|---|---|---|
| Unlimited | RM 250 | RM 0 |
| Visit limit RM 200 | RM 200 | RM 50 |
| Unlimited + RM 10 fixed co-pay | RM 240 | RM 10 |
| Limit RM 200 + RM 10 co-pay | RM 190 | RM 60 |
| Limit RM 200 + 10% co-pay | RM 180 | RM 70 (RM 50 excess + RM 20 co-pay) |
| RM 220 covered + RM 30 excluded item, limit RM 200 | RM 200 | RM 50 |

Note the percentage co-pay is calculated on the covered amount **after** exclusions and
the limit — never on excluded items.

When the patient owes RM 0 (full cover), the counter settles the bill with the method
**"Panel — No Patient Payment"**. That marks the *patient's* side done; **it does not
mean the panel has paid you** — the panel's share becomes a receivable, chased in Panel
Claims.

### 8.5 The claim lifecycle — CLAIMED, RECEIVED, OUTSTANDING

Definitions as the system actually uses them:

- **Claimed** — the panel portion of a paid invoice, frozen the moment you put it into
  a claim batch.
- **To Receive (receivable)** — Claimed **+ Claim Fee** (8.7).
- **Received** — the amount you record as paid by the panel, per invoice line.
- **Outstanding** — To Receive − Received.
- **"Approved" is not an amount in Kuwick.** A line can be marked *Accepted*, but no
  approved-value is stored; a partial approval is recorded as *Deducted* with the
  amount actually paid and a deduction reason.

The workflow on the **Panel Claims** screen (pick the panel at the top):

1. **Claim Batches tab — Create.** Every invoice that is **Paid**, has a panel
   portion, and isn't already in an active claim appears automatically in the
   "create batch" list. Tick the invoices, pick **Created By**, press **Create Batch**
   — the batch is numbered `CLAIM-000001, …` and each line freezes its claimed amount
   and fee. *You decide the rhythm* — daily, weekly or monthly batching are just
   habits; the system doesn't impose a cycle.
2. **Submit — outside Kuwick.** Send the claim to the panel the way that panel wants:
   upload on their portal, courier the forms, or email. Then press **Submit** on the
   batch and record the **method** (Panel's Own Portal / Courier / Email / Other) and
   your reference number. **Kuwick transmits nothing** — no panel in Malaysia offers an
   API this system integrates with, and Kuwick also does not generate a claim form or
   statement document; export the **CSV** from the Claim Listing tab if the panel needs
   a file.
3. **Record the outcome per invoice line** when the panel responds: **Accepted /
   Rejected / Deducted / Paid**, with the RM amount received and remarks. The batch's
   own status follows the lines: **Submitted → Partially Paid → Paid**.
4. **Rejections and resubmission.** Marking a line **Rejected** (or Deducted) releases
   that invoice — it reappears in the eligible list, and you claim it again in a *new*
   batch (the fee recalculates fresh). There is no one-click "resubmit"; this manual
   re-claim is the designed path (an automatic excess/rejected register was built and
   then removed at the owner's request).
5. **Reconcile** closes a fully-handled batch permanently. A reconciled batch can never
   be edited — only reconcile when every line is truly settled.

**Monitoring tabs:**
- **Claim Listing** — the day-to-day workbook: every panel invoice (including
  not-yet-batched ones marked *Unclaimed*), with claimed/fee/to-receive/paid/receivable,
  status, and **Due Days** with a red *overdue* tag once the panel's payment term is
  exceeded. Filter by month; CSV export.
- **Outstanding Aging** — all panels' submitted batches with days outstanding vs each
  panel's own payment term (no fixed 30/60/90 buckets — aging is judged per panel).
  This same list feeds the Executive Dashboard's "Panel Outstanding".
- **Yearly Summary** — per panel per year: claims, claimed, fee, receivable, paid,
  outstanding. CSV export.

### 8.6 Panel pricing in practice

Prices resolve in a strict order when billing a panel visit: **the panel's specific
override for that exact item/service → otherwise your cash price**. A panel's special
*consultation* rate is configured the same way — add a price override on the
consultation service for that panel (the tariff rule itself carries no price). Price
changes apply to **future bills only**; lines already billed keep their price forever.
You can also set a panel's price per item from the item's own edit screen (the two
screens write the same data).

### 8.7 The Claim Fee — read before configuring

The fee is **always added on top of your claim**: *claim RM 100 with an 8% fee →
Kuwick records RM 108 To Receive* (a flat RM 5 fee → RM 105). Configure it only for
panels that genuinely let you bill an admin fee on top.

> **Direction warning:** many Malaysian TPAs work the other way — they **deduct** an
> admin fee from what they pay you. Kuwick has **no way to express a deducted fee** at
> configuration time. For such panels, leave the Claim Fee empty and record the
> shortfall on each line as **Deducted** with the actual amount received. If you set a
> fee for a deducting panel, every receivable and aging figure for that panel will be
> overstated in both directions. (The four-value "fee direction" concept from the
> original specification was not built — Appendix A.)

### 8.8 Traps and quirks to brief your claims clerk on

- **An invoice cannot be removed from a batch.** The only way out is marking its line
  Rejected/Deducted (which releases it but leaves that row in history). Tick carefully
  before creating a batch.
- **You cannot record a payment of RM 0**, and a recorded payment amount is *sticky* —
  changing a Paid line to Rejected keeps the old paid amount on it. Get the outcome
  right the first time; there is no undo.
- The system does **not** stop you recording more than was claimed — a typo produces a
  negative receivable that flows into the totals. Check the yearly summary for negative
  outstanding values now and then.
- A batch where **every** line was rejected displays as *Partially Paid* (there is no
  "Rejected" batch status). The lines tell the true story.
- One stray on-screen message says the receivable is collected under "Finance → Panel &
  Claims"; the actual menu is **Management ▸ Panel & Claims**.
- **"Created By" on a batch is picked from a dropdown, not taken from who is logged
  in** — the same is true of leave approvals (Chapter 9.5). Agree internally that staff
  always pick themselves.

---

## 9. HR & Incentives

**Where:** Management ▸ HR & Incentives — Staff, Roster & Availability (a link into the
Appointments module), Attendance, Leave Requests. Public Holidays lives under Clinic
Settings ▸ HR & Attendance; Roles & Permissions under Clinic Settings ▸ Organisation.

**Set your expectations first:** Kuwick's HR is a **staff directory and access-control
console** with three light satellites (a derived attendance view, a leave list, a
holiday calendar). It is *not* an employee-file system: there is nowhere to record IC
number, date of birth, phone, address, next-of-kin, joining date, employment type,
salary, bank account, EPF/SOCSO numbers, or to attach documents. Keep your employee
files outside Kuwick. (And the "Incentives" in the tab name is aspirational — Chapter
10.)

### 9.1 The Staff page

The company-wide staff list (all branches): name, job title, staff number, home
clinic, whether active, the clinical-signing status, and per-row **Edit** and
**Access** buttons.

### 9.2 Creating a staff member (and their login)

**Add Staff** asks for: Full Name (required), **Role** — a job-title label (required;
pick the closest; it only matters until you assign real capability roles), Home Clinic
(multi-branch clinics only; leave blank for owner/finance-type people who work across
branches), Staff Number (optional), calendar colour (doctors only — the colour that
identifies them on the diary; Kuwick auto-assigns the next unused of eight curated
colours if you skip it), and optionally **"Set up login"** with email + temporary
password (minimum 8 characters).

Practical notes:
- The login can **only** be created here, at staff creation. There is no password
  reset, no invitation email, and no self-service password change yet — record the
  temporary password securely and hand it over in person.
- A new **doctor** is created first, then *edited* to add the Clinical Practitioner
  Profile (MMC number, professional type), because those fields are on the edit screen
  only.
- **A staff member's name cannot be corrected on screen after creation** (a known gap —
  Appendix A). Type it right the first time.

### 9.3 Doctors: registration, verification and signing

On Edit Staff, the Clinical Practitioner Profile carries: Professional Type
(Medical doctor / Non-clinical), Medical Registration No. (MMC), a "verification
recorded" switch and a "clinical-note signing enabled" switch. The screen is honest
about what this means: *Kuwick does not check the MMC register — these switches record
**your clinic's own** verification*, with who set them and when kept permanently.

Only an account with the **Owner-Admin job title** can change these four fields — even
other owners cannot. A doctor cannot sign clinical notes until all of: MMC number
recorded, verification recorded, signing enabled, and the Doctor role held.

### 9.4 The Access drawer — assigning what people can do

The **Access** button (visible to owners) opens the drawer described in Chapter 3: tick
capability roles (Owner / Administrator / Clinical staff / Doctor — Doctor stays greyed
until an MMC number exists), attach custom roles, and add individual grants (each needs
a written reason). The drawer shows **"Effective permissions — the server's own
answer"** at the bottom: that list is the truth of what the account can do. Changes
apply from the person's **next sign-in** (the server enforces immediately; their menus
refresh at next login).

**Deactivating** (the Active switch on Edit) is how someone leaves: their account keeps
authenticating but holds **zero** permissions everywhere, and their history stays
intact. **Staff can never be deleted.** You can never deactivate or de-role the last
Owner.

### 9.5 Attendance

**Where:** Management ▸ HR ▸ Attendance. A read-only table per staff per day: first
check-in, last check-out, and visit count, over a date range (default last 7 days).

**What it actually is — set expectations correctly:** Kuwick has **no clock-in system**
(no punch, no biometric, no manual entry, no edits, no approvals). This screen is
**derived from patient visits**: a row appears for a *doctor* on a day when visits
named them as attending clinician; "first check-in" is their first *patient's* arrival.

Consequences to accept before you rely on it:
- **Only doctors ever appear.** Front desk, nurses (unless attending), finance and
  stock staff never show here, however long they worked.
- A doctor on duty who saw no patients shows nothing; a doctor whose last visit was
  closed late shows a late "check-out".
- The date grouping has the same early-morning timezone quirk as the reports
  (Chapter 2.4).

**Do not use this screen for payroll, overtime or discipline.** Use it as a rough
picture of clinical presence, nothing more.

### 9.6 Leave Requests

**Where:** Management ▸ HR ▸ Leave Requests.

**Leave types:** Annual, Medical (MC), Emergency, Unpaid, Other.
**Statuses:** Pending → Approved / Rejected.

**How it works:** anyone opens **Request Leave**, picks the staff member (any staff
member), the type, the dates and an optional reason. Approvals happen on the same page:
pick who is "Approving as" from a dropdown, then Approve or Reject each pending
request. Decided requests show who decided and when.

**What leave actually does — the part that matters:** the moment a request is
**Approved**, that provider's diary is **blocked for those dates** — the booking engine
returns no slots ("on leave"), and the roster shows a violet *Leave* chip sourced
directly from HR (never copied, so the two can't disagree). Enter and approve leave
*before* patients book. Two limits: **Pending leave blocks nothing**, and approving
leave does **not** cancel or flag appointments *already booked* on those dates — check
the diary yourself and move them.

**What is not there:** leave balances/entitlements/quotas (track "12 days annual
leave" outside Kuwick — the system happily approves a 400-day request), no MC document
upload, no half-days, no cancel/withdraw of a decided request, no notification to the
staff member, and the rejection-reason box never reaches the record. **And note:** the
"Approving as" dropdown is an honour system — any signed-in user can technically
approve leave as anyone. Agree the discipline internally (and see Chapter 3.2).

### 9.7 Public Holidays

**Where:** Clinic Settings ▸ HR & Attendance ▸ Public Holidays.

A simple company-wide date list: date + name (e.g. "Merdeka Day"). **Manual entry only
— there is no Malaysian holiday preset, no import, and no per-state variant**; type
each year's holidays in yourself. One holiday per date; deleting is the only edit.

**The step everyone misses:** adding a holiday **does nothing by itself**. Each
branch decides whether holidays close its diary: Clinic Settings ▸ Appointments &
Scheduling ▸ **Branch Booking Rules ▸ "observe public holidays"** — which is **off by
default**, because plenty of Malaysian clinics open on public holidays. Holiday
surcharges are not built (Appendix A); holidays affect nothing else (not attendance,
not leave counting, not billing).

### 9.8 Roster & Availability

The roster (who works when, shift by shift) lives in the **Appointments module** —
the HR menu links to it because it is where an owner manages working arrangements, but
it is diary configuration, not an HR record, and is out of this manual's scope. What HR
contributes to it: approved leave (blocks bookings) and the provider's calendar colour.
Note the roster covers **doctors only** — nurses and counter staff cannot be rostered
in Kuwick today.

---

## 10. Payroll

**Payroll is not implemented in Kuwick 2.0 — at all.** There is no salary record, no
payslip, no EPF/SOCSO/EIS/PCB calculation, no statutory tables, no bank file, no
overtime computation, and no screen that mentions pay. This is a deliberate,
documented scope decision, not an oversight: *"Full payroll processing (salary
computation, statutory deductions, bank disbursement)"* is on the roadmap's
"explicitly out of scope" list, flagged as a candidate for a **dedicated payroll
integration** later rather than a built-in module.

Related and also not built: the **Doctor Incentive Engine** (commission/incentive
calculation). Its formula has now been fully specified from the owner's reference
system, but building it awaits the owner's go-ahead — which is why the HR tab is
labelled "HR & Incentives" while containing no incentive screen, and why Doctor
Performance shows raw billing numbers only.

**What to do meanwhile:** run payroll in your existing payroll system. Kuwick can
contribute exactly two inputs, both with caveats: approved leave (Chapter 9.6 — but no
day counts or balances) and doctor billing performance (Chapter 6.4 — CSV export, for
whatever incentive scheme you operate manually). Do **not** use the Attendance screen
for payroll (Chapter 9.5).

---

## 11. Cross-module consequences every owner should understand

Each of these is a real behaviour of the deployed system. Most support questions trace
back to one of them.

1. **No consultation tariff → no consultation fee, silently.** Configure Consultation
   Tariffs before the first patient, and re-check after adding services (Chapter 5.1).
2. **No pack quantity → the medicine will not dispense or bill.** Clear the Items
   "needs attention" worklist before going live, and after every import (Chapter 7.2).
3. **Paying an invoice freezes its money.** The cash/panel split is snapshotted at
   payment; later panel-config changes affect future bills only. Reports and claims
   both read the snapshot, so they always agree with each other.
4. **A claim can only contain PAID invoices.** An unpaid panel invoice never appears in
   the claims worklist — settle the patient side (even at RM 0 via "Panel — No Patient
   Payment") first.
5. **Panel verification blocks payment.** "Billing responsibility has not been
   confirmed" at the counter means the panel terms were never recorded — the fix is on
   the visit's Billing Review, not in Management.
6. **A visit cannot be completed with money outstanding.** Unbilled chargeable items or
   an unpaid patient balance hold the visit open in the queue — by design, with no
   override. The queue stalling on "payment" is billing telling you something.
7. **Dispensing moves stock exactly once, in packs.** Reversing a wrong dispense is a
   stock *adjustment* (with a reason) — there is no un-dispense.
8. **Approved leave closes the diary; pending leave does not** — and neither touches
   appointments already booked (Chapter 9.6).
9. **Public holidays only close a branch that opted in** (Chapter 9.7).
10. **Early-morning transactions land on the previous report day** on the current
    deployment (Chapter 2.4). Day-End for "yesterday" includes anything up to 8:00 am
    this morning.
11. **Branch filters on reports are cosmetic outside the Executive Dashboard**
    (Chapter 2.3). Multi-branch owners: treat report figures as company totals.
12. **Deactivating never destroys history.** Deactivated staff, items and panels stay
    on every past record; nothing in Management hard-deletes financial or clinical
    history.
13. **A booking deposit follows the patient to the bill.** A booking-fee deposit paid
    online is credited to the visit's invoice automatically, and released if that
    invoice is cancelled.

---

## 12. What Management does not do yet

The consolidated honest list, per module — so nobody discovers these mid-workflow.
(Statutory/compliance items are in Chapter 5.5 and Appendix A.)

| Area | Not available today |
|---|---|
| **Reports** | Branch filter on report pages (dashboard only) · doctor/service filters · drill-down to transactions · print/PDF · scheduled or emailed reports · saved report views · branch comparison · P&L · per-doctor "score" |
| **Finance** | Partial payments/split tender · change calculation · printed receipts/invoices · refunds · credit/debit notes · SST/GST · e-Invoice (LHDN) · expenses/payables/ledger/bank rec · cashier identity on payments · a real day-end lock |
| **Stock** | Inter-branch transfer · wastage/returns/write-off types · FEFO enforcement · stock valuation · PO cancel/close · PO numbers · GRN viewer · stock-card screen · request→PO linking · supplier edit · barcodes · batch depletion tracking |
| **Panel** | Electronic submission (none, ever, by design) · claim form/statement generation · approved-amount tracking · deducted-fee direction · payment allocation across lines · write-off · patient-level panel membership · GL document handling · panel contract/contact fields · panel-wide markup UI |
| **HR** | Employee file fields (IC, contacts, employment dates…) · documents · timesheets · clock-in of any kind · leave balances/quotas · MC upload · staff-name edit · password reset · multi-branch staff assignment · rostering non-doctors · holiday presets |
| **Payroll** | Everything (Chapter 10) |
| **Access control** | Permission-gating on report viewing and on back-office writes (stock, panel config, claims, leave, holidays) — see Chapter 3.2 |

---

## Appendix A — Where the plan and the built system differ

The project's instruction is to document the *actual* system and flag differences from
the specification separately. These are the differences an owner should know about:

1. **Panel claim "fee direction".** The specification described four fee directions
   (withheld from claim / added to receivable / no fee / unconfigured). **Built:** a
   single direction — an optional percent-or-RM fee, always *added* to the receivable;
   "no fee" is simply leaving it empty. There is no withheld/deducted configuration
   (workaround in Chapter 8.7).
2. **Report access by role.** The requirements define per-role report visibility
   (e.g. locum doctors: none; front desk: none). **Built:** no report permissions —
   any signed-in account can view all reports. Same for several back-office write
   actions (Chapter 3.2). The wider RBAC gap is recorded in the project's decision log.
3. **Branch/doctor/service report filters and drill-down** are specified but not built
   (branch works on the Executive Dashboard only), and the "Viewing: branch" header on
   other report pages is misleading in multi-branch clinics.
4. **Patient-level panel eligibility** (a patient's standing panel membership with
   validity dates) is specified but not built — panel choice is per visit.
5. **Panel master detail** (registration/TIN numbers, person-in-charge, contract dates,
   portal URL) is in the target data design but not on the built screen. The panel-wide
   markup amounts exist in the pricing engine but have no configuration screen.
6. **e-Invoice (LHDN MyInvois)** was accepted into scope by the owner but is not built;
   the nav shows it disabled. SST configuration likewise does not exist. The broader
   "Finance module" proposal (tax/company/banking settings, inter-branch billing,
   expenses) remains an unmerged draft.
7. **Day-end settlement** (cash count, variance, lock) has no home yet — the built
   Day-End page is a report.
8. **Stock take sessions with review/approval** and several inventory workflows
   (transfers, returns, wastage) are Phase-2 items; the built stock take is single-step.
9. **Doctor incentive engine** — specified in full from the reference system, not
   built, pending the owner's scheduling decision.
10. **The excess/rejected claim register** was built, then **removed at the owner's own
    instruction**; manual re-claiming is the intended flow.
11. **Payroll** — excluded from Phase One by decision (Chapter 10).
12. **Report-day timezone.** Clinical screens use the branch's Malaysian clock;
    the report aggregations currently group by UTC day (Chapter 2.4). Treat as a known
    defect-class difference until fixed.
13. **Small screen gaps found while writing this manual** (candidates for fixes):
    staff name not editable; supplier not editable; procurement "Converted" unreachable
    from the UI; PO cancel/close unreachable; a stray "Finance → Panel & Claims" label;
    the Items list's static expiry column; the at-threshold low-stock inconsistency;
    leave rejection reasons not saved; "Created By"/"Approving as" chosen from
    dropdowns rather than taken from the signed-in user.

## Appendix B — Glossary

| Term | Meaning in Kuwick |
|---|---|
| **Branch** | One physical clinic location. Called "clinic" in some older screens. |
| **Company / tenant** | Your whole business in Kuwick — one or more branches under one subscription. |
| **Panel** | An employer/insurer/TPA that pays for patients' visits on credit terms. |
| **GL** | Guarantee letter — the panel's authorisation reference, recorded as text at verification. |
| **Co-payment (co-pay)** | The part of a panel bill the patient pays personally. |
| **Claim batch** | A numbered group of paid panel invoices submitted to one panel together. |
| **Receivable / To Receive** | What a panel owes you: claimed amount + claim fee − received. |
| **Stock unit / pack** | The package stock is counted in — strip, box, bottle. Prices and stock counts are per pack. |
| **Pack quantity (quantity per stock unit)** | Doses per pack — 10 tablets per strip. |
| **Dispensed whole** | An item handed over as a whole unit (e.g. a syrup bottle), declared as such. |
| **Min threshold** | The per-branch reorder level that drives Low Stock. |
| **Stock movement** | One permanent ledger entry: goods received, adjustment, or dispensed. |
| **Capability role** | Owner / Administrator / Clinical staff / Doctor — what an account may do. |
| **Individual grant** | One named permission given to one person with a written reason. |
| **Consultation tariff** | The rule that auto-adds the right consultation fee by time band. |
| **Visit classification** | Why the patient came (consultation, OTC only, dressing only…) — decides whether a consultation fee applies. |
| **UAT** | User acceptance testing — you, verifying the system does what this manual says (see the UAT guide). |
