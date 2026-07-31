# Addendum: Owner's real panel-claim tracking workbook (structure reference)

**Date**: 2026-08-01
**Source**: `2026_PANEL_CLAIM_LISTING.xlsx`, supplied by the owner as the workbook their clinic actually uses to track panel claims. **Analyzed structure-only at the owner's instruction ("read only, don't alter/use/copy the patient's data") — this document records sheet layout, column headers, and workflow notes only. No patient rows, names, claim numbers, or amounts were copied anywhere, and the extracted working copy was deleted after inspection.**

## Workbook layout
- **One sheet per panel company** — 28 panels: PMCARE, MICARE, AIA, TNB, HEALTH CONNECT, COMPUMED, RED ALERT, e-MAS, MEDKAD, MEDILINK, MEDNEFIT, I.A, HSP PERKESO, PERODUA, G-FLEX, MARA, e-BEN Assist, IHP, WECARE, PEKA B40, HEALTH METRIC, ILTIZAM, SELCARE, NIOSH, ALLIANZ, KPSB CARE, SWIFT, BOOKDOC. (Several of these match the panel-portal URLs already in the System Owner console's Default Panel Clinics reference.)
- **SUMMARY PANEL CLAIMS** — yearly rollup per panel ("SUMMARY PANEL CLAIMS 2026", company letterhead, TOTAL (RM) row).
- **EXCESS CLAIM LISTING** — separate register of excess/rejected claims (see workflow below).
- **TEMPLATE** — the blank per-panel sheet staff copy when onboarding a new panel.

## Per-panel sheet structure (from TEMPLATE — no live data)
Sheet-level fields: **PANEL NAME**, **PAYMENT TERM (___ days)**, and rollups **TOTAL CLAIMED (RM) / TOTAL RECEIVABLE (RM) / TOTAL PAID (RM) / TOTAL FEE (RM)**.

Row columns (one row per claim):
`SERVICE DATE | MM/YYYY | DUE DAYS | NAME | CLAIM NO | CLAIMED AMOUNT | FEE | CLAIM TO RECEIVE | PAID | TOTAL RECEIVABLE | REMARKS`

## Key workflow facts Kuwick's Panel module must reflect
1. **Tracking is per-claim per-panel, not only per-batch.** Each row is an individual claim with its own claim number, service date, and remarks. Kuwick's `ClaimBatchLine` maps to this, but the day-to-day working view staff need is a *per-panel claim listing*, not the batch list.
2. **Payment terms are per-panel** — the sheet header records the panel's payment term in days, and each row derives **DUE DAYS** from it. Aging should therefore be judged against each panel's own term (a claim 40 days out is fine on a 60-day panel, overdue on a 30-day panel). → `PanelClinic` needs a `paymentTermDays` field and the aging report should flag term-exceeded claims, not just raw day buckets.
3. **A FEE column exists, but it is NOT a universal add-on.** *(Corrected 2026-08-01 after owner review: "AIA no fee".)* The template sheet carries FEE / TOTAL FEE (RM) columns, but the "RM100 claimed as RM108" example comes from the excess-resubmission instructions specifically — it is not a general per-claim rule, and panels like AIA have no fee at all. → `ClaimBatchLine.feeAmount` stays as an **optional** field defaulting to 0 (receivable = claimed + fee − paid still holds; fee is simply 0 for most claims). Never auto-apply a fee.
4. **Excess/rejected claims have their own follow-up register and re-submission workflow**: staff check each panel's claim report for excess/rejected totals, identify the claim number, then contact the patient and file a *new* claim for the excess (with the add-on fee). → Kuwick needs an "Excess / Rejected Claims" view (lines REJECTED/DEDUCTED or paid < receivable) with a resubmit action that spawns a new claim line, plus a per-line remarks field.
5. **Month bucketing (MM/YYYY)** — claims are grouped by service month for reconciliation; the per-panel listing should support month grouping/filtering.
6. **Yearly per-panel summary** — total claimed/receivable/paid/fee per panel per year (the SUMMARY sheet) → a "Panel Claims Summary" report.

## Proposed follow-up work (not yet built)
- Migration: `PanelClinic.paymentTermDays Int?`, `ClaimBatchLine.feeAmount Decimal @default(0)`, `ClaimBatchLine.remarks String?`.
- Per-panel claim listing screen (rows ≈ the workbook columns; month filter; due-days vs payment-term highlighting).
- Excess/Rejected register + resubmit-as-new-claim action.
- Panel Claims yearly summary report (per panel: claimed / fee / receivable / paid / outstanding).
