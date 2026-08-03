import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VisitService, formatVisitNumber } from './visit.service';
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
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
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

  it('does not truncate a number that outgrows six digits', () => {
    expect(formatVisitNumber(1000000)).toBe('V-1000000');
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
