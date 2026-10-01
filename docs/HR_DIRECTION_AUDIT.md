# HR module direction audit

Report only. Nothing in this document changes code. Every statement is tagged:

- **[D]** observed in the Kuwick code or database on branch `claude/malaysia-payroll-final-validation-h1h6xi` at commit `7d82564` (Batch 8).
- **[A]** assumption, or a statement about another product taken from its public material rather than from using it. Competitor features move; treat each [A] as "worth checking on their site before deciding".

The four products the user named are compared on the same axis Kuwick's own payroll screen uses: **Setup**, then the monthly cycle **Prepare, Adjust, Review, Pay**, then what happens after the month (filing, reports, year end).

## 1. What Kuwick has today

### 1.1 Setup

| Area | Kuwick today | Tag |
| --- | --- | --- |
| Legal employer (company) | One or more legal employers per tenant with registration, EPF, SOCSO, LHDN and HRD numbers; HRD status (s.14, s.15, not registered). | [D] `LegalEmployer`, Company page |
| Branches | Payroll runs are per branch (clinic) and per legal employer; "All branches" view lists every branch's run. | [D] `PayrollRun.clinicId`, B2-14 |
| Employees, one at a time | Guided Add employee form in stages: identity (IC-derived date of birth and gender), employment, pay, statutory standing, bank, address, emergency contact. | [D] `AddEmployeePage.tsx`, B3-31 |
| Employees, several at once | Editable grid of up to 200 rows plus a CSV template; same validation path as the single form (`/workforce/employees/intake`, dry run then commit). No .xlsx. | [D] Batch 4 |
| Statutory standing | Dated classification rows per employee: EPF part and basis, SOCSO category, EIS, LINDUNG 24 JAM participation (blank = enrolled), PCB residency and category, hand-entered PCB, additional PCB each month, HRD. | [D] `EmployeeStatutoryClassification`, Batch 5 |
| Pay items | A catalogue per tenant with separate EPF, SOCSO, EIS, PCB and HRD liability flags, ORP base flag, additional-remuneration flag, an EA box mapping (`eaField`, stored but read by nothing), own grid columns with carry-forward. | [D] `PayrollItem`, CF-1 |
| Recurring items per employee | Monthly items with a from and until month, priced per clinic rate where a rate applies. | [D] `EmployeeRecurringItem` |
| Statutory tables | Built-in EPF Third Schedule, SOCSO Act 4 (with SKBBK), EIS Act 800, PCB 2026 parameters, HRD rates; a registry with verification and a clinic-side "checked on" mark. Platform-added later editions with source document, year and in-force date (Batch 6). | [D] `apps/api/src/statutory`, Batch 6 |
| Leave | Leave types and policy per tenant, annual leave days per employee, s.60E(3) choice for untaken leave on exit, requests, calendar, balances. | [D] 3e-2, 60E |
| Attendance | Clinic-local attendance day, timesheet, roster, corrections, monthly summary, geofence and selfie proof. | [D] 3e-1, 3g-2 |
| Claims | Claim types, receipts, mileage, HR-recorded claims on behalf of an employee, paid through payroll. | [D] 3e-3, B2-18 |
| Opening balances | Year-to-date figures for employees who joined mid-year. | [D] Opening balances page |
| Roles and permissions | Role enum plus scoped permissions (`hr.payroll.view`, `hr.payroll.export.statutory`, ...), branch scope on every HR read. | [D] B2-22/24, BF-2 |
| Employee self-service | My Kuwick portal: payslips, leave, claims, attendance. | [D] `apps/web/src/me` |
| Look and feel | HR and the portal read the product's brand tokens (navy, royal blue, the product font and icon set) from `design-system/tokens.ts`; no palette of their own. | [D] Batch 7 |

### 1.2 The monthly cycle

| Stage | Kuwick today | Tag |
| --- | --- | --- |
| Prepare | Create the month per branch and employer; carry forward own columns; recurring items; attendance, leave, claims and public holidays feed inputs; bulk recalculation of the whole run. | [D] `payroll.service.ts`, CF-3 |
| Adjust | Inputs drawer per employee with grouped lines, add, edit, remove, earned-in month (arrears lines carry their month on the payslip label); spreadsheet editing of own columns with one save; hand-entered PCB and additional PCB. | [D] OI-2, CF-4, Batch 5 |
| Review | Exception centre: blocking and informational exceptions, overrides with a reason, once-per-year acknowledgement of the employer-selected EPF basis; variance report against the previous month; provisional warning on every report until approval. | [D] `PayrollExceptionCentre.tsx`, Batch 5 |
| Pay | Approve locks a verified snapshot (hash); payslips as PDF, with "how this was worked out" on the web payslip (Batch 6); payment instruction listing as CSV (explicitly not a bank file) and "record paid" with date and reference; statutory outputs per scheme with CSV listing; the filing helper per agency with joiners, leavers, totals and "mark as submitted" (Batch 8). | [D] `payroll-payment.service.ts`, `payroll-statutory-output.service.ts`, `payroll-filing.service.ts` |
| After | Register, employer cost, statutory, variance, history, YTD, PCB, overtime, unpaid leave, incentives, exceptions, payment status, claims reports; CP39-style PCB listing; EA and Borang E listed as "not built". | [D] `PayrollReportsPage.tsx` |

## 2. The four products, on the same axis

Everything in this section is **[A]** unless marked otherwise: it comes from the products' public pages and the author's general knowledge, not from an account on each product.

### 2.1 Setup

| Area | Talenox | PayrollPanda | SQL Payroll | Kakitangan | Kuwick gap |
| --- | --- | --- | --- | --- | --- |
| Company and statutory numbers | Yes | Yes | Yes | Yes | None [D] |
| Employee import | Excel template | Excel/CSV template | Excel import | CSV | Kuwick has CSV only; no .xlsx [D] |
| Pay item catalogue with statutory flags | Yes, EA mapping built in | Yes | Yes, EA mapping | Yes | EA mapping stored, not read [D] |
| Statutory tables kept current by the vendor | Yes | Yes | Updates by patch | Yes | Batch 6 gives the platform the same lever [D] |
| Leave and attendance | Leave yes; attendance via partners | Leave yes; attendance basic | Leave yes; separate time module | Leave and attendance | None material [D] |
| Claims | Yes | Yes | Yes | Yes | None material [D] |
| Employee mobile app | Yes | Yes | No native app | Yes | Kuwick has a mobile-first web portal, no store app [D] |

### 2.2 Monthly cycle

| Stage | Talenox | PayrollPanda | SQL Payroll | Kakitangan | Kuwick gap |
| --- | --- | --- | --- | --- | --- |
| Prepare | Auto-run from master data | Same | Same, desktop | Same | None material [D] |
| Adjust | Ad-hoc items per month | Same | Same | Same | None material; Kuwick's earned-in month on arrears is ahead of most [A] |
| Review | Validation warnings, comparison to last month | Same | Reports | Same | None material [D] |
| Pay: bank file | Bank-specific files (Maybank, CIMB, etc.) | Bank files | Bank files | Bank files | **Kuwick produces a listing only** [D]; a verified format per bank is the blocker |
| Pay: statutory files | KWSP i-Akaun CSV, PERKESO ASSIST file, LHDN e-PCB/e-Data PCB text file | Same set | Same set | Same set | **Kuwick produces listings only** [D], by design until a verified format is on record |
| Payslips | PDF, email, app | Same | PDF | Same | Kuwick: PDF and portal; email-all exists [D] |

### 2.3 Year end

| Item | Talenox | PayrollPanda | SQL Payroll | Kakitangan | Kuwick |
| --- | --- | --- | --- | --- | --- |
| Form EA per employee | Yes | Yes | Yes | Yes | **Not built** [D] |
| Borang E and C.P.8D | Yes | Yes | Yes | Yes | **Not built** [D] |
| PCB 2 (II) / TP1 / TP3 | Partial | Partial | Yes | Partial | TP1 entries recorded as LP1 [D]; no forms |

## 3. Where Kuwick is ahead, and where it is behind

Ahead [D]:

- Every statutory figure is reproducible: the snapshot carries the schedule edition, the inputs and (from Batch 6) the working rows, and the hash is verified before anything is filed or paid.
- The employer-selected EPF basis is an explicit, acknowledged policy decision with a discrepancy exception, not a silent setting.
- Clinic-specific pricing: locum rates, public-holiday pay lines, s.60E(3) handling, SKBBK with an opt-out form rather than a toggle.
- Branch scope on every read; a platform/tenant split so a clinic cannot edit a statutory table.

Behind [D], in the order it costs a clinic time each month:

1. **No upload files for any portal.** Each month the person keys EPF, SOCSO/EIS and PCB from a listing. Every competitor emits the portal's own file. The register's position is correct (no verified format on record), but the fix is a verification task, not a design one: obtain each portal's current specification, encode it, and test the output against a portal's validator with the demo world.
2. **No bank file.** Same shape of blocker.
3. **No Form EA, Borang E or C.P.8D.** The year-end return is the one thing a clinic cannot do by hand in an afternoon. Plan in section 5.
4. **No .xlsx import** for bulk entry (CSV only).
5. **No native mobile app**; the portal is a mobile-first web page.

## 4. The filing helper (Batch 8) against the same four

[D] The filing helper gives, per agency (KWSP, PERKESO with EIS and SKBBK, LHDN PCB, HRD Corp), the list in portal order (name, IC, membership number, amount), who joined and who left this month (from each person's start and last day and from last month's approved payroll), the totals to pay, and "mark as submitted" with the portal's date and reference, written on every scheme the agency covers. [A] That is what the four products show on their filing screens, minus the file download: it answers "who do I add or remove at the portal this month", which a listing alone never did. The gap that remains is the file itself, section 3.

## 5. Form EA plan

The EA form (C.P.8A) is the employer's yearly statement of remuneration to each employee, issued by the last day of February for the previous year, and Borang E (with the C.P.8D employee listing) is the employer's return to LHDN by 31 March. [A] on the dates: confirm against LHDN's current filing calendar before the first year end.

### 5.1 What exists [D]

- `PayrollItem.eaField` holds a free-text box mapping per pay item and nothing reads it.
- Approved snapshots hold every payslip line with its item, EPF/SOCSO/EIS/PCB figures, zakat and CP38 where entered, per employee per month, hashed.
- `EmployeeTp1Entry` records TP1 reliefs the employer approved (LP1).
- Opening balances record year-to-date figures for mid-year joiners from a previous employer; those belong on the previous employer's EA, not on this one, and the aggregator must leave them out.
- The platform-owned statutory table versions (Batch 6) give a pattern for a vendor-maintained catalogue with an in-force date.

### 5.2 Steps, in order

1. **EA box catalogue, versioned by year, platform-owned.** Encode the C.P.8A boxes for the year (B1 gross salary and wages, B1(a) to B1(g) sub-items such as fees, commissions, bonus, gratuity, allowances; B2 benefits in kind; B3 value of living accommodation; B4 refunds from unapproved funds; B5 compensation; C pension and annuity; D1 PCB paid; D2 CP38; D3 zakat; D4 EPF employee contribution; D5 SOCSO; D6 EIS; E tax-exempt allowances, perquisites and benefits; F prior employment details) as a table with a source document and a year, exactly as Batch 6 did for statutory tables. Stop point for the user: the box list is a statutory interpretation and must be checked against the year's actual form.
2. **Replace `eaField` free text with a reference to the catalogue** and a validation that every pay item that is PCB-liable or marked tax-exempt has a box. Migration is a widening with a backfill from the current strings where they match.
3. **Year aggregator from approved snapshots only.** One service that sums per employee, per legal employer, per box across the year's APPROVED and PAID runs, rejecting any run whose hash fails verification; outputs a per-employee EA record with the employer's details as at generation and the months covered. Mid-year joiners get an EA for the months this employer paid; leavers get one up to the leaving month.
4. **EA as PDF per employee**, from the existing payslip PDF pipeline, with a generated-on stamp and the snapshot hashes it was built from; downloadable from Reports and from the employee portal.
5. **Borang E summary and the C.P.8D listing** as a listing first (the same honesty rule as the statutory listings), then as the e-Filing CSV/TXT once the format is verified against LHDN's specification for the year.
6. **Tests with the demo world only:** one employee with a bonus and an exempt allowance, one with CP38, one mid-year joiner, one leaver; the EA totals must equal the sum of the twelve payslips to the sen.

### 5.3 Effort and dependencies [A]

Steps 1 and 2 are a day each; step 3 is the core (two to three days with tests); steps 4 and 5 a day each; step 6 runs alongside. The file formats in step 5 are the only external dependency.

## 6. Recommendations, in order

1. Finish the three verified-format tasks (KWSP, PERKESO, LHDN PCB) before any bank file: they recur monthly for every clinic.
2. Build Form EA before the first year end a paying clinic reaches on Kuwick; the aggregator in step 3 above is the same code Borang E needs.
3. Keep listings and "recorded by a person" as the model until each format is verified; do not present an unverified file as a submission file.
4. Add .xlsx to bulk entry only if a clinic asks; CSV from Excel works today.

## 7. Sources for the [A] statements about the four products

Read on 1 October 2026 through a web search; each is the vendor's own material or a third-party listing, not a hands-on test.

- Talenox: bank file export under "Export Bank Payments / EPF / PCB(MTD)", statutory file exports, Form EA, Form E, STD2 and CP22. [Processing payroll, Malaysia](https://help.talenox.com/en/articles/5252231-payroll-app-guide-malaysia), [Talenox Malaysia](https://www.talenox.com/my), [Talenox payroll](https://talenox.com/my/payroll).
- PayrollPanda: EPF file generation for KWSP and bank portals, Form EA and Form E, Borang E, PCB 2, Borang A, HRDF report, bank salary files. [PayrollPanda on the Xero app store](https://apps.xero.com/my/function/payroll-hr/app/payrollpanda), [EPF automatic calculation](https://get.payrollpanda.my/epf-kwsp).
- SQL Payroll: online submission to KWSP, PERKESO and LHDN portals, EA forms for all employees in two clicks, Borang E, payment files for more than 25 banks. [SQL payroll software Malaysia](https://www.sql.com.my/payroll-software-malaysia).
- Kakitangan: auto EPF, SOCSO, EIS and PCB on current tables, auto-generated EA Form and CP8D, Borang A, Borang 8A, CP39 and bank salary files, LHDN e-filing. [Kakitangan payroll and HR compliance guide](https://kakitangan.com/guides/payroll-hr-compliance-guide-malaysia), [best payroll software Malaysia, Akrivia](https://akriviahcm.com/blog/best-payroll-software-malaysia).
