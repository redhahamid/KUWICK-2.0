# ⚠️ SUPERSEDED — historical record only

**This document describes the system as it stood BEFORE the statutory engines
landed, and its claims are no longer true.** EPF, SOCSO and EIS are now
transcribed from the authorities' own documents and verified against their
printed figures; PCB/MTD is fully calculated by HASiL's Computerised
Calculation method and reproduces the specification's own worked example; the
tenant-configured `StatutoryRuleSet` it describes has been retired in favour of
the code registry.

The **current** source of truth is:

- `docs/MALAYSIA_PAYROLL_STATUTORY_SOURCE_REGISTER.md` — every source document,
  its verification state, and every open gap;
- `apps/api/src/statutory/registry.ts` — the dated, content-hashed schedules the
  runs actually resolve, and `SCHEMES_WITHOUT_A_SCHEDULE`, the named gaps.

This file is kept unedited below as the historical record of what was known
when the structure was first built.

---

# Malaysian statutory payroll — sources, and what is actually verified

**Read the verification status before trusting any number in this system.**

| Scheme | Structure implemented | Rate data | Primary-source verified? |
|---|---|---|---|
| **EPF / KWSP** | ✅ Third Schedule band table | Clinic workbook, corroborated | ❌ **No** |
| **SOCSO / PERKESO** | ✅ First + Second Category tables | Clinic workbook, corroborated | ❌ **No** |
| **EIS / SIP** | ✅ Band table | Clinic workbook, corroborated | ❌ **No** |
| **PCB / MTD** | ⚠️ Inputs modelled, **no calculation** | None | ❌ **No — and deliberately not guessed** |

---

## The environment could not reach the primary sources

This matters more than anything else in this document, so it is stated first.

```
$ curl -sS -o /dev/null -w "%{http_code}" https://www.kwsp.gov.my/en/epf-act-1991-third-schedule    → 000
$ curl -sS -o /dev/null -w "%{http_code}" https://www.perkeso.gov.my/en/rate-of-contribution.html   → 000
$ curl -sS -o /dev/null -w "%{http_code}" https://www.hasil.gov.my/en/employer/monthly-tax-deduction-mtd/ → 000
```

`kwsp.gov.my`, `perkeso.gov.my` and `hasil.gov.my` are all blocked by this
environment's network egress policy. **No rate in this system has been checked
against the authority that publishes it.**

The response to that is architectural, not cosmetic:

- Every rate set carries a `verificationStatus` of `DRAFT`, `CORROBORATED` or
  `VERIFIED`, plus `verifiedBy`, `verifiedAt` and `sourceUrl`.
- A payroll run **cannot be approved** against a rate set that is not `VERIFIED`.
- The seeded Malaysian rate sets ship as `CORROBORATED`, never `VERIFIED`.
- Marking a set `VERIFIED` is a deliberate, permissioned, audited act by a person
  who has opened the official schedule and compared it.

So the NOT READY banner stays. It comes off when somebody with access to
kwsp.gov.my and perkeso.gov.my verifies the seeded tables, and when a PCB rule
set exists at all.

---

## 1 · EPF / KWSP

**Primary source (not reachable here):** *EPF Act 1991, Third Schedule* —
<https://www.kwsp.gov.my/en/epf-act-1991-third-schedule>

### Structure — implemented and corroborated

| Property | Value |
|---|---|
| Band width, wages ≤ RM5,000 | **RM20** |
| Band width, RM5,000 < wages ≤ RM20,000 | **RM100** |
| Employee rate | **11%** (statutory-minimum election: **9%**) |
| Employer rate, wages ≤ RM5,000 | **13%** |
| Employer rate, wages > RM5,000 | **12%** |
| Basis within a band | contribution computed on the **band ceiling**, rounded **up** to the next ringgit |
| Wages > RM20,000 | `ROUNDUP(wages × rate, 0)` — no table |
| Age 60+, Malaysian citizen | employee **0%**, employer **4%** |

The band-ceiling rule is the part naïve implementations get wrong. For a wage of
RM1,741.94 the contribution is not `1741.94 × 11%`; it is `ROUNDUP(1760 × 11%)` =
**RM194**, because RM1,741.94 sits in the band 1,740.01–1,760.00.

### "Wages" for EPF

EPF Act 1991 s.2 defines *wages* as all remuneration in money payable under a
contract of service, **excluding** a closed list:

- service charge
- **overtime payment**
- gratuity
- retirement benefit
- retrenchment / lay-off / termination benefit
- any **travelling allowance** or the value of any travelling concession
- any other remuneration or payment exempted by the Minister

**Commission, bonus, and fixed monthly or attendance allowances are not on that
list** and are therefore EPF wages. The clinic's workbook currently exempts
allowance, attendance and commission — see
[`HR_PAYROLL_EXCEL_REFERENCE_AUDIT.md`](HR_PAYROLL_EXCEL_REFERENCE_AUDIT.md) §1.4.
Kuwick's seeded component library defaults them to **EPF-liable**; exempting one
is an explicit, dated, audited configuration choice.

### Corroboration used

- EPF band structure and the 13%/12% step at RM5,000 corroborated across multiple
  independent Malaysian payroll references (see Sources).
- The clinic workbook's own table (403 bands, `SOCSO-SIP-EPF Table!P:T`) is
  internally consistent with the rule above at every band boundary tested,
  including the RM20→RM100 step and the 13%→12% drop at exactly RM5,000.

---

## 2 · SOCSO / PERKESO

**Primary source (not reachable here):** *Employees' Social Security Act 1969,
contribution schedule* — <https://www.perkeso.gov.my/en/rate-of-contribution.html>

| Property | Value |
|---|---|
| Wage ceiling | **RM6,000** — raised from RM5,000 **effective 1 October 2024** |
| First Category (under 60) | employer **1.75%**, employee **0.5%** — Employment Injury + Invalidity |
| Second Category (60 and over) | employer **1.25%**, employee **0%** — Employment Injury only |
| Basis within a band | percentage of the **band midpoint**, rounded to the nearest 5 sen |
| Top band (5,900.01+) First Cat. | employer **RM104.15**, employee **RM29.75**, total **RM133.90** |
| Top band (5,900.01+) Second Cat. | employer **RM74.40**, employee **RM0** |

### A discrepancy that was resolved rather than averaged

One secondary source gave the top First Category band as employer RM104.65 /
employee RM29.90. That is **wrong**, and it was rejected on arithmetic rather
than on a vote:

```
band 5,900.01 – 6,000.00, midpoint 5,950
employee  0.5%  × 5,950 = 29.75          ✓ matches the workbook
employer  1.75% × 5,950 = 104.125 → 104.15 (nearest 5 sen)   ✓ matches the workbook
the rejected figures imply a midpoint of 5,980, which is not a band midpoint
```

The workbook figure is additionally corroborated by several independent payroll
references quoting the RM133.90 total. **This is corroboration, not verification.**

### "Wages" for SOCSO

Unlike EPF, the SOCSO definition of wages **includes overtime**. It excludes
travelling allowance, gratuity, retirement benefit, and payments in kind. This is
why overtime is SOCSO-liable but not EPF-liable, and why a single "gross" figure
cannot drive both.

---

## 3 · EIS / SIP (Employment Insurance System)

**Primary source (not reachable here):** *Employment Insurance System Act 2017* —
published with the SOCSO schedule.

| Property | Value |
|---|---|
| Wage ceiling | **RM6,000**, aligned with SOCSO from 1 October 2024 |
| Rate | employer **0.2%**, employee **0.2%** |
| Basis | band midpoint, same band structure as SOCSO |
| Top band (5,900.01+) | **RM11.90** each |
| Age 60 and over | **nil** — no EIS liability either side |
| Wages definition | follows SOCSO (includes overtime) |

The clinic workbook's 60+ EIS table is entirely zeros, which is correct.

---

## 4 · PCB / MTD — implemented as a blocking gap, not as a guess

**Primary source (not reachable here):** LHDN/HASiL *Specification for Monthly Tax
Deduction (MTD) Calculations using Computerised Calculation* —
<https://www.hasil.gov.my/en/employer/monthly-tax-deduction-mtd/>

There are two lawful methods:

1. **Computerised Calculation** — LHDN's published formula. Projects annualised
   chargeable income from year-to-date remuneration and remaining months, applies
   reliefs and the tax schedule, subtracts PCB already paid. This is what payroll
   software uses.
2. **Jadual PCB** — the annual lookup table, by wage range and category K0–K9.

**Neither is implemented, and neither has been approximated.** The brief is
explicit: *"Do not use the current simplified PCB band engine for live payroll…
If required data is missing: BLOCK PAYROLL OR FLAG A BLOCKING EXCEPTION. Do not
guess."*

Accordingly:

- The pre-existing simplified PCB band engine is **no longer reachable from a
  payroll run**.
- Every employee in a run raises a **blocking exception** — `PCB_RULESET_MISSING`
  — until a verified PCB rule set exists for the period.
- The data model carries the inputs the official method needs, so that
  implementing it later is configuration and code, not a migration:
  cumulative remuneration, current remuneration, **additional remuneration**
  (bonus, once- or twice-yearly incentives — classified separately from normal
  remuneration), YTD EPF paid and the RM4,000 EPF relief cap, prior PCB paid,
  zakat paid, remaining months in the year, marital/spouse status, number of
  qualifying children, and the employee's tax category.

Classifying bonus and annual incentives as **additional remuneration** rather
than normal remuneration is a real correctness requirement, not a refinement —
the two are taxed by different parts of the method.

---

## 5 · Other statutory employer costs

| Item | Treatment | Note |
|---|---|---|
| **HRD Corp levy** | Employer cost, **not** a payroll deduction | Clinic workbook uses **1% of basic**. Applicability depends on registration and headcount. Never appears on a payslip. |
| **Zakat pendapatan** | Employee election; a deduction that **must** reduce net pay | The clinic listing currently fails to deduct it (defect B-2). Also a PCB rebate under the official method. |

---

## 6 · Effective dating

Every rate set is stored with `effectiveFrom` / `effectiveTo` and is **frozen
into an approved payroll run**. Re-running a historical period uses the rate set
that was in force then, not today's. Changing a rate set never mutates an
approved run.

Known effective dates carried by the seed:

| Date | Change |
|---|---|
| **1 Oct 2024** | SOCSO and EIS wage ceiling RM5,000 → RM6,000 |

---

## Sources

Primary sources, **all unreachable from this environment** and therefore cited
as the verification targets rather than as consulted material:

- [EPF Act 1991 Third Schedule — KWSP](https://www.kwsp.gov.my/en/epf-act-1991-third-schedule)
- [Rate of Contribution — PERKESO](https://www.perkeso.gov.my/en/rate-of-contribution.html)
- [Monthly Tax Deduction (MTD) — HASiL/LHDN](https://www.hasil.gov.my/en/employer/monthly-tax-deduction-mtd/)

Secondary sources used for corroboration only:

- [New SOCSO and EIS Contribution Tables Effective October 1, 2024 — CentralHR](https://www.centralhr.my/new-socso-and-eis-contribution-tables-effective-october-1-2024/)
- [SOCSO Contribution Table — PayrollPanda](https://www.payrollpanda.my/help/socso-contribution-table/)
- [Jadual Caruman PERKESO — AJobThing](https://www.ajobthing.com/resources/blog/jadual-caruman-perkeso-socso-contribution-schedule)
- [EPF Contribution Rate Malaysia — QNE](https://qne.cloud/my/epf-contribution-rate-malaysia-guide-for-employers/)
- [Complete guide to PCB calculation methods — ACT Payroll](https://actpayroll.com/complete-guide-to-pcb-calculations/)

Clinic-supplied reference (authoritative for *the clinic's current process*, not
for the law): `AAS_PAYROLL_AUGUST.xlsx`, sheet `SOCSO-SIP-EPF Table`, extracted to
[`payroll-reference/aas-statutory-tables.json`](payroll-reference/aas-statutory-tables.json).
