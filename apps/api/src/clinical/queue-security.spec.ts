import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { QueueTicketStatus } from '@prisma/client';
import { QueueTicketService } from './queue-ticket.service';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// S3 (D-079) — QUEUE SECURITY AND EXISTING-TRANSITION INTEGRITY
//
// Before S3, every route exercised below was reachable by anyone who could
// reach the API: no authentication, no role check, no branch check. Any caller
// could create a ticket, call a patient to a room, reassign the attending
// doctor, or close someone else's visit.
//
// These tests sit on the SERVICE, not the screen, on purpose. A hidden button
// is presentation; it is not access control, and it is not what an attacker
// talks to.
// ===========================================================================

const FRONT_DESK: Record<string, unknown> = {
  id: 'staff-1',
  fullName: 'Aminah Counter',
  role: 'FRONT_DESK_CLINICAL_STAFF',
  active: true,
  clinicId: 'clinic-1',
  userId: 'user-1',
};

function staffOf(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...FRONT_DESK, ...overrides };
}

function createService(actor: Record<string, unknown> | null = FRONT_DESK) {
  const prisma = {
    queueTicket: { count: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    room: { findUnique: jest.fn() },
    visit: { update: jest.fn() },
  } as unknown as TenantScopedPrismaClient;

  const visits = {
    create: jest.fn().mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1' }),
    checkOut: jest.fn(),
  } as unknown as VisitService;

  // Staff are looked up BY ID, not "whoever the mock was told to return last".
  // `call` resolves the actor and, separately, the staff member being assigned
  // as attending clinician — two different rows in one request. A mock that
  // cannot tell them apart cannot test S3F at all.
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
    // Serves both assertMayTouchVisit (wants clinicId) and the attending
    // change (wants staffId), so it carries both.
    visit: {
      findUnique: jest.fn().mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1', staffId: 'staff-1' }),
      update: jest.fn(),
    },
    queueTicket: { findUnique: jest.fn(), update: jest.fn() },
    visitWorkflowEvent: { create: jest.fn() },
  };
  const rawPrisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  return {
    service: new QueueTicketService(prisma, rawPrisma, visits),
    prisma,
    visits,
    tx,
    staffDirectory,
    actorId: (actor?.id as string) ?? 'staff-1',
  };
}

type Ctx = ReturnType<typeof createService>;

/**
 * A ticket is read twice: once by the tenant-scoped client for the response
 * shape, and once INSIDE the authorisation/completion transaction. The helper
 * keeps both in step so a test states the ticket once.
 */
function setTicket(ctx: Ctx, ticket: Record<string, unknown> | null) {
  (ctx.prisma.queueTicket.findUnique as jest.Mock).mockResolvedValue(ticket);
  ctx.tx.queueTicket.findUnique.mockResolvedValue(ticket);
  (ctx.prisma.queueTicket.update as jest.Mock).mockResolvedValue({ id: 't1' });
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant', staffId: 'staff-1' }, fn);
}

/** Runs as whichever staff member the context was built for. */
function asActor<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant', staffId: ctx.actorId }, fn);
}

/** A session with a tenant but no authenticated staff member — S3A. */
function anonymously<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' } as never, fn);
}

/** Every mutation route, so a rule can be asserted across all of them at once. */
const MUTATIONS: Array<[string, (ctx: Ctx) => Promise<unknown>]> = [
  [
    'addToQueue',
    (c) => c.service.addToQueue({ clinicId: 'c1', patientId: 'p1', staffId: 's1', billingType: 'Self-pay' }),
  ],
  ['call', (c) => c.service.call('t1', 'room-1')],
  ['arrived', (c) => c.service.arrived('t1')],
  ['moveToDispensary', (c) => c.service.moveToDispensary('t1')],
  ['complete', (c) => c.service.complete('t1')],
  ['cancel', (c) => c.service.cancel('t1', { cancelReason: 'Patient left' })],
];

/** No write reached either client. */
function expectNoWrites(ctx: Ctx) {
  expect(ctx.prisma.queueTicket.create).not.toHaveBeenCalled();
  expect(ctx.prisma.queueTicket.update).not.toHaveBeenCalled();
  expect(ctx.prisma.visit.update).not.toHaveBeenCalled();
  expect(ctx.tx.queueTicket.update).not.toHaveBeenCalled();
  expect(ctx.tx.visit.update).not.toHaveBeenCalled();
}

describe('S3A — authentication', () => {
  it.each(MUTATIONS)('%s is denied without an authenticated staff member', async (_name, run) => {
    const ctx = createService(null);
    await expect(anonymously(() => run(ctx))).rejects.toThrow(ForbiddenException);
    expectNoWrites(ctx);
  });

  it.each(MUTATIONS)('%s is denied when the staff account is inactive', async (_name, run) => {
    const ctx = createService(staffOf({ active: false }));
    await expect(withTenant(() => run(ctx))).rejects.toThrow(ForbiddenException);
    expectNoWrites(ctx);
  });

  it('a staff id that no longer resolves is denied, not treated as trusted', async () => {
    const ctx = createService(null); // nothing in the directory for 'staff-1'
    await expect(withTenant(() => ctx.service.arrived('t1'))).rejects.toThrow(ForbiddenException);
    expectNoWrites(ctx);
  });
});

describe('S3C — role matrix', () => {
  // Each row: a role, and the call it must NOT be able to make. These are the
  // least-privilege decisions recorded in queue-authorization.ts.
  const DENIED: Array<[string, string, (ctx: Ctx) => Promise<unknown>]> = [
    ['FINANCE_STAFF', 'addToQueue', MUTATIONS[0][1]],
    ['STOCK_STAFF', 'addToQueue', MUTATIONS[0][1]],
    ['PATIENT_PORTAL', 'addToQueue', MUTATIONS[0][1]],
    ['FINANCE_STAFF', 'call', MUTATIONS[1][1]],
    ['HR_STAFF', 'call', MUTATIONS[1][1]],
    ['FINANCE_STAFF', 'arrived', MUTATIONS[2][1]],
    ['FINANCE_STAFF', 'moveToDispensary', MUTATIONS[3][1]],
    // JUDGEMENT CALL 2 — completing also sets Visit.checkOutAt, so it closes
    // the visit. That is counter work, and it follows MARK_PAID's reasoning:
    // a doctor does not acquire closing rights by being a doctor.
    ['DOCTOR_RESIDENT', 'complete', MUTATIONS[4][1]],
    ['DOCTOR_LOCUM', 'complete', MUTATIONS[4][1]],
    ['STOCK_STAFF', 'complete', MUTATIONS[4][1]],
    // JUDGEMENT CALL 3 — cancelling removes a patient from the day's work.
    ['DOCTOR_RESIDENT', 'cancel', MUTATIONS[5][1]],
    ['FINANCE_STAFF', 'cancel', MUTATIONS[5][1]],
  ];

  it.each(DENIED)('%s cannot %s', async (role, _name, run) => {
    const ctx = createService(staffOf({ role }));
    await expect(withTenant(() => run(ctx))).rejects.toThrow(ForbiddenException);
    expectNoWrites(ctx);
  });

  it('the role check runs BEFORE anything is read, so a refusal leaks nothing', async () => {
    const ctx = createService(staffOf({ role: 'FINANCE_STAFF' }));
    await expect(withTenant(() => ctx.service.cancel('t1', { cancelReason: 'x' }))).rejects.toThrow(
      ForbiddenException,
    );
    expect(ctx.tx.queueTicket.findUnique).not.toHaveBeenCalled();
  });

  it('front desk retains every permission it needs to run the counter', async () => {
    const ctx = createService();
    setTicket(ctx, { id: 't1', visitId: 'visit-1', status: QueueTicketStatus.WAITING });
    await expect(withTenant(() => ctx.service.arrived('t1'))).resolves.toBeDefined();
  });

  // SUPERSEDED BY S3b. The original rule kept doctors out of clinician
  // assignment entirely; the owner corrected it, because that made shift
  // handover impossible without the front desk. What survives is the narrow
  // part: a doctor cannot hand an unheld visit to a COLLEAGUE — picking a
  // patient up is clinical, choosing who else sees them is scheduling.
  it('a doctor may call a patient, and may take an unheld visit but not hand it on', async () => {
    const ctx = createService(staffOf({ role: 'DOCTOR_RESIDENT' }));
    ctx.staffDirectory['s-new'] = staffOf({ id: 's-new', role: 'DOCTOR_LOCUM' });
    ctx.staffDirectory['s-original'] = staffOf({ id: 's-original', userId: 'u-orig' });
    ctx.tx.visit.findUnique.mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1', staffId: 's-original' });
    setTicket(ctx, {
      id: 't1',
      visitId: 'visit-1',
      clinicId: 'clinic-1',
      status: QueueTicketStatus.WAITING,
      visit: { staffId: 's-original' },
    });

    await expect(withTenant(() => ctx.service.call('t1'))).resolves.toBeDefined();
    await expect(withTenant(() => ctx.service.call('t1', undefined, 's-new'))).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('S3B — server-side reference resolution and non-disclosure', () => {
  it('the ticket is written from the RESOLVED visit, never the requested clinic', async () => {
    const ctx = createService();
    // The browser asks for 'attacker-clinic'; VisitService resolves 'real-clinic'.
    (ctx.visits.create as jest.Mock).mockResolvedValue({ id: 'visit-1', clinicId: 'real-clinic' });
    (ctx.prisma.queueTicket.count as jest.Mock).mockResolvedValue(0);
    (ctx.prisma.queueTicket.create as jest.Mock).mockResolvedValue({ id: 'ticket-1' });

    await withTenant(() =>
      ctx.service.addToQueue({
        clinicId: 'attacker-clinic',
        patientId: 'p1',
        staffId: 's1',
        billingType: 'Self-pay',
      }),
    );

    expect(ctx.prisma.queueTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clinicId: 'real-clinic' }) }),
    );
    expect(ctx.prisma.queueTicket.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ clinicId: 'real-clinic' }) }),
    );
  });

  it('a rejected visit resolution writes no ticket at all', async () => {
    const ctx = createService();
    (ctx.visits.create as jest.Mock).mockRejectedValue(new ForbiddenException('branch'));

    await expect(
      withTenant(() =>
        ctx.service.addToQueue({ clinicId: 'c1', patientId: 'p1', staffId: 's1', billingType: 'Self-pay' }),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(ctx.prisma.queueTicket.create).not.toHaveBeenCalled();
  });

  it('a second ticket for one visit is refused in the product’s own words', async () => {
    const ctx = createService();
    (ctx.prisma.queueTicket.count as jest.Mock).mockResolvedValue(0);
    (ctx.prisma.queueTicket.create as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Unique constraint failed on the fields: (`visitId`)'), { code: 'P2002' }),
    );

    const error = await withTenant(() =>
      ctx.service
        .addToQueue({ clinicId: 'c1', patientId: 'p1', staffId: 's1', billingType: 'Self-pay' })
        .catch((e: Error) => e),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe('This visit is already in the queue.');
  });

  it('a foreign ticket and a nonexistent ticket are indistinguishable', async () => {
    // Under RLS a ticket belonging to another tenant reads back as nothing, so
    // both cases arrive here identically — and must LEAVE identically.
    const foreign = createService();
    setTicket(foreign, null);
    const missing = createService();
    setTicket(missing, null);

    const a = await withTenant(() => foreign.service.arrived('someone-elses-ticket').catch((e: Error) => e));
    const b = await withTenant(() => missing.service.arrived('does-not-exist').catch((e: Error) => e));

    expect(a).toBeInstanceOf(NotFoundException);
    expect((a as Error).message).toBe('Queue ticket not found');
    expect((a as Error).message).toBe((b as Error).message);
  });

  it('no refusal exposes database wording', async () => {
    const ctx = createService();
    (ctx.prisma.queueTicket.count as jest.Mock).mockResolvedValue(0);
    (ctx.prisma.queueTicket.create as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Unique constraint failed on the fields: (`visitId`)'), { code: 'P2002' }),
    );
    const conflict = await withTenant(() =>
      ctx.service
        .addToQueue({ clinicId: 'c1', patientId: 'p1', staffId: 's1', billingType: 'Self-pay' })
        .catch((e: Error) => e),
    );

    const denied = createService(staffOf({ role: 'FINANCE_STAFF' }));
    const forbidden = await withTenant(() => denied.service.complete('t1').catch((e: Error) => e));

    const missing = createService();
    setTicket(missing, null);
    const notFound = await withTenant(() => missing.service.arrived('nope').catch((e: Error) => e));

    const banned = /prisma|P2002|constraint|unique|sql|relation|column|tenant_id/i;
    for (const error of [conflict, forbidden, notFound]) {
      expect((error as Error).message).not.toMatch(banned);
    }
  });

  it('a mutation on a visit at an inaccessible branch is refused', async () => {
    const ctx = createService(staffOf({ clinicId: 'clinic-1' }));
    ctx.tx.clinic.count.mockResolvedValue(2); // genuinely multi-branch
    ctx.tx.visit.findUnique.mockResolvedValue({ clinicId: 'clinic-2' });
    setTicket(ctx, { id: 't1', visitId: 'visit-1', status: QueueTicketStatus.WAITING });

    await expect(withTenant(() => ctx.service.arrived('t1'))).rejects.toThrow(ForbiddenException);
    expectNoWrites(ctx);
  });

  it('branch is checked against the visit’s STORED clinic, not the request', async () => {
    const ctx = createService(staffOf({ clinicId: 'clinic-1' }));
    ctx.tx.clinic.count.mockResolvedValue(2);
    ctx.tx.visit.findUnique.mockResolvedValue({ clinicId: 'clinic-1' });
    // The ticket row claims a different clinic; the VISIT is the authority.
    setTicket(ctx, { id: 't1', visitId: 'visit-1', clinicId: 'clinic-2', status: QueueTicketStatus.WAITING });

    await expect(withTenant(() => ctx.service.arrived('t1'))).resolves.toBeDefined();
    expect(ctx.tx.visit.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'visit-1' } }),
    );
  });
});

describe('S3F — call and attending-clinician assignment', () => {
  function callCtx(actor: Record<string, unknown> = FRONT_DESK) {
    const ctx = createService(actor);
    setTicket(ctx, {
      id: 't1',
      visitId: 'visit-1',
      clinicId: 'clinic-1',
      status: QueueTicketStatus.WAITING,
      visit: { staffId: 's-original' },
    });
    return ctx;
  }

  it('a foreign staff id is refused — it resolves to nothing under the tenant', async () => {
    const ctx = callCtx();
    await expect(withTenant(() => ctx.service.call('t1', undefined, 'other-tenant-staff'))).rejects.toThrow(
      NotFoundException,
    );
    expect(ctx.prisma.visit.update).not.toHaveBeenCalled();
  });

  it('an inactive staff member cannot be recorded as the attending clinician', async () => {
    const ctx = callCtx();
    ctx.staffDirectory['s-new'] = staffOf({ id: 's-new', active: false });
    await expect(withTenant(() => ctx.service.call('t1', undefined, 's-new'))).rejects.toThrow(
      BadRequestException,
    );
    expect(ctx.prisma.visit.update).not.toHaveBeenCalled();
  });

  it('a staff member from another branch cannot be recorded as the attending clinician', async () => {
    const ctx = callCtx();
    ctx.tx.clinic.count.mockResolvedValue(2);
    ctx.staffDirectory['s-new'] = staffOf({ id: 's-new', clinicId: 'clinic-9', userId: 'user-9' });
    await expect(withTenant(() => ctx.service.call('t1', undefined, 's-new'))).rejects.toThrow(
      BadRequestException,
    );
    expect(ctx.prisma.visit.update).not.toHaveBeenCalled();
  });

  it('a valid same-branch clinician IS recorded', async () => {
    const ctx = callCtx();
    ctx.staffDirectory['s-new'] = staffOf({ id: 's-new', role: 'DOCTOR_RESIDENT' });
    ctx.staffDirectory['s-original'] = staffOf({ id: 's-original', userId: 'u-orig' });
    ctx.tx.visit.findUnique.mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1', staffId: 's-original' });

    await withTenant(() => ctx.service.call('t1', undefined, 's-new'));

    // S3b — the write moved into the transaction alongside its audit event.
    expect(ctx.tx.visit.update).toHaveBeenCalledWith({
      where: { id: 'visit-1' },
      data: { staffId: 's-new' },
    });
  });

  it('a room from another branch is refused', async () => {
    const ctx = callCtx();
    (ctx.prisma.room.findUnique as jest.Mock).mockResolvedValue({
      id: 'room-1',
      active: true,
      clinicId: 'clinic-9',
    });
    await expect(withTenant(() => ctx.service.call('t1', 'room-1'))).rejects.toThrow(BadRequestException);
    expect(ctx.prisma.queueTicket.update).not.toHaveBeenCalled();
  });

  it('calling a patient does NOT change the attending clinician on its own', async () => {
    const ctx = callCtx();
    await withTenant(() => ctx.service.call('t1'));
    expect(ctx.prisma.visit.update).not.toHaveBeenCalled();
  });

  it('calling a patient does NOT change the queue status', async () => {
    const ctx = callCtx();
    await withTenant(() => ctx.service.call('t1'));
    expect(ctx.prisma.queueTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.not.objectContaining({ status: expect.anything() }) }),
    );
  });
});

describe('S3D — legal transitions', () => {
  function ticketIn(status: QueueTicketStatus) {
    const ctx = createService();
    setTicket(ctx, { id: 't1', visitId: 'visit-1', status });
    return ctx;
  }

  const ILLEGAL: Array<[QueueTicketStatus, string, (ctx: Ctx) => Promise<unknown>]> = [
    [QueueTicketStatus.WAITING, 'moveToDispensary', (c) => c.service.moveToDispensary('t1')],
    [QueueTicketStatus.WAITING, 'complete', (c) => c.service.complete('t1')],
    [QueueTicketStatus.IN_CONSULTATION, 'complete', (c) => c.service.complete('t1')],
    [QueueTicketStatus.COMPLETED, 'arrived', (c) => c.service.arrived('t1')],
    [QueueTicketStatus.COMPLETED, 'moveToDispensary', (c) => c.service.moveToDispensary('t1')],
    [QueueTicketStatus.COMPLETED, 'cancel', (c) => c.service.cancel('t1', { cancelReason: 'x' })],
    [QueueTicketStatus.CANCELLED, 'arrived', (c) => c.service.arrived('t1')],
    [QueueTicketStatus.CANCELLED, 'moveToDispensary', (c) => c.service.moveToDispensary('t1')],
    [QueueTicketStatus.CANCELLED, 'complete', (c) => c.service.complete('t1')],
    [QueueTicketStatus.DISPENSARY_PAYMENT, 'arrived', (c) => c.service.arrived('t1')],
  ];

  it.each(ILLEGAL)('a %s ticket cannot %s', async (status, _name, run) => {
    const ctx = ticketIn(status);
    await expect(withTenant(() => run(ctx))).rejects.toThrow(BadRequestException);
    expect(ctx.prisma.queueTicket.update).not.toHaveBeenCalled();
    expect(ctx.tx.queueTicket.update).not.toHaveBeenCalled();
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });

  it('WAITING -> IN_CONSULTATION remains functional', async () => {
    const ctx = ticketIn(QueueTicketStatus.WAITING);
    await withTenant(() => ctx.service.arrived('t1'));
    expect(ctx.prisma.queueTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: QueueTicketStatus.IN_CONSULTATION },
    });
  });

  it('IN_CONSULTATION -> DISPENSARY_PAYMENT remains functional', async () => {
    const ctx = ticketIn(QueueTicketStatus.IN_CONSULTATION);
    await withTenant(() => ctx.service.moveToDispensary('t1'));
    expect(ctx.prisma.queueTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: QueueTicketStatus.DISPENSARY_PAYMENT },
    });
  });

  it('DISPENSARY_PAYMENT -> COMPLETED remains functional', async () => {
    const ctx = ticketIn(QueueTicketStatus.DISPENSARY_PAYMENT);
    await withTenant(() => ctx.service.complete('t1'));
    expect(ctx.tx.queueTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: QueueTicketStatus.COMPLETED },
    });
  });

  it('a repeated move to dispensary is idempotent, not an error', async () => {
    const ctx = ticketIn(QueueTicketStatus.DISPENSARY_PAYMENT);
    await expect(withTenant(() => ctx.service.moveToDispensary('t1'))).resolves.toBeDefined();
    expect(ctx.prisma.queueTicket.update).not.toHaveBeenCalled();
  });

  it('a repeated arrival is idempotent and disturbs nothing else', async () => {
    const ctx = ticketIn(QueueTicketStatus.IN_CONSULTATION);
    await expect(withTenant(() => ctx.service.arrived('t1'))).resolves.toBeDefined();
    expect(ctx.prisma.queueTicket.update).not.toHaveBeenCalled();
    expect(ctx.prisma.visit.update).not.toHaveBeenCalled();
  });

  it('an illegal transition leaves the visit untouched', async () => {
    const ctx = ticketIn(QueueTicketStatus.WAITING);
    await expect(withTenant(() => ctx.service.complete('t1'))).rejects.toThrow(BadRequestException);
    expect(ctx.prisma.visit.update).not.toHaveBeenCalled();
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });
});

describe('S3E — atomic completion', () => {
  it('both writes happen inside ONE transaction', async () => {
    const ctx = createService();
    setTicket(ctx, { id: 't1', visitId: 'visit-1', status: QueueTicketStatus.DISPENSARY_PAYMENT });

    await withTenant(() => ctx.service.complete('t1'));

    expect(ctx.tx.queueTicket.update).toHaveBeenCalledTimes(1);
    expect(ctx.tx.visit.update).toHaveBeenCalledWith({
      where: { id: 'visit-1' },
      data: { checkOutAt: expect.any(Date) },
    });
    // The separate, unprotected second write is gone.
    expect(ctx.visits.checkOut).not.toHaveBeenCalled();
    expect(ctx.prisma.queueTicket.update).not.toHaveBeenCalled();
  });

  it('a failing visit update aborts the whole completion', async () => {
    const ctx = createService();
    setTicket(ctx, { id: 't1', visitId: 'visit-1', status: QueueTicketStatus.DISPENSARY_PAYMENT });
    ctx.tx.visit.update.mockRejectedValue(new Error('connection lost'));

    await expect(withTenant(() => ctx.service.complete('t1'))).rejects.toThrow();
    // The ticket update was ISSUED, but inside the same transaction as the
    // failure, so Postgres discards it. What this asserts is that the failure
    // PROPAGATES rather than being swallowed — the old two-call version
    // returned success and left a completed ticket on an open visit.
  });

  it('a repeated completion is a no-op, not a second checkout', async () => {
    const ctx = createService();
    setTicket(ctx, { id: 't1', visitId: 'visit-1', status: QueueTicketStatus.COMPLETED });

    await expect(withTenant(() => ctx.service.complete('t1'))).resolves.toBeDefined();

    expect(ctx.tx.queueTicket.update).not.toHaveBeenCalled();
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });

  it('the status is re-read INSIDE the transaction, so a stale read cannot win', async () => {
    const ctx = createService();
    // Authorisation saw DISPENSARY_PAYMENT; by the time the write transaction
    // runs, a racing request has already completed the ticket.
    (ctx.prisma.queueTicket.findUnique as jest.Mock).mockResolvedValue({
      id: 't1',
      visitId: 'visit-1',
      status: QueueTicketStatus.DISPENSARY_PAYMENT,
    });
    ctx.tx.queueTicket.findUnique
      .mockResolvedValueOnce({ id: 't1', visitId: 'visit-1', status: QueueTicketStatus.DISPENSARY_PAYMENT })
      .mockResolvedValueOnce({ id: 't1', visitId: 'visit-1', status: QueueTicketStatus.COMPLETED });

    await withTenant(() => ctx.service.complete('t1'));

    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });
});

// G4.5d3c-1 added AT_PROCEDURE, READY_FOR_DISPENSARY and READY_FOR_PAYMENT to
// the enum. No route can produce them yet, and none of the existing routes
// should pretend to understand them — a ticket that somehow held one must be
// refused, not guessed at.
describe('G4.5d3c-1 — the new statuses are inert until their endpoints exist', () => {
  const NEW_STATUSES = [
    QueueTicketStatus.AT_PROCEDURE,
    QueueTicketStatus.READY_FOR_DISPENSARY,
    QueueTicketStatus.READY_FOR_PAYMENT,
  ];

  it.each(NEW_STATUSES)('a %s ticket cannot be advanced by any existing route', async (status) => {
    for (const run of [MUTATIONS[2][1], MUTATIONS[3][1], MUTATIONS[4][1]]) {
      const ctx = createService();
      setTicket(ctx, { id: 't1', visitId: 'visit-1', status });
      await expect(withTenant(() => run(ctx))).rejects.toThrow(BadRequestException);
      expect(ctx.tx.visit.update).not.toHaveBeenCalled();
    }
  });

  it('no existing route can put a ticket INTO one of the new statuses', async () => {
    const ctx = createService();
    setTicket(ctx, { id: 't1', visitId: 'visit-1', status: QueueTicketStatus.IN_CONSULTATION });

    await withTenant(() => ctx.service.moveToDispensary('t1'));

    // Still the legacy combined status. Splitting dispensing from payment is
    // the new workflow's job, not a silent side effect of this schema change.
    expect(ctx.prisma.queueTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: QueueTicketStatus.DISPENSARY_PAYMENT },
    });
  });
});

// ===========================================================================
// S3b (D-081) — ATTENDING CLINICIAN ASSIGNMENT AND TRANSFER
//
// The owner corrected the first version of this rule: doctors were locked out
// of clinician assignment entirely, which made shift handover impossible
// without going through the front desk. Doctor-to-doctor transfer is now
// allowed. What is still refused is a doctor taking a patient who is actively
// with a colleague.
// ===========================================================================
describe('S3b — attending clinician assignment and transfer', () => {
  const DR_A = { id: 'dr-a', fullName: 'Dr Amira', role: 'DOCTOR_RESIDENT', active: true, clinicId: 'clinic-1', userId: 'u-a' };
  const DR_B = { id: 'dr-b', fullName: 'Dr Bakri', role: 'DOCTOR_LOCUM', active: true, clinicId: 'clinic-1', userId: 'u-b' };

  /** Builds a context where `held` currently holds the visit. */
  function transferCtx(actor: Record<string, unknown>, held: Record<string, unknown>) {
    const ctx = createService(actor);
    ctx.staffDirectory[held.id as string] = held;
    ctx.staffDirectory[DR_A.id] = DR_A;
    ctx.staffDirectory[DR_B.id] = DR_B;
    ctx.tx.visit.findUnique.mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1', staffId: held.id });
    setTicket(ctx, { id: 't1', visitId: 'visit-1', clinicId: 'clinic-1', status: QueueTicketStatus.IN_CONSULTATION });
    return ctx;
  }

  const change = (ctx: Ctx, staffId: string, reason?: string, correlationId?: string) =>
    asActor(ctx, () => ctx.service.changeAttendingClinician('t1', { staffId, reason, correlationId }));

  // 1 — a doctor picks up a walk-in that front desk registered under itself.
  it('a doctor can claim a visit no doctor is holding', async () => {
    const ctx = transferCtx(DR_A, FRONT_DESK);
    await change(ctx, DR_A.id);
    expect(ctx.tx.visit.update).toHaveBeenCalledWith({ where: { id: 'visit-1' }, data: { staffId: DR_A.id } });
  });

  it('a doctor claiming an unheld visit cannot hand it to a different doctor', async () => {
    const ctx = transferCtx(DR_A, FRONT_DESK);
    await expect(change(ctx, DR_B.id, 'handover')).rejects.toThrow(ForbiddenException);
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });

  // 2 — the correction itself.
  it('Dr A can transfer their own active visit to Dr B', async () => {
    const ctx = transferCtx(DR_A, DR_A);
    await change(ctx, DR_B.id, 'Shift handover');
    expect(ctx.tx.visit.update).toHaveBeenCalledWith({ where: { id: 'visit-1' }, data: { staffId: DR_B.id } });
  });

  // 3, 4
  it.each([
    ['owner', { ...FRONT_DESK, role: 'OWNER_ADMIN' }],
    ['front desk', FRONT_DESK],
  ])('%s can reassign Dr A to Dr B', async (_who, actor) => {
    const ctx = transferCtx(actor, DR_A);
    await change(ctx, DR_B.id, 'Doctor unavailable');
    expect(ctx.tx.visit.update).toHaveBeenCalledWith({ where: { id: 'visit-1' }, data: { staffId: DR_B.id } });
  });

  // The one thing the rule exists to prevent.
  it('a doctor cannot seize a visit held by another doctor', async () => {
    const ctx = transferCtx(DR_B, DR_A);
    await expect(change(ctx, DR_B.id, 'I will take this one')).rejects.toThrow(ForbiddenException);
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
    expect(ctx.tx.visitWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('the refusal does not name the doctor currently holding the visit', async () => {
    const ctx = transferCtx(DR_B, DR_A);
    const error = (await change(ctx, DR_B.id, 'mine').catch((e: Error) => e)) as Error;
    expect(error.message).not.toContain('Amira');
    expect(error.message).not.toContain(DR_A.id);
  });

  // 5, 6, 7, 8, 9 — target validation.
  it('an inactive target is refused', async () => {
    const ctx = transferCtx(DR_A, DR_A);
    ctx.staffDirectory[DR_B.id] = { ...DR_B, active: false };
    await expect(change(ctx, DR_B.id, 'handover')).rejects.toThrow(BadRequestException);
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });

  it('a target from another tenant is refused — it resolves to nothing', async () => {
    const ctx = transferCtx(DR_A, DR_A);
    await expect(change(ctx, 'other-tenant-doctor', 'handover')).rejects.toThrow(NotFoundException);
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });

  it('a target without access to the visit’s branch is refused', async () => {
    const ctx = transferCtx(DR_A, DR_A);
    ctx.tx.clinic.count.mockResolvedValue(2);
    ctx.staffDirectory[DR_B.id] = { ...DR_B, clinicId: 'clinic-9', userId: 'u-b9' };
    await expect(change(ctx, DR_B.id, 'handover')).rejects.toThrow(BadRequestException);
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });

  it('a non-doctor cannot be recorded as the attending clinician', async () => {
    const ctx = transferCtx({ ...FRONT_DESK, role: 'OWNER_ADMIN' }, DR_A);
    ctx.staffDirectory['fd-2'] = { ...FRONT_DESK, id: 'fd-2', userId: 'u-fd2' };
    await expect(change(ctx, 'fd-2', 'handover')).rejects.toThrow(ForbiddenException);
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });

  // 10, 11, 12 — prospective only.
  it('the transfer writes Visit.staffId and NOTHING else', async () => {
    const ctx = transferCtx(DR_A, DR_A);
    await change(ctx, DR_B.id, 'Clinical escalation');

    // The only visit write is the attending clinician. No note, diagnosis,
    // prescription, order, document or authorisation record is touched — a
    // handover changes who is seeing the patient now, never who wrote what.
    expect(ctx.tx.visit.update).toHaveBeenCalledTimes(1);
    expect(ctx.tx.visit.update).toHaveBeenCalledWith({
      where: { id: 'visit-1' },
      data: { staffId: DR_B.id },
    });
    const [[call]] = (ctx.tx.visit.update as jest.Mock).mock.calls;
    expect(Object.keys(call.data)).toEqual(['staffId']);
  });

  // 13, 14 — the queue does not move.
  it('the queue status and checkOutAt are untouched by a transfer', async () => {
    const ctx = transferCtx(DR_A, DR_A);
    await change(ctx, DR_B.id, 'Shift handover');

    expect(ctx.tx.queueTicket.update).not.toHaveBeenCalled();
    expect(ctx.prisma.queueTicket.update).not.toHaveBeenCalled();
    const [[visitCall]] = (ctx.tx.visit.update as jest.Mock).mock.calls;
    expect(visitCall.data).not.toHaveProperty('checkOutAt');
    expect(visitCall.data).not.toHaveProperty('doctorCompletedAt');
  });

  // 17 — idempotency.
  it('transferring to the doctor who already holds the visit is a no-op', async () => {
    const ctx = transferCtx(DR_A, DR_A);
    await expect(change(ctx, DR_A.id)).resolves.toBeDefined();
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
    // And critically no event: a handover that did not happen must not appear
    // in the history.
    expect(ctx.tx.visitWorkflowEvent.create).not.toHaveBeenCalled();
  });

  // 18 — one immutable event, with both doctors on it.
  it('a transfer writes exactly one workflow event naming both doctors', async () => {
    const ctx = transferCtx(DR_A, DR_A);
    await change(ctx, DR_B.id, 'Shift handover', 'corr-1');

    expect(ctx.tx.visitWorkflowEvent.create).toHaveBeenCalledTimes(1);
    const [[event]] = ctx.tx.visitWorkflowEvent.create.mock.calls;
    expect(event.data).toMatchObject({
      visitId: 'visit-1',
      queueTicketId: 't1',
      clinicId: 'clinic-1',
      eventType: 'ATTENDING_CLINICIAN_CHANGED',
      previousStaffId: DR_A.id,
      newStaffId: DR_B.id,
      actorStaffId: DR_A.id,
      actorRoleSnapshot: 'DOCTOR_RESIDENT',
      reason: 'Shift handover',
      correlationId: 'corr-1',
    });
    // No queue transition is claimed, because none happened.
    expect(event.data.previousStatus).toBeUndefined();
    expect(event.data.newStatus).toBeUndefined();
  });

  it('the event and the visit write are in the SAME transaction', async () => {
    const ctx = transferCtx(DR_A, DR_A);
    ctx.tx.visitWorkflowEvent.create.mockRejectedValue(new Error('disk full'));
    // If recording the handover fails, the handover itself must not stand.
    await expect(change(ctx, DR_B.id, 'Shift handover')).rejects.toThrow();
  });

  // A reason is required when replacing a doctor, not when picking one up.
  it('replacing an existing doctor without a reason is refused', async () => {
    const ctx = transferCtx(DR_A, DR_A);
    await expect(change(ctx, DR_B.id)).rejects.toThrow(BadRequestException);
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });

  it('whitespace does not count as a reason', async () => {
    const ctx = transferCtx(DR_A, DR_A);
    await expect(change(ctx, DR_B.id, '   ')).rejects.toThrow(BadRequestException);
  });

  it('claiming an unheld visit needs no reason', async () => {
    const ctx = transferCtx(DR_A, FRONT_DESK);
    await expect(change(ctx, DR_A.id)).resolves.toBeDefined();
  });

  // 19
  it.each(['FINANCE_STAFF', 'STOCK_STAFF', 'HR_STAFF', 'PATIENT_PORTAL'])(
    '%s cannot change the attending clinician',
    async (role) => {
      const ctx = transferCtx({ ...FRONT_DESK, role }, DR_A);
      await expect(change(ctx, DR_B.id, 'handover')).rejects.toThrow(ForbiddenException);
      expect(ctx.tx.visit.update).not.toHaveBeenCalled();
    },
  );

  it('an anonymous caller cannot change the attending clinician', async () => {
    const ctx = createService(null);
    await expect(
      anonymously(() => ctx.service.changeAttendingClinician('t1', { staffId: DR_B.id })),
    ).rejects.toThrow(ForbiddenException);
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });

  it('the holder is re-read INSIDE the transaction, so a stale read cannot win', async () => {
    const ctx = transferCtx(DR_B, DR_A);
    // Authorisation may have seen an unheld visit; by write time Dr A holds it.
    ctx.tx.visit.findUnique
      .mockResolvedValueOnce({ id: 'visit-1', clinicId: 'clinic-1', staffId: FRONT_DESK.id })
      .mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1', staffId: DR_A.id });

    await expect(change(ctx, DR_B.id, 'taking over')).rejects.toThrow(ForbiddenException);
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// S3c (D-082) — an UNASSIGNED visit is now a real state.
//
// `Visit.staffId` is nullable, so "nobody has taken this patient" no longer
// has to be faked by storing the front-desk clerk who typed the visit in.
// ===========================================================================
describe('S3c — claiming a genuinely unassigned visit', () => {
  const DR_A = { id: 'dr-a', fullName: 'Dr Amira', role: 'DOCTOR_RESIDENT', active: true, clinicId: 'clinic-1', userId: 'u-a' };
  const DR_B = { id: 'dr-b', fullName: 'Dr Bakri', role: 'DOCTOR_LOCUM', active: true, clinicId: 'clinic-1', userId: 'u-b' };

  /** A visit with NO attending clinician at all. */
  function unassignedCtx(actor: Record<string, unknown>) {
    const ctx = createService(actor);
    ctx.staffDirectory[DR_A.id] = DR_A;
    ctx.staffDirectory[DR_B.id] = DR_B;
    ctx.tx.visit.findUnique.mockResolvedValue({ id: 'visit-1', clinicId: 'clinic-1', staffId: null });
    setTicket(ctx, { id: 't1', visitId: 'visit-1', clinicId: 'clinic-1', status: QueueTicketStatus.WAITING });
    return ctx;
  }

  const change = (ctx: Ctx, staffId: string, reason?: string) =>
    asActor(ctx, () => ctx.service.changeAttendingClinician('t1', { staffId, reason }));

  it('a doctor claims a visit with no attending clinician, no reason needed', async () => {
    const ctx = unassignedCtx(DR_A);
    await expect(change(ctx, DR_A.id)).resolves.toBeDefined();
    expect(ctx.tx.visit.update).toHaveBeenCalledWith({
      where: { id: 'visit-1' },
      data: { staffId: DR_A.id },
    });
  });

  it('the claim event records that there was no previous doctor', async () => {
    const ctx = unassignedCtx(DR_A);
    await change(ctx, DR_A.id);

    const [[event]] = ctx.tx.visitWorkflowEvent.create.mock.calls;
    // Not the registrar, not a placeholder — genuinely nobody.
    expect(event.data.previousStaffId).toBeNull();
    expect(event.data.newStaffId).toBe(DR_A.id);
  });

  it('a doctor still cannot hand an unclaimed visit to a colleague', async () => {
    const ctx = unassignedCtx(DR_A);
    await expect(change(ctx, DR_B.id, 'you take it')).rejects.toThrow(ForbiddenException);
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
  });

  it('front desk may assign an unassigned visit to any eligible doctor', async () => {
    const ctx = unassignedCtx(FRONT_DESK);
    await expect(change(ctx, DR_B.id)).resolves.toBeDefined();
    expect(ctx.tx.visit.update).toHaveBeenCalledWith({
      where: { id: 'visit-1' },
      data: { staffId: DR_B.id },
    });
  });

  it('a claim still refuses a non-doctor, an inactive doctor and a foreign id', async () => {
    for (const [label, target] of [
      ['non-doctor', { ...FRONT_DESK, id: 'fd-2', userId: 'u-fd2' }],
      ['inactive', { ...DR_B, active: false }],
    ] as const) {
      const ctx = unassignedCtx(FRONT_DESK);
      ctx.staffDirectory[target.id as string] = target as Record<string, unknown>;
      await expect(change(ctx, target.id as string)).rejects.toThrow();
      expect(ctx.tx.visit.update).not.toHaveBeenCalled();
      expect(label).toBeTruthy();
    }
    const foreign = unassignedCtx(FRONT_DESK);
    await expect(change(foreign, 'other-tenant-doctor')).rejects.toThrow(NotFoundException);
  });

  it('claiming never writes to registration attribution', async () => {
    const ctx = unassignedCtx(DR_A);
    await change(ctx, DR_A.id);

    const [[call]] = (ctx.tx.visit.update as jest.Mock).mock.calls;
    // Who registered the visit is a separate, permanent fact. Taking the
    // patient on does not rewrite who booked them in.
    expect(Object.keys(call.data)).toEqual(['staffId']);
    expect(call.data).not.toHaveProperty('registeredByStaffId');
  });
});

describe('S3G — cancellation', () => {
  it('cancels an active ticket, retaining the row and the reason', async () => {
    const ctx = createService();
    setTicket(ctx, { id: 't1', visitId: 'visit-1', clinicId: 'clinic-1', status: QueueTicketStatus.WAITING });

    await withTenant(() => ctx.service.cancel('t1', { cancelReason: 'Patient left before consultation' }));

    // D-085 — the status change moved into the transaction that also records
    // the audit event, so the two cannot come apart.
    expect(ctx.tx.queueTicket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: {
        status: QueueTicketStatus.CANCELLED,
        cancelReason: 'Patient left before consultation',
      },
    });
  });

  // G4.5d3c-1c (D-085) — S3 could store a cancellation REASON and nothing
  // else: no actor, no timestamp. The immutable workflow event carries both,
  // and being append-only at the database level (D-083) it cannot later be
  // edited to say someone else cancelled the visit.
  it('cancellation writes exactly one immutable event with actor, reason and both statuses', async () => {
    const ctx = createService();
    setTicket(ctx, {
      id: 't1',
      visitId: 'visit-1',
      clinicId: 'clinic-1',
      status: QueueTicketStatus.IN_CONSULTATION,
    });

    await withTenant(() =>
      ctx.service.cancel('t1', { cancelReason: 'Patient left', correlationId: 'corr-c1' }),
    );

    expect(ctx.tx.visitWorkflowEvent.create).toHaveBeenCalledTimes(1);
    const [[event]] = ctx.tx.visitWorkflowEvent.create.mock.calls;
    expect(event.data).toMatchObject({
      visitId: 'visit-1',
      queueTicketId: 't1',
      clinicId: 'clinic-1',
      eventType: 'VISIT_CANCELLED',
      previousStatus: QueueTicketStatus.IN_CONSULTATION,
      newStatus: QueueTicketStatus.CANCELLED,
      actorStaffId: 'staff-1',
      actorRoleSnapshot: 'FRONT_DESK_CLINICAL_STAFF',
      reason: 'Patient left',
      correlationId: 'corr-c1',
    });
    // createdAt is the database default, so the timestamp cannot be back-dated
    // by the caller.
    expect(event.data).not.toHaveProperty('createdAt');
  });

  it('a repeated cancellation writes NO second event', async () => {
    const ctx = createService();
    setTicket(ctx, { id: 't1', visitId: 'visit-1', clinicId: 'clinic-1', status: QueueTicketStatus.CANCELLED });

    // Idempotent rather than an error: a double-click is not a second
    // cancellation, and two events for one cancellation is a false history.
    await expect(withTenant(() => ctx.service.cancel('t1', { cancelReason: 'again' }))).resolves.toBeDefined();

    expect(ctx.tx.queueTicket.update).not.toHaveBeenCalled();
    expect(ctx.tx.visitWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('a failed event insert rolls the cancellation back', async () => {
    const ctx = createService();
    setTicket(ctx, { id: 't1', visitId: 'visit-1', clinicId: 'clinic-1', status: QueueTicketStatus.WAITING });
    ctx.tx.visitWorkflowEvent.create.mockRejectedValue(new Error('disk full'));

    // An unrecorded cancellation is as wrong as a recorded one that did not
    // happen. Only atomicity rules out each.
    await expect(withTenant(() => ctx.service.cancel('t1', { cancelReason: 'x' }))).rejects.toThrow();
  });

  it('a COMPLETED ticket still cannot be cancelled', async () => {
    const ctx = createService();
    setTicket(ctx, { id: 't1', visitId: 'visit-1', clinicId: 'clinic-1', status: QueueTicketStatus.COMPLETED });

    await expect(withTenant(() => ctx.service.cancel('t1', { cancelReason: 'x' }))).rejects.toThrow(
      BadRequestException,
    );
    expect(ctx.tx.visitWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('cancelling deletes nothing and closes nothing', async () => {
    const ctx = createService();
    setTicket(ctx, { id: 't1', visitId: 'visit-1', status: QueueTicketStatus.IN_CONSULTATION });

    await withTenant(() => ctx.service.cancel('t1', { cancelReason: 'Duplicate ticket' }));

    expect(ctx.prisma.visit.update).not.toHaveBeenCalled();
    expect(ctx.tx.visit.update).not.toHaveBeenCalled();
    expect(ctx.visits.checkOut).not.toHaveBeenCalled();
  });
});
