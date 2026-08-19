import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueueTicketStatus, QueueType } from '@prisma/client';
import { QueueTicketService, formatDisplayNumber } from './queue-ticket.service';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { VisitCompletionService } from './visit-completion.service';
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
    visit: {
      findUnique: jest.fn().mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1', staffId: 'staff-1' }),
      update: jest.fn(),
    },
    queueTicket: {
      findUnique: jest.fn(),
      update: jest.fn(),
      // §5 hardening — allocation moved INSIDE the transaction, behind the
      // advisory lock, so count and create are tx members now.
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      // KW2-C2 — hold and resume claim atomically (the D-087 pattern), so the
      // precondition lives in the WHERE clause and the mock reports how many
      // rows it would have moved. Default 1: the claim succeeded.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    visitWorkflowEvent: { create: jest.fn() },
  };
  const visitCompletion = { completeVisit: jest.fn().mockResolvedValue({ visitId: 'visit-1' }) } as unknown as VisitCompletionService;
  const rawPrisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;

  return { service: new QueueTicketService(prisma, rawPrisma, visits, visitCompletion), prisma, visits, tx, staffDirectory };
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
    const { service, tx, visits } = createService();
    (visits.create as jest.Mock).mockResolvedValue({ id: 'visit-1', clinicId: 'c1' });
    (tx.queueTicket.count as jest.Mock).mockResolvedValue(2);
    (tx.queueTicket.create as jest.Mock).mockResolvedValue({ id: 'ticket-1', ticketNumber: 3 });

    const result = await withTenant(() =>
      service.addToQueue({ clinicId: 'c1', patientId: 'p1', staffId: 's1', billingType: 'Self-pay' }),
    );

    expect(visits.create).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'c1', patientId: 'p1', staffId: 's1' }),
    );
    expect(tx.queueTicket.count).toHaveBeenCalledWith({
      where: { clinicId: 'c1', queueType: QueueType.WALK_IN, createdAt: { gte: expect.any(Date) } },
    });
    expect(tx.queueTicket.create).toHaveBeenCalledWith(
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
    const { service, tx, visits } = ctx;
    (visits.create as jest.Mock).mockResolvedValue({ id: 'visit-1', clinicId: 'c1' });
    (tx.queueTicket.count as jest.Mock).mockResolvedValue(0);
    (tx.queueTicket.create as jest.Mock).mockResolvedValue({ id: 'ticket-1' });

    await withTenant(() =>
      service.addToQueue({
        clinicId: 'c1',
        patientId: 'p1',
        staffId: 's1',
        billingType: 'Self-pay',
        queueType: QueueType.EMERGENCY,
      }),
    );

    expect(tx.queueTicket.count).toHaveBeenCalledWith({
      where: { clinicId: 'c1', queueType: QueueType.EMERGENCY, createdAt: { gte: expect.any(Date) } },
    });
    expect(tx.queueTicket.create).toHaveBeenCalledWith(
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
    //
    // S3b — and so does the OUTGOING one: the rule now depends on who holds
    // the visit, so 's-original' has to be a real row too. Front desk holds
    // it here, which makes this a claim rather than a replacement.
    ctx.staffDirectory['s-new'] = staffOf({ id: 's-new', role: 'DOCTOR_RESIDENT' });
    ctx.staffDirectory['s-original'] = staffOf({ id: 's-original', userId: 'u-orig' });
    ctx.tx.visit.findUnique.mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1', staffId: 's-original' });
    const setTicket = makeSetTicket(ctx);
    setTicket({
      id: 't1',
      visitId: 'visit-1',
      status: QueueTicketStatus.WAITING,
      visit: { staffId: 's-original' },
    });
    (prisma.queueTicket.update as jest.Mock).mockResolvedValue({ id: 't1' });

    await withTenant(() => service.call('t1', undefined, 's-new'));

    // S3b — the write moved inside the transaction that also records the
    // handover event, so the two cannot come apart.
    expect(ctx.tx.visit.update).toHaveBeenCalledWith({ where: { id: 'visit-1' }, data: { staffId: 's-new' } });
    expect(ctx.tx.visitWorkflowEvent.create).toHaveBeenCalledTimes(1);
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

  it('arrived moves WAITING to IN_CONSULTATION and records CONSULTATION_STARTED in the same transaction', async () => {
    const ctx = createService();
    const { service } = ctx;
    const setTicket = makeSetTicket(ctx);
    setTicket({ id: 't1', status: QueueTicketStatus.WAITING, visitId: 'visit-1', clinicId: 'clinic-1' });

    await withTenant(() => service.arrived('t1'));

    // G4.5d3c-3b2 (D-094) — the write and the consultation-start record are
    // one transaction: the tariff's timestamp source cannot be missing for a
    // visit whose ticket says the consultation happened.
    expect(ctx.tx.queueTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: QueueTicketStatus.IN_CONSULTATION },
    });
    expect(ctx.tx.visitWorkflowEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'CONSULTATION_STARTED',
        visitId: 'visit-1',
        clinicId: 'clinic-1',
        previousStatus: QueueTicketStatus.WAITING,
        newStatus: QueueTicketStatus.IN_CONSULTATION,
        actorStaffId: 'staff-1',
      }),
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

  // SUPERSEDED BY D-087. This asserted that complete() itself wrote
  // checkOutAt and the queue status. It did - after checking only that the
  // ticket was in DISPENSARY_PAYMENT - which is exactly the bypass that let a
  // visit close with medication undispensed or a bill never raised. The route
  // now resolves the visit and delegates to VisitCompletionService, so there
  // is one set of completion rules rather than two.
  it('complete delegates instead of closing the visit itself', async () => {
    const ctx = createService();
    const { service, prisma, visits, tx } = ctx;
    makeSetTicket(ctx)({ id: 't1', visitId: 'visit-1', clinicId: 'clinic-1', status: QueueTicketStatus.DISPENSARY_PAYMENT });

    await withTenant(() => service.complete('t1'));

    expect(tx.visit.update).not.toHaveBeenCalled();
    expect(tx.queueTicket.update).not.toHaveBeenCalled();
    expect(visits.checkOut).not.toHaveBeenCalled();
    expect(prisma.queueTicket.update).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// KW2-C2 — HOLD and RESUME
//
// The owner's rule: no silent state changes. A patient who reappears in the
// waiting queue must carry who put them there and when, and taking them back
// must not claim the consultation started twice.
// ===========================================================================
describe('hold and resume', () => {
  // Same id as the default actor: `withTenant` puts staffId 'staff-1' on the
  // session and `requireActor` resolves the actor from THERE, never from the
  // request. Only the role and the name differ.
  const DOCTOR = staffOf({ fullName: 'Dr Amira Rahman', role: 'DOCTOR_RESIDENT' });

  const inConsultation = {
    id: 'ticket-1',
    visitId: 'visit-1',
    clinicId: 'clinic-1',
    status: QueueTicketStatus.IN_CONSULTATION,
    heldAt: null,
    heldByStaffId: null,
  };

  const onHold = {
    ...inConsultation,
    status: QueueTicketStatus.WAITING,
    heldAt: new Date('2026-08-10T02:00:00.000Z'),
    heldByStaffId: 'staff-1',
  };

  const doctorService = () => {
    const ctx = createService(DOCTOR);
    return ctx;
  };

  const eventOf = (ctx: ReturnType<typeof createService>) =>
    ctx.tx.visitWorkflowEvent.create.mock.calls[0]?.[0]?.data;

  it('hold moves IN_CONSULTATION to WAITING and records who paused it', async () => {
    const ctx = doctorService();
    makeSetTicket(ctx)(inConsultation);

    await withTenant(() => ctx.service.hold('ticket-1'));

    const [claim] = ctx.tx.queueTicket.updateMany.mock.calls[0];
    expect(claim.data.status).toBe(QueueTicketStatus.WAITING);
    expect(claim.data.heldByStaffId).toBe('staff-1');
    expect(claim.data.heldAt).toBeInstanceOf(Date);

    const event = eventOf(ctx);
    expect(event.eventType).toBe('CONSULTATION_HELD');
    expect(event.previousStatus).toBe(QueueTicketStatus.IN_CONSULTATION);
    expect(event.newStatus).toBe(QueueTicketStatus.WAITING);
    // The snapshot, not a join: a later promotion must not rewrite who paused
    // this consultation, or in what role.
    expect(event.actorStaffId).toBe('staff-1');
    expect(event.actorNameSnapshot).toBe('Dr Amira Rahman');
    expect(event.actorRoleSnapshot).toBe('DOCTOR_RESIDENT');
  });

  it('the hold is claimed atomically — the precondition is in the WHERE', async () => {
    // Two doctors pressing Hold at once must produce ONE transition and ONE
    // event. A read-then-write would let both through.
    const ctx = doctorService();
    makeSetTicket(ctx)(inConsultation);

    await withTenant(() => ctx.service.hold('ticket-1'));

    const [claim] = ctx.tx.queueTicket.updateMany.mock.calls[0];
    expect(claim.where).toMatchObject({
      id: 'ticket-1',
      status: QueueTicketStatus.IN_CONSULTATION,
      heldAt: null,
    });
  });

  it('the loser of that race writes no event', async () => {
    const ctx = doctorService();
    makeSetTicket(ctx)(inConsultation);
    ctx.tx.queueTicket.updateMany.mockResolvedValue({ count: 0 });

    await withTenant(() => ctx.service.hold('ticket-1'));

    expect(ctx.tx.visitWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('holding an already-held ticket records no second hold', async () => {
    // A double-click is not an error, and the FIRST actor and time are the
    // ones that are true.
    const ctx = doctorService();
    makeSetTicket(ctx)(onHold);

    await withTenant(() => ctx.service.hold('ticket-1'));

    expect(ctx.tx.queueTicket.updateMany).not.toHaveBeenCalled();
    expect(ctx.tx.visitWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('a patient who is merely waiting cannot be held', async () => {
    const ctx = doctorService();
    makeSetTicket(ctx)({ ...inConsultation, status: QueueTicketStatus.WAITING });

    await expect(withTenant(() => ctx.service.hold('ticket-1'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ctx.tx.visitWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('front desk cannot push a patient out of a consulting room', async () => {
    // The narrow reading: holding is a clinical judgement made in a room the
    // counter cannot see into. Resuming is the part front desk DOES hold.
    const ctx = createService(FRONT_DESK);
    makeSetTicket(ctx)(inConsultation);

    await expect(withTenant(() => ctx.service.hold('ticket-1'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('an anonymous session cannot hold anything', async () => {
    const ctx = createService(null);
    makeSetTicket(ctx)(inConsultation);

    await expect(anonymously(() => ctx.service.hold('ticket-1'))).rejects.toBeTruthy();
    expect(ctx.tx.visitWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('resume takes the patient back and CLEARS the hold', async () => {
    const ctx = doctorService();
    makeSetTicket(ctx)(onHold);

    await withTenant(() => ctx.service.resume('ticket-1'));

    const [claim] = ctx.tx.queueTicket.updateMany.mock.calls[0];
    expect(claim.where).toMatchObject({ id: 'ticket-1', status: QueueTicketStatus.WAITING });
    expect(claim.data).toMatchObject({
      status: QueueTicketStatus.IN_CONSULTATION,
      heldAt: null,
      heldByStaffId: null,
    });
  });

  it('resume records RESUMED, never a second CONSULTATION_STARTED', async () => {
    // CONSULTATION_STARTED is the consultation's start instant and the
    // consultation tariff reads it. A patient held at 22:40 and taken back at
    // 23:05 must not acquire a late-night fee for a consultation that began
    // before the band.
    const ctx = doctorService();
    makeSetTicket(ctx)(onHold);

    await withTenant(() => ctx.service.resume('ticket-1'));

    const event = eventOf(ctx);
    expect(event.eventType).toBe('CONSULTATION_RESUMED');
    expect(event.eventType).not.toBe('CONSULTATION_STARTED');
    expect(event.previousStatus).toBe(QueueTicketStatus.WAITING);
    expect(event.newStatus).toBe(QueueTicketStatus.IN_CONSULTATION);
    expect(event.actorNameSnapshot).toBe('Dr Amira Rahman');
  });

  it('the ordinary Arrived action on a HELD ticket resumes it', async () => {
    // Front desk reaches for the button they always use. Letting it write a
    // second CONSULTATION_STARTED would claim the consultation began twice.
    const ctx = createService(FRONT_DESK);
    makeSetTicket(ctx)(onHold);

    await withTenant(() => ctx.service.arrived('ticket-1'));

    expect(eventOf(ctx).eventType).toBe('CONSULTATION_RESUMED');
  });

  it('Arrived on a never-held ticket still records the START', async () => {
    const ctx = createService(FRONT_DESK);
    makeSetTicket(ctx)({
      ...inConsultation,
      status: QueueTicketStatus.WAITING,
    });

    await withTenant(() => ctx.service.arrived('ticket-1'));

    expect(eventOf(ctx).eventType).toBe('CONSULTATION_STARTED');
  });

  it('resuming something that is not on hold writes nothing', async () => {
    const ctx = doctorService();
    makeSetTicket(ctx)(inConsultation);

    await withTenant(() => ctx.service.resume('ticket-1'));

    expect(ctx.tx.queueTicket.updateMany).not.toHaveBeenCalled();
    expect(ctx.tx.visitWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('neither operation touches anything clinical', async () => {
    // "Resuming returns them with state intact" has to be true rather than
    // aspirational: the patient changes place in the queue, not state in the
    // record. Only the ticket and the event table are written.
    const ctx = doctorService();
    makeSetTicket(ctx)(inConsultation);

    await withTenant(() => ctx.service.hold('ticket-1'));

    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
    expect(ctx.prisma.visit.update).not.toHaveBeenCalled();
  });
});
