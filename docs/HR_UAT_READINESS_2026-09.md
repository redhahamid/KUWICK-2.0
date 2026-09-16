# Before you compare Kuwick against a real payslip

`[O]` The account holder asked, before running a full end-to-end UAT against his
clinic's actual payslips: is there anything in HR that is not ready for that?

This is the answer. `[D]` marks what was read in the code, `[A]` an assumption,
`[O]` the owner's own words or decision.

## `[D]` What is solid, so the comparison is worth doing

The four numbers a payslip is argued about are all verified against official
test vectors, which is the strongest state the register has:

| Scheme | Register entry | State |
| --- | --- | --- |
| EPF | `EPF_THIRD_SCHEDULE_2025_10` | `OFFICIAL_TEST_VECTOR_VERIFIED` |
| SOCSO | `SOCSO_ACT4_SKBBK_2025_10` | `OFFICIAL_TEST_VECTOR_VERIFIED` |
| EIS | `EIS_ACT800_2025_10` | `OFFICIAL_TEST_VECTOR_VERIFIED` |
| PCB | `PCB_MTD_2026` | `OFFICIAL_TEST_VECTOR_VERIFIED` |

HRD levy and the Employment Act provisions are `OFFICIAL_SOURCE_VERIFIED` — read
from the source, not reproduced from a worked example.

So a difference against a real payslip is much more likely to be an INPUT
difference than an arithmetic one. The four items below are where the inputs can
differ without anything on screen saying so.

---

## 1. `[D]` A partly tax-exempt allowance will be taxed in full — NOT THIS CLINIC

`[O]` **Checked against five real payslips and it does not reach this clinic.**
"Semua elaun di klinik saya dicukai penuh — tiada elaun yang sebahagiannya
dikecualikan PCB. Yang tidak dikenakan PCB ialah tuntutan (claim
reimbursement), dan itu memang bukan pendapatan, sudah pun komponen berasingan
dalam Kuwick."

`[D]` That is consistent with the catalogue: `CLAIM_REIMBURSEMENT` ships
`pcbLiable: false` outright, which is a different mechanism from an annual cap
and needs none of what follows. **Deferred, not fixed.** The defect below is
real for a clinic that does cap an allowance; it is simply not on the path of
this UAT.

`[A]` Half of the fix was written before the payslips were checked and was then
REVERTED rather than left in. A cap the engine reads with no memory of what the
year has already spent would reset every month and exempt twelve times the
ceiling — worse than not reading it at all. It ships whole or not at all.

### The defect itself, for whoever picks it up


`pay_components.pcbExemptionLimitCents` exists, is editable, is carried onto the
payslip's provenance, and **no calculation reads it.** Confirmed by tracing every
reference: the field appears in the DTO, in the service's field list and in the
list response, and nowhere else.

**What that means for the comparison.** If the clinic's real payroll exempts part
of an allowance from PCB — a childcare allowance, a petrol or phone allowance up
to its annual cap — Kuwick puts the whole amount in the PCB base. Kuwick's PCB
comes out HIGHER, every month, for that employee. Nothing warns about it, because
the field looks set.

**The workaround, if it bites:** split the allowance into two components, one
`pcbLiable` and one not, and enter the exempt portion against the exempt one. That
is a real answer, not a nice one — the cap is annual and somebody has to watch it.

`[A]` I do not know whether this clinic uses any capped exempt allowance. If the
payslips show an allowance whose taxable amount differs from its paid amount, this
is the first thing to check.

## 2. `[D]` The year-to-date loses which pay was "additional remuneration" — FIXED

The component flag `additionalRemuneration` DOES drive the current month: the
calculation splits `pcbAdditional` from `pcbNormal` by it, and the MTD method
receives the split. That part is correct.

**The year-to-date row is written from a hardcoded pair.** When a run is approved,
`additionalRemunerationCents` is stored as
`breakdown.additionalRemunerationCents ?? bonus + incentives` — and the stored
breakdown has no `additionalRemunerationCents` key, so the fallback is what always
runs. A component the clinic marked as additional remuneration contributes to the
month's tax correctly and then vanishes from the year's additional-remuneration
total.

**What that means for the comparison.** Month one matches. Month two onward, the
MTD reads back a year-to-date that is missing that pay, so the tax drifts. Only
bites a clinic that marks something other than Bonus or Incentive as additional
remuneration.

`[D]` **Fixed.** The calculation now writes `pcbNormalCents` and
`pcbAdditionalCents` into the run's own breakdown, and approval reads the real
figure instead of the hardcoded pair. Proven by removing the fix and watching
the test fail the way the defect predicted — RM3,000 of a long-service award
recorded as RM0 for the year — then restoring it. The old fallbacks stay for
rows approved before the split was written down, because nothing recalculates a
settled month and an old year keeps the figure it was filed on.

## 3. `[D]` The EA form's box classification is not driven by the component

`pay_components.eaField` — "e.g. B.1(a)" — is read by nothing, same as above.
Year-end, not monthly, so it does not touch a payslip comparison; recorded here so
it is not discovered during the EA run in January instead.

## 4. `[D]` The untaken-leave payout is entered by hand, and the row stays after you enter it

By design, and the design is deliberate: the run names the amount rather than
adding it, so a final payslip is checked by a person. But the exception fires on
the leave BALANCE, so recording the payout as an input does not clear it. During
UAT it will look like Kuwick has not noticed you paid it.

`[A]` It is INFO and does not block anything, so it is a nuisance rather than a
defect. Worth deciding whether the row should recognise a `LEAVE_PAYOUT` input on
the same run and go quiet — that is a small change and it is not made here,
because "the money was paid" and "an input with that code exists" are not the
same claim, and guessing which one the row means is how the original problem
started.

---

## `[D]` Not a product risk, but it will waste your time

**The browser gate fails four tests on a clean tree**, and has for several pieces:
`admin-hr:21`, `admin-integration:153`, `appointment-module:364`,
`canvas-appointment:40`. All four are the synthetic world ageing — fixture dates
computed in `Asia/Kuala_Lumpur` against a container running UTC, plus a world that
accumulates across runs. Carded in `docs/HR_UAT_FINDINGS_2026-09.md`. None has
ever been a product defect. If a UAT script drives those same flows by hand they
will work.

## `[D]` What this review did NOT check

- The payslip PDF's layout against his clinic's current payslip format.
- Whether the seeded statutory treatment of each of the other components matches
  what his clinic actually does. That is exactly what the UAT is for, and the
  Payroll items screen is where each one is set.
- Anything outside HR and payroll.
