# Malaysia Payroll — P1 checkpoint

**Branch** `claude/kuwick-malaysia-payroll-prod-7vfncl` · baseline `f37c09b` (P0-A–H verified in place before any change).
This file is the programme's checkpoint record: what was found, what was fixed with proof, what P1 delivered, what remains
missing **by design**, and the exact production-readiness verdict. The companion inspection record is
`MALAYSIA_PAYROLL_P1_EXECUTION_PLAN.md`; the statutory provenance register is `MALAYSIA_PAYROLL_STATUTORY_SOURCES.md`.

## 1 · The commits

| Commit | Slice |
| --- | --- |
| `4b377f1` | Inspection of the P0 foundations against the spec, and the P1 execution plan. |
| `6d68d24` `7d3dfa5` | P1-A/B/C — payroll readiness (per-employee and pre-run), the six-step journey served entirely by the engine's figures, the exception centre. |
| `7c7c1a0` `3a33a94` | P1-D/E/F — payslips issued from the approved snapshot (schema v3), the payment honesty ladder (GENERATED → DOWNLOADED → RECORDED_PAID), statutory outputs with recorded submissions. |
| `0aceea7` | P1-G — TP1/TP3 capture with double-count guards, the HRD levy wired end to end, YTD zakat/LINDUNG/∑LP continuity. |
| `dbec332` | P1-H/I — the thirteen-report suite and the `finance.view` liabilities contract. |
| `bb75d06` | P1-J/K — the endpoint-by-endpoint security re-audit, the statutory-standing editor, the opening-balances screen. |
| *(this commit)* | The synthetic month with its nine-surface reconciliation, the visual UAT pack, and two defects the reconciliation itself caught. |

## 2 · Verified-money defects found and fixed (each with a proof test)

1. **LINDUNG was computed but never withheld** — net pay ignored the contribution. Unit vector proves net(opted-in) =
   net(not-participating) − contribution, with gross and employer cost unmoved.
2. **The browser did payroll arithmetic** (`?? 0` on nullable statutory figures). All journey figures are now the
   server's `pay.totals`, with guard tests that the client never sums.
3. **The salary amount leaked** through the readiness checklist to `hr.view` holders. Fixed with `mayReadPay`; an
   HR-clerk integration test reads the record and never sees the figure.
4. **Stale "Kuwick does not work PCB out" messaging** survived the MTD engine on the payroll screens — replaced with the
   truthful statement everywhere it appeared.
5. **The HRD levy engine was wired into nothing** — employer cost ran ~1% short for registered employers. Wired through
   bases, payslip, run totals, snapshot, outputs, reports and the finance contract; 7 unit vectors + 4 integration tests.
6. **Zakat YTD continuity wrote a literal 0**, over-deducting tax every month after a zakat month. Now the ZAKAT
   component sum plus TP1 self-paid zakat.
7. **LINDUNG's YTD column was never written.** Now written; the payslip's year-to-date block reads real money.
8. **The client payslip double-subtracted unpaid leave** (stored gross is already net of it), so every real UPL month
   printed the "does not add up" refusal. Fixed; the unit test that encoded the wrong assumption rewritten with
   engine-true figures.
9. **The register's statutory column omitted LINDUNG** — a "statutory" column short of one withholding stopped footing
   in the first opted-in month.
10. **PCB provenance was only derivable from prose.** Whether a figure was calculated or hand-entered is now a
    structured marker (`breakdown.pcbSource`) written by the calculation; the PCB report reads the marker, never the
    wording.
11. **Three pay columns were never written** (`allowances`, `bonus`, `otherDeductions` stayed at their schema default of
    0) — a bonus month's register showed a gross no column explained, a claim paid with salary was in no column, a zakat
    month's take-home was lower than the columns could account for, and the YTD's additional-remuneration split (which
    falls back to the bonus column) recorded a bonus month as ordinary pay. **Caught by the synthetic month's
    reconciliation**, which is exactly the job that test exists to do. The columns now partition gross from the same
    component lines the payslip itemises.
12. **The PCB_MISSING exception's remediation still said "Kuwick does not work out monthly tax for you"** — a false
    statement on the exact screen where somebody decides what to do about it. It now leads with the truthful remedy:
    record the tax profile and the figure is calculated.

## 3 · What P1 delivered

- **Readiness (A)** — one builder feeding both the employee workspace and the pre-run screen; BLOCKING mirrors the
  run's own refusals, ADVISORY never stops a run; no silent defaults anywhere.
- **The six-step journey (B)** — every figure served by the canonical engine; the earnings and deductions steps carry
  discrepancy notices instead of client sums.
- **The exception centre (C)** — severity-led, person-named, with cause/consequence/remediation, deep links, and
  pass-with-a-reason only where the catalogue allows it. Approval is impossible over an open non-overridable blocker.
- **Payslips from the snapshot (D)** — issued only from the approved, hashed, re-verified record (schema v3 adds the
  itemised payslip detail); a reopened month's live rows are candidates while revision 1 keeps serving; PDF via pdfkit;
  downloads audited. Wages, wage reductions, employee deductions, employer contributions, net and YTD are distinct.
- **Payment (E)** — the honesty ladder: a prepared listing that says it is NOT a bank file, a download that changes no
  truth, and a person's recorded transfer (date + reference) as the only thing ever called paid. Batch totals reconcile
  against the snapshot net (included + excluded) or the batch is refused.
- **Statutory outputs (F)** — per-scheme listings for EPF/SOCSO/EIS/LINDUNG/PCB/HRD from the snapshot with schedule
  stamps and membership numbers, an explicit not-a-submission statement, and one recorded submission per run and scheme.
- **TP1/TP3 (G)** — captured with provenance, validated (items must sum; a TP3 for a full-year employee is refused; an
  opening month before employment start is refused as TP3 money; an approved month is frozen against late TP1), fed
  into the MTD engine's LP/∑LP slots, and carried into YTD.
- **Reports (H)** — thirteen: register, employer cost, statutory totals, variance, claims, history (corrections named),
  PCB summary (calculated vs entered from the marker), YTD (TP3 listed apart), overtime (tiers naming the provision),
  unpaid leave (a wage reduction, never a deduction), incentives, exceptions, payment status. Two named absences remain,
  each with its reason: statutory reconciliation (authority receipts are not captured) and payment reconciliation (the
  returned bank statement is not imported).
- **Finance contract (I)** — `GET /workforce/payroll/finance/liabilities` under `finance.view`: aggregates only, from
  the re-verified snapshot; a failed verification withholds figures with the verdict; per-employee pay never crosses;
  accounting treatment stays in Finance.
- **Security re-audit (J)** — every P1 endpoint walked: gates, elevated permissions on mutations, validation inside the
  permission boundary, audit rows on every mutation and download, tenant-scoped client under RLS, last-four bank rule.
  No API finding needed code; the two real findings were the dead-end remediation paths below.
- **UX and remediation paths (K)** — the three screens the checklist's own remedies pointed at but nobody built: the
  statutory-standing editor (dated versions, prefilled, reason required, history with the API's own what-changed diff),
  the opening-balances import screen (months not totals, employer + source required, server refusals verbatim), and the
  employer's HRD Corp registration class (a dated record on the employers page — the rate is never typed; 1% and 0.5%
  are the Act's own numbers). Standing values now read in the reader's words, not enum codes.

## 4 · The synthetic month (the reconciliation that gates this checkpoint)

`test/payroll-synthetic-month.e2e-spec.ts` — one July 2026 run holding every case at once: rest-day and public-holiday
work priced in days (s.60(3), s.60D), two days of s.18A unpaid leave, an incentive, a bonus, a claim paid with salary
beside one reimbursed by Finance, TP1 with self-paid zakat plus zakat through payroll, a hand-entered PCB, a non-citizen
with mandatory LINDUNG and non-resident 30% tax and no EIS, a mid-month joiner carrying a TP3, a mid-month leaver with
no bank account, under a section-14 HRD employer.

The chain asserted to the sen across nine surfaces: line identities in both directions (gross − withholdings = net;
gross + employer contributions = employer cost) → run totals = Σ lines → register totals → VERIFIED snapshot → YTD
ledger cents (TP1 LP and zakat included) → payment listing (included + excluded = net; the bankless leaver named, never
dropped) → statutory outputs per scheme → the finance contract (same liabilities, RECORDED_PAID, the recorded EPF
filing) → the reports (claims routes, OT provisions, UPL days, extras totals, PCB source counts).

## 5 · Statutory gaps that remain, by design (fail closed)

- LINDUNG 24 JAM phases 2–3 (phase 1 only; in force 2026-06-01).
- EA First Schedule special categories are PARTIAL_RULE — domestic servants, seafarers and the other special categories
  are refused, not guessed.
- FINAL_PAY runs are refused (termination/retrenchment benefits are not computed).
- Legal-employer name/address is not effective-dated (the identifier numbers are); a renamed employer's history keeps
  the current name.
- An employer transfer mid-year is refused rather than split across returns.
- No bank payment file in any bank's format — the listing states it is not one.
- No statutory submission files (EPF/SOCSO/EIS/PCB/HRD are totals and listings for checking); submissions are recorded
  facts, and what each authority *received* is not captured.
- The returned bank statement is not imported, so payment reconciliation against the bank does not exist.

## 6 · Visual UAT

`docs/payroll-p1-uat/` — 27 screenshots (desktop 1680×1050, tablet 1024×1366) produced by `prisma/p1-uat-shots.ts`
against the seeded UAT world, showing the month **blocked first** (the exception centre with its four blockers), then
fixed the legitimate way, approved, paid (the recorded transfer with its reference), filed once, and read through the
reports, the standing editor and the opening-balances screen. `manifest.md` in the pack names every frame. These are
machine-taken screenshots for human review — **human visual UAT has not happened yet** and this checkpoint does not
claim it has.

## 7 · Test matrix (this commit)

| Suite | Result |
| --- | --- |
| API unit (`npx jest`) | 2,676 passed / 125 suites |
| API integration (`jest-e2e`) | 332 passed / 30 suites |
| Web (`vitest run`) | 1,693 passed / 97 files |
| Root Playwright `admin-hr` (freshly seeded world) | 5 passed |
| Typechecks (api, web `tsc -b`, seed) | clean |

## 8 · Verdict

**Computation and record-keeping: production-capable, within the named boundaries.** The engines compute EPF, SOCSO,
EIS, PCB/MTD (with TP1/TP3, zakat, additional remuneration), LINDUNG phase 1 and the HRD levy from transcribed official
schedules with content-hashed provenance; every run freezes a verifiable snapshot; money states are never overstated;
and the month reconciles across every surface to the sen.

**Not production-ready as a whole system**, on these grounds, none of them softened by green tests:

1. The transcribed schedules carry `OFFICIAL_SOURCE_VERIFIED` provenance, but no Malaysian payroll professional has
   signed off the transcriptions or a parallel-run month against an incumbent system. That sign-off is a human act.
2. Human visual UAT of the screens (section 6) is still pending.
3. Filing and paying the authorities happens outside Kuwick (recorded here, performed there) — a clinic must operate
   that boundary knowingly.
4. The section-5 gaps mean specific populations (special-category employees, terminations, mid-year employer transfers)
   are refused; a clinic with those cases cannot run them here yet.

The honest deployment posture is a **pilot month run in parallel** with the incumbent process, reconciled with the
register and statutory-totals reports, before any live pay date.
