# Medication labels

How Kuwick prints a dispensing label, what is on it, and — the part worth
reading before a clinic buys label stock — what has and has not been tested.

Introduced in G4.5d5b-3. See `docs/DECISIONS.md` D-098 for why.

---

## What is on a label

Everything, and only what the record holds:

| Line | Source |
|---|---|
| Clinic name | `Clinic.name` |
| Patient name | `Patient.name` |
| Patient identifier | `Patient.identifierValue`, omitted where absent |
| Medicine and strength | `Item.name`, `Item.strengthMg` — strength omitted where the item does not store one |
| Directions | `Prescription.amount`, `unit`, `frequency`, `durationDays`, verbatim |
| Quantity | `Prescription.quantity` |
| For / Note | `Prescription.indication`, `Prescription.remark`, each omitted where absent |
| Prescribed by | The prescribing clinician on the record |
| Printed | The audit row's own timestamp |
| Visit | `Visit.visitNumber` |
| Dispensed by | Present only once the medication has been handed over |
| Reprint #n | Present only on a second or later print |

## What is deliberately NOT on a label

- **Generic name, dosage form and route.** The schema does not carry them
  reliably. A route printed wrongly on a medication label is a patient-safety
  defect, not a cosmetic gap.
- **Structured warnings** ("may cause drowsiness", "complete the course").
  These are clinical instructions and would need approved wording per drug.
- **A Bahasa Malaysia translation.** It would need approved clinical wording
  and a language field on the record. There is neither.
- **A barcode or QR code.** There is no scan workflow to read one, and a code
  encoding an identifier the rest of the system does not use is decoration on
  a clinical document.
- **A clinic branch line.** `Clinic` stores a name and no separate branch
  label, so the field is omitted rather than invented. It is the one entry
  here that is a schema gap rather than a decision: add `Clinic.branchName`
  and the label picks it up.

An absent field is **absent**. It is never rendered as `For: —`, because a
labelled blank reads as a decision somebody made.

---

## The print preset

```
Format   KUWICK_STD_70x40
Width    70 mm
Height   40 mm
Margin   0
```

Declared in exactly two places, which must agree:

- `apps/web/src/clinical/dispensary/labelPrint.ts` → `LABEL_PRESET`
  (the preview's rendered size and the format string stored on the audit row)
- `apps/web/src/index.css` → the `@page { size: 70mm 40mm; margin: 0 }` rule
  inside `@media print`

To change the stock, change both. Nothing else reads the dimensions.

### What has been tested

The preset has been checked against **the browser's own print preview**, at
1× scale, in Chromium. That is the whole claim.

### What has NOT been tested

- **No thermal printer.** No Zebra, no Brother QL, no TSC, no Epson.
- **No printer SDK, and no silent printing.** Printing calls `window.print()`
  and the user sees the standard browser dialog, chooses their printer and can
  cancel. There is no driver integration and none is planned in this phase.
- **No label stock.** Adhesive-label alignment, feed calibration and gap
  sensing are printer-and-media specific and cannot be verified from a
  browser.

**A clinic must print a test sheet against their own printer and their own
stock before relying on this.** If the alignment is wrong, adjust the two
numbers above rather than the printer.

---

## Printing is not dispensing

Printing a label writes **one row**, in `label_prints`, and nothing else. It
does not:

- move stock or create a stock movement
- change a prescription's status or set a dispensed timestamp
- move the patient's queue ticket
- create or change an invoice line
- take a payment
- complete the visit

This is enforced on the server and verified live: `prisma/g45d5b-dispensary-check.ts`
reads the stock level, the prescription, the queue ticket, the movement count
and the invoice count either side of a real print over HTTP, and asserts every
one is unchanged.

## The audit

`label_prints` is **append-only**: separate SELECT and INSERT policies under
FORCE row-level security, no UPDATE policy, no DELETE policy, and UPDATE,
DELETE and TRUNCATE revoked from the owning role. The application cannot
rewrite a print history through any route — ORM, raw SQL or mistake.

One consequence worth knowing, and it is broader than it first looks: **no
prescription can be hard-deleted by the application role** — not only labelled
ones. `label_prints` references `prescriptions` `ON DELETE RESTRICT`, and
PostgreSQL's referential-integrity check locks the referencing rows, which
needs one of exactly the privileges the migration revokes. Measured, not
assumed: a prescription with **zero** label prints fails the same way, because
the check runs regardless of whether it matches anything. Visits inherit the
same constraint through their own prescriptions.

This costs nothing in production — prescriptions have always been soft-deleted
there (`deletedAt`), and no application route hard-deletes a visit. It does
mean the fixture helpers (`prisma/fixture-support.ts`) soft-close prescriptions
and visits rather than erasing them, including `retireFixturePatients`: it
still deletes clinical detail and uploaded files, but closes and tags the visit
and its prescriptions instead of removing them.

Each row records who printed, under which name, how many copies, the print
sequence and whether it was a reprint. The sequence is allocated inside the
print transaction against a `UNIQUE (prescription_id, print_sequence)`
constraint, so two simultaneous prints cannot both be "the first".

## Copies

One to three. Bounded in the UI, in the DTO, in the service and by a database
`CHECK` constraint — a physical count, and three is the approved maximum.

## Who may print

`PRINT_LABEL` in `apps/api/src/clinical/dispensary-authorization.ts`:
`OWNER_ADMIN`, `FRONT_DESK_CLINICAL_STAFF`, `DOCTOR_RESIDENT`, `DOCTOR_LOCUM`.
`STOCK_STAFF` may view the dispensary but not print — a label is a clinical
instruction to a patient. `FINANCE_STAFF` may do neither.

## Which prescriptions get one

Only clinic-supplied medication: `supplyMode = ONSITE_DISPENSE`, not cancelled.
An external prescription, patient-own supply, a deferred or unconfirmed supply
mode and a cancelled row are all refused with a staff-facing reason. Printing a
label for medication the clinic does not supply would tell a patient the clinic
dispensed something it did not.
