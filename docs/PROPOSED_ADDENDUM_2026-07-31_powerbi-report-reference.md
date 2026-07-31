# Addendum: Owner-supplied Power BI report as the Finance/Operation reference

**Date**: 2026-07-31
**Source**: `CLINIC_REPORT.pbix`, supplied directly by the owner as the real report their clinic (Klinik Perubatan Hijraa 24 Jam) already runs. Extracted by unzipping the `.pbix` (a zip container) and reading `Report/Layout` (UTF-16LE JSON) — no Power BI Desktop needed, DAX/data model itself (`DataModel`) not parsed (proprietary binary format).

This is the concrete reference for the Finance/Operation Reports phase (see `DECISIONS.md` D-033 and the open Management/Reports gaps). Treat every metric below as a real, currently-used report, not a hypothetical.

## Report pages (in the owner's own file)
1. **FRONT PAGE** — cover/title page ("CLINIC REPORT", clinic name, month slicer)
2. **OVERVIEW**
3. **SALES ANALYSIS**
4. **SALES ANALYSIS PART 2**
5. **PATIENT ANALYSIS**
6. **PROCEDURE ANALYSIS**
7. **RESIDENTS PERFORMANCE ANALYSIS**
8. **MINOR SURGERY ANALYSIS**

## Underlying tables/fields (from `queryRef`s)
- `DATA1` — month-level rollup: `TOTAL SALES`, `PANEL SALES`, `NON-PANEL SALES`, `CONSULTATION REVENUE`, `DRUGS REVENUE`, `SERVICES REVENUE`, `OTHERS REVENUE`, `AVERAGE CHARGE PER PATIENT`, `AVERAGE CHARGE PER PANEL PATIENTS`, `AVERAGE CHARGE PER NON-PANEL`, plus Month/Quarter/Year.
- `SALES & PATIENTS` — visit-grain fact table: `Total Amount`, `Patient Type` (e.g. `OTC`), `Type`, `Visit Reason`, `Visit Time`, `Age Group`, `Gender`, `Insurance/Panel`, `Doctor`, `Day Name`, `Hour`, a full Date Hierarchy (Day/Month/Quarter/Year) on "Date/Time In".
- `CLINIC SERVICES` / `MINOR SURGERY` — charge-grain: `Charge Description`, `Charge Description Group`, `Doctor`, `Total Revenue`, Month/Quarter/Year (e.g. `XRAY ONLY (NO CONSULT)` as one real charge description).
- `DOCTORS PERFORMANCE` — per-doctor monthly rollup: `DOCTOR`, `NO. PATIENT`, `SALE`, `CONSULTATION REVENUE`, `DRUGS REVENUE`, `SERVICES REVENUE`, `OTHERS REVENUE`, `AVERAGE CHARGE PER PATIENT`, `SCORE`.

## Visual types used
Mostly `pieChart`/`donutChart` (25 combined) and heavy use of `slicer` (28) for Month/Quarter/Year/Doctor/Patient Type/Visit Reason/Charge Description Group filtering — confirms `PRODUCT_REQUIREMENTS.md` §12's "interactive, filterable, drill-down" requirement is describing this exact report, not an aspirational one. Also: `lineStackedColumnComboChart` (trend + breakdown combo, 3x), `clusteredColumnChart`, `areaChart` (2x), `lineChart`, `card` (KPI numbers), `actionButton`/`pageNavigator` (page-to-page navigation UI).

## Concrete chart titles (owner's real report — build to match these, not invented ones)
**Sales Analysis**: "% of Non-Panel & Panel Sales", "% by Charge Description Group", "% by Charge Description", "% by Doctors", "% of Sales by Doctors", "% of Sales by Panel Company", "Total Sales & Patients by Day" (implied trend).

**Patient Analysis**: "% of Existing & New Patients", "% of Non-Panel & Panel Patients", "% of Patients by Age Group", "% of Patients by Gender", "% of Patients by Panel", "Patient Attendance by Hour", "Total Patient Attendance by Day", "Sum of Total Amount vs Visit Reason", "Sum of Total Amount vs Visit Time", "Sum of Total Patients vs Types of Patients", "Sum of Total Patients vs Visit Reason", "Sum of Total Patients vs Visit Time".

**Residents Performance Analysis**: "Performance Score of Resident Doctors", "% of Revenue by Category (by Resident Doctors)" — per-doctor NO. PATIENT / SALE / CONSULTATION-DRUGS-SERVICES-OTHERS REVENUE / AVERAGE CHARGE PER PATIENT / SCORE.

**Procedure Analysis / Minor Surgery Analysis**: revenue by Charge Description / Charge Description Group / Doctor, filterable by Month/Quarter/Year.

## Implication for KUWICK-2.0's schema
- `Visit`/`Invoice` already capture most of the raw grain needed (panel vs cash, doctor, service line items) — the gap is aggregation/reporting queries and a "Charge Description Group" concept (a category one level up from an individual `ServiceCatalog`/Item line — needs a grouping field, distinct from `ServiceCatalog.category` which is more granular).
- "Existing & New Patient" and "Age Group"/"Gender" splits need Patient-level demographic + first-visit-ever detection, not currently in any report query.
- A per-doctor "SCORE" metric exists in the source report but its formula is not visible from the layout alone (it's a DAX measure inside `DataModel`, which this extraction did not parse) — do not invent a formula; this is the same class of gap as OQ#2 (Doctor Incentive Engine) and should get the same "ask the owner for the exact formula" treatment before building it.
