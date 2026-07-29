# Kuwick 2.0 — Coding Standards

**Status:** In force from the first line of application code onward.

## 1. Language & style

- **TypeScript strict mode** everywhere (`strict: true` in `tsconfig`) — `any` requires a `// why:` comment explaining what makes it unavoidable; it is never the default escape hatch.
- **ESLint + Prettier**, run on every commit via a pre-commit hook once one is configured (Phase 1), and in CI once CI exists. No hand-formatted code, no bikeshedding over style in review — the formatter decides.
- **No comments explaining what code does** — identifiers should make that obvious. A comment is only for a non-obvious *why*: a regulatory rule, a workaround for a specific bug, an invariant that would surprise a reader (this mirrors how the codebase should be written by anyone working on it, human or AI-assisted).
- **No speculative abstraction.** Build what the current module needs; don't add configuration points, plugin systems, or "future-proofing" for requirements that aren't written down in `PRODUCT_REQUIREMENTS.md`.

## 2. Naming conventions

| Context | Convention | Example |
|---|---|---|
| Database tables/columns | `snake_case` | `patient_panel_eligibility`, `tenant_id` |
| Prisma models | `PascalCase` | `PatientPanelEligibility` |
| TypeScript variables/functions | `camelCase` | `calculateIncentive()` |
| TypeScript types/interfaces/classes | `PascalCase` | `AppointmentStatus` |
| React components | `PascalCase`, one per file, filename matches | `StatusBadge.tsx` exports `StatusBadge` |
| Enum values | match the product spec's own wording | `AppointmentStatus.NO_SHOW` mirrors "No-Show" in §7 |

## 3. Folder & module conventions

- Backend (`apps/api`): one NestJS module per product module (`core`, `clinical`, `appointment`, `hr`, `inventory`, `panel-claims`, `reports`), matching `SYSTEM_ARCHITECTURE.md` §3. Each module owns `*.controller.ts`, `*.service.ts`, `*.module.ts`, and its own DTOs — no module imports another's repository/Prisma model directly; it calls the owning module's service.
- Frontend (`apps/web`): one top-level route/feature folder per product module, mirroring the backend split, so a developer working on "Panel Claims" touches one folder on each side.
- Shared types (`packages/shared`): enums and DTOs that both frontend and backend need (status enums, permission matrix, notification trigger types) live here once — never redefined independently on each side.

## 4. Git workflow

- **Trunk-based**: a `main` branch that's always deployable (once there's something to deploy); feature work happens on short-lived branches named `phase/<n>-<module>-<short-description>` (e.g. `phase1-clinical-patient-registration`).
- **Commit messages**: imperative mood, one logical change per commit (`Add patient NRIC validation`, not `fixes` or `wip`).
- **No direct commits bypassing review** once there's more than one contributor; solo work during Phase 0/1a may commit directly to `main` since there's no one else to review against yet — revisit when the team grows.
- **Never force-push or rewrite history on `main`.**

## 5. Testing

- **Unit tests** for business-rule logic specifically — the incentive calculation, claim-batch totals, stock-cannot-go-negative paths, RBAC guard logic — these are exactly the rules `PRODUCT_REQUIREMENTS.md` §18 gives acceptance criteria for, and each acceptance criterion should map to at least one test.
- **Integration tests** for anything touching the database (Prisma), run against a disposable test database, never against `kuwick_dev` or any future production database.
- No test suite is expected to exist yet for Phase 0 — this section governs Phase 1 onward.

## 6. Security baseline

- No secret (database password, JWT signing key, API key) is ever committed. All live in `.env`, which is gitignored; `.env.example` documents the required keys with placeholder values only.
- All patient-identifying data (`Patient`, `ClinicalNote`, `Prescription`, etc.) is only ever seeded with synthetic data in development — never real patient records, per the standing project rule.
- Every tenant-scoped database query goes through Prisma with the tenant-isolation guard active (`SYSTEM_ARCHITECTURE.md` §4) — a raw query that bypasses this must be justified in a code comment and reviewed, never a default pattern.

## 7. Definition of done (per feature)

A feature is not "done" until: it matches its `PRODUCT_REQUIREMENTS.md` acceptance criteria (if one is written for it), it has at least one automated test covering its business rule, it respects the RBAC matrix, and any create/update/delete on an audited entity flows through the audit interceptor.
