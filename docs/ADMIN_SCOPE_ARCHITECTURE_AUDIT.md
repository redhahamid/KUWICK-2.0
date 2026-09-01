# ADMIN SCOPE ARCHITECTURE AUDIT

**Status:** AUDIT AND PLAN. Nothing in this document has been implemented.
**Written:** Stage 2.5, in response to the owner instruction to make "all branches"
mean *all branches the account is authorised to manage*.
**Verdict:** the fix is a management-wide refactor of authorisation, not a payroll
change. Per the instruction — *"If this requires a management-wide risky refactor:
STOP that subtask and report the implementation plan rather than partially fixing
services"* — this subtask is **STOPPED**, and this is the report.

---

## 0 · Why this document exists

The Stage 2.5 brief referred to "the ADMIN_SCOPE_ARCHITECTURE_AUDIT". No such file
existed anywhere in the repository or its git history. This is that audit, written
from the code rather than from memory of a document that was never written.

---

## 1 · The finding

**Kuwick has two branch-scope systems that mean opposite things by the same column,
and the one that reads like the canonical guard is dead code.**

| | Admin half | Clinical half |
|---|---|---|
| Entry point | `resolveClinicId` / `assertBranchScope` (`apps/api/src/finance/admin-actor.ts:68,84`) | `assertBranchAccess` / `hasBranchAccess` (`apps/api/src/clinical/clinical-authorization.ts`) |
| `Staff.clinicId = null` means | **works across the whole tenant** → allow everything | **authorised for nothing** → deny |
| Backing data | one column, `Staff.clinicId` | `UserClinicAccess`, a real many-to-many |
| Reach | 6 files / 12 call sites | 6 files / 14 call sites (+7 boolean reads) |

`apps/api/prisma/schema.prisma:924-930` documents the permissive reading:

> *"Null means they work across every clinic in the tenant (owner/finance/HR-type
> roles) and still see a clinic picker"*

`apps/api/src/clinical/clinical-authorization.ts:367-381` explicitly contradicts it:

> *"A null home branch does NOT grant access to every branch… Anything else —
> notably a null home branch in a multi-branch tenant — is denied."*

Both are in the codebase today. Which one applies depends on which module the
request happens to land in.

### 1.1 `assertBranchScope` has no external callers

```ts
// apps/api/src/finance/admin-actor.ts:68
export function assertBranchScope(actor: ActingStaff, clinicId: string | null | undefined): void {
  if (!clinicId) return;        // no branch asked for → allow (= every branch)
  if (!actor.clinicId) return;  // actor has no home branch → allow ANY branch
  if (actor.clinicId !== clinicId) {
    throw new ForbiddenException('Your account is scoped to a different branch.');
  }
}
```

Verified: `grep -rn "assertBranchScope" apps/api/src` returns the declaration and
one internal call from `resolveClinicId` (`admin-actor.ts:89`). **Zero services,
zero controllers, zero tests call it.** Three properties matter:

1. **Both guards fail open.** Absent `clinicId` = every branch. Null `actor.clinicId`
   = every branch.
2. **It compares against exactly one id**, so it structurally cannot express
   *"this person manages branches A and C but not B"* — which is the sentence the
   owner asked for.
3. **`stock-transfer.service.ts:50,111,183` hand-rolls the identical fail-open
   comparison** rather than calling it, so the one guard that does exist has an
   independent second implementation.

---

## 2 · Idiom inventory

Counts exclude specs and test harnesses. Verified by grep at the commit this
document was written on.

| # | Idiom | Files | Sites | Validates the caller's branch? |
|---|---|---|---|---|
| A | `resolveClinicId(actor, requested)` | 6 | 12 | Yes, but only against one home branch, and fails open on null |
| B | `assertBranchScope(...)` | 1 | 2 | **Dead** — declaration plus its own internal call |
| C | `params.clinicId ?? actor.clinicId ?? undefined` | 13 | 16 | **No.** Caller's value wins, unchecked |
| D | `...(clinicId ? { clinicId } : {})` | ~15 | ~27 | No. Absent = every branch, by omission |
| E | Nested `{ visit: { clinicId } }` / `{ staff: { clinicId } }` | 9 | 18 | No |
| F | Bare `where: { clinicId }` relying on Prisma's `undefined` | ~14 | ~30 | No, and the "all branches" behaviour is implicit |
| G | `assertBranchAccess(staff, clinicId, ctx)` — clinical, fail-closed | 6 | 14 | Yes |
| H | `hasBranchAccess(...)` boolean | 5 | 7 | Yes |
| I | `assertMayTouchVisit` / `assertMayTouchOrder` — branch from the ROW | 16 | 45 | Yes, and correctly: the branch comes from the record, never from the request |
| J | Hand-rolled `actor.clinicId !== dto.fromClinicId` | 1 | 3 | Partially; fails open |

Idiom **I** is the pattern the rest should converge on: it never trusts a branch
id from the request, it derives it from the record being touched.

Idiom **C** is the highest-risk shape. `requirePermission` authorises the
*action*; nothing authorises the *branch*; and the caller-supplied value takes
precedence over the actor's own.

---

## 3 · What is currently reachable across branches

Every handler below sits behind an action permission and performs **no branch
authorisation**. A staff member whose `Staff.clinicId` is branch A can append
`?clinicId=<branch B>` and receive branch B's data.

**Payroll and HR** — `payrollHome` (`workforce.controller.ts:97`),
`listPayrollInputs` (`:255`), **`materialisePayrollInputs` (`:271` — a write)**,
`today` (`:278`), `listEmployees` (`:286`), `timesheet` (`:339`), `incentiveRuns`
(`:391`), **`calculateIncentives` (`:401` — a write)**, `payrollRuns` (`:423`),
`benefits` (`:504`).

**Finance** — `paymentReport`, `patientReceivables`, `listCreditNotes`,
`taxReport`, `panelMoneyPosition`, `profitability`
(`finance/finance.controller.ts:66,75,119,161,220,233`).

**Stock and inventory** — `exceptions`, `exceptionRows`, `valuation`, `movements`
(`stock/stock.controller.ts:27,32,37,43`); **the whole of
`inventory/stock.service.ts`, which has zero authorisation calls of any kind**,
including the `quickAdd` / `adjust` / `performStockTake` writes.

**Reports** — `reports/reports.service.ts` has **zero authorisation calls**. The
controller passes `clinicId` from the URL straight into Prisma across 11 methods.

**HR attendance** — `hr/attendance.service.ts` likewise: **zero authorisation
calls**, `clinicId` → `where` at line 32.

**Analytics, clinical, appointments** — `overview`, `segmentPl`, `segmentLines`,
room list, doctor schedules, provider shifts, appointment dashboard, message
templates.

There is no central guard. `grep clinicId apps/api/src/**/*.guard.ts` returns
nothing; the only guards are platform-admin and tenant-context.

**Counter-examples that DO validate**, and are the model to follow: all six
`day-end.service.ts` methods, `stock-take.service.ts:54,123`,
`stock-admin.service.ts:43`, `consultation-tariff.service.ts:37,122`, and the
whole clinical note / observation / diagnosis family.

---

## 4 · What already exists to build on

`UserClinicAccess` is a real many-to-many and is the right shape:

```prisma
// apps/api/prisma/schema.prisma:501-512
model UserClinicAccess {
  id       String @id @default(uuid())
  userId   String @map("user_id")
  clinicId String @map("clinic_id")
  role     Role
  @@unique([userId, clinicId])
  @@map("user_clinic_access")
}
```

Three caveats:

1. **It hangs off `User`, not `Staff`.** There is no staff↔clinic join table;
   `Staff.clinicId` is the only staff-to-clinic column.
2. **No service writes it.** The only non-read reference is a preflight checker
   (`apps/api/prisma/clinical-access-preflight.ts`). The one multi-branch grant
   mechanism in the system can currently only be populated by hand in SQL.
3. **`branchContext` exists in four copies** — `clinical-actor.ts:248`,
   `clinical-note.service.ts:71`, `visit-observation.service.ts:89`,
   `diagnosis.service.ts:92` — the exact drift their own file headers warn against.

The comment at `clinical-authorization.ts:380-381` names the deferral honestly:
*"Broader multi-branch access waits for the phase that properly wires
UserClinicAccess."* This document is the plan for that phase.

### 4.1 The web side

`apps/web/src/core/hooks/useClinicFilter.ts` is already close to right: a Zustand
store persisted to `sessionStorage`, `useResolvedClinicId` returning `undefined`
for "all branches", and `useGroupLevel()` keyed on the `settings.manage`
permission rather than on `staff.clinicId` — with a comment (`:58-70`) recording
the correction that *"being a doctor somewhere is not the same fact as being
allowed to manage only that branch."*

Two problems:

* `GET /clinics` (`apps/api/src/core/clinic.service.ts:36`) returns **every clinic
  in the tenant regardless of actor**, so the branch picker offers branches the
  server may then refuse.
* `mayViewAllBranches` is computed (`useClinicFilter.ts:110`) and consumed by
  **zero** components.
* Fifteen components render their own duplicate branch `<Select>` instead of
  using `HubShell`'s.

---

## 5 · Why this is stopped rather than done

Making "all branches" mean "all branches I may manage" requires changing what
`Staff.clinicId = null` means in roughly fifteen admin service files, while it
continues to mean the opposite in six clinical ones. Doing that module by module
produces a system where the same account sees different branch sets depending on
which screen it is on — worse than today's consistent-if-permissive behaviour,
and undetectable without a test that spans modules.

It also touches money. `materialisePayrollInputs`, `calculateIncentives`,
`inventory/stock.service.ts`'s three write paths and the day-end family all read
a branch id from the request. Tightening those without a resolver that every one
of them shares risks a clinic being unable to run payroll or close a till on the
day the change ships — a worse failure than the one being fixed.

Payroll-only changes would be the shortest path and are explicitly **not** taken:
scoping `payrollHome`, `payrollRuns` and `listEmployees` correctly while
`reports.service.ts` still has no authorisation at all would make payroll look
safe and leave the same data readable one screen away.

---

## 6 · The plan

Six phases. Each is independently shippable and independently revertable; none
of them is payroll-specific.

### Phase 1 — One resolver, no behaviour change *(≈1 day)*

Add `apps/api/src/core/branch-scope.ts` exporting one function:

```ts
export interface BranchScope {
  /** The branches this actor may act in. */
  clinicIds: string[];
  /** True when the actor may act tenant-wide. */
  everyBranch: boolean;
  /** A Prisma `where` fragment, so no service writes its own. */
  filter: { clinicId?: { in: string[] } };
  /** Throws if the requested branch is outside the scope. */
  assert(requested: string | null | undefined): string | null;
}
export async function branchScopeOf(tx, actor): Promise<BranchScope>;
```

It resolves from, in order: explicit `UserClinicAccess` rows → `Staff.clinicId`
→ the `settings.manage` permission (tenant-wide). Ship it with unit tests and
**no call sites**. Delete the three duplicate `branchContext` copies in favour of
it. Nothing changes behaviourally; this phase is reviewable in isolation.

### Phase 2 — Make the permissive default explicit *(≈2 days)*

Replace idiom C at all 16 sites with `scope.filter`, configured to keep today's
behaviour: a `settings.manage` holder still gets `everyBranch: true`. This
converts an implicit permissive default into a written-down one and gives every
service a single line to change later. No user-visible change; the regression
risk is confined to query shape, which the existing integration suite covers.

### Phase 3 — Close the unauthorised services *(≈2 days, highest value)*

`reports.service.ts`, `hr/attendance.service.ts` and `inventory/stock.service.ts`
have no authorisation of any kind. Add `requirePermission` plus `scope.assert` to
each. This is a **real security fix**, independent of the multi-branch question,
and should ship first if the phases are reordered.

### Phase 4 — Write `UserClinicAccess` *(≈2 days)*

Add an owner-facing surface under Roles & access: *"Which branches may this person
work in?"* — a checkbox list writing `UserClinicAccess`, audited. Until this
exists the resolver has nothing but `Staff.clinicId` to read, so multi-branch
grants remain impossible to express.

### Phase 5 — Reconcile the two meanings *(≈3 days, the risky one)*

Decide, once, what `Staff.clinicId = null` means, and change the loser. The
recommendation is **fail-closed everywhere** (the clinical reading), with
tenant-wide access coming from an explicit `settings.manage` grant or explicit
`UserClinicAccess` rows — never from an absent value. This is the phase that
needs a migration backfilling `UserClinicAccess` for every existing staff member
so nobody loses access on deploy, and it needs a cross-module integration test
asserting one account sees the same branch set on a payroll screen and a stock
screen.

### Phase 6 — The picker tells the truth *(≈1 day)*

Scope `GET /clinics` to the actor's resolved branch set, consume
`mayViewAllBranches`, and replace the fifteen duplicate `<Select>`s with
`HubShell`'s. After Phase 5 the picker must not offer a branch the server will
refuse.

### Sequencing note

**Phase 3 is a security fix and does not depend on the others.** If only one
phase is authorised, it should be that one.

---

## 7 · What Stage 2.5 did instead

Payroll's own reads (`payroll-journey.service.ts:56`, `payroll.service.ts` list
and calculate) continue to use idiom C and D unchanged. They were not tightened,
because tightening them alone would produce the inconsistency described in §5.
The Stage 2.5 report records this as an open gap rather than as complete.
