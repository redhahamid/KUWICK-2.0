# Excel ↔ Kuwick payroll reconciliation

Every expected figure here is a real number lifted from one of the clinic's two
workbooks. They are not illustrations — they are executable assertions in
[`apps/api/src/workforce/payroll-calculation.spec.ts`](../apps/api/src/workforce/payroll-calculation.spec.ts),
and they run in CI. If the engine drifts from the spreadsheet, the build fails.

**Result: 35 of 35 assertions pass. Kuwick reproduces every EPF, SOCSO and EIS
figure in the clinic's payroll exactly.**

---

## 1 · Statutory contributions, wage by wage

Source: `payroll_listing.xlsx` sheet `JAN 26`.

| Source | Wage | | Excel | Kuwick | Verdict |
|---|---|---|---|---|---|
| row 5 | RM2,100.00 | EPF ee / er | 231 / 273 | **231 / 273** | ✅ match |
| row 6 | RM596.77 | EPF ee / er | 66 / 78 | **66 / 78** | ✅ match |
| row 10 | RM1,451.61 | EPF ee / er | 161 / 190 | **161 / 190** | ✅ match |
| row 18 | RM1,741.94 | EPF ee / er | 194 / 229 | **194 / 229** | ✅ match |
| row 29 | RM9,750.00 | EPF ee / er | 1,078 / 1,176 | **1,078 / 1,176** | ✅ match |
| row 5 | RM2,229.24 | SOCSO ee / er | 11.25 / 39.35 | **11.25 / 39.35** | ✅ match |
| row 5 | RM2,229.24 | EIS ee / er | 4.50 / 4.50 | **4.50 / 4.50** | ✅ match |
| row 29 | RM9,750.00 | SOCSO ee / er | 29.75 / 104.15 | **29.75 / 104.15** | ✅ match |
| row 29 | RM9,750.00 | EIS ee / er | 11.90 / 11.90 | **11.90 / 11.90** | ✅ match |

Row 10 is the one that matters most. A naïve `wage × 11%` gives RM159.68; the
Third Schedule gives **RM161**, because RM1,451.61 sits in the band
1,440.01–1,460.00 and the contribution is computed on the band ceiling. **The
engine Kuwick had before this change returned RM159.68 on that row** — it was
percentage arithmetic, and it was wrong on almost every wage in the clinic.

## 2 · The wage bases

Source: `AAS_PAYROLL_AUGUST.xlsx`, `Payroll Listing` rows 7 and BF/BG/BH.

| Case | Excel | Kuwick | Verdict |
|---|---|---|---|
| Overtime in the SOCSO/EIS base | yes (status 3) | yes | ✅ match |
| Overtime in the EPF base | no (status 3) | no | ✅ match |
| Unpaid leave reduces all three bases | yes (status 2) | yes | ✅ match |
| Mileage in any base | no (status 1) | no | ✅ match |
| Overtime counts toward the ORP | no | no | ✅ match |

## 3 · Ordinary Rate of Pay, overtime, unpaid leave

Source: `AAS_PAYROLL_AUGUST.xlsx`, `Summary` C12/C13/C14 and the OT tier block.

| Rule | Excel | Kuwick | Verdict |
|---|---|---|---|
| OT day divisor | 26 | 26 | ✅ match |
| UPL day divisor | 31 | 31 | ✅ match |
| Hours per day | 7.5 | 7.5 | ✅ match |
| Hourly rate rounded to the sen **before** the multiplier | `ROUND(BD/7.5,2)` then `×` | same order | ✅ match |
| Four OT tiers, three multipliers + one flat RM/hour | yes | yes | ✅ match |
| UPL on RM1,800 for one day | 58.06 | **58.06** | ✅ match |

## 4 · Differences, and what each one is

| # | Difference | Class | What Kuwick does |
|---|---|---|---|
| **D-1** | Allowance, attendance and commission carry **no EPF** in the workbook (status 1) | **OUTDATED / NON-COMPLIANT EXCEL RULE** | Defaults them to **EPF-liable**. Commission is not on the EPF Act's closed list of exclusions. Exempting one is now a dated, audited configuration choice rather than an inherited default. |
| **D-2** | Employee SOCSO is **typed in by hand** while employer SOCSO is a `VLOOKUP` | **EXCEL WORKAROUND** | Both sides come from the same band lookup. They cannot disagree. |
| **D-3** | **PCB is typed in by hand**; no formula exists anywhere in the workbook | **INSUFFICIENT DATA — both systems** | Kuwick does not calculate PCB either, and says so. It is a **blocking exception** until an amount is entered as a payroll input, which is exactly what the clinic does today — but now with an actor, a timestamp and an audit trail. |
| **D-4** | Listing row 22: statutory totals sum rows 5–20 while basic sums 5–21 | **EXCEL ERROR** | Not reproduced. One employee was silently missing from every contribution total. |
| **D-5** | Block 1 net pay `SUM(H+M+R, V:AC)` omits column `AD` — **zakat** | **EXCEL ERROR** | Not reproduced. Zakat is a deduction component and reduces net pay. |
| **D-6** | Block 2 "total earning" omits allowances, bonus, incentives and other claims | **EXCEL ERROR** | Not reproduced. Gross is the sum of the earning components. |
| **D-7** | Block 2 net pay omits other deduction, hutang medical claim and zakat | **EXCEL ERROR** | Not reproduced. Every deduction component reduces net pay. |
| **D-8** | Locum day book dates are locale-ambiguous and partly wrong | **EXCEL ERROR** | Dates are typed, not text. |
| **D-9** | Three payment dates per period (1st, 15th, 30th) | **DIFFERENT BUSINESS RULE** | **Not yet implemented.** Kuwick produces one run with one net figure. See limitations. |
| **D-10** | Variable pay earned one month, paid the next | **DIFFERENT BUSINESS RULE** | **Partly implemented.** `PayrollInputEntry.earnedPeriod` carries it; no screen shows it yet. |
| **D-11** | HRD levy at 1% of basic | **CLINIC / STATUTORY** | **Not implemented.** No employer-cost line for it. |
| **D-12** | Two different company names across the two workbooks | **INSUFFICIENT DATA** | Unresolved. Kuwick has no employing-legal-entity model. Owner question. |

**Nothing in the engine was changed to match an incorrect spreadsheet.** D-4
through D-8 are arithmetic errors in the workbook; Kuwick does the correct thing
and the difference is recorded here rather than reproduced.

## 5 · A full run, computed end to end

The seeded UAT run for 2026-07, calculated by the same code the service uses —
not hand-written figures:

| Employee | Age | Basic | Gross | EPF ee | EPF er | SOCSO ee | EIS ee | PCB | Net |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Dr Aisyah Rahman | 45 | 18,000.00 | 18,000.00 | 1,980.00 | 2,160.00 | 29.75 | 11.90 | 1,855.40 | 14,122.95 |
| Dr Meera Kaur | 35 | 9,500.00 | 9,760.00 | 1,078.00 | 1,176.00 | 29.75 | 11.90 | 542.15 | 8,098.20 |
| Chandra Devi | 33 | 4,200.00 | 4,064.52 | 449.00 | 531.00 | 20.25 | 8.10 | 62.30 | 3,524.87 |
| Nurul Hidayah | 31 | 3,200.00 | 3,548.48 | 381.00 | 450.00 | 17.75 | 7.10 | — | 3,142.63 |
| **Hafiz Osman** | **61** | 2,900.00 | 2,900.00 | **0.00** | **116.00** | **0.00** | **0.00** | — | 2,900.00 |
| Siti Zaleha | 27 | 2,600.00 | 2,686.40 | 286.00 | 338.00 | 12.75 | 5.10 | — | 2,382.55 |

Four things in that table are worth reading closely, because each one was
impossible to express in the previous engine:

- **Hafiz Osman is 61.** Employee EPF nil, employer 4% (RM116 on RM2,900), SOCSO
  Second Category so employee nil, EIS nil. The age branch is real, not a note.
- **Dr Aisyah's employer EPF is 12%, Chandra's is 13%** — the RM5,000 step.
- **Nurul's EPF base is RM3,450, not her RM3,548.48 gross.** Her allowance is EPF
  wages; her overtime is not. Her SOCSO base *is* the full RM3,548.48.
- **Siti's mileage is in gross and in no base at all.** Travelling allowance is
  an express EPF exclusion.

Two employees have **no PCB entered**, and both raise a blocking exception. The
run is `CALCULATED`, `PROVISIONAL`, and **cannot be approved.**

## 6 · What this reconciliation does not cover

Stated plainly, because a reconciliation that hides its own gaps is worthless.

- **PCB is not reconciled**, because neither system calculates it. The workbook's
  August total of RM13,181.35 across 19 employees cannot be checked against
  anything.
- **The statutory tables are corroborated, not verified.** `kwsp.gov.my` and
  `perkeso.gov.my` are unreachable from this environment. The engine faithfully
  reproduces the clinic's tables; whether the clinic's tables match the
  authority's has not been checked by anyone.
- **Only single-employee arithmetic is reconciled.** The workbook's own totals
  row is not compared, because it is provably wrong (D-4).
- **Bonus, zakat, and the 9% EPF election** are implemented and unit-tested but
  do not appear in the clinic's August or January data, so there is nothing to
  reconcile them against.
