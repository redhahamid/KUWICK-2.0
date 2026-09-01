# PayrollPanda workflow audit — capture plan and findings

**Status: NO OBSERVATIONS RECORDED YET.**

This document has two halves. The second half is empty on purpose.

- **Part A — the capture plan.** What to look at in PayrollPanda, in what order,
  and exactly what to write down at each stop. Written so that one pass through
  the product collects everything `KUWICK_PAYROLL_GAP_MATRIX.md` needs.
- **Part B — findings.** Empty. It stays empty until somebody has actually
  looked at the product. Nothing in this file describes PayrollPanda's behaviour
  today, and nothing should be added to Part B that was not observed.

---

## Why Part B is empty

PayrollPanda is unreachable from the environment this audit runs in. Every host
is refused at the network proxy before a connection is opened:

```
CONNECT www.payrollpanda.my:443     → HTTP/1.1 403 Forbidden
CONNECT payrollpanda.my:443         → HTTP/1.1 403 Forbidden
CONNECT app.payrollpanda.my:443     → HTTP/1.1 403 Forbidden
CONNECT support.payrollpanda.my:443 → HTTP/1.1 403 Forbidden
```

A control host on the same proxy returns `200`, so this is the environment's
egress policy, not a fault. It is the same class of block that stopped
`kwsp.gov.my`, `perkeso.gov.my` and `hasil.gov.my` during the payroll work
(`MALAYSIA_PAYROLL_STATUTORY_SOURCES.md`).

Two separate things are therefore missing, and allowlisting the domain only
fixes the first:

1. **Network reach.** Adding `payrollpanda.my` to the environment's network
   policy would make the public marketing pages and help centre readable.
2. **An authenticated session.** This is a headless cloud container with no
   display, no VNC and no browser anyone can log into. Even with the domain
   allowlisted, the payroll run, the exception queue, the PCB drilldown and the
   payslip cannot be reached from here. Those screens have to be captured by
   someone signed in on their own machine.

**The rule for this file: an entry in Part B must be traceable to a screenshot,
a quoted on-screen string, or a note taken from the product. A plausible guess
about how a mature payroll product probably behaves is not an observation, and
writing one here would defeat the purpose of the audit** — the whole reason for
looking at a competitor is to replace assumption with evidence.

---

## Part A · Capture plan

### Ground rules for capturing

- **Use a demo or test company if the product offers one.** If the account holds
  the clinic's real employees, prefer creating one synthetic employee over
  screenshotting real ones.
- **Redact before saving, not after.** Names, IC/passport numbers, bank account
  numbers, EPF/SOCSO/tax numbers, addresses, and actual salary figures. A blur
  that can be undone is not a redaction — crop or black-box it.
- **Do not submit anything.** No payroll approval on a live company, no bank
  file generation against real accounts, no statutory submission, no payment.
  Everything below is reachable read-only or on a draft.
- **Screenshots go outside the repo** unless they are fully synthetic. Drop them
  somewhere shared and reference them here by description, or paste them into
  the chat. Do not commit anything containing real payroll data.
- **Capture the words, not just the picture.** The exact wording of a validation
  message or a blocking error is the most useful single thing in this exercise,
  and it is what a screenshot of a form does not give you.

### What to record at every stop

For each capability, note these twelve. Where something does not apply, write
"n/a" rather than leaving it out — an absence is a finding.

| # | Field | What it means |
|--:|---|---|
| 1 | Business problem | What breaks if this screen does not exist |
| 2 | Entry point | Where the user starts, and what they must have done first |
| 3 | Required inputs | Which fields refuse to be left empty |
| 4 | Defaults | What is pre-filled, and from where |
| 5 | Validation | What is checked as you type or on save |
| 6 | Calculation | What the system works out for you |
| 7 | Warnings | What it flags but lets you past |
| 8 | Blocking errors | What it refuses to let you past |
| 9 | Approval path | Who signs off, and whether the same person can do both |
| 10 | Audit/history | What is recorded about who changed what |
| 11 | Output | What comes out — screen, file, PDF, export |
| 12 | What happens next | Where the user is pushed afterwards |

**The three highest-value fields are 7, 8 and 5** — warnings, blocking errors and
validation. Kuwick's own strongest work is in exactly this area, and the
comparison worth having is *which mistakes does a mature product refuse to let
you make*. If time is short, capture those and skip the rest.

---

### Stop 1 · Company and legal entity setup

Kuwick has **no employing-legal-entity model at all**, and the two Hijraa
workbooks carry two different company names. This stop is the highest-value one
in the whole exercise.

Record specifically:

- Is there a level above "company"? An account or organisation that owns several?
- What identifies a company: registration number (SSM/ROC), EPF employer number,
  SOCSO employer code, LHDN employer number (`E` number)?
- Can one employee belong to more than one company? What happens if you try?
- Is a branch a separate thing from a company, and does it affect payroll or only
  reporting?
- Are statutory submissions per company, and are reports consolidatable across
  companies?
- Where does the payslip take its letterhead from?

### Stop 2 · Employee master and onboarding

Walk the full add-employee flow with a synthetic person and **stop at each step
to note what it refuses to accept**.

- Which fields block saving, and which merely warn
- Whether a partially-complete employee can exist at all, and how the product
  shows that they are incomplete
- Statutory identifier validation: does it check EPF/SOCSO/tax number *format*?
- Bank details: is the account number validated per bank? Is there a name-match?
- Date of birth: is it required, and does the UI explain why (age 60 rules)?
- Tax profile: marital status, spouse working/not working, number of children,
  and how children are weighted
- Previous employment in the same year (TP3) — where does it live?
- Is there a "this employee is not subject to EPF/SOCSO/EIS/PCB" switch, and what
  does it ask you to justify?

**Note the field names verbatim.** The vocabulary a mature product uses is worth
copying even where the behaviour is not.

### Stop 3 · Pay components

This is the most architecturally important stop after Stop 1.

For the component/pay-item configuration screen, capture **the full list of
independent switches available on a single component**. Kuwick currently models
six (`epf`, `socso`, `eis`, `pcb`, `ordinaryRateOfPay`, `additionalRemuneration`)
and hardcodes them; the question is which ones a mature product exposes as
configuration. Look specifically for:

| Switch | Present? | Notes |
|---|---|---|
| EPF liable | | |
| SOCSO liable | | |
| EIS liable | | |
| PCB taxable | | |
| HRD levy liable | | |
| Counts toward overtime ordinary rate | | |
| Counts toward unpaid-leave base | | |
| Recurring vs one-off | | |
| Employee vs employer component | | |
| Additional remuneration (bonus-type) for tax | | |
| Taxable benefit (BIK/perquisite) | | |
| Reimbursement (not income) | | |
| Prorated on partial month | | |
| Earned period separate from paid period | | |

Also: **can a user create a new component type without vendor involvement?** If
yes, capture the create-component form in full. If no, capture the fixed list.

### Stop 4 · The payroll run, end to end

Run a full draft payroll on the synthetic employee. Do not approve it on a live
company; if the product has a sandbox, approve there.

Capture in sequence:

1. How a period is opened, and whether more than one run can exist per period
   (off-cycle, bonus run, final pay)
2. What the input screen looks like — how allowances, bonus, claims, unpaid leave
   and overtime get in for one month
3. **The review screen.** Especially: is there a comparison against last month?
   Any variance flag on an unusually high or low net pay?
4. **The exception/error list.** Capture every distinct message you can provoke,
   and note for each whether it *blocks* or merely *warns*. Try to provoke:
   missing tax profile, missing statutory number, invalid bank details, negative
   net pay, a duplicate pay item, an employee who joined mid-month, an employee
   who left mid-month, a salary changed mid-period, a backdated adjustment
5. The approval step — who may approve, and can the person who ran it?
6. What locks on approval, and what the product lets you do afterwards
7. The correction path for an already-approved run

### Stop 5 · PCB / tax

Kuwick does not calculate PCB, deliberately. **This stop is to understand the
data model and the workflow, NOT to copy a formula.**

- What the employee-level PCB explanation shows — does it break down how the
  figure was reached?
- Which fields it names as feeding the calculation
- What it does when the tax profile is incomplete
- Whether a manual PCB override is allowed, and whether it demands a reason
- How bonus is treated differently from monthly salary
- Where year-to-date figures appear, and whether they can be edited
- What happens for someone who joined part-way through the year

**Do not transcribe rate tables, brackets or formulas into the repo.** Capture
the *inputs the product demands* and the *shape of the workflow*. Every
statutory value stays `WORKFLOW REFERENCE ONLY` per Part 12 of the brief.

### Stop 6 · Statutory contributions

For EPF, SOCSO, EIS and HRD Corp, note only: which employees the product treats
as eligible, what wage base it says it uses, whether contribution tables are
versioned with effective dates, how it handles arrears or corrections, and what
the export looks like. Again — workflow and data model, not the numbers.

### Stop 7 · Payslip

Capture one payslip in full (synthetic employee). Note which of these are
present, because this is a direct checklist against Kuwick's current payslip:

company/entity block · employee identity · period · payment date · earnings
grouped · deductions grouped · **employer contributions shown separately** ·
**year-to-date columns** · statutory ID numbers · OT hours and rate breakdown ·
leave deduction detail · claims · bonus · net pay · payment method · run status ·
version/revision marker · how the employee receives it

### Stop 8 · Bank and statutory outputs

Look at, do not execute:

- Which banks have a supported file format, and what the export screen asks for
- Whether the payment total is reconciled against the payroll total before export
- What the EPF, SOCSO, EIS and PCB exports are called and what they contain
- Whether the product tracks that a submission was made, and its status

### Stop 9 · Migration and opening balances

The single most useful thing here: **find the employee import template and the
YTD/opening-balance import, and capture their column headers.** That column list
is, in effect, a mature product's answer to "what is the minimum dataset needed
to run correct payroll from mid-year", which is Part 9 of the brief.

### Stop 10 · Error prevention and UX

Capture anything that stops a person making a mistake:

setup checklist or completeness score · unresolved-exception queue · warning vs
blocking distinction · month-on-month comparison · outlier detection · duplicate
detection · lock-after-approval · reason-required-on-override · audit trail
visibility · period close

---

## Part B · Findings

*Empty. Nothing here yet, because nothing has been observed.*

Fill this in per Stop 1–10 above once the product has been looked at. Each entry
should carry the twelve fields, and each statutory or calculation observation
must be labelled:

> **WORKFLOW REFERENCE ONLY** — not verified against an official Malaysian
> source, and not a basis for marking any Kuwick rate set `VERIFIED`.

---

## What this audit must NOT be allowed to do

Carried forward from Part 12 of the brief, and restated here because this file is
where the temptation will land:

- No rate set becomes `VERIFIED` on PayrollPanda's evidence.
- Kuwick's payroll NOT READY guard does not come off because a competitor
  computes something.
- No PCB formula is implemented from observing another product's output.
- Every statutory rule found here is a **hypothesis to check against KWSP,
  PERKESO or LHDN**, never a finding.

The reason is not caution for its own sake. Two products can agree and both be
wrong, and a payroll error is somebody's actual wages.
