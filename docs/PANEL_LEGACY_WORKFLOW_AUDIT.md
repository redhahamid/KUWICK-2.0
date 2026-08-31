# The clinic's panel claim workbook, read directly

One workbook, 31 sheets, **7,146 claim rows** for a single year and a single
branch. It was opened programmatically with `openpyxl` and read **as formulas**,
not as values. Every rule below is quoted from the cell that computes it, and
every count below was measured, not estimated.

> **Confidential source material.** The workbook is **not** committed, not
> copied into this repository, and not used as seed data. **No patient name, no
> claim number, no panel company name, no remittance reference and no legal
> entity name appears here or in any UAT fixture.** Panels are referred to as
> **P01–P29** and described by *shape* — "a TPA fronting multiple corporate
> clients" — never by identity. What is recorded is structure, formula, workflow
> and defect.

---

## 1 · What the workbook is

| Sheet | Count | Job |
|---|--:|---|
| Panel claim sheets | 29 | One per panel. Every claim ever raised against that panel. |
| `SUMMARY PANEL CLAIMS` | 1 | Cross-sheet roll-up: claims, claimed, receivable, paid, fee. |
| `EXCESS/REJECTED CLAIM LISTING` | 1 | The rework register. Everything the panel would not pay. |

The summary sheet's title block names **one legal entity and one year**. So this
is one branch's panel book — a second branch means a second workbook, and there
is no consolidation anywhere.

### The volume is wildly concentrated

| Panels | Claim rows | Share |
|---|--:|--:|
| Top 4 | 6,038 | **84%** |
| Next 6 | 958 | 13% |
| Remaining 19 | 150 | 2% |
| — of which **4 sheets** | **0** | a panel exists, no claim was ever raised |

That distribution matters for the product: whatever Kuwick does must be
excellent for four panels doing 1,000–2,300 claims a year, and must not make the
clinic *configure* nineteen panels that between them raise three claims a month.

**2,154 of 7,146 rows (30%) carry no payment at all.** On the second-largest
panel it is 903 of 1,439 — **63% of that panel's year is unpaid**, and, as §6
shows, that is also the panel with almost no per-claim payment notes.

---

## 2 · The per-panel sheet model

Every panel sheet is the same 5-part composition. Sheet-level *headers* are
consistent; sheet-level *meaning* is not, which is the theme of this document.

### 2.1 · A header block (rows 4–6) — configuration as prose

| Cell | Label | Content |
|---|---|---|
| B5 | `PAYMENT TERM` | free text |
| K6 | *(unlabelled)* | the admin-fee rule, free text |
| E5 | `TOTAL CLAIMED (RM)` | `=SUM(G9:Gn)` |
| F5 | `TOTAL RECEIVABLE (RM)` | `=SUM(K9:Kn)` |
| H5 | `TOTAL PAID (RM)` | `=SUM(J9:Jn)` |
| K5 | `TOTAL FEE (RM)` | `=SUM(H9:Hn)` |

Row 7 on every sheet carries an instruction to the user:
**"PLEASE EDIT ORANGE COLUMN ONLY"** — the workbook's own admission that its
formulas are fragile and that colour is the only thing protecting them.

### 2.2 · The claim grid (row 8 header, row 9 onward)

| Col | Header | Kind |
|---|---|---|
| B | SERVICE DATE | manual date |
| C | MM/YYYY | `=TEXT(B, "mmm. yyyy")` |
| D | DUE DAYS | `=DATEDIF(B, TODAY(), "D")` |
| E | NAME | manual |
| F | CLAIM NO | manual |
| G | CLAIMED AMOUNT | manual |
| H | FEE | manual **or** formula, per panel |
| I | CLAIM TO RECEIVE | `=SUM(G−H)` |
| J | PAID | manual |
| K | TOTAL RECEIVABLE | `=SUM(I−J)` |
| L | REMARKS | manual free text — **and the actual payment record** |

### 2.3 · A monthly block (columns N–U), on the same rows

| Col | Header | Kind |
|---|---|---|
| N | MONTH/YEAR | a typed date, used as a label |
| O | NUMBER OF CLAIMS | `=COUNTIFS(B:B, ">12/31/2025", B:B, "<2/1/2026")` |
| Q | Amount (RM) | `=sum(G9:G295)` — **hardcoded row ranges** |
| R | AVERAGE | `=AVERAGEA(Q/O)` |
| S | AVIXO INVOICE | manual — the billing system's figure |
| T | DIFFERENCE | `=Q−S` |
| U | REMARKS | manual |

### 2.4 · Two control sheets

Covered in §7 and §8.

---

## 3 · Payment terms — five incompatible shapes in one column

All 29 values, classified. This is a **configuration model**, written in prose:

| Shape | Example wording | Count |
|---|---|--:|
| A single number of calendar days | `60 DAYS`, `90 DAYS`, `150 DAYS` | 10 |
| A **range** | `60 - 90 DAYS`, `30 - 45 DAYS`, `45-60 DAYS` | 8 |
| **Working** days | `30 WORKING DAYS`, `20 WORKING DAYS`, `45 WORKING DAYS` | 4 |
| Anchored to a **different event** | `90 DAYS from Invoice date`, `30 days from invoice date` | 2 |
| Delegated | `VARY BASED ON COMPANY` | 1 |
| **Absent** — the word `DAYS` with no number | — | 2 |
| Blank | — | 2 |

Four facts follow from that table, and each one is a product requirement:

1. **A term can be a range.** A clinic chasing at 60 days on a 60–90 day panel is
   chasing early; at 90 it is chasing late. The clinic wants both edges.
2. **Working days are not calendar days.** 30 working days is ~44 calendar days,
   and Malaysia's public holidays differ by state.
3. **The clock does not always start at the service date.** Two panels count
   from *invoice* date, which for a monthly-invoiced panel can be four weeks
   later than the service.
4. **One panel's term varies by the corporate client behind it** — a TPA
   fronting many employers. The term is not a property of the panel at all.

### And the term is never used in a formula

`DUE DAYS` is `DATEDIF(SERVICE DATE, TODAY(), "D")`. That is **days elapsed since
service** — an age, not a countdown. Nothing anywhere compares it to the payment
term. **The workbook cannot tell you a single claim is overdue.** It shows a
number that gets bigger, and a human decides.

---

## 4 · Admin fees — six shapes, and a proven direction

`K6` on each sheet, verbatim in shape:

| Shape | Wording seen | Panels |
|---|---|--:|
| Flat RM per claim | `RM 8 / CLAIM`, `RM 2 PER CLAIM`, `RM 5 PER CLAIM`, `RM 4.31/PATIENT` | 4 |
| Percentage of the bill | `10% X TOTAL BILL`, `15% X TOTAL BILL`, `10.8% X TOTAL BILL`, `5% * TOTAL BILL` | 5 |
| Percentage of the **monthly invoice** | `10% FROM MONTHLY INVOICE` | 1 |
| Explicitly nil | `NIL`, `FEE: NIL` | 3 |
| **Not a fee at all** | `LIMIT RM150` — a per-visit claim ceiling, in the fee cell | 1 |
| Placeholder never filled | `RM ` or blank | 15 |

`10% X TOTAL BILL` and `10% FROM MONTHLY INVOICE` look alike and are different
bases: one is per claim, the other is levied once on a consolidated invoice.
Applying the second per-claim gives the same total only if you never round —
and it is rounded to the sen on every row.

### 4.1 · The fee is WITHHELD, not added — and the bank statement proves it

Every sheet computes `CLAIM TO RECEIVE = CLAIMED − FEE`. To check whether that
is the clinic's intent or a formula error, the *banked* amounts were tested
against all three hypotheses:

| Of 2,640 paid claims carrying a non-zero fee | Rows | Share |
|---|--:|--:|
| `PAID = CLAIMED − FEE` | **2,615** | **99.1%** |
| `PAID = CLAIMED` | 2 | 0.1% |
| `PAID = CLAIMED + FEE` | **0** | **0%** |
| Neither — short-paid or deducted | 23 | 0.9% |

Across all 4,992 paid rows the same test gives 4,616 exact `CLAIMED − FEE`
matches and 374 short/over rows, which are the genuine partial payments.

**This is money that actually arrived in the clinic's account.** The panel
withholds its fee from the payment. The clinic bills the full amount and banks
the amount minus the fee.

> **Kuwick modelled the opposite, and it has been corrected.**
> `computeClaimBalance` computed `claimed + fee`, per decision D-041. Against
> this workbook that over-stated the receivable by the fee on every claim and
> left every fully-settled claim short by twice it.
>
> **The owner superseded D-041 on 2026-08-31** on this evidence: existing panels
> are `WITHHELD_FROM_CLAIM`, the treatment is per-panel and effective-dated, and
> the correction has been migrated with a measured financial-impact report. See
> **D-112** and [`PANEL_FEE_DIRECTION_CORRECTION.md`](./PANEL_FEE_DIRECTION_CORRECTION.md).

### 4.1a · The two exceptions, and what they turned out to be

The owner's instruction was not to infer a rule from two rows, but to find out
what they were. Both were traced to their neighbours.

**The first is a manual exception inside a single remittance.** On the panel
with 1,860 paid fee-bearing claims, one banked at the full amount — and the
rows around it settle the question:

| | Claimed | Fee | Paid | Remittance |
|---|--:|--:|--:|---|
| previous | 242.00 | 8.00 | 234.00 | *(same reference)* |
| **this one** | **100.00** | **8.00** | **100.00** | *(same reference)* |
| next | 202.00 | 8.00 | 194.00 | *(same reference)* |
| next | 110.00 | 8.00 | 102.00 | *(same reference)* |

Same service date, **same payment**, and the fee withheld from three of the four.
That is one row's mistake, not a second rule.

**The second decides a panel.** It is the *only* paid fee-bearing claim on its
panel — three claims in total, two still unpaid. One row establishes nothing in
either direction, so that panel alone is left `UNCONFIGURED` and reported.

### 4.1b · Every panel classified from its own rows

| State | Panels | Basis |
|---|--:|---|
| `WITHHELD_FROM_CLAIM` | **16** | 10 with direct banked evidence (39/39, 56/56, 132/133, 530/536, 1,843/1,860 …); 6 with a documented fee rule but no paid claim yet, taking the owner's default |
| `NO_FEE` | **12** | No fee value on any claim row, and a nil or blank fee rule |
| `UNCONFIGURED` | **1** | One paid fee-bearing claim, banked at the full amount — insufficient either way |

**No panel showed contradictory evidence.** The one problem panel is
insufficient, not contradictory, which is a different thing and needs a
different answer.

### 4.2 · The fee is re-keyed by hand on the panels that matter

| Fee entry | Claim rows |
|---|--:|
| **Typed by hand** | **5,503** |
| Computed by formula | 635 |
| Blank | 1,008 |

The four highest-volume panels all type it. Which produces exactly what typing
produces:

- One panel: **2,261 claims at one fee value, 7 at a different one.** Either a
  second fee tier or seven mistakes — *the sheet cannot tell you which*, because
  a tier is not written down anywhere.
- One panel: **1,358 rows at the exact fee, 65 rows carrying floating-point
  dust** (`7.80000000000017` and similar), plus 5 rows at a *different* panel's
  fee value. The dust means those fees were derived by subtraction and pasted,
  not typed — so the fee column silently contains arithmetic residue, and it
  flows into `TOTAL FEE`.
- One panel whose documented rule is a flat RM2 charges **RM4 on 58 of 65
  claims**. The note in `K6` and the practice in column H disagree, and the
  note is the one a new staff member would read.
- One percentage panel has **five rows where the formula was overwritten with a
  typed number** (`7.5`, `16.6`, `6.0`, `38.8`, `0.0`) out of 473. Nothing
  flags it.

---

## 5 · The same column means different things on different sheets

This is the single most dangerous property of the workbook, because the
*formulas do not know*.

| Sheet | Column H | Formula `I = G − H` then means |
|---|---|---|
| Most panels | admin FEE | receivable, correctly |
| One panel | **`INV NO`** — an invoice number | receivable **minus an invoice number** |
| One panel | fee, blank on all 924 rows | receivable = claimed |

On the panel where H is an invoice number, the column is currently empty, so
`I = G − 0` happens to be right. **The day anybody types a numeric invoice
number into it, that panel's entire receivable silently collapses.** It is
armed, not broken.

Two more repurposed columns:

- One panel uses `CLAIM NO` to hold a **scheme label** (fee-for-service vs
  managed-care), not a claim number, and adds two unlabelled columns at the
  right edge to split the monthly claim count between the two schemes.
- An unlabelled column M carries occasional free-text notes — a service-tax
  amount on one sheet, a sub-entity name on another.

---

## 6 · The payment record is a sentence in a remarks cell

Column J holds *how much* was paid. Everything else about the payment —
**when**, and **under which remittance** — is prose in column L, in shapes like
`PAID <day>/<month> <voucher reference>`.

So the remittance reference, the payment date and the claim are joined by
being in the same sentence.

| | Rows with a remark | Claim rows | Coverage |
|---|--:|--:|--:|
| Largest panel | 1,743 | 2,268 | 77% |
| **Second-largest panel** | **5** | **1,439** | **0.3%** |

The second-largest panel is also the one with 903 unpaid claims. For its
1,434 claims with no remark, there is no record of when anything was paid or
what settled it — only a number in column J.

Consequences that follow directly:

- **One bank transfer settling fourteen claims cannot be represented.** It is
  fourteen sentences, each repeating the same reference by hand.
- **A remittance cannot be reconciled**, because it does not exist as an object.
  Nothing can ask "does the sum of what we allocated equal what arrived".
- **Nothing can be found by reference.** Answering "which claims did payment
  *X* cover" is a text search across 29 sheets.

Claim numbers are no better as keys: **over 1,200 of them carry leading or
trailing whitespace or embedded newlines**, and different panels store them as
text, as *numbers* (so a leading zero is gone), and as long dashed codes.

---

## 7 · The monthly summary and the Avixo reconciliation

Each sheet carries a 12-row block: for each month, the number of claims, the
claimed amount, an average, **the billing system's invoice figure typed in by
hand**, and the difference.

That block is the clinic checking its own claim listing against Avixo. It is
the honest instinct — and it exists **only because the listing is a second,
hand-maintained copy of data the billing system already holds**.

It is also broken in four ways:

1. **`Amount (RM)` uses hardcoded row ranges** — `sum(G9:G295)`, `sum(G296:G529)`
   — one per month, re-cut by hand. On **10 sheets** the ranges have become
   *disjoint* (`sum(G209:G271, G411:G412)`), up to 9 of 12 months on a single
   sheet: the residue of rows inserted out of order and patched over. One month
   sums a single cell.
2. **Every populated sheet has stale month windows.** `NUMBER OF CLAIMS` uses
   `COUNTIFS` against typed US-format date literals. Twelve sheets still count
   **2024** months; one carries a window for the year **2065**, which will never
   match anything. Not one sheet has twelve correct 2026 windows.
3. **`AVERAGEA(Q/O)`** takes the average of a single scalar. Harmless, and a
   sign of how the block was assembled.
4. **No sheet totals the DIFFERENCE column.** The reconciliation is done month
   by month, by eye. **There is no figure anywhere in the workbook for the total
   unexplained difference between the claim listing and the billing system.**

---

## 8 · The excess / rejected register

A separate sheet with its own columns, its own totals and its own procedure.
This is the clinic's rework queue, and it is the most operationally
sophisticated thing in the workbook.

### 8.1 · The procedure, typed into cells E4–E10

Six numbered rules, written bilingually in Malay and English, sitting in
spreadsheet cells above the data. In substance:

1. Check the total excess/rejected amount in the claim report.
2. **Call the patient** to tell them a new claim is being made.
3. On resubmission the **service date follows the ORIGINAL claim's date**.
4. **Record the ORIGINAL claim number and the EXCESS claim number together.**
5. **Maximum 2 months from the previous service date** to raise the new claim.
6. Complete the claim amount back in the original claim listing.

Rule 5 is a **hard deadline with money attached** — miss it and the claim is
gone — and it lives in a text cell that nothing enforces, warns about, or
counts down.

Rule 2 is the one most systems forget: **a rejection is a patient conversation**,
not only a finance event.

### 8.2 · The columns

`ORIGINAL SERVICE DATE · MM/YYYY · DUE DAYS · NAME · ORIGINAL CLAIM NO ·
EXCESS CLAIM NO · PANEL · CLAIMED · FEE · TO RECEIVE · PAID · RECEIVABLE ·
RESUBMIT CLAIM DATE · MM/YYYY · REMARKS · RESOLVED? · RESOLVED DATE · MM/YYYY ·
REMARKS`

The original↔replacement linkage is explicit and deliberate: two claim-number
columns side by side, so the original is not chased twice and the replacement
is not counted as new revenue.

### 8.3 · Why claims are rejected — visible in the free text

Abstracted from the notes, the causes cluster into five kinds:

| Cause | How it appears |
|---|---|
| Patient's annual/visit **limit exhausted** | a cover limit quoted against a larger invoice total |
| A **specific drug not covered** | drug name and the disallowed amount |
| A **procedure only partly covered** | procedure name and the covered ceiling |
| A **benefit sub-limit** | a named benefit with a lower cap than claimed |
| An **authorisation still pending** | "pending bypass" |

And four resolution routes:

| Route | How it appears |
|---|---|
| Re-claim under a new number | a resubmit date, and an excess claim number |
| **Charge the patient the difference** | "self pay", later a payment method and date |
| **Combine with another claim** | a combined-claim date |
| Abandon quietly | left pending, forever |

The second route is the important one. **A rejected panel claim frequently
becomes a patient receivable** — and the workbook has no way to say so except
by typing "SELF PAY" into a date column. One note even records an excess on one
panel being recovered through *a different panel's* portal.

### 8.4 · The register's own defects

| Where | Defect |
|---|---|
| Totals row | `TOTAL CLAIMED`, `TOTAL FEE` and `TOTAL RECEIVABLE` sum from row **17**; the data starts at row **16**; `TOTAL PAID` sums from **16**. **The first claim is omitted from three of the four totals** — and the receivable total is the figure the summary sheet imports. |
| `RESUBMIT CLAIM DATE` | A date column carrying prose: rejection reasons, "self pay", "pending self pay", and **two resubmission dates in one cell**. `TEXT(N,"mmm. yyyy")` then formats garbage. |
| `RESOLVED?` | Free text. Rows marked `RESOLVED` with an empty resolved date; rows whose remark says `PAID` while the status still says `PENDING`. **Status and evidence disagree, and nothing notices.** |
| `RESOLVED DATE` | Day/month transposition: remarks reading "PAID 9/4" and "PAID 9/7" produce resolved dates of **4 September** and **7 September** — dates *after* the payment they record. |
| `TO RECEIVE` | At least one row has the formula **replaced by a typed constant**. It agrees today; the link is gone. |
| `PANEL` | Free text, including values that match no sheet in the workbook. |

---

## 9 · The summary sheet

Cross-sheet formulas of the form `=COUNT(<panel>!B:B)` and `=SUM(<panel>!E5)` —
each panel's own header-block total, pulled into one table of claims, claimed,
receivable, paid and fee, with a grand total.

The references themselves are correct. What is wrong is what they do and do not
reach:

| # | Defect |
|---|---|
| 1 | **Two panel sheets are not referenced at all** — 27 of 29 sheets are linked. One is empty; the other's six claims appear in no total. They are the same two sheets whose payment term is the bare word `DAYS` and whose `DUE DAYS` formula is mis-anchored (§10, P-4) — the two least-maintained sheets are also the two invisible ones. |
| 2 | **A 28th panel is listed by name with no formulas and no sheet anywhere in the workbook.** Somebody added the row and stopped. |
| 3 | **The largest panel has no `TOTAL FEE` cell**, so `=SUM(<panel>!K5)` returns zero. The panel with 2,268 claims contributes **RM0 of fee** to the group fee total. |
| 4 | **The grand total for RECEIVABLE sums `F11:F401`** while every other column sums `…11:…40`. Empty today. Armed. |
| 5 | The excess/rejected receivable is brought in as a **memo cell outside the totals**, so the headline receivable excludes the rework pile entirely. |
| 6 | `COUNT(<panel>!B:B)` counts *rows with a date in column B*, over the whole column — not claims, and not the same range the money columns sum. |

Item 5 has a redeeming half: one cell divides the excess receivable by total
claimed — **the clinic tracks what fraction of everything it claims ends up
rejected.** That is a genuine KPI, and Kuwick does not currently show it.

---

## 10 · Every defect found, so none of them is reproduced

| # | Where | Defect | Severity |
|---|---|---|---|
| **P-1** | Every sheet vs. Kuwick | Fee is **withheld** (`receivable = claimed − fee`, proven on 2,615 banked payments). Kuwick added it. | ~~Material — Kuwick side~~ **FIXED** (D-112) |
| **P-2** | Summary | Two panel sheets referenced nowhere; one row is a label; the largest panel's fee reads as zero. | **Material** |
| **P-3** | Excess register | Three of four totals start one row below the data; the receivable total is what the summary imports. | **Material** |
| **P-4** | Two panel sheets | `DUE DAYS` on the first data row is anchored 13 rows away, so the age shown belongs to an unrelated claim. | High |
| **P-5** | Largest panel | `TOTAL CLAIMED` sums to row 3,162 while `TOTAL RECEIVABLE` sums only to 2,364. Its claims currently end at row 2,276, so nothing is lost **today** — but that leaves **88 rows of headroom on a panel raising ~190 claims a month**. Inside a fortnight, outstanding starts silently dropping claims with no visible change. | **Armed — weeks away** |
| **P-6** | One large panel | `TOTAL FEE` sums to row 1,000 while its claims run to row 1,415 — **415 claims' fees are outside the total.** That panel's fee is nil on every row, so the figure is right by luck rather than by construction. | High |
| **P-7** | Three panel sheets | `DUE DAYS` carries a hand-added constant — `+365` on two sheets and **`+369` on a third**. A fudge factor, and not even a consistent one. | High |
| **P-8** | Every populated sheet | Monthly `COUNTIFS` windows are stale — 12 sheets still counting 2024, one window set to **2065**. | High |
| **P-9** | 10 sheets | Monthly amounts use disjoint hardcoded row ranges, up to 9 of 12 months on one sheet. | High |
| **P-10** | One panel | Fee column holds floating-point residue on 65 rows and a different panel's fee on 5. | Medium |
| **P-11** | One panel | Documented fee (RM2) and applied fee (RM4 on 89% of claims) disagree. | Medium |
| **P-12** | One panel | Fee formula overwritten with typed constants on 5 of 473 rows. | Medium |
| **P-13** | One panel | Column H is an **invoice number** while `I = G − H` still subtracts it. Empty today. | **Armed** |
| **P-14** | Excess register | Resolved-date day/month transposition producing dates after the event. | Medium |
| **P-15** | All sheets | 1,200+ claim numbers with stray whitespace or newlines; three different storage types across panels. | Medium |
| **P-16** | Excess register | `RESOLVED?` contradicts its own payment remark on multiple rows. | Medium |
| **P-17** | All sheets | `DUE DAYS` is age since service and is **never compared to the payment term** — nothing can be overdue. | **Design** |
| **P-18** | All sheets | Payment date and remittance reference exist only inside a free-text remark; absent on 99.7% of the second-largest panel's claims. | **Design** |

**None of these is reproduced in Kuwick, and P-1 is a finding against Kuwick,
not against the clinic.**

---

## 11 · What Kuwick already replaces

Kuwick's panel domain — `PanelClinic`, `ClaimBatch`, `ClaimBatchLine`,
`PanelRemittance`, `PanelRemittanceAllocation`, `ClaimEvent` — was built from an
earlier description of this same workflow, and most of it holds up against the
evidence.

| The workbook's job | Kuwick | Verdict |
|---|---|---|
| One row per claim, per panel | `ClaimBatchLine` | ✅ |
| Service date, patient, claim number, claimed amount | claim line + invoice | ✅ |
| `CLAIM TO RECEIVE`, `TOTAL RECEIVABLE` | `computeClaimBalance` — **one** formula, summed, never re-derived | ✅ *(but see P-1)* |
| Ageing | derived per claim, per panel | ✅ |
| Claim counts and monthly amounts | reconciliation view | ✅ — computed, no hardcoded ranges |
| Status beyond paid/unpaid | 15-state `PanelClaimStatus` | ✅ far beyond the sheet |
| Rejection reason and amount | `rejectionReason`, `rejectedAmount` | ✅ |
| Original ↔ excess claim linkage | `supersedesLineId`, guarded so only one line is active | ✅ |
| Resubmit date, resolved?, resolved date | `submittedAt`, `resolvedAt`, `resolutionNote` | ✅ typed, not prose |
| Owner of the claim | `responsibleStaffId` | ✅ |
| Write-off | amount + actor + reason + timestamp | ✅ — the sheet has no concept |
| **Payment as its own document** | `PanelRemittance` + allocations | ✅ **the single biggest win** |
| Who changed what, when | `ClaimEvent` timeline | ✅ — the sheet has no history at all |
| Per-panel fee as configuration | `claimFeeType` + `claimFeeValue`, applied at batch creation | ✅ for flat and percentage |
| Per-visit claim ceiling | `PanelClinic.limitAmount` | ✅ |
| Panel ≠ payer (a TPA) | `payerName` | ✅ |
| Submission method, portal, document checklist | `submissionMethod`, `portalUrl`, `documentRequirements` | ✅ |
| Re-claim under a new number vs. correct in place | `resubmitAsNewClaim` | ✅ |
| **The Avixo reconciliation (§7)** | — | ✅ **by disappearing.** Claims are derived from invoices, so the two cannot disagree. An entire monthly ritual stops existing. |

---

## 12 · What Kuwick does not yet replace

Named honestly, each with the evidence that produced it.

| # | Gap | Evidence | Cost |
|---|---|---|---|
| **G-1** | ~~**Fee direction.** Kuwick can only add the fee.~~ **RESOLVED** | §4.1 — 2,615 banked payments say withheld; D-041 said added. | **Done.** Owner superseded D-041 on 2026-08-31. Four-state `PanelFeeTreatment`, effective-dated `PanelFeeTerm`, per-claim snapshot, migrated with a measured impact report. See D-112. |
| **G-2** | **Payment terms that are not a single number of calendar days.** `paymentTermDays Int?` cannot hold a range, working days, or an invoice-date anchor. | §3 — 14 of 29 panels are one of those three shapes. | Term = `{ min, max, unit: CALENDAR\|WORKING, anchor: SERVICE\|SUBMISSION\|INVOICE }`. |
| **G-3** | **Overdue as a computed state.** | P-17. Kuwick has `dueDate` per line, but nothing derives it from the panel's term. | Derive the due date at submission from G-2, then age against it. |
| **G-4** | **The 2-month re-claim deadline.** | §8.1 rule 5 — a hard money deadline enforced by nobody. | A per-panel `resubmissionWindowDays`, a countdown on the rejected queue, and an expiry state. |
| **G-5** | **Rejected → patient receivable.** | §8.3 — "self pay" is one of the four routes, and the clinic actually collects it. | A conversion from a rejected claim to a patient balance, keeping the link. |
| **G-6** | **Rejection reason as a taxonomy.** | §8.3 — five recurring causes, all free text today. | A reason code beside the free text, so "how much did we lose to exhausted limits this year" is answerable. |
| **G-7** | **Fee on a consolidated monthly invoice.** | §4 — one panel charges 10% of the monthly invoice, not per claim. | A third `claimFeeType`, applied at batch level. |
| **G-8** | **Fee tiers.** | §4.2 — one panel shows two fee values across 2,268 claims. | Either a tier table, or a per-claim override with a reason. Ask the owner which; the sheet cannot say. |
| **G-9** | **Term that varies by the corporate client behind a TPA.** | §3 — one panel is explicitly `VARY BASED ON COMPANY`. | Sub-payer under a panel. Low volume; not urgent. |
| **G-10** | **Rejection rate as a KPI.** | §9 item 6 — the clinic already computes excess receivable ÷ total claimed. | One tile on the panel dashboard. |
| **G-11** | **Per-scheme split within one panel** (fee-for-service vs managed care). | §5 — one panel splits its monthly counts into two schemes. | A scheme dimension on the claim, or accept two panel records. |
| **G-12** | **Panel claim import.** | 7,146 open and historical rows, 30% unpaid, live money. | Kuwick cannot start empty on day one. An importer is required before cutover. |

---

## 13 · The honest verdict

**The panel workbook is the closest thing the clinic has to a real system, and
it is one keystroke from being wrong at any moment.** Its structure is
thoughtful — it separates claimed from receivable from paid, it links a
replacement claim to its original, it tracks a resubmission deadline, it
reconciles against the billing system, and it measures its own rejection rate.
Those are the instincts of somebody who understands receivables.

What defeats it is that **every one of those ideas is expressed in prose, in a
column heading, or in a hand-cut formula range.** The payment term is a
sentence. The fee rule is a sentence. The procedure for rework is six sentences
in six cells. The payment record is a sentence. And so eighteen distinct defects
have accumulated: three are wrong right now, two more are armed and one of those
is a fortnight from going off, two are limits no amount of care could fix, and
one — the fee direction — turned out to be a defect in *Kuwick*, found only
because the workbook's banked amounts could be tested against Kuwick's formula.
That one is now fixed: the owner superseded D-041 on the evidence, and the
correction is migrated, measured and regression-tested (D-112,
[`PANEL_FEE_DIRECTION_CORRECTION.md`](./PANEL_FEE_DIRECTION_CORRECTION.md)).

Kuwick already replaces the majority of it, and replaces the Avixo
reconciliation by making it impossible to need. The twelve gaps in §12 are what
stand between "most of it" and "the clinic can close this file". **Nine of the
twelve are configuration shapes rather than new subsystems.** The two that are
not — the rejected-to-patient conversion (G-5) and the claim importer (G-12) —
are both real work. G-1 is answered and closed.

**None of the twelve is implemented in this pass.** They are specified here so
the next one starts from evidence.
