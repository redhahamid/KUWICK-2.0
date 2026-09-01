# Stage 1 + Stage 2 — Visual UAT

Thirty screenshots in `docs/payroll-stage12-uat/`, captured by
`apps/api/prisma/payroll-stage12-shots.ts` against the running application and
the synthetic `Klinik Contoh (UAT)` tenant. Every name, identifier and figure in
them is invented; every email is on the `.invalid` TLD, which cannot route.

**Not a route sweep.** The script drives the workflow a clinic manager would:
enter PCB against the exception that demands it, recalculate, watch the gate
clear, approve, reopen with a reason, change a figure, read the diff, approve
again. Half of what Stage 2 built only exists in a state you have to reach — a
candidate diff needs an approval and a reopen behind it — and photographing the
routes alone would have photographed the empty case.

---

## The pack

| # | Surface | What it shows |
|---|---|---|
| 01 | A | Two employers, the pay-component catalogue, "Could it file?" per employer |
| 02 | A | Editing the employer missing its SOCSO and LHDN numbers |
| 03 | A | A new employer: every statutory identity in its own field |
| 04 | B | The employee directory |
| 05 | B | The record: employment (incl. legal employer), person, pay basis, salary history, statutory |
| 06 | B | Recording a change: amount, basis, date in force, reason |
| 07 | B | Backdating into a period the row in force covers — refused, in the server's words |
| 08 | D+E | The whole run: statutory notice, gate sentence, lines, exceptions, variance, snapshots |
| 09 | D | BLOCKING and WARNING, told apart by a left rule as well as colour; a passed warning keeps its reason |
| 10 | D | Passing a warning: consequence restated, reason demanded |
| 11 | E | Approve disabled by the same gate object the banner quotes |
| 12 | C | Payroll inputs for one employee, reached from the exception that needs one |
| 13 | C | Adding a figure: component, amount, recurring vs additional, reason |
| 14 | C | A refused save answered on the page, not by a dead button |
| 15 | C | PCB entered by hand, because the system does not calculate it and says so |
| 16 | C | The saved figure with its provenance: who, when, why |
| 17 | E | Every blocker resolved; warnings stay on the record; Approve available |
| 18 | E | The approval confirmation: totals, blocker and warning counts, what approving admits |
| 19 | F | Approved and locked: snapshot v1, hash, totals, approver |
| 20 | F | Reopening demands a reason, and says the previous snapshot is kept |
| 21 | F | Reopened to CALCULATED with v1 still standing |
| 22 | F | What a second approval would change against v1, per employee and per figure |
| 23 | F | v2 beside v1: two versions, two hashes, neither overwritten |
| 24 | B | A pay change dated into an approved period — refused: what they were paid is settled |
| 25–30 | Responsive | Payroll run and Legal employers at 1194×834, 834×1194, 390×844 |

---

## Defects found, and fixed

| # | Severity | Finding | Fix |
|---|---|---|---|
| V-1 | **Blocking** | PCB could not be entered anywhere in the product. The inputs drawer only renders its Add button when it knows which employee a figure is for, and the only thing that opened it passed no employee. Since a PCB-applicable employee with no PCB raises a non-overridable blocker, **no run containing one could ever be approved.** | The exception centre offers "Enter it now" per PCB row, and each payroll line has an "Inputs" action. Both open the drawer for that person. |
| V-2 | **Blocking** | Every one of the twelve remedy links in the exception catalogue pointed at a route nobody had mounted. "Go and fix it" from a blocking exception went to a blank page. | Links now name mounted routes; `?staffId=` opens that person's record. A unit test asserts every link resolves to a route in `App.tsx`. |
| V-3 | **Blocking** | The new salary form sent `amount` as a number; `RecordSalaryDto` validates a string against `/^\d{1,10}(\.\d{1,2})?$/`. Every save was rejected — the form could not succeed once. | Sends the cleaned string, strips `RM` and thousands separators, and refuses more than two decimals on the page. Five unit tests. |
| V-4 | High | An APPROVED run against unverified rates showed a plain green `APPROVED`. Green next to "Unverified rates" invites exactly the reading the programme forbids. | The tag reads `APPROVED · PROVISIONAL` in amber whenever the statutory status is not CONFIGURED, with a tooltip saying it is not fit to pay or file from. |
| V-5 | Medium | The employee record showed the branch but not the legal employer — the fact that decides whose EPF number a person is filed under was invisible on the screen that claims to hold their whole employment. | `legalEmployerName` on the record payload, rendered beside Branch as a separate fact. |
| V-6 | Medium | The pay-basis block said "Change it in the employee form." There is no employee form: `useUpsertEmployee` is defined and used by nothing. | Says what is true — the write endpoint exists, the form for it does not. |
| V-7 | Low | The snapshot panel rendered `payroll_snapshots.reason`, which nothing ever writes. | Removed from the display; the gap is reported below rather than papered over. |
| V-8 | Low | On a phone the header put the branch picker beside the title, leaving about eight characters: "Administration" broke into "Administrati / on". | Below 560px the two stack and the title never hyphenates. |

Fixture defects found and fixed in the same pass: the seed claimed the locum had
no pay basis while his profile carries an hourly rate (the engine disagreed on
the first Recalculate); the reset list did not cover the eight Stage 1 + 2
tables, so the seed failed the *second* time it was run; the run wrote its
exceptions only as a JSON blob and not as rows.

---

## Unresolved — reported, not fixed

1. **Effective-dated salary is not read by payroll.** `resolveSalaryForPeriod`
   is called only by `GET /employees/:id/salary/resolve`. `calculate()` reads
   `employee_profiles.basic_salary`. So a manager can record a salary on the new
   screen and the run will still say "no salary is in force for this period".
   Changing which figure the engine reads changes every payslip and needs an
   explicit decision.

2. **There is no employee form.** `useUpsertEmployee` has no caller, so basic
   salary, bank details and statutory numbers cannot be edited in the product at
   all. The capture sets one salary through the endpoint the missing form would
   call, and says so where it does it.

3. **"All branches" shows one branch.** `EmployeeService.list` resolves
   `params.clinicId ?? actor.clinicId`, so an unset filter falls back to the
   actor's own clinic: the directory showed 5 of 8 employees, hiding both people
   at Contoh Bandar and one with no clinic. The same `?? actor.clinicId ??`
   pattern appears in **fourteen** services across Finance, Stock, Panel and HR,
   so this is a convention rather than a local slip, and changing it changes who
   can see whom. Owner decision.

4. **INFO severity cannot be produced.** The enum has it, the gate counts it and
   the centre renders it, but no catalogue template carries it — so surface D's
   INFO state has nothing to capture. Either a template is missing or the
   severity should go.

5. **Half the exception catalogue is unreachable.** `classifyLegacyException`
   maps six codes. `NO_LEGAL_EMPLOYER`, `NO_BANK_DETAILS`, `NEGATIVE_NET`,
   `SALARY_CHANGED_MID_PERIOD`, `STATUTORY_UNVERIFIED` and
   `VARIANCE_OUTSIDE_THRESHOLD` are defined and never emitted.

6. **`payroll_snapshots.reason` has no writer.** `approve()` does not set it;
   `reopen()` records its reason on the audit trail (`after._reason`). Either
   carry the reopen reason onto the next snapshot or drop the column.

7. **An override does not survive a recalculation.** `calculate()` deletes and
   rewrites the exception rows, so a warning passed with a reason is silently
   un-passed by the next Recalculate. Arguably correct — new figures, new
   facts — but a person who wrote a reason will not expect it to vanish.

8. **The component picker is virtualised with no search.** Sixteen components,
   ten in the DOM at a time; PCB is below the fold. Fine at this size, not at
   forty.

---

## Design bar

Deep navy structure, restrained teal, neutral ground, semantic colour reserved
for meaning. No purple, no glassmorphism, no gradient cards. Severity is
distinguishable without colour — blocking carries a solid left rule and the
heaviest weight, warning a lighter one, info none — so the three survive
greyscale and red/amber colour blindness. Money is tabular and right-aligned;
the NOT-READY panel is the loudest thing on the payroll screen at every width.

**Salary confidentiality:** salary history is behind `hr.salary.view` and the
panel says which of "there is nothing on file" and "you may not see this" it is
showing. The bank account number is never returned by the record endpoint.

**Responsive:** the dense payroll grid scrolls horizontally on a phone rather
than being squashed — the documented policy for these tables. The NOT-READY
banner takes most of the first mobile screen, which is deliberate.
