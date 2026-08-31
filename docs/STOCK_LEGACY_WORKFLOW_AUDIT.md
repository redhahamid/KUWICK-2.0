# The clinic's stock spreadsheets, read directly

Five workbooks were opened programmatically with `openpyxl` and read **as
formulas**. Every rule below is quoted from the cell that computes it.

> **Confidential source material.** The workbooks are **not** committed, not
> copied into this repository, and not used as seed data. No item, supplier,
> price, invoice number or credit limit from them appears here or in any UAT
> fixture. What is recorded is *structure, formula and workflow*. Supplier
> identities and commercial terms are abstracted.

| # | Workbook | Sheets | The job it does |
|---|---|--:|---|
| 1 | Inventory count sheet (meds) | 4 | The physical stock take |
| 2 | List new medication | 2 | Requesting an item that does not exist yet |
| 3 | Que order medication | 12 | The medication ordering queue and its archive |
| 4 | Consumable que order | 8 | The same queue for consumables and admin spend |
| 5 | Medications payable listing | 31 | What is owed to each supplier |

---

## 1 · Inventory count sheet

**Who uses it:** stock controller, during a count.

| Column | Field | Kind |
|---|---|---|
| A–D | No., Inv. code, Type, Item description | manual |
| E | **Unit price** (acquisition cost) | manual |
| F | **Price to patient** (selling price) | manual |
| G | Qty (what the system says) | manual, keyed in |
| H | Total price to patient | `=F*G` |
| I | Total cost | `=E*G` |
| J | **Count** (what was physically there) | manual |

A second, simpler sheet carries No., Type, Item, Unit price, **Qty count**, Date.

### The control weakness

**There is no variance column.** The sheet values the stock the *system*
believes in (`E*G`, `F*G`) and puts the *physical* count in a column beside it,
uncompared. Nothing subtracts one from the other, nothing prices the
difference, and nothing records who counted or who approved. A discrepancy is
found by eye, and what happens next is invisible.

Also: the system quantity is **keyed in by hand**, so the count is being
compared against a transcription rather than against the ledger.

### What Kuwick already replaces

Stock Take does count → submit → **second person approves** → post, with the
variance and its value computed, a reason per line, and the correction landing
on the append-only movement ledger. Typing a count changes nothing until it is
approved — the property this sheet cannot have.

### What Kuwick does not yet replace

- **Selling value alongside cost at count time.** Kuwick's stock take shows cost
  variance; the sheet also shows what the shelf is worth at patient prices.
- **A printable count sheet** to carry round the dispensary.

---

## 2 · List new medication

**Who uses it:** any staff member asking for a new item; the stock admin triages.

`REQUEST LIST` — five columns, and they are the whole workflow:

| Field | Purpose |
|---|---|
| Medication | what is being asked for |
| Reason for request | why |
| Comments | discussion |
| **Stock admin noted** | the approval, such as it is |
| Supplier | where it would come from |

`PRICE LIST` is free text: an item description, a pack-size *sentence*
("*n* strips, 1 box = *m* strips"), a price *sentence* ("RM*x* per strip /
RM*y* per box"), and a column of **hardcoded arithmetic** — literal
`=6.84*90`, `=5.8*20`, `=28*30`. Pack-to-unit conversion is done by retyping
numbers into formulas.

### Control weaknesses

- **Approval is a text note in a cell.** No state, no actor, no date.
- **Pack size and unit price are prose**, so nothing can compute a unit cost.
- One column sums with **`IMSUM`** — Excel's *complex number* sum — used on
  money. It happens to work on reals and is a defect waiting for an argument
  it cannot handle.
- Nothing checks whether the requested item already exists, which is how a
  catalogue grows two entries for one medicine.

### What Kuwick replaces / does not

Kuwick has a canonical item catalogue with cost, selling price, pack size and
supplier as **fields**, and an item create/edit form. It does **not** have a
*request* workflow: there is no way for a nurse to ask for an item and for a
stock admin to approve it into existence. That is the gap this sheet fills.

---

## 3 · Que order medication

**Who uses it:** stock controller, continuously. Twelve sheets: one live queue,
one pending list, one activation queue, and half-yearly archives back to 2023.

`PENDING LIST ORDER` — the *request* stage: order date, medicine, supplier,
quantity, memo.

`QUE ORDER MEDS (period)` — the *order* stage:

| Field | Kind |
|---|---|
| Date, Medicine, Supplier | manual |
| **Status order** | manual free text |
| Quantity ordered | manual |
| Unit price / **Bonus price** | manual |
| Total | `=MIN(unit, bonus) * qty ordered` |
| Invoice date | manual |
| **Received date (max 1 week)** | manual — an SLA in a column heading |
| Quantity received | manual |
| Total received | `=MIN(unit, bonus) * qty received` |
| Complete | manual |
| Invoice link | hyperlink to a scan |

`TO BE ACTIVATED MEDS` — the *item lifecycle* stage: order date, medicine,
supplier, quantity, expiry date, **old price, new price**, stock-in, and four
status columns — *new items not yet activated*, *new items*, *replace items*,
*deactivated items*.

### What this reveals

1. **A request and a purchase order are already different things** in the
   clinic's own practice — two sheets, two stages. Kuwick's model should keep
   them separate, which it does.
2. **`MIN(unit, bonus)` is a real pricing rule**: suppliers quote a list price
   and a promotional price, and the clinic pays the lower. Kuwick has no
   concept of a promotional price.
3. **Ordered vs received, side by side, with both valued** — partial receipt is
   normal, not exceptional.
4. **"Max 1 week" is a supplier SLA** living in a column heading. Nothing
   measures it.
5. **Price changes are tracked at goods-in** (`old price` / `new price`) — the
   moment a cost actually changes is the moment stock arrives.
6. **Items are activated on receipt, not on order.** A new medication exists in
   the catalogue only once it has physically arrived.

### Control weaknesses

- Status is free text, so "ORDERED", "ordered", "order" and "pending" coexist.
- The archive is *sheets by half-year*, so any question spanning a boundary is
  manual.
- Received quantity is keyed against the same row, so an over-delivery or a
  second partial delivery has nowhere to go.

---

## 4 · Consumable que order

**Structurally identical to the medication queue**, minus the bonus price:
order date, item, supplier, qty ordered, unit price, total (`=qty*price`),
received status, invoice date, qty received, total received (`=qty received *
price`), complete, invoice link.

A sibling sheet, **marketing & admin expenses**, has *exactly the same
columns*.

**This is the strongest argument in all five workbooks for a shared
procurement engine.** The clinic already treats medication, consumables and
admin purchases as the same shape of transaction; only the item behaves
differently. Kuwick should have one procurement primitive and let the *item*
carry the difference — which is what the brief asks for and what the existing
`ProcurementRequest` → `PurchaseOrder` → `GoodsReceivedNote` chain already
does.

---

## 5 · Medications payable listing

**Who uses it:** whoever pays suppliers. **One sheet per supplier** — thirty of
them — plus a `TOTAL PAYABLE` roll-up.

Per supplier:

| Field | Kind |
|---|---|
| Month/year | `=TEXT(invoice date, "mmm. yyyy")` |
| Invoice date | manual |
| **"*n* days payment term date"** | `= invoice date + n` |
| **Days due** | `= term date − TODAY()` |
| Invoice number | manual |
| Amount | manual |
| Paid | manual |
| Payment date | manual |
| **Balance** | `=MINUS(amount, paid)` |
| Invoice | hyperlink to a scan |
| Note | free text carrying the **credit limit** |

`TOTAL PAYABLE` rolls up creditor, **term (days)**, payable, total ordered, and
a count of **invoices due in 1–5 days** (`COUNTIFS(days due >0, <6)`).

### What this reveals

- **Payment terms differ per supplier** and are held in *three* places: the
  column *heading* text, the `+n` inside the formula, and a term column on the
  roll-up. Changing a supplier's terms means editing formulas.
- **Credit limits per supplier** are tracked, in a free-text note.
- The clinic distinguishes **invoice amount, paid, balance, payment date** —
  i.e. it is already doing accounts payable, one sheet at a time.
- **"Days due" is negative when overdue** and the roll-up counts the 1–5 day
  window, so the operating question is *"what must I pay this week"*.

### Control weaknesses — one of them material

**The roll-up sums the wrong column.** `TOTAL PAYABLE` computes each supplier's
payable as `SUM('<supplier>'!I…)`. On the supplier sheets, column **I is
PAYMENT DATE**; the balance is column **J**. The headline payable figure is
therefore built from dates, not amounts.

Also:
- Term is duplicated in the heading, the formula and the roll-up.
- `MINUS(a,b)` rather than `a-b` — harmless, but it is a Google-Sheets idiom in
  an Excel file, evidence the workbook has been round-tripped.
- No link from an invoice to the purchase order or goods receipt it belongs to.
  Whether an invoice matches what was actually received cannot be checked.

### What Kuwick already replaces / does not

Kuwick has purchase orders and goods receipts, so *ordered* and *received* are
solid. It has **no supplier invoice, no payable and no supplier payment** at
all. There is no answer today to "what do we owe suppliers", which is the one
question this workbook exists to answer.

---

## What these five workbooks are actually doing

Read together, they are one chain that the clinic has broken into five files
because a spreadsheet cannot hold it:

```
new item request → activation → order request → purchase order
      → partial/full receipt → cost captured → item activated
      → supplier invoice → payable → payment
                    ↘ physical count → variance → adjustment
```

Kuwick holds the middle of that chain properly and both ends barely or not at
all.

| Stage | Kuwick today |
|---|---|
| New item **request** and approval | ❌ missing |
| Item catalogue, cost, price, supplier | ✅ |
| Order **request** | ✅ `ProcurementRequest` |
| Purchase order | ✅ |
| Partial / full receipt | ✅ |
| **Promotional (bonus) price** | ❌ missing |
| **Price change captured at goods-in** | ❌ missing |
| Stock ledger, append-only | ✅ |
| Stock take → approve → post | ✅ |
| **Selling value at count time** | ❌ missing |
| Low stock, expiry, slow moving, valuation | ✅ |
| **Supplier invoice** | ❌ missing |
| **Supplier payable and ageing** | ❌ missing |
| **Supplier payment** | ❌ missing |
| **Supplier credit limit** | ❌ missing |
| **Supplier SLA (days to deliver)** | ❌ missing |

---

## The four errors found, so they are not reproduced

| # | Where | Defect |
|---|---|---|
| **S-1** | Payable roll-up | Sums column **I (payment date)** instead of **J (balance)**. The headline "what we owe" figure is wrong. |
| **S-2** | Inventory count | No variance is computed anywhere. System quantity is also transcribed by hand rather than read from a ledger. |
| **S-3** | New medication price list | Pack size and price are prose; unit cost is hardcoded arithmetic per row. One total uses `IMSUM`, a complex-number function, on money. |
| **S-4** | Order queue | Payment terms, SLAs and statuses live in column *headings* and free text, so nothing can measure or enforce them. |

---

## Recommended target — and what it costs

The brief proposes a Stock structure of Catalogue / Procurement / Inventory /
Control. Kuwick's existing rail is already close, and the honest gap list is
short but not small:

1. **Supplier invoice → payable → payment.** The single largest gap, and the
   only one that leaves a question the clinic cannot answer in Kuwick at all.
   Needs three models, a screen, and a link from invoice to goods receipt.
2. **New-item request workflow**, with a duplicate check against the canonical
   catalogue before anything is created.
3. **Promotional price and price-change-at-receipt**, which is also the
   foundation for moving off standard cost toward weighted average.
4. **Selling value on the stock-take screen**, alongside cost.
5. **Supplier terms, credit limit and delivery SLA** as configuration.

**None of these is implemented in this pass.** They are specified here so the
next one starts from evidence rather than from a menu.
