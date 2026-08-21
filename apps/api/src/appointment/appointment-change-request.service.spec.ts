import { BadRequestException, ConflictException } from '@nestjs/common';
import { AppointmentChangeRequestService } from './appointment-change-request.service';
import { AppointmentService } from './appointment.service';
import { StaffNotificationService } from './staff-notification.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// PHASE 7 — THE CLINIC DECIDES, THROUGH THE CANONICAL PATHS.
//
// Approving a reschedule must BE a reschedule (locks, engine, history), a
// taken slot must leave the request PENDING, and declining must touch nothing
// but the request. Each of those is a pin.
// ===========================================================================

const REQUEST = {
  id: 'req-1',
  tenantId: 't1',
  clinicId: 'clinic-1',
  appointmentId: 'appt-1',
  type: 'RESCHEDULE',
  status: 'PENDING',
  reason: 'Outstation that morning',
  requestedStart: new Date('2026-09-02T02:00:00.000Z'),
  requestedEnd: new Date('2026-09-02T02:30:00.000Z'),
  decisionNote: null,
  decidedByStaffId: null,
  decidedAt: null,
  createdAt: new Date('2026-08-21T10:00:00.000Z'),
};

function build(world: { request?: Record<string, unknown> | null; role?: string } = {}) {
  const request = world.request === undefined ? { ...REQUEST } : world.request;
  const decisions: { where: unknown; data: unknown }[] = [];
  const events: Record<string, unknown>[] = [];

  const tx = {
    staff: {
      findUnique: jest.fn(async () => ({
        id: 'staff-1',
        fullName: 'Sarah',
        role: world.role ?? 'OWNER_ADMIN',
        active: true,
        clinicId: 'clinic-1',
      })),
    },
    staffRoleAssignment: { findMany: jest.fn(async () => []) },
    staffPermissionGrant: { findMany: jest.fn(async () => []) },
    appointmentChangeRequest: {
      updateMany: jest.fn(async (args: { where: unknown; data: unknown }) => {
        decisions.push(args);
        return { count: request ? 1 : 0 };
      }),
      findUniqueOrThrow: jest.fn(async () => ({ ...request, ...((decisions[0]?.data as object) ?? {}) })),
    },
    appointmentEvent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      }),
    },
    $executeRaw: jest.fn(async () => 1),
  };

  const scoped = {
    appointmentChangeRequest: {
      findUnique: jest.fn(async () => request),
      findMany: jest.fn(async () => []),
    },
    appointment: { findUnique: jest.fn(async () => null) },
  } as unknown as TenantScopedPrismaClient;

  const rawPrisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;

  const appointments = {
    reschedule: jest.fn(async () => ({})),
    cancel: jest.fn(async () => ({})),
  } as unknown as AppointmentService;

  const staffNotifications = { notify: jest.fn(async () => 0) } as unknown as StaffNotificationService;

  const service = new AppointmentChangeRequestService(
    scoped,
    rawPrisma,
    appointments,
    staffNotifications,
  );
  const run = <T>(fn: () => Promise<T>) =>
    tenantContextStorage.run({ tenantId: 't1', staffId: 'staff-1', userId: 'u1' }, fn);

  return { service, appointments, decisions, events, run };
}

describe('approving is the canonical act, not a shortcut', () => {
  it('1. approving a reschedule calls the SAME reschedule path with the requested time', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.approve('req-1'));

    expect(ctx.appointments.reschedule).toHaveBeenCalledWith('appt-1', {
      scheduledStart: REQUEST.requestedStart.toISOString(),
      scheduledEnd: REQUEST.requestedEnd.toISOString(),
      reason: 'Approved patient request — Outstation that morning',
    });
    expect(ctx.decisions[0]).toMatchObject({
      where: { id: 'req-1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'APPROVED' }),
    });
    expect(ctx.events).toContainEqual(
      expect.objectContaining({ eventType: 'CHANGE_REQUEST_APPROVED' }),
    );
  });

  it('2. a slot taken while the request waited REFUSES the approval and leaves it PENDING (7E)', async () => {
    const ctx = build();
    (ctx.appointments.reschedule as jest.Mock).mockRejectedValue(
      new ConflictException('That time is already booked.'),
    );

    await expect(ctx.run(() => ctx.service.approve('req-1'))).rejects.toThrow(
      /no longer available.*decline the request/i,
    );
    // The request was never marked: still the clinic's to answer.
    expect(ctx.decisions).toHaveLength(0);
  });

  it('3. approving a cancellation cancels with the PATIENT_REQUEST reason and the patient’s words', async () => {
    const ctx = build({
      request: { ...REQUEST, type: 'CANCELLATION', requestedStart: null, requestedEnd: null },
    });

    await ctx.run(() => ctx.service.approve('req-1'));

    expect(ctx.appointments.cancel).toHaveBeenCalledWith('appt-1', {
      cancellationReason: 'PATIENT_REQUEST',
      cancelReason: 'Approved patient request — Outstation that morning',
    });
  });

  it('4. declining touches NOTHING but the request, and the clinic’s note travels back', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.decline('req-1', 'We could do 15:30 instead — ring us.'));

    expect(ctx.appointments.reschedule).not.toHaveBeenCalled();
    expect(ctx.appointments.cancel).not.toHaveBeenCalled();
    expect(ctx.decisions[0]).toMatchObject({
      data: expect.objectContaining({
        status: 'DECLINED',
        decisionNote: 'We could do 15:30 instead — ring us.',
      }),
    });
    expect(ctx.events).toContainEqual(
      expect.objectContaining({ eventType: 'CHANGE_REQUEST_DECLINED' }),
    );
  });

  it('5. an already-decided request is refused, in words', async () => {
    const ctx = build({ request: { ...REQUEST, status: 'DECLINED' } });

    await expect(ctx.run(() => ctx.service.decline('req-1'))).rejects.toThrow(
      /already been decided/i,
    );
  });

  it('6. deciding needs the diary permission the approval would use — a stock clerk cannot', async () => {
    const ctx = build({ role: 'STOCK_STAFF' });

    await expect(ctx.run(() => ctx.service.decline('req-1'))).rejects.toThrow();
    expect(ctx.decisions).toHaveLength(0);
  });

  it('7. a malformed reschedule request (no time) cannot be approved into nonsense', async () => {
    const ctx = build({ request: { ...REQUEST, requestedStart: null, requestedEnd: null } });

    await expect(ctx.run(() => ctx.service.approve('req-1'))).rejects.toThrow(
      BadRequestException,
    );
    expect(ctx.appointments.reschedule).not.toHaveBeenCalled();
  });
});
