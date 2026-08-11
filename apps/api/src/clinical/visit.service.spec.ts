import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MAX_VISIT_NUMBER, VisitService, formatVisitNumber, isVisitNumberConflict } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

// G4c1 (D-068) — creation now runs in one transaction that allocates the
// number and inserts the visit together, so the mock is the transaction
// client rather than the tenant-scoped model client.
function createService(options: { allocations?: number[] } = {}) {
  const allocations = options.allocations ?? [1];
  let allocationIndex = 0;

  const tx = {
    $executeRaw: jest.fn(),
    // D-069 — creation now resolves every submitted id under the tenant
    // transaction before writing, so the mock must answer those lookups.
    staff: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'staff-1', fullName: 'Dr Test', role: 'DOCTOR_RESIDENT',
        active: true, clinicId: 'clinic-1', userId: 'user-1',
      }),
    },
    patient: { findUnique: jest.fn().mockResolvedValue({ id: 'patient-1', name: 'Test Patient' }) },
    clinic: {
      findUnique: jest.fn().mockResolvedValue({ id: 'clinic-1', name: 'Main' }),
      count: jest.fn().mockResolvedValue(1),
    },
    userClinicAccess: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockImplementation(() => {
      const value = allocations[Math.min(allocationIndex, allocations.length - 1)];
      allocationIndex += 1;
      return Promise.resolve([{ next_value: value }]);
    }),
    panelClinic: { findUnique: jest.fn() },
    visit: { create: jest.fn().mockResolvedValue({ id: 'visit-1' }) },
  };

  const rawPrisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const prisma = { visit: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() } } as unknown as TenantScopedPrismaClient;

  return { service: new VisitService(prisma, rawPrisma), tx, rawPrisma };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant', staffId: 'staff-1' }, fn);
}

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['tenant_id', 'visit_number'] },
  });

// withTenantTx sets app.tenant_id through $executeRaw on every transaction,
// so a repair is identified by its own SQL rather than by call position.
function repairStatements(tx: { $executeRaw: jest.Mock }): string[] {
  return tx.$executeRaw.mock.calls.map((c) => String(c[0])).filter((sql) => sql.includes('GREATEST'));
}

const BASE = {
  clinicId: 'clinic-1',
  patientId: 'patient-1',
  staffId: 'staff-1',
  billingType: 'Self-pay',
};

describe('visit number format', () => {
  it('pads to the established six-digit shape', () => {
    expect(formatVisitNumber(1)).toBe('V-000001');
    expect(formatVisitNumber(42)).toBe('V-000042');
    expect(formatVisitNumber(999999)).toBe('V-999999');
  });

  it('refuses to allocate past the six-digit ceiling', async () => {
    const { service } = createService({ allocations: [MAX_VISIT_NUMBER + 1] });
    await expect(withTenant(() => service.create(BASE))).rejects.toThrow(/maximum visit number/i);
  });

  it('still allocates the last number the format can hold', async () => {
    const { service, tx } = createService({ allocations: [MAX_VISIT_NUMBER] });
    await withTenant(() => service.create(BASE));
    expect(tx.visit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ visitNumber: 'V-999999' }),
    });
  });
});

describe('VisitService.create — allocation', () => {
  it('allocates the number and inserts the visit in ONE transaction', async () => {
    const { service, tx, rawPrisma } = createService();
    await withTenant(() => service.create(BASE));

    expect(rawPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.visit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ visitNumber: 'V-000001' }),
    });
  });

  it('never derives the number from a row count', async () => {
    const { service, tx } = createService({ allocations: [7] });
    await withTenant(() => service.create(BASE));

    // The allocator is a counter increment; nothing counts visit rows.
    const sql = String(tx.$queryRaw.mock.calls[0][0]);
    expect(sql).toContain('visit_number_counters');
    expect(sql).not.toMatch(/count\s*\(/i);
    expect(sql).not.toContain('FROM "visits"');
    expect(tx.visit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ visitNumber: 'V-000007' }),
    });
  });

  it('classifies only the visit-number constraint as a numbering conflict', () => {
    const withConstraint = (message: string) =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002', clientVersion: 'test',
        meta: { driverAdapterError: { cause: { originalMessage: message } } },
      });
    expect(isVisitNumberConflict(withConstraint('… unique constraint \"visits_tenant_id_visit_number_key\"'))).toBe(true);
    expect(isVisitNumberConflict(withConstraint('… unique constraint \"patients_tenant_id_identifier_key\"'))).toBe(false);
    expect(isVisitNumberConflict(withConstraint('… unique constraint \"invoices_tenant_id_invoice_number_key\"'))).toBe(false);
  });

  it('retries past a unique-index collision instead of failing', async () => {
    const { service, tx, rawPrisma } = createService({ allocations: [5, 9] });
    tx.visit.create
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce({ id: 'visit-2' });

    await withTenant(() => service.create(BASE));

    // One failed attempt, one repair transaction, one successful attempt.
    expect(rawPrisma.$transaction).toHaveBeenCalledTimes(3);
    expect(tx.visit.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ visitNumber: 'V-000009' }),
    });
  });

  it('repairs the counter from the highest number actually in use', async () => {
    const { service, tx } = createService({ allocations: [5, 9] });
    tx.visit.create.mockRejectedValueOnce(uniqueViolation()).mockResolvedValueOnce({ id: 'visit-2' });

    await withTenant(() => service.create(BASE));

    const repair = repairStatements(tx).join(' ');
    expect(repair).toContain('GREATEST');
    expect(repair).toContain('MAX(substring');
  });

  it('surfaces a controlled conflict, never a raw unique-constraint error', async () => {
    const { service, tx } = createService();
    tx.visit.create.mockRejectedValue(uniqueViolation());

    await expect(withTenant(() => service.create(BASE))).rejects.toThrow(ConflictException);
  });

  it('does not swallow an unrelated failure as a numbering problem', async () => {
    const { service, tx } = createService();
    tx.visit.create.mockRejectedValue(new Error('connection lost'));

    await expect(withTenant(() => service.create(BASE))).rejects.toThrow('connection lost');
    expect(repairStatements(tx)).toHaveLength(0);
  });
});

describe('VisitService.create — billing type', () => {
  it('derives billingType from the panel name when panelClinicId is given', async () => {
    const { service, tx } = createService();
    tx.panelClinic.findUnique.mockResolvedValue({ id: 'panel-1', name: 'AIA' });

    await withTenant(() =>
      service.create({ ...BASE, billingType: 'ignored client text', panelClinicId: 'panel-1' }),
    );

    expect(tx.visit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ billingType: 'AIA', panelClinicId: 'panel-1' }),
    });
  });

  // G4.5d3c-3b1a (D-092) — selecting a panel is NOT verifying it.
  it('a panel visit starts PENDING_VERIFICATION', async () => {
    const { service, tx } = createService();
    tx.panelClinic.findUnique.mockResolvedValue({ id: 'panel-1', name: 'AIA' });
    await withTenant(() => service.create({ ...BASE, panelClinicId: 'panel-1' }));
    expect(tx.visit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ panelVerificationStatus: 'PENDING_VERIFICATION' }),
    });
  });

  it('a cash visit carries no verification state at all', async () => {
    const { service, tx } = createService();
    await withTenant(() => service.create(BASE));
    expect(tx.visit.create.mock.calls[0][0].data.panelVerificationStatus).toBeUndefined();
  });

  it('throws NotFoundException for an unknown panelClinicId', async () => {
    const { service, tx } = createService();
    tx.panelClinic.findUnique.mockResolvedValue(null);

    await expect(
      withTenant(() => service.create({ ...BASE, panelClinicId: 'missing' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('does not consume a visit number when the panel lookup fails', async () => {
    const { service, tx } = createService();
    tx.panelClinic.findUnique.mockResolvedValue(null);

    await expect(
      withTenant(() => service.create({ ...BASE, panelClinicId: 'missing' })),
    ).rejects.toThrow(NotFoundException);

    // Panel resolution happens first, so nothing was allocated at all; and had
    // it been, the transaction rollback would have undone it.
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.visit.create).not.toHaveBeenCalled();
  });

  it('uses the client-supplied billingType when no panelClinicId is given (cash visit)', async () => {
    const { service, tx } = createService();

    await withTenant(() => service.create(BASE));

    expect(tx.panelClinic.findUnique).not.toHaveBeenCalled();
    expect(tx.visit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ billingType: 'Self-pay', panelClinicId: undefined }),
    });
  });
});

// =============================================================================
// G4c1 closure (D-069) — every submitted id is resolved under the authenticated
// tenant before anything is written. The defect: a token for one tenant could
// create a visit using another tenant's patientId, because a foreign key is
// enforced BELOW row-level security and simply accepted it.
// =============================================================================
describe('VisitService.create — relationship validation', () => {
  it('creates the visit when every reference resolves in this tenant', async () => {
    const { service, tx } = createService();
    await withTenant(() => service.create(BASE));
    expect(tx.visit.create).toHaveBeenCalled();
  });

  it('rejects a patient that is not visible in this tenant', async () => {
    const { service, tx } = createService();
    // RLS makes another tenant's row simply absent — the same result as an
    // id that never existed.
    tx.patient.findUnique.mockResolvedValue(null);
    await expect(withTenant(() => service.create(BASE))).rejects.toThrow(NotFoundException);
  });

  it('does not reveal whether an inaccessible patient exists', async () => {
    const { service, tx } = createService();
    tx.patient.findUnique.mockResolvedValue(null);
    await expect(withTenant(() => service.create(BASE))).rejects.toThrow('Patient not found');
  });

  it('rejects a clinic that is not visible in this tenant', async () => {
    const { service, tx } = createService();
    tx.clinic.findUnique.mockResolvedValue(null);
    await expect(withTenant(() => service.create(BASE))).rejects.toThrow(NotFoundException);
  });

  it('refuses a branch the acting staff member may not use', async () => {
    const { service, tx } = createService();
    // Multi-branch tenant, actor's home branch is elsewhere, no explicit grant.
    tx.clinic.count.mockResolvedValue(3);
    tx.staff.findUnique.mockResolvedValue({
      id: 'staff-1', fullName: 'Dr Test', role: 'DOCTOR_RESIDENT',
      active: true, clinicId: 'clinic-OTHER', userId: 'user-1',
    });
    await expect(withTenant(() => service.create(BASE))).rejects.toThrow(ForbiddenException);
  });

  it('rejects a staff member that is not visible in this tenant', async () => {
    const { service, tx } = createService();
    tx.staff.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        where.id === 'staff-1'
          ? { id: 'staff-1', fullName: 'Actor', role: 'OWNER_ADMIN', active: true, clinicId: 'clinic-1', userId: 'u1' }
          : null,
      ),
    );
    await expect(
      withTenant(() => service.create({ ...BASE, staffId: 'staff-FOREIGN' })),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects an inactive staff member as attending', async () => {
    const { service, tx } = createService();
    tx.staff.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        where.id === 'staff-1'
          ? { id: 'staff-1', fullName: 'Actor', role: 'OWNER_ADMIN', active: true, clinicId: 'clinic-1', userId: 'u1' }
          : { id: where.id, fullName: 'Retired', role: 'DOCTOR_LOCUM', active: false, clinicId: 'clinic-1', userId: 'u2' },
      ),
    );
    await expect(
      withTenant(() => service.create({ ...BASE, staffId: 'staff-INACTIVE' })),
    ).rejects.toThrow('That staff member is not active.');
  });

  it('rejects an attending staff member without access to the visit branch', async () => {
    const { service, tx } = createService();
    tx.clinic.count.mockResolvedValue(3);
    tx.staff.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        where.id === 'staff-1'
          ? { id: 'staff-1', fullName: 'Actor', role: 'OWNER_ADMIN', active: true, clinicId: 'clinic-1', userId: 'u1' }
          : { id: where.id, fullName: 'Other branch', role: 'DOCTOR_LOCUM', active: true, clinicId: 'clinic-9', userId: 'u2' },
      ),
    );
    await expect(
      withTenant(() => service.create({ ...BASE, staffId: 'staff-ELSEWHERE' })),
    ).rejects.toThrow('not authorised for this branch');
  });

  // SUPERSEDED BY S3c (D-082). This used to assert that ANY active in-branch
  // staff member could be stored as the attending clinician — which was not a
  // policy so much as a consequence: `staffId` was NOT NULL, so front desk
  // registering a walk-in had to name somebody, and the only somebody
  // available was themselves.
  //
  // The field is nullable now, so D-044's real requirement — register a
  // walk-in before a doctor is known — is met honestly, and the attending
  // clinician can be held to actually being a clinician.
  it('front desk registers a walk-in with NO attending clinician (D-044, corrected)', async () => {
    const { service, tx } = createService();

    await withTenant(() => service.create({ ...BASE, staffId: undefined }));

    expect(tx.visit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        staffId: null,
        // ...and the registrar is recorded where it belongs, from the
        // authenticated session rather than the request.
        registeredByStaffId: 'staff-1',
      }),
    });
  });

  it('a non-doctor can no longer be stored as the attending clinician', async () => {
    const { service, tx } = createService();
    tx.staff.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({
        id: where.id, fullName: 'Front Desk', role: 'FRONT_DESK_CLINICAL_STAFF',
        active: true, clinicId: 'clinic-1', userId: 'u1',
      }),
    );

    await expect(
      withTenant(() => service.create({ ...BASE, staffId: 'staff-FRONTDESK' })),
    ).rejects.toThrow(BadRequestException);
    expect(tx.visit.create).not.toHaveBeenCalled();
  });

  it('writes the RESOLVED ids, never the raw request values', async () => {
    const { service, tx } = createService();
    tx.patient.findUnique.mockResolvedValue({ id: 'patient-RESOLVED', name: 'P' });
    tx.clinic.findUnique.mockResolvedValue({ id: 'clinic-RESOLVED', name: 'C' });
    await withTenant(() => service.create(BASE));
    expect(tx.visit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ patientId: 'patient-RESOLVED', clinicId: 'clinic-RESOLVED' }),
    });
  });

  it('allocates NO visit number when a relationship fails validation', async () => {
    const { service, tx } = createService();
    tx.patient.findUnique.mockResolvedValue(null);
    await expect(withTenant(() => service.create(BASE))).rejects.toThrow(NotFoundException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.visit.create).not.toHaveBeenCalled();
  });

  it('validates before allocating, in that order', async () => {
    const { service, tx } = createService();
    await withTenant(() => service.create(BASE));
    const patientCall = tx.patient.findUnique.mock.invocationCallOrder[0];
    const clinicCall = tx.clinic.findUnique.mock.invocationCallOrder[0];
    const allocationCall = tx.$queryRaw.mock.invocationCallOrder[0];
    expect(patientCall).toBeLessThan(allocationCall);
    expect(clinicCall).toBeLessThan(allocationCall);
  });

  it('refuses to create a visit with no authenticated staff session', async () => {
    const { service } = createService();
    await expect(
      tenantContextStorage.run({ tenantId: 'test-tenant' }, () => service.create(BASE)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('turns a late foreign-key failure into a controlled conflict, not a 500', async () => {
    const { service, tx } = createService();
    tx.visit.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('FK failed', { code: 'P2003', clientVersion: 'test' }),
    );
    await expect(withTenant(() => service.create(BASE))).rejects.toThrow(ConflictException);
  });
});
