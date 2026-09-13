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

## 8. Gates

`[D]` Run **sequentially**, on 2026-09-13.

| Gate | Result |
|---|---|
| API unit | 131 suites, **2775 passed**, 0 failed |
| API e2e | 42 suites, **489 passed**, 0 failed |
| Web unit | 104 files, **1755 passed**, 0 failed |
| Browser | 102 collected, **99 passed**, 0 failed, 3 skipped |

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

## 9. Still to do

`[D]` **Staging needs the seed workflow.** This piece adds two columns to
`pay_components`, so `prisma migrate deploy` has to run before the code that
reads them. No new table, so the role's grants already cover it and no
re-provision is needed.

`[A]` Not built here, and worth naming: nothing yet **raises**
`verificationStatus` above `DRAFT`. A clinic that has checked a flag against
KWSP's own schedule still cannot say so on this screen. That belongs with the
statutory register rather than with this piece.
