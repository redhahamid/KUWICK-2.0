import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Staff } from '@prisma/client';
import { ClinicalNoteService } from './clinical-note.service';
import { VisitObservationService } from './visit-observation.service';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

// C0 (D-051). These tests exist to prove the medicolegal guarantees, not
// just that CRUD works: authorship comes from the session, a signature can
// never be attributed to someone who didn't make it, signed content is
// immutable, and vitals entry never becomes narrative authorship.

const TENANT = 'test-tenant';
const CLINIC = 'clinic-1';

function staff(overrides: Partial<Staff> = {}): Staff {
  return {
    id: 'staff-doctor',
    tenantId: TENANT,
    userId: 'user-1',
    role: 'DOCTOR_RESIDENT',
    fullName: 'Dr Faizal Hakim',
    staffNumber: null,
    active: true,
    clinicId: CLINIC,
    createdAt: new Date(),
    updatedAt: new Date(),
    professionalType: 'MEDICAL_DOCTOR',
    medicalRegistrationNo: 'MMC12345',
    medicalRegistrationNoNormalised: 'MMC12345',
    professionalActive: true,
    canSignClinicalNotes: true,
    professionalVerifiedAt: new Date(),
    professionalVerifiedByStaffId: 'staff-owner',
    clinicalSigningEnabledAt: new Date(),
    clinicalSigningEnabledByStaffId: 'staff-owner',
    ...overrides,
  } as Staff;
}

const FRONT_DESK = staff({
  id: 'staff-assistant',
  role: 'FRONT_DESK_CLINICAL_STAFF',
  fullName: 'Nur Aisyah',
  professionalType: 'NON_CLINICAL',
  medicalRegistrationNo: null,
  medicalRegistrationNoNormalised: null,
  professionalActive: false,
  canSignClinicalNotes: false,
  professionalVerifiedAt: null,
  professionalVerifiedByStaffId: null,
  clinicalSigningEnabledAt: null,
  clinicalSigningEnabledByStaffId: null,
});

// A doctor by role whose clinic has NOT recorded verification / enabled
// signing — must not be able to sign.
const UNVERIFIED_DOCTOR = staff({
  id: 'staff-unverified',
  fullName: 'Dr Not Yet Verified',
  professionalVerifiedAt: null,
  professionalVerifiedByStaffId: null,
  canSignClinicalNotes: false,
  clinicalSigningEnabledAt: null,
  clinicalSigningEnabledByStaffId: null,
});

interface Harness {
  notes: ClinicalNoteService;
  observations: VisitObservationService;
  db: {
    notes: Map<string, Record<string, unknown>>;
    noteRevisions: Record<string, unknown>[];
    observations: Map<string, Record<string, unknown>>;
    observationRevisions: Record<string, unknown>[];
  };
  branchCount: { value: number };
  access: { rows: { clinicId: string }[] };
}

// A small in-memory stand-in for Prisma. Deliberately models the interactive
// transaction so the services' real code paths run without a live database;
// DB-level CHECK constraints and RLS are verified separately against the
// real database (see the C0 migration verification).
function createHarness(staffRows: Staff[]): Harness {
  const db = {
    notes: new Map<string, Record<string, unknown>>(),
    noteRevisions: [] as Record<string, unknown>[],
    observations: new Map<string, Record<string, unknown>>(),
    observationRevisions: [] as Record<string, unknown>[],
  };
  const branchCount = { value: 1 };
  const access = { rows: [] as { clinicId: string }[] };
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;

  const applyData = (existing: Record<string, unknown>, data: Record<string, unknown>) => {
    const next = { ...existing };
    for (const [k, v] of Object.entries(data)) {
      next[k] =
        v && typeof v === 'object' && v !== null && 'increment' in (v as object)
          ? (existing[k] as number) + (v as { increment: number }).increment
          : v;
    }
    return next;
  };

  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    staff: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(staffRows.find((s) => s.id === where.id) ?? null),
    },
    clinic: { count: () => Promise.resolve(branchCount.value) },
    userClinicAccess: { findMany: () => Promise.resolve(access.rows) },
    visit: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'visit-1' ? { id: 'visit-1', clinicId: CLINIC } : null),
    },
    clinicalNote: {
      findUnique: ({ where }: { where: { id: string } }) => Promise.resolve(db.notes.get(where.id) ?? null),
      findMany: () =>
        Promise.resolve([...db.notes.values()].map((n) => ({ ...n, author: null, signedBy: null, amendments: [] }))),
      create: ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: id('note'), ...data };
        db.notes.set(row.id as string, row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const next = applyData(db.notes.get(where.id)!, data);
        db.notes.set(where.id, next);
        return Promise.resolve(next);
      },
    },
    clinicalNoteRevision: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        db.noteRevisions.push(data);
        return Promise.resolve(data);
      },
      findMany: () => Promise.resolve(db.noteRevisions),
    },
    visitObservation: {
      findUnique: ({ where }: { where: { id: string } }) => Promise.resolve(db.observations.get(where.id) ?? null),
      findMany: () => Promise.resolve([...db.observations.values()]),
      // G4.5d3c-3c — the duplicate-vitals guard asks for the most recent
      // observation on this visit by this recorder inside the window. The
      // fake honours visitId and recordedByStaffId; `recordedAt` is not
      // stored by this harness, so the time predicate is exercised by the
      // dedicated spec rather than here.
      findFirst: ({ where }: { where: Record<string, unknown> }) => {
        const matches = [...db.observations.values()].filter(
          (row: Record<string, unknown>) =>
            row.visitId === where.visitId && row.recordedByStaffId === where.recordedByStaffId,
        );
        return Promise.resolve(matches[matches.length - 1] ?? null);
      },
      create: ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: id('obs'), ...data };
        db.observations.set(row.id as string, row);
        return Promise.resolve(row);
      },
      update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const next = applyData(db.observations.get(where.id)!, data);
        db.observations.set(where.id, next);
        return Promise.resolve(next);
      },
    },
    visitObservationRevision: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        db.observationRevisions.push(data);
        return Promise.resolve(data);
      },
      findMany: () => Promise.resolve(db.observationRevisions),
    },
  };

  const prisma = {
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  } as unknown as PrismaService;

  return {
    notes: new ClinicalNoteService(prisma),
    observations: new VisitObservationService(prisma),
    db,
    branchCount,
    access,
  };
}

function as<T>(actor: Staff, fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: TENANT, staffId: actor.id, role: actor.role }, fn);
}

describe('ClinicalNoteService — authorship (C0/D-051)', () => {
  it('takes the author from the authenticated session, never the request body', async () => {
    const doctor = staff();
    const h = createHarness([doctor]);

    // A naive/malicious client tries to attribute the note to someone else.
    const note = await as(doctor, () =>
      h.notes.create('visit-1', { notes: 'Fever 3 days', authorStaffId: 'staff-someone-else' } as never),
    );

    expect(note.authorStaffId).toBe('staff-doctor');
    expect(note.authorNameSnapshot).toBe('Dr Faizal Hakim');
    expect(note.authorRoleSnapshot).toBe('DOCTOR_RESIDENT');
    expect(note.legacyAuthorUnknown).toBe(false);
    expect(note.status).toBe('DRAFT');
  });

  it('never lets a front-desk member author a doctor narrative', async () => {
    const h = createHarness([FRONT_DESK]);
    await expect(as(FRONT_DESK, () => h.notes.create('visit-1', { notes: 'sounds like asthma' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lets a front-desk member record a STAFF_REMARK, which can never be signed', async () => {
    const h = createHarness([FRONT_DESK]);

    const remark = await as(FRONT_DESK, () =>
      h.notes.create('visit-1', { noteType: 'STAFF_REMARK', notes: 'Patient refused medication' }),
    );

    expect(remark.noteType).toBe('STAFF_REMARK');
    expect(remark.authorStaffId).toBe('staff-assistant');
    expect(remark.authorRoleSnapshot).toBe('FRONT_DESK_CLINICAL_STAFF');

    await expect(as(FRONT_DESK, () => h.notes.sign(remark.id, { expectedVersion: 1 }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('signs as the authenticated caller only — a doctor cannot sign under another identity', async () => {
    const doctor = staff();
    const h = createHarness([doctor]);
    const note = await as(doctor, () => h.notes.create('visit-1', { notes: 'URTI' }));

    // The sign DTO has no signer field at all; even a smuggled one is ignored.
    const signed = await as(doctor, () =>
      h.notes.sign(note.id, { expectedVersion: 1, signedByStaffId: 'staff-other' } as never),
    );

    expect(signed.status).toBe('SIGNED');
    expect(signed.signedByStaffId).toBe('staff-doctor');
    expect(signed.signerNameSnapshot).toBe('Dr Faizal Hakim');
    expect(signed.signedAt).toBeInstanceOf(Date);
  });

  it('refuses signing when the clinic has not recorded verification and enabled signing', async () => {
    const h = createHarness([UNVERIFIED_DOCTOR]);
    const note = await as(UNVERIFIED_DOCTOR, () => h.notes.create('visit-1', { notes: 'Cough' }));

    await expect(as(UNVERIFIED_DOCTOR, () => h.notes.sign(note.id, { expectedVersion: 1 }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses signing by a non-clinician OWNER_ADMIN', async () => {
    const owner = staff({
      id: 'staff-owner-admin',
      role: 'OWNER_ADMIN',
      fullName: 'Encik Pemilik',
      professionalType: 'NON_CLINICAL',
      medicalRegistrationNo: null,
      professionalActive: false,
      canSignClinicalNotes: false,
      professionalVerifiedAt: null,
      professionalVerifiedByStaffId: null,
      clinicalSigningEnabledAt: null,
      clinicalSigningEnabledByStaffId: null,
    });
    const doctor = staff();
    const h = createHarness([owner, doctor]);
    const note = await as(doctor, () => h.notes.create('visit-1', { notes: 'Cough' }));

    await expect(as(owner, () => h.notes.sign(note.id, { expectedVersion: 1 }))).rejects.toThrow(ForbiddenException);
  });

  it('allows an OWNER_ADMIN who IS a verified practitioner to sign', async () => {
    const clinicianOwner = staff({ id: 'staff-owner-doc', role: 'OWNER_ADMIN', fullName: 'Dr Abdul (Owner)' });
    const h = createHarness([clinicianOwner]);
    const note = await as(clinicianOwner, () => h.notes.create('visit-1', { notes: 'Cough' }));

    const signed = await as(clinicianOwner, () => h.notes.sign(note.id, { expectedVersion: 1 }));

    expect(signed.status).toBe('SIGNED');
    expect(signed.signedByStaffId).toBe('staff-owner-doc');
  });
});

describe('ClinicalNoteService — immutability and concurrency (C0/D-051)', () => {
  it('refuses to edit a signed note and keeps its content byte-for-byte', async () => {
    const doctor = staff();
    const h = createHarness([doctor]);
    const note = await as(doctor, () => h.notes.create('visit-1', { notes: 'Original finding' }));
    const signed = await as(doctor, () => h.notes.sign(note.id, { expectedVersion: 1 }));

    await expect(
      as(doctor, () => h.notes.update(note.id, { notes: 'Tampered', expectedVersion: signed.version })),
    ).rejects.toThrow(ConflictException);

    expect(h.db.notes.get(note.id)!.notes).toBe('Original finding');
  });

  it('creates an amendment as a NEW linked note, leaving the original SIGNED', async () => {
    const doctor = staff();
    const h = createHarness([doctor]);
    const note = await as(doctor, () => h.notes.create('visit-1', { notes: 'BP 140/90' }));
    await as(doctor, () => h.notes.sign(note.id, { expectedVersion: 1 }));

    const amendment = await as(doctor, () =>
      h.notes.amend(note.id, { amendmentReason: 'BP transcribed incorrectly', notes: 'BP 120/80' }),
    );

    expect(amendment.id).not.toBe(note.id);
    expect(amendment.entryType).toBe('AMENDMENT');
    expect(amendment.supersedesNoteId).toBe(note.id);
    expect(amendment.amendmentReason).toBe('BP transcribed incorrectly');
    expect(amendment.status).toBe('DRAFT');
    // The original is untouched and still SIGNED.
    const original = h.db.notes.get(note.id)!;
    expect(original.status).toBe('SIGNED');
    expect(original.notes).toBe('BP 140/90');
  });

  it('rejects a stale save with 409 instead of overwriting newer content', async () => {
    const doctor = staff();
    const h = createHarness([doctor]);
    const note = await as(doctor, () => h.notes.create('visit-1', { notes: 'v1' }));
    await as(doctor, () => h.notes.update(note.id, { notes: 'v2', expectedVersion: 1 }));

    await expect(as(doctor, () => h.notes.update(note.id, { notes: 'stale', expectedVersion: 1 }))).rejects.toThrow(
      ConflictException,
    );
    expect(h.db.notes.get(note.id)!.notes).toBe('v2');
  });

  it('writes an append-only revision for every create, update and sign', async () => {
    const doctor = staff();
    const h = createHarness([doctor]);
    const note = await as(doctor, () => h.notes.create('visit-1', { notes: 'a' }));
    await as(doctor, () => h.notes.update(note.id, { notes: 'b', expectedVersion: 1 }));
    await as(doctor, () => h.notes.sign(note.id, { expectedVersion: 2 }));

    expect(h.db.noteRevisions.map((r) => r.changeType)).toEqual(['CREATED', 'UPDATED', 'SIGNED']);
    expect(h.db.noteRevisions.map((r) => r.versionNo)).toEqual([1, 2, 3]);
    expect(h.db.noteRevisions.every((r) => r.editedByStaffId === 'staff-doctor')).toBe(true);
    // Only the signed revision carries a verifiable content hash.
    expect(h.db.noteRevisions[2].contentHash).toEqual(expect.any(String));
    expect(h.db.noteRevisions[2].hashSchemaVersion).toBe(1);
    expect(h.db.noteRevisions[0].contentHash).toBeNull();
  });
});

describe('Legacy notes are permanently read-only (C0 closure)', () => {
  // Seed a row exactly as the C0 migration leaves a pre-existing note:
  // no author, flagged legacy, still DRAFT.
  function seedLegacy(h: Harness, notes = '<p>Historical entry from 2025</p>') {
    const id = 'legacy-note-1';
    h.db.notes.set(id, {
      id,
      tenantId: TENANT,
      clinicId: CLINIC,
      visitId: 'visit-1',
      notes,
      noteLanguage: 'EN',
      noteType: 'DOCTOR_NARRATIVE',
      status: 'DRAFT',
      entryType: 'STANDARD',
      version: 1,
      authorStaffId: null,
      authorNameSnapshot: null,
      authorRoleSnapshot: null,
      legacyAuthorUnknown: true,
      createdAt: new Date('2025-06-01T09:00:00Z'),
    });
    return id;
  }

  it('rejects a direct edit of a legacy note', async () => {
    const doctor = staff();
    const h = createHarness([doctor]);
    const id = seedLegacy(h);

    await expect(
      as(doctor, () => h.notes.update(id, { notes: 'rewritten', expectedVersion: 1 })),
    ).rejects.toThrow(ConflictException);
  });

  it('leaves the legacy note byte-identical after a rejected edit', async () => {
    const doctor = staff();
    const h = createHarness([doctor]);
    const original = '<p>Historical entry from 2025</p>';
    const id = seedLegacy(h, original);

    await expect(as(doctor, () => h.notes.update(id, { notes: 'rewritten', expectedVersion: 1 }))).rejects.toThrow();

    const after = h.db.notes.get(id)!;
    expect(after.notes).toBe(original);
    expect(after.version).toBe(1);
    expect(after.authorStaffId).toBeNull();
    expect(after.legacyAuthorUnknown).toBe(true);
  });

  it('allows an attributed amendment of a legacy note without modifying the original', async () => {
    const doctor = staff();
    const h = createHarness([doctor]);
    const original = '<p>Historical entry from 2025</p>';
    const id = seedLegacy(h, original);

    const amendment = await as(doctor, () =>
      h.notes.amend(id, { amendmentReason: 'Clarifying an unattributed historical entry', notes: '<p>Corrected.</p>' }),
    );

    // The amendment carries real authorship…
    expect(amendment.entryType).toBe('AMENDMENT');
    expect(amendment.supersedesNoteId).toBe(id);
    expect(amendment.authorStaffId).toBe('staff-doctor');
    expect(amendment.authorNameSnapshot).toBe('Dr Faizal Hakim');
    expect(amendment.legacyAuthorUnknown).toBe(false);
    expect(amendment.amendmentReason).toBe('Clarifying an unattributed historical entry');
    // …and the legacy original is untouched, still unattributed.
    const after = h.db.notes.get(id)!;
    expect(after.notes).toBe(original);
    expect(after.authorStaffId).toBeNull();
    expect(after.legacyAuthorUnknown).toBe(true);
    expect(after.version).toBe(1);
  });

  it('still refuses to amend an ordinary unsigned draft', async () => {
    const doctor = staff();
    const h = createHarness([doctor]);
    const note = await as(doctor, () => h.notes.create('visit-1', { notes: 'work in progress' }));

    await expect(as(doctor, () => h.notes.amend(note.id, { amendmentReason: 'x' }))).rejects.toThrow(ConflictException);
  });
});

// ===========================================================================
// G4.5d6 — AUTOMATIC FINALIZATION KEEPS THE MEDICOLEGAL GUARANTEES
//
// The doctor no longer presses Sign; completing the visit finalizes the open
// draft instead. The record is only as trustworthy as what that leaves
// behind, so these tests hold the finalized note to exactly the standard the
// manually signed one was held to: immutable content, correction only by
// amendment, and no correction at all by someone who may not sign.
// ===========================================================================
describe('Auto-finalized notes (G4.5d6)', () => {
  const FINALIZED_AT = new Date('2026-08-08T04:30:00Z');

  /** A note as `finalizeVisitDocumentation` leaves it at Complete Visit. */
  function seedAutoFinalized(h: Harness, notes = '<p>URTI, symptomatic treatment.</p>') {
    const id = 'auto-final-1';
    h.db.notes.set(id, {
      id,
      tenantId: TENANT,
      clinicId: CLINIC,
      visitId: 'visit-1',
      notes,
      noteLanguage: 'EN',
      noteType: 'DOCTOR_NARRATIVE',
      status: 'SIGNED',
      entryType: 'STANDARD',
      version: 2,
      authorStaffId: 'staff-doctor',
      authorNameSnapshot: 'Dr Faizal Hakim',
      authorRoleSnapshot: 'DOCTOR_RESIDENT',
      legacyAuthorUnknown: false,
      // The signature is the AUTHOR's — completion does not transfer
      // authorship to whoever happened to close the visit.
      signedAt: FINALIZED_AT,
      signedByStaffId: 'staff-doctor',
      signerNameSnapshot: 'Dr Faizal Hakim',
      signerRoleSnapshot: 'DOCTOR_RESIDENT',
      finalizedAt: FINALIZED_AT,
      finalizedByStaffId: 'staff-assistant',
      finalizationMode: 'AUTO_ON_VISIT_COMPLETION',
      createdAt: new Date('2026-08-08T03:55:00Z'),
    });
    return id;
  }

  it('is immutable — a direct edit is refused and the content stays byte-for-byte', async () => {
    const doctor = staff();
    const h = createHarness([doctor]);
    const original = '<p>URTI, symptomatic treatment.</p>';
    const id = seedAutoFinalized(h, original);

    await expect(
      as(doctor, () => h.notes.update(id, { notes: 'Tampered', expectedVersion: 2 })),
    ).rejects.toThrow(ConflictException);

    const after = h.db.notes.get(id)!;
    expect(after.notes).toBe(original);
    expect(after.version).toBe(2);
  });

  it('can only be corrected by amendment, which records reason, actor and time', async () => {
    const doctor = staff();
    const h = createHarness([doctor]);
    const original = '<p>URTI, symptomatic treatment.</p>';
    const id = seedAutoFinalized(h, original);

    const amendment = await as(doctor, () =>
      h.notes.amend(id, {
        amendmentReason: 'Allergy history omitted at the time of consultation',
        notes: '<p>URTI. Penicillin allergy noted.</p>',
      }),
    );

    expect(amendment.entryType).toBe('AMENDMENT');
    expect(amendment.supersedesNoteId).toBe(id);
    expect(amendment.amendmentReason).toBe('Allergy history omitted at the time of consultation');
    expect(amendment.authorStaffId).toBe('staff-doctor');
    // The finalized original is untouched, including how it was finalized.
    const after = h.db.notes.get(id)!;
    expect(after.notes).toBe(original);
    expect(after.status).toBe('SIGNED');
    expect(after.finalizationMode).toBe('AUTO_ON_VISIT_COMPLETION');
    expect(after.finalizedAt).toBe(FINALIZED_AT);
    expect(after.signedByStaffId).toBe('staff-doctor');
    // The correction is attributable in the append-only revision trail.
    const revision = h.db.noteRevisions.at(-1)!;
    expect(revision.editedByStaffId).toBe('staff-doctor');
    expect(revision.reason).toBe('Allergy history omitted at the time of consultation');
  });

  it('refuses an amendment by someone who may not sign a clinical note', async () => {
    // Removing the Sign button removed a ceremony, not an authorisation.
    const h = createHarness([FRONT_DESK, UNVERIFIED_DOCTOR]);
    const id = seedAutoFinalized(h);

    await expect(
      as(FRONT_DESK, () => h.notes.amend(id, { amendmentReason: 'Correcting the record' })),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      as(UNVERIFIED_DOCTOR, () => h.notes.amend(id, { amendmentReason: 'Correcting the record' })),
    ).rejects.toThrow(ForbiddenException);

    // Neither attempt left anything behind.
    expect(h.db.notes.size).toBe(1);
    expect(h.db.noteRevisions).toHaveLength(0);
  });

  it('refuses an amendment with no stated reason', async () => {
    const doctor = staff();
    const h = createHarness([doctor]);
    const id = seedAutoFinalized(h);

    await expect(as(doctor, () => h.notes.amend(id, { amendmentReason: '   ' }))).rejects.toThrow();
    expect(h.db.notes.size).toBe(1);
  });

  it('leaves a historic MANUALLY signed note exactly as it was', async () => {
    // Notes signed before G4.5d6 carry no finalization columns. They must
    // stay that way — the migration backfills nothing, and the new code path
    // never rewrites them.
    const doctor = staff();
    const h = createHarness([doctor]);
    const note = await as(doctor, () => h.notes.create('visit-1', { notes: 'Signed by hand in July' }));
    await as(doctor, () => h.notes.sign(note.id, { expectedVersion: 1 }));

    const signed = h.db.notes.get(note.id)!;
    expect(signed.status).toBe('SIGNED');
    expect(signed.finalizationMode).toBeUndefined();
    expect(signed.finalizedAt).toBeUndefined();

    // It remains amendable on the same terms as before.
    const amendment = await as(doctor, () =>
      h.notes.amend(note.id, { amendmentReason: 'Typo in the dose', notes: 'Corrected' }),
    );
    expect(amendment.supersedesNoteId).toBe(note.id);
    const after = h.db.notes.get(note.id)!;
    expect(after.notes).toBe('Signed by hand in July');
    expect(after.finalizationMode).toBeUndefined();
  });
});

describe('Branch access — fail closed (C0/D-051)', () => {
  it('denies a doctor with no home branch in a multi-branch tenant', async () => {
    const roaming = staff({ id: 'staff-roaming', clinicId: null });
    const h = createHarness([roaming]);
    h.branchCount.value = 2; // ambiguous — must NOT be treated as "all branches"

    await expect(as(roaming, () => h.notes.create('visit-1', { notes: 'x' }))).rejects.toThrow(ForbiddenException);
  });

  it('auto-resolves the only branch in a genuinely single-branch tenant', async () => {
    const roaming = staff({ id: 'staff-roaming', clinicId: null });
    const h = createHarness([roaming]);
    h.branchCount.value = 1;

    const note = await as(roaming, () => h.notes.create('visit-1', { notes: 'x' }));
    expect(note.clinicId).toBe(CLINIC);
  });

  it('denies a Branch-A doctor writing a Branch-B record, then allows it once explicit access exists', async () => {
    const branchB = staff({ id: 'staff-branch-b', clinicId: 'clinic-2' });
    const h = createHarness([branchB]);
    h.branchCount.value = 2;

    await expect(as(branchB, () => h.notes.create('visit-1', { notes: 'x' }))).rejects.toThrow(ForbiddenException);

    h.access.rows = [{ clinicId: CLINIC }]; // explicit UserClinicAccess grant
    const note = await as(branchB, () => h.notes.create('visit-1', { notes: 'x' }));
    expect(note.clinicId).toBe(CLINIC);
  });
});

describe('Vitals never become narrative authorship — the owner scenario (C0/D-051)', () => {
  it('assistant records vitals, doctor writes the narrative: two records, two attributions', async () => {
    const doctor = staff();
    const h = createHarness([FRONT_DESK, doctor]);

    // 1-2. Clinic staff enters the patient's vitals.
    const observation = await as(FRONT_DESK, () =>
      h.observations.record('visit-1', { bpSystolic: 120, bpDiastolic: 80, pulse: 80 }),
    );

    // 3. The doctor later writes the clinical narrative.
    const note = await as(doctor, () => h.notes.create('visit-1', { notes: 'Well. Reassured.' }));

    // 4. The narrative author is the DOCTOR, not the assistant.
    expect(note.authorStaffId).toBe('staff-doctor');
    expect(note.authorNameSnapshot).toBe('Dr Faizal Hakim');
    expect(observation.recordedByStaffId).toBe('staff-assistant');
    expect(observation.recorderNameSnapshot).toBe('Nur Aisyah');
    // Recording vitals created NO clinical note at all.
    expect(h.db.notes.size).toBe(1);
  });

  it('a repeat reading is a NEW observation, not an overwrite', async () => {
    const h = createHarness([FRONT_DESK]);
    const first = await as(FRONT_DESK, () => h.observations.record('visit-1', { bpSystolic: 160, bpDiastolic: 100 }));
    const second = await as(FRONT_DESK, () => h.observations.record('visit-1', { bpSystolic: 130, bpDiastolic: 85 }));

    expect(second.id).not.toBe(first.id);
    expect(h.db.observations.size).toBe(2);
    expect(h.db.observations.get(first.id)!.bpSystolic).toBe(160);
  });

  it('a correction preserves the previous values and the original recorder', async () => {
    const doctor = staff();
    const h = createHarness([FRONT_DESK, doctor]);
    const obs = await as(FRONT_DESK, () => h.observations.record('visit-1', { bpSystolic: 220 }));

    const corrected = await as(doctor, () =>
      h.observations.correct(obs.id, { bpSystolic: 120, expectedVersion: 1, correctionReason: 'Typo — was 120' }),
    );

    expect(corrected.bpSystolic).toBe(120);
    // The person who took the reading is unchanged; the corrector is separate.
    expect(corrected.recordedByStaffId).toBe('staff-assistant');
    expect(corrected.updatedByStaffId).toBe('staff-doctor');
    // The previous value survives in an immutable revision.
    const rev = h.db.observationRevisions.find((r) => r.changeType === 'CORRECTED')!;
    expect((rev.contentSnapshot as Record<string, unknown>).bpSystolic).toBe('220');
    expect(rev.correctionReason).toBe('Typo — was 120');
    expect(rev.editedByStaffId).toBe('staff-doctor');
  });

  it('rejects a stale observation correction with 409', async () => {
    const h = createHarness([FRONT_DESK]);
    const obs = await as(FRONT_DESK, () => h.observations.record('visit-1', { pulse: 80 }));
    await as(FRONT_DESK, () =>
      h.observations.correct(obs.id, { pulse: 82, expectedVersion: 1, correctionReason: 'misread' }),
    );

    await expect(
      as(FRONT_DESK, () => h.observations.correct(obs.id, { pulse: 99, expectedVersion: 1, correctionReason: 'again' })),
    ).rejects.toThrow(ConflictException);
  });
});
