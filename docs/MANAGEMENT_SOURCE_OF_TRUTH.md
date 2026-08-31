# The source of truth register

**For every operational number the clinic acts on, this says which ONE place
owns it, what is computed from it, and what must never be typed.**

It exists because the clinic currently runs **eight workbooks** alongside Kuwick
— five for stock, one for panel claims, two for payroll — and several of the
same numbers live in more than one of them. During cutover, and
for a long time after, somebody will hold two figures that disagree and need a
one-line answer to *"which one is right?"*. That answer should not depend on who
is asked.

Everything here is checked against the code and the database as they stand on
the branch, not against intent. Where Kuwick is **not** the source of truth,
§7 says so plainly rather than leaving a gap.

Companion documents:
[`STOCK_LEGACY_WORKFLOW_AUDIT.md`](./STOCK_LEGACY_WORKFLOW_AUDIT.md),
[`PANEL_LEGACY_WORKFLOW_AUDIT.md`](./PANEL_LEGACY_WORKFLOW_AUDIT.md),
[`HR_PAYROLL_EXCEL_REFERENCE_AUDIT.md`](./HR_PAYROLL_EXCEL_REFERENCE_AUDIT.md),
[`MANAGEMENT_SYSTEM_REPLACEMENT_MATRIX.md`](./MANAGEMENT_SYSTEM_REPLACEMENT_MATRIX.md).

---

## 1 · Why the workbooks go wrong, in one sentence

Every material defect found across the six workbooks is the same defect: **a
number that is two things at once.**

- The payable listing's headline "what we owe" sums the payment **date** column
  because balance and date sit next to each other and the range was cut by hand
  (`STOCK_LEGACY_WORKFLOW_AUDIT.md` §5, S-1). The total is *derived*, but it is
  derived by a formula somebody can edit — so it is also *typed*.
- The panel workbook's `CLAIM TO RECEIVE` is computed per sheet, and also
  re-keyed by hand on the panels that matter (`PANEL_LEGACY_WORKFLOW_AUDIT.md`
  §4.2). Same number, two authors.
- The payroll workbook holds an employee's EPF rate in the rate table *and*
  again in the row, so correcting one corrects nothing.

A spreadsheet cannot prevent this: any cell can be a formula or a value, and
nothing marks which. A database can. So Kuwick classifies every number into
exactly one of four kinds, and the kind decides what may write it.

---

## 2 · The four kinds of number

| Kind | Stored? | Who writes it | The rule |
|---|---|---|---|
| **AUTHORITATIVE** | Yes | A person, through one named permission, with an audit row | Typed once, by somebody accountable. Everything else follows from it. |
| **DERIVED** | **No** | Nobody — computed on read | Cannot drift, because between two reads it does not exist. |
| **MIRROR** | Yes | The system, in the **same transaction** as the authoritative write | A convenience copy of a current value. Never typed, never written alone. |
| **SNAPSHOT** | Yes | The system, once, at a defined moment | Deliberately frozen so later configuration cannot rewrite history. |

**A number is exactly one of these four.** If you find one that is two, that is
a defect, and it is the defect this whole document exists to prevent.

Three consequences worth stating out loud:

- **A DERIVED number has no column.** If you can see it in the database, it is
  not derived. Patient balance, supplier invoice balance, claim outstanding and
  expected receivable are all computed by pure functions
  (`finance/financial-invariants.ts`, `finance/supplier-payables.ts`,
  `finance/panel-money.ts`) and stored nowhere.
- **A MIRROR is only ever as right as its last transaction**, so the transaction
  must be the one that wrote the source. `StockLevel.quantityOnHand` is written
  only in the same transaction as the `StockMovement` row that moved it; the
  seed's own invariant re-derives it from the ledger and fails if they differ.
- **A SNAPSHOT is right forever, including when it is now wrong.** A claim
  raised under an 8% fee keeps 8% after the contract changes to 10%. That is the
  point. `ClaimBatchLine.feeTreatment` exists so that correcting a panel's
  configuration cannot silently restate money already claimed.

---

## 3 · The register

### 3.1 · Patients, visits and clinical work

| Fact | Kind | Lives in | Written by |
|---|---|---|---|
| Patient identity (name, IC, phone) | AUTHORITATIVE | `patients` | Registration / patient edit, permissioned |
| A change to a patient's identifier | AUTHORITATIVE, append-only | `patient_identity_changes` | The identity-change workflow |
| A visit and its billing type | AUTHORITATIVE | `visits` | Registration |
| Panel benefit for this visit | SNAPSHOT | `visits` (benefit columns, D-092) | Verification at registration |
| Clinical note content | AUTHORITATIVE, append-only revisions | `clinical_notes` + `clinical_note_revisions` | The author, signed |
| "Amended" | DERIVED | — | From the revision chain; the signed text is never rewritten |
| BMI | DERIVED | — | `clinical-note.service.ts`; never persisted |
| Attendance | DERIVED | — | From visits (D-082) |

### 3.2 · Billing

| Fact | Kind | Lives in | Written by |
|---|---|---|---|
| Invoice lines and their prices | SNAPSHOT at add time | `invoice_lines` | Billing; the catalogue price is deliberately *not* re-read later |
| Patient / panel split | AUTHORITATIVE | `invoices.patientResponsibilityAmount` / `panelResponsibilityAmount` | `billing-calculation.ts` at invoice creation |
| Split not yet resolved | — | Both columns **NULL** | Nobody. NULL means "nobody has decided", and every report counts it separately rather than folding it in at either extreme |
| Claimable panel amount | SNAPSHOT at settlement | `invoices.panelCoveredAmount` | `markPaid`, copying the panel share at the moment the invoice settled |
| Invoice totals, tax | DERIVED then stored on the invoice | `computeInvoiceTotals` | Billing, in one transaction with the lines |
| An appointment's **booking fee** | SNAPSHOT at booking | `appointments.bookingFeeAmount` | A clinic raising its fee in March must not change what a February booking asked for |
| An appointment's **service price** | DERIVED, read live | — | Deliberately *not* snapshotted: it is an estimate of future revenue, not a commitment. The two sit in the same row and are different kinds of number — which is the distinction this document exists to make |

### 3.3 · Money received from patients

| Fact | Kind | Lives in | Written by |
|---|---|---|---|
| **Every payment and refund** | AUTHORITATIVE, **append-only** | `payments` | The counter, permissioned. A BEFORE UPDATE OR DELETE trigger refuses both |
| A reversal | AUTHORITATIVE — a **new row**, not an edit | `payments` | `payment.service.ts`; reversing writes history, it does not erase it |
| What the patient has paid | MIRROR | `invoices.patientPaidAmount` | Derived back from the ledger in the same transaction |
| Patient balance / ageing | DERIVED | — | `computePatientBalance` |
| Day-end expected totals, **while open** | DERIVED | — | Recomputed live, so a counter refreshing at 20:55 sees the 20:54 payment |
| Day-end totals, **once closed** | SNAPSHOT | `day_end_closings` | The close. A later correction cannot silently rewrite what somebody signed |

### 3.4 · Panel claims

| Fact | Kind | Lives in | Written by |
|---|---|---|---|
| A panel's fee rule, **through time** | AUTHORITATIVE, effective-dated | `panel_fee_terms` | Panel configuration (D-112) |
| The fee rule **in force today** | MIRROR | `panel_clinics.feeTreatment` / `claimFeeType` / `claimFeeValue` | Written from the term in force, in the same transaction |
| Payment terms, re-claim window | AUTHORITATIVE | `panel_clinics` | Panel configuration |
| Claimed amount, fee, fee treatment | SNAPSHOT at claim creation | `claim_batch_lines` | `ClaimBatchService`; a claim already sent keeps the arithmetic it was raised under |
| Submission, adjudication, rejection reason | AUTHORITATIVE | `claim_batch_lines` | The claim workspace, permissioned |
| **Every state change** | AUTHORITATIVE, **append-only** | `claim_events` | The workspace. This is the audit trail the workbook's remarks column was trying to be |
| Due date | SNAPSHOT at submission | `claim_batch_lines.dueDate` | `resolveTermWindow`, from the panel's own term at the moment of submission |
| Expected receivable, outstanding | DERIVED | — | `computeClaimBalance` — the **only** place claimed ± fee is computed |
| Overdue | DERIVED | — | `isOverdue`, judged against the far edge of a range term |

### 3.5 · Money received from panels

| Fact | Kind | Lives in | Written by |
|---|---|---|---|
| A remittance and its allocations | AUTHORITATIVE | `panel_remittances` + `panel_remittance_allocations` | Finance, permissioned; allocations must equal the net exactly |
| What a claim has received | MIRROR | `claim_batch_lines.paidAmount` | **Re-derived from the sum of its allocations**, never incremented — so a double-click cannot double-credit it |
| Billed vs claimed, unclaimed money | DERIVED | — | `panelBillingPosition` |
| What the admin fee cost | DERIVED | — | `panelFeeCost` / `rollUpPanelFeeCost` |
| Whether the fee was actually taken | DERIVED | — | `feeEvidence` — from what the claim received against what it expected, never from the remittance's `withheldAmount` field (D-113) |

### 3.6 · Stock

| Fact | Kind | Lives in | Written by |
|---|---|---|---|
| **Every movement of stock** | AUTHORITATIVE, **append-only** | `stock_movements` | Receiving, dispensing, transfer, count, write-off |
| Quantity on hand | MIRROR | `stock_levels.quantityOnHand` | Only ever in the same transaction as a movement row |
| Batch, expiry, **quantity received** | AUTHORITATIVE, written once | `stock_batches` | Goods receiving. `quantity` is what ARRIVED and is never decremented |
| **What is LEFT of a batch** | **Does not exist** | — | Nothing attributes a dispense to a batch, so there is no per-batch balance to read. Writing this register is what found that the near-expiry report was treating the received quantity as the remainder; it now reports both, bounds the exposure by the item's on-hand, and drops batches of an item the clinic no longer holds (`batch-exposure.ts`) |
| Item cost and sell price, **now** | AUTHORITATIVE | `items.cost` / `items.sellPrice` | Goods-in, or a permissioned catalogue edit |
| Item cost and sell price, **history** | AUTHORITATIVE, **append-only** | `item_price_changes` | Written at goods-in when the cost moved, with the receiver's name on it |
| Effective unit cost of a purchase line | DERIVED | — | `effectiveUnitCostCents` — the lower of unit and bonus cost; a NULL bonus is absent, not zero |
| Counted value at a stock take | DERIVED | — | Cost and retail both, reported side by side, never added and never called profit |
| Whether an item may be dispensed | DERIVED | — | From `active` and `awaitingFirstReceipt`: a catalogue entry never delivered cannot be dispensed |

### 3.7 · What the clinic owes suppliers

| Fact | Kind | Lives in | Written by |
|---|---|---|---|
| A supplier invoice | AUTHORITATIVE | `supplier_invoices` | Stock or finance, permissioned |
| A payment and its allocations | AUTHORITATIVE | `supplier_payments` + `supplier_payment_allocations` | Finance; allocations must equal the payment exactly |
| What has been paid on an invoice | **DERIVED** | — | The sum of allocations. **There is no paid column**, so it cannot drift from the bank |
| `PAID` status | DERIVED | — | The API **refuses** `status: PAID` — *"PAID is derived from the payments allocated to this invoice. Record a payment instead."* |
| Due date | SNAPSHOT at entry | `supplier_invoices.dueDate` | From the supplier's term. **NULL when no term is recorded** — never an assumed thirty days |
| Overdue, due-this-week, aged buckets | DERIVED | — | `rollUpPayables` / `payableAgeBucket`, aged from the DUE date |
| Delivery performance | DERIVED | — | `deliveryPerformance`; an unknown SLA is neither on time nor late |

### 3.8 · Payroll

| Fact | Kind | Lives in | Written by |
|---|---|---|---|
| Statutory rate tables | AUTHORITATIVE, versioned | `statutory_rule_sets` | Seeded as `CORROBORATED`; only a person who has opened the official schedule may mark one `VERIFIED` |
| Employee pay components | AUTHORITATIVE | Employee profile | HR, permissioned |
| Attendance, leave | AUTHORITATIVE | `attendance_records`, `leave_requests` | HR |
| ORP divisors, rates used | SNAPSHOT onto the run | `payroll_runs` | Calculation — so re-reading last March does not re-price it at today's rates |
| A payroll line | AUTHORITATIVE, **append-only** | `payroll_lines` | Calculation |
| An adjustment | AUTHORITATIVE, **append-only** | `payroll_adjustments` | HR, with a reason |
| Statutory contributions | DERIVED at calculation, then frozen | — → `payroll_lines` | The statutory engine |
| **PCB / MTD** | **NOT IN KUWICK** | — | See §7 |

### 3.9 · Configuration and access

| Fact | Kind | Lives in | Written by |
|---|---|---|---|
| Roles, custom roles, individual grants | AUTHORITATIVE | `staff_role_assignments`, `clinic_custom_roles`, `staff_permission_grants` | Owner |
| What a permission allows | AUTHORITATIVE, **in code** | `core/permissions.ts` | A developer, in a reviewed change. Not a database row somebody can edit |
| Service and consultation prices | AUTHORITATIVE | `service_catalog`, `consultation_tariff_rules` | Owner. Prices on existing invoices are snapshots and do not move |
| Every privileged action | AUTHORITATIVE, **append-only** | `audit_logs` | `recordAudit`, inside the same transaction as the act |

---

## 4 · What the database itself refuses

Nineteen tables carry a PL/pgSQL trigger that refuses a change, and it is worth
being precise about **which** change, because they are not all the same rule.
Three families plus a special case:

**(a) Append-only ledgers — UPDATE and DELETE both refused, always, for every
row.** These are the seven tables where a correction must be a new row:

```
payments   stock_movements   claim_events   item_price_changes
payroll_adjustments   appointment_events   appointment_form_answers
```

A reversed payment is a reversal row. A corrected stock count is a movement. A
price that went back down is another price change. History that can be edited is
not history.

**(b) Rows that may be corrected but never disappear — DELETE and TRUNCATE
refused, UPDATE allowed:**

```
data_corrections   label_prints   patient_alerts   patient_identity_changes
```

**(c) Reference catalogues that refuse deletion**, with the reason in the error
message itself: *"Reference catalogue rows are never deleted — set active =
false to retire them. Prescriptions already printed reference these rows; a
label that cannot be reprinted is a medicolegal gap."*

```
consumption_methods   dosage_units   indication_presets
prescription_frequencies   stock_units
```

**(d) Conditional locks — the row is editable until a moment, and frozen
after.** These are the most interesting, because each encodes a business rule
rather than a blanket prohibition:

| Table | Frozen when | What is still permitted |
|---|---|---|
| `payroll_lines` | Its run reaches `APPROVED` or `PAID` | Nothing. *"correct it with a payroll adjustment, not by editing a payslip line"* |
| `payroll_runs` | The run is `APPROVED` or `PAID` | Exactly two transitions, both of which change **no figure**: `APPROVED → PAID` with every total identical, and `→ CANCELLED` with gross and net identical |
| `provider_schedule_mode_periods` | Its `effective_from` is in the past | Editing a period that has not yet governed a day |

The `payroll_runs` rule is the shape to copy: rather than "locked", it
enumerates the transitions that are safe **and asserts the figures are
unchanged in the same predicate**. A lock that only checks the status column can
be walked past by changing the status and the money together.

## 5 · Numbers that must never be typed

Each of these has a mechanism, not just a convention. If the mechanism is ever
removed, the register above becomes fiction.

| Number | What stops it being typed |
|---|---|
| What has been paid on a supplier invoice | There is no column. It is the sum of allocations. |
| `PAID` on a supplier invoice | The update endpoint refuses the status with a message saying why. |
| What a panel claim has received | Re-derived from allocations on every remittance, never incremented. |
| Quantity on hand | Written only inside a transaction that also writes a movement row; the seed re-derives it from the ledger and fails on a mismatch. |
| Expected receivable on a claim | One function, `computeClaimBalance`, called from nine places across four services and defined in one. There is no second formula anywhere in the codebase — the workbook has twenty-nine, one per sheet. |
| A closed day's totals | Frozen at close; reopening is a permissioned, audited act that records who and why. |
| A signed clinical note | The signed text is never rewritten; an amendment is a new revision. |
| A payment | Append-only at the database level. |

---

## 6 · Where a number legitimately appears twice

Mirrors and snapshots are the only sanctioned duplication, and each carries a
rule that makes it safe:

| Duplicate | Source of truth | Rule that keeps them honest |
|---|---|---|
| `invoices.patientPaidAmount` | `payments` | Written only in the transaction that writes the payment. |
| `claim_batch_lines.paidAmount` | `panel_remittance_allocations` | Recomputed as a SUM, so it converges rather than accumulating error. |
| `stock_levels.quantityOnHand` | `stock_movements` | Same transaction; re-derived and asserted by the seed's invariants. |
| `panel_clinics.feeTreatment` | `panel_fee_terms` | Mirrors the term in force **today**; a term dated next month leaves it alone. |
| `claim_batch_lines.claimedAmount` / `feeAmount` / `feeTreatment` | `invoices` / `panel_fee_terms` at that moment | Snapshot, deliberately frozen. Re-stamping happens **only** for claims not yet sent, and is audited (`panel.feeTreatmentRestamped`). |
| `invoices.panelCoveredAmount` | `panelResponsibilityAmount` at settlement | Snapshot. What the clinic decided the panel owes, at the moment it decided. |
| Staff name and role on an event | `staff` | Snapshot. A staff member who leaves must not turn last year's audit trail into a blank. |

---

## 7 · Where Kuwick is NOT the source of truth

Stated plainly, because a register that only lists successes is not a register.

| Fact | Where it really lives | Why | Route out |
|---|---|---|---|
| **PCB / MTD** | The LHDN calculator, keyed in by a person | No MTD engine, **by decision**. The simplified band engine must not price live payroll. | An MTD rule set, or continue keying it with the figure recorded and audited |
| **Statutory rates as authority** | KWSP / PERKESO schedules | The tables are seeded `CORROBORATED` from the clinic's own workbook and **verified against nobody** — this environment cannot reach the publishers. A run computed against them is `PROVISIONAL`, and approving one requires the approver to pass `acknowledgeStatutoryGap` explicitly: it is refused by default and can only be overridden knowingly. | A person with access opens the schedules and marks them `VERIFIED` |
| **The panel portal submission itself** | The panel's portal | Deliberate: no browser automation into panel portals. | Stays manual |
| **7,146 historical and open panel claims** | The claim workbook | No importer (G-12). **This is the one production blocker for Panel.** | Task 13/14 |
| **Historical stock, supplier and payroll history** | The workbooks | Same: nothing imported yet. | Task 13/14 |
| **A panel's contract terms** | Paper contracts | Kuwick records what somebody enters and, where nobody has entered anything, says `UNCONFIGURED` rather than guessing. One real panel is in that state today. | Owner reads the contract |
| **Which batch a dispense came from** | Nowhere | Outbound movements name the item and clinic, not the batch. Until dispensing picks a batch, a per-batch remainder cannot be known — only bounded. | Batch-attributed dispensing, if the clinic wants FEFO enforced rather than assumed |
| **Whether an adjudication is correct** | The panel's remittance advice | Kuwick records what a person read. It cannot audit the panel. | Inherent |

Two of these are honesty rather than gaps: Kuwick **should not** be the source
of truth for what a panel decided or what the KWSP schedule says. The rest are
work.

---

## 8 · The cutover rule

**Proposed, for the owner to accept or change** — nothing here has been agreed.
What is not negotiable is that each workbook needs *a* date, because a file that
is "mostly retired" is a file two people are still updating differently.

| Workbook | Stops being written when | What happens to the file |
|---|---|---|
| Panel claim listing | The importer has loaded the open claims and one full remittance cycle has been recorded in Kuwick and reconciled against it | Kept read-only as history |
| Medications payable listing | Open supplier invoices are entered and one payment run has been made through Kuwick | Kept read-only |
| Inventory count sheet | The first full stock take is completed in Kuwick | Kept read-only |
| New-medication list | Immediately — new-item requests have no history worth migrating | Archived |
| Que-order sheets *(both)* | The first purchase order cycle runs through Kuwick | Kept read-only |
| Payroll workbook | **Not yet.** It remains the source of truth for PCB, and for the statutory rates until they are `VERIFIED` | Still live |

**During the overlap, Kuwick is the source of truth for anything it holds, and
the workbook is a read-only copy.** Not the other way around, and never both —
the moment a number is maintained in two live places, this document is void for
that number.

---

## 9 · How to tell whether this register is still true

Each claim above is enforced by something that runs. If you change the code, one
of these should fail:

| Claim | Enforced by |
|---|---|
| Append-only really is append-only | `test/appointment-audit-immutability.e2e-spec.ts`, `test/schedule-mode-period-immutability.e2e-spec.ts`, and the triggers themselves |
| A tenant cannot see another tenant's data | `test/rls-enforcement.e2e-spec.ts`, `test/tenant-isolation.e2e-spec.ts` |
| Quantity on hand equals the movement ledger | Seed invariant 1, `test/stock-transfers-takes.e2e-spec.ts` |
| The claim identity holds: received + outstanding + rejected + written off = expected | Seed invariant 2, `reconciliation.reconciles`, `test/panel-claim-workspace.e2e-spec.ts` |
| A withheld fee gives RM92 on RM100, never RM108 | `financial-invariants.spec.ts` — the owner's own numbers |
| Supplier paid is derived and cannot be declared | Seed invariant 2b, `test/supplier-payables.e2e-spec.ts` |
| Billed-but-unclaimed is found, and a rejected claim frees its invoice | `test/panel-money.e2e-spec.ts` |
| A sold-out batch is not reported as stock about to expire | `batch-exposure.spec.ts`, `test/stock-operating-model.e2e-spec.ts` |
| Unconfigured is never treated as zero | `panel-money.spec.ts`, `financial-invariants.spec.ts` |
| Nothing statutory is computed without a rule set, PCB blocks the run, and an approved run is locked | `test/workforce-payroll.e2e-spec.ts` |

If a row in §3 is ever changed without a corresponding change here, the register
has started drifting — which is exactly the failure it was written to prevent.
