import { AppointmentStatus } from '@prisma/client';
import { AppointmentService } from './appointment.service';
import { AppointmentBookingValidator } from './appointment-booking-validator.service';
import { QueueTicketService } from '../clinical/queue-ticket.service';
import { PrismaService } from '../core/prisma.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

const APPT = 'appt-1';

// ===========================================================================
// THE LIFECYCLE LINKS — arrival, completion, cancellation.
//
// `arrived()` had NO test at all before this file, which is how it shipped
// creating a queue ticket and then losing track of the visit that ticket hung
// on. Everything downstream of that link — completing the appointment when the
// consultation completes, and opening the right record from the calendar —
// was impossible without it.
// ===========================================================================

function build(world: { appointment?: Record<string, unknown> } = {}) {
  const updates: Record<string, unknown>[] = [];
  const appointment = {
    id: APPT,
    clinicId: 'clinic-1',
    patientId: 'pat-1',
    staffId: 'doc-1',
    serviceId: 'svc-1',
    status: AppointmentStatus.CONFIRMED,
    notes: 'Sore throat',
    ...world.appointment,
  };

  const prisma = {
    appointment: {
      findUnique: jest.fn(async () => appointment),
      update: jest.fn(async ({ data }: never) => {
        updates.push(data as Record<string, unknown>);
        return { ...appointment, ...(data as object) };
      }),
    },
  } as unknown as TenantScopedPrismaClient;

  const queueTickets = {
    // What `addToQueue` really returns: the ticket, carrying the id of the
    // visit it created.
    addToQueue: jest.fn(async () => ({ id: 'ticket-1', visitId: 'visit-9' })),
  } as unknown as QueueTicketService;

  const service = new AppointmentService(
    prisma,
    {} as AppointmentBookingValidator,
    queueTickets,
    {} as PrismaService,
  );

  const run = <T>(fn: () => Promise<T>) =>
    tenantContextStorage.run({ tenantId: 't1', staffId: 'staff-7', userId: 'u1' }, fn);

  return { service, prisma, queueTickets, updates, run };
}

describe('arriving turns an appointment into a visit', () => {
  it('1. the queue ticket is type A — appointments do not join the walk-in stream', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.arrived(APPT));

    expect(ctx.queueTickets.addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ queueType: 'APPOINTMENT' }),
    );
  });

  it('2. the visit the ticket created is RECORDED on the appointment', async () => {
    // The whole point. Without it `completeVisit` cannot find the appointment
    // that started the consultation, and the calendar's "open record" has to
    // guess at the patient's most recent visit — wrong the moment they have two.
    const ctx = build();

    await ctx.run(() => ctx.service.arrived(APPT));

    expect(ctx.updates).toContainEqual({ visitId: 'visit-9' });
  });

  it('3. the status moves to ARRIVED with the moment it happened', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.arrived(APPT));

    expect(ctx.updates[0]).toMatchObject({ status: AppointmentStatus.ARRIVED });
    expect(ctx.updates[0].arrivedAt).toBeInstanceOf(Date);
  });

  it('4. the presenting complaint carries the booking notes into the queue', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.arrived(APPT));

    expect(ctx.queueTickets.addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ presentingComplaint: 'Sore throat' }),
    );
  });

  it.each([
    AppointmentStatus.COMPLETED,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
    AppointmentStatus.ARRIVED,
  ])('5. %s cannot arrive again, and no second ticket is cut', async (status) => {
    // A second ticket for the same patient is a second place in the queue.
    const ctx = build({ appointment: { status } });

    await expect(ctx.run(() => ctx.service.arrived(APPT))).rejects.toThrow();
    expect(ctx.queueTickets.addToQueue).not.toHaveBeenCalled();
  });
});

describe('a cancellation names who as well as why', () => {
  it('6. records the actor and the moment beside the reason', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.cancel(APPT, { cancelReason: 'Patient rang to cancel' }));

    expect(ctx.updates[0]).toMatchObject({
      status: AppointmentStatus.CANCELLED,
      cancelReason: 'Patient rang to cancel',
      cancelledByStaffId: 'staff-7',
    });
    expect(ctx.updates[0].cancelledAt).toBeInstanceOf(Date);
  });

  it('7. a cancellation with no signed-in staff still records the reason', async () => {
    // Never a throw on the attribution: refusing to cancel because the author
    // is unknown would leave the slot held by a patient who is not coming.
    const ctx = build();

    await tenantContextStorage.run({ tenantId: 't1' } as never, () =>
      ctx.service.cancel(APPT, { cancelReason: 'Clinic closed' }),
    );

    expect(ctx.updates[0]).toMatchObject({ cancelledByStaffId: null, cancelReason: 'Clinic closed' });
  });

  it.each([AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED])(
    '8. %s cannot be cancelled',
    async (status) => {
      const ctx = build({ appointment: { status } });

      await expect(ctx.run(() => ctx.service.cancel(APPT, {}))).rejects.toThrow();
    },
  );
});
