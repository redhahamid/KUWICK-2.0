import { ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { SystemRole } from '@prisma/client';
import { APPT, buildAppointmentHarness } from './appointment-test-harness';

// ===========================================================================
// DOUBLE-BOOKING, RETRIES AND OVERRIDES.
//
// §16 and §28. Three failure modes that all look like "it worked" from the
// browser and are all wrong in the database:
//
//   1. Two people take the last 10:00. Both availability checks ran before
//      either wrote, so both saw a free slot.
//   2. One person clicks twice, or the network retries a POST. Two identical
//      appointments, and the patient is called through twice.
//   3. A `force` flag arrives from a browser and the server believes it.
// ===========================================================================

const BOOKING = {
  clinicId: 'clinic-1',
  patientId: 'pat-1',
  staffId: 'doc-1',
  serviceId: 'svc-1',
  source: 'FRONT_DESK' as const,
  scheduledStart: '2026-09-01T01:00:00.000Z',
  scheduledEnd: '2026-09-01T01:30:00.000Z',
};

describe('the same request twice is one appointment', () => {
  it('1. a repeated idempotency key returns the appointment that already exists', async () => {
    const ctx = buildAppointmentHarness();
    const first = { id: 'appt-existing', status: 'CONFIRMED' };
    (ctx.tx.appointment.findFirst as jest.Mock).mockResolvedValueOnce(first);

    const result = await ctx.run(() =>
      ctx.service.create({ ...BOOKING, idempotencyKey: 'client-abc' }),
    );

    expect(result).toBe(first);
    expect(ctx.creates).toHaveLength(0);
  });

  it('2. the key is looked up BEFORE any work is done', async () => {
    // Not caught after a unique-index violation: the caller must get their
    // appointment back, not a 409 they have to interpret.
    const ctx = buildAppointmentHarness();
    (ctx.tx.appointment.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'appt-existing' });

    await ctx.run(() => ctx.service.create({ ...BOOKING, idempotencyKey: 'client-abc' }));

    expect(ctx.bookingValidator.check).not.toHaveBeenCalled();
  });

  it('3. no key means today’s behaviour — the booking is simply made', async () => {
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.create(BOOKING));

    expect(ctx.creates).toHaveLength(1);
    expect(ctx.creates[0].idempotencyKey).toBeNull();
  });

  it('4. the key is stored, so a retry arriving later still finds it', async () => {
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.create({ ...BOOKING, idempotencyKey: 'client-abc' }));

    expect(ctx.creates[0].idempotencyKey).toBe('client-abc');
  });
});

describe('two racers for the last slot are serialised, not both let through', () => {
  it('5. the diary is locked BEFORE availability is checked', async () => {
    // The order is the whole point. Checking first and locking second leaves
    // the window open: both requests read a free slot, then both write.
    const ctx = buildAppointmentHarness();
    const order: string[] = [];
    (ctx.tx.$executeRaw as jest.Mock).mockImplementation(async () => {
      order.push('lock');
      return 1;
    });
    (ctx.bookingValidator.check as jest.Mock).mockImplementation(async () => {
      order.push('check');
      return { ok: true };
    });

    await ctx.run(() => ctx.service.create(BOOKING));

    expect(order[0]).toBe('lock');
    expect(order).toContain('check');
    expect(order.indexOf('lock')).toBeLessThan(order.indexOf('check'));
  });

  it('6. both the provider and the service are locked', async () => {
    // The provider, so one doctor is not double-booked. The service, so a
    // two-room capacity is not exceeded by two bookings with different doctors.
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.create(BOOKING));

    expect(ctx.locks.some((key) => key.includes(':staff:'))).toBe(true);
    expect(ctx.locks.some((key) => key.includes(':service:'))).toBe(true);
  });

  it('7. the keys are taken in a stable order, so two racers cannot deadlock', async () => {
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.create(BOOKING));

    expect([...ctx.locks]).toEqual([...ctx.locks].sort());
  });

  it('8. the loser of the race is refused, not silently allowed', async () => {
    const ctx = buildAppointmentHarness({
      check: { ok: false, reason: 'FULLY_BOOKED', message: 'no room' },
    });

    await expect(ctx.run(() => ctx.service.create(BOOKING))).rejects.toThrow(ConflictException);
    expect(ctx.creates).toHaveLength(0);
  });
});

describe('an override is a permission and a reason, never a flag from a browser', () => {
  const OWNER = { actor: { role: 'OWNER_ADMIN' }, assignedRoles: ['OWNER' as SystemRole] };
  const FULL = { check: { ok: false as const, reason: 'FULLY_BOOKED' as const, message: 'no room' } };

  it('9. a force flag from somebody without the permission is refused', async () => {
    // "Never silently allow double-booking simply because the UI sends a force
    // flag." A flag is a request; it is not an authorisation.
    const ctx = buildAppointmentHarness(FULL);

    await expect(
      ctx.run(() =>
        ctx.service.create({ ...BOOKING, override: true, overrideReason: 'Squeeze them in' }),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(ctx.creates).toHaveLength(0);
  });

  it('10. an override with the permission but NO reason is refused', async () => {
    const ctx = buildAppointmentHarness({ ...OWNER, ...FULL });

    await expect(
      ctx.run(() => ctx.service.create({ ...BOOKING, override: true })),
    ).rejects.toThrow(BadRequestException);
  });

  it('11. a permitted override with a reason books, and records all three facts', async () => {
    const ctx = buildAppointmentHarness({ ...OWNER, ...FULL });

    await ctx.run(() =>
      ctx.service.create({
        ...BOOKING,
        override: true,
        overrideReason: 'Patient travelling tomorrow',
      }),
    );

    expect(ctx.creates[0]).toMatchObject({
      overriddenRule: 'FULLY_BOOKED',
      overrideReason: 'Patient travelling tomorrow',
      overriddenByStaffId: 'staff-7',
    });
  });

  it('12. the override is in the appointment history as its own event', async () => {
    const ctx = buildAppointmentHarness({ ...OWNER, ...FULL });

    await ctx.run(() =>
      ctx.service.create({ ...BOOKING, override: true, overrideReason: 'Patient travelling' }),
    );

    expect(ctx.events).toContainEqual(
      expect.objectContaining({
        eventType: 'OVERRIDE_APPLIED',
        reason: 'Patient travelling',
      }),
    );
  });

  it.each([
    ['approved leave', 'ON_LEAVE'],
    ['a closed branch', 'CLINIC_CLOSED'],
    ['an unqualified provider', 'NOT_QUALIFIED'],
    ['a public holiday closure', 'PUBLIC_HOLIDAY'],
  ])('13. %s cannot be overridden by anybody', async (_label, reason) => {
    // These are facts about the world, not scheduling conventions. A system
    // that lets a manager click past them will eventually put a patient in
    // front of nobody.
    const ctx = buildAppointmentHarness({
      ...OWNER,
      check: { ok: false, reason: reason as never, message: 'not available' },
    });

    await expect(
      ctx.run(() => ctx.service.create({ ...BOOKING, override: true, overrideReason: 'Urgent' })),
    ).rejects.toThrow(ForbiddenException);
    expect(ctx.creates).toHaveLength(0);
  });

  it('14. a booking that needs no override records none', async () => {
    const ctx = buildAppointmentHarness(OWNER);

    await ctx.run(() => ctx.service.create(BOOKING));

    expect(ctx.creates[0]).toMatchObject({
      overriddenRule: null,
      overrideReason: null,
      overriddenByStaffId: null,
    });
  });
});

describe('a service that requires approval lands in the Requests tab', () => {
  it('15. even when a staff member booked it', async () => {
    const ctx = buildAppointmentHarness({ service: { requiresApproval: true } });

    await ctx.run(() => ctx.service.create(BOOKING));

    expect(ctx.creates[0].status).toBe('REQUESTED');
  });

  it('16. an auto-confirm service booked at the front desk is CONFIRMED on the spot', async () => {
    const ctx = buildAppointmentHarness({ service: { requiresApproval: false } });

    await ctx.run(() => ctx.service.create(BOOKING));

    expect(ctx.creates[0].status).toBe('CONFIRMED');
  });

  it('17. a public booking waits for somebody, even on an auto-confirm service', async () => {
    const ctx = buildAppointmentHarness({ service: { requiresApproval: false } });

    await ctx.run(() => ctx.service.create({ ...BOOKING, source: 'ONLINE_PORTAL' as never }));

    expect(ctx.creates[0].status).toBe('REQUESTED');
  });

  it('18. rejecting a request CANCELS it, freeing the slot it was holding', async () => {
    // A REQUESTED appointment occupies its slot — two people cannot each be
    // told they might get the last 10:00. Rejection has to release it.
    const ctx = buildAppointmentHarness({ appointment: { status: 'REQUESTED' } });

    await ctx.run(() => ctx.service.reject(APPT, 'Fully booked that morning'));

    expect(ctx.updates[0]).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'CLINIC_REQUEST',
    });
  });
});

describe('every booking carries a manage token', () => {
  it('19. long, random, and unique per booking', async () => {
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.create(BOOKING));
    await ctx.run(() => ctx.service.create(BOOKING));

    const [one, two] = ctx.creates.map((row) => row.manageToken as string);
    // 32 random bytes in base64url. A v4 uuid would be shorter and, more to
    // the point, in a format people expect to be guessable from a sequence.
    expect(one).toHaveLength(43);
    expect(one).not.toBe(two);
  });
});
