# Panel module — audit and build plan (Step 1)

**Date:** 2026-11-03 · **Base:** `master` @ `8ad1e94` (re-fetched) · **Status:** audit only, nothing built

The headline finding: **the Panel module is not a new module.** It is roughly
80% built, it is the most evidence-driven domain in Kuwick 2.0, and all 143 of
its unit tests pass (verified on this commit after `prisma generate`).

```
PASS src/panel/claim-import-csv.spec.ts          PASS src/clinical/panel-benefit.service.spec.ts
PASS src/panel/payment-terms.spec.ts             PASS src/clinical/panel-pricing.service.spec.ts
PASS src/finance/panel-money.spec.ts             PASS src/clinical/claim-batch.service.spec.ts
PASS src/inventory/item-panel-pricing.service.spec.ts   PASS src/clinical/billing-calculation.spec.ts
Test Suites: 8 passed · Tests: 143 passed
```

So Step 1 is not "plan a module". It is "find the 20% that is missing, and do
not rebuild the 80% that works". Every item below is marked **BUILT**,
**PARTIAL** or **MISSING** against evidence in the repository.

---

## 1 · What already exists

### 1.1 Data model (13 tables, 11 enums)

| Table | What it holds |
|---|---|
| `DefaultPanelClinic` | Global default panel list, copied into a new tenant at provisioning |
| `PanelClinic` | The clinic's own panel: 35 columns — term, fee, markup, portal, contacts, requirements |
| `PanelFeeTerm` | Fee rule **as at a date**. History is authoritative; `PanelClinic` mirrors today's value |
| `PanelPriceOverride` | Per-panel negotiated price for one item or one service |
| `PanelExclusion` | Items/services this panel does not cover |
| `ClaimBatch` | A submission, with method and reference |
| `ClaimBatchLine` | **One claim.** 40 columns: lifecycle, money, rejection, write-off, charge-to-patient, re-claim chain |
| `ClaimImportBatch` | One run of the historical-claim importer, with frozen reconciliation totals |
| `PanelRemittance` | Money arriving from a panel — its own document |
| `PanelRemittanceAllocation` | Which claim each ringgit settled |
| `ClaimEvent` | The claim's own timeline, every status change and money edit |
| `ConsultationTariffRule` | Consultation price by time band (clinic-level — see gap N-6) |
| `Visit.panel*` (21 columns) | The per-visit benefit snapshot, plus its override trail |

Enums: `PanelClaimStatus` (15 states), `PanelClaimFeeType`, `PanelFeeTreatment`,
`PanelTermUnit`, `PanelTermAnchor`, `PanelSubmissionMethod`,
`ClaimRejectionCategory`, `ClaimBatchStatus`, `ClaimLineStatus`,
`PanelVerificationStatus`, `PanelCoverageType`, `PanelCopaymentType`.

### 1.2 Services

| File | Lines | Job |
|---|---|---|
| `panel/claim-workspace.service.ts` | 1,498 | Submission queue, adjudicate, resubmit, charge-to-patient, write-off, remittance, reconciliation, work queue |
| `panel/claim-import-csv.ts` + `claim-import.service.ts` | 725 | Historical claim import: template, parse, dry run, commit |
| `panel/payment-terms.ts` | 238 | `resolveTermWindow`, `isOverdue`, `daysPastDue`, `resolveResubmissionWindow` |
| `panel/panel-config.service.ts` | 279 | Panel contract terms + effective-dated fee history |
| `clinical/billing-calculation.ts` | — | `calculateResponsibility` — the panel/patient split engine |
| `clinical/panel-benefit.service.ts` | — | Record verification, override benefit (with reason + actor) |
| `clinical/panel-pricing.service.ts` | — | Price overrides and exclusions |
| `finance/panel-money.service.ts` | — | Billed-vs-claimed, fee cost, banked, aging |
| `finance/financial-invariants.ts` | — | `computeClaimBalance` — **one** receivable formula |

16 HTTP routes on `panel.controller.ts`. 3 e2e suites.

### 1.3 Screens

`/admin/panel` (claim workspace, 1,218 lines) · `/admin/panel/import` ·
`/admin/panel/configuration` · `/admin/panel/batches` · `/admin/panel/companies` ·
`/admin/finance/panel-money` · `AddToQueueDrawer` panel picker ·
`PanelBenefitPanel` on billing review · `PanelPricingSection` on items.

### 1.4 Documentation already written

`docs/PANEL_LEGACY_WORKFLOW_AUDIT.md` is a 530-line read of the clinic's real
workbook, with a gap register **G-1 … G-13** (9 resolved, 4 open) and 18 named
defects. `docs/DECISIONS.md` carries D-041, D-112 (fee direction), D-113 (panel
money), D-115 (import). **Read these before building anything** — they contain
the reasoning behind choices that look arbitrary.

---

## 2 · Comparison with Kuwick 1.0 — the keep-list

Every 1.0 feature named in the brief, and whether 2.0 has it.

| 1.0 feature | 2.0 | Where |
|---|---|---|
| Global default panel list | **BUILT (empty)** | `DefaultPanelClinic` + platform CRUD + copy at provisioning. **But no seed content exists** — see N-1 |
| Clinic custom panels | **BUILT** | `PanelClinic`, tenant-scoped |
| Portal URL | **BUILT** | `PanelClinic.portalUrl` |
| Per-panel pricing override | **BUILT** | `PanelPriceOverride` (item or service), plus panel-wide RM markups |
| Per-panel exclusions | **BUILT** | `PanelExclusion`, stamped onto `InvoiceLine.excludedFromPanel` at add time |
| Panel chosen at add-to-queue | **BUILT** | `AddToQueueDrawer`, `AddToQueueDto.panelClinicId` |
| Last-used panel remembered | **MISSING** | nothing stores it — see N-5 |
| Eligible limit (unlimited / limited RM) | **BUILT** | `PanelCoverageType` + `limitAmount` + per-visit snapshot. **Per-year limit missing** — see N-4 |
| Verify-eligibility link | **BUILT** | `portalUrl` + explicit `PanelVerificationStatus`; selecting a panel does **not** verify it |
| Panel auto-selected at the counter | **MISSING** | depends on last-used — see N-5 |

**Nothing from 1.0 needs reinventing.** Two items (last-used, auto-select) were
never carried over and are one small piece together.

2.0 also already goes beyond 1.0 in ways worth protecting: the fee is
**withheld** not added (D-112, proven against 2,615 bank credits), payment terms
hold ranges / working days / invoice-date anchors, payments are their own
document, and the monthly CMS-vs-workbook reconciliation **disappears** because
claims derive from invoices and therefore cannot disagree.

---

## 3 · What is genuinely new — gap register N-1 … N-10

Each gap names the brief item, the evidence, the proposed model, and its size.

### N-1 · Panel type, and an empty default list — **MISSING** · S

No `panelType` anywhere in the schema. `payerName` is free text and answers a
different question (who signs the cheque, not what kind of body this is).

Worse: `DefaultPanelClinic` is modelled, has platform CRUD, and is copied into
every new tenant — but `prisma/seed-data/` holds only diagnosis and medication
files. **A new clinic gets zero panels.** The copy also drops `url`
(`platform-tenant.service.ts:113` maps `name` only).

```prisma
enum PanelType { TPA  INSURER  CORPORATE  GOVERNMENT  OTHER }

model PanelClinic {
  /// NULL means nobody has classified this panel — reported, never guessed.
  /// Same convention as `feeTreatment = UNCONFIGURED`.
  panelType PanelType? @map("panel_type")
}
model DefaultPanelClinic {
  panelType PanelType?
}
```

`panelType` drives **nothing financial**. It groups the config screen, and it
decides which fields the wizard asks for (a government panel has no portal; a
corporate panel has an employer behind it). Keeping it inert is the point.

Also: seed the global list with neutral Malaysian panel names and types, and
fix provisioning to copy `url` and `panelType`.

> **Demo-data rule.** Seeded panel names are real third-party bodies, so the
> seed carries no Kuwick-authored label inside them, and nothing Kuwick writes
> into a panel's portal ever says "Kuwick". Demo tenants use neutral labels
> ("Demo TPA A", "Demo Insurer B").

### N-2 · Setup wizard when the module is empty — **MISSING** · M

HR has `PayrollStartGate`. Panel has no empty state at all: a clinic with zero
panels lands on a blank claim workspace.

`/admin/panel/setup`, shown when the tenant has no active `PanelClinic`:

1. **Pick your panels** — checkbox list from `DefaultPanelClinic`, grouped by
   `panelType`, plus "add one of your own".
2. **How long do they take to pay?** — term, with the range / working-days /
   anchor controls the model already supports, defaulting to 30 calendar days
   from submission.
3. **Do they charge a fee?** — none / RM per claim / RM per patient / % of bill,
   writing the opening `PanelFeeTerm`. "Not sure" is allowed and stores
   `UNCONFIGURED`, which the config screen then chases.
4. **Confirm** — plain-language summary, one row per panel.

Every step is skippable and every answer is a setting with a default. A clinic
that skips everything gets working panels with 30-day terms and no fee.

### N-3 · Fee rule: RM per patient, and batch-level fees — **PARTIAL** · M

`PanelClaimFeeType` is `PERCENT | AMOUNT`, both applied **per claim**. The real
workbook shows `RM8/claim` (built), `10%`/`15%` (built), and **`RM4.31/patient`
(not expressible)**. Open gaps G-7 (10% of a consolidated *monthly invoice*) and
G-8 (fee tiers) are the same shape: a fee the batch owns, not a claim.

```prisma
enum PanelClaimFeeType {
  PERCENT        // of each claim           (built)
  AMOUNT         // RM per claim            (built)
  PER_PATIENT    // RM × distinct patients in the batch     NEW
  PERCENT_BATCH  // % of the batch total — closes G-7       NEW
}

model ClaimBatch {
  /// The fee the PANEL charges for this batch, when the rule is batch-scoped.
  /// Per-claim `ClaimBatchLine.feeAmount` is then this figure allocated
  /// across the claims, so the two can never disagree.
  feeAmount    Decimal  @default(0) @db.Decimal(10, 2)
  feeTreatment PanelFeeTreatment @default(UNCONFIGURED)
}
```

Allocation reuses `allocateProportionally` from `billing-calculation.ts`
(residue to the last positive weight) so the claim fees sum **exactly** to the
batch fee. Per-claim `feeTreatment` snapshotting stays exactly as D-112 built
it. No change to `computeClaimBalance`'s signature.

### N-4 · Limit per year, not just per visit — **MISSING** · L

`PanelClinic.limitAmount` and `Visit.panelVisitLimitAmount` cover `RM70 per
visit`. **`RM150 per year` cannot be expressed**, and it is the harder half: a
per-visit limit is a number on one bill, a yearly limit is an accumulator across
every visit a member has made.

```prisma
enum PanelLimitPeriod { PER_VISIT  PER_YEAR  BOTH }

model PanelClinic {
  limitPeriod         PanelLimitPeriod? @map("limit_period")
  annualLimitAmount   Decimal?          @map("annual_limit_amount") @db.Decimal(10,2)
  /// 1-12. The policy year rarely starts in January.
  limitYearStartMonth Int?              @map("limit_year_start_month")
}

model Visit {
  /// Snapshotted at verification like every other benefit term, so a later
  /// visit cannot rewrite this bill's split.
  panelAnnualLimitAmount    Decimal? @db.Decimal(10,2)
  panelAnnualUsedBefore     Decimal? @db.Decimal(10,2)
}
```

**Deliberately no accumulator table in piece one.** The used-to-date figure is
computed on read by summing this member's claims inside the policy year — the
same discipline as `computeClaimBalance`: one formula, derived, never typed. A
cached table only earns its place if that read is measured slow, and a cache
that can drift from the claims is exactly the defect this module exists to kill.

Needs one owner answer (Q1): does usage count **claimed**, **approved** or
**paid** amounts?

### N-5 · Counter: employer, relationship, and panel memory — **MISSING** · M

Three small things, one piece, because they are all pre-fill at the same moment.

```prisma
enum PanelRelationship { SELF  SPOUSE  CHILD  PARENT  OTHER }

model Visit {
  /// Which company the member works for. Free text in piece one — a real
  /// `PanelEmployer` table only once there is a report that needs to group by
  /// it (and that is also where G-9's per-employer term would live).
  panelEmployerName String?            @map("panel_employer_name")
  panelRelationship PanelRelationship? @map("panel_relationship")
}

model Patient {
  /// LAST-USED PANEL, so the counter can pre-fill. A suggestion, never a
  /// commitment: the visit still stores PENDING_VERIFICATION, and staff still
  /// press Verify.
  lastPanelClinicId       String?
  lastPanelMemberReference String?
  lastPanelEmployerName   String?
  lastPanelRelationship   PanelRelationship?
}
```

Clinic setting `panel.autoSelectLastPanel`, default **on**. This closes both
1.0 keep-list gaps ("last-used panel remembered", "panel auto-selected at the
counter") in one change.

### N-6 · Consultation fee by time band, per panel — **PARTIAL** · M

`ConsultationTariffRule` already has `startTime`, `endTime`, `classification`,
a service and an effective window — but it is **clinic-level**. A panel that
pays RM18 by day and RM25 at night cannot be expressed: `PanelPriceOverride`
has no time dimension.

```prisma
model ConsultationTariffRule {
  /// NULL = the clinic's own rule, which is what every existing row means.
  /// No migration, no backfill, no behaviour change.
  panelClinicId String? @map("panel_clinic_id")
}
```

Resolution order, extending `resolveSourcedPrice` rather than forking it:
panel+time rule → clinic time rule → `PanelPriceOverride` → panel markup →
cash price. Most specific wins. Still never a free-text price.

### N-7 · Proof upload on a claim — **MISSING** · S

`PanelClinic.documentRequirements` already lists what each panel wants, and
`MediaAsset` / `Attachment` already exist — but nothing links a file to a
`ClaimBatchLine`.

```prisma
model ClaimAttachment {
  id               String  @id @default(uuid())
  tenantId         String  @map("tenant_id")
  claimBatchLineId String  @map("claim_batch_line_id")
  mediaAssetId     String  @map("media_asset_id")
  /// Which requirement this satisfies, matched against the panel's list.
  requirementLabel String? @map("requirement_label")
  uploadedByStaffId String @map("uploaded_by_staff_id")
}
```

Optional, as the brief says. The workspace shows the panel's checklist with
each line ticked or not — it never blocks submission on it.

### N-8 · Claim raised automatically from the bill — **PARTIAL** · M

Today a settled panel invoice appears as **UNCLAIMED** immediately
(`claim-batch.service.ts:293`) and staff choose what goes into a batch. That is
closer to the real workflow than the brief's "created automatically" — one panel
batches daily, another monthly, and both are the same feature.

So: make it a setting rather than a rewrite.

- `panel.autoRaiseClaimOnSettlement`, default **off** (today's behaviour).
  When on, settling a panel invoice puts a claim line into that panel's standing
  `BATCHED` batch.
- The brief's five status names are a **display mapping** over the existing 15
  states, not a schema change:

  | On screen | Stored |
  |---|---|
  | Not submitted | `READY`, `NEEDS_INFORMATION`, `BATCHED` |
  | Submitted | `SUBMITTED`, `ACKNOWLEDGED`, `RESUBMITTED` |
  | Approved | `APPROVED`, `PARTIALLY_APPROVED` |
  | Paid | `PAID`, `PARTIALLY_PAID` |
  | Rejected | `REJECTED`, `RESUBMISSION_REQUIRED` |
  | Closed | `WRITTEN_OFF`, `CLOSED` |

  Plain language on screen; the richer state stays underneath for the people who
  need it. Collapsing the schema to five would throw away `NEEDS_INFORMATION`
  and `ACKNOWLEDGED`, which the workspace depends on.

`panelClaimNo` is already there.

### N-9 · Excel (.xlsx) import — **PARTIAL** · M

The importer is **built and safe**: `GET /panel-workspace/import/template`,
dry run reporting claimed / fee / expected / received / outstanding *before* any
write, all-or-nothing, idempotent by claim number scoped to the panel, every row
traceable to a `ClaimImportBatch`. It passes 18 unit tests.

It accepts **CSV only**. The clinic's file is a 29-sheet workbook, so today they
save-as-CSV per sheet. Accept `.xlsx` on the same endpoint, one sheet per panel,
reusing every row rule in `claim-import-csv.ts` — only the reader changes.

### N-10 · Portal passwords: decided NOT stored — **nothing to build** · S

Verified by grep across `apps/` and `docs/`: there is **no**
`portalPassword`, `portalUsername` or equivalent anywhere. The competitor's
mistake is already avoided — **but only by omission**, and nothing stops the
next person adding the field.

So this piece is documentation and a guard, not a feature:

- A decision in `DECISIONS.md`: Kuwick stores **no** panel portal credential.
  Staff hold them in a password manager; Kuwick holds the URL.
- A `///` comment on `PanelClinic` saying so, beside `portalUrl`.
- `autoComplete="off"` on the panel config form, and no password input to
  autofill into.

If the owner later insists on storage, the only acceptable shape is
write-only (set, never read back), encrypted at rest, with an audit entry per
reveal — and that is a separate decision, not a field added quietly.

---

## 4 · Build order — small pieces, each shippable

Each piece is one migration (or none), one service change, one screen, tests,
and a `DECISIONS.md` entry. Order is chosen so nothing waits on an owner answer
that has not arrived.

| # | Piece | Gap | Blocked on | Size |
|---|---|---|---|---|
| **1** | Panel type + seed the global default list + copy `url`/`panelType` at provisioning | N-1 | — | S |
| **2** | Portal-credential decision, schema comment, autofill guard | N-10 | — | S |
| **3** | Setup wizard for an empty Panel module | N-2 | piece 1 | M |
| **4** | Counter: employer, relationship, last-used panel pre-fill | N-5 | — | M |
| **5** | Claim proof upload against the panel's checklist | N-7 | — | S |
| **6** | Plain-language status names + `autoRaiseClaimOnSettlement` setting | N-8 | Q3 | M |
| **7** | Batch-level fees: `PER_PATIENT`, `PERCENT_BATCH` (closes G-7) | N-3 | Q2 | M |
| **8** | Annual limit with a derived used-to-date figure | N-4 | Q1 | L |
| **9** | Panel-specific consultation price by time band | N-6 | — | M |
| **10** | `.xlsx` import on the existing endpoint | N-9 | — | M |

Pieces 1, 2, 4, 5, 9 and 10 need **no owner answer** and can start immediately.

Three rules held throughout, same as HR:

- **Every rule is a clinic setting with a default.** `autoSelectLastPanel` on,
  `autoRaiseClaimOnSettlement` off, term 30 calendar days from submission, fee
  none. A clinic that configures nothing still works.
- **Never guess money.** An unknown stays `UNCONFIGURED` / NULL and is
  *reported*, as D-112 established. `PANEL_UNRESOLVED` already returns null
  rather than treating an unverified panel as unlimited cover.
- **Catalogue items only.** `resolveSourcedPrice` stays the single place a price
  is resolved, and lines snapshot at add time.

---

## 5 · Questions for the owner (5)

1. **Annual limit** — when a panel says "RM150 per year", does the used-to-date
   figure count what was **claimed**, what the panel **approved**, or what was
   **paid**? (They differ by every rejection.) And does the policy year start in
   January, or per panel?
2. **RM4.31 per patient** — is that per distinct patient **per batch**, per
   **month**, or per claim (so a patient with three claims in one batch is
   charged three times)?
3. **Claim raised automatically?** — today a settled panel bill shows as
   unclaimed and staff pick what goes into a batch. Do you want a claim row
   created the moment the bill is settled, or is choosing better?
4. **Employer company** — free text at the counter, or a real list per panel you
   can report on? A list is more work, but it is the only way to answer "what did
   we bill for Company X" — and it is where a per-employer payment term would
   live (gap G-9, "VARY BASED ON COMPANY").
5. **Fee tiers (G-8)** — one panel shows two different fee values across 2,268
   claims. A tier table, or a per-claim fee override with a reason? The workbook
   cannot say which it is.

---

## 6 · Top 5 backlog items

1. **Seed the global default panel list, and classify by type (N-1).** The
   model, the platform CRUD and the copy-at-provisioning all exist; there is
   simply nothing to copy, so every new clinic starts with zero panels. Smallest
   piece, largest first-run effect.
2. **Setup wizard for an empty Panel module (N-2).** The one piece that makes
   the other nine reachable by a clinic owner rather than by us.
3. **Annual limit with a derived used-to-date figure (N-4).** The only brief
   item that is both missing and genuinely hard, and the one most likely to be
   got wrong by caching a number that drifts from the claims.
4. **Counter: employer, relationship, last-used panel (N-5).** Closes the two
   remaining Kuwick 1.0 regressions and removes re-typing at the busiest moment
   of the day.
5. **Batch-level fees — `PER_PATIENT` and `PERCENT_BATCH` (N-3).** Makes the
   real workbook's `RM4.31/patient` and `10% of the monthly invoice` expressible,
   and closes long-open gap G-7.
