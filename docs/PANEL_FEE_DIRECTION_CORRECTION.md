# Correcting the panel fee direction — D-041 superseded

**Owner decision: 31 August 2026.** This document records what was wrong, how it
was established, what was changed, and what it was worth.

> **Confidential source material.** The evidence comes from the clinic's real
> panel claim workbook, which is **not** committed and not used as seed data. No
> panel name, patient name, claim number or remittance reference appears here.
> Panels are **P01–P29**; every worked example uses synthetic figures.

---

## 1 · What was wrong

Decision **D-041** (1 August 2026) recorded the panel claim fee as an **add-on**:

> *"`feeAmount` is the panel's add-on fee per claim ('claim RM100 → claimed
> RM108'); receivable = claimedAmount + feeAmount."*

Kuwick implemented that literally. `computeClaimBalance` returned
`expectedReceivable = claimed + fee` for every claim on every panel.

**It was backwards.** The consequences compound:

| | Under D-041 | Correct |
|---|--:|--:|
| Claim RM100, fee RM8 → expected receivable | RM108.00 | **RM92.00** |
| Panel pays in full (RM92 banked) → outstanding | **RM16.00** | **RM0.00** |

A fully-settled claim read as short by **twice the fee**, permanently, and no
amount of chasing could clear it — because the money it was waiting for was
never owed.

---

## 2 · How it was established

Not from the spreadsheet's formulas alone. From money that actually arrived.

### 2.1 · What the workbook computes

All **29** panel sheets carry the same formula in the CLAIM TO RECEIVE column:

```
I = G − H          (claimed − fee)
K = I − J          (still outstanding)
```

That is what the clinic *intends*. On its own it is a claim about a
spreadsheet, not about a bank account.

### 2.2 · What the bank did

Every paid claim carrying a non-zero fee was tested against all three
hypotheses:

| Of 2,640 paid fee-bearing claims | Rows | Share |
|---|--:|--:|
| `PAID = CLAIMED − FEE` | **2,615** | **99.05%** |
| `PAID = CLAIMED` | 2 | 0.08% |
| `PAID = CLAIMED + FEE` | **0** | **0.00%** |
| Neither — short-paid or deducted | 23 | 0.87% |

Across all 4,992 paid rows: 4,616 exact `claimed − fee` matches, and 374
short/over rows which are partial payments and adjudication deductions.

**No claim, on any panel, in a year, was ever banked at `claimed + fee`.**

### 2.3 · The two exceptions, investigated rather than averaged away

The owner's instruction was explicit: *"Do not infer a new panel-wide rule from
two exceptions"*, and *"investigate whether they represent fee waived, zero fee,
manual exception, settlement adjustment, or data quality issue."* Both were
traced to their surrounding rows.

**Exception 1 — a manual exception inside one remittance.** On a panel with
1,860 paid fee-bearing claims, one banked at the full amount. Its neighbouring
rows settle it: the same service date, the **same remittance reference**, and
three other claims in that same payment all had the fee deducted.

| Row | Claimed | Fee | Paid | Remittance |
|---|--:|--:|--:|---|
| n−1 | 242.00 | 8.00 | 234.00 | *(same reference)* |
| **n** | **100.00** | **8.00** | **100.00** | *(same reference)* |
| n+1 | 202.00 | 8.00 | 194.00 | *(same reference)* |
| n+2 | 110.00 | 8.00 | 102.00 | *(same reference)* |

One payment settled four claims and withheld the fee from three of them.
**Classification: manual exception or transcription error on a single row.** It
is evidence about one row, not about a rule.

**Exception 2 — insufficient evidence, and it decides a panel.** The other
full-amount row is the *only* paid fee-bearing claim on its panel (P16, three
claims in total, two still unpaid). One row cannot establish a rule in either
direction. **Classification: insufficient evidence → that panel alone is
`UNCONFIGURED` and reported for owner review.**

---

## 3 · The decision

Recorded from the owner's instruction of 31 August 2026:

1. The workbook and banked-payment evidence is the **source of truth** for the
   current panel setup.
2. **D-041 is superseded** on the fee direction for the affected workflows.
3. The **default for existing panels is `WITHHELD_FROM_CLAIM`**:
   `expected receivable = claimed − applicable fee`.
4. The **per-panel configurable architecture is kept**, because future panels or
   contracts may differ.
5. Fee configuration is **effective-dated**, so a future contract change cannot
   alter historical receivables.
6. Panels whose evidence clearly establishes `claimed − fee` are **migrated**,
   not left unconfigured.
7. A panel with **contradictory** evidence is isolated as `UNCONFIGURED` and
   reported — one panel only, never a fleet-wide inference.

---

## 4 · What was built

### 4.1 · Four explicit states, replacing two states and a NULL

| State | Expected receivable | Meaning |
|---|---|---|
| `WITHHELD_FROM_CLAIM` | `claimed − fee` | The panel keeps its fee out of the payment. |
| `ADDED_TO_RECEIVABLE` | `claimed + fee` | The clinic bills claim + fee and expects all of it. |
| `NO_FEE` | `claimed` | This panel charges nothing. Resolved: there is no sign to get wrong. |
| `UNCONFIGURED` | `claimed` | The rule cannot be established. The fee is applied in **neither** direction, and the balance is flagged unresolved. |

`NO_FEE` and `UNCONFIGURED` are separate on purpose. The previous design
collapsed both into a NULL, which made a panel that charges nothing
indistinguishable from one nobody had asked about — so no screen could tell an
owner which panels actually needed an answer.

### 4.2 · Effective-dated terms

`PanelFeeTerm` records `(panel, effectiveFrom, treatment, feeType, feeValue,
note)`. The term in force on a date is the one with the greatest `effectiveFrom`
not after it; there is no `effectiveTo`, so a gap cannot be created.

**Two independent protections, and both are needed:**

1. **The history** means correcting today's terms cannot rewrite what was
   agreed last year.
2. **The claim snapshot** (`ClaimBatchLine.feeTreatment`, alongside
   `claimedAmount` and `feeAmount`) records what was actually applied to each
   claim. Even a mistaken edit to the history cannot move a claim that has
   already gone out.

A claim still sitting in **BATCHED** — sent to nobody — is re-stamped when the
treatment changes, and only for a term effective today or earlier. That
re-stamp is audited as its own action, because it changes the value of claims
nobody edited.

---

## 5 · Per-panel classification from the evidence

Every one of the 29 panel sheets was classified from its own rows. **No panel
showed contradictory evidence** — the single problematic panel is insufficient,
not contradictory.

| State | Panels | Basis |
|---|--:|---|
| `WITHHELD_FROM_CLAIM` | **16** | 10 with direct banked evidence (39/39, 56/56, 132/133, 530/536, 1,843/1,860 …); 6 with a documented fee rule but no paid claim yet, taking the owner's default for existing panels |
| `NO_FEE` | **12** | No fee value on any claim row, and a nil or blank fee rule |
| `UNCONFIGURED` | **1** | One paid fee-bearing claim, which banked at the full amount — insufficient either way |

**The one `UNCONFIGURED` panel is P16 in the audit's numbering.** It has three
claims in total. It needs an owner answer, and until it gets one its receivables
exclude the fee and say so on screen.

---

## 6 · Financial impact of the correction

Measured, not estimated, by
[`prisma/reports/panel-fee-treatment-impact.ts`](../apps/api/prisma/reports/panel-fee-treatment-impact.ts)
— a repeatable report, not a one-off script, so the same figures can be produced
again months later when somebody asks how big the correction was.

```
REPORT_DATABASE_URL=<owner connection> npx ts-node prisma/reports/panel-fee-treatment-impact.ts
```

It compares, per claim, what D-041 would have expected (`claimed + fee`) against
what the claim's own recorded treatment expects now.

### On the synthetic UAT tenant

| | |
|---|--:|
| Claims | 8 |
| Fee-bearing claims | 7 |
| **Claims whose expectation moved** | **7** |
| Previous expected receivable (D-041) | RM1,067.60 |
| **Corrected expected receivable** | **RM952.40** |
| **Overstatement under the old logic** | **RM115.20** |

Per panel:

| Panel | Claims | Treatment | Was | Now | Overstated by |
|---|--:|---|--:|--:|--:|
| MediCover TPA *(synthetic)* | 5 | `WITHHELD_FROM_CLAIM` | 642.60 | 547.40 | **95.20** |
| Sejahtera Care *(synthetic)* | 2 | `WITHHELD_FROM_CLAIM` | 330.00 | 310.00 | **20.00** |
| Kilang Sejati *(synthetic)* | 1 | `NO_FEE` | 95.00 | 95.00 | 0.00 |

**The overstatement is twice the fee on every withheld-fee claim** — the fee was
added where it should have been subtracted. On a real book of 2,640 fee-bearing
paid claims at a typical RM8, the same arithmetic gives roughly RM42,000 of
receivable that was never owed, plus the same again in balances that could never
be cleared. **Run the report against the production database to get that
tenant's real figure before relying on any prior receivable report.**

---

## 7 · Regression tests

The owner's numbers, asserted in the owner's words
([`financial-invariants.spec.ts`](../apps/api/src/finance/financial-invariants.spec.ts),
describe block *"D-041 supersession — RM100 claimed, RM8 withheld"*):

| Assertion | Expected | Explicitly not |
|---|--:|--:|
| Expected receivable | RM92.00 | RM108.00 |
| Outstanding after RM92 received | RM0.00 | RM16.00 |
| Outstanding after RM92 received, un-adjudicated | RM0.00 | — |
| Twenty such claims, rolled up | RM1,840.00 | RM2,160.00 |

The last one matters because the un-adjudicated path uses the expected
receivable as its base, and that is exactly where the old logic left a permanent
shortfall.

Alongside them, end-to-end through HTTP: a withheld-fee claim settles to zero
after a full remittance; an unconfigured panel's claims carry the fee in neither
direction and the count is reported; and unsent claims are re-stamped while
submitted ones are not.

---

## 8 · What still needs the owner

1. **P16 — the `UNCONFIGURED` panel.** Three claims, one paid, and that one
   banked at the full amount. Does that panel waive its fee, or was that row an
   exception like the other one? Until it is answered, its receivables exclude
   the fee.
2. **Run the impact report against production** before quoting any historical
   panel receivable figure. The UAT numbers above are synthetic.
3. **The six panels with a documented fee rule but no paid claim yet** took the
   owner's default. The first payment from each of them is worth checking
   against `claimed − fee` — the report and the reconciliation screen will both
   show it immediately if one of them does something else.
