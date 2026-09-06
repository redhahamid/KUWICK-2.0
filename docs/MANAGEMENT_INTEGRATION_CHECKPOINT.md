# Management integration checkpoint

The record of converging Operation, Stock, Panel, HR, Payroll and Finance into one Management build,
validating it, and preparing it for owner UAT.

**Convergence SHA:** see §9 · **Payroll checkpoint honoured:** `393ebb9` is an ancestor of this build ·
**Screenshots:** `docs/management-integrated-uat/` (43) and `docs/payroll-final-uat/` (46) ·
**Owner guide:** `docs/KUWICK_MANAGEMENT_A_TO_Z_USER_UAT_GUIDE.md`

---

## 1 · Source branches and SHAs

Established from git history rather than branch names — the full working is in
`docs/MANAGEMENT_CONVERGENCE_SOURCE_MAP.md`.

| Domain | Branch | SHA at convergence | Last domain change |
| --- | --- | --- | --- |
| HR + Payroll | `claude/kuwick-malaysia-payroll-prod-7vfncl` | `393ebb9` | `393ebb9` · 2026-09-05 |
| Finance | same trunk | `393ebb9` | `ea91714` · 2026-09-05 |
| Stock | same trunk | `393ebb9` | `064683e` · 2026-09-01 |
| Panel | same trunk | `393ebb9` | `fbc29e3` · 2026-08-31 |
| Operation | same trunk | `393ebb9` | `2efa2fd` · 2026-08-30 |

**The finding that shaped this work: there was nothing to merge.** Every in-scope branch — `master`
included — is already contained in `393ebb9`. The hinted `claude/{finance,stock,panel,operation}-production`
branches do not exist. The Management domains were built on one trunk, and `393ebb9` is its tip.

Two branches carry commits this build does not, and both were excluded with reasons:

- `claude/kuwick-2-0-scope-c8h2op` (185 commits) — **no common ancestor** with the trunk, tip three weeks
  older, and its API tree has no `finance`, `panel`, `stock`, `workforce`, `statutory` or `analytics`
  module at all. Merging an unrelated older root would have destroyed work and gained nothing.
- `claude/management-manual-uat-guide-hemt2h` (1 commit, docs only) — 2,178 lines of Management manual
  written against `master` *before* the 103 commits of Payroll hardening. Its Payroll chapters describe
  superseded behaviour. Superseded by the guide written against the running build.

## 2 · Conflicts and how they were resolved

None arose, because no cherry-picking was performed. That is a result rather than luck: the domains share
one Prisma schema, one migration line, one tenant/branch scope, one RBAC model, one audit trail and one
Administration shell **because they were developed on one trunk**. There was no second source of truth to
reconcile and no opportunity to restore an older, less-hardened implementation while resolving a merge.

## 3 · Architectural decisions recorded here

1. **Convergence is a fast-forward, not a merge.** `master` is a strict ancestor of the converged build, so
   bringing it up to date only adds commits. Nothing is rewritten, nothing deleted, no force push.
2. **Each module owns its own truth; the others consume it.** Panel owns the claim position, Payroll owns
   the approved payroll summary, Stock owns the movement ledger, Finance owns invoices and payments,
   Operation owns nothing and recomputes nothing. Verified in §5.
3. **The A–Z guide is written against the running build**, screen by screen, not against a specification.
4. **The Management walk is itself a smoke test.** `prisma/management-uat-shots.ts` fails any route that
   renders an error boundary or a near-empty body and reports every console error, so the evidence pack
   cannot be produced from a broken build.

## 4 · Migrations

126 migrations, one linear line, applied cleanly to a disposable PostgreSQL 16 database and to the test
database used by the integration suite. The newest is
`20260906090000_employee_contribution_basis` (the employer-selected EPF basis).

- No migration was rewritten. The one added this cycle was re-issued **before** it had ever been applied
  anywhere but locally, and only to change an index from unique to non-unique.
- Row-level security is enabled and **forced** on every tenant-scoped table, including the new one.
- Append-only enforcement (trigger + REVOKE) covers payroll snapshots, lines, runs, adjustments and
  `audit_logs`.
- `prisma migrate deploy` runs at container start (`start:prod`), so a deploy migrates itself.

## 5 · Cross-module reconciliation

Re-added from outside the codebase over the HTTP API
(`scratchpad/reconcile-management.py`, conversation-side), on the seeded integrated period.
**19 checks, 0 failures** on the pristine owner world; **22 checks, 0 failures** with a payroll month
approved.

| Check | Result |
| --- | --- |
| Panel: received + outstanding + rejected + written off = expected + over-recovered | ✔ balances exactly |
| Panel: unconfigured fee treatments are **not** applied to the receivable | ✔ RM10.00 across 2 claims held back and flagged |
| Payroll → Finance: the contract carries exactly the **approved** runs | ✔ 0 when calculated, 1 when approved |
| Payroll → Finance: net pay and employer cost match the run's own lines | ✔ to the cent |
| Payroll → Finance: figures are served only from a **VERIFIED** snapshot | ✔ |
| Stock: every movement has a type and a signed quantity | ✔ 44/44 |
| Stock: dispensing is one negative movement per prescription line | ✔ 20 dispensing movements, no duplicates |
| Stock: valuation states its costing method | ✔ STANDARD_COST, stated on screen |
| Operation: new + returning = patients; sources sum to visits | ✔ |
| Payroll: run totals equal the sum of their lines; no duplicated input component | ✔ |
| Finance: collected + panel-covered never exceeds billed | ✔ |

**Five apparent mismatches were investigated and every one was a correct behaviour, not a defect.** They
are recorded because a future reader will hit them too:

| Apparent mismatch | Truth |
| --- | --- |
| `claimed − fees ≠ expected receivable` (RM10 out) | Fee **direction** matters. 6 claims withheld (RM57.20) reduce the receivable; 2 claims are **UNCONFIGURED** (RM10.00) and Kuwick refuses to guess a direction, so it applies nothing and flags them |
| `approved − received ≠ outstanding` | Wrong identity. Panel's own is `received + outstanding + rejected + written off = expected + over-recovered`, and it balances exactly |
| Operation revenue RM1,114.50 vs Finance sales RM1,116.10 | Different questions: Operation sums **billed value of visits in the period**; Finance sums **paid invoices by payment date** |
| Finance `cash + panel ≠ total` (RM40 out) | Billed is not collected. One invoice carries a RM40.00 **refund** |
| "44 movements with no cause" | The reconciliation script read the wrong field names |

## 6 · Defects found and fixed this cycle

| # | Severity | Defect | Fix |
| --- | --- | --- | --- |
| 1 | **UAT-blocking** | **Stock could silently hide a whole branch's stock.** The exception board keyed rows on `batchId ?? itemId`, but slow-movers are one row *per item per branch* — the same discontinued item at two branches produced two rows with one React key, and React is free to omit one. RM95 of stock at the second branch could vanish from the board without a word | The row key now carries item, branch **and** batch |
| 2 | UAT-blocking (same screen) | Those two rows were also **indistinguishable**: the slow-movers projection returned `clinicId` but no branch name, so the branch column had nothing to render | The projection now joins `clinics` and returns `clinicName`; the column appears |
| 3 | **UAT-blocking, and materially misleading** | **Finance reported five unclosed days as none.** `GET /finance/day-end/open` resolved its branch with `scope.require()`, which refuses when more than one branch is in scope and none is named. The Finance overview opens on *All branches*, so on this two-branch clinic the call 404'd with `No branch selected for this request.` The screen then did two wrong things at once: it painted a red *"This page could not load its figures — every number below is missing rather than zero"* banner over five figures that had loaded perfectly (received, patient receivable, panel receivable, service tax), **and** it drew the failed list as an empty one — the tile read **"Unreconciled days: 0 · Every day closed"**, in green, while **five** days stood unclosed across the two branches (RM84.80 at Contoh Bandar; RM200.00, RM101.40, −RM60.00 and RM190.80 at Contoh Central) | The **listing** is now a group question and the **closing** stays a branch act. `openDays` (and `listRange`) span the branches in scope and name the branch on every row, keyed by branch **and** date so one branch closing the 3rd cannot strike the other's 3rd off the list. `view`/`count`/`close`/`reopen` still require exactly one branch, because a drawer is physical |
| 4 | UAT-blocking (same root cause) | **Day-End Closing offered to close a drawer it could not see.** On *All branches* the same refusal reached the closing screen, which rendered the red banner **and** an enabled "Close the day" button over a fabricated RM0.00 expected total | The screen now asks which branch, and fires no request until it has one. A branch named in the URL (from the overview's *Close this day*) wins over the header filter, and the branch appears under the title so nobody counts the wrong drawer |
| 5 | Test-fixture drift (not a product defect) | The Admin integration spec asserted a **"Roles & access" sub-tab** that was deliberately removed from the HR rail on 2026-09-01 (`75ac9f0`) — the rail is the monthly payroll walk, and the screen is still mounted and still reached from Payroll settings. The fixture was describing a rail that no longer exists | The route moved to a new `ADMIN_LINKED_ROUTES` list with a test that asserts what is actually true: the rail is intact, the **HR module** is lit, the screen draws, and the link from Payroll settings still reaches it |

Defects 1–2 were found by the Management walk's own console-error capture, proven against the API and the
database (18 units at Contoh Central, 10 at Contoh Bandar), fixed, and re-walked: **0 duplicate-key
warnings**.

Defects 3–4 were found by reading frame 28 of the pack — a red banner sitting above correct figures — then
probed endpoint by endpoint (`/finance/day-end/open` and `/finance/day-end` 404; `/finance/receivables/patients`,
`/finance/panel-money`, `/finance/tax/report`, `/finance/payments` all 200), traced to
`apps/api/src/core/branch-scope.ts` `require()`, and fixed. The Administration Playwright suite had
independently caught the same two screens (`admin-shell.spec.ts:17` and `admin-integration.spec.ts:110`);
both are green now. Regression coverage: `finance-payments-dayend.e2e-spec.ts` — *"lists every branch's
unclosed days, and closing one branch's day leaves the other's standing"* — asserts one row per branch per
day, that naming a branch narrows it, and that closing one branch's day does not strike the other's off.

The raw-SQL branch clause was duplicated in `stock-admin.service.ts`; it now lives once in
`core/branch-scope.ts` as `branchClause()` and both callers use it. Two copies of "which branches may this
read see" is how two screens end up disagreeing about whose money they are showing.

Everything else the walk reported was antd library deprecation noise (`Drawer width`, `Button.Group`,
`Space direction`, `Statistic valueStyle`) — invisible to the owner and out of scope for a UAT round that
is explicitly not the UI/UX refinement pass.

## 7 · Security

Re-verified rather than re-litigated; the payroll-specific work is recorded in
`docs/MALAYSIA_PAYROLL_FINAL_VALIDATION.md` §2 and its negative-test suite.

| Control | State |
| --- | --- |
| Tenant isolation | RLS enabled **and forced** on every tenant-scoped table; app role is a non-superuser; boot refuses a superuser connection |
| Branch scope | Enforced server-side across payroll, readiness, journey, employees, benefits and inputs |
| Salary confidentiality | `hr.salary.view` is separate from `hr.view`; the employee directory has no salary column; a salary **write** additionally requires payroll access |
| Payroll permissions | `hr.payroll.run` / `hr.payroll.approve` are not individually grantable and not custom-role-able |
| Audit | Consequential reads (reports, payslips, snapshots, statutory outputs) and every write are audited; `audit_logs` is append-only by trigger and REVOKE, proven against a superuser session |
| Negative tests | 15-case `payroll-final-validation` suite plus 16-case `payroll-epf-basis` suite, both green |

No P0 security blocker. No new endpoint was added in this cycle beyond the contribution-basis pair, which
carries the same gates as salary.

## 8 · Test matrix

Run at the converged HEAD, on the integrated world.

| Suite | Result |
| --- | --- |
| API typecheck (`tsc --noEmit`) | clean |
| Seed typecheck (`typecheck:seed`) | clean |
| Web typecheck (`tsc -b`) | clean |
| API unit (`jest`) | **125 suites · 2,702 tests · all green** |
| API integration (`jest-e2e`, serial) | **32 suites · 364 tests · all green** |
| Web unit (`vitest`) | **98 files · 1,699 tests · all green** |
| Administration Playwright (shell, operation, stock, panel, finance, hr, integration) | **30 tests · all green** — see §8a |
| Payroll statutory vectors, synthetic month, reports suite | inside the 364 above |
| Management walk (43 frames, desktop + iPad) | no dead screens, no key collisions |
| Cross-module reconciliation | 19/0 pristine · 22/0 with payroll approved |

<a name="8a"></a>
### 8a · The Administration browser suite, and what its first run found

The seven Administration Playwright suites are the gate this checkpoint waited on, and the first full run
did **not** pass: **26 passed, 3 failed**. All three failures were real and all three are fixed:

| Failing test | What it was telling us |
| --- | --- |
| `admin-shell.spec.ts:17` — *every page in the five modules loads, in one frame, with no console errors* | `.kw-adminError` present on Day-End Closing. The **same** Finance branch-scope defect the pack's frame 28 showed (§6, defects 3–4) |
| `admin-integration.spec.ts:110` — *counting short forces an explanation, and closing freezes the day* | Expected cash `> 20`, got `0` — the day-end screen was drawing zeros because its call had 404'd. Same root cause |
| `admin-integration.spec.ts:26` — *every mounted screen renders inside the Admin shell with its rail intact* | A **stale fixture** (§6, defect 5), not a product defect: it asserted a sub-tab removed from the HR rail by an earlier, deliberate product decision |

Two independent signals — a screenshot read by eye and a browser suite — found the same Finance defect.
That is the argument for keeping both.

**Re-run after the fixes: 30 tests, 0 failures** (30 rather than 29 because the stale assertion was
replaced with a test of what is actually true, and a new one added for the linked route).

## 9 · Module readiness — a verdict each

These verdicts are for **owner functional UAT**, which is what this round is for. None of them is a
production-rollout approval.

| Domain | Verdict | Why |
| --- | --- | --- |
| **Operation** | **PILOT/UAT READY** | Every screen renders real data from canonical facts, recomputes nothing, and is honest about coverage where data is thin (waiting times). Read-only, so the blast radius is nil |
| **Stock** | **PILOT/UAT READY** | Ledger-first, dispensing proven to decrement exactly once, valuation states its costing method. The one defect that could hide stock was found and fixed this cycle |
| **Panel** | **PILOT/UAT READY** | The reconciliation identity balances exactly, fee direction is implemented in both directions, and an unconfigured direction is refused rather than guessed. Electronic submission does not exist and the product says so |
| **HR** | **PILOT/UAT READY** | Employee, salary, standing, attendance, leave, claims, incentives, locum and roster all populated; pay confidentiality enforced |
| **Payroll** | **CONDITIONALLY READY** | The most validated module in the build — its own programme, 46-frame pack, 92-check independent reconciliation. **Conditional** because it is awaiting the historical parallel-run that this session was told not to perform, and because it prepares but never submits statutory returns |
| **Finance** | **CONDITIONALLY READY** | Overview, sales, collections, receivables, payables, day-end, credit notes and panel money all work on canonical facts. The two defects that made the default multi-branch view lie about reconciliation were found and fixed this cycle (§6, 3–4). **Conditional** on two stated gaps: payroll cost is not surfaced in Finance, and e-Invoice/MyInvois is not connected |

## 10 · Known limitations

Carried into the owner guide verbatim; §12 of that document is the owner-facing version.

- **Finance does not display payroll cost.** The approved payroll summary exists, verifies, and matches
  payroll to the cent — but no Finance screen consumes it. Use HR → Reports → *Cost to the clinic*.
- **Nothing is submitted to any authority or panel.** EPF, SOCSO, EIS, LINDUNG, PCB, HRD and panel claims
  are all *prepared*; a person files, then records that they filed.
- **No bank connection.** No payment file, no statement import, no reconciliation against a bank.
- **e-Invoice does not reach LHDN MyInvois**; the screen says so itself.
- **Stock valuation is standard cost only** — not FIFO, not weighted average, and it says so.
- **Waiting-time analytics depend on queue timings** that this seeded world barely has; coverage is shown.
- Payroll's declared statutory gaps stand unchanged: LINDUNG phases 2–3, EA First Schedule special
  categories, FINAL_PAY, mid-year employer transfers, CP38 in-run directions, special MTD schemes, and
  pay-component treatment shipping as DRAFT.

## 11 · Deliberately excluded from this round

Appointments and the calendar, public booking, the queue, registration, and the clinical/consultation
workspace. Management consumes their data — visits into Operation, dispensing into Stock, invoices into
Finance, panel visits into Panel — but none of them was modified, documented or UAT-scoped here.

## 12 · Railway target — evidence, decision, and what could not be checked

**Evidence.** `docs/STAGING_DEPLOYMENT.md` describes the Railway environment for this repository as "a
private owner-UAT environment": two services (`kuwick-api`, `kuwick-web`) built from `railway.api.json` /
`railway.web.json`, plus a Postgres plugin, with `prisma migrate deploy` running at container start.
`docs/HANDOFF.md` carries a standing owner rule — "**deployment tracks master**… work that is not on master
is invisible to the owner". CI contains **no deploy step**. `master` is unprotected and has been receiving
merges. The owner's *live* system referred to in `DECISIONS.md` is **kuwick.com**, the separate legacy
product, not this rebuild.

**Decision.** `master` is the owner-visible UAT line for this repository, and there is no evidence anywhere
in it that `master` feeds a live production clinic. Bringing `master` up to the converged build is a
**fast-forward**: it only adds commits, rewrites nothing, deletes nothing, and needs no force push.

**What could not be verified from the session container.** The Railway dashboard, its API and the deployed
hosts are unreachable — the outbound proxy denies them at policy level, and the Railway CLI is not
installed:

```
curl https://kuwick.up.railway.app/health  → CONNECT tunnel failed, 403 (policy denial)
curl https://railway.app/                  → 000
which railway                              → not installed
```

So the following are **stated as unverified**, not assumed: the services' current **Source** branch, the
SHA now running, the live health response, and whether the deploy succeeded. Git push is not deployment
proof and is not claimed as such.

**What the owner should confirm**, in the Railway dashboard, after this lands:

1. Both services' **Source** branch is the branch this build was pushed to.
2. A new deployment started, and its build log ends in success rather than a restart loop.
3. `GET /health` on the API returns `{"status":"ok","database":"connected","build":"<sha>"}` and the SHA
   matches §9's convergence SHA.
4. The web service loads and reaches the API (CORS_ORIGINS must name the web origin).
5. The UAT clinic is seeded (`seed-admin-uat`), or seed it per `docs/STAGING_DEPLOYMENT.md`.
