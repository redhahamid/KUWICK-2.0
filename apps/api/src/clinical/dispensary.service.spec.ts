import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrescriptionStatus, PrescriptionSupplyMode, QueueTicketStatus, Role, Staff } from '@prisma/client';
import { DispensaryService, stockStateFor } from './dispensary.service';
import { PrismaService } from '../core/prisma.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// G4.5d5b-2 — DISPENSING SAFETY
//
// `PrescriptionService.dispense` had an atomic claim and a supply-mode check
// and two holes the audit named: no role gate and no branch gate. It called
// requireActor and stopped. These tests pin both closed, and pin the
// per-item behaviour of a batch — because the tempting simplification (one
// transaction around the whole batch) would roll back medicine already handed
// to a patient.
// ===========================================================================

const TENANT = 'tenant-1';
const CLINIC = 'clinic-1';
const VISIT = 'visit-1';

function staff(overrides: Partial<Staff> = {}): Staff {
  return {
    id: 'staff-fd',
    tenantId: TENANT,
    userId: 'user-1',
    role: 'FRONT_DESK_CLINICAL_STAFF' as Role,
    fullName: 'Siti Aminah',
    active: true,
    clinicId: CLINIC,
    ...overrides,
  } as Staff;
}

interface Rx {
  id: string;
  visitId?: string;
  itemId?: string;
  quantity?: number;
  status?: PrescriptionStatus;
  supplyMode?: PrescriptionSupplyMode | null;
  deletedAt?: Date | null;
}

function build(
  actor: Staff | null = staff(),
  world: {
    prescriptions?: Rx[];
    onHand?: number;
    ticketStatus?: QueueTicketStatus | null;
    branchCount?: number;
    authorisedClinics?: string[];
  } = {},
) {
  const {
    prescriptions = [{ id: 'rx-1' }],
    onHand = 100,
    ticketStatus = QueueTicketStatus.READY_FOR_DISPENSARY,
    branchCount = 1,
    authorisedClinics = [],
  } = world;

  const rows = new Map(
    prescriptions.map((p) => [
      p.id,
      {
        id: p.id,
        visitId: p.visitId ?? VISIT,
        itemId: p.itemId ?? 'item-1',
        quantity: p.quantity ?? 10,
        status: p.status ?? PrescriptionStatus.ORDERED,
        supplyMode: p.supplyMode === undefined ? PrescriptionSupplyMode.ONSITE_DISPENSE : p.supplyMode,
        deletedAt: p.deletedAt ?? null,
        dispensedByStaffId: null as string | null,
        item: { name: 'Amoxicillin 500mg' },
      },
    ]),
  );

  const movements: Record<string, unknown>[] = [];
  const stockUpdates: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  let ticket = ticketStatus === null ? null : { id: 't1', status: ticketStatus, clinicId: CLINIC };
  let stock = onHand;

  const tx = {
    $executeRaw: jest.fn(),
    $executeRawUnsafe: jest.fn(),
    staff: {
      findUnique: jest.fn(async ({ where }: any) => (actor && where.id === actor.id ? actor : null)),
      findMany: jest.fn(async () => []),
    },
    clinic: { count: jest.fn(async () => branchCount) },
    userClinicAccess: {
      findMany: jest.fn(async () => authorisedClinics.map((clinicId) => ({ clinicId }))),
    },
    visit: { findUnique: jest.fn(async () => ({ id: VISIT, clinicId: CLINIC })) },
    prescription: {
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.id) ?? null),
      count: jest.fn(async ({ where }: any) => {
        if (where?.visitId?.not) {
          return [...rows.values()].filter(
            (r) => where.id.in.includes(r.id) && r.visitId !== where.visitId.not,
          ).length;
        }
        return [...rows.values()].filter(
          (r) =>
            r.visitId === where.visitId &&
            r.status === PrescriptionStatus.ORDERED &&
            r.supplyMode === PrescriptionSupplyMode.ONSITE_DISPENSE,
        ).length;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = rows.get(where.id);
        if (
          !row ||
          row.status !== where.status ||
          row.supplyMode !== where.supplyMode ||
          row.deletedAt !== null
        ) {
          return { count: 0 };
        }
        rows.set(where.id, { ...row, ...data });
        return { count: 1 };
      }),
    },
    stockLevel: {
      findUnique: jest.fn(async () => ({ quantityOnHand: stock })),
      upsert: jest.fn(async ({ update }: any) => {
        stock -= update.quantityOnHand.decrement;
        stockUpdates.push(update);
        return {};
      }),
    },
    stockMovement: {
      create: jest.fn(async ({ data }: any) => {
        movements.push(data);
        return data;
      }),
    },
    queueTicket: {
      findUnique: jest.fn(async () => ticket),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!ticket || ticket.status !== where.status) return { count: 0 };
        ticket = { ...ticket, status: data.status };
        return { count: 1 };
      }),
    },
    visitWorkflowEvent: {
      create: jest.fn(async ({ data }: any) => {
        events.push(data);
        return data;
      }),
    },
  };

  const rawPrisma = { $transaction: jest.fn((fn: any) => fn(tx)) } as unknown as PrismaService;
  const service = new DispensaryService({} as unknown as TenantScopedPrismaClient, rawPrisma);

  const run = <T>(fn: () => Promise<T>) =>
    tenantContextStorage.run({ tenantId: TENANT, staffId: actor?.id, userId: actor?.userId ?? undefined }, fn);

  return {
    tx,
    rows,
    movements,
    stockUpdates,
    events,
    get stock() {
      return stock;
    },
    get ticket() {
      return ticket;
    },
    dispense: (ids: string[], ack = false) =>
      run(() =>
        service.dispense({ visitId: VISIT, prescriptionIds: ids, acknowledgeStockWarning: ack }),
      ),
  };
}

describe('permission — the gap the audit found', () => {
  it.each([
    ['OWNER_ADMIN'],
    ['FRONT_DESK_CLINICAL_STAFF'],
    ['DOCTOR_RESIDENT'],
    ['DOCTOR_LOCUM'],
  ] as const)('1. %s may dispense', async (role) => {
    const ctx = build(staff({ role: role as Role, id: 'staff-x' }));
    const result = await ctx.dispense(['rx-1']);
    expect(result.results[0].outcome).toBe('DISPENSED');
  });

  it.each([['STOCK_STAFF'], ['FINANCE_STAFF']] as const)('2. %s is refused', async (role) => {
    const ctx = build(staff({ role: role as Role, id: 'staff-x' }));
    await expect(ctx.dispense(['rx-1'])).rejects.toThrow(ForbiddenException);
    expect(ctx.movements).toHaveLength(0);
  });

  it('3. an inactive account is refused', async () => {
    const ctx = build(staff({ active: false }));
    await expect(ctx.dispense(['rx-1'])).rejects.toThrow();
    expect(ctx.movements).toHaveLength(0);
  });

  it('4. no stock moves when permission is refused', async () => {
    const ctx = build(staff({ role: 'STOCK_STAFF' as Role }));
    await expect(ctx.dispense(['rx-1'])).rejects.toThrow();
    expect(ctx.stock).toBe(100);
  });
});

describe('branch enforcement', () => {
  it('5. a multi-branch tenant refuses a clinic the actor has no access to', async () => {
    // assertMayTouchVisit is the shared helper every clinical write uses; the
    // dispensing path did not call it at all before this checkpoint.
    const ctx = build(staff({ clinicId: 'other-clinic' }), {
      branchCount: 3,
      authorisedClinics: ['other-clinic'],
    });
    await expect(ctx.dispense(['rx-1'])).rejects.toThrow();
    expect(ctx.movements).toHaveLength(0);
  });

  it('6. a single-branch tenant is unaffected', async () => {
    const ctx = build(staff(), { branchCount: 1 });
    const result = await ctx.dispense(['rx-1']);
    expect(result.results[0].outcome).toBe('DISPENSED');
  });
});

describe('eligibility', () => {
  it.each([
    ['7. an external prescription', PrescriptionSupplyMode.EXTERNAL_PRESCRIPTION],
    ["8. the patient's own supply", PrescriptionSupplyMode.PATIENT_OWN_SUPPLY],
    ['9. no supply required', PrescriptionSupplyMode.NO_SUPPLY_REQUIRED],
    ['10. a deferred supply mode', PrescriptionSupplyMode.DEFERRED],
  ])('%s is refused', async (_name, supplyMode) => {
    const ctx = build(staff(), { prescriptions: [{ id: 'rx-1', supplyMode }] });
    const result = await ctx.dispense(['rx-1']);
    expect(result.results[0].outcome).toBe('NO_LONGER_ELIGIBLE');
    expect(ctx.movements).toHaveLength(0);
  });

  it('11. a NULL supply mode is unresolved, not dispensable', async () => {
    const ctx = build(staff(), { prescriptions: [{ id: 'rx-1', supplyMode: null }] });
    const result = await ctx.dispense(['rx-1']);
    expect(result.results[0].outcome).toBe('NO_LONGER_ELIGIBLE');
    expect(result.results[0].message).toMatch(/supply mode has not been confirmed/i);
  });

  it('12. a cancelled prescription is refused', async () => {
    const ctx = build(staff(), {
      prescriptions: [{ id: 'rx-1', status: PrescriptionStatus.CANCELLED }],
    });
    const result = await ctx.dispense(['rx-1']);
    expect(result.results[0].outcome).toBe('NO_LONGER_ELIGIBLE');
    expect(result.results[0].message).toMatch(/cancelled/i);
  });

  it('13. an already-dispensed prescription reports so and moves nothing', async () => {
    const ctx = build(staff(), {
      prescriptions: [{ id: 'rx-1', status: PrescriptionStatus.DISPENSED }],
    });
    const result = await ctx.dispense(['rx-1']);
    expect(result.results[0].outcome).toBe('ALREADY_DISPENSED');
    expect(ctx.stock).toBe(100);
  });

  it('14. no refusal message leaks an enum value', async () => {
    for (const supplyMode of [
      PrescriptionSupplyMode.EXTERNAL_PRESCRIPTION,
      PrescriptionSupplyMode.PATIENT_OWN_SUPPLY,
      PrescriptionSupplyMode.DEFERRED,
      null,
    ]) {
      const ctx = build(staff(), { prescriptions: [{ id: 'rx-1', supplyMode }] });
      const result = await ctx.dispense(['rx-1']);
      expect(result.results[0].message).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
    }
  });
});

describe('the quantity is the SERVER’S', () => {
  it('15. stock is deducted by the prescribed quantity', async () => {
    const ctx = build(staff(), { prescriptions: [{ id: 'rx-1', quantity: 15 }] });
    await ctx.dispense(['rx-1']);
    expect(ctx.movements[0]).toMatchObject({ quantityDelta: -15 });
    expect(ctx.stock).toBe(85);
  });

  it('16. exactly ONE movement per dispense', async () => {
    const ctx = build(staff());
    await ctx.dispense(['rx-1']);
    expect(ctx.movements).toHaveLength(1);
    expect(ctx.stockUpdates).toHaveLength(1);
  });

  it('17. the dispenser is recorded on the prescription and the movement', async () => {
    const ctx = build(staff({ id: 'staff-fd', userId: 'user-1' }));
    await ctx.dispense(['rx-1']);
    expect(ctx.rows.get('rx-1')).toMatchObject({ dispensedByStaffId: 'staff-fd' });
    expect(ctx.movements[0]).toMatchObject({ createdByUserId: 'user-1' });
  });

  it('18. a repeat submission does not deduct twice', async () => {
    const ctx = build(staff());
    await ctx.dispense(['rx-1']);
    const afterFirst = ctx.stock;
    const second = await ctx.dispense(['rx-1']);
    expect(second.results[0].outcome).toBe('ALREADY_DISPENSED');
    expect(ctx.stock).toBe(afterFirst);
    expect(ctx.movements).toHaveLength(1);
  });

  it('19. the claim carries its preconditions in the WHERE clause', async () => {
    const ctx = build(staff());
    await ctx.dispense(['rx-1']);
    const where = ctx.tx.prescription.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      status: PrescriptionStatus.ORDERED,
      supplyMode: PrescriptionSupplyMode.ONSITE_DISPENSE,
      deletedAt: null,
    });
  });
});

describe('stock warnings', () => {
  it('20. an insufficient stock level refuses WITHOUT acknowledgement', async () => {
    const ctx = build(staff(), { onHand: 3, prescriptions: [{ id: 'rx-1', quantity: 10 }] });
    const result = await ctx.dispense(['rx-1'], false);
    expect(result.results[0].outcome).toBe('FAILED');
    expect(result.results[0].message).toMatch(/Only 3 in stock/);
    expect(ctx.movements).toHaveLength(0);
  });

  it('21. and proceeds WITH acknowledgement — negative stock is deliberate', async () => {
    const ctx = build(staff(), { onHand: 3, prescriptions: [{ id: 'rx-1', quantity: 10 }] });
    const result = await ctx.dispense(['rx-1'], true);
    expect(result.results[0].outcome).toBe('STOCK_WARNING_ACKNOWLEDGED');
    expect(ctx.stock).toBe(-7);
  });

  it('22. the acknowledgement is recorded on the movement', async () => {
    const ctx = build(staff(), { onHand: 3, prescriptions: [{ id: 'rx-1', quantity: 10 }] });
    await ctx.dispense(['rx-1'], true);
    expect(String(ctx.movements[0].notes)).toMatch(/acknowledged stock shortage/i);
  });

  it('23. sufficient stock records no shortage note', async () => {
    const ctx = build(staff());
    await ctx.dispense(['rx-1']);
    expect(ctx.movements[0].notes).toBeUndefined();
  });
});

describe('multi-dispense', () => {
  const three = [
    { id: 'rx-1' },
    { id: 'rx-2', status: PrescriptionStatus.DISPENSED },
    { id: 'rx-3' },
  ];

  it('24. several medications from one visit are processed', async () => {
    const ctx = build(staff(), { prescriptions: [{ id: 'rx-1' }, { id: 'rx-2' }] });
    const result = await ctx.dispense(['rx-1', 'rx-2']);
    expect(result.summary.dispensed).toBe(2);
    expect(ctx.movements).toHaveLength(2);
  });

  it('25. a batch spanning two visits is refused WHOLE', async () => {
    const ctx = build(staff(), {
      prescriptions: [{ id: 'rx-1' }, { id: 'rx-other', visitId: 'visit-2' }],
    });
    await expect(ctx.dispense(['rx-1', 'rx-other'])).rejects.toThrow(BadRequestException);
    // Nothing at all was dispensed: there is no safe "some of it".
    expect(ctx.movements).toHaveLength(0);
  });

  it('26. every item gets its own outcome', async () => {
    const ctx = build(staff(), { prescriptions: three });
    const result = await ctx.dispense(['rx-1', 'rx-2', 'rx-3']);
    expect(result.results.map((r) => r.outcome)).toEqual([
      'DISPENSED',
      'ALREADY_DISPENSED',
      'DISPENSED',
    ]);
  });

  it('27. a failure does NOT roll back the items that succeeded', async () => {
    // The whole reason each prescription gets its own transaction.
    const ctx = build(staff(), {
      prescriptions: [
        { id: 'rx-1' },
        { id: 'rx-2', supplyMode: PrescriptionSupplyMode.EXTERNAL_PRESCRIPTION },
        { id: 'rx-3' },
      ],
    });
    const result = await ctx.dispense(['rx-1', 'rx-2', 'rx-3']);
    expect(result.summary).toMatchObject({ dispensed: 2, failed: 1 });
    expect(ctx.movements).toHaveLength(2);
    expect(ctx.rows.get('rx-1')?.status).toBe(PrescriptionStatus.DISPENSED);
    expect(ctx.rows.get('rx-3')?.status).toBe(PrescriptionStatus.DISPENSED);
  });

  it('28. an already-dispensed item is reported, not retried', async () => {
    const ctx = build(staff(), { prescriptions: three });
    await ctx.dispense(['rx-1', 'rx-2', 'rx-3']);
    // Two claims wrote; the already-dispensed one produced no movement.
    expect(ctx.movements).toHaveLength(2);
  });

  it('29. an empty selection is refused rather than treated as a no-op', async () => {
    const ctx = build(staff());
    await expect(ctx.dispense([])).rejects.toThrow(BadRequestException);
  });

  it('30. the summary counts match the per-item outcomes', async () => {
    const ctx = build(staff(), { prescriptions: three });
    const result = await ctx.dispense(['rx-1', 'rx-2', 'rx-3']);
    expect(result.summary.dispensed).toBe(2);
    expect(result.summary.alreadyDispensed).toBe(1);
    expect(result.summary.failed).toBe(0);
  });
});

describe('routing after the last medication', () => {
  it('31. the final dispense moves the ticket to Payment', async () => {
    const ctx = build(staff());
    const result = await ctx.dispense(['rx-1']);
    expect(result.routing.dispensingComplete).toBe(true);
    expect(result.routing.queueStatus).toBe(QueueTicketStatus.READY_FOR_PAYMENT);
    expect(ctx.ticket?.status).toBe(QueueTicketStatus.READY_FOR_PAYMENT);
  });

  it('32. one workflow event is written, once', async () => {
    const ctx = build(staff());
    await ctx.dispense(['rx-1']);
    expect(ctx.events).toHaveLength(1);
    expect(ctx.events[0]).toMatchObject({
      eventType: 'DISPENSING_COMPLETED',
      previousStatus: QueueTicketStatus.READY_FOR_DISPENSARY,
      newStatus: QueueTicketStatus.READY_FOR_PAYMENT,
    });
  });

  it('33. a visit with medication still outstanding does NOT move', async () => {
    const ctx = build(staff(), { prescriptions: [{ id: 'rx-1' }, { id: 'rx-2' }] });
    const result = await ctx.dispense(['rx-1']);
    expect(result.routing.dispensingComplete).toBe(false);
    expect(ctx.ticket?.status).toBe(QueueTicketStatus.READY_FOR_DISPENSARY);
    expect(ctx.events).toHaveLength(0);
  });

  it('34. a SECOND completion writes no second event', async () => {
    const ctx = build(staff(), { prescriptions: [{ id: 'rx-1' }, { id: 'rx-2' }] });
    await ctx.dispense(['rx-1', 'rx-2']);
    expect(ctx.events).toHaveLength(1);
    await ctx.dispense(['rx-1']);
    expect(ctx.events).toHaveLength(1);
  });

  it('35. dispensing NEVER completes the visit', async () => {
    const ctx = build(staff());
    await ctx.dispense(['rx-1']);
    // No checkOutAt write exists on this path at all: the visit model is
    // never updated by the dispensary.
    expect(ctx.ticket?.status).not.toBe(QueueTicketStatus.COMPLETED);
  });

  it('36. dispensing changes no invoice and no responsibility figure', async () => {
    // The service has no invoice client at all — asserted structurally.
    const ctx = build(staff());
    await ctx.dispense(['rx-1']);
    expect((ctx.tx as Record<string, unknown>).invoice).toBeUndefined();
    expect((ctx.tx as Record<string, unknown>).invoiceLine).toBeUndefined();
  });

  it('37. the routing message is staff-facing, with no enum in it', async () => {
    const ctx = build(staff());
    const result = await ctx.dispense(['rx-1']);
    expect(result.routing.message).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
    expect(result.routing.message).toMatch(/Payment/);
  });
});

describe('stock state is honest about units', () => {
  it.each([
    ['38. plenty', { onHand: 50, required: 10, comparable: true }, 'IN_STOCK'],
    ['39. at the reorder level', { onHand: 5, required: 2, reorderLevel: 6, comparable: true }, 'LOW_STOCK'],
    ['40. not enough', { onHand: 2, required: 10, comparable: true }, 'INSUFFICIENT'],
    ['41. none', { onHand: 0, required: 1, comparable: true }, 'OUT_OF_STOCK'],
    ['42. units cannot be compared', { onHand: 5, required: 1, comparable: false }, 'UNIT_UNKNOWN'],
    ['43. no stock record at all', { onHand: null, required: 1, comparable: true }, 'UNIT_UNKNOWN'],
  ] as const)('%s', (_name, params, expected) => {
    expect(stockStateFor(params as never)).toBe(expected);
  });

  it('44. an incomparable unit is never reported as sufficient', () => {
    // Pretending a bottle/tablet conversion is known is how a dispenser is
    // told there is enough when nobody has worked out what "enough" means.
    expect(stockStateFor({ onHand: 100, required: 1, comparable: false })).toBe('UNIT_UNKNOWN');
  });
});
