# Kuwick 2.0 — Management First-Time Setup Checklist

**Who this is for:** the clinic owner (or the practice manager they trust) setting up a
new Kuwick company for the first time.

**How to use it:** work through the steps **in order** — the order is the real
dependency order of the deployed system, not a suggestion. Each step says *where to go,
what to enter, what is mandatory, who should do it, what depends on it,* and *how to
confirm it is done*. Tick the confirmation boxes as you go. Expect the full sequence to
take half a day for a single-branch clinic with a prepared item list.

**Why this order (one paragraph):** accounts must exist before access can be assigned;
services and consultation tariffs must exist before any bill can be priced; panels must
exist before panel prices can be set; items must have pack quantities before anything
can be dispensed or billed; and stock, thresholds and holidays only matter once all of
the above is true. Steps 8–9 are front-of-house configuration included here only
because Management's numbers depend on them. Step 10 proves the whole chain with one
test patient.

Terms and screen behaviour are explained in `MANAGEMENT_USER_MANUAL.md` (chapter
references below). The scripted acceptance tests are in
`MANAGEMENT_OWNER_UAT_GUIDE.md`.

---

## Step 0 — Company provisioning (done by Kuwick, not by you)

Your company ("tenant") is created on the Kuwick platform console by the Kuwick
operator, not from inside the clinic app. Provisioning creates, in one step:

- the company and its **first branch** (named after the company);
- your **first owner login** (email + password you agreed with Kuwick);
- starter catalogues copied from platform defaults: a few common **panel names**,
  a starter **procedure/service list**, and default **document templates**;
- a **trial subscription**.

**You need from Kuwick:** the web address of your clinic's Kuwick, the owner login
email, and the initial password.

- [ ] I can open the Kuwick web address and see the login page.

---

## Step 1 — First sign-in and branch details

**Who:** the owner. **Where:** sign in at `/login`, then user menu ▸ **Clinic
Settings** ▸ Organisation & Branches ▸ **Branches**.

1. Sign in with the owner login. You should land on the Appointments area — that is
   normal; Management and Clinic Settings are in the **user menu** (top bar).
2. Open **Branches**. Your first branch exists already (named after the company).
   **Edit** it and complete:
   - **Name** *(mandatory)* — what patients and staff should see, e.g. "Klinik Hijraa
     Kuala Terengganu".
   - **Address** *(optional but recommended)*.
   - **Phone** *(optional but recommended)* — **printed on MC / referral / memo
     letterheads**, so fill it in before issuing documents.
   - **Email** *(optional)*.
   - **Timezone** *(leave as `Asia/Kuala_Lumpur` unless told otherwise)*.
3. **Add Clinic** for each additional branch, same fields.

**Depends on:** nothing. **Everything else depends on this** — every stock balance,
queue, roster and staff home-branch points at a branch.

- [ ] Every physical location has a branch row with name, phone and timezone.
- [ ] The user menu shows a **build** code (note it down — you will quote it when
      reporting issues).

> There is no delete for branches — create only real locations.

---

## Step 2 — Staff records and logins

**Who:** the owner (creating staff needs the owner's `users.manage` power).
**Where:** user menu ▸ **Management** ▸ HR & Incentives ▸ **Staff**.
**Manual:** Chapter 9.2–9.3.

Create every person who will use Kuwick. For each: **Add Staff** →

| Field | Mandatory? | Guidance |
|---|---|---|
| Full Name | **Yes** | **Cannot be corrected on screen later** — type it exactly right |
| Role (job title) | **Yes** | Pick the closest label; real access is assigned in Step 3 |
| Home Clinic | Multi-branch only | Set it for branch-bound staff; leave blank for owner/finance/manager types who work across branches |
| Staff Number | No | Your own numbering |
| Calendar colour | Doctors only | Their identity colour on the diary; auto-assigned if skipped |
| **Set up login** + email + temporary password | **Yes, for anyone who will sign in** | Min 8 characters. **This is the only moment a login can be created, and there is no password reset** — record the password securely and hand it over in person |

Then, **for each doctor**, immediately **Edit** their record and complete the Clinical
Practitioner Profile: Professional Type = Medical doctor, **Medical Registration No.
(MMC)**, then switch on **verification recorded** and **clinical-note signing
enabled**. Only your owner-admin login can set these four fields, and a doctor cannot
sign notes — or be given the Doctor role in Step 3 — without the MMC number.

**Depends on:** Step 1 (home branches must exist).
**Depended on by:** everything a person does is attributed to their staff record —
invoices, dispensing, approvals, "Created By" pickers all list these people.

- [ ] Every staff member has a record; everyone who signs in has a login.
- [ ] Every doctor's MMC number, verification and signing switches are set.
- [ ] Each person has signed in once and changed nothing (proves the password works).

---

## Step 3 — Access: roles, custom roles, grants

**Who:** the owner. **Where:** Staff page ▸ **Access** button per person; custom roles
at Clinic Settings ▸ Organisation & Branches ▸ **Roles & Permissions**.
**Manual:** Chapter 3 (read it first — it explains the model and its current limits).

For each person, open **Access** and tick capability roles:

| Person | Tick |
|---|---|
| Owner / practice manager | **Owner** (+ Doctor if they practise, + Administrator if they work the counter) |
| Receptionist / counter | **Administrator** (+ Clinical staff if they take vitals) |
| Nurse | **Clinical staff** |
| Doctor / locum | **Doctor** (greyed out until the MMC number from Step 2 exists) |
| Stock clerk / claims clerk | Nothing (see Manual 3.3) — add an individual grant of `dispense.perform` only if they hand out medicine |

Optional refinements:
- **Custom roles** — create a named bundle (e.g. "Branch Manager") from the
  administrative permission list, then attach it in the Access drawer.
- **Individual grants** — e.g. billing corrections for one senior counter person.
  A written reason is required for every grant.

**Confirm each person** by expanding **"Effective permissions — the server's own
answer"** at the bottom of their Access drawer — that list is the truth.

**Depends on:** Step 2. **Depended on by:** billing, dispensing, discounts, panel
overrides, settings — every gated action in the system.

- [ ] Every account's effective-permissions list matches what you intend.
- [ ] At least two people hold **Owner** (the system refuses to remove the last one,
      but one owner on holiday is still a bottleneck).
- [ ] Changes were made *before* staff sign in for daily work (access applies at next
      sign-in).

---

## Step 4 — Clinical catalogues that drive billing

**Who:** the owner (settings are owner-only). **Where:** Clinic Settings ▸ Clinical.
**Manual:** Chapter 5.1.

1. **Services & Procedures** — review the starter list; add every service you charge
   for (name mandatory; type; code; category; duration; **price in RM**; active).
   Include a "General Consultation"-type service — the tariff step needs one.
   (Whether a service is *bookable online* is configured in the Appointments module —
   not needed for Management.)
2. **Consultation Tariffs** — **the step that decides whether consultations are ever
   charged.** Add at least one rule: name; "applies to" classification
   (Consultation); time band `From`–`To` (e.g. 08:00–22:59 — a band like 23:00–07:59
   crosses midnight correctly); the consultation **service** to charge (the price is
   the service's price, or a panel's override of it); optional effective dates;
   Active = on. Add separate day/night rules if you charge different rates.
   **A clinic with no active rule charges no consultation fee, silently.**
3. **Prescription Vocabulary** — confirm the units/frequencies lists cover what your
   item list uses (the item import in Step 6 refuses unknown names and tells you to add
   them here).
4. **Diagnoses** and **Document Templates** — review the starters; not blocking for
   Management.

**Depends on:** Step 1. **Depended on by:** every invoice (Step 10), panel service
pricing (Step 5), item import (Step 6).

- [ ] Every chargeable service exists with a price.
- [ ] At least one **active** consultation tariff rule exists per branch you bill from.
- [ ] The tariff's time bands cover your full opening hours (a gap becomes a billing
      blocker, not a free consultation).

---

## Step 5 — Panel companies

**Who:** owner or the person who manages panels (note: this screen is not
permission-gated yet — Manual 3.2). **Where:** Management ▸ Panel & Claims ▸ **Panel
Companies**. **Manual:** Chapter 8.

For every panel/TPA/corporate client you serve:

1. **Add Panel** (or edit a provisioned starter): name *(mandatory)*; code; per-visit
   limit *(reference only — the binding limit is captured per visit)*; **payment term
   in days** *(set it — it drives the overdue flag on aging)*; **claim fee** —
   **read Manual 8.7 first**: the fee is *added on top of* your claim; leave it empty
   for panels that *deduct* an admin fee.
2. **Pricing & Exclusions** per panel:
   - Price overrides for items/services the panel pays differently — including the
     **consultation service**, if the panel's consultation rate differs from cash.
   - Exclusions for anything the panel does not cover (these become automatic
     patient-payable lines).

**Depends on:** Step 4 (services must exist to be overridden). Items can be overridden
later, after Step 6.
**Depended on by:** panel registrations at the front desk, the bill split, claims.

- [ ] Every panel exists with a payment term.
- [ ] Claim fee set only for panels that genuinely allow an added fee.
- [ ] Overrides/exclusions entered for at least your highest-volume panel.

---

## Step 6 — Inventory: categories, suppliers, items, thresholds, opening stock

**Who:** owner plus the stock person (screen not permission-gated yet — Manual 3.2).
**Where:** Management ▸ Inventory. **Manual:** Chapter 7 — read 7.2 (pack quantities)
before touching anything.

**6a. Suppliers** — Inventory ▸ Suppliers ▸ **Add Supplier**: name *(mandatory)*,
contact, phone, email. *(Suppliers cannot be edited afterwards on screen — enter
carefully.)*

**6b. Items** — Inventory ▸ Items. For a real clinic list, use **Import / Template**:

1. Download the CSV template; fill it in Excel. Mandatory per row: **Name** and
   **Price to Patient (RM)** — and remember the price is **per pack**, not per tablet.
2. Fill **Stock Unit** and **Quantity per Stock Unit** for every medicine (or the word
   `DISPENSED_WHOLE` for whole-unit items like syrup bottles). *This is the field that
   makes dispensing and billing work.*
3. **Check file** (dry run) → fix every reported line → **Apply**. The import is
   all-or-nothing and matches by item name, so re-running is safe.
4. After import, open the red **"N items need attention"** chip and fix every listed
   item (missing pack quantity / unconfirmed 1). **Target: "Nothing needs attention."**
   Any item left on this list will refuse to dispense at the counter.

Add one-off items manually with **Add Item** (same fields in a drawer). Set categories
as you go (type new ones inline).

**6c. Panel item prices** *(if applicable)* — now that items exist, add per-panel item
overrides (from the panel's Pricing & Exclusions, or the item's own Panel Pricing
section).

**6d. Minimum thresholds** — Inventory ▸ Stock Health ▸ **Set Min Threshold**, per
item **per branch**, for everything you want on the Low Stock radar.

**6e. Opening stock** — count the shelf, then record it per branch. **Recommended:
Stock Health ▸ Stock In**, one entry per item (per batch if you want expiry tracking):
branch, item, quantity **in packs**, supplier (optional), **expiry date and batch
number** (do fill these — they power the Near Expiry list and cannot be attached
later). For items where batch/expiry doesn't matter, a Stock Take (Inventory ▸ Stock
Take: type the counted quantity per item, submit) is a faster way to set balances —
but it records no batches.

**Depends on:** Steps 1 and 5 (branches; panels for 6c), Step 4.3 (vocabulary for the
import).
**Depended on by:** dispensing, medicine billing, all stock screens, Drug Movement.

- [ ] Item list imported; **"Nothing needs attention"** shows on the Items page.
- [ ] Every stocked item shows the correct opening balance under Stock Health, per
      branch, **counted in packs**.
- [ ] Near Expiry (180-day window) lists your genuinely short-dated batches.
- [ ] Thresholds set; Low Stock shows only what is truly low.

---

## Step 7 — Public holidays and known leave

**Who:** owner or admin. **Where:** Clinic Settings ▸ HR & Attendance ▸ **Public
Holidays**; then Clinic Settings ▸ Appointments & Scheduling ▸ **Branch Booking
Rules**; leave at Management ▸ HR ▸ **Leave Requests**. **Manual:** 9.6–9.7.

1. Type in this year's public holidays (date + name) — there is no preset list.
2. For each branch that **closes** on public holidays, switch on **"observe public
   holidays"** in that branch's Booking Rules. *(Off by default; without it the
   holiday list does nothing.)*
3. Enter any already-known staff leave and **approve** it, so the diary blocks those
   dates before patients book.

**Depends on:** Steps 1–2. **Depended on by:** the booking diary.

- [ ] Holidays entered; the observe toggle matches each branch's actual practice.
- [ ] Known future leave is Approved (pending leave blocks nothing).

---

## Step 8 — Queue rooms and display (front-of-house dependency)

**Who:** owner. **Where:** Clinic Settings ▸ Queue & Visit Workflow.

Create each branch's **Rooms & Stations** (consultation rooms, treatment room — none
exist until you add them) and review the **Queue Screen** settings. This is
front-of-house configuration, listed here because the Waiting Times report and visit
flow (which Management reads) depend on a working queue.

- [ ] Rooms exist for each branch; the queue can be operated.

---

## Step 9 — Roster, availability and booking rules (front-of-house dependency)

**Who:** owner. **Where:** Appointments ▸ Roster & Availability; Appointments ▸
Services; Clinic Settings ▸ Appointments & Scheduling ▸ Branch Booking Rules.

Set each branch's booking rules (opening band, notice, horizon), each doctor's weekly
pattern or roster, and which services are bookable by whom. Details are the
Appointments module's own concern (see `APPOINTMENTS_OWNER_GUIDE.md`); Management
consumes the results (appointment analytics, provider workload, leave interaction).

- [ ] Each doctor shows availability on the diary for the coming fortnight.

---

## Step 10 — Prove the chain: one test patient, end to end

**Who:** owner + one counter person + one doctor (15 minutes). This is the smoke test
that proves setup; the full scripted version is `MANAGEMENT_OWNER_UAT_GUIDE.md`.

1. Register a test patient (clearly named, e.g. "ZZ Test Patient"), add to queue as
   **Cash**.
2. Doctor: consult, prescribe one real medicine (e.g. 30 tablets of a 10-per-strip
   item), order one service, sign the note.
3. Dispense at the dispensary — expect no "needs attention" refusal.
4. Billing Review: **Create invoice** — expect the consultation fee to appear
   automatically, the medicine priced in packs (3 × strip price), the service at
   catalogue price. Take payment (Cash).
5. Now check Management:
   - [ ] **Stock Health**: the item's balance dropped by the right number of **packs**.
   - [ ] **Day-End Closing** (today): the payment appears under Cash; patient counted.
   - [ ] **Invoice Listing**: the invoice shows Paid with the right amounts.
   - [ ] **Executive Dashboard** (range: today): revenue and patient tiles are non-zero.
   - [ ] **Patient Analysis**: 1 visit, 1 unique, 1 new patient.
   - [ ] **Attendance**: a row for the doctor, today.
6. Repeat steps 1–4 once as a **Panel** patient (verify terms on the visit's Billing
   Review — e.g. limit RM 200 — settle with "Panel — No Patient Payment" if the
   patient owes RM 0), then:
   - [ ] **Panel Claims** ▸ your panel: the invoice appears as eligible/**Unclaimed**.
   - [ ] Create a batch, submit it (method: Other, reference: TEST), record the line
         **Paid** in full, **Reconcile**.
   - [ ] **Outstanding Aging** is empty again and the Dashboard's Panel Outstanding
         is RM 0.

If every box in Step 10 ticks, your Management setup is complete and coherent. Leave
the test records in place until UAT is finished (they cannot be deleted anyway — only
deactivated/cancelled), and name test data obviously.

---

## What you do NOT need to set up (because it does not exist yet)

To save you searching for missing setup screens: there is no setup for payroll or
statutory contributions, employee salary/contracts, leave entitlements/balances,
doctor incentives, SST/tax, e-Invoice (LHDN), supplier payment terms, expense
categories, cash floats, stock locations within a branch, or barcode scanners. See
`MANAGEMENT_USER_MANUAL.md` Chapters 10 and 12, and Appendix A, for the full honest
list and workarounds.
