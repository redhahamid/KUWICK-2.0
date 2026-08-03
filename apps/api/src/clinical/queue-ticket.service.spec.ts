import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueueTicketStatus, QueueType } from '@prisma/client';
import { QueueTicketService, formatDisplayNumber } from './queue-ticket.service';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

// S3 (D-079) — every queue mutation now resolves an authenticated actor and
// checks role + branch inside a tenant transaction, so the harness supplies
// one. Default actor: front desk, which holds every queue permission.
const FRONT_DESK: Record<string, unknown> = {
  id: 'staff-1',
  fullName: 'Aminah Counter',
  role: 'FRONT_DESK_CLINICAL_STAFF',
  active: true,
  clinicId: 'clinic-1',
  userId: 'user-1',
};

function createService(actor: Record<string, unknown> | null = FRONT_DESK) {
  const prisma = {
    queueTicket: { count: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    room: { findUnique: jest.fn() },
    visit: { update: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  // S3 — the ticket is written from the RESOLVED visit, so the mock must
  // return one. That is the point of the change: request clinicId is ignored.
  const visits = {
    create: jest.fn().mockResolvedValue({ id: 'v1', clinicId: 'c1', staffId: 's1' }),
    checkOut: jest.fn(),
  } as unknown as VisitService;

  // Staff are looked up by id, not "whoever the mock was told to return last".
  // `call` resolves the ACTOR and then, separately, the staff member being
  // assigned as attending clinician — two different rows in one request, and a
  // mock that cannot tell them apart cannot test S3F at all.
  const staffDirectory: Record<string, Record<string, unknown> | null> = {};
  if (actor) {
    staffDirectory[actor.id as string] = actor;
  }

  const tx = {
    $executeRaw: jest.fn(),
    staff: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => staffDirectory[where.id] ?? null),
    },
    clinic: { count: jest.fn().mockResolvedValue(1) },
    userClinicAccess: { findMany: jest.fn().mockResolvedValue([]) },
    visit: { findUnique: jest.fn().mockResolvedValue({ clinicId: 'clinic-1' }), update: jest.fn() },
    queueTicket: { findUnique: jest.fn(), update: jest.fn() },
  };
  const rawPrisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;

  return { service: new QueueTicketService(prisma, rawPrisma, visits), prisma, visits, tx, staffDirectory };
}

/**
 * S3 — a ticket is now read twice: once by the tenant-scoped client for the
 * response shape, and once INSIDE the authorisation/completion transaction.
 * The helper keeps both in step so a test states the ticket once.
 */
function makeSetTicket(ctx: ReturnType<typeof createService>) {
  return (ticket: Record<string, unknown> | null) => {
    (ctx.prisma.queueTicket.findUnique as jest.Mock).mockResolvedValue(ticket);
    ctx.tx.queueTicket.findUnique.mockResolvedValue(ticket);
  };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant', staffId: 'staff-1' }, fn);
}

/** A session with a tenant but no authenticated staff member — S3A. */
function anonymously<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' } as never, fn);
}

function staffOf(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...FRONT_DESK, ...overrides };
}

describe('formatDisplayNumber', () => {
  it('maps each queue type to its prefix with zero-padding (D-038)', () => {
    expect(formatDisplayNumber(QueueType.APPOINTMENT, 3)).toBe('A003');
    expect(formatDisplayNumber(QueueType.OTC, 12)).toBe('C012');
    expect(formatDisplayNumber(QueueType.WALK_IN, 1)).toBe('W001');
    expect(formatDisplayNumber(QueueType.EMERGENCY, 104)).toBe('E104');
  });
});

describe('QueueTicketService', () => {
  it('addToQueue creates a Visit first, then a ticket numbered from today\'s count of the same queue type', async () => {
    const { service, prisma, visits } = createService();
    (visits.create as jest.Mock).mockResolvedValue({ id: 'visit-1', clinicId: 'c1' });
    (prisma.queueTicket.count as jest.Mock).mockResolvedValue(2);
    (prisma.queueTicket.create as jest.Mock).mockResolvedValue({ id: 'ticket-1', ticketNumber: 3 });

    const result = await withTenant(() =>
      service.addToQueue({ clinicId: 'c1', patientId: 'p1', staffId: 's1', billingType: 'Self-pay' }),
    );

    expect(visits.create).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'c1', patientId: 'p1', staffId: 's1' }),
    );
    expect(prisma.queueTicket.count).toHaveBeenCalledWith({
      where: { clinicId: 'c1', queueType: QueueType.WALK_IN, createdAt: { gte: expect.any(Date) } },
    });
    expect(prisma.queueTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          visitId: 'visit-1',
          ticketNumber: 3,
          queueType: QueueType.WALK_IN,
          displayNumber: 'W003',
        }),
      }),
    );
    expect(result).toEqual({ id: 'ticket-1', ticketNumber: 3 });
  });

  it('addToQueue numbers the EMERGENCY stream independently', async () => {
    const ctx = createService();
    const { service, prisma, visits } = ctx;
    (visits.create as jest.Mock).mockResolvedValue({ id: 'visit-1', clinicId: 'c1' });
    (prisma.queueTicket.count as jest.Mock).mockResolvedValue(0);
    (prisma.queueTicket.create as jest.Mock).mockResolvedValue({ id: 'ticket-1' });

    await withTenant(() =>
      service.addToQueue({
        clinicId: 'c1',
        patientId: 'p1',
        staffId: 's1',
        billingType: 'Self-pay',
        queueType: QueueType.EMERGENCY,
      }),
    );

    expect(prisma.queueTicket.count).toHaveBeenCalledWith({
      where: { clinicId: 'c1', queueType: QueueType.EMERGENCY, createdAt: { gte: expect.any(Date) } },
    });
    expect(prisma.queueTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ queueType: QueueType.EMERGENCY, displayNumber: 'E001' }),
      }),
    );
  });

  it('call records the room and calledAt', async () => {
    const ctx = createService();
    const { service, prisma } = ctx;
    const setTicket = makeSetTicket(ctx);
    setTicket({
      id: 't1',
      visitId: 'visit-1',
      status: QueueTicketStatus.WAITING,
      visit: { staffId: 's-original' },
    });
    (prisma.room.findUnique as jest.Mock).mockResolvedValue({ id: 'room-1', active: true });
    (prisma.queueTicket.update as jest.Mock).mockResolvedValue({ id: 't1' });

    await withTenant(() => service.call('t1', 'room-1'));

    expect(prisma.visit.update).not.toHaveBeenCalled();
    expect(prisma.queueTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { calledAt: expect.any(Date), roomId: 'room-1' },
      include: { room: true, visit: { include: { patient: true, staff: true } } },
    });
  });

  it('call rejects an inactive room', async () => {
    const ctx = createService();
    const { service, prisma } = ctx;
    const setTicket = makeSetTicket(ctx);
    setTicket({
      id: 't1',
      status: QueueTicketStatus.WAITING,
      visit: { staffId: 's-original' },
    });
    (prisma.room.findUnique as jest.Mock).mockResolvedValue({ id: 'room-1', active: false });

    await expect(withTenant(() => service.call('t1', 'room-1'))).rejects.toThrow(BadRequestException);
  });

  it('call reassigns the visit staff (attending doctor) when staffId differs', async () => {
    const ctx = createService();
    const { service, prisma } = ctx;
    // S3F — the incoming clinician is now resolved under the tenant, so they
    // have to actually exist. That is the point of the check.
    ctx.staffDirectory['s-new'] = staffOf({ id: 's-new', role: 'DOCTOR_RESIDENT' });
    const setTicket = makeSetTicket(ctx);
    setTicket({
      id: 't1',
      visitId: 'visit-1',
      status: QueueTicketStatus.WAITING,
      visit: { staffId: 's-original' },
    });
    (prisma.queueTicket.update as jest.Mock).mockResolvedValue({ id: 't1' });

    await withTenant(() => service.call('t1', undefined, 's-new'));

    expect(prisma.visit.update).toHaveBeenCalledWith({ where: { id: 'visit-1' }, data: { staffId: 's-new' } });
  });

  it('call does not touch the visit staff when the same doctor is passed', async () => {
    const ctx = createService();
    const { service, prisma } = ctx;
    const setTicket = makeSetTicket(ctx);
    setTicket({
      id: 't1',
      visitId: 'visit-1',
      status: QueueTicketStatus.WAITING,
      visit: { staffId: 's-original' },
    });
    (prisma.queueTicket.update as jest.Mock).mockResolvedValue({ id: 't1' });

    await withTenant(() => service.call('t1', undefined, 's-original'));

    expect(prisma.visit.update).not.toHaveBeenCalled();
  });

  it('findById throws NotFoundException when the ticket does not exist', async () => {
    const ctx = createService();
    const { service, prisma } = ctx;
    const setTicket = makeSetTicket(ctx);
    setTicket(null);
    await expect(withTenant(() => service.findById('missing'))).rejects.toThrow(NotFoundException);
  });

  it('arrived moves WAITING to IN_CONSULTATION', async () => {
    const ctx = createService();
    const { service, prisma } = ctx;
    const setTicket = makeSetTicket(ctx);
    setTicket({ id: 't1', status: QueueTicketStatus.WAITING });
    (prisma.queueTicket.update as jest.Mock).mockResolvedValue({ id: 't1', status: QueueTicketStatus.IN_CONSULTATION });

    await withTenant(() => service.arrived('t1'));

    expect(prisma.queueTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: QueueTicketStatus.IN_CONSULTATION },
    });
  });

  // S3D — a repeated arrival is a double-click, not an error. It returns the
  // current state and writes nothing, so nothing unrelated is disturbed.
  it('arrived is idempotent when the ticket is already IN_CONSULTATION', async () => {
    const ctx = createService();
    const { service, prisma } = ctx;
    makeSetTicket(ctx)({ id: 't1', status: QueueTicketStatus.IN_CONSULTATION });

    const result = await withTenant(() => service.arrived('t1'));

    expect(prisma.queueTicket.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 't1', status: QueueTicketStatus.IN_CONSULTATION });
  });

  it('arrived rejects a ticket in a terminal status', async () => {
    const ctx = createService();
    const { service, prisma } = ctx;
    makeSetTicket(ctx)({ id: 't1', status: QueueTicketStatus.COMPLETED });

    await expect(withTenant(() => service.arrived('t1'))).rejects.toThrow(BadRequestException);
    expect(prisma.queueTicket.update).not.toHaveBeenCalled();
  });

  it('cancel rejects a ticket that is already completed or cancelled', async () => {
    const ctx = createService();
    const { service, prisma } = ctx;
    const setTicket = makeSetTicket(ctx);
    setTicket({
      id: 't1',
      status: QueueTicketStatus.COMPLETED,
    });
    await expect(withTenant(() => service.cancel('t1', {}))).rejects.toThrow(BadRequestException);
  });

  // S3E — both writes are now inside ONE transaction, so they are asserted on
  // the transaction client. `visits.checkOut` is deliberately no longer used:
  // it was the separate, unprotected second write.
  it('complete checks the visit out and moves DISPENSARY_PAYMENT to COMPLETED, in one transaction', async () => {
    const ctx = createService();
    const { service, prisma, visits, tx } = ctx;
    makeSetTicket(ctx)({ id: 't1', visitId: 'visit-1', status: QueueTicketStatus.DISPENSARY_PAYMENT });

    await withTenant(() => service.complete('t1'));

    expect(tx.queueTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: QueueTicketStatus.COMPLETED },
    });
    expect(tx.visit.update).toHaveBeenCalledWith({
      where: { id: 'visit-1' },
      data: { checkOutAt: expect.any(Date) },
    });
    // The unprotected second write is gone.
    expect(visits.checkOut).not.toHaveBeenCalled();
    expect(prisma.queueTicket.update).not.toHaveBeenCalled();
  });
});
