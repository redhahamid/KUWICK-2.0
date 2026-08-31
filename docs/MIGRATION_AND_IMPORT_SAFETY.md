# Migration and import safety

**How the clinic's eight workbooks become Kuwick data without anybody losing
track of what is true.**

The programme's acceptance question is whether a real clinic can operate in
Kuwick without going back to the old system. On day one that question has a
harder form: **can it start at all?** A receivables module that begins empty
tells the clinic it is owed nothing, which is worse than no module.

Companion documents:
[`MANAGEMENT_SOURCE_OF_TRUTH.md`](./MANAGEMENT_SOURCE_OF_TRUTH.md) (which number
is authoritative), [`PANEL_LEGACY_WORKFLOW_AUDIT.md`](./PANEL_LEGACY_WORKFLOW_AUDIT.md)
and [`STOCK_LEGACY_WORKFLOW_AUDIT.md`](./STOCK_LEGACY_WORKFLOW_AUDIT.md) (what
the files actually contain).

---

## 1 · The six safety rules

Every importer in Kuwick obeys all six. They are not preferences; each one
exists because the alternative is a clinic that cannot trust its own figures.

| # | Rule | Why |
|---|---|---|
| **1** | **Dry run by default.** Nothing is written unless the caller passes `commit`. The dry run does the whole job — parse, validate, resolve, compute — and throws the result away. | An import that writes by default is an import somebody runs before reading the totals. |
| **2** | **All or nothing.** A file with any problem imports nothing and reports **every** problem at once. | A half-imported file is the worst outcome available: the clinic cannot tell which rows landed, and the obvious remedy — fix the file, upload again — is the right one anyway. Reporting every problem means one pass through the spreadsheet instead of one round trip per mistake. |
| **3** | **The totals are reported before the write.** Claimed, fee, expected, received, outstanding — computed by the same functions the live screens use. | This is the only thing that proves an import is right, and it cannot be done afterwards. An importer that cannot be checked against its source is a way of getting wrong numbers in faster. |
| **4** | **Idempotent.** A row already present is skipped and counted, never created again. Re-running a file after fixing three rows imports three rows. | The commonest real-world import is the second one. |
| **5** | **Nothing is invented.** A date that could be read two ways is refused rather than chosen. A blank adjudication stays NULL, because *"the panel has not said"* is not *"the panel refused it all"*. Configuration comes from the configuration, never from a column in the file. | Every one of these is a defect found in the actual workbooks. |
| **6** | **Everything imported is traceable.** Each row carries its import batch; each batch carries the totals as they stood, who ran it, when, from what file, and why. | An import that turns out to be wrong has to be findable. |

### The rule that is easiest to get wrong

**Rule 5, on configuration.** The panel claim template has no column for the fee
direction, and that is deliberate. The panel's fee treatment is
effective-dated configuration Kuwick already owns (D-112); a column in a
spreadsheet asking for it again is a second source of truth for the same fact,
and the two will disagree. The importer stamps every row from the panel's
configuration and the screen says so before you commit.

---

## 2 · What can be imported today

| Source workbook | Importer | Status |
|---|---|---|
| **Panel claim listing** | `POST /panel-workspace/import/claims`, screen at **Panel → Import claims** | ✅ **Built.** Template at `GET /panel-workspace/import/template`. This closes G-12, Panel's last production blocker. |
| **Item catalogue / medicine list** | `POST /items/csv-import` | ✅ Built earlier (the onboarding path for dispensing divisors). |
| **Open supplier invoices** | — | ⚪ **Not built, and not a blocker.** Open payables are typed through **Finance → Supplier payables → Enter an invoice**. A clinic with thirty open invoices enters thirty; one with three hundred should ask for an importer. |
| **Opening stock balances** | — | ⚪ **Not built, and not a blocker.** The first stock take establishes them, which is the more truthful route anyway: it makes somebody count. |
| **Payroll history** | — | ⚪ **Deliberately not built.** See §5. |

The two ⚪ rows are judgement, not oversight: both have a working manual path,
and an importer nobody needs is a surface that can go wrong.

---

## 3 · The panel claim template

One panel per file — a claim number means nothing without the panel that issued
it, and a mixed file makes every duplicate check ambiguous. The panel is chosen
in the screen, not typed in a column where it can vary row to row.

| Column | Required | Notes |
|---|---|---|
| `Claim No` | ✅ | The reference an argument six months later is conducted in. Also the idempotency key, scoped to the panel. |
| `Service Date` | ✅ | `YYYY-MM-DD` only. `4/11/25` is refused — it is the 4th of November or the 11th of April depending on who exported it. |
| `Patient Reference` | ✅ | Whatever reference the clinic can still trace. Stored as text; Kuwick does not pretend it resolves to a patient record it does not have. |
| `Claimed Amount (RM)` | ✅ | `RM` and thousands separators are accepted, because that is what a spreadsheet exports. |
| `Fee Amount (RM)` | | Blank means zero. The *direction* is not asked for — see §1. |
| `Status` | ✅ | One of `SUBMITTED`, `PARTIALLY_PAID`, `PAID`, `REJECTED`, `WRITTEN_OFF`. Spaces and dashes are tolerated; anything else is a reported problem, not a guess. |
| `Submitted Date` | | Required in effect: money against a claim with no submission date is refused. |
| `Adjudicated Date` | | Refused if it precedes the submission. |
| `Approved Amount (RM)` | | **Blank is not zero.** Blank means the panel has not said; `0` means they refused it all. |
| `Rejected Amount (RM)` | | |
| `Rejection Reason` | | Required on a `REJECTED` row. It does not have to be tidy — it has to exist. |
| `Paid Amount (RM)` | | Required on `PAID` and `PARTIALLY_PAID`. |
| `Paid Date` | | |
| `Remarks` | | |

### The cross-column rules, and the workbook defect behind each

| Rule | The defect it catches |
|---|---|
| A `PAID` claim needs a paid amount | Rows marked paid in the workbook where the money column is blank — the single commonest reason a receivable total is wrong |
| A rejection needs a reason | The commonest gap in the excess register, and what makes *"why do we lose claims"* unanswerable a year later |
| Money needs a submission date | A payment against a claim that was never sent is a data error, not a payment |
| Approved ≤ claimed | A panel cannot approve more than it was asked for |
| Adjudicated ≥ submitted | Dates transposed on entry |
| No duplicate claim numbers | Importing one claim twice doubles the receivable and nobody can tell which row is real |
| No negative amounts | A credit is a separate claim, not a negative one |

---

## 4 · What an imported claim is, and is not

An imported claim is a **real claim** in the same model as every other one. It
appears in the work queue, the reconciliation, the panel dashboard and Finance →
Panel money; its receivable is computed by the same `computeClaimBalance`; a
remittance can be allocated against it.

**It has no invoice**, because the visit happened in the system Kuwick replaces.
Two alternatives were rejected:

- **Fabricating a visit and an invoice** would put invented clinical records in
  a patient's chart. Never.
- **A separate legacy-claim model** would double every read path in the panel
  module, and the two would drift.

So the invariant was not weakened — it was **stated precisely**. It used to be
"every claim has an invoice". It is now *"every claim Kuwick raises has an
invoice, and every claim without one came from a named import"*, and a database
CHECK enforces exactly that:

```sql
CHECK ("invoice_id" IS NOT NULL OR "import_batch_id" IS NOT NULL)
```

What an imported claim therefore **cannot** do:

| Action | Why it is refused |
|---|---|
| **Charge to patient (G-5)** | The money moves from the panel share to the patient share of the same invoice. There is no such invoice, and creating one would be a fabricated bill. The screen says so and suggests raising the patient bill directly. |
| **Appear as ready to submit** | It was submitted through the previous system. It is listed in the submission queue with that as its one blocking reason rather than silently dropped — a claim the queue hides is a claim nobody chases. |

Everything else — adjudicate, re-claim, write off, receive money against it,
count it in the rejection rate — behaves identically.

---

## 5 · Payroll history is deliberately not imported

The payroll workbook stays live after cutover, and importing its history would
imply otherwise.

- **PCB/MTD has no engine in Kuwick**, by decision. Importing historical payroll
  would import PCB figures Kuwick cannot reproduce or check.
- **The statutory rate tables are `CORROBORATED`, not `VERIFIED`** — they came
  from the clinic's own workbook and have been checked against nobody, because
  this environment cannot reach KWSP or PERKESO. A run computed against them is
  `PROVISIONAL` and can only be approved by someone explicitly acknowledging
  that gap.
- A payslip is a **statutory record**. Re-deriving one from a spreadsheet, under
  rates nobody has verified, produces a document that looks official and is not.

The right sequence is: verify the rate tables → run one month in parallel →
reconcile against the workbook (there is already a reconciliation report for
exactly this) → then switch. Not: import two years of history and hope.

---

## 6 · The cutover sequence

Proposed, for the owner to accept or change. What is not negotiable is that each
workbook needs *a* date: a file that is "mostly retired" is a file two people
are still updating differently.

1. **Configure before you import.** Every panel's fee treatment, payment term
   and re-claim window, and every supplier's payment term. An import stamps
   claims from the configuration, so configuration comes first — and a panel
   left `UNCONFIGURED` imports claims whose fee is applied in neither direction
   and says so.
2. **Dry-run the claim file. Compare the totals against the workbook's own TOTAL
   row.** If they differ, the file is wrong or the configuration is — do not
   commit to find out which.
3. **Commit, then reconcile again** on the panel dashboard. The figures must
   match the dry run exactly; they come from the same function.
4. **Record one full remittance cycle in Kuwick** and check it against the bank
   before the workbook stops being written to.
5. **Then, and only then, the workbook goes read-only.**

Rule of thumb for every step: **the workbook is the source of truth until the
day it isn't, and after that day it is a read-only copy.** Never both.

---

## 7 · What is enforced, and where

| Claim | Enforced by |
|---|---|
| A dry run writes nothing | `test/panel-claim-import.e2e-spec.ts` |
| A file with any problem imports nothing, even with `commit` | same |
| Re-running a file does not double the receivable | same |
| A corrected file imports only its new rows | same |
| An imported claim has no invoice, and the DB refuses one with neither | same — including a direct write attempt against the CHECK |
| An imported claim cannot be charged to a patient | same |
| The template the API serves is a file the importer accepts | same |
| Every format and cross-column rule | `src/panel/claim-import-csv.spec.ts` (18 cases) |
| The dry-run totals equal the dashboard's | same spec — the reconciliation is asserted on both sides |
