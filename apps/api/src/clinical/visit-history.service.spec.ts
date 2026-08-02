import { NotFoundException } from '@nestjs/common';
import { VisitHistoryService } from './visit-history.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

// G4 (D-067) — reading a previous visit is a different operation from working
// on the current one, and it has its own authorisation. The audit found the
// existing `/visits` routes checked neither branch access nor the
// patient/visit relationship: any visit id in the tenant could be read by
// anyone who knew it. These tests are the guard on that.

const VISIT = {
  id: 'visit-9',
  patientId: 'patient-1',
  clinicId: 'clinic-1',
  visitNumber: 'V-000009',
  checkInAt: new Date('2026-05-01T09:00:00Z'),
  checkOutAt: null,
  billingType: 'Cash',
  presentingComplaint: 'Cough',
  staff: { id: 'staff-2', fullName: 'Dr Amira', role: 'DOCTOR_RESIDENT' },
  clinic: { id: 'clinic-1', name: 'Main Branch' },
  queueTicket: null,
};

function createService(options: {
  staffClinicId?: string | null;
  branchCount?: number;
  authorisedClinicIds?: string[];
  active?: boolean;
} = {}) {
  const tx = {
    $executeRaw: jest.fn(),
    staff: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'staff-1',
        fullName: 'Dr Test',
        role: 'DOCTOR_RESIDENT',
        active: options.active ?? true,
        clinicId: options.staffClinicId === undefined ? 'clinic-1' : options.staffClinicId,
        userId: 'user-1',
      }),
    },
    clinic: { count: jest.fn().mockResolvedValue(options.branchCount ?? 1) },
    userClinicAccess: {
      findMany: jest.fn().mockResolvedValue((options.authorisedClinicIds ?? []).map((clinicId) => ({ clinicId }))),
    },
    patient: { findUnique: jest.fn().mockResolvedValue({ id: 'patient-1' }) },
    visit: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(VISIT),
    },
    clinicalNote: { findMany: jest.fn().mockResolvedValue([]) },
    visitObservation: { findMany: jest.fn().mockResolvedValue([]) },
    diagnosis: { findMany: jest.fn().mockResolvedValue([]) },
    orderService: { findMany: jest.fn().mockResolvedValue([]) },
    prescription: { findMany: jest.fn().mockResolvedValue([]) },
    document: { findMany: jest.fn().mockResolvedValue([]) },
    visitAttachment: { findMany: jest.fn().mockResolvedValue([]) },
    invoice: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const rawPrisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;
  const prisma = {} as unknown as TenantScopedPrismaClient;
  return { service: new VisitHistoryService(prisma, rawPrisma), tx };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant', staffId: 'staff-1' }, fn);
}

describe('VisitHistoryService — access', () => {
  it('refuses a visit that belongs to a different patient', async () => {
    const { service } = createService();
    await expect(withTenant(() => service.findForPatient('patient-OTHER', 'visit-9'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('refuses a visit in a branch the staff member is not authorised for', async () => {
    // Two branches, home branch elsewhere, no explicit grant.
    const { service } = createService({ branchCount: 2, staffClinicId: 'clinic-2', authorisedClinicIds: [] });
    await expect(withTenant(() => service.findForPatient('patient-1', 'visit-9'))).rejects.toThrow(NotFoundException);
  });

  it('allows a visit in a branch the staff member has explicit access to', async () => {
    const { service } = createService({ branchCount: 2, staffClinicId: 'clinic-2', authorisedClinicIds: ['clinic-1'] });
    const result = await withTenant(() => service.findForPatient('patient-1', 'visit-9'));
    expect(result.visit.id).toBe('visit-9');
  });

  it('refuses an unknown visit id', async () => {
    const { service, tx } = createService();
    tx.visit.findUnique.mockResolvedValue(null);
    await expect(withTenant(() => service.findForPatient('patient-1', 'nope'))).rejects.toThrow(NotFoundException);
  });

  it('refuses an unknown patient before listing anything', async () => {
    const { service, tx } = createService();
    tx.patient.findUnique.mockResolvedValue(null);
    await expect(withTenant(() => service.listForPatient('ghost', {}))).rejects.toThrow(NotFoundException);
    expect(tx.visit.findMany).not.toHaveBeenCalled();
  });

  it('refuses an inactive staff account', async () => {
    const { service } = createService({ active: false });
    await expect(withTenant(() => service.listForPatient('patient-1', {}))).rejects.toThrow();
  });

  it('restricts the LIST to readable branches rather than filtering after the fact', async () => {
    const { service, tx } = createService({ branchCount: 3, staffClinicId: 'clinic-2', authorisedClinicIds: ['clinic-5'] });
    await withTenant(() => service.listForPatient('patient-1', {}));
    const where = tx.visit.findMany.mock.calls[0][0].where;
    expect(where.clinicId.in.sort()).toEqual(['clinic-2', 'clinic-5']);
    // The count must use the same filter, or "12 visits" would include ones
    // the reader may never see.
    expect(tx.visit.count.mock.calls[0][0].where.clinicId.in.sort()).toEqual(['clinic-2', 'clinic-5']);
  });

  it('fails closed for a staff member with no branch at all in a multi-branch tenant', async () => {
    const { service, tx } = createService({ branchCount: 2, staffClinicId: null, authorisedClinicIds: [] });
    await withTenant(() => service.listForPatient('patient-1', {}));
    expect(tx.visit.findMany.mock.calls[0][0].where.clinicId.in).toEqual([]);
  });

  it('does not restrict by branch in a single-branch tenant', async () => {
    const { service, tx } = createService({ branchCount: 1 });
    await withTenant(() => service.listForPatient('patient-1', {}));
    expect(tx.visit.findMany.mock.calls[0][0].where.clinicId).toBeUndefined();
  });
});

describe('VisitHistoryService — paging and search', () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      ...VISIT,
      id: `visit-${i}`,
      diagnoses: [],
      prescriptions: [],
      documents: [],
    }));

  it('pages with a cursor and reports whether more history exists', async () => {
    const { service, tx } = createService();
    tx.visit.findMany.mockResolvedValue(rows(11)); // take + 1
    const page = await withTenant(() => service.listForPatient('patient-1', { limit: 10 }));
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBe('visit-9');
  });

  it('reports no further page when the history ends', async () => {
    const { service, tx } = createService();
    tx.visit.findMany.mockResolvedValue(rows(4));
    const page = await withTenant(() => service.listForPatient('patient-1', { limit: 10 }));
    expect(page.nextCursor).toBeNull();
  });

  it('caps the page size a caller can ask for', async () => {
    const { service, tx } = createService();
    await withTenant(() => service.listForPatient('patient-1', { limit: 5000 }));
    expect(tx.visit.findMany.mock.calls[0][0].take).toBe(26); // 25 + 1
  });

  it('searches the whole stored history, not just the loaded page', async () => {
    const { service, tx } = createService();
    await withTenant(() => service.listForPatient('patient-1', { search: 'amoxicillin' }));
    const or = tx.visit.findMany.mock.calls[0][0].where.OR;
    const targets = JSON.stringify(or);
    expect(targets).toContain('prescriptions');
    expect(targets).toContain('diagnoses');
    expect(targets).toContain('icd10Code');
    expect(targets).toContain('visitNumber');
  });

  it('applies a date range to the stored check-in time', async () => {
    const { service, tx } = createService();
    await withTenant(() => service.listForPatient('patient-1', { from: '2026-01-01', to: '2026-02-01' }));
    const where = tx.visit.findMany.mock.calls[0][0].where;
    expect(where.checkInAt.gte).toEqual(new Date('2026-01-01'));
    expect(where.checkInAt.lte).toEqual(new Date('2026-02-01'));
  });

  it('orders newest first', async () => {
    const { service, tx } = createService();
    await withTenant(() => service.listForPatient('patient-1', {}));
    expect(tx.visit.findMany.mock.calls[0][0].orderBy[0]).toEqual({ checkInAt: 'desc' });
  });
});

describe('VisitHistoryService — summaries say only what is stored', () => {
  const listWith = async (overrides: Record<string, unknown>) => {
    const { service, tx } = createService();
    tx.visit.findMany.mockResolvedValue([
      { ...VISIT, diagnoses: [], prescriptions: [], documents: [], ...overrides },
    ]);
    const page = await withTenant(() => service.listForPatient('patient-1', {}));
    return page.items[0];
  };

  it('puts the recorded PRIMARY diagnosis first and counts the rest', async () => {
    const item = await listWith({
      diagnoses: [
        { id: 'd1', name: 'Anaemia', icd10Code: 'D64.9', priority: 'SECONDARY' },
        { id: 'd2', name: 'Dengue fever', icd10Code: 'A90', priority: 'PRIMARY' },
      ],
    });
    expect(item.primaryDiagnosis).toEqual({ name: 'Dengue fever', icd10Code: 'A90', isPrimary: true });
    expect(item.diagnosisCount).toBe(2);
  });

  it('does not claim a diagnosis is primary when priority was never recorded', async () => {
    const item = await listWith({
      diagnoses: [{ id: 'd1', name: 'Acute gastritis', icd10Code: null, priority: null }],
    });
    expect(item.primaryDiagnosis?.isPrimary).toBe(false);
  });

  it('shows the first three medications and the true total', async () => {
    const item = await listWith({
      prescriptions: [1, 2, 3, 4, 5].map((n) => ({
        id: `p${n}`,
        status: 'DISPENSED',
        item: { name: `Drug ${n}`, strengthMg: null },
      })),
    });
    expect(item.medications).toHaveLength(3);
    expect(item.medicationCount).toBe(5);
  });

  it('counts only ACTIVE documents and reports voided ones separately', async () => {
    const item = await listWith({
      documents: [
        { id: 'x1', type: 'MC', title: null, startDate: new Date('2026-05-01'), endDate: new Date('2026-05-02'), referredTo: null, recordStatus: 'ACTIVE' },
        { id: 'x2', type: 'MC', title: null, startDate: null, endDate: null, referredTo: null, recordStatus: 'VOIDED' },
      ],
    });
    expect(item.documentCount).toBe(1);
    expect(item.voidedDocumentCount).toBe(1);
    // The voided MC must not be the one summarised.
    expect(item.mc?.endDate).toEqual(new Date('2026-05-02'));
  });

  it('reports no MC and no referral rather than empty labels when none exist', async () => {
    const item = await listWith({});
    expect(item.mc).toBeNull();
    expect(item.referral).toBeNull();
  });

  it('carries the referral recipient where one is stored', async () => {
    const item = await listWith({
      documents: [
        { id: 'r1', type: 'REFERRAL', title: 'Ortho referral', startDate: null, endDate: null, referredTo: 'HKL Orthopaedics', recordStatus: 'ACTIVE' },
      ],
    });
    expect(item.referral).toEqual({ referredTo: 'HKL Orthopaedics', title: 'Ortho referral' });
  });
});

describe('VisitHistoryService — read-only by construction', () => {
  it('exposes no method that could write', () => {
    const methods = Object.getOwnPropertyNames(VisitHistoryService.prototype);
    expect(methods.sort()).toEqual(['constructor', 'findForPatient', 'listForPatient', 'readableClinicFilter'].sort());
  });

  it('reviewing a visit issues no write of any kind', async () => {
    const { service, tx } = createService();
    await withTenant(() => service.findForPatient('patient-1', 'visit-9'));
    for (const model of Object.values(tx) as Record<string, unknown>[]) {
      if (model && typeof model === 'object') {
        for (const [name, fn] of Object.entries(model)) {
          if (/^(create|update|delete|upsert)/.test(name)) {
            expect(fn).not.toHaveBeenCalled();
          }
        }
      }
    }
  });
});
