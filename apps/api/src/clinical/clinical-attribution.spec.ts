import { ForbiddenException } from '@nestjs/common';
import { PrescriptionService } from './prescription.service';
import { VisitService } from './visit.service';
import { DocumentService } from './document.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';
import { DocumentType } from '@prisma/client';

// ===========================================================================
// G4.5d3c-1c (D-085) — CLINICAL ATTRIBUTION
//
// The rule these tests exist to hold: the clinical author of an action is the
// authenticated person who PERFORMED it. Never the visit's attending doctor
// by default, and never a name supplied by the browser.
//
// The old behaviour recorded Dr A as the prescriber of medication written by
// anyone at all, purely because the visit was assigned to Dr A. That is a
// medico-legal statement about who exercised clinical judgement, and getting
// it wrong is not a cosmetic problem.
// ===========================================================================

const DR_A = { id: 'dr-a', fullName: 'Dr Amira', role: 'DOCTOR_RESIDENT', active: true };
const DR_B = { id: 'dr-b', fullName: 'Dr Bakri', role: 'DOCTOR_LOCUM', active: true };
const FRONT_DESK = { id: 'fd-1', fullName: 'Amy Counter', role: 'FRONT_DESK_CLINICAL_STAFF', active: true };
const FINANCE = { id: 'fin-1', fullName: 'Faiz Finance', role: 'FINANCE_STAFF', active: true };

const ITEM = { id: 'item-1', name: 'Paracetamol', ageDosages: [], concVolMl: null, strengthMg: null };
const RX = { visitId: 'visit-1', itemId: 'item-1', quantity: 1, amount: 1, frequency: 'TDS', durationDays: 3 };

function prescriptions(staffDirectory: Record<string, unknown>) {
  const prisma = {
    item: { findUnique: jest.fn().mockResolvedValue(ITEM) },
    prescription: { create: jest.fn().mockResolvedValue({ id: 'rx-1' }), findMany: jest.fn() },
    staff: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => staffDirectory[where.id] ?? null),
    },
  } as unknown as TenantScopedPrismaClient;
  // The visit belongs to Dr A throughout, so every assertion below
  // discriminates rather than passing by coincidence.
  const visits = {
    findById: jest.fn().mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1', staffId: DR_A.id }),
  } as unknown as VisitService;
  return { service: new PrescriptionService(prisma, visits), prisma, visits };
}

function documents(staffDirectory: Record<string, unknown>) {
  const prisma = {
    document: { create: jest.fn().mockResolvedValue({ id: 'doc-1' }) },
    customDocumentTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
    staff: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => staffDirectory[where.id] ?? null),
    },
  } as unknown as TenantScopedPrismaClient;
  const visits = {
    findById: jest.fn().mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1', staffId: DR_A.id }),
  } as unknown as VisitService;
  const rawPrisma = {} as unknown as PrismaService;
  return { service: new DocumentService(prisma, rawPrisma, visits), prisma };
}

function as<T>(staffId: string | undefined, fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant', staffId } as never, fn);
}

const directory = (...staff: Array<Record<string, unknown>>) =>
  Object.fromEntries(staff.map((s) => [s.id as string, s]));

describe('D-085 — prescriptions are authored by whoever wrote them', () => {
  it('1. Dr A prescribing on Dr A’s visit is recorded as Dr A', async () => {
    const { service, prisma } = prescriptions(directory(DR_A));
    await as(DR_A.id, () => service.create(RX as never));
    expect((prisma.prescription.create as jest.Mock).mock.calls[0][0].data.prescribedByStaffId).toBe(DR_A.id);
  });

  it('2. Dr B prescribing on Dr A’s visit is recorded as Dr B, not Dr A', async () => {
    const { service, prisma } = prescriptions(directory(DR_A, DR_B));
    await as(DR_B.id, () => service.create(RX as never));
    // The single most important assertion in this file.
    expect((prisma.prescription.create as jest.Mock).mock.calls[0][0].data.prescribedByStaffId).toBe(DR_B.id);
  });

  it('3. front desk cannot become the author of a prescription', async () => {
    const { service, prisma } = prescriptions(directory(DR_A, FRONT_DESK));
    await expect(as(FRONT_DESK.id, () => service.create(RX as never))).rejects.toThrow(ForbiddenException);
    expect(prisma.prescription.create).not.toHaveBeenCalled();
  });

  it('4. front desk cannot silently create a prescription attributed to Dr A', async () => {
    const { service, prisma } = prescriptions(directory(DR_A, FRONT_DESK));
    await expect(as(FRONT_DESK.id, () => service.create(RX as never))).rejects.toThrow(ForbiddenException);
    // The refusal is the point: there is no path that writes Dr A's name here.
    const written = (prisma.prescription.create as jest.Mock).mock.calls;
    expect(written).toHaveLength(0);
  });

  it('4b. finance staff cannot prescribe either', async () => {
    const { service } = prescriptions(directory(DR_A, FINANCE));
    await expect(as(FINANCE.id, () => service.create(RX as never))).rejects.toThrow(ForbiddenException);
  });

  it('4c. an inactive doctor cannot prescribe', async () => {
    const { service } = prescriptions(directory({ ...DR_A, active: false }));
    await expect(as(DR_A.id, () => service.create(RX as never))).rejects.toThrow(ForbiddenException);
  });

  it('4d. an anonymous session cannot prescribe', async () => {
    const { service } = prescriptions(directory(DR_A));
    await expect(as(undefined, () => service.create(RX as never))).rejects.toThrow(ForbiddenException);
  });

  it('the role is checked BEFORE the visit is read, so a refusal leaks nothing', async () => {
    const { service, visits } = prescriptions(directory(FRONT_DESK));
    await expect(as(FRONT_DESK.id, () => service.create(RX as never))).rejects.toThrow(ForbiddenException);
    expect(visits.findById).not.toHaveBeenCalled();
  });

  it('7. an UNASSIGNED visit does not fall back to the registrar', async () => {
    const { service, prisma, visits } = prescriptions(directory(DR_B));
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1', staffId: null });

    await as(DR_B.id, () => service.create(RX as never));

    // The author is the prescribing doctor, and no substitution happened —
    // not the registrar, not the front desk actor, not "some clinic staff".
    expect((prisma.prescription.create as jest.Mock).mock.calls[0][0].data.prescribedByStaffId).toBe(DR_B.id);
  });

  it('7b. an unassigned visit still refuses a non-clinical author', async () => {
    const { service, visits } = prescriptions(directory(FRONT_DESK));
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1', staffId: null });
    // "Nobody is attending" is not a reason to lower the bar for who may
    // prescribe. The action is rejected rather than attributed to anyone.
    await expect(as(FRONT_DESK.id, () => service.create(RX as never))).rejects.toThrow(ForbiddenException);
  });
});

describe('D-085 — documents record a creator, which is not a clinical claim', () => {
  const draft = { visitId: 'visit-1', type: DocumentType.MC, content: '3 days rest' };

  it('5. a front-desk-created draft records FRONT DESK as creator, not Dr A', async () => {
    const { service, prisma } = documents(directory(DR_A, FRONT_DESK));

    await as(FRONT_DESK.id, () => service.create(draft as never));

    const data = (prisma.document.create as jest.Mock).mock.calls[0][0].data;
    expect(data.issuedByStaffId).toBe(FRONT_DESK.id);
    // Creating a draft makes no clinical claim, so nothing here is signed or
    // authorised — that is a separate act, by a doctor, recorded separately.
    expect(data.signedAt).toBeUndefined();
    expect(data.signedByStaffId).toBeUndefined();
    expect(data.authorisationKind).toBeUndefined();
    // And it is still marked as needing a doctor's authorisation.
    expect(data.requiresClinicalAuthorisation).toBe(true);
  });

  it('a browser-supplied issuer is discarded', async () => {
    const { service, prisma } = documents(directory(DR_A, FRONT_DESK));

    await as(FRONT_DESK.id, () =>
      service.create({ ...draft, issuedByStaffId: DR_A.id } as never),
    );

    // The request asked for Dr A's name on the document. It does not get it.
    expect((prisma.document.create as jest.Mock).mock.calls[0][0].data.issuedByStaffId).toBe(FRONT_DESK.id);
  });

  it('an anonymous session cannot create a document', async () => {
    const { service, prisma } = documents(directory(FRONT_DESK));
    await expect(as(undefined, () => service.create(draft as never))).rejects.toThrow(ForbiddenException);
    expect(prisma.document.create).not.toHaveBeenCalled();
  });
});
