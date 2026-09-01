# PayrollPanda → Kuwick comparison matrix

Source: the hands-on audit of 1 September 2026, with its evidence tags preserved
(**TESTED** / **OBSERVED** / **BLOCKED** / **INFERRED** / **NOT FOUND**).

**PayrollPanda is a workflow benchmark. It is not statutory authority.** Every
statutory value below is recorded as *what the product does*, never as *what the
law requires*. Nothing here upgrades a verification status.

---

## 1 · The scoreboard

| # | Capability | PayrollPanda | Kuwick today | Kuwick target | Verdict |
|--:|---|---|---|---|---|
| 1 | Pay-component statutory flags | 4 independent (PCB/EPF/SOCSO/EIS) + exemption limit + EA field, 96 presets **TESTED** | 6 flags, 15 components, **hardcoded** | 12 attributes, versioned, configurable | **Kuwick better by design, worse today** |
| 2 | HRD flag on a component | **absent** — levy is % of gross | absent | `hrdLiable` per component | **Kuwick better** |
| 3 | ORP / unpaid-leave base per component | **absent** — set once on the policy | flag exists, **dead data** | both flags live | **Kuwick better** |
| 4 | Payroll policy bases | 4 independent bases **TESTED** | none | **5** (adds termination) | **Kuwick better** |
| 5 | Proration | joiner correct (11/30 **TESTED**); **leaver not re-prorated** **TESTED** | **none** | both, with the working shown | **Kuwick better** |
| 6 | Proration explanation on the row | **absent** | n/a | `RM3,000 × 11/30` shown | **Kuwick better** |
| 7 | Age-driven derivation | DOB locks EPF/SOCSO/EIS controls **TESTED** | refuses on unknown DOB | derive + lock + refuse + cite | **Kuwick better** |
| 8 | Unknown-DOB behaviour | applies a rule silently | **blocking exception with a reason** | keep | **Kuwick already better** |
| 9 | Payroll input write path | 4 paths **OBSERVED** | **none — dead end** | 4 paths + source + actor + reason | **Kuwick worse today** |
| 10 | Input provenance | no actor, no source, no reason **OBSERVED** | n/a | source, sourceRecordId, actor, reason | **Kuwick better** |
| 11 | Recurring vs additional | by attachment point, **unlabelled** | not modelled | same rule, **labelled** | **Kuwick better** |
| 12 | Attendance / leave / OT | **none native** — 6 integrations | native | native + enforced multipliers | **Kuwick better** |
| 13 | OT multiplier enforcement | user picks the item **OBSERVED** | one hardcoded 1.5× | rule-driven by day type | **Kuwick better** |
| 14 | Run states | Draft → Approved **TESTED** | 5 states | 8 states incl. review + export | **Kuwick better** |
| 15 | Off-cycle / correction runs | **none** **OBSERVED** | **none** | 4 run types | **both worse than target** |
| 16 | Approval control | **one click, no dialog, no actor** **TESTED** | approver ≠ preparer, zero exceptions | + confirmation + hash + optional 2nd | **Kuwick already better** |
| 17 | Exception centre | **does not exist** **TESTED** | 8 blocking exceptions | full centre, 3 severities | **Kuwick already better** |
| 18 | Server-error visibility | **silent on HTTP 400** **TESTED** | not audited | asserted in tests | **Kuwick must not repeat** |
| 19 | Approved snapshot | **none inspectable** **TESTED** | partial (rules, ORP, identity) | full + hash | **Kuwick better** |
| 20 | Reopen + diff | reopen exists, **no diff** **TESTED** | no reopen | reopen + before/after diff | **Kuwick better** |
| 21 | Audit trail | **none, despite a permission for it** **NOT FOUND** | `withAdminTx` on every mutation | extended coverage | **Kuwick already better** |
| 22 | Termination | reasons + proration choice **TESTED**; **no stale-payroll warning** | **none** | + block when period approved | **Kuwick better** |
| 23 | YTD | 12-month × 5-column matrix **OBSERVED** | **none** | same + CSV import | **Kuwick worse today** |
| 24 | TP3 | actual LHDN form, bilingual **OBSERVED** | **none** | same decision | **adopt** |
| 25 | PCB explainability | one number, no breakdown **OBSERVED** | n/a | full drill-down | **Kuwick better** |
| 26 | Multi-entity | **one company only** **TESTED** | **none** | LegalEmployer | **Kuwick better** |
| 27 | Statutory outputs | prepare-not-submit **OBSERVED** | **none** | same boundary | **adopt** |
| 28 | Year-end honesty | refuses an unpublished form **OBSERVED** | n/a | adopt | **adopt** |
| 29 | Reports | **two, no variance** **TESTED** | none | 15 + variance + drill-down | **Kuwick better** |
| 30 | Variance control | **absent** | **absent** | before every approval | **both worse than target** |
| 31 | Permissions | granular, **no pay-visibility, no branch scope** **OBSERVED** | 6, branch-scoped | 11, employer + branch scoped | **Kuwick better** |
| 32 | Onboarding checklist | 5 steps with time estimates **TESTED** | HR completeness score | adopt | **adopt** |
| 33 | Identity validation | NRIC required, **DOB never cross-checked** **TESTED** | none | derive DOB from NRIC, confirm mismatch | **Kuwick better** |
| 34 | LINDUNG 24 Jam | **not found** | **not implemented** | distinct scheme | **both absent** |

**Counts:** Kuwick's target is better in **21**; adopts PayrollPanda's decision
wholesale in **4**; Kuwick is already better today in **5**; Kuwick is worse today
in **2** (payroll input write path, YTD); **3** are absent in both.

## 2 · The five defects Kuwick must not reproduce

| Defect | Evidence | Kuwick's counter-measure |
|---|---|---|
| One-click approval, no confirmation, no actor | **TESTED** | §36 — confirmation restating totals and exception counts; preparer/reviewer/approver recorded |
| Server errors invisible (HTTP 400 → dead Save button) | **TESTED** | §52 invariant 7 — *a rejected save always produces a visible message*, asserted as a consequence |
| Archiving a leaver when the period is approved, silently | **TESTED** | §21 — blocks, offers a correction run |
| Leaver's final month not re-prorated | **TESTED** | §19 — termination is the fifth proration basis |
| No audit log despite an `AuditLogs.View` permission | **NOT FOUND** | §39 — append-only, already the house pattern |

## 3 · The seven decisions worth adopting

1. **Four (Kuwick: twelve) independent statutory attributes per component** — a
   single `taxable` boolean cannot express an allowance that is EPF-liable but
   PCB-exempt. §11.
2. **Payroll policy as a first-class object** with independent bases. §19.
3. **Age-driven derivation that locks the control** rather than validating it
   afterwards — it makes a class of error impossible. §9.
4. **Telling the truth about the recalculation model** in the reopen dialog. §38.
5. **Refusing to produce a statutory form that does not exist yet.** §43.
6. **Reproducing the statutory form rather than inventing a schema** (TP3). §30.
7. **The warning that names condition, consequence and two remedies** — the best
   copy in the product, and the template for §34.

## 4 · Where the two products' component flags disagree

Recorded because a disagreement is a **verification task**, never a vote.

| Component | PayrollPanda | Kuwick | Status |
|---|---|---|---|
| Overtime | EPF ❌ · SOCSO ✅ · EIS ✅ | EPF ❌ · SOCSO ✅ · EIS ✅ | agree — **still UNVERIFIED** |
| Bonus | EPF ✅ · **SOCSO ❌ · EIS ❌** | EPF ✅ · **SOCSO ✅ · EIS ✅** | **DISAGREE → KWSP/PERKESO must settle it** |
| Commission | EPF ✅ · SOCSO ✅ · EIS ✅ | EPF ✅ · SOCSO ✅ · EIS ✅ | agree — **still UNVERIFIED** |
| Director's fee | all ❌ except PCB | all ❌ except PCB | agree — **still UNVERIFIED** |
| Travel/petrol (official duties) | EPF ❌, PCB ✅ with a 6,000 cap | MILEAGE all ❌ | **DISAGREE → KWSP/LHDN must settle it** |
| Meal, Parking allowance | **PCB ❌**, EPF ✅ | not modelled | **Kuwick gap** — and evidence the flags are genuinely independent |

Two disagreements and two Kuwick gaps. **Neither product is authority; both
disagreements go on the verification worklist.**

## 5 · What PayrollPanda has that Kuwick does not need

- **Six third-party HR integrations.** Kuwick owns attendance, leave and OT
  natively; importing them back would be the "two stores for one fact" mistake.
- **A second schedule object.** Kuwick's roster is already the working-days source.
- **Benefits-in-kind breadth** (13 presets) beyond what a clinic uses. Model the
  category; seed only what the clinic needs.
- **26 TP1 relief items as pay items.** Kuwick models reliefs as a tax-profile
  concern, not as payroll components — reliefs are not money moving in a period.
- **Plan-gated features.** Not a product-tier business.
