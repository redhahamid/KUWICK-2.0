import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { QueueTicketStatus } from '@prisma/client';
import { VisitCompletionService } from './visit-completion.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// G4.5d3c-2b (D-087) — OVERALL VISIT COMPLETION
//
// The ONLY operation that sets Visit.checkOutAt. Everything it checks is
// re-resolved from stored data: a caller cannot assert that dispensing is
// finished or the bill is settled — the service looks.
// ===========================================================================

const OWNER = { id: 'own-1', fullName: 'Owner', role: 'OWNER_ADMIN', active: true, clinicId: 'clinic-1', userId: 'u1' };
const FRONT_DESK = { id: 'fd-1', fullName: 'Amy', role: 'FRONT_DESK_CLINICAL_STAFF', active: true, clinicId: 'clinic-1', userId: 'u2' };
const FINANCE = { id: 'fin-1', fullName: 'Faiz', role: 'FINANCE_STAFF', active: true, clinicId: 'clinic-1', userId: 'u3' };
const DOCTOR = { id: 'dr-a', fullName: 'Dr Amira', role: 'DOCTOR_RESIDENT', active: true, clinicId: 'clinic-1', userId: 'u4' };
const STOCK = { id: 'st-1', fullName: 'Sam', role: 'STOCK_STAFF', active: true, clinicId: 'clinic-1', userId: 'u5' };

const DONE = new Date('2026-08-04T08:00:00Z');

interface World {
  visit?: Record<string, unknown> | null;
  ticketStatus?: QueueTicketStatus | null;
  openProcedures?: number;
  prescriptions?: Array<{ supplyMode: string | null; status: string }>;
  invoices?: Array<{ patientResponsibilityAmount: number | null; patientPaidAmount: number }>;
  services?: number;
  branchCount?: number;
  claimCount?: number;
}

function build(actor: Record<string, unknown> | null, world: World = {}) {
  const {
    visit = { id: 'visit-1', clinicId: 'clinic-1', checkOutAt: null, doctorCompletedAt: DONE },
    ticketStatus = QueueTicketStatus.READY_FOR_PAYMENT,
    openProcedures = 0,
    prescriptions = [],
    // Default: one fully resolved, fully covered invoice — nothing outstanding.
    invoices = [{ patientResponsibilityAmount: 0, patientPaidAmount: 0 }],
    services = 0,
    branchCount = 1,
    claimCount = 1,
  } = world;

  const tx = {
    $executeRaw: jest.fn(),
    staff: { findUnique: jest.fn(async ({ where }: any) => (actor && where.id === actor.id ? actor : null)) },
    clinic: { count: jest.fn().mockResolvedValue(branchCount) },
    userClinicAccess: { findMany: jest.fn().mockResolvedValue([]) },
    visit: {
      findUnique: jest.fn(async ({ select }: any) =>
        select?.clinicId && !select?.checkOutAt ? { clinicId: 'clinic-1' } : visit,
      ),
      updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
    },
    queueTicket: {
      findUnique: jest.fn().mockResolvedValue(ticketStatus === null ? null : { id: 't1', status: ticketStatus }),
      update: jest.fn(),
    },
    orderService: { count: jest.fn(async ({ where }: any) => (where?.status?.in ? openProcedures : services)) },
    prescription: {
      findMany: jest.fn().mockResolvedValue(prescriptions),
      count: jest.fn().mockResolvedValue(prescriptions.length),
    },
    invoice: { findMany: jest.fn().mockResolvedValue(invoices) },
    visitWorkflowEvent: { create: jest.fn() },
  };

  const rawPrisma = { $transaction: jest.fn((fn: any) => fn(tx)) } as unknown as PrismaService;
  return {
    service: new VisitCompletionService({} as unknown as TenantScopedPrismaClient, rawPrisma),
    tx,
    actorId: (actor?.id as string) ?? undefined,
  };
}

const run = (ctx: ReturnType<typeof build>, dto = {}) =>
  tenantContextStorage.run({ tenantId: 'test-tenant', staffId: ctx.actorId } as never, () =>
    ctx.service.completeVisit('visit-1', dto),
  );

const codes = async (ctx: ReturnType<typeof build>) => {
  const error = (await run(ctx).catch((e) => e)) as { response?: { blockers?: Array<{ code: string }> } };
  return (error.response?.blockers ?? []).map((b) => b.code);
};

const RX = (supplyMode: string | null, status = 'ORDERED') => ({ supplyMode, status });

describe('authorisation', () => {
  it('12. anonymous completion is denied', async () => {
    await expect(run(build(null))).rejects.toThrow(ForbiddenException);
  });

  it.each([
    ['13. a doctor', DOCTOR],
    ['stock staff', STOCK],
  ])('%s cannot complete a visit', async (_n, actor) => {
    const ctx = build(actor);
    await expect(run(ctx)).rejects.toThrow(ForbiddenException);
    expect(ctx.tx.visit.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['14. front desk', FRONT_DESK],
    ['15. finance', FINANCE],
    ['16. owner', OWNER],
  ])('%s may complete an eligible visit', async (_n, actor) => {
    await expect(run(build(actor))).resolves.toMatchObject({ alreadyCompleted: false });
  });

  it('18. a doctor’s branch restriction still applies to the counter too', async () => {
    const ctx = build({ ...FRONT_DESK, clinicId: 'clinic-9' }, { branchCount: 2 });
    await expect(run(ctx)).rejects.toThrow(ForbiddenException);
  });
});

describe('preconditions', () => {
  it('19. an incomplete doctor phase blocks', async () => {
    const ctx = build(FRONT_DESK, { visit: { id: 'visit-1', clinicId: 'clinic-1', checkOutAt: null, doctorCompletedAt: null } });
    expect(await codes(ctx)).toContain('DOCTOR_PHASE_NOT_COMPLETED');
  });

  it.each([
    ['20. PENDING', 1],
    ['21. IN_PROGRESS', 1],
  ])('%s procedure blocks', async (_n, open) => {
    const ctx = build(FRONT_DESK, { openProcedures: open });
    expect(await codes(ctx)).toContain('PROCEDURE_PENDING');
  });

  it('22. an ONSITE_DISPENSE item still ORDERED blocks', async () => {
    const ctx = build(FRONT_DESK, { prescriptions: [RX('ONSITE_DISPENSE')] });
    expect(await codes(ctx)).toContain('DISPENSING_PENDING');
  });

  it('23. a DISPENSED onsite item does not block', async () => {
    const ctx = build(FRONT_DESK, { prescriptions: [RX('ONSITE_DISPENSE', 'DISPENSED')] });
    await expect(run(ctx)).resolves.toMatchObject({ alreadyCompleted: false });
  });

  it('25. DEFERRED blocks', async () => {
    const ctx = build(FRONT_DESK, { prescriptions: [RX('DEFERRED')] });
    expect(await codes(ctx)).toContain('MEDICATION_SUPPLY_DEFERRED');
  });

  it('26. a NULL supply mode blocks', async () => {
    const ctx = build(FRONT_DESK, { prescriptions: [RX(null)] });
    expect(await codes(ctx)).toContain('MEDICATION_SUPPLY_UNCONFIRMED');
  });

  it('27. a NULL patient responsibility blocks', async () => {
    const ctx = build(FRONT_DESK, { invoices: [{ patientResponsibilityAmount: null, patientPaidAmount: 0 }] });
    expect(await codes(ctx)).toContain('BILLING_REVIEW_REQUIRED');
  });

  it('28. a remaining patient balance blocks', async () => {
    const ctx = build(FRONT_DESK, { invoices: [{ patientResponsibilityAmount: 85, patientPaidAmount: 0 }] });
    expect(await codes(ctx)).toContain('PATIENT_BALANCE_REMAINING');
  });

  it('29. a fully panel-covered resolved invoice does not block', async () => {
    const ctx = build(FRONT_DESK, { invoices: [{ patientResponsibilityAmount: 0, patientPaidAmount: 0 }] });
    await expect(run(ctx)).resolves.toMatchObject({ alreadyCompleted: false });
  });

  it('31. an unbilled chargeable item blocks', async () => {
    const ctx = build(FRONT_DESK, { invoices: [], services: 2 });
    expect(await codes(ctx)).toContain('UNBILLED_CHARGEABLE_ITEMS');
  });

  it('nothing chargeable and no invoice does not block', async () => {
    const ctx = build(FRONT_DESK, { invoices: [], services: 0 });
    await expect(run(ctx)).resolves.toMatchObject({ alreadyCompleted: false });
  });

  it('an ineligible queue state blocks', async () => {
    const ctx = build(FRONT_DESK, { ticketStatus: QueueTicketStatus.WAITING });
    expect(await codes(ctx)).toContain('QUEUE_STATE_INELIGIBLE');
  });

  it('40. a cancelled visit cannot be completed', async () => {
    const ctx = build(FRONT_DESK, { ticketStatus: QueueTicketStatus.CANCELLED });
    await expect(run(ctx)).rejects.toThrow(/cancelled/i);
    expect(ctx.tx.visit.updateMany).not.toHaveBeenCalled();
  });

  it('ALL blockers are reported at once, not one refresh at a time', async () => {
    const ctx = build(FRONT_DESK, {
      visit: { id: 'visit-1', clinicId: 'clinic-1', checkOutAt: null, doctorCompletedAt: null },
      openProcedures: 1,
      prescriptions: [RX('DEFERRED')],
      invoices: [{ patientResponsibilityAmount: null, patientPaidAmount: 0 }],
    });
    const found = await codes(ctx);
    expect(found).toEqual(
      expect.arrayContaining([
        'DOCTOR_PHASE_NOT_COMPLETED',
        'PROCEDURE_PENDING',
        'MEDICATION_SUPPLY_DEFERRED',
        'BILLING_REVIEW_REQUIRED',
      ]),
    );
  });

  it('no blocker message exposes implementation vocabulary', async () => {
    const ctx = build(FRONT_DESK, { prescriptions: [RX(null)], openProcedures: 1 });
    const error = (await run(ctx).catch((e) => e)) as { response: { blockers: Array<{ message: string }> } };
    const banned = /prisma|sql|enum|constraint|ONSITE_DISPENSE|supplyMode|checkOutAt|null/i;
    for (const b of error.response.blockers) {
      expect(b.message).not.toMatch(banned);
    }
  });
});

describe('destination-specific completion', () => {
  it('33. DISPENSARY completes once dispensing and billing are resolved', async () => {
    const ctx = build(FRONT_DESK, {
      ticketStatus: QueueTicketStatus.READY_FOR_DISPENSARY,
      prescriptions: [RX('ONSITE_DISPENSE', 'DISPENSED')],
      invoices: [{ patientResponsibilityAmount: 0, patientPaidAmount: 0 }],
    });
    await expect(run(ctx)).resolves.toMatchObject({ queueStatus: 'COMPLETED' });
  });

  it('34. PAYMENT completes once the balance is zero', async () => {
    const ctx = build(FRONT_DESK, {
      ticketStatus: QueueTicketStatus.READY_FOR_PAYMENT,
      invoices: [{ patientResponsibilityAmount: 85, patientPaidAmount: 85 }],
    });
    await expect(run(ctx)).resolves.toMatchObject({ queueStatus: 'COMPLETED' });
  });

  it('32. NONE completes from IN_CONSULTATION', async () => {
    const ctx = build(FRONT_DESK, { ticketStatus: QueueTicketStatus.IN_CONSULTATION });
    await expect(run(ctx)).resolves.toMatchObject({ queueStatus: 'COMPLETED' });
  });
});

describe('atomicity, idempotency and concurrency', () => {
  it('35/36. one transaction sets checkOutAt, the queue status and ONE event', async () => {
    const ctx = build(FRONT_DESK);
    await run(ctx, { correlationId: 'corr-v1' });

    expect(ctx.tx.visit.updateMany).toHaveBeenCalledWith({
      where: { id: 'visit-1', checkOutAt: null },
      data: { checkOutAt: expect.any(Date) },
    });
    expect(ctx.tx.queueTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 'COMPLETED' },
    });
    expect(ctx.tx.visitWorkflowEvent.create).toHaveBeenCalledTimes(1);
    expect(ctx.tx.visitWorkflowEvent.create.mock.calls[0][0].data).toMatchObject({
      eventType: 'VISIT_COMPLETED',
      newStatus: 'COMPLETED',
      actorStaffId: FRONT_DESK.id,
      correlationId: 'corr-v1',
    });
  });

  it('37. a failed event insert rolls everything back', async () => {
    const ctx = build(FRONT_DESK);
    ctx.tx.visitWorkflowEvent.create.mockRejectedValue(new Error('disk full'));
    await expect(run(ctx)).rejects.toThrow();
  });

  it('38. a repeat preserves the ORIGINAL checkOutAt', async () => {
    const original = new Date('2026-08-04T10:30:00Z');
    const ctx = build(FRONT_DESK, {
      visit: { id: 'visit-1', clinicId: 'clinic-1', checkOutAt: original, doctorCompletedAt: DONE },
      ticketStatus: QueueTicketStatus.COMPLETED,
    });

    const r = await run(ctx);

    // Rewriting it would move the clinic's record of when the patient left.
    expect(r).toMatchObject({ checkOutAt: original, alreadyCompleted: true });
    expect(ctx.tx.visit.updateMany).not.toHaveBeenCalled();
    expect(ctx.tx.visitWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('39. the loser of a concurrent race returns the committed result, not an error', async () => {
    // claimCount 0 = another request won the atomic UPDATE ... WHERE
    // checkOutAt IS NULL between this one's read and its write.
    const winner = new Date('2026-08-04T11:00:00Z');
    const ctx = build(FRONT_DESK, { claimCount: 0 });
    ctx.tx.visit.findUnique
      .mockResolvedValueOnce({ clinicId: 'clinic-1' })
      .mockResolvedValueOnce({ id: 'visit-1', clinicId: 'clinic-1', checkOutAt: null, doctorCompletedAt: DONE })
      .mockResolvedValue({ checkOutAt: winner });

    const r = await run(ctx);

    expect(r).toMatchObject({ checkOutAt: winner, alreadyCompleted: true });
    // Only ONE completion event exists, and it belongs to the winner.
    expect(ctx.tx.visitWorkflowEvent.create).not.toHaveBeenCalled();
    expect(ctx.tx.queueTicket.update).not.toHaveBeenCalled();
  });

  it('the caller cannot supply checkOutAt', async () => {
    const ctx = build(FRONT_DESK);
    await run(ctx, { checkOutAt: new Date('2020-01-01') } as never);
    const written = (ctx.tx.visit.updateMany as jest.Mock).mock.calls[0][0].data.checkOutAt as Date;
    expect(written.getUTCFullYear()).toBeGreaterThan(2020);
  });
});
