# Malaysia Payroll — Final validation + human visual UAT (Step 1)

**Branch** `claude/kuwick-malaysia-payroll-prod-7vfncl` · starting from the verified P1 checkpoint `cb45e5e`
(`docs/MALAYSIA_PAYROLL_P1_CHECKPOINT.md`). This file is the record of the takeover audit that re-verified the
P0/P1 claims against the code rather than the reports, the defects that audit proved and fixed, the human visual
UAT, and the verdict on proceeding to Step 2 — the controlled historical parallel-run.

The screenshot evidence is `docs/payroll-final-uat/` (new pack; the historical P1 pack in `docs/payroll-p1-uat/`
is untouched). The independent reconciliation script used here is committed conversation-side only; its checks are
restated in section 5.

## 1 · What was inspected

- The full P0→P1 history (`f37c09b..cb45e5e`), the P1 checkpoint, the production spec, the statutory source
  register, and every payroll migration.
- The canonical engine end to end: `payroll-calculation.ts`, `statutory.ts`, the six engines under
  `src/statutory/`, the registry, materialisation, snapshot build/verify, and every consumer surface
  (journey, payslips, payment, statutory outputs, thirteen reports, finance contract, YTD/TP1/TP3).
- Every payroll endpoint's permission gate, audit write, tenant scoping and branch scoping; the RLS and
  append-only migrations; the negative-test inventory.
- The payroll web surfaces file by file, including the drawers, secondary panels and the legacy page.
- The running application against the seeded synthetic world, walked as a clinic owner at desktop, tablet and
  one phone frame — the human pass the P1 checkpoint explicitly left pending.

## 2 · Defects found and fixed (each proven before it was touched)

### Statutory correctness

1. **Every schedule commenced one month early.** The engine resolved schedules on the EXCLUSIVE period end (the
   first of the next month), and `effectiveFrom <= on` matched a schedule commencing that exact day. A
   September 2025 run acquired the October Third Schedule instead of blocking; December 2025 computed MTD under
   the 2026 specification; **a May 2026 run charged LINDUNG** for an opted-in local a month before the scheme
   existed, and blocked a foreign worker with no participation record on an exception no screen could name.
   Fixed at the source: the statutory context now carries the last day INSIDE the period (the convention the
   salary, classification, employer-profile and catalogue resolution already used); twelve boundary tests pin
   each commencement. This mattered directly to Step 2, which is a run over historical months.
2. **The HRD levy had no date resolution at all** — any period was levied — and was absent from
   `PAYSLIP_SCHEMES`, so no run's provenance stamp recorded which levy guideline priced its employer cost. It
   resolves and stamps like every other scheme now.
3. **The EPF election guard compared every recorded rate against a hardcoded 11%.** The Schedule prints
   11/5.5/0/2 by Part, so a 61-year-old citizen whose true Part E 0% was faithfully recorded was refused with a
   message asserting the Schedule's rate is 11%. Elections are judged against the Part's own printed rate.
4. **A resident's MTD computed on K1 = 0 whenever EPF was unknown** — a finished-looking, over-deducted figure
   beside an EPF that said "could not be worked out". Unknown K1 now refuses the resident's PCB with the reason.
5. **Two silently-unmodelled rules were undeclared fake support**, now named in the registry's own gap list:
   the special MTD schemes (REP / knowledge-worker / C-suite), whose engine refusal was unreachable from any
   payroll path, and the pay-component statutory-treatment flags, which ship DRAFT with no verification bar.

### Money and record integrity

6. **Every approved snapshot froze the EPF/SOCSO/EIS wage bases as zero** — writer in ringgit under one set of
   keys, reader in cents under another with `?? 0` — so the statutory listings a clinic keys into KWSP's and
   PERKESO's portals printed a wages column of 0.00 beside real contributions. Nothing downstream verified the
   wages column, which is why the synthetic month never caught it.
7. **An incomplete payslip could be approved.** "The run cannot be approved while any line is incomplete" was a
   documented promise nothing enforced: the only gate was the exception rows, and a null LINDUNG raised none.
   `approve()` now refuses incomplete lines outright when the period's schedules are in force; the
   acknowledged-gap path (a clinic whose accountant computes what Kuwick could not) still works, on the record.
8. **Statutory output totals summed "not calculated" rows as zero** and printed the understated figure as the
   CSV's TOTAL line. Null survives now, as on the reports and the finance contract, and the TOTAL line names
   the not-calculated count.
9. **The employer-cost report derived contributions from three of the engine's four terms**, dropping the HRD
   levy, so gross + contributions fell short of employer cost by exactly the levy. The journey's review-step
   statutory subtotal likewise summed a *partially* missing figure as zero (`&&` where `||` belonged).
10. **The snapshot's self-check was tautological** — both sides of its per-employee identities were derived by
    subtraction at freeze time. `verifySnapshot` now also proves the independent identity across columns frozen
    from different sources (net vs the statutory withholdings + itemised other-deductions; employer cost vs the
    contributions + levy).
11. **Reports on a reopened month served candidate figures with no warning** while payslips, payment and the
    statutory listings kept serving the approved snapshot — and only the history report said so. Every
    run-scoped report header now carries the reopened flag and the explanatory sentence.
12. **Frozen overtime rows for day-priced work were unexplainable** ("0 h @ RM33.00 … 200.00" for a public
    holiday). Tier rows carry their ordinary-rate days and provision; the payslip PDF prints "2 days at
    ordinary rate + …".
13. **TP3 could double the cumulative position** (the unique key was defeated by any spelling variation of the
    previous employer's name) and could be deleted out from under an approved month. Both guards TP1 already
    had now exist on TP3: dated non-overlap between records, and an approved-run delete refusal.
14. The legacy variance endpoint compared against a DRAFT previous run; it now requires calculated figures,
    like the variance report always did.

### Security / RBAC / audit

15. **`PATCH payroll/runs/:id/paid` reached PAID with nothing** — no batch, no date, no reference, no
    reconciliation, audited under the wrong action. Removed outright; `record-paid` is the only path to the word.
16. **`GET employees/:id/payroll-detail` spread the entire profile row** — full bank account number and
    NRIC/passport value — to any `hr.payroll.view` holder. Deliberate projection now: filing identifiers,
    presence flags, last-four.
17. **Legal-employer reads returned the employer's full bank account under `hr.view`** (the legacy HR-clerk
    permission); `get()` returned the raw row. Masked to presence + last-four; the account is write-only
    through the form (an edit that does not mention it keeps it); the audit row records "on file (…1234)".
18. **A salary could be WRITTEN by `hr.employee.manage` alone** — a role forbidden to read pay could set
    anybody's. The write now also requires `hr.payroll.view`, the same second check the bank field already had.
19. **Under DUAL_APPROVAL, a half-approved run could be recalculated** — inputs changed, exceptions overridden —
    with approval #1 still attached to figures that no longer existed; approver #2 then locked it.
    `calculate()` clears recorded approvals exactly as `reopen()` does, with an audit row saying why.
20. **Payroll ignored branch scope entirely** — the one admin module taking `clinicId` straight off the request.
    Run creation/listing, readiness, the journey home, the employee list, benefits and the inputs list resolve
    the branch through the actor's scope now. (Run *creation* rights remain owner-only in the permission model,
    so the create-side guard is defence in depth; the read side binds today for delegated `hr.payroll.view`.)
21. **`audit_logs` was the one consequential table with no append-only enforcement** — RLS only, so in-tenant
    UPDATE/DELETE was permitted at the database level. Trigger + REVOKE now, like every other history; proven
    against a superuser session in the tests.
22. **The unrecorded exits are recorded**: the thirteen full-pay reports, the JSON payslip (same figures as the
    audited PDF), the statutory-outputs JSON view and the frozen snapshot payload read all write audit rows;
    the report catalogue — the one ungated payroll route — is gated.

### The screens (human visual UAT findings)

23. **The readiness page contradicted the run**: seven people sat in red over missing EPF/SOCSO membership
    NUMBERS while the run calculated and approved the month — against the page's own promise that blocking
    means the run refuses. Membership numbers are ADVISORY now (they gate the filing, exactly like the
    employer's own registration numbers one section up); unknown Part / tax profile / LINDUNG answers stay
    BLOCKING; a pre-June-2026 period asks nobody for a LINDUNG answer.
24. **The landing page cried wolf**: the safety banner read only the run's stored status, so an unstarted month
    showed "statutory setup is not yet production-ready" over a fully covered period. The journey serves the
    period's own registry answer now. "LAST MONTH'S NET" over an unapproved month says "(not approved yet)";
    the recent-payrolls column says "Net pay" until a month is actually paid.
25. **Blank was silently zero in three places money is keyed**: the opening-balances import turned untouched
    boxes into RM0.00 in the cumulative MTD ledger (blanks now refuse BY NAME, with one-click deliberate
    zeros); TP1/TP3 posted `?? 0` with no validation (typed or refused now); the standing editor asserted
    "no children, not disabled" from its initialisers (nullable now, sent only when known, "Not recorded" the
    visible resting state).
26. **Stale claims contradicted the product on live paths**: the inputs drawer — opened from the PCB
    exception's own remediation — still said PCB is never calculated; the legacy payroll page claimed no
    payslips exist and nobody checked the tables; the settings page said the YTD import isn't implemented while
    linking distance from its button. All state the current truth. ("This run is blue." — prose interpolating
    the tag-colour map — is also gone.)
27. **Two client-side derivations disagreed on screen**: benefits showed a clinic-wide clamped "Remaining"
    beside a table summing per-account clamps (one derivation now — the server's own row figures); the draft
    payslip printed "Total deductions" over a sum that skipped uncalculated lines (null-aware now, with
    "Not calculable" and an "Incomplete" print button; an approved run's button no longer lets live-line float
    math judge the snapshot document).
28. Smaller screen truths: employee-workspace money rendered "RM3,200.5" (two decimals always now); "LAST PAID"
    read the newest run with no status filter (approved/paid months only now); the variance panel dropped the
    RM and followed the machine's locale; money columns without keys collapsed together in the column picker;
    the TP1/TP3 panel was hard-locked to the current calendar year (year picker now).
29. **The seeded UAT world contradicted itself** (pre-existing, now visible because the screens are honest):
    it hand-wrote a PROVISIONAL statutory status the engine immediately disagreed with, seeded unpaid leave as
    a DEDUCTION so every line opened with "Does not add up", and gave every employee a full tax profile while
    raising PCB-missing blockers for three. The seed now writes what the engine writes.
30. **A legacy-shaped run silently priced the HRD levy "not recorded" for a registered employer** (found by
    reading the pack's own outputs frame against the run's exceptions). The employer-profile resolution read
    only `run.legalEmployerId` — null on every run created before runs carried a company — and the same null
    suppressed `HRD_REGISTRATION_UNRECORDED`, so every line's levy was null, the outputs said "see the run's
    exceptions" and the exceptions said nothing, while the employer's s.14 registration stood recorded.
    Registration now resolves per employing company — the run's where it names one, otherwise the company
    employing each person, the rule `writeYearToDate` already used — and the warning names every company that
    resolves to nothing, run-scoped or not. Two e2e tests pin the legacy shape: the levy prices from the
    employee's own employer, and an unrecorded company is warned about by name, not silently nulled.
31. **Around it, three smaller truths**: the UAT seed created its run without the employing company `create()`
    derives, and dropped the computed LINDUNG and levy columns on write (seeded rows disagreed with their own
    net and employer cost until the first recalculate) — it writes all three now, and the outputs and reports
    name Klinik Contoh Sdn Bhd; the statutory-totals report rendered the HRD employee cell "Not worked out"
    when no such share exists in the Act ("—" now, while an *unknown* HRD employer share stops rendering as
    "—" and says "Not worked out"); the review step's cost hint named EPF/SOCSO/EIS under a figure that
    includes the levy (it names the levy now).

## 3 · What was verified and left alone

- Reopen clears approvals with the audit trail; approved snapshots, lines and runs are immutable at the
  database (triggers re-proven by hand and now by test); the payment honesty ladder
  (GENERATED → DOWNLOADED → RECORDED_PAID) is real end to end; the finance contract serves aggregates only
  from the verified snapshot; wage reductions are never deductions anywhere downstream; LINDUNG is folded into
  no other scheme's totals; YTD accumulation has no double-counting path (prior-months-only reads, keyed
  upserts, opening-import refusals, TP3 in its own table with capture-time guards).
- The owner-self-approval exemption cannot defeat DUAL_APPROVAL (two distinct approvers still required, every
  use marked); `statutoryStatusOf`'s deliberate PCB/LINDUNG exclusions are coherent because PCB_MISSING blocks
  per-employee and LINDUNG now rides the fail-safe loop.
- Rounding: one rounding point per figure, ordered as the reconciled workbook orders it; no consumer re-rounds.

## 4 · Human visual UAT

Walked at 1680×1050 (desktop), 1024×1366 (iPad portrait) and one 390×844 phone frame, as the owner account of
the synthetic clinic: landing (blocked and not-started), readiness (blocked and clean), the six steps blocked
and clean, the exception centre, approval, the payment ladder end to end, payslips, statutory outputs with one
recorded filing, eight reports, the reopen/correction cycle to revision 2, the employee workspace, the standing
editor, TP1/TP3, opening balances (including the blank-refusal), settings and employers. Frames and captions:
`docs/payroll-final-uat/README.md`. Findings that materially impaired safe use were fixed (section 2, items
23–31) and re-photographed; the pack shows the fixed product, with the found-defective states kept under
`docs/payroll-final-uat/before/`. Frames 11–13 walk the owner-controlled EPF basis added this cycle (section
6): the owner's own selection blocking the month, the panel it was made on, and the corrected row.

Answers a clinic owner needs are on screen and truthful: what to do (landing hero + attention card), what is
blocking and why and how to fix it (readiness + exception centre, remediation with deep links), what the
employee receives and the employer pays (steps 3–4, register, employer-cost report), what has actually been
paid vs prepared vs submitted (the payment ladder's three words; outputs' "not filed — prepared only" vs the
one recorded filing), and what stays outside Kuwick (settings states it; the payment listing says it is not a
bank file; the outputs say they are not submission files).

## 5 · Financial reconciliation

Two independent layers, on top of the synthetic-month e2e (which re-ran green under the fixed engine):

1. **The cross-surface chain re-added outside the codebase** (Python over the HTTP API, integer cents): line
   identities in both directions → run totals → register totals → snapshot payload → payslips → payment batch
   (included + excluded = snapshot net) → statutory output totals per scheme → finance contract. Any mismatch
   fails the script; the run passes clean.
2. **Band-table re-derivation**: EPF/SOCSO/EIS/LINDUNG amounts re-looked-up from the transcribed schedule
   arrays parsed directly out of the source files (never through the engine), against the frozen snapshot's own
   bases and contributions — and the frozen wage bases are asserted non-zero wherever a contribution exists,
   which is the regression test for defect 6 in live data.
3. **HRD levy re-derivation**: for every line carrying a levy, the leviable wage is rebuilt from the component
   rows themselves (an earning adds, a wage reduction subtracts, and only rows the catalogue marks hrd-liable
   count) and priced at s.14's 1% in integer cents, half-up — nothing here trusts the engine's stored base.
   The final run: 86 checks, 0 failures.

## 6 · Owner-controlled EPF contribution basis (product change, this cycle)

A deliberate product change landed inside this validation cycle: the clinic owner may SELECT which of an
employee's wages EPF is contributed on, and that selection is operationally usable — it does not block the
month. No part of the statutory engine, catalogue, provenance, effective dating, exception system, audit trail
or fail-closed behaviour was weakened to allow it. Two concepts are kept apart on purpose, and the product
never lets them blur:

| | Where it lives | Who decides | What it can do |
| --- | --- | --- | --- |
| **Kuwick's statutory assessment** | the effective-dated pay-component catalogue, per component, with a verification status and a source reference | the Act, transcribed | decides what EPF wages ARE (s.2) |
| **The employer's selection** | `employee_contribution_bases` — per employee, per scheme, effective-dated, reasoned, authored, audited | the clinic owner | decides which of those wages they contribute on |

**The selection drives the calculation, and is an intersection rather than an expansion.** Ticking a component
the assessment excludes adds nothing (it is reported as ineffective, in words, rather than silently dropped);
a selection that leaves ASSESSED wages out computes exactly what the owner asked for. The applied EPF base can
never exceed the assessed one, by construction — and the independent reconciliation asserts it.

### Advisory, not blocking

A deliberate employer selection below the assessment raises `EPF_BASIS_DISCREPANCY` at **WARNING** severity.
The month calculates on the selection, the run can be reviewed, approved and finalised, and the advisory is
overridable so an owner may acknowledge it explicitly on the record. What Kuwick will not do is describe the
selection as compliant: the advisory states, verbatim, that Kuwick "does not treat it as meeting the Act, and
any shortfall against the Act stays the employer's to make good".

The advisory carries every figure the decision rests on — this is the live text from the validated synthetic
month (Nurul Hidayah, August 2026, frame 11):

> **Nurul Hidayah — EPF is being contributed on the employer-selected basis of RM3200.00, RM250.00 below the
> wages Kuwick assesses as EPF-liable.**
> Gross earnings RM3450.00. Kuwick assesses EPF wages of RM3450.00; the employer-selected contribution basis is
> RM3200.00, a difference of RM250.00 — excluding Fixed monthly allowance RM250.00. Selected from 2026-08-01 by
> Dr Aisyah Rahman: "UAT — the owner tries contributing on basic salary only". […] Kuwick does not treat it as
> meeting the Act, and any shortfall against the Act stays the employer's to make good.
> **What to do:** Nothing is required — the month can be approved as it stands. […]

The run's own gate agrees: `canApprove: true, blocking: 0, warnings: 3`. That month was then approved, paid,
and filed in the walked world — the pack shows an approved month carrying a deliberate difference, not a
hypothetical one.

### What still blocks

The distinction is a deliberate difference versus an unknown. Unchanged and re-proven this cycle: a statutory
figure that could not be worked out at all (missing EPF membership, missing tax profile, missing salary, no
employing company, no date of birth), a mid-period change of basis or salary or employer class, an unknown
component, a negative net, an incomplete line at approval, a snapshot integrity failure, and every permission
and scoping refusal. An e2e test pins the pairing directly: an employee with a recorded basis but an
unrecorded EPF membership still blocks the run, because a selection is not a substitute for a fact.

### The figures, per mode

| Mode | Applied EPF base | Advisory |
| --- | --- | --- |
| No selection recorded (the default for every employee) | the assessment | none |
| `ALL_APPLICABLE` | the assessment | none |
| `BASIC_PLUS_SELECTED`, ticks covering every assessed component | the assessment | none |
| `BASIC_PLUS_SELECTED`, ticks short of the assessment | basic + ticked assessed earnings | WARNING, naming the gap |
| `BASIC_ONLY` | basic (less any wage reduction) | WARNING, naming the gap |

Total earnings and the EPF basis reconcile SEPARATELY and are never implied to be equal: the same month has a
locum-session fee inside gross and outside EPF wages entirely — by the Act, not by anybody's tick. The
payslip's EPF note states the basis the contribution sits on, and says when it is below the assessment.

### Every other scheme is untouched

SOCSO, EIS, PCB and the HRD levy keep their own bases; an e2e test re-selects a lower EPF basis and asserts
each of their figures is byte-identical before and after. The one legitimate onward effect is PCB's K1 relief,
which follows the contribution actually made — the relief is the contribution, so a smaller contribution is a
smaller relief. The PCB remuneration base itself does not move.

### Snapshots, history and audit

A basis is refused into any month an approved run covers (same guard as a salary change), so today's selection
cannot reprice a paid month — pinned by a test that re-reads June after every July experiment. Each approved
snapshot freezes the mode, the codes that governed, the assessed figure beside the applied one, the exclusion
list, and **who selected it, from when, and why**. The difference is preserved rather than resolved: an
approved month that ran on a lower basis keeps saying so for ever, and `verifySnapshot` no longer treats that
as corruption (the rule written when the discrepancy was blocking has been removed). A reopen re-opens the
question; revision 2 freezes the new answer while revision 1 keeps serving payslips and filings, and both are
readable side by side.

### Identifying divergence without blocking

The run's exception centre and exceptions report list every affected employee by name. At filing time the EPF
listing — the document a clinic keys into KWSP — flags the row itself: "Employer-selected basis RM3200.00;
Kuwick assesses RM3450.00 (difference RM250.00, excluding Fixed monthly allowance)", on screen (frame 30) and
as a `basis_note` column in the downloadable CSV. It is deliberately not the `note` field that counts
uncalculated rows, so scheme totals are unaffected.

### Architecture

The row is scheme-keyed and only EPF accepts a selection today; SOCSO, EIS, PCB, HRD and LINDUNG deliberately
do NOT inherit the same three choices, because each scheme's base is its own Act's question. Extending it
anywhere else is a decision to be taken on that scheme's own legal footing.

## 7 · Remaining statutory gaps, by design (fail closed, named in the registry)

Unchanged from P1, plus the two newly declared:

- LINDUNG 24 JAM phases 2–3 (phase 1 only; no upper horizon is knowable until PERKESO publishes the dates).
- EA First Schedule special work categories and domestic employees (wage limb only; PARTIAL_RULE).
- **PCB special MTD schemes — REP, knowledge workers, C-suite (newly declared PARTIAL_RULE):** such an employee
  is taxed by the ordinary table; enter their PCB by hand and disregard the calculated figure.
- **Pay-component statutory-treatment verification (newly declared PARTIAL_RULE):** the wage-base flags follow
  the clinic's reconciled workbook and the Excel reference audit, but no authority sign-off backs them and no
  bar gates their DRAFT state.
- FINAL_PAY runs refused (termination benefits not computed); mid-year employer transfers refused;
  legal-employer name/address not effective-dated; no bank-format file; no authority submission files; the
  returned bank statement is not imported (no bank-side payment reconciliation).
- CP38 directions enter only through the opening import — an in-run CP38 deduction has no component, so a
  direction received mid-year cannot be processed by the run (declare and handle outside, or as an
  OTHER-deduction input that will not reach the X accumulator).
- EPF above-RM20,000 rounding residue side is an implementation choice (employer bears it), recorded in the
  source register pending an authority worked example.

## 8 · Test matrix (final state of this branch)

| Suite | Result |
| --- | --- |
| API unit (`npx jest`) | 125 suites, 2,697 tests — all green |
| API integration (`jest-e2e`, serial) | 32 suites, 363 tests — all green, including the `payroll-final-validation` negative suite (15), the `payroll-epf-basis` suite (16) and the synthetic month |
| Web (`vitest run`) | 98 files, 1,699 tests — all green |
| Typechecks (api `tsc --noEmit`, web `tsc -b`, seed `typecheck:seed`) | clean |
| Root Playwright `admin-hr` journey (freshly seeded world, `CHROME_PATH` chromium) | 5/5 green |
| Independent reconciliation (sections 5–6, walked world) | 92 checks, 0 failures |

Green tests prove the named invariants; they are not the human acceptance — that is section 4, and the next
gate is still a human one.

## 9 · Verdict for Step 2

**Ready to proceed to the controlled historical parallel-run**, with eyes open:

- The parallel-run months are HISTORICAL — the schedule-commencement fix (defect 1) existed precisely because
  those months cross boundaries; any month before October 2025 will now refuse rather than borrow later
  schedules, which is correct and must be expected.
- Populations in section 7 (special-category employees, REP/knowledge-worker tax, terminations, mid-year
  employer transfers) cannot be parallel-run; a month containing them needs those people handled outside and
  the difference explained in the reconciliation.
- The parallel-run's reconciliation should use the register and statutory-totals reports against the incumbent
  system's outputs, to the sen, with every difference classified before any live pay date — and the
  transcription sign-off by a Malaysian payroll professional remains a human act nobody has performed.
