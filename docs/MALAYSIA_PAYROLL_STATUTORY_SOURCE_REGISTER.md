# MALAYSIA PAYROLL — STATUTORY SOURCE REGISTER

Every calculation-critical rule, the authority behind it, and how far its
verification actually got. Nothing in this file may be upgraded on the strength
of our own tests agreeing with our own formula.

## Verification states

| State | Means |
|---|---|
| `UNVERIFIED` | Implemented from secondary material, or not implemented. No authority consulted for this build. |
| `CORROBORATED` | Two or more independent secondary sources agree. Still not an authority. |
| `OFFICIAL_SOURCE_VERIFIED` | Read against the authority's own current published document, and the document is cited below. |
| `OFFICIAL_TEST_VECTOR_VERIFIED` | The authority's own published test cases run green in CI, at the precision the specification requires. |

No screen, report, payslip or export may imply a state stronger than the one
recorded here. `PayrollRun.statutoryStatus` and the provisional banner are
driven by these states.

---

## BLOCKER — Tier A authorities are unreachable from this environment

**Status: BLOCKED. Owner action required. Nothing was guessed.**

Stage 3 §1 makes official Malaysian authorities the only acceptable source for
calculation-critical rules, and §49 says to stop the affected dependency rather
than guess. Every Tier A domain is refused by this session's egress policy:

| Authority | Domain | Result |
|---|---|---|
| HASiL / LHDN — PCB specification, MTD test questions, TP1/TP3 | `www.hasil.gov.my` | `EGRESS_BLOCKED` |
| KWSP / EPF — Third Schedule | `www.kwsp.gov.my` | `EGRESS_BLOCKED` |
| PERKESO — SOCSO Act 4, EIS Act 800, LINDUNG 24 JAM | `www.perkeso.gov.my` | `EGRESS_BLOCKED` |
| HRD Corp — levy applicability and leviable wages | `hrdcorp.gov.my` | `EGRESS_BLOCKED` |
| Attorney General's Chambers — Employment Act 1955 | `lom.agc.gov.my` | `EGRESS_BLOCKED` |
| JTKSM / MOHR — Employment Act guidance | `jtksm.mohr.gov.my` | `EGRESS_BLOCKED` |

The agent proxy documents this failure class as an organisation policy denial
to be reported rather than worked around, so no mirror, cache or third-party
copy was substituted. A third-party copy would in any case be Tier D evidence
and cannot satisfy a rule the brief requires Tier A for.

### What this blocks

* **PCB / MTD 2026** — the computation specification and the official test
  questions. §16 forbids approximating from brackets, reverse-engineering a
  competitor, or a simplified monthly percentage. **Not implemented.**
* **EPF Third Schedule** — the contribution table rows. §17 forbids
  `wages × 11%` for all salaries.
* **SOCSO Act 4 schedule** — the contribution bands.
* **EIS Act 800 schedule** — the contribution bands.
* **LINDUNG 24 JAM** — rates, phases, eligibility and the contribution base.
* **HRD Corp** — employer applicability and the definition of leviable wages.
* **Employment Act s.60I** — the ordinary-rate-of-pay divisor, and the rest-day
  and public-holiday overtime multipliers.

### What was built instead

The architecture every one of those rules plugs into, so that supplying the
documents is a data exercise and not a re-engineering one:

* Effective-dated, versioned schedules per scheme, each carrying its own
  verification state and citation fields.
* An official-test-vector harness (`statutory-vectors.spec.ts`) that runs
  whatever vectors are registered and **fails while any calculation-critical
  scheme lacks them** — it is red today, by design.
* Per-component statutory-treatment dimensions, so a component's EPF, SOCSO,
  EIS, HRD and PCB liability are separate facts rather than one boolean.
* PERKESO modelled as distinct schemes rather than one `socsoApplicable` flag.

### What the owner needs to supply

For each scheme, the authority's own current document, plus its official test
cases where the authority publishes them:

1. **HASiL** — *Spesifikasi Pengiraan PCB 2026 Menggunakan Kaedah Pengiraan
   Berkomputer* (PDF), and *MTD Testing Question 2026*.
2. **KWSP** — the current Third Schedule contribution table, and the effective
   date of the schedule in force.
3. **PERKESO** — the Act 4 and Act 800 contribution schedules, and the
   LINDUNG 24 JAM contribution schedule with its phase effective dates.
4. **HRD Corp** — the levy rate categories and the leviable-wages definition.
5. **AGC / JTKSM** — Employment Act 1955 Part XII as currently in force.

Either the documents themselves, or an allow-list entry for the six domains
above, unblocks this.

---

## Register

`—` means the row has no implementation yet, because implementing it would
require guessing the rule.

| Rule | Authority | Document | Effective | Version | Implementation | Test | Expected | Status |
|---|---|---|---|---|---|---|---|---|
| PCB monthly deduction | HASiL | *not obtained* | — | — | `statutory.ts` `computePcb` returns `null` | `statutory-vectors.spec.ts` | *awaiting official vectors* | `UNVERIFIED` |
| PCB additional remuneration | HASiL | *not obtained* | — | — | — | — | — | `UNVERIFIED` |
| TP1 deductions / TP3 previous employment | HASiL | *not obtained* | — | — | data model only | — | — | `UNVERIFIED` |
| EPF employee + employer share | KWSP | *not obtained* | — | — | schedule table, no verified rows | `statutory-vectors.spec.ts` | *awaiting Third Schedule* | `UNVERIFIED` |
| EPF age-60 transition | KWSP | *not obtained* | — | — | age branch present, rates unverified | — | — | `UNVERIFIED` |
| SOCSO Act 4 contribution | PERKESO | *not obtained* | — | — | schedule table, no verified rows | `statutory-vectors.spec.ts` | *awaiting schedule* | `UNVERIFIED` |
| EIS Act 800 contribution | PERKESO | *not obtained* | — | — | schedule table, no verified rows | `statutory-vectors.spec.ts` | *awaiting schedule* | `UNVERIFIED` |
| LINDUNG 24 JAM — local voluntary | PERKESO | *not obtained* | — | — | participation model only | — | — | `UNVERIFIED` |
| LINDUNG 24 JAM — foreign mandatory | PERKESO | *not obtained* | — | — | participation model only | — | — | `UNVERIFIED` |
| HRD levy rate + leviable wages | HRD Corp | *not obtained* | — | — | per-component `hrdLiable` dimension | — | — | `UNVERIFIED` |
| Ordinary rate of pay divisor | AGC / JTKSM | *not obtained* | — | — | configurable, clinic policy, labelled as such | — | — | `UNVERIFIED` |
| Rest-day / public-holiday OT multiplier | AGC / JTKSM | *not obtained* | — | — | OT category model, rates configurable | — | — | `UNVERIFIED` |

## Historical versions

A payroll run freezes the statutory version it used. A later correction to a
schedule cannot change what an already-approved run computed, and the register
above records the version, not merely the current rule.
