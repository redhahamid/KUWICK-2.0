# UAT Prompt 1 — a new branch cannot run its first January

Five blockers reported from a UAT on a newly created branch (three employees,
all joined 1 January 2026, testing a January-to-December year from scratch).
January payroll could not be run at all.

Every statement below is tagged **[D]** — observed in code, tests or the
running system — or **[A]** — an assumption.

## What was actually wrong

The five reports were three defects, plus one more found while proving the
fix end to end.

### 1. The first statutory standing row could not be corrected

- **[D]** `POST /workforce/employees/:id/statutory-classification` was
  append-only. A statement dated at a row that already existed was refused
  with *"Correct that row rather than adding a second one for the same day"*,
  and nothing in the product could correct a row.
- **[D]** The Add employee form writes the first row from the join date
  carrying only the EPF Part, MTD category and tax residence
  (`AddEmployeePage.tsx:150-172`). LINDUNG and the rest day are never asked.
- **[D]** So for an employee's first month those fields were unreachable, and
  readiness blocked on them. Reproduced: `statutory-standing-first-month.e2e-spec.ts`
  failed 6 of 7 cases with **409 Conflict** before the fix.

**Fix [D]:** a statement dated at an existing row now *restates that row* in
place — same dates, same recorder, an audit row
(`employeeStatutoryClassification.corrected`) with before and after. The
approved-run refusal still applies to a correction. What the statement does
not mention is kept (the EPF Part the form recorded is not blanked by a form
that only asks about LINDUNG). The employee record's history table gains a
**Correct** button on every version, opening the same form with the date
locked to that row's own date and prefilled from that row only.

### 2. "In force from" reverted to the current month

- **[D]** The API stores the date it is sent. Proven by e2e: a statement
  dated 2026-01-01 is stored as 2026-01-01.
- **[D]** The form posts the date it shows. Proven by vitest: picking
  1 Mar 2026 posts `2026-03-01`.
- **[D]** No code dropped or overwrote the date. What happened in UAT:
  the same-date statement was refused (defect 1), the only way to try again
  was to reopen the form, and reopening resets *In force from* to the current
  month — 1 Sep 2026 — which is the row that got saved.
- **[A]** The screenshot showing 1 Jan 2026 was of the refused attempt.

**Fix [D]:** a correction's date is the row's own and cannot be moved; the
form says which of the two acts it is doing in its title.

### 3. LINDUNG 24 JAM (SKBBK) read "Not recorded" after saving

- **[D]** The DTO accepts `lindungParticipation`, the service writes it, the
  record endpoint returns it and the screen prints it. Once the row could be
  corrected, the e2e proves it persists on the row *and* on the record the
  Statutory tab reads.
- **[D]** In UAT nothing had saved: the same-date statement was refused
  (defect 1). Two employees, same cause.

### 4. Rest day blocked payroll and had no reachable field

- **[D]** The Employment & salary tab prints *Working days* from the rest
  day, and the Edit employment drawer had no field for it. The only input was
  the statutory form, unreachable for month one (defect 1).

**Fix [D]:** *Rest day* is now in the Edit employment drawer, and the help
text states the date it will be recorded from before it is saved. Never
recorded before → written onto every standing version that is silent about
it, back to the first, so the first month has one. Already recorded → a
change, dated from the first of this month. A refusal of the rest day says
that the employment record saved and the day did not.

### 5. The modal stayed open after a "successful" Record

- **[D]** `setOpen(false)` was on the success path. The modal stayed open
  because the save had been *refused* (defect 1) and the refusal was rendered
  at the top of a scrolled body, out of sight of the Record button. Pressing
  again got the same refusal, which reads as "duplicate".
- **[D]** Structural fragility found while pinning this: closing the modal
  sat inside the same `try` as the write, so anything that threw *after* a
  successful write was shown as a refusal with the form still up.

**Fix [D]:** the refusal is now scrolled into view (`useProblemFocus`, the
same idiom the drawers use); closing is the write's own consequence and sits
outside the `try`; and a repeat of the same statement is accepted rather than
called a duplicate, so a double press cannot produce an error.

### 6. Starting a month opened an empty grid (found during verification)

- **[D]** *Start January 2026 payroll* created the run and stopped. The grid
  then showed a dash in every cell, RM0.00 in every total, every employee
  *left out*, and *Continue to review* disabled — exactly the screen reported
  under blocker 4, even with every readiness item green. The only way on was
  *Save draft*.

**Fix [D]:** starting a month works it out. A failure to calculate still opens
the run and shows why.

## Verified end to end, through the screens

`e2e/first-month-payroll.uat.ts` (run by hand with `playwright.uat.config.ts`,
not part of the gate) creates a fresh branch, adds three people through the
real Add employee form joined 1 Jan 2026, sets the rest day in the Edit
employment drawer, corrects the January standing with LINDUNG, tax residence
and MTD category, and opens January payroll.

Screenshots in `docs/screenshots/p1-first-month/`:

| | |
|---|---|
| 01 | Three people, joined 1 Jan 2026, on the new branch |
| 02 | January before: 3 people will hold up approval — Legal employer, Rest day, PCB, EPF/SOCSO/EIS |
| 03 | Rest day in the Edit employment drawer, with the date it lands on |
| 04 | Correcting the standing from 1 Jan 2026 |
| 05 | Statutory tab after: LINDUNG Opted out, Rest day Sunday, one version 1 Jan 2026 — now |
| 06 | January: RM8,500.00 gross, 0 blocked, every row Ready, Continue to review enabled |
| 07 | Review stage reached |

January figures **[D]**, from the run, footing to the sen:

| Employee | Basic | EPF | SOCSO | EIS | Net |
|---|---|---|---|---|---|
| Amirah | 2,800.00 | 308.00 | 13.75 | 5.50 | 2,472.75 |
| Farhan | 3,200.00 | 352.00 | 15.75 | 6.30 | 2,825.95 |
| Nabila | 2,500.00 | 275.00 | 12.25 | 4.90 | 2,207.85 |
| **Total** | **8,500.00** | **935.00** | **41.75** | **16.70** | **7,506.55** |

Employer: EPF 1,105.00 · SOCSO 146.15 · EIS 16.70 · total 1,267.85 · cost
9,767.85. SKBBK 0.00 because all three were recorded as opted out. PCB 0.00
at these salaries under Category 1.

The same journey is a permanent API test: `first-month-payroll.e2e-spec.ts`.

## Not changed, on purpose

- **[D]** The Add employee form still does not ask for SKBBK, the rest day
  or the employing company. That is Prompt 3's item; the edit paths above
  make them reachable afterwards.
- **[D]** The form's *Payroll readiness* panel on its last step does not list
  the rest day or LINDUNG among what payroll will still be missing. Same
  prompt.
- **[D]** No migration. No schema change.
