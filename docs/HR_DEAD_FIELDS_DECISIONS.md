# The fourteen dead fields — one decision each

`[O]` The owner asked for the audit's fourteen dead fields as one table: the
field, what it was meant to do, and what changes if it is switched on. **Nothing
here is switched on without an answer**, with the three exceptions named below,
which the owner ordered by name in the same message.

`[D]` marks what was read in the code, `[A]` an assumption.

## Read this column first

**"If it went live"** is the only column that costs anything. A dead field is
harmless while it stays dead; the risk is entirely in the switching on, and it
is not the same size for each. Three shapes:

- **Pays somebody differently.** The number enters an arithmetic that produces a
  payslip. Getting it wrong is a wrong payment and a wrong statutory remittance.
- **Refuses something that used to work.** A cap or a rule that now binds.
  Nobody is paid wrongly; somebody is stopped, possibly mid-task.
- **Changes nothing today.** This clinic's value already equals what the engine
  hardcodes, so switching on is a no-op *here* and a real change for the next
  clinic that sets it differently.

## Ordered by consequence

| # | Field | What it was meant to do | If it went live | Status |
|---|---|---|---|---|
| 1 | `salaryProrationBasis` | Whether a part-month salary divides by calendar days or a fixed 26 | **Pays differently.** A joiner or leaver's first and last month changes. Calendar vs 26 can differ by hundreds of ringgit on one payslip | waiting |
| 2 | `salaryProrationDays` | The divisor when the basis is fixed days | **Pays differently.** Same population as #1 | waiting |
| 3 | `overtimeBasis` | Whether the ordinary rate divides by calendar days or fixed days | **Pays differently.** Every overtime hour, rest day and public holiday | waiting |
| 4 | `overtimeDays` | The divisor for the ordinary rate (s.60I) | **Pays differently** — and the Act caps it: above 26 underpays every overtime hour, which the run already refuses | **live now** (ORP piece) |
| 5 | `unpaidLeaveBasis` | Whether an unpaid day divides by calendar days or fixed days | **Pays differently.** Anyone with unpaid leave | waiting |
| 6 | `unpaidLeaveDays` | The divisor for one unpaid day | **Pays differently.** Same population as #5 | **live now** (ORP piece) |
| 7 | `leavePayBasis` | How a paid leave day is valued | **Pays differently**, on any month with paid leave valued separately from salary | waiting |
| 8 | `leavePayDays` | The divisor for #7 | **Pays differently.** Same as #7 | waiting |
| 9 | `terminationBasis` | How a final settlement is valued | **Pays differently**, on the one payslip nobody gets a chance to correct | waiting |
| 10 | `terminationDays` | The divisor for #9 | **Pays differently.** Same as #9 | waiting |
| 11 | `carryForwardDays` | How many unused annual leave days may carry into next year | **Refuses something.** A carried-in figure above the cap stops being accepted | **live now** (leave piece) |
| 12 | `overtimeRequiresApproval` | Off should mean recorded extra time reaches payroll unapproved | **Pays differently, and in the dangerous direction** — turning it off would pay extra time nobody agreed to. See the warning below | waiting |
| 13 | `unpaidBreakMinutes` | Minutes deducted from a long shift as an unpaid break | **Pays differently** wherever overtime is priced from worked minutes | waiting |
| 14 | `breakAfterMinutes` | The shift length at which #13 starts applying | **Pays differently.** Same as #13 | waiting |

`[D]` **`overtimeHoursPerDay` is not in the fourteen** because it was never
fully dead: it moves the First Schedule shortfall warning on the Settings screen
and prices nothing. The ORP piece makes it price the ordinary rate too, so it
stops being half a field.

## Three notes the table cannot hold

`[A]` **#12 is the only one where "switch it on" is the wrong question.** The
other thirteen are dead because nobody wired them up. This one is dead because
the safe direction was implemented and the unsafe direction was not: approval is
required whatever the switch says. Making it obey would give a clinic a way to
pay extra time that no second person ever agreed to. `[A]` My recommendation is
to **delete the switch rather than honour it**, and say in Settings that
approval is always required — but that is the owner's call and it is the one
field where I would argue for removal over implementation.

`[D]` **#1–#10 are ten fields and about four decisions.** Each basis and its
divisor move together, and proration, overtime, unpaid leave, leave pay and
termination are five independent questions. Deciding them as five pairs is less
work than deciding them as ten fields, and less likely to leave a basis pointing
at a divisor nobody looked at.

`[O]` **Nothing in this clinic's own numbers changes for #4, #6 or #11 today.**
The values already match what the engine hardcodes — 26, 31 and the cap nobody
had exceeded. That is precisely why they were invisible for so long, and why the
next clinic is the one at risk.

## `[D]` What is still promised and absent

The **payroll cut-off day** (finding 8). No field, no column, nowhere. The
Settings card no longer claims it.

## `[D]` What is still not built

**No year-end leave rollover exists.** `carryForwardDays` now caps what a manual
balance adjustment may carry in, which is the only way days get carried in
today. Nothing walks December's balances into January by itself. That is a
separate feature, and until it exists the cap binds a human's typing rather than
a job's output.


---

# ANSWERED — the account holder's decision, 16 September 2026

`[O]` All six questions answered in one message. **Ten fields deleted, two kept
for a feature to be built.** Nothing was switched on.

| Field | Decision | Why |
| --- | --- | --- |
| `salaryProrationBasis` | **deleted** | ss.18A and 60I(1)(c) fix a part month at the actual days in it |
| `salaryProrationDays` | **deleted** | same |
| `unpaidLeaveBasis` | **deleted** | s.18A names leave without pay expressly — actual days |
| `unpaidLeaveDays` | **deleted** | same, and see the correction below |
| `overtimeBasis` | **deleted** | s.60I(1A) fixes 26; the only lawful variation is a divisor BELOW it, which the clinic already controls |
| `leavePayBasis` | **deleted** | paid leave is not valued apart from salary, and the owner does not want it to be |
| `leavePayDays` | **deleted** | same |
| `overtimeRequiresApproval` | **deleted** | a switch with one position; honouring the off position would pay extra time nobody agreed to |
| `unpaidBreakMinutes` | **deleted** | this clinic punches its breaks, so a flat deduction takes the same hour twice |
| `breakAfterMinutes` | **deleted** | same |
| `terminationBasis` | **kept** | the one question the Act leaves to the employer |
| `terminationDays` | **kept** | same |

`[O]` **On the two kept:** "Kiraan pampasan tamat kerja: YA, saya perlukan ini.
Bila staf berhenti saya perlu kira gaji akhir dan cuti tahunan yang belum
diambil." A feature to build, not a switch. **Nothing has been built**, and the
owner asked for scope and size before anything starts.

`[O]` **On the breaks:** "klinik saya PUNCH waktu rehat: staf clock out masa
rehat dan clock in balik." Settings now says so in words where the two boxes
used to be.

## `[D]` The correction this table needed

**`unpaidLeaveDays` was reported LIVE in the row above, and it never was.** The
ORP piece made it settable in the drawer and froze it onto every run as
`orpUnpaidLeaveDays`, and `payroll-calculation.ts` reads it nowhere — the
interface marked it `@deprecated` and the comment said s.18A leaves nothing to
configure. Two things were saying otherwise on screen, and both are now fixed:

* the rule set drawer's help text, which read "A day of unpaid leave is the
  salary over its own divisor, which is calendar days for most clinics";
* the **unpaid leave report**, which printed "monthly salary ÷ 31. Clinic
  policy, frozen on this run" over a figure that priced nothing. It now names
  the month's own length and s.18A.

It is the same defect this whole audit began with — a screen claiming a control
the engine never had — reintroduced by the piece that was meant to end it.

## `[D]` What the deletion cost

Nothing that was ever obeyed. Every one of the ten was read by no calculation,
which is what made them dead fields in the first place. The migration is
`20260916090000_drop_settings_the_act_already_decided`; historical payslip
snapshots are JSON and keep whatever they already hold.
