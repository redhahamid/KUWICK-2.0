# MALAYSIA PAYROLL — STATUTORY SOURCE REGISTER

Every calculation-critical rule, the authority behind it, and how far its
verification actually got. No row may be upgraded on the strength of our own
tests agreeing with our own formula.

## Verification states

| State | Means |
|---|---|
| `UNVERIFIED` | Implemented from secondary material, or not implemented. |
| `CORROBORATED` | Independent secondary sources agree. Still not an authority. |
| `OFFICIAL_SOURCE_VERIFIED` | Implemented against the authority's own current published document, cited below. |
| `OFFICIAL_TEST_VECTOR_VERIFIED` | The authority's own published worked values run green in CI, at the precision the document requires. |

No screen, report, payslip or export may imply a state stronger than the one
recorded here.

## Documents held (Tier A)

All supplied by the account holder. The six authority websites remain blocked
by this session's egress policy, so these files are the sole Tier A evidence.

| # | Document | Authority |
|---|---|---|
| D1 | Amendment to: Specification for MTD Calculations using Computerized Calculation for 2026 (updated 1 Jan 2026) | HASiL |
| D2 | MTD Testing Questions using Computerised Calculation Method 2026 | HASiL |
| D3 | Form TP1 (1/2026) and its explanatory notes | HASiL |
| D4 | Form TP3 (1/2026) and its explanatory notes | HASiL |
| D5 | EPF Act 1991, Third Schedule, in force from 1 October 2025 | KWSP |
| D6 | Act 4 — New Contribution Rate Including the Non-Employment Injury Security Scheme (SKBBK) | PERKESO |
| D7 | Rate of Contribution — Employment Insurance System (Act 800) | PERKESO |
| D8 | Levy Calculation Guideline (PSMB Act 2001, ss. 2, 14, 15) | HRD Corp |
| D9 | Employment Act 1955 (Act 265) — payroll extract: ss. 18A, 60, 60A, 60D, 60I | AGC / JTKSM |

---

## Register

### PCB / MTD

**Now wired into payroll**, from Stage 3. What kept the engine unwired was never
the formula: the Computerised Calculation method is CUMULATIVE, and Kuwick held
nothing cumulative. `EmployeeYtd` now carries it — written from approved runs
and from a controlled opening import for a clinic that migrated mid-year — and
`employee_profiles` carries the tax residence and MTD category the method
branches on.

Three limits, stated so nobody assumes otherwise:

1. **TP1 deductions are not captured**, so LP and ∑LP are nil. That is the
   correct treatment for an employee who has filed no TP1, and it errs towards
   deducting MORE — an employee who has filed one recovers the difference on
   assessment. It is not silent: `pcbTp1Captured: false` travels with every
   computed figure.
2. **Residence and category BLOCK when unknown.** Neither is derivable from
   anything else on an employee record; residence alone is the difference
   between a flat 30% and the progressive table.
3. **A mid-year start with no imported history computes nil, correctly.** The
   method projects the rest of the year from what it has been told, so an
   August run for somebody with no year-to-date describes a five-month year
   below the threshold. The figure is right for the facts given; what makes it
   wrong in practice is missing history, which is what the opening import is
   for. Pinned by test so it is not mistaken for a bug.

| Field | Value |
|---|---|
| **Rule** | Monthly Tax Deduction, normal remuneration, resident employee |
| **Authority / document** | HASiL, D1, section D(b)(1), pp. 9-11; Table 1 p. 11 |
| **Effective** | Year of assessment 2026. D1 section C states there is no amendment to the MTD formula for 2026 |
| **Eligibility** | Resident, or known to be resident, in Malaysia |
| **Wage basis** | Y1 gross normal remuneration; K1 EPF or other approved scheme in respect of it |
| **Employee / employer** | Employee deduction only. No employer share |
| **Ceiling** | EPF relief capped at RM4,000 a year (K + K1 + K2 + Kt) |
| **Rounding** | Truncate to 2 dp; round UP to nearest 5 sen (1-4→5, 6-9→10); nil below RM10 (D1 s.E 1-3) |
| **Implementation** | `src/statutory/pcb-2026.ts` — `computePcb` |
| **Test** | `pcb-2026.spec.ts` — Exhibit 5 Jan/Feb/Mar 2025 |
| **Expected** | K2 308.63 / 279.00 / 242.77; P 47,000.07 / 47,000.00 / 46,700.07; MTD 110.00 / 110.00 / 108.20 |
| **Status** | **`OFFICIAL_TEST_VECTOR_VERIFIED`** |

| Field | Value |
|---|---|
| **Rule** | MTD, additional remuneration (bonus, arrears, non-monthly commission) |
| **Authority / document** | HASiL, D1, section D(b)(2), pp. 11-13; worked example Exhibit 5 pp. 48-51 |
| **Rounding** | As above, applied to each of the normal and additional components |
| **Implementation** | `pcb-2026.ts` — `computePcb`, steps 1-5 |
| **Test** | `pcb-2026.spec.ts` — Exhibit 5 April 2025 |
| **Expected** | Step 1[B] P 46,400.00; K2 197.50 (Step 1) and 84.00 (Step 2); Step 1[C] 106.20; Step 1[E] 1,284.00; Step 2[B] P 54,650.00; Step 3 2,011.50; Step 4 727.50; Step 5 833.70 |
| **Status** | **`OFFICIAL_TEST_VECTOR_VERIFIED`** |

| Field | Value |
|---|---|
| **Rule** | MTD, non-resident employee |
| **Authority / document** | HASiL, D1, section D(a), p. 9 |
| **Wage basis** | Remuneration, excluding exempt allowances/BIK/perquisites (D1 s.E 9) |
| **Rate** | 30%, flat. No reliefs, no accumulation |
| **Implementation** | `pcb-2026.ts` — `computePcb`, non-resident branch |
| **Test** | `pcb-2026.spec.ts` — "a non-resident employee" |
| **Expected** | RM3,000.00 × 30% = RM900.00 (D1's own example) |
| **Status** | **`OFFICIAL_TEST_VECTOR_VERIFIED`** |

| Field | Value |
|---|---|
| **Rule** | Deduction values D, S, DU, SU, Q; Table 1 bands |
| **Authority / document** | HASiL, D1, Table 1 p. 11; values evidenced in Exhibit 5 (D = RM9,000, term `2000C`) |
| **Implementation** | `pcb-2026.ts` — `PCB_TABLE_1`, `reliefCents` |
| **Test** | `pcb-2026.spec.ts` — "Table 1 boundaries", "category rules" |
| **Status** | **`OFFICIAL_SOURCE_VERIFIED`** |

| Field | Value |
|---|---|
| **Rule** | REP, knowledge worker in a specified region, resident non-citizen C-Suite |
| **Authority / document** | HASiL, D1, sections D(b)(3), (4), (5), pp. 13-18 |
| **Eligibility** | Each requires its own IRBM approval |
| **Implementation** | `pcb-2026.ts` — refused by name via `SpecialMethod`; **not implemented** |
| **Test** | `pcb-2026.spec.ts` — "the four special methods are refused, not approximated" |
| **Status** | **`OFFICIAL_SOURCE_VERIFIED`** (as a refusal). The formulas are not implemented |

**The five MTD Testing Questions (D2) carry no published answers.** D2 is the
paper a software provider answers and submits to IRBM, which then verifies and
issues the approval letter. There are therefore no official expected values in
it to test against. They are not a substitute for the Exhibit 5 vectors and
nothing is marked verified on their strength.

### EPF / KWSP

| Field | Value |
|---|---|
| **Rule** | Monthly contribution, all Parts |
| **Authority / document** | KWSP, D5, Third Schedule, Parts A, C, E, F |
| **Effective** | 1 October 2025. Parts B and D deleted by Act A1760/2025 |
| **Eligibility** | Part A: under 60 — citizens, PRs, non-citizens who elected before 1 Aug 1998. Part C: 60+ — PRs and pre-1998 electors. Part E: 60+ citizens. Part F: other non-citizens |
| **Wage basis** | Wages for the month |
| **Employer / employee** | Per band, ringgit amounts, to RM20,000. Above: A 12%/11%, C 6%/5.5%, E 4%/0%, F 2%/2% |
| **Ceiling** | Table ends at RM20,000; percentages apply above it |
| **Rounding** | Bands are whole ringgit. Above the table, the TOTAL including cents is rounded to the next ringgit |
| **Implementation** | `epf-third-schedule.ts` (1,203 bands), `contributions.ts` — `epfContribution` |
| **Test** | `contributions.spec.ts` |
| **Expected** | RM3,000.50 → employee RM333, employer RM393 (Part A band 3,000.01-3,020.00). Employer rate steps 13% → 12% across RM5,000 (RM650 → RM612) |
| **Status** | **`OFFICIAL_TEST_VECTOR_VERIFIED`** against the Schedule's own printed band figures |

### SOCSO / Act 4 (including SKBBK)

| Field | Value |
|---|---|
| **Rule** | Contribution, First and Second Category |
| **Authority / document** | PERKESO, D6 |
| **Schemes** | First Category: Employment Injury + Invalidity + Non-Employment Injury. Second Category: Employment Injury + Non-Employment Injury |
| **Wage basis** | Monthly wages |
| **Employee share** | First Category: Invalidity **and** Non-Employment Injury, as separate columns. Second Category: Non-Employment Injury only — **no longer nil since SKBBK** |
| **Ceiling** | RM6,000; band 65 applies above it |
| **Rounding** | None — the document prints exact sen per band |
| **Implementation** | `socso-act4.ts` (65 bands), `contributions.ts` — `socsoContribution` |
| **Test** | `contributions.spec.ts` — "SOCSO keeps its schemes apart" |
| **Expected** | At RM6,000 First Category: employer 104.15, Invalidity 29.75, Non-Employment Injury 44.65. Second Category: employer 74.40, employee 44.65 |
| **Status** | **`OFFICIAL_TEST_VECTOR_VERIFIED`** |

### EIS / Act 800

| Field | Value |
|---|---|
| **Rule** | Contribution |
| **Authority / document** | PERKESO, D7 |
| **Eligibility** | Act 800, assessed separately from Act 4 |
| **Employer / employee** | Equal in every band |
| **Ceiling** | RM6,000; band 65 applies above it |
| **Implementation** | `eis-act800.ts` (65 bands), `contributions.ts` — `eisContribution` |
| **Test** | `contributions.spec.ts` — "EIS is its own Act" |
| **Expected** | At RM6,000: RM11.90 each side, RM23.80 total |
| **Status** | **`OFFICIAL_TEST_VECTOR_VERIFIED`** |

### LINDUNG 24 JAM

| Field | Value |
|---|---|
| **Rule** | Participation, contribution and remittance |
| **Authority / document** | **Not supplied.** D6 covers the Non-Employment Injury Security Scheme (SKBBK) as an integrated column of the Act 4 table |
| **Status** | **`UNVERIFIED`** |

D6 gives the SKBBK contribution as part of Act 4, and that column IS
implemented and tested. What is **not** established by any document held is
whether "LINDUNG 24 JAM" is the same programme under a public-facing name, or a
separate scheme with its own participation rules, opt-in/opt-out, foreign-worker
phases and effective dates. Those elements are therefore **not implemented**,
and no assumption has been made either way. **To close this, supply PERKESO's
own LINDUNG 24 JAM contribution schedule and participation guidance.**

### HRD levy

| Field | Value |
|---|---|
| **Rule** | Human Resources Development levy |
| **Authority / document** | HRD Corp, D8, citing PSMB Act 2001 ss. 2, 14, 15 |
| **Eligibility** | Malaysian citizen, full-time (contract or permanent), under a contract of service. Excludes domestic servants and a director paid only fees |
| **Wage basis** | `[(basic salary − unpaid leave) + fixed allowance] × rate`. Excludes overtime, night/shift/attendance allowances that vary, production incentive, bonuses, commissions, gratuity, travel and petrol allowances, benefit-fund contributions, apprentice allowances, special expenses |
| **Employer / employee** | Employer cost only. Never deducted from pay |
| **Rate** | 1% (s.14 mandatory), 0.5% (s.15 optional class) |
| **Rounding** | 2 decimal places |
| **Implementation** | `hrd-levy.ts` |
| **Test** | `hrd-levy.spec.ts` |
| **Status** | **`OFFICIAL_SOURCE_VERIFIED`**. D8 carries no worked example, so no vector exists to verify against |

### Employment Act 1955

| Field | Value |
|---|---|
| **Rule** | Ordinary rate of pay |
| **Authority / document** | AGC, D9, s.60I(1A)-(1C), (1)(a)-(b) |
| **Basis** | Monthly ÷ 26; weekly ÷ 6; daily/hourly/piece = preceding period's wages ÷ days actually worked. Hourly rate = ORP ÷ normal hours. Excludes approved incentive scheme payments and pay for rest-day / public-holiday work |
| **Policy** | s.60I(2) permits another method only where the resulting rate is **not lower** |
| **Implementation** | `employment-act.ts` — `ordinaryRateOfPayCents`, `checkOrdinaryRatePolicy` |
| **Status** | **`OFFICIAL_SOURCE_VERIFIED`** |

| Field | Value |
|---|---|
| **Rule** | Incomplete month's wages |
| **Authority / document** | AGC, D9, s.18A |
| **Basis** | `monthly wages ÷ days in the wage period × days eligible`. Opens "Notwithstanding section 60I", so the divisor is the actual length of the month, never 26 |
| **Applies to** | Joiner after the first, leaver before the end, unpaid leave, national service |
| **Implementation** | `employment-act.ts` — `incompleteMonthWagesCents` |
| **Status** | **`OFFICIAL_SOURCE_VERIFIED`** |

| Field | Value |
|---|---|
| **Rule** | Overtime and rest-day / public-holiday work |
| **Authority / document** | AGC, D9, ss. 60A(3)(a), 60(3)(a)-(c), 60D(3)(a)-(aa) |
| **Rates** | Normal day ≥ 1.5× hourly. Rest day, monthly-rated: ≤ half normal hours = 0.5 day ORP, more = 1 day ORP; excess ≥ 2× hourly. Public holiday: 2 days ORP regardless of hours worked, in addition to holiday pay; excess ≥ 3× hourly |
| **Limits** | s.60A(1): 8 hours a day, 45 a week, 10-hour spread-over, 5 consecutive hours without a 30-minute break |
| **Implementation** | `employment-act.ts` — `OVERTIME_MULTIPLIERS`, `restDayEntitlement`, `publicHolidayEntitlement`, `checkNormalHours`; applied per day by `workforce/overtime-pricing.ts` |
| **Test** | `overtime-pricing.spec.ts`; end to end in `workforce-payroll.e2e-spec.ts` |
| **Expected** | RM3,120/month, ORP RM120/day: two hours on a public holiday = RM240 (2 days), five hours on a rest day = RM120 (1 day). The pooled 1.5× engine paid RM168 for both — an underpayment of RM192 |
| **Status** | **`OFFICIAL_SOURCE_VERIFIED`** |

| Field | Value |
|---|---|
| **Rule** | Wages for an incomplete month, INCLUDING leave of absence without pay |
| **Authority / document** | AGC / JTKSM, D9 s.18A, with the scope confirmed from current JTKSM material |
| **Formula** | `monthly wages ÷ days in the particular wage period × eligible days` |
| **Scope** | A joiner after the first of the month, a leaver before the end of it, **one or more days of leave without pay**, and national service. It opens "Notwithstanding section 60I", so the ÷26 ordinary rate does not apply |
| **Divisor** | The actual length of that wage period — 28, 29, 30 or 31. Never 26 and never a fixed 31 |
| **Implementation** | `workforce/proration.ts` — `prorationFor`, `proratedBasicCents`, `unpaidLeaveDeductionCents`; `payroll-calculation.ts` — `ordinaryRates` takes the month's length |
| **Test** | `proration.spec.ts` — parameterised across 28, 29, 30 and 31-day periods; end to end in `workforce-payroll.e2e-spec.ts` (February) |
| **Expected** | RM3,100/month, one day of unpaid leave: February RM110.71, leap February RM106.90, September RM103.33, August RM100.00. A fixed 31 said RM100.00 in every month — under-deducting by RM10.71 in February |
| **Status** | **`OFFICIAL_SOURCE_VERIFIED`** |

### Employment Act First Schedule — who the overtime provisions reach

| Field | Value |
|---|---|
| **Rule** | Limitation of ss. 60, 60A and 60D by wages |
| **Authority / document** | D10 — First Schedule as amended by the Employment (Amendment) Act 2022; current JTKSM material, relayed by the account holder |
| **Effective** | 1 January 2023. The Act reaches all employees from that date; the hours-and-overtime provisions do not |
| **Threshold** | Wages **not exceeding RM4,000 a month**. Tested on the contractual monthly wage, because s.2 excludes overtime and travelling allowance from "wages" |
| **Above the threshold** | No statutory entitlement to rest-day pay, public-holiday pay or overtime. Anything paid is a contractual or company benefit, and Kuwick will not pay it unless the employer's undertaking is recorded |
| **Below the threshold** | The Act's rates apply and s.60I(2) makes them a floor, so a contract saying "no overtime" cannot take them away |
| **Implementation** | `statutory/employment-act.ts` — `FIRST_SCHEDULE_WAGE_CEILING_CENTS`, `overtimeScope`; `workforce/overtime-pricing.ts` carries the basis onto every priced day |
| **Test** | `overtime-pricing.spec.ts` — "who the Act actually reaches"; end to end for RM9,000 both with and without an undertaking |
| **Expected** | RM4,000.00 → STATUTORY. RM4,000.01 → not within the Schedule. RM9,000 with no undertaking → nil and a blocking exception. RM9,000 with one → the same money, marked a company benefit |
| **Status** | **`OFFICIAL_SOURCE_VERIFIED`** |

---

## Versioning, effective dating and what a run records

`apps/api/src/statutory/registry.ts` holds each schedule as a dated, hashed,
verification-stamped entry, and `stampFor(schemes, periodEnd)` resolves them
**against the payroll period rather than against today**. Every calculated run
stores the result in `payroll_runs.statutory_snapshot`.

Each line of that stamp carries the schedule id, its effective date, its
verification state, the document it was transcribed from, and a SHA-256 over
the actual band arrays. The hash is the part that makes the record hold: a
version string can be edited to say anything, whereas changing one sen in a
1,203-row table changes the stamp on every run calculated afterwards, and a
reconciliation against an earlier run stops matching.

Two consequences worth stating plainly:

- **A period no schedule reaches resolves to nothing, not to the nearest
  edition.** A 2025 run does not acquire the 2026 MTD specification, and a run
  before October 2025 gets no EPF schedule at all — its statutory status is
  `NOT_CONFIGURED`, its figures stay null, and its reports are marked
  provisional.
- **Rates are no longer tenant configuration.** `POST /workforce/payroll/
  statutory-rules` is refused. A clinic cannot legislate, and a screen that let
  one enter its own EPF table was a way to under-contribute by accident and call
  it a setting.

## Where Kuwick and the clinic's workbook now disagree

One material difference, and it is the law changing rather than the engine
drifting. **SOCSO employee contributions have roughly doubled under SKBBK.**
PERKESO's current Act 4 table charges the employee for the Non-Employment
Injury Scheme on top of Invalidity; the workbook has Invalidity alone.

| Monthly wages | Employer | Employee (workbook) | Employee (Act 4, D6) |
|---|---|---|---|
| RM2,229.24 | RM39.35 — unchanged | RM11.25 | **RM28.10** (11.25 + 16.85) |
| RM6,000.00 | RM104.15 — unchanged | RM29.75 | **RM74.40** (29.75 + 44.65) |

The employer side matches the workbook exactly at every row tested. EPF and EIS
reconcile against the workbook unchanged.

A second, smaller difference: an employee who has elected an EPF share other
than the Third Schedule's own rate (Borang KWSP 17A) is **refused rather than
approximated**, because the Schedule prints one employee column per Part and a
9% figure could only be produced by the percentage arithmetic this engine exists
to remove.

## Historical versions

A payroll run freezes the statutory version it used. A later correction to a
schedule cannot change what an already-approved run computed.

## Where a component's statutory treatment comes from

`pay_components` — the clinic's own effective-dated rows — and nowhere else.
The payroll calculation used to read a hardcoded map instead, so the screen
where a clinic records that an allowance is EPF-exempt drove nothing. The two
disagreed in **eight of sixteen entries**, and two of those moved money:

| Component | Engine map | Catalogue | Effect |
|---|---|---|---|
| `ALLOWANCE`, `ATTENDANCE_ALLOWANCE` | in the ordinary-rate base | not in it | prices overtime differently |
| `ZAKAT` | PCB-liable | not PCB-liable | **under-deducted tax twice over** |
| `UNPAID_LEAVE` | — | in the ordinary-rate base | shrank the overtime rate for an absent employee |
| `CLAIM_REIMBURSEMENT` | present | absent | a component the clinic could not see |
| `PCB` | absent | present | handled as an override |

The zakat one is the worst: the deduction reduced the taxable base **and** the
MTD engine applied zakat as relief against the month's tax. RM200 of zakat
under-deducted PCB by **RM38.00** in the month measured. Under-deducted tax is
the employee's bill at assessment.

The engine's map is now derived from the catalogue, so they cannot diverge
again, and the run resolves treatments **as at the period** — correcting a
component today cannot reprice a month already paid. A run with no catalogue
covering its period refuses rather than paying money nothing can say the
liability of.

`UNPAID_LEAVE` has also left the ordinary-rate base. s.60I(1A) builds the rate
from the monthly RATE of pay — what the contract says, not what the month paid —
so a month with unpaid leave still prices overtime from the full wage.

## Still outstanding

1. **LINDUNG 24 JAM** — PERKESO's own schedule and participation guidance.
1. **The First Schedule's full exception list.** The RM4,000 wage limitation on
   ss. 60, 60A and 60D is implemented. Other First Schedule exceptions — the
   treatment of domestic employees, and of employees engaged in specified
   categories of work regardless of wages — are **not** modelled, and no
   employee is currently classified into them. A clinic employing anybody in
   those categories would need that added before relying on the overtime
   figures for them.
1. **TP1 and TP3 capture** — the forms themselves. MTD is computed as though no
   TP1 had been filed, and TP3 previous-employment figures reach the engine only
   through the opening year-to-date import.
2. **A PCB verification letter** — the D2 answers can be produced from the
   engine and submitted to IRBM, but the letter is theirs to issue.
3. **Statutory submission file formats** — EPF, SOCSO, EIS and CP39 layouts are
   not held, so no submission file is generated.
