# Malaysia HR & Payroll — delivery plan (Phase 2)

Dependency graph, migration classification, backlog and the build/blocked split.
**Nothing here is implemented.** This is the plan the checkpoint asks for.

---

## 1 · The split that shapes everything

Every Tier A authority is unreachable from the build environment (Phase 0 §0).
The brief's rule is then binding: *stop that calculation rule at UNVERIFIED, do
not guess, continue non-statutory work.*

The useful discovery is that **the critical path is not blocked**. The two items
that cannot be retrofitted cheaply — the snapshot decision and the entity model —
both require no statutory source.

```
        ┌─────────────────── NOT BLOCKED ───────────────────┐
        │                                                    │
   LegalEmployer ──┬── EmployeeSalary ──┬── PayrollInput ────┼── Snapshot
        │          │   (effective-dated) │   (Trace A fix)   │      │
        │          │                     │                   │      ├── Reopen + diff
        │          └── PayComponent ─────┤                   │      └── Audit extension
        │              (structure only)  │                   │
        │                                ├── Exception centre │
        │                                ├── Variance         │
        │                                ├── Approval control │
        │                                └── Error visibility │
        │                                                    │
        └── RBAC (11 perms) ── Finance posting ── Reports ────┘
                    │
        ┌───────────┴──────── BLOCKED ON TIER A ─────────────┐
        │                                                     │
   PayComponent flag VALUES        Proration bases (lawful?)  │
   EPF age-75 / citizenship        OT multipliers             │
   SOCSO scheme split              ORP definition             │
   LINDUNG 24 Jam (all)            HRD leviable wages         │
   PCB engine ── needs ── YTD ── needs ── LegalEmployer       │
   TP1 / TP3 / CP38                Final-pay obligations      │
        └─────────────────────────────────────────────────────┘
```

**Read the PCB chain carefully.** PCB needs YTD; YTD needs the employer; the
employer is not blocked. So the *substrate* for PCB can be built now and the
engine dropped in when HASiL is reachable. That is the single most useful
sequencing fact in this plan.

## 2 · Build order

**Stage 1 — foundations (no statutory source needed)**
1. `LegalEmployer` + employee assignment + employer scoping on every payroll read
2. `EmployeeSalary` effective-dated history; calculation resolves by period
3. `PayComponent` table + versioning + seed from today's 15 values, **all flagged
   UNVERIFIED**
4. `PayrollPolicy` with five bases — *structure only; which basis is lawful is
   Stage 3*

**Stage 2 — the run becomes operable (no statutory source needed)**
5. **`PayrollInput` write path** — endpoint, DTO, drawer. *Closes Trace A; the
   run becomes completable.*
6. Upstream materialisation with `source` + `sourceRecordId`
7. Run architecture: `runType`, `sequence`, `paymentDate`, employer-scoped unique
8. `PayrollSnapshot` on approval + hash
9. Reopen with before/after diff
10. Exception centre (3 severities, deep links, override with reason)
11. Approval confirmation + variance panel
12. Error-visibility invariant + its test
13. RBAC to 11 permissions; audit extension

**Stage 3 — statutory (each item gated on its authority)**
14. Re-verify EPF/SOCSO/EIS → `OFFICIAL_SOURCE_VERIFIED`
15. EPF age-75, citizenship, membership category, voluntary
16. SOCSO scheme split, foreign-worker
17. LINDUNG 24 Jam as a distinct scheme
18. HRD Corp with per-component liability
19. `EmployeeYtd` + opening import *(substrate is Stage 2-able; treatment is here)*
20. Tax profile, TP1, TP3, CP38, zakat
21. **PCB engine + official test vectors (hard gate)**
22. Proration/ORP/OT rules confirmed against the Employment Act
23. Final-pay obligations

**Stage 4 — outputs**
24. Payslip additions · 25. Bank export · 26. Statutory exports ·
27. Year-end forms · 28. Finance posting · 29. Reports · 30. Migration templates

## 3 · Migration classification

| Migration | Kind | Risk |
|---|---|---|
| `LegalEmployer`, `PayComponent`, `PayrollPolicy`, `EmployeeYtd`, `PayrollSnapshot`, `PayrollException`, tax-profile tables, `LindungParticipation` | **additive** | low |
| `EmployeeSalary` + backfill from `basicSalary` | **data migration** | medium — must reproduce current figures exactly |
| `PayrollInput` new columns | **additive** | low |
| `PayrollRun` + `legalEmployerId`/`runType`/`sequence`/`paymentDate`, backfill | **data migration** | medium |
| Replace run unique constraint | **constraint-changing** | medium — do after backfill, in its own migration |
| `PayrollException` from the run's JSON blob | **data migration** | low |
| Drop `EmployeeProfile.basicSalary` | **destructive** | **high — last, after a full period on `EmployeeSalary`** |

**Rule: no destructive migration until the additive path has run a real period.**
Only one destructive step exists, and it is deferred to the end.

## 4 · Backlog

### P0 — payroll is wrong or unauditable without it

| # | Item | Blocked? |
|--:|---|---|
| 1 | **`PayrollInput` write path** | **No** |
| 2 | `LegalEmployer` model | **No** |
| 3 | `EmployeeSalary` effective dating | **No** |
| 4 | Immutable approved snapshot | **No** |
| 5 | Proration (joiner + leaver), structure | **No** (lawful basis is P0-blocked) |
| 6 | Exception centre | **No** |
| 7 | Approval confirmation + actor record | **No** |
| 8 | Error visibility | **No** |
| 9 | Audit extension | **No** |
| 10 | `PayComponent` table, structure | **No** (values blocked) |
| 11 | `EmployeeYtd` substrate | **No** (treatment blocked) |
| 12 | **PCB engine + official vectors** | **YES — HASiL** |
| 13 | Verify EPF/SOCSO/EIS | **YES — KWSP/PERKESO** |
| 14 | LINDUNG 24 Jam | **YES — PERKESO** |
| 15 | Termination / final pay | **YES — JTKSM** |

**Eleven of fifteen P0 items are not blocked.**

### P1 — needed before real clinics use it
Run types · reopen + diff · variance · RBAC to 11 · upstream materialisation ·
tax profile/TP1/TP3 · HRD Corp · bank export · statutory exports · Finance
posting · salary/bank/identifier validation · OT tiers wired

### P2 — before selling to other clinics
Reports beyond the register · year-end forms · payslip YTD and OT breakdown ·
onboarding checklist · migration templates · NRIC↔DOB cross-check · earned-vs-paid
period on screen · loan balances

### P3 — later
Employee self-service · claims workflow · employee import · second-approver
threshold · consolidated multi-employer reporting

### Not appropriate for Kuwick
Third-party HR integrations · a second schedule object · full BIK breadth ·
TP1 reliefs as pay items · plan gating · **any API submission to an authority or
bank**

## 5 · The four explicit lists the checkpoint asks for

### (a) Can implement now — no statutory source required

`LegalEmployer` · `EmployeeSalary` · `PayComponent` **structure** ·
`PayrollPolicy` **structure** · **`PayrollInput` write path** · upstream
materialisation with source links · run types and employer-scoped uniqueness ·
`PayrollSnapshot` + hash · reopen + diff · exception centre · approval
confirmation · variance panel · error-visibility invariant · RBAC to 11
permissions · audit extension · `EmployeeYtd` **substrate** · Finance posting
**structure** · reports over existing data · bank/identifier **format**
validation · onboarding checklist · NRIC↔DOB cross-check

**21 items. This is a substantial, coherent programme on its own, and it is
exactly the work that makes payroll operable and auditable.**

### (b) Requires official verification before coding

PCB engine (HASiL 2026 spec + vectors) · EPF age-75, citizenship, membership,
voluntary · SOCSO scheme split, ceiling, foreign-worker · EIS eligibility and
ceiling · **every `PayComponent` flag value** · LINDUNG 24 Jam entirely · HRD
rates, categories and leviable wages · ORP definition · OT multipliers · lawful
proration bases · final-pay obligations · TP1 caps · TP3 form version ·
CP38/zakat treatment · every export file format · Form E/EA/CP8D layouts

### (c) Blocked right now, and by what

| Blocked on | Items |
|---|---|
| `hasil.gov.my` unreachable | PCB, TP1, TP3, CP38, zakat, CP39, Form E/EA/CP8D |
| `kwsp.gov.my` unreachable | EPF verification, age-75, citizenship, membership, EPF wage definition, EPF file format |
| `perkeso.gov.my` unreachable | SOCSO, EIS, **LINDUNG 24 Jam**, PERKESO file formats |
| `hrdcorp.gov.my` unreachable | HRD rates, categories, leviable wages |
| `jtksm.mohr.gov.my` unreachable | ORP, OT multipliers, proration bases, final pay |
| Bank specifications not obtained | Bank payment file |

**Unblocking is not a code task.** It needs either the environment's network
policy widened to those hosts, or a person supplying the official documents.

### (d) Deliberately out of scope

Submission APIs to any authority or bank · multi-currency · union/award
structures · non-Malaysian jurisdictions · reimplementing PCB where the clinic's
accountant files it · competitor feature parity for its own sake

## 6 · What the checkpoint recommends

**Build Stage 1 and Stage 2 now.** They need no statutory source, they close the
finding that payroll cannot complete a run, and they are the substrate every
blocked item lands on. Stage 3 waits for documents, not for engineering.

**Do not remove the NOT READY guard.** Nothing in this plan changes the fact that
no statutory rule in Kuwick has been checked against the authority that publishes
it.
