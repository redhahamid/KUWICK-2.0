# HR UAT, September 2026 — findings, decisions and the work order

The owner ran the HR/payroll cycle end to end on staging against the
`Klinik Contoh (UAT)` world: create → calculate → approve → pay → payslip →
portal. **The full cycle succeeded.** Seventeen findings came out of it.

This is the backlog of record for the pieces that follow. `[D]` marks what was
read in the code, `[A]` an assumption, `[O]` an owner decision.

## The order, agreed

| # | Piece | Contains |
|---|---|---|
| 1 | **Punches** | Finding 1, and finding 12 rides with it |
| 2 | **Component statutory treatment** | Finding 17 |
| 3 | **HR permissions** | Finding 2, and finding 5 rides with it |
| 4 | **Settings that do nothing** | Findings 7, 8, the ORP divisors below, **and a full audit** |
| 5 | **Payslip and export output** | Findings 13, 14, 16 |
| 6 | **Payroll run DRAFT state** | Finding 6 is inside this; already carded |
| 7 | **Portal on a phone** | Finding 4 |
| 8 | **Periodic threshold mode** | Finding 10 — `docs/HR_PIECE4_PERIOD_THRESHOLD.md` |

`[O]` Seventeen findings, eight pieces. Findings 12 and 5 are not separate work:
12 touches the same file as piece 1 and must be rewritten once punches become
rows; 5 is in `ClaimsPage.tsx`, which piece 3 already opens.

`[O]` Piece 2 sits above piece 3 because a permission gap has a complete
workaround — the owner does everything — and a wrong statutory flag does not:
it reaches KWSP and LHDN under the clinic's own employer number.

## Withdrawn

- **Finding 15, net in words.** `[O]` Withdrawn by the owner. The hyphen is
  present; it wrapped in the PDF and was lost on copying. `[O]` **The Malaysian
  cheque form stays as it is** — *"Ringgit Malaysia … and sen … only"*. It is
  not to be changed to the English word order.
- **Finding 9, proration.** `[O]` Withdrawn — it came from reading documents,
  not from an observed payslip. `[D]` s.18A proration is implemented and used:
  `prorationFor` → `proratedBasicCents`, with the days-in-period divisor, and
  `PART_MONTH` says so on the run.

`[O]` In its place, piece 4 takes the finding that turned up while checking it.

## Piece 2 — the statutory treatment this clinic needs

`[O]` The clinic's required treatment, to be settable rather than hardcoded:

| Component | EPF | SOCSO | EIS | PCB |
|---|---|---|---|---|
| Procedure incentives | ✗ | ✓ | ✓ | ✓ |
| Commission / other | ✗ | ✓ | ✓ | ✓ |
| Allowance | ✗ | ✓ | ✓ | ✓ |
| Attendance allowance | ✗ | ✓ | ✓ | ✓ |
| Overtime | ✗ | ✓ | ✓ | ✓ |
| Locum (own employee) | ✗ | ✓ | ✓ | ✓ |
| Director's fee | ✗ | ✗ | ✗ | ✓ |
| Mileage / travelling | ✗ | ✗ | ✗ | ✗ |

`[O]` **EPF ✗ throughout is this clinic's own choice** — they contribute on
basic pay only. It is not a claim about Malaysian law, and **Kuwick must keep
warning where its own opinion differs**, the way the EPF basis warning already
does.

`[O]` SOCSO reference given by the owner: perkeso.gov.my lists overtime,
commission, and incentive / shift / meal / cost-of-living / housing allowances
as wages; travelling claims are excluded.

Both fixes are wanted, not one: (a) the account holder may edit a built-in
component's switches, with a mandatory reason and an effective date, versioned
the way an employee's statutory standing is; (b) a clinic may create its own
components with free switches. Kuwick's catalogue becomes a recommendation.

`[D]` The screen's own footnote, under the component list on
**Settings ▸ Payroll items**, already concedes the problem:

> No statutory treatment on this page has been checked against KWSP, PERKESO,
> LHDN or HRD Corp. These flags reproduce what the payroll engine already did;
> they are not a statement of Malaysian law.

`[D]` So does `apps/api/src/workforce/pay-component-catalogue.ts`, whose header
states every row ships `DRAFT` and that the file "does not assert that any flag
is correct". Kuwick locks a treatment it declines to stand behind.

## Piece 3, after staging — the role was right and nobody held it

`[O]` The owner tested piece 3 on staging and found the clinic manager still
unable to press Approve: Leave and Claims opened, Payroll was correctly refused,
and every Approve and Reject button was dead.

`[D]` **The role was never the problem.** `CLINIC_MANAGER` carries
`hr.leave.approve` and `hr.claim.approve`, the guards enforce them, and a real
sign-in publishes them. Rohana Yusof simply was not a clinic manager: her role
is set in the BASE seed (`seed-admin-uat.ts`), which the seed workflow skips
whenever **Rebuild the demo tenant** is unticked — which the owner unticked
deliberately, to keep the testing a rebuild would have destroyed. She stayed
`HR_STAFF`, a records clerk, which approves nothing by design.

`[D]` **Reproduced exactly**: setting her back to `HR_STAFF` locally gives a
login payload of three permissions — `hr.view`, `hr.employee.manage`,
`hr.attendance.manage` — and no approval of any kind. That is the dead button.

`[D]` **Why the tests did not catch it.** Every test in
`clinic-manager-permissions.e2e-spec.ts` minted its own bearer with the role
already in it — the file's own comment says so: *"The role rides in the token,
so the bearer has to be minted with it."* They proved that GIVEN the role the
endpoints behave. Nothing asserted that any account HOLDS the role, and nothing
went through `/auth/login`, which is where the browser gets the
`staff.permissions` array that `useCan` uses to enable the button. Two links in
the chain had no test at all.

`[D]` Fixed in two places: step 2 of the HR seed (which always runs) now asserts
the jobs the seed claims its accounts hold and reports any it repaired; and two
e2e tests now hire a clinic manager through the real endpoint, sign in as them,
and read the published array.

### `[A]` The gap underneath it, which is not fixed

`[D]` **An existing employee's role cannot be changed anywhere in the product.**
`staff.role` is written in exactly two places — creating an employee
(`POST /workforce/employees`) and provisioning a tenant. `upsert-employee.dto.ts`
has no `role` field, and Settings ▸ Roles assigns SystemRoles and custom roles,
not the legacy `Role` column that `CLINIC_MANAGER` lives in.

`[A]` So a clinic can hire a clinic manager, and cannot promote one. The nurse
who takes over running the floor has to be re-created as a new employee. `[O]`
This needs the owner's decision, not mine: role editing changes who may approve
leave, claims and overtime, and probably deserves a stronger permission than the
one that edits an address.

## Piece 4 — settings that do nothing, and the audit

Three known members:

1. `[D]` **"Overtime must be approved"** changes nothing. Every pricing branch
   gates on the day's own `overtimeApproved`, and nothing sets it but the
   explicit approve action.
2. `[D]` **The payroll cut-off day** is promised by the Settings card's
   description and has no field on any screen.
3. `[D]` **The ORP divisors.** `PayrollRun.orpOvertimeDays`,
   `orpUnpaidLeaveDays` and `orpHoursPerDay` are **only ever read, never
   written**, so every run uses the schema defaults 26 / 31 / 7.5. The rule
   set's own `salaryProrationBasis`, `overtimeDays`, `unpaidLeaveDays`,
   `overtimeHoursPerDay`, `leavePayBasis` and `terminationBasis` are stored,
   shown in Settings, and never applied. For this clinic the defaults happen to
   be the right numbers, which is what makes it dangerous rather than harmless.

`[O]` **Before this piece closes, audit every HR setting**: for each field that
can be set anywhere in Settings, establish whether the engine reads it, and
report the dead ones. The owner expects more than these three.

`[D]` **The audit is done** — `docs/HR_SETTINGS_AUDIT_2026-09.md`. Fourteen dead
fields, one half-live, one promised with no field at all. There was indeed more
than three, and one is new to everybody: **`LeavePolicy.carryForwardDays` caps
nothing** — no rollover job exists, and the manual balance adjustment it would
have to constrain never consults it. The audit also **corrects two fields I
first reported dead in error** (`overtimeMinimumMinutes`,
`overtimeRoundingMinutes`); both are live and reach pay.

`[D]` **The build half is partly done.** The five dead fields a clinic can
actually SEE now carry a "Not applied" mark, and two false claims were removed:
the "Overtime must be approved" switch said that turning it off pays unapproved
extra time (it does not — approval is required either way), and the Payroll
policies card promised a cut-off day that exists nowhere.

`[D]` **Still open in piece 4**, and each is the owner's decision because it
changes pay or the API:

- **None of the fourteen was made live or deleted.** Applying one changes what
  somebody is paid. `[O]` needed, one field at a time.
- **The nine API-only fields** have no screen to mark. Implement or withdraw.
- **The ORP divisors** (`orpOvertimeDays`, `orpUnpaidLeaveDays`,
  `orpHoursPerDay`) are still read-never-written; every run uses 26 / 31 / 7.5.
- **The cut-off day** is no longer promised, but still does not exist.

## Also settled during UAT

- `[D]` **`payableMinutes` is dead.** `computeAttendance` derives it from
  `unpaidBreakMinutes` / `breakAfterMinutes` and nothing reads it. Both fields
  save, display, and change nothing. It belongs to piece 1, not piece 4,
  because a clinic that punches its breaks may not want a flat deduction at
  all — see that piece.
- `[D]` **Finding 16 is partly demo data.** The payslip does read `epfNumber`,
  `socsoNumber`, `taxNumber` and `identifierValue`; the seeded employees simply
  have none. The decision the owner asked for still stands: does a payslip
  refuse to issue without the KWSP and PERKESO numbers, or print with a
  warning?
