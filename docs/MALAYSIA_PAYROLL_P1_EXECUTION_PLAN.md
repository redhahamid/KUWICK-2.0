# Malaysia HR & Payroll — P1 execution plan (production payroll experience)

**Written:** 4 September 2026 · **Base:** `f37c09b` (P0-A–H complete) ·
**Branch:** `claude/kuwick-malaysia-payroll-prod-7vfncl`

This plan was produced from the repository, not from memory. The baseline was
re-verified before planning: API typecheck, seed typecheck and web typecheck
clean; API unit 2,653/124 suites; API integration 276/22 suites; web unit
1,689/97 files — exactly the matrix the P0 checkpoint declared.

---

## 1 · What P0 actually left behind (verified, not assumed)

**Complete and tested:** run lifecycle DRAFT→CALCULATED→APPROVED→PAID with four
run types (FINAL_PAY refused at calculate, naming s.60E); exception catalogue
with BLOCKING/WARNING/INFO, override discipline and a single `approvalGate()`;
Snapshot v2 (hashed, verified-before-write, verdicts VERIFIED / TAMPERED /
INCONSISTENT / UNVERIFIABLE_SCHEMA, recomputed on every read); six-step journey
API + UI (`payroll-journey.service.ts`, `PayrollRunPage.tsx`); per-employee
payroll readiness on the employee record (6 items); effective-dated salary,
statutory classification, employer statutory profile and pay-component
treatment; YTD substrate with opening import feeding cumulative PCB; statutory
engines EPF/SOCSO/EIS/PCB at OFFICIAL_TEST_VECTOR_VERIFIED, LINDUNG phase 1 /
HRD levy / Employment Act at OFFICIAL_SOURCE_VERIFIED; five reports; 14
permissions with salary confidentiality; RLS + audit.

**Absent (named absences in code, confirmed):** payslip from the API (web
renders from live run rows, only on the legacy page); bank/payment preparation
and reconciliation (`hr.payroll.export.bank` declared, used by nothing);
statutory output preparation (`hr.payroll.export.statutory` idem); TP1/TP3
capture (PCB engine slots `LP1`/`∑LP`/previous-employer accumulators exist and
are test-vector-verified; capture and accumulation do not); HRD levy engine
implemented but wired into no run; Finance liability contract; reports beyond
the five (PAYROLL_HISTORY, STATUTORY_RECONCILIATION, PAYMENT_RECONCILIATION are
named absences in the catalogue); YTD-opening UI; statutory-classification
editor UI; `listStatutoryGaps()` implemented but mounted on no route.

**Defects found during inspection (to fix in P1):**
1. `apps/web/src/admin/hr/payslip.ts` sums employee statutory with `?? 0` into
   a printed “Total deductions” — an uncalculated scheme contributes zero to a
   total on a statutory document while the line above says “Not calculated”.
2. `PayrollRunPage` earnings step derives a residual “Claims & other” bucket
   client-side; an engine discrepancy would surface as a plausible number.
3. `PayrollRunPage` deductions step derives statutory/PCB/“other” totals
   client-side with `?? 0`, showing “Statutory RM0.00” for a run whose
   statutory is not calculated.
4. Payslip is unreachable from the six-step journey (only `/payroll/all`).
5. `e2e/admin-hr.spec.ts` expects the legacy payroll page at
   `/admin/hr/payroll`, which now serves Payroll Home.

## 2 · Binding constraints carried forward

- Fail closed on statutory rules; the code registry’s
  `MINIMUM_STATE_FOR_APPROVAL = OFFICIAL_SOURCE_VERIFIED` stands.
- Payslips and any historical figure come from the approved snapshot, never
  from mutable rows.
- A generated file is not a payment; nothing is “submitted” without a recorded
  external acknowledgement (actor, date, reference).
- No parallel calculation in the UI; the engine’s figures are rendered, not
  re-derived.
- Do not weaken P0-A authorization; every new endpoint gets permission +
  tenant + employer scope + audit, and salary confidentiality rules.
- TP1 relief **catalogue/caps** remain UNVERIFIED (register): capture carries
  employer-approved amounts with provenance; no cap table is invented.
- LINDUNG phases 2–3, EA First Schedule special categories, FINAL_PAY,
  employer-transfer split: refusals stay.

## 3 · Build order (vertical slices, each committed with tests)

| # | Slice | Contents |
|--:|---|---|
| 1 | Journey truth + quick wires | Server-side per-employee earnings/deductions grouping in the journey payload; UI renders engine figures only (fixes defects 2–3); mount statutory-gaps route; exception centre reachable from the journey |
| 2 | Payslip from snapshot | API payslip dataset per employee from the latest approved snapshot (+ YTD through that month); payslip list/history; revision marker for corrections; web payslip sourced from it (fixes defects 1, 4); print/PDF path documented |
| 3 | HRD levy wiring | Employer registration class + employee eligibility → per-line levy in calculate; employer cost, totals, snapshot v3 (verify stays backward-compatible with v2); exceptions where eligibility facts are missing |
| 4 | TP1 / TP3 | `EmployeeTp1Entry` (per period, employer-approved amounts, provenance) → `LP1`; `Tp3PreviousEmployment` (per tax year: gross, EPF, MTD paid, zakat, LP, employer, dates, provenance) → accumulators; EmployeeYtd gains the LP column so ∑LP comes from approved history; double-count guards: opening import refused before employment start, TP3 refused where no in-year previous employment is possible, overlap refusals |
| 5 | Payment workflow | Payment batch prepared from an APPROVED run’s snapshot: per-line validation (bank details), exclusions named, batch total reconciled against snapshot net or refused; states NOT_GENERATED→GENERATED→DOWNLOADED→RECORDED_PAID with external reference; instruction listing export labelled as **not a bank file** (no verified bank format is on record); payment-status per employee |
| 6 | Statutory outputs | Per-run, per-employer output preparation for EPF / SOCSO+EIS / LINDUNG / PCB (CP39 data) / HRD: registration numbers, per-employee rows with membership identifiers, totals reconciled to the snapshot, schedule verification stamps, `notASubmission`, CSV listing; recording of an external submission acknowledgement (truthful, actor+date+ref) |
| 7 | Reports + Finance contract | Add: employee payroll history, PCB/MTD summary, YTD, OT, unpaid leave, incentives, exceptions, payment status, statutory reconciliation; Finance-facing read-only liability contract from approved snapshots (aggregates only — no per-employee pay exposure), payment state included; no Finance ledger logic in payroll |
| 8 | Readiness + remediation UI | Aggregate pre-run readiness (single source with the employee-record checklist, extended with TP1/TP3/YTD/LINDUNG context); statutory-classification editor (effective-dated) and YTD-opening import UI so every blocker has an in-product remediation path |
| 9 | UX + responsive pass | Journey, exception centre, payslip, payment centre, outputs, reports on the navy/teal system; desktop + iPad widths; no parallel figures anywhere |
| 10 | Synthetic month UAT | Seeded synthetic full month covering the brief’s case list; end-to-end reconciliation gross→net→employer cost→payment→statutory→YTD asserted in an integration test; visual UAT screenshots at 1440×900 and 1024×768 (iPad); fix stale e2e; final checkpoint report |

Security re-audit (P1-J) is not a slice: it is a review gate applied to every
slice’s endpoints before its commit, plus a final pass.

## 4 · Out of scope for P1 (unchanged refusals)

Authority/bank API submission · FINAL_PAY calculation · LINDUNG phases 2–3
rates · EA First Schedule special-category classification · year-end forms
(E/EA/CP8D) beyond the data substrate · employer-transfer split history.
