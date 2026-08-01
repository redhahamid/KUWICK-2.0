# Klinik Hijraa CMS — Admin section reference (2026-08-01)

Owner-authorized live review of `https://klinik-hijraa.onrender.com` (owner logged in,
handed the session over for analysis) — capturing structure and design patterns only,
to inform KUWICK's Reports/Analytics redesign and, incidentally, the blocked Doctor
Incentive formula. No patient-identifying data is reproduced beyond what's needed to
describe table structure (a few sample rows already visible in the admin's own
aggregate/staff-facing screens, not raw clinical records).

## Admin section is 5 tabs: Operation, Stock, Panel, HR, Finance

### Operation — the flagship analytics dashboard (primary design reference)

This is the one tab that's a real interactive analytics dashboard, not a table. Structure,
top to bottom:

- **Header**: page title + one-line description of what the page covers.
- **Filter row** (one row, above everything): date-range **pills** (30 Days / 3 Months /
  6 Months / 12 Months / Custom), not a calendar-first picker; a "click any chart to
  replay" hint with a replay icon (charts re-run their entrance animation on click —
  polish, not core function).
- **KPI row**: 4-5 stat tiles, each an icon + label + big number + small subtitle
  (e.g. "AVG WAIT — 0m — vs last period"). No delta/sparkline observed on this tab
  specifically, but the pattern (icon-labeled tile) is consistent everywhere.
- **Chart grid** (2-column cards): bar chart (patients per week), 3-series line chart
  (waiting → consultation → dispensary minutes, one color per stage), bar chart
  (registrations by hour), line/area chart (sales per week).
- **Doctor productivity leaderboard**: ranked horizontal bars — rank number, colored
  avatar-style circle, name, a horizontal bar sized to revenue, right-aligned
  revenue + visit count. Reads at a glance without a legend.
- **Segmented P&L**: a horizontal row of clickable segment tiles (Minor OT / Maternal &
  Obstetric / Weight Loss / NCD / Outpatient), each showing that segment's revenue.
  Clicking a segment **re-filters every chart below it** — donut (share by segment),
  grouped bar (sales & profit per month for that segment), a small stat row (enrolled
  patients / achieved target / app signups / new this month), a 2-clinic multi-line
  trend, a horizontal ranked bar (weekly actives by dose), and a bar chart (new
  enrollments per month). This is the single most valuable interaction pattern here —
  one control scopes a whole dashboard instead of a chart per screen.
- **Donut with values in the legend** (not just color swatches) — center shows the
  total; each legend row shows the segment name + revenue + %.

### Stock — operational grids, not analytics

Sub-tabs: Pricing, Stock Quantity, Stock Transfer, Central Queue Order, Stock Take, Log.
All tabular — an item×clinic stock-level matrix (central + per-branch columns, low-stock
tags), a pricing/item catalog grid. No charts. Structurally close to what KUWICK's Stock
module already has (Stock Levels, Low Stock, etc.) — nothing new to adopt here beyond
general card/table polish.

### Panel — operational grids + a claim listing, not analytics

Sub-tabs: Panel Companies, Panel Report, Panel Invoice, Claims, AIA. "Panel Companies" is
a directory (logo icon + name + code + price tier + contracted-with + members + visits/mo
+ claims/mo). "Panel Report" is a claims listing grouped by panel company with
collapsible per-panel headers and running subtotals — same shape as KUWICK's own Claim
Listing (D-041), just with nicer per-panel grouping/icons.

### HR — staff directory + **the Doctor Incentive formula** (resolves OQ#2)

Sub-tabs: Profile Directory, Public Holidays, Doctor's Incentives, Attendance.

**Doctor's Incentives is the important find.** Exact worked formula, captured verbatim
from the page:

> "Residen doctors only — a locum doesn't earn this. Nothing until sales reach the
> threshold; from there the flat amount plus the % of everything above it. A doctor can
> carry their own rule — everyone else follows this default."

**Total Sales Commission** (per calendar month, resident/permanent doctors only):
- Inputs: `threshold` (RM), `earnsFlat` (RM), `abovePercent` (%) — set once as a
  tenant-wide default (observed: threshold RM60,000, flat RM1,000, above 2%).
- Formula: if `totalSales < threshold` → commission = **0**. If `totalSales >=
  threshold` → commission = `earnsFlat + (totalSales - threshold) * abovePercent`.
- **Per-doctor override**: any doctor can carry a `custom` rule instead of the tenant
  default (observed: one doctor on custom RM48,000 → RM800 + 2%, everyone else on
  "default").
- **Locum doctors are categorically excluded** from this commission — the table just
  shows "not applicable — locum" for them, no computation attempted.
- An `applies` checkbox per doctor lets admin turn this commission on/off per doctor
  even among eligible (resident) doctors.
- `totalSales` for the formula = sum of that doctor's completed/paid billing in the
  selected month (visits count shown alongside for context, but the commission is
  sales-based, not visit-count-based).
- Table columns: Doctor, Clinic, Visits (done visits assigned that month), Total Sales,
  Applies, Rule (default/custom + the resolved formula text), Commission. Footer row
  totals sales and commission across all doctors.

**Procedure Incentives** (separate, additive component — a flat fee per procedure done,
not a percentage):
- "Pick items from Pricing and key in the commission per procedure — one value for a
  resident doctor, one for a locum. The incentive is quantity done × the value for that
  doctor's type."
- Split into two tables by doctor type:
  - **Resident doctors**: Doctor, Clinic, procedures-done count (+ distinct item count),
    Incentive (RM) = sum over completed procedures of that procedure's resident-rate.
  - **Locum doctors — procedures + OT per hour**: same procedure-incentive calculation,
    **plus** an overtime component: OT hours × OT rate (RM/h) = OT pay. Total = procedure
    incentive + OT pay.
- A master rate table ("What each procedure pays") lists every service/procedure from
  the Pricing catalog with two editable RM columns: Resident rate, Locum rate. Left
  blank = that procedure pays no incentive. This table is long (100+ procedures observed:
  X-rays, injections, USG scans, IUCD insertion, circumcision, nebulizer packages, etc.)
  — every billable procedure/service gets its own resident/locum rate, not a single
  blanket rate.

**Attendance**: reads "Punches come from Clinical → Check In/Out" — derived, not
separately entered, same approach KUWICK already took (attendance is a read-only report
over Visit check-in/out, not its own data-entry screen).

### Finance — settings + tabular sales reports; Analysis is an empty placeholder

Sub-tabs: Settings, Sales Report, e-Invoice, Analysis, Invoice [clinic name].
- **Settings**: clinic registration/tax/e-Invoice business details — config, not reports.
- **Sales Report**: Billing Detail (invoice-level, matches KUWICK's Invoice Listing),
  Transaction Detail, Daily Summary (date × total sales × bill count × patient count,
  with a total row — matches KUWICK's Day-End Closing), Daily Report by Payment Method,
  Sales by Panel. All plain filtered tables with a Download button, no charts.
- **Analysis**: literally an empty state — *"Revenue, collections and panel-vs-cash
  breakdowns for this company will live here. Nothing set up yet."* Confirms their own
  finance analytics is unbuilt too; KUWICK isn't behind here, and D-032 (e-Invoice
  blocked pending owner reference) stays the right call.

## What this means for KUWICK

1. The interactive-dashboard upgrade belongs on the **Executive Dashboard** specifically
   — that's the one screen Klinik Hijraa itself treats as a real analytics surface. The
   rest of Reports (Day-End, Sales Analysis, Invoice Listing, Panel reports) are
   correctly tabular already; the ask isn't to chart-ify every report, it's to bring the
   flagship dashboard up to this bar.
2. Adopt: date-range pills, a segmented filter that scopes multiple charts at once
   (KUWICK equivalent: care-line/service category), KPI tiles with a delta + sparkline,
   a donut with real values in the legend, a doctor leaderboard with click-to-expand,
   hover tooltips/crosshair on every chart (Klinik Hijraa doesn't clearly have this —
   this is where KUWICK can go further, per the 2026 dashboard-design research).
3. The Doctor Incentive Engine (blocked since D-042/OQ#2) now has a complete, concrete
   spec above — worth a separate build once prioritized; not part of this reports
   redesign.
