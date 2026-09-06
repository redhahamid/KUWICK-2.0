# Management convergence — source map

What the latest genuine implementation of each Management domain actually is, established from git
history, SHAs, file trees, migrations and tests rather than from branch names.

**Convergence baseline:** `393ebb9` on `claude/kuwick-malaysia-payroll-prod-7vfncl`
(the validated Payroll checkpoint the programme required).

---

## 1 · The finding that shapes this convergence

**There was nothing to merge.** Every in-scope branch is already contained in `393ebb9`.

```
$ for b in <every remote branch>; do git merge-base --is-ancestor origin/$b HEAD; done
```

| Branch | Commits HEAD lacks | Status |
| --- | --- | --- |
| `master` | 0 | **contained in HEAD** |
| `claude/kuwick-malaysia-payroll-prod-7vfncl` | 0 | **HEAD itself** (`393ebb9`) |
| `claude/malaysia-payroll-final-validation-h1h6xi` | 0 | contained (same SHA) |
| `claude/kuwick-2-visual-audit-k9uk5z` | 0 | contained |
| `claude/kuwick-uat-seed-and-scroll-fix` | 0 | contained |
| `claude/kuwick-2-0-session-opener-bfumia` | 0 | contained |
| `clinical-workspace-c2-canvas-ux` | 0 | contained |
| `feature/appointments-final-hardening` | 0 | contained |
| `claude/management-manual-uat-guide-hemt2h` | 1 | docs only — see §3 |
| `claude/patient-booking-experience` | 2 | out of scope (patient-facing) |
| `clinical-workspace-c1-unsaved-safety` | 57 | out of scope (clinical) |
| `clinical-workspace-ux` | 54 | out of scope (clinical) |
| `claude/kuwick-2-0-scope-c8h2op` | 185 | **unrelated history** — see §4 |

The branches the brief offered as hints — `claude/finance-production`, `claude/stock-production`,
`claude/panel-production`, `claude/operation-production` — **do not exist**, on the remote or locally.
The Management domains were never developed on separate production branches; they were built on one
trunk that `393ebb9` is the tip of.

Convergence therefore means **verifying** that claim and bringing the owner-visible branch up to it,
not performing risky merges. No cherry-picking was required, so no conflict resolution was required,
so no older implementation could be accidentally restored.

## 2 · Per-domain provenance

All five domain groups sit on the same line of history. "Last change" is the newest commit touching
that domain's own paths.

| Domain | Canonical paths | Last change | Commits | Files |
| --- | --- | --- | --- | --- |
| **Operation** | `apps/api/src/analytics`, `apps/web/src/admin/operation` | `2efa2fd` · 2026-08-30 | 6 | 18 |
| **Stock** | `apps/api/src/stock`, `apps/api/src/inventory`, `apps/web/src/admin/stock` | `064683e` · 2026-09-01 | 12 | 75 |
| **Panel** | `apps/api/src/panel`, `apps/web/src/admin/panel` | `fbc29e3` · 2026-08-31 | 16 | 22 |
| **HR + Payroll** | `apps/api/src/workforce`, `apps/api/src/statutory`, `apps/web/src/admin/hr` | `393ebb9` · 2026-09-05 | 51 | 138 |
| **Finance** | `apps/api/src/finance`, `apps/web/src/admin/finance` | `ea91714` · 2026-09-05 | 31 | 44 |

### Module inventory as built

| Domain | API services | Controllers | API specs | Dedicated e2e |
| --- | --- | --- | --- | --- |
| Operation (`analytics`) | 4 | 1 | 1 | `admin-operations.spec.ts` |
| Stock (`stock` + `inventory`) | 3 + 11 | 1 + 8 | 1 + 14 | `admin-stock.spec.ts` |
| Panel | 3 | 1 | 2 | `admin-panel.spec.ts` |
| HR + Payroll (`workforce` + `statutory`) | 23 | 1 | 17 + 6 | `admin-hr.spec.ts` |
| Finance | 8 | 1 | 5 | `admin-finance.spec.ts` |
| Cross-module | — | — | — | `admin-integration.spec.ts`, `admin-shell.spec.ts` |

## 3 · `claude/management-manual-uat-guide-hemt2h` — docs only

One commit (`1bb6710`, 2026-09-05 17:16) off `master` (`a8d6cba`, 2026-08-23), adding three documents
totalling 2,178 lines: `MANAGEMENT_USER_MANUAL.md`, `MANAGEMENT_FIRST_TIME_SETUP_CHECKLIST.md`,
`MANAGEMENT_OWNER_UAT_GUIDE.md`. No code.

It was written against `master` — i.e. **before** the 103 commits of Payroll hardening that this
programme produced, so its Payroll chapters predate the statutory-commencement fix, the readiness
severity split, the branch-scope enforcement, the payment honesty ladder as it now stands and the
entire employer-selected EPF contribution basis. Documentation written against superseded behaviour
is worse than none, because a reader cannot tell which parts still hold.

**Decision: not merged.** The A–Z guide this programme produces
(`docs/KUWICK_MANAGEMENT_A_TO_Z_USER_UAT_GUIDE.md`) is written against the *running* converged build
and verified screen by screen. The older branch is left intact on the remote as history.

## 4 · `claude/kuwick-2-0-scope-c8h2op` — unrelated history, deliberately excluded

185 commits HEAD does not have, and:

```
$ git merge-base HEAD origin/claude/kuwick-2-0-scope-c8h2op
(no output — NO COMMON ANCESTOR)
```

It is a **separate root**: a parallel line that shares no ancestry with the trunk. Its tip is
2026-08-13, three weeks older than HEAD, and its API tree is a strict subset:

| | Modules present under `apps/api/src/` |
| --- | --- |
| `c8h2op` | appointment, auth, clinical, core, hr, inventory, reports |
| **HEAD** | appointment, auth, clinical, core, hr, inventory, reports **+ analytics, finance, panel, statutory, stock, workforce** |

It contains **no** Finance, Panel, Stock, Payroll or Operation analytics module at all. Its unique
commits are clinical-workspace, canvas, patient-alerts and billing-modal work — out of scope here.
Merging an unrelated older root would have been destructive and would have gained nothing.

**Decision: excluded, permanently, with this reason recorded.**

## 5 · Deployment target — what the evidence says

Both relevant statements come from the same commit (`afe4665`, 2026-08-18), so they are not in
conflict; they describe different things.

- `docs/STAGING_DEPLOYMENT.md` — a one-time setup guide for "a private owner-UAT environment on
  Railway", two services (`kuwick-api`, `kuwick-web`) plus a Postgres plugin, built from
  `railway.api.json` / `railway.web.json`. It pins the services' **Source** to the branch being
  demonstrated at the time (`clinical-workspace-c2-canvas-ux`) and says "Never `master`".
- `docs/HANDOFF.md` — a **standing owner rule**: "DEPLOY CADENCE (owner rule, permanent): after
  EVERY unit goes green in Actions, merge the working branch into master in the same session… Work
  that is not on master is invisible to the owner (**deployment tracks master**)".

Corroboration: `master` is unprotected, has been receiving merges since (tip `a8d6cba`, 2026-08-23,
later than the setup guide), and CI (`.github/workflows/ci.yml`) contains **no deploy step** — it runs
migrations only against its own throwaway test database. The owner's *live* system referred to in
`docs/DECISIONS.md` is **kuwick.com**, the separate legacy product, not this rebuild.

**Conclusion: the Railway environment for this repository is an owner-UAT environment, and `master`
is the branch the owner sees.** There is no evidence anywhere in the repository that `master` feeds a
live production clinic, and considerable evidence that it is the owner-review line.

Safety of the operation: `master` is a **strict ancestor** of `393ebb9`, so bringing it up to the
converged build is a **fast-forward** — it only adds commits. Nothing is rewritten, nothing is
deleted, no force push is involved, and the previous master commit remains reachable.

### What could not be verified from this environment

The Railway dashboard, its API and the deployed hosts are **unreachable** from the session container —
the outbound proxy denies them at policy level:

```
$ curl https://kuwick.up.railway.app/health   → CONNECT tunnel failed, 403 (policy denial)
$ curl https://railway.app/                   → 000
$ curl https://backboard.railway.app/         → 000
$ which railway                               → not installed
```

So the service **Source** setting as it stands today, the running deployment's SHA, its health
response and its migration state could not be observed here. This is recorded as a limitation rather
than assumed away; see the checkpoint document for what the owner must confirm.
