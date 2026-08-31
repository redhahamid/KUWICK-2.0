# The clinic's payroll spreadsheets, read directly

Both workbooks were opened programmatically with `openpyxl` and read **as
formulas, not as values** — every rule below is quoted from the cell that
computes it, not inferred from a screenshot or a total.

| | Workbook | Sheets | Role |
|---|---|---|---|
| **A** | `AAS_PAYROLL_AUGUST.xlsx` | 9 | The **calculation engine**. Statutory tables, the contribution-liability matrix, OT tiers, ORP divisors, payslip templates. |
| **B** | `payroll_listing.xlsx` | 1 (`JAN 26`) | The **management reconciliation sheet**. One row per person, one row of totals, the payment-date split, and the locum day book. |

Extracted machine-readable copies of the statutory tables live in
[`docs/payroll-reference/aas-statutory-tables.json`](payroll-reference/aas-statutory-tables.json)
(7 tables, 1,470 bands) so the seed and the tests can be diffed against the
clinic's own reference rather than against prose.

> **The two workbooks disagree about who the employer is.** Workbook A says
> `Hijraa Sdn. Bhd.`; workbook B is headed `HIJRAA BANGI HEALTHCARE SDN. BHD.`
> Payroll, EPF/SOCSO/EIS submission and the EA form are all filed *per legal
> employer*, so this is not cosmetic. Kuwick must model the employing legal
> entity explicitly and cannot assume one tenant = one employer. **Owner
> decision required** — see the open questions at the end.

---

## 1 · Workbook A — the calculation engine

### 1.1 Sheets

| Sheet | Visible | What it is |
|---|---|---|
| `Summary` | yes | Company identity, the month, the three ORP divisors, the contribution-status legend, and totals that read back from `Payroll Listing` row 108. |
| `Payroll Listing` | yes | The run itself. 19 employees, rows 8–26; totals row 108; 75 columns. |
| `PaySlip D` / `PaySlip S` | yes | Two payslip templates driven by a staff-number picker. `D` is the current one; `S` is the same layout with simpler OT handling. |
| `PaySlip D/S -> Excel 93-2003` | yes | Fallback copies for old Excel, kept because the array formulas break there. |
| `SOCSO-SIP-EPF Table` | **hidden** | The seven statutory band tables. This is the sheet that matters. |
| `Caruman Table (<60)` / `(>60)` | yes | Printable EPF contribution tables for reference. |

### 1.2 The parameters everything else hangs off (`Summary`)

| Cell | Name | Value |
|---|---|---|
| `C11` | Salary for month | Aug 2026 |
| `C12` | **Ordinary Rate of Pay (Days) — OT** | **26** |
| `C13` | **Ordinary Rate of Pay (Days) — UPL** | **31** |
| `C14` | **Ordinary Rate of Pay (Hours)** | **7.5** |

Two different day divisors for two different purposes is deliberate, and it is a
clinic policy decision rather than a statutory one: overtime is priced on a
26-day month, unpaid leave is deducted on a 31-day month. Deducting on 31 and
paying on 26 is **more generous to the employee on UPL and to the employer on
OT** than using one divisor for both.

### 1.3 The contribution-liability matrix — the core of the model

`Summary` H18:K23 defines five **deduction status** codes, and row 7 of
`Payroll Listing` assigns one to every earning and deduction column:

| Code | Meaning | EPF base | SOCSO/EIS base | Counts toward ORP |
|---|---|:--:|:--:|:--:|
| 1 | No contribution | — | — | — |
| 2 | EPF, SOCSO & EIS | ✓ | ✓ | **✓** |
| 3 | SOCSO & EIS only | — | ✓ | — |
| 4 | EPF only (No ORP) | ✓ | — | — |
| 5 | EPF, SOCSO & EIS (No ORP) | ✓ | ✓ | — |

The three statutory bases are then built by summing only the columns carrying a
qualifying code — quoted verbatim from row 8:

```
BF (EPF base)   = IF(G="No", 0, T + SUMIF(status,"2") + SUMIF(status,"4") + SUMIF(status,"5")
                                  − SUMIF(dedn status,"2") − SUMIF(dedn status,"4") − SUMIF(dedn status,"5"))
BG (SOCSO base) = IF(H="No", 0, T + SUMIF(status,"2") + SUMIF(status,"3") + SUMIF(status,"5")
                                  − SUMIF(dedn status,"2") − SUMIF(dedn status,"3") − SUMIF(dedn status,"5"))
BH (EIS base)   = identical to BG, gated on I
```

This is a genuinely good design and **Kuwick should adopt its shape**: liability
is a property of the *component*, declared once, and the bases fall out of it.
The current Kuwick engine has no such per-component matrix.

### 1.4 What each column is actually set to, in the August run

| Col | Component | Status | Consequence |
|---|---|:--:|---|
| AG | Overtime | **3** | SOCSO/EIS yes, EPF no |
| AH | Procedure incentives | 1 | nothing |
| AI | BOD fee (July) | 1 | nothing |
| AJ | Outreach & mileage claim | 1 | nothing |
| AK | **Allowance** | **1** | nothing |
| AL | **Attendance** | **1** | nothing |
| AM | **Commission / other incentives** | **1** | nothing |
| AN | Locum (July) | 1 | nothing |
| AS | Unpaid leave | 2 | reduces all three bases |

**Overtime at status 3 is correct.** The EPF Act 1991 s.2 definition of *wages*
expressly excludes overtime, while the Employees' Social Security Act and the
Employment Insurance System Act include it. The spreadsheet gets this right and
the current Kuwick engine does not model the distinction at all.

**Allowance, attendance and commission at status 1 are the finding that matters.**
Under the EPF Act, *wages* means "all remuneration in money … payable under a
contract of service", with a closed list of exclusions (service charge, overtime,
gratuity, retirement benefit, retrenchment benefit, travelling allowance, and
anything gazetted as exempt). **Commission is not on that exclusion list.** A
fixed monthly allowance and an attendance allowance are not on it either. On the
face of the Act, these three columns are EPF-liable and are currently being
treated as though they are not.

Mileage/outreach at status 1 is defensible — travelling allowance *is* an
express exclusion. BOD fee at status 1 is defensible if the recipient is a
director paid director's fees rather than under a contract of service.

> **This is a compliance exposure of roughly RM4,894 of un-based earnings in one
> month** (allowance 1,350 + attendance 550 + commission 2,994.90), on which no
> EPF was contributed by either side. **Kuwick will not silently replicate this.**
> The component model ships with these categories defaulting to EPF-liable, and
> any clinic that wants them exempt must set that deliberately, with the choice
> recorded and dated. See `docs/MALAYSIA_PAYROLL_STATUTORY_SOURCES.md`.

### 1.5 Overtime

Four independently configurable tiers. Row 2 holds a flat RM/hour, row 3 holds a
multiple; a tier uses the multiple when it is non-zero, otherwise the flat rate:

```
V8 = IF(U8<=0, 0, IF(W$3=0, W$2, BE8*W$3))      hourly rate for tier 1
W8 = ROUND(U8*V8, 2)                             tier total
AG8 = W8+Z8+AC8+AF8                              overtime earned
```

August configuration: **1.5×, 2.0×, 3.0×, and a fourth tier at a flat RM10/hour.**
The hourly base is `BE = ROUND(BD / 7.5, 2)` where `BD` is the 26-day ORP — so
the OT hourly rate is *rounded to sen before* being multiplied by hours and the
multiplier. That rounding order is reproducible and Kuwick must match it exactly
or every OT figure will differ by a sen or two.

### 1.6 Unpaid leave

```
AS8 = IFERROR(ROUND(N8 * BC8, 2), 0)          N = number of UPL days
BC8 = (Basic + status-2 earnings) / 31        daily ORP
```

UPL carries status 2, so it reduces the EPF, SOCSO and EIS bases as well as pay.

### 1.7 The statutory tables (hidden sheet)

Seven tables, all structured `min | max | employer | employee | total`, all
looked up with `VLOOKUP(..., TRUE)` — approximate match on a sorted band table.

| Block | Table | Bands | Top band |
|---|---|--:|---|
| `B:F` | SOCSO First Category (<60) | 65 | 5,900.01+ → er **104.15**, ee **29.75** |
| `I:M` | EIS / SIP (<60) | 65 | 5,900.01+ → **11.90 / 11.90** |
| `P:T` | EPF, employee 11% (<60) | 403 | 20,000.01+ → formula |
| `W:AA` | EPF, employee 9% (<60) | 402 | 19,900.01–20,000 → er 2,400, ee 1,800 |
| `AD:AH` | SOCSO Second Category (60+) | 65 | 5,900.01+ → er **74.40**, ee **0** |
| `AK:AO` | EIS / SIP (60+) | 65 | **all zero** |
| `AR:AV` | EPF 60+ (citizen) | 403 | 19,900.01–20,000 → er **800** (4%), ee **0** |

Verified band behaviour in the EPF table:

```
4,980.01 .. 5,000    employer 650  (13.00%)   employee 550  (11.00%)   ← RM20 steps
5,000.01 .. 5,100    employer 612  (12.00%)   employee 561  (11.00%)   ← RM100 steps
```

Both the **RM20 → RM100 step change** and the **13% → 12% employer rate drop at
exactly RM5,000** are present and correct, and the contribution is computed on
the **band ceiling** then rounded up to the next ringgit — not on the actual
wage. A naïve `wage × 13%` implementation disagrees with this on almost every
row. Above RM20,000 the workbook switches to `ROUNDUP(base × rate, 0)`.

The SOCSO and EIS ceilings are **RM6,000**, which is the post-1 October 2024
position. The tables are current.

### 1.8 Age handling

Column `F` is a literal `Yes`/`No` for "> 60". Everything branches on it:

- EPF: under 60 → 11%/13–12% tables; 60+ → employee **0**, employer **4%**.
- SOCSO: under 60 → First Category; 60+ → Second Category (employer only).
- EIS: under 60 → 0.2%/0.2%; 60+ → **0**, correctly, because the 60+ EIS table is
  entirely zeros.

Column `K` is the employee EPF rate (`11` or `9`), selecting between the two
employee tables. This is the statutory-minimum-election flag.

### 1.9 The two things the workbook does **not** calculate

| Column | What it is | How it is populated |
|---|---|---|
| `AT` **PCB** | Monthly tax deduction | **Typed in by hand.** No formula anywhere in the workbook. August total RM13,181.35. |
| `AP` **Employee SOCSO** | Employee's SOCSO share | **Typed in by hand**, even though employer SOCSO on the very next column *is* a `VLOOKUP`. |

PCB being manual is the single largest gap between this spreadsheet and a payroll
system: it means every month somebody computes tax outside the workbook and keys
19 numbers, with no audit trail and no arithmetic check. Employee SOCSO being
manual next to a formula-driven employer SOCSO is an accident waiting to happen —
the two must agree on the same band and nothing enforces it.

### 1.10 Payslip layout (`PaySlip D`)

```
  Company name (reg. no.) / address / phone
  PRIVATE AND CONFIDENTIAL          PAYSLIP        End Month: <month>
  NAME  EMPLOYEE NO.  IC NO.  EPF NO. | JOB POSITION  BANK NAME  BANK A/C NO.
  ┌ EARNING (RM) / +      ─────────┬─ DEDUCTION (RM) / −  ────────┐
  │ BASIC PAY … up to 9 lines      │ … up to 9 lines              │
  ├ TOTAL EARNING                  ┼ TOTAL DEDUCTION              ┤
  │ NET PAY                        │ EMPLOYER EPF / SOCSO / EIS   │
  └────────────────────────────────┴──────────────────────────────┘
  Overtime Summary: rate | hours | HRP | total   (4 tiers + total)
  Gross Pay Subject To: EPF / SOCSO / EIS
  APPROVED BY :                    RECEIVED BY :
  -- POTONG GARISAN DI ATAS --
```

That is the spec Kuwick's payslip must satisfy. Note it shows **employer**
contributions and the **three statutory bases** on the employee's own payslip —
both are good practice and both are absent from Kuwick today (which has no
payslip at all).

---

## 2 · Workbook B — the management listing

One sheet, `JAN 26`, headed `PAYROLL LISTING JAN 2026 HIJRAA BANGI HEALTHCARE
SDN. BHD.`, containing **two separate populations with different column
meanings**:

| Block | Rows | Who | Employee nos. |
|---|---|---|---|
| 1 | 4–22 | Salaried staff | 19–52 |
| 2 | 27–33 | Doctors / board | 1–3 |

### 2.1 The payment-date split — a business rule Kuwick does not model at all

| Block | Column | Paid on | Contents |
|---|---|---|---|
| 1 | `AE` **NET PAY (30HB)** | 30th | Basic + allowances + night incentive − deductions |
| 1 | `AF` **TOTAL 15HB** | 15th | OT + commission + attendance + bonus + other claim + panel claim |
| 2 | `AE` **NET PAY (30HB)** | 30th | as above, less locum/BOD/housecall |
| 2 | `AF` **BOD FEE (1HB)** | 1st | Director fee |
| 2 | `AG` **LOCUM, HOUSECALL, OTHERS (15HB)** | 15th | Locum + housecall + allowances + bonus + incentives + claims |

**One payroll period produces up to three payment batches on three dates.** Any
bank-file export that assumes "one run, one payment date" cannot reproduce this
clinic's actual payment behaviour.

The header `AF3 = 'OT DEC 25'` and columns `N28 = 'LOCUM DEC'`, `O28 = 'BOD FEE
DEC'` also establish that **variable pay is paid one month in arrears** — January's
run pays December's overtime, locum and board fees. Kuwick's payroll input model
must carry the *earning period* separately from the *payment period*.

### 2.2 Employer cost

```
AH (TOTAL COMPANY SPENT) = SUM(H:T)
```

— basic + employer EPF + employer SOCSO + employer EIS + **HRD levy** + every
earning. `L (HRD LEVY) = H * 0.01` — 1% of basic, an employer cost that is not a
payroll deduction and does not appear on any payslip. Kuwick currently has no
concept of HRD levy.

### 2.3 Confirmed formula defects in workbook B

These are errors in the spreadsheet, listed so they are **not** reproduced.

| # | Where | Formula | Defect |
|---|---|---|---|
| **B-1** | Row 22 totals | `H22=SUM(H5:H21)` but `I22..X22=SUM(…5:…20)` | Basic pay totals 17 rows; **employer EPF/SOCSO/EIS, HRD and employee EPF/SOCSO/EIS total only 16.** Employee 52 (row 21) is silently missing from every statutory total. The month's contribution totals are understated. |
| **B-2** | Block 1 net pay | `AE=SUM(H+M+R, V:AC)` | The deduction range stops at `AC`; **`AD` is ZAKAT.** Zakat is never deducted from net pay in block 1. |
| **B-3** | Block 2 total earning | `AC=SUM(H+N+O+P+T)` | Omits `M` allowances, `Q` bonus, `R` incentives, `S` other claim. "Total earning" is not the total of the earnings. |
| **B-4** | Block 2 net pay | `AD=SUM(AC−AA+V+W+X)` | Subtracts PCB and the three statutory deductions only — **omits `Y` other deduction, `Z` hutang medical claim, and `AB` zakat pendapatan.** |
| **B-5** | Row 22 | `AF22=SUM(AF5:AG21)` | Sums across `AG`, which has no header in block 1. Harmless today; a landmine if anyone puts data there. |
| **B-6** | Locum day book, D36:D58 | text dates | `1/1/26`, `2/1/26` … stored so that Excel read them as 1 Jan, 1 Feb, 1 Mar … while D59 onward are text strings. **The day book's dates are locale-ambiguous and partly wrong.** The total `E85` is still right; the dates are not. |

B-1 and B-4 have direct money consequences. B-1 understates what the clinic
reports as contributed; B-4 overstates what it pays a doctor whenever any of
those three deduction columns is used.

---

## 3 · Clinic rule vs statutory rule vs workaround

| Rule | Class | Kuwick treatment |
|---|---|---|
| EPF band table, ceiling rounding, 13/12% step, RM20k switch | **Statutory** | Implement exactly; seed from the official Third Schedule. |
| SOCSO First/Second Category, RM6,000 ceiling | **Statutory** | Implement exactly. |
| EIS 0.2/0.2, RM6,000 ceiling, nil at 60+ | **Statutory** | Implement exactly. |
| EPF 60+ → employee 0 / employer 4% | **Statutory** | Implement. |
| Overtime excluded from EPF base | **Statutory** | Implement as a component flag. |
| OT 1.5× / 2× / 3× | **Statutory minimum** (EA 1955) | Configurable, defaulting to these. |
| 4th OT tier at flat RM10/hr | **Clinic** | Support flat-rate OT tiers. |
| 26-day OT divisor, 31-day UPL divisor, 7.5 h/day | **Clinic policy** | Configurable per employer; both divisors separately. |
| Allowance / attendance / commission exempted from EPF | **Workaround — likely non-compliant** | Do **not** replicate. Default liable; exemption must be an explicit dated choice. |
| PCB keyed by hand | **Workaround** | Replace with a real MTD engine. |
| Employee SOCSO keyed by hand | **Workaround** | Replace with the same table lookup as employer. |
| Variable pay one month in arrears | **Clinic** | Model earning period ≠ payment period. |
| Three payment dates per run | **Clinic** | Model payment batches within a run. |
| HRD levy 1% of basic | **Statutory** (HRD Corp, where registered) | Employer cost line; not a deduction. |
| Zakat | **Employee election** | Deduction component; must actually reduce net pay (cf. B-2). |
| Two legal entities across the two workbooks | **Unresolved** | Model the employing entity explicitly. |

---

## 4 · What this means for Kuwick

Ordered by how much they block replacing the spreadsheet.

1. **A real PCB/MTD engine.** The workbook does not have one; the clinic computes
   tax outside it. Without this Kuwick cannot claim to replace the process.
2. **Per-component statutory liability**, exactly the shape of §1.3. Kuwick's
   current engine has one flat notion of "gross" and cannot express "overtime is
   SOCSO wages but not EPF wages".
3. **Band-table statutory calculation**, not percentage arithmetic. Seeded from
   the official schedules, effective-dated, frozen into approved runs.
4. **Payslips**, to the §1.10 layout. Kuwick has none.
5. **Earning period ≠ payment period**, and **multiple payment batches per run**.
6. **Employing legal entity** as a first-class object, above branch.
7. **ORP divisors** configurable, with OT and UPL separate.
8. **Employer-cost lines** that are not deductions — employer EPF/SOCSO/EIS and
   HRD levy — feeding Finance rather than the payslip's net pay.

---

## 5 · Open questions for the owner

These cannot be resolved from the files and are **not** being guessed at.

1. **Which legal entity employs whom?** `Hijraa Sdn. Bhd.` and `HIJRAA BANGI
   HEALTHCARE SDN. BHD.` both appear. EPF/SOCSO/EIS/PCB and the EA form are filed
   per employer.
2. **Allowance, attendance and commission — is the EPF exemption deliberate?**
   If it is, on what basis (gazetted exemption? reclassified as reimbursement?).
   Kuwick will default them to EPF-liable until told otherwise.
3. **Is anyone's employee EPF rate 9% rather than 11%?** The workbook supports it
   (`K`), and the August run has everyone at 11.
4. **Are the board members employees or directors?** It changes their EPF, SOCSO
   and PCB treatment entirely.
5. **Zakat** — should it reduce net pay (defect B-2 says it currently does not),
   and is it a PCB rebate?
6. **Is the clinic HRD Corp registered**, and is the levy 1% of basic only?
