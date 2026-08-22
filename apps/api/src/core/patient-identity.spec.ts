import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PatientService } from './patient.service';
import { PrismaService } from './prisma.service';
import { TenantScopedPrismaClient } from './tenant-scoped-prisma.provider';
import { tenantContextStorage } from './tenant-context';

// ===========================================================================
// CORRECTING AN IC IS SAFER THAN NOT BEING ABLE TO.
//
// IC and date of birth were read-only, which sounded careful. What it actually
// did was force the counter to open a SECOND patient for a transposed digit,
// splitting one person's visits, invoices and claims across two files. Staging
// carries an 11-digit IC and a date of birth of 05/05/2026 that nobody can fix.
//
// So they are editable, and these hold the three things that make that safe:
// who may do it, that it cannot CREATE the duplicate it exists to prevent, and
// that it leaves a record naming old value, new value, who and when.
// ===========================================================================

type Actor = { id: string; tenantId: string; role: string; fullName: string; active: boolean; assigned: string[] };

const counter: Actor = {
  id: 'staff-fd',
  tenantId: 't1',
  role: 'FRONT_DESK_CLINICAL_STAFF',
  fullName: 'Nurul at the counter',
  active: true,
  assigned: ['ADMINISTRATOR'],
};
const owner: Actor = {
  id: 'staff-ow',
  tenantId: 't1',
  role: 'OWNER_ADMIN',
  fullName: 'Dr Redha',
  active: true,
  assigned: ['OWNER'],
};
const doctor: Actor = {
  id: 'staff-dr',
  tenantId: 't1',
  role: 'DOCTOR_RESIDENT',
  fullName: 'Dr Amira',
  active: true,
  assigned: ['DOCTOR'],
};
const nurse: Actor = {
  id: 'staff-cs',
  tenantId: 't1',
  role: 'FRONT_DESK_CLINICAL_STAFF',
  fullName: 'Nurse Faridah',
  active: true,
  assigned: ['CLINICAL_STAFF'],
};
/** Back office. Holds no system role at all — see LEGACY_ROLE_PERMISSIONS. */
const finance: Actor = {
  id: 'staff-fin',
  tenantId: 't1',
  role: 'FINANCE_STAFF',
  fullName: 'Encik Zaki',
  active: true,
  assigned: [],
};

const STORED = {
  id: 'p1',
  tenantId: 't1',
  identifierType: 'NRIC',
  identifierValue: '12345678901',
  name: 'Aisyah Ujian',
  dob: new Date('2026-05-05T00:00:00.000Z'),
  deletedAt: null,
};

function createService(actor: Actor, options: { clash?: { id: string; name: string; deletedAt: Date | null } } = {}) {
  const tx = {
    $executeRaw: jest.fn(),
    staff: { findUnique: jest.fn().mockResolvedValue(actor) },
    staffRoleAssignment: { findMany: jest.fn().mockResolvedValue(actor.assigned.map((role) => ({ role }))) },
    patient: {
      findFirst: jest.fn().mockResolvedValue(options.clash ?? null),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...STORED, ...data })),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'p-new', ...data })),
    },
    patientIdentityChange: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };

  // The scoped client answers the reads the profile screen makes; the raw one
  // is only used for the identity transaction.
  const scoped = {
    patient: {
      findUnique: jest.fn().mockResolvedValue(STORED),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...STORED, ...data })),
    },
  } as unknown as TenantScopedPrismaClient;
  const raw = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;

  return { service: new PatientService(scoped, raw), tx, scoped };
}

function asActor<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 't1', staffId: actor.id }, fn);
}

describe('who may correct an identifier', () => {
  it('the counter can — registration took the IC, so registration fixes it', async () => {
    const { service, tx } = createService(counter);
    await asActor(counter, () => service.update('p1', { identifierValue: '900101145566' }));
    expect(tx.patient.update).toHaveBeenCalled();
  });

  it('the owner can — they are the escalation path, and often the only account on shift', async () => {
    const { service, tx } = createService(owner);
    await asActor(owner, () => service.update('p1', { identifierValue: '900101145566' }));
    expect(tx.patient.update).toHaveBeenCalled();
  });

  it('a doctor can — in a small clinic they are often the only person on shift', async () => {
    // This used to be refused, and the refusal was the friction the owner
    // removed: a doctor who spots a transposed digit and cannot fix it is a
    // doctor who ends up with two files for one patient.
    const { service, tx } = createService(doctor);
    await asActor(doctor, () => service.update('p1', { identifierValue: '900101145566' }));
    expect(tx.patient.update).toHaveBeenCalled();
  });

  it('clinical staff can — whoever is looking at the IC card', async () => {
    const { service, tx } = createService(nurse);
    await asActor(nurse, () => service.update('p1', { identifierValue: '900101145566' }));
    expect(tx.patient.update).toHaveBeenCalled();
  });

  it('a back-office account cannot, and is told what to do instead', async () => {
    // Finance holds no system role at all. Open to everyone who SEES patients
    // is not the same as open to everyone with a login.
    const { service, tx } = createService(finance);
    await expect(
      asActor(finance, () => service.update('p1', { identifierValue: '900101145566' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.patient.update).not.toHaveBeenCalled();

    await expect(
      asActor(finance, () => service.update('p1', { identifierValue: '900101145566' })),
    ).rejects.toThrow(/do not create a second record/i);
  });

  it('an ordinary demographics save takes the DEMOGRAPHICS permission, not the identity one', async () => {
    // Final-UAT hardening: the check-in drawer edits phone/address/name in
    // place, so the server says who may — everyone who sees patients holds
    // `patient.demographics.write`. The save still skips the identity
    // confirmation and the identity record; only IC and DOB earn those.
    const { service, tx } = createService(counter);
    await asActor(counter, () => service.update('p1', { phone: '0111111111' }));
    expect(tx.patient.update).toHaveBeenCalled();
    expect(tx.patientIdentityChange.createMany).not.toHaveBeenCalled();
  });

  it('a back-office login can no longer edit demographics — the ungated hole is closed', async () => {
    // Before this hardening any valid token could PATCH a patient's name.
    // Finance holds billing permissions, not patient ones.
    const { service, tx } = createService(finance);
    await expect(
      asActor(finance, () => service.update('p1', { phone: '0111111111' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.patient.update).not.toHaveBeenCalled();
  });

  it('re-submitting the SAME IC is not a correction — demographics permission suffices', async () => {
    // The form submits every field it holds, so "the IC is in the payload"
    // says nothing about whether it moved.
    const { service, tx } = createService(counter);
    await asActor(counter, () =>
      service.update('p1', { identifierValue: '12345678901', dob: '2026-05-05', phone: '0111111111' }),
    );
    expect(tx.patient.update).toHaveBeenCalled();
    expect(tx.patientIdentityChange.createMany).not.toHaveBeenCalled();
  });
});

describe('registration is a permission and a sentence (final-UAT hardening)', () => {
  it('the counter registers a patient — with the actor tenant stamped on', async () => {
    const { service, tx } = createService(counter);
    const created = await asActor(counter, () =>
      service.create({ identifierType: 'NRIC', identifierValue: '990101086622', name: 'Baru Daftar' } as never),
    );
    expect(tx.patient.create).toHaveBeenCalled();
    expect((created as { tenantId: string }).tenantId).toBe('t1');
  });

  it('a back-office login cannot register a patient', async () => {
    const { service, tx } = createService(finance);
    await expect(
      asActor(finance, () =>
        service.create({ identifierType: 'NRIC', identifierValue: '990101086622', name: 'Baru' } as never),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.patient.create).not.toHaveBeenCalled();
  });

  it('registering an IC somebody already holds is refused with the SAME sentence as a correction', async () => {
    // The DB unique constraint refused this before too — as a 500. The
    // counter deserves the sentence, and the invitation to look for the
    // existing record instead of trying a different spelling.
    const { service, tx } = createService(counter, {
      clash: { id: 'p2', name: 'Aisyah binti Ujian', deletedAt: null },
    });
    await expect(
      asActor(counter, () =>
        service.create({ identifierType: 'NRIC', identifierValue: '12345678901', name: 'Aisyah' } as never),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.patient.create).not.toHaveBeenCalled();
  });
});

describe('it cannot create the duplicate it exists to prevent', () => {
  it('refuses an IC another patient already holds, and names them', async () => {
    const { service, tx } = createService(counter, {
      clash: { id: 'p2', name: 'Aisyah binti Ujian', deletedAt: null },
    });
    await expect(
      asActor(counter, () => service.update('p1', { identifierValue: '900101145566' })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.patient.update).not.toHaveBeenCalled();
  });

  it('says so when the clash is a DEACTIVATED record, rather than "nothing found"', async () => {
    // A soft-deleted patient still holds the unique constraint. Reporting the
    // IC as free would be a lie the save then contradicts with a 500.
    const { service } = createService(counter, {
      clash: { id: 'p3', name: 'Old duplicate', deletedAt: new Date('2026-01-01') },
    });
    await expect(
      asActor(counter, () => service.update('p1', { identifierValue: '900101145566' })),
    ).rejects.toThrow(/deactivated patient record/i);
  });

  it('checks the OTHER patients, not this one — re-saving your own IC is not a clash', async () => {
    const { service, tx } = createService(counter);
    await asActor(counter, () => service.update('p1', { identifierValue: '900101145566' }));
    expect(tx.patient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 'p1' } }) }),
    );
  });
});

describe('the change is answerable later', () => {
  it('records old value, new value, who and when — one row per field', async () => {
    const { service, tx } = createService(counter);
    await asActor(counter, () =>
      service.update('p1', { identifierValue: '900101145566', dob: '1990-01-01' }),
    );

    const written = tx.patientIdentityChange.createMany.mock.calls[0][0].data;
    expect(written).toHaveLength(2);
    expect(written).toContainEqual(
      expect.objectContaining({
        field: 'identifierValue',
        oldValue: '12345678901',
        newValue: '900101145566',
      }),
    );
    expect(written).toContainEqual(
      expect.objectContaining({ field: 'dob', oldValue: '2026-05-05', newValue: '1990-01-01' }),
    );
  });

  it('names the author by a SNAPSHOT, not a join', async () => {
    // A counter clerk who leaves next year must not turn this correction into
    // a blank. Same reasoning as every other identity snapshot here.
    const { service, tx } = createService(counter);
    await asActor(counter, () => service.update('p1', { identifierValue: '900101145566' }));

    expect(tx.patientIdentityChange.createMany.mock.calls[0][0].data[0]).toMatchObject({
      changedByStaffId: 'staff-fd',
      changedByNameSnapshot: 'Nurul at the counter',
      changedByRoleSnapshot: 'FRONT_DESK_CLINICAL_STAFF',
    });
  });

  it('writes the record in the SAME transaction as the change', async () => {
    // A correction that lands while its record fails to is the silent edit
    // this table exists to prevent.
    const { service, tx, service: _ } = createService(counter);
    void _;
    await asActor(counter, () => service.update('p1', { identifierValue: '900101145566' }));
    expect(tx.patient.update).toHaveBeenCalled();
    expect(tx.patientIdentityChange.createMany).toHaveBeenCalled();
  });

  it('records nothing when the save is refused', async () => {
    const { service, tx } = createService(counter, {
      clash: { id: 'p2', name: 'Someone else', deletedAt: null },
    });
    await expect(
      asActor(counter, () => service.update('p1', { identifierValue: '900101145566' })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.patientIdentityChange.createMany).not.toHaveBeenCalled();
  });
});

describe('an already-issued document keeps the IC it was issued with', () => {
  it('a correction writes to the patient and the change record — and NOTHING else', async () => {
    // Asserted structurally, because that is where the guarantee actually
    // lives. `identifier_value` exists on exactly one table: `patients`. A
    // document's content is a string rendered and frozen at issue, and there is
    // no e-Invoice table yet — so nothing anywhere holds a COPY of the
    // identifier that a correction could silently rewrite.
    //
    // This is the test that would catch a regression: if somebody later adds an
    // IC snapshot to documents or claims and wires it into this path, a write
    // appears on the transaction that is not one of these two, and this fails.
    // A test asserting "the document still says 900101…" would pass whether or
    // not that snapshot existed.
    const { service, tx } = createService(counter);
    await asActor(counter, () => service.update('p1', { identifierValue: '900101145566' }));

    const written = Object.entries(tx)
      .filter(([, model]) => model && typeof model === 'object')
      .flatMap(([name, model]) =>
        Object.entries(model as Record<string, jest.Mock>)
          .filter(([op, fn]) => /create|update|delete|upsert/i.test(op) && fn.mock?.calls.length)
          .map(([op]) => `${name}.${op}`),
      );

    expect(written.sort()).toEqual(['patient.update', 'patientIdentityChange.createMany']);
  });
});
