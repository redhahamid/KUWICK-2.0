# Piece 2 — the statutory treatment of a component belongs to the clinic

UAT finding #17: *component statutory treatment locked but unverified.* The
owner asked for two things — that they be able to edit each component's
treatment with a reason and an effective date recorded, and that the clinic be
able to create components of its own.

`[D]` marks what was read in the code or the database, `[A]` an assumption,
`[O]` an owner decision.

## 1. What was already there

`[D]` More than expected. `pay_components` is effective-dated, carries an
independent flag per scheme (EPF, SOCSO, EIS, PCB, HRD, the ORP base, the
unpaid-leave base, additional remuneration), has a verification status and a
source reference, and **the engine already reads it by period** rather than a
hardcoded map — `component-liability.ts` says so at length, and says which two
figures the old map had wrong.

`[D]` `upsert` already turned a treatment change into a new dated version,
already refused one with no effective date, and already refused to date a
change into a period an approved run covers.

## 2. The rule that changed

`[D]` `pay-component.service.ts` refused outright:

> *"A preset may be enabled or disabled, never redefined… a clinic that can
> silently retype the EPF liability of basic pay has a payroll nobody can
> reason about."*

`[D]` All eight components in the owner's table are seeded presets, so **not
one of the six cells they needed to change could be changed at all.**

`[O]` The load-bearing word in that comment is **silently**, not *never*.
Whether an allowance attracts EPF is not a fact about Malaysia that a product
can ship — it is a policy the clinic sets within what the law permits, and
clinics differ: one contributes on basic pay only, the next contributes on
allowances too. Freezing the seeded guess makes the product wrong at half its
customers. The seeded values say so themselves: *"Seeded to reproduce the
existing engine behaviour. Not verified against any authority."*

So the refusal moved rather than disappearing.

### What is still refused

`[D]` **What a component IS.** `type` drives `kindOf` in the calculation and
`category` drives the year-end classification, so redefining `OVERTIME` as an
allowance does not express a policy — it breaks the arithmetic that reads it.
That returns `409` with the reason on it.

`[D]` **Overtime in the ordinary-rate base**, clinic-defined or not: an hour of
overtime would raise the rate paid for the next one.

`[D]` **A date an approved run already covers.** What was paid under the old
treatment is settled.

### What a change costs

`[D]` A date, then a reason, then a new version — never an edit in place.

`[D]` The reason used to be optional and to reach only the audit log's free
text. It is now **required and stored on the version it explains**, because a
year later the screen showing "EPF ✗ on allowances" is what the person
defending the figure to KWSP has open — not an audit log.

`[D]` The new version is marked `clinicOverride`, and the seed's `sourceRef` is
**not** carried onto it. Every seeded row cites Kuwick; carrying that onto a
version the clinic chose would let a payslip cite Kuwick as the source of
somebody else's decision.

## 3. The owner's table

`[D]` Six cells across six components differ from what Kuwick seeds. Overtime
and Director's fee already matched.

| Component | Code | Seeded | Clinic wants | Moves |
|---|---|---|---|---|
| Procedure incentives | `INCENTIVE` | EPF ✓ | EPF ✗ | EPF |
| Commission/other | `COMMISSION` | EPF ✓ | EPF ✗ | EPF |
| Allowance | `ALLOWANCE` | EPF ✓ | EPF ✗ | EPF |
| Attendance allowance | `ATTENDANCE_ALLOWANCE` | EPF ✓ | EPF ✗ | EPF |
| Overtime | `OVERTIME` | ✗ ✓ ✓ ✓ | ✗ ✓ ✓ ✓ | — |
| Locum, own employee | `LOCUM_FEE` | SOCSO ✗ EIS ✗ | SOCSO ✓ EIS ✓ | SOCSO, EIS |
| Director's fee | `DIRECTOR_FEE` | ✗ ✗ ✗ ✓ | ✗ ✗ ✗ ✓ | — |
| Mileage/travelling | `MILEAGE` | PCB ✓ | PCB ✗ | PCB |

`[O]` **The seed is not changed to match it**, and that is deliberate. EPF ✗
across those rows is this clinic's policy — EPF on basic pay only — not a claim
about Malaysian law, and the owner was explicit that other clinics use
different figures. Shipping their table as the product's default would hardcode
one clinic's policy in place of another's. The table is expressed where it
belongs: as something a clinic *does*, proven end to end in
`pay-component-treatment.e2e-spec.ts`.

`[D]` `LOCUM_FEE` moving to SOCSO ✓ EIS ✓ is worth naming: the seeded ✗ ✗ reads
as an assumption about an EXTERNAL locum. An own employee's locum session is
wages. External locums are contractors, paid outside payroll entirely —
`payroll.service.ts` excludes `engagement: 'CONTRACTOR'` with a
`CONTRACTOR_EXCLUDED` exception, and this piece does not touch that.

## 4. A component the clinic makes itself

`[D]` The API path already existed; what was missing was a way in. A new
component starts **liable to nothing except PCB** — pay is taxable unless
something says otherwise, and a form that pre-ticked EPF, SOCSO and EIS would
be Kuwick guessing at a clinic's policy and calling it a default. It is
`systemControlled: false` and `DRAFT` by construction: nobody has checked it
against KWSP either.

## 5. Two things found on the way

`[D]` **`list()` returned every version there had ever been.** No date filter
at all, so the first component a clinic re-dated would appear TWICE on the
settings screen with nothing to say which was which. Unreachable while presets
were frozen; reachable by design now.

`[A]` My first fix was worse than the bug: filtering to *what is in force
today* hides a change dated from next month, so an owner who had just made
allowances EPF-exempt from 1 October would reopen the screen, see EPF ✓, and
conclude the product had thrown their decision away — the same defect as Piece
1b's dead link, one screen along. Four tests caught it. The list shows the
**standing** version and the date it begins.

`[D]` **A test asserted the old rule.** `payroll-stage2.e2e-spec.ts` held
*"refuses to redefine a system preset's statutory treatment"*. It was rewritten
rather than deleted, into the three things that are actually worth protecting:
identity fixed, evidence required, and only then the change.

## 6. Files

| File | What changed |
|---|---|
| `apps/api/prisma/schema.prisma` | `clinicOverride`, `changeReason` on `PayComponent` |
| `…/migrations/20260913140000_pay_component_change_reason/` | Two columns, no backfill |
| `apps/api/src/workforce/pay-component.service.ts` | Presets unlocked behind evidence; reason stored; `list()` fixed; `history()` added |
| `apps/api/src/workforce/workforce.controller.ts` | `GET /workforce/pay-components/:code/history` |
| `apps/api/src/workforce/dto/upsert-pay-component.dto.ts` | `reason` documented as required for a treatment change |
| `apps/web/src/admin/hr/PayrollItemsPage.tsx` | Switches live on presets; provenance on the row; history drawer; add-an-item |
| `apps/web/src/admin/hooks/useAdmin.ts`, `types.ts` | `usePayComponentHistory`, the version type |
| `apps/web/src/admin/hr/ui/slate.css` | `.hr-decided`, `.hr-versions`, `.hr-newFlags` |

## 7. Tests

| File | What it holds |
|---|---|
| `apps/api/test/pay-component-treatment.e2e-spec.ts` | 17 tests: the unlock, the identity refusal, the evidence, the history, clinic-made components, and the owner's whole table end to end |
| `apps/api/test/payroll-stage2.e2e-spec.ts` | The old rule's test, rewritten to the new contract |
| `apps/web/src/admin/hr/payrollItems.test.tsx` | 8 tests: the switch is live, it still asks when and why, the row says whose decision it was, history keeps Kuwick's guess and the clinic's apart, a new item starts liable to nothing but tax |

## 7b. The demo world decides, and the months are priced under it

`[D]` `seed-hr-uat.ts` now applies the clinic's table **through the same
endpoint an owner uses** — dated, reasoned, marked as the clinic's — before
the three payroll months are calculated. Not in the product seed: the demo
tenant is a clinic that has made these decisions, which is a different thing
from Kuwick shipping them.

`[D]` It is idempotent by comparison, not by a flag: on a re-run the months
below are already approved and a treatment change dated into an approved
period is refused, correctly. Nothing differs, so nothing is sent.

`[D]` Measured against the database afterwards, not inferred from the log:

| Component | Versions | Clinic-decided |
|---|---|---|
| `ALLOWANCE`, `ATTENDANCE_ALLOWANCE`, `COMMISSION`, `INCENTIVE`, `LOCUM_FEE`, `MILEAGE` | 2 | yes |
| `BASIC`, `DIRECTOR_FEE`, `OVERTIME` | 1 | no |

Six versioned, three untouched — and the three untouched are exactly the ones
that already matched or were never in the table. A no-op edit did not litter
the history.

`[D]` Version 1 closes `2026-05-31` and version 2 opens `2026-06-01`: no gap,
no overlap, so every period resolves to exactly one treatment.

### It reached the money

`[D]` Dr Meera Kaur, June, read from `payroll_lines`:

| | |
|---|---|
| Gross pay | RM 10,400.00 |
| of which allowances | RM 900.00 |
| Basic | RM 9,500.00 |
| **EPF employee** | **RM 1,045.00** |

RM1,045 is 11% of **9,500**, not of 10,400. Under Kuwick's seeded treatment it
would have been RM1,144. The clinic's decision moved RM99 in one month for one
employee, which is the whole point of the piece: the flags on that screen are
what the engine reads.

Screenshots: `docs/screenshots/hr-components/`.

## 8. Gates

`[D]` Run **sequentially**, on 2026-09-13.

| Gate | Piece 2a–2c | Piece 2d (final) |
|---|---|---|
| API unit | 131 suites, **2775 passed** | 131 suites, **2775 passed** |
| API e2e | 42 suites, **489 passed** | 42 suites, **493 passed** |
| Web unit | 104 files, **1755 passed** | 104 files, **1760 passed** |
| Browser | 102 collected, **99 passed**, 3 skipped | 102 collected, **100 passed**, 2 skipped |

`[D]` Zero failures in either column. The 2d numbers grow by the four e2e tests
and five web tests that piece added; the browser gate skips only its two
env-gated tools this time, because the day-end world had been reseeded and its
day was open again.

`[D]` The web figures add up: 100 files → 104 across Pieces 1b and 2, 1728 →
1755. The browser gate's third skip is the day-end test documented in Piece 1
§9.2, which skips itself once an earlier run in the same session has closed the
day.

### 8.1 The e2e gate went red, and it was this piece's doing

`[D]` The first full run reported **"Test suite failed to run"** against two
suites, with **zero assertion failures** and a different suite named each time.
The message was `A jest worker process was terminated by another process:
signal=SIGKILL` — the OOM killer, not a test.

`[A]` "Flake" would have been the wrong answer. Measured instead:

| Run | Suites | Result |
|---|---|---|
| 42 suites, default workers (3) | this piece's tree | **worker SIGKILLed** |
| 42 suites, `--maxWorkers=2` | this piece's tree | 489 passed |
| 41 suites, default workers | this piece's tree, new spec moved aside | 472 passed |

`[D]` So the gate was already at the edge — every e2e worker boots a whole Nest
`AppModule` and its Prisma client, and three of those on a 4-CPU container is
the limit — and **the 42nd suite, which is mine, tipped it over.**

`[D]` Fixed by capping `maxWorkers` to 2 in `jest-e2e.json`, with the reasoning
in `global-setup.ts` because a JSON config cannot carry a comment. The cap is
there rather than in my suite, because the next suite anyone adds would have
hit exactly this. The gate command itself — `npm run test:api:e2e` — now
reports 42 of 42.

### 8.2 The browser gate went red twice, and neither was this piece

`[D]` Both failures were **world residue from running the gate repeatedly
against a persistent development database**, not defects. Proven, not assumed:

**`admin-hr.spec.ts:128`** — *payroll is honest in both directions*. It opens
August 2026 and expects a **Calculated** chip. I had just run `seed-hr-uat.ts`
on the dev database, which takes the last three months — June, July and August
— through the engine to **paid**. Re-seeding the base world with
`seed-admin-uat.ts`, where August is calculated and not approved, made it pass
immediately. The 3f README already records that these two worlds differ; this
is that note arriving as a red gate.

**`canvas-appointment.spec.ts:40`** — *the card, the mapping, the capacity, and
the appointment that results*. It asserts a follow-up lands at a **fixed**
16 Sep 2026, 14:00–14:30, while the booking it makes takes the **next free**
slot. Every run consumes two slots and never releases them, so the world walks
forward and the assertion is left behind. The database showed it plainly —
thirteen `FRONT_DESK` bookings created today, two per run, marching from 08:00
to 14:00 local:

```
09:09 → 08:00, 08:30     16:01 → 11:00, 11:30
09:37 → 09:00, 09:30     17:42 → 12:00, 12:30
14:36 → 10:00, 10:30     17:56 → 13:00, 13:30, 14:00
```

`[D]` Cancelling those thirteen — the database **refuses a delete**, because an
appointment is an append-only medicolegal record and the trigger says so —
made both specs pass, 7 of 7.

`[A]` Worth its own piece, not this one: **three** browser tests now cannot run
twice against the same world. `admin-integration.spec.ts:153` skips itself
silently (Piece 1 §9.2), `canvas-appointment.spec.ts:40` fails loudly, and
`admin-hr.spec.ts:128` depends on which of two seeds ran last. Loud is better
than silent, and all three are better than neither. Each one costs an
investigation every time it bites, and it has now bitten in Pieces 3e, 3f and
here.

## 8b. Piece 2d — two findings from the owner's staging test

### A version that has not started is a plan, not history

`[D]` The owner mis-tapped EPF on overtime, saved it from 1 October, and could
not undo it. The same date came back *"The current version of OVERTIME starts
on 2026-10-01, which is not before 2026-10-01"*, so the only way out was a
**third** version from November — leaving a month of a treatment nobody wanted,
recorded as though it had been decided.

`[O]` The rule that produced that is right about the past and wrong about the
future. What makes a version immovable is that **money was paid under it**, and
nothing is paid under a version that has not begun. So while a version has not
started, editing it edits **that** version:

| Situation | What happens now |
|---|---|
| Open version has not started; flags change | It is **corrected in place**, keeping its version number |
| Open version has not started; flags return to the previous version's | It is **withdrawn entirely** and the previous version reopens |
| Open version is in force | Unchanged: a new version, from a later date |
| Any date an approved run covers | Unchanged: refused |

`[D]` The withdrawal matters as much as the correction. A row recording that
the clinic decided the same thing twice is something an owner would have to
explain to an auditor who asked why. The mis-tap stays in the **audit log**,
where a mistake belongs, and leaves the catalogue as though the tap had not
happened.

`[D]` `pay_components` carries **no append-only trigger** — checked against the
database, not assumed. `appointments` does, and refused a delete outright
during Piece 2c's investigation with *"This is a medicolegal record"*. The
distinction is the right one: an appointment records something that happened; a
configuration version that never took effect records nothing.

`[D]` The approved-run guard sits at line 399 and the correction branch at 412,
so the guard still decides first on both paths. A test creates an approved run
and proves the correction is refused through it — and removes the run again,
because the guard counts every approved run from that month onwards and the
fixture would otherwise block every earlier-dated change in the file.

`[A]` One trade, stated rather than hidden: **one future version at a time.**
Re-dating an unstarted version moves it rather than scheduling a second change
behind it. Two queued future changes to the same component cannot be expressed
until the first takes effect. That is the shape that matches "undo my mistake",
which is the case that actually came up.

### The reason stays mandatory, and stops being typing

`[D]` The owner works from a phone and asked for common reasons as a dropdown
**and** the free-text box kept — and was explicit that the reason itself must
stay mandatory: *"setahun lagi bila KWSP tanya, sebab yang jelas itu yang
menyelamatkan saya."*

`[D]` Four reasons, as opening sentences rather than codes — clinic policy, a
KWSP circular, the auditor's advice, correcting a mistaken tap. Picking one
fills the box; the box is still a box, so it can be finished by hand. On a
phone that is four taps and no typing. The mandatory check is untouched.

`[D]` The popover also stopped lying about which of the two things it is doing.
It said *"a new version, not an edit"* for every change; on a version that has
not started it now says the change **replaces** it, because that is what
happens.

### No migration

`[D]` **This piece adds none.** The correction is service logic, the dropdown
is a screen, and the two new audit actions go into `audit_logs.action`, which
is a plain `text` column rather than a Postgres enum — checked.

### 8.3 Two more red gates, and what they cost to diagnose

`[D]` The 2d gate run came back with **API e2e red and the browser gate red**.
Neither was the code.

**The browser gate had nothing to test against.** The container had restarted
between pieces, taking the API and web dev servers with it; every spec that
needs a running app failed. `curl` on both ports returned nothing at all, which
is the whole diagnosis.

**The API e2e failure could not be diagnosed at all**, because the gate script
captured only the last six lines and those were npm's own "command failed".
A re-run of the same tree passes 42 suites and 493 tests. I can say it was
transient; I cannot say what it was, and that is a worse answer than it needed
to be.

`[D]` So the gate script now keeps the **full** log of each gate and prints the
first failures when one goes red. This is the third time a red gate has thrown
away the one thing that would have explained it — Piece 2's OOM, Piece 2c's two
world-residue failures, and this. Each cost a whole re-run to find out.

`[A]` Also worth naming, since it has now bitten twice: **the browser gate
depends on dev servers that nothing starts or checks.** A gate that reports
failure when its target is simply absent is a gate that will be believed at the
wrong moment. Not fixed here.

## 9. Still to do

`[D]` **Staging needs the seed workflow.** This piece adds two columns to
`pay_components`, so `prisma migrate deploy` has to run before the code that
reads them. No new table, so the role's grants already cover it and no
re-provision is needed.

`[A]` Not built here, and worth naming: nothing yet **raises**
`verificationStatus` above `DRAFT`. A clinic that has checked a flag against
KWSP's own schedule still cannot say so on this screen. That belongs with the
statutory register rather than with this piece.
