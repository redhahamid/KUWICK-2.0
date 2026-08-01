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
