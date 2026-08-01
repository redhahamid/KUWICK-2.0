# C0 — Clinical Record Integrity: deployment checklist & preflight findings

Companion to `DECISIONS.md` D-051. Run through this before deploying C0 to any
environment holding real patient data.

---

## 1. Clinical-access preflight (MANDATORY before deploy)

C0 makes branch access **fail closed**: a null home branch no longer means
"every branch". An active doctor with no branch assignment in a multi-branch
tenant will lose the ability to write clinical records the moment C0 ships.

```bash
cd apps/api && npx tsx prisma/clinical-access-preflight.ts
```

Read-only; exits `0` when nobody loses access and `1` when an account needs a
recorded decision. It deliberately **assigns nothing** — an unassigned doctor
is a decision for the clinic owner to record, not for a script to guess.

It reports: active doctors with no home branch · clinical staff with ambiguous
branch access · users relying on explicit `UserClinicAccess` grants · users who
would lose clinical access after deployment.

### Findings — development database, 2026-08-01

| Tenant | Staff | Role | Branches | Home branch | Status |
|---|---|---|---|---|---|
| Frontend Verify Tenant | DR ALI | DOCTOR_RESIDENT | 2 | none | **ACTION REQUIRED** |
| KLINIK ALPHA | Dr Abdul | OWNER_ADMIN | 1 | set | OK |
| KLINIK BETA | Dr. Beta Owner (Renamed) | OWNER_ADMIN | 1 | set | OK |
| Smoke Test Tenant | Dr. Amira Rahman | DOCTOR_RESIDENT | 1 | none | OK — single branch auto-resolves |
| Smoke Test Tenant | Dr. Faizal Hakim | DOCTOR_LOCUM | 1 | none | OK — single branch auto-resolves |
| Smoke Test Tenant | Nurse Test Amy | FRONT_DESK_CLINICAL_STAFF | 1 | none | OK — single branch auto-resolves |

### DR ALI — determination

Investigated rather than assumed. The evidence:

- **No user account at all** (`users` row absent) → the account *cannot log in*.
- `lastLoginAt` is null → it has never been used.
- The whole tenant holds **0 visits and 0 clinical notes** (2 patients, 1 appointment).
- The tenant is named "Frontend Verify Tenant", has a **null slug** (so it isn't
  reachable by the scoped-login fallback either), and both it and the staff row
  were created on 2026-07-30 during frontend verification work.

**Determination: seed/test data, not a practising clinician.** It cannot lose
clinical access, because it has no login and has never held any.

**Action taken: none — deliberately.** No branch was assigned and the row was
not modified. Inventing a branch assignment for a fabricated doctor is exactly
the kind of silent, unrecorded change C0 exists to prevent, and it is
development-only data. The preflight will keep reporting `FAIL` for this row,
which is correct and honest; it costs one line to deactivate the seed row if
the owner prefers a clean `PASS`, but that is the owner's call to record.

**Before production deploy:** re-run the preflight against production. Any row
it flags needs a decision recorded here (assign a home branch, grant explicit
`UserClinicAccess`, or deactivate) — never a silent assignment.

---

## 2. Signing rollout — enabling each authorised doctor

Signing eligibility defaults to **disabled on every account**, so a fresh
deployment has zero eligible signers until an owner configures each doctor.
This is intentional fail-safe behaviour, not a bug.

Verified before release:

- Doctors can create and save **DRAFT** notes with signing unconfigured.
- Unsigned drafts break nothing: no code outside the clinical-note module
  reads note `status` or the signature fields, so Queue, visit completion,
  medications, procedures, documents, invoices and payments are unaffected
  (confirmed by search across `apps/api/src` and `apps/web/src`).
- Signing stays unavailable until every clause below is satisfied.
- **No account gets signing merely from its role** — not `DOCTOR_RESIDENT`,
  not `DOCTOR_LOCUM`, not `OWNER_ADMIN`.

### Per-doctor setup (Management → HR & Incentives → Staff → Edit)

Only a clinic **OWNER_ADMIN** may perform these steps; the API rejects anyone
else with 403.

1. **Professional type** → `Medical Doctor`
2. **Medical registration number** → e.g. `MMC12345`
3. **Professional active** → on
4. **Professional verification recorded** → on (stamps `professionalVerifiedAt`
   and the recording staff member server-side)
5. **Clinical-note signing enabled** → on (stamps `clinicalSigningEnabledAt`
   and the enabling staff member server-side)
6. **Audit record** → written automatically, one append-only row per changed
   field, readable at `GET /staff/:id/professional-audit`. Add a reason (e.g.
   "sighted original MMC certificate") to have it recorded on those rows.

A doctor becomes able to sign only when **all** of these hold:

```
active && professionalType === MEDICAL_DOCTOR && professionalActive
  && medicalRegistrationNo && professionalVerifiedAt && professionalVerifiedByStaffId
  && canSignClinicalNotes && clinicalSigningEnabledAt && clinicalSigningEnabledByStaffId
```

> **Kuwick does not verify registration with the MMC.** There is no registry
> integration. Steps 3–5 record that **your Clinic Group** sighted and accepted
> the practitioner's credentials. The Staff screen states this on-screen, and
> no wording anywhere claims independent verification.

---

## 3. Post-deploy verification

- [ ] Preflight re-run against production; every flagged row has a recorded decision.
- [ ] Migration row counts verified by direct query (notes backfilled with a branch, legacy flags set, **no fabricated authors**, observations created only for notes that had vitals).
- [ ] Legacy notes render as *"Author not recorded — legacy note · Read-only"*.
- [ ] At least one doctor configured end-to-end and a test note signed.
- [ ] `GET /staff/:id/professional-audit` shows the enabling trail.
