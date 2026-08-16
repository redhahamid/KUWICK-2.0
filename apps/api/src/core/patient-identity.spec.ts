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

  it('a doctor cannot, and is told what to do instead of opening a second file', async () => {
    // Not a slight on doctors: an identifier correction is records
    // administration, and the counter is where the IC was read off the card.
    const { service, tx } = createService(doctor);
    await expect(
      asActor(doctor, () => service.update('p1', { identifierValue: '900101145566' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.patient.update).not.toHaveBeenCalled();

    await expect(
      asActor(doctor, () => service.update('p1', { identifierValue: '900101145566' })),
    ).rejects.toThrow(/do not create a second record/i);
  });

  it('a doctor can still fix a phone number — only the identifier is gated', async () => {
    // The whole profile form posts on every save. If any save demanded the
    // identity permission, this fix would have taken away demographics editing
    // from everyone who had it.
    const { service, scoped, tx } = createService(doctor);
    await asActor(doctor, () => service.update('p1', { phone: '0111111111' }));
    expect(scoped.patient.update).toHaveBeenCalled();
    expect(tx.patient.update).not.toHaveBeenCalled();
  });

  it('re-submitting the SAME IC is not a correction and needs no permission', async () => {
    // The form submits every field it holds, so "the IC is in the payload"
    // says nothing about whether it moved.
    const { service, scoped, tx } = createService(doctor);
    await asActor(doctor, () =>
      service.update('p1', { identifierValue: '12345678901', dob: '2026-05-05', phone: '0111111111' }),
    );
    expect(scoped.patient.update).toHaveBeenCalled();
    expect(tx.patientIdentityChange.createMany).not.toHaveBeenCalled();
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
