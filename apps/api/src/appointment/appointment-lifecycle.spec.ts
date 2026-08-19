import { AppointmentStatus, SystemRole } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { APPT, buildAppointmentHarness } from './appointment-test-harness';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// THE LIFECYCLE — check-in, cancellation, reschedule, permissions, history.
//
// `arrived()` had NO test at all before this file, which is how it shipped
// creating a queue ticket and then losing track of the visit that ticket hung
// on. Everything downstream of that link — completing the appointment when the
// consultation completes, and opening the right record from the calendar —
// was impossible without it.
//
// Everything below the first block is new with the scheduling redesign: an
// appointment module gated by authentication alone, with no record of who
// changed what, is the thing being replaced.
// ===========================================================================

describe('checking in turns an appointment into a visit', () => {
  it('1. the queue ticket is type A — appointments do not join the walk-in stream', async () => {
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.checkIn(APPT));

    expect(ctx.queueTickets.addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ queueType: 'APPOINTMENT' }),
    );
  });

  it('2. the visit the ticket created is RECORDED on the appointment', async () => {
    // The whole point. Without it `completeVisit` cannot find the appointment
    // that started the consultation, and the calendar's "open record" has to
    // guess at the patient's most recent visit — wrong the moment they have two.
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.checkIn(APPT));

    expect(ctx.updates).toContainEqual(expect.objectContaining({ visitId: 'visit-9' }));
  });

  it('3. ARRIVED first, then CHECKED_IN once the visit exists', async () => {
    // Two facts, in the order they become true. ARRIVED is a person at a desk;
    // CHECKED_IN asserts a visit and a queue ticket exist, and it must not be
    // written before they do.
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.checkIn(APPT));

    expect(ctx.updates[0]).toMatchObject({ status: AppointmentStatus.ARRIVED });
    expect(ctx.updates[0].arrivedAt).toBeInstanceOf(Date);
    expect(ctx.updates[1]).toMatchObject({ status: AppointmentStatus.CHECKED_IN });
    expect(ctx.updates[1].checkedInAt).toBeInstanceOf(Date);
  });

  it('4. the presenting complaint carries the booking notes into the queue', async () => {
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.checkIn(APPT));

    expect(ctx.queueTickets.addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ presentingComplaint: 'Sore throat' }),
    );
  });

  it("5. the PATIENT's own words win over the internal note", async () => {
    const ctx = buildAppointmentHarness({
      appointment: { patientNote: 'Ear blocked since Friday' },
    });

    await ctx.run(() => ctx.service.checkIn(APPT));

    expect(ctx.queueTickets.addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ presentingComplaint: 'Ear blocked since Friday' }),
    );
  });

  it.each([
    AppointmentStatus.COMPLETED,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
    AppointmentStatus.CHECKED_IN,
  ])('6. %s cannot check in again, and no second ticket is cut', async (status) => {
    // A second ticket for the same patient is a second place in the queue.
    const ctx = buildAppointmentHarness({ appointment: { status } });

    await expect(ctx.run(() => ctx.service.checkIn(APPT))).rejects.toThrow();
    expect(ctx.queueTickets.addToQueue).not.toHaveBeenCalled();
  });

  it('7. a patient already marked ARRIVED can still be checked in', async () => {
    // The counter greets them, then finds the doctor is ready. Two acts, and
    // the second must not be refused because the first happened.
    const ctx = buildAppointmentHarness({ appointment: { status: AppointmentStatus.ARRIVED } });

    await ctx.run(() => ctx.service.checkIn(APPT));

    expect(ctx.queueTickets.addToQueue).toHaveBeenCalled();
  });

  it('8. the check-in is recorded in the appointment history with the ticket', async () => {
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.checkIn(APPT));

    expect(ctx.events).toContainEqual(
      expect.objectContaining({
        eventType: 'CHECKED_IN',
        toStatus: AppointmentStatus.CHECKED_IN,
        afterValue: { visitId: 'visit-9', queueTicketId: 'ticket-1' },
      }),
    );
  });
});

describe('a cancellation names who as well as why', () => {
  it('9. records the actor and the moment beside the reason', async () => {
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.cancel(APPT, { cancelReason: 'Patient rang to cancel' }));

    expect(ctx.updates[0]).toMatchObject({
      status: AppointmentStatus.CANCELLED,
      cancelReason: 'Patient rang to cancel',
      cancelledByStaffId: 'staff-7',
    });
    expect(ctx.updates[0].cancelledAt).toBeInstanceOf(Date);
  });

  it('10. an unclassified cancellation is OTHER, never a guess at the motive', async () => {
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.cancel(APPT, { cancelReason: 'Clinic closed' }));

    expect(ctx.updates[0]).toMatchObject({ cancellationReason: 'OTHER' });
  });

  it.each([AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED])(
    '11. %s cannot be cancelled',
    async (status) => {
      const ctx = buildAppointmentHarness({ appointment: { status } });

      await expect(ctx.run(() => ctx.service.cancel(APPT, {}))).rejects.toThrow();
    },
  );

  it('12. the cancellation is in the history with its reason', async () => {
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.cancel(APPT, { cancelReason: 'Patient rang to cancel' }));

    expect(ctx.events).toContainEqual(
      expect.objectContaining({
        eventType: 'CANCELLED',
        fromStatus: AppointmentStatus.CONFIRMED,
        toStatus: AppointmentStatus.CANCELLED,
        reason: 'Patient rang to cancel',
        actorLabel: 'Nurul at the counter',
      }),
    );
  });
});

describe('rescheduling preserves history rather than replacing it', () => {
  const MOVE = {
    scheduledStart: '2026-09-02T01:00:00.000Z',
    scheduledEnd: '2026-09-02T01:30:00.000Z',
  };

  it('13. the original becomes CANCELLED with reason RESCHEDULED, not a terminal RESCHEDULED status', async () => {
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.reschedule(APPT, MOVE));

    expect(ctx.updates[0]).toMatchObject({
      status: AppointmentStatus.CANCELLED,
      cancellationReason: 'RESCHEDULED',
    });
  });

  it('14. the replacement points back at the original, so the pair reads from either end', async () => {
    const ctx = buildAppointmentHarness();

    const replacement = await ctx.run(() => ctx.service.reschedule(APPT, MOVE));

    expect(ctx.creates[0]).toMatchObject({
      rescheduledFromId: APPT,
      status: AppointmentStatus.CONFIRMED,
    });
    expect(replacement.id).not.toBe(APPT);
  });

  it('15. the original row is never deleted', async () => {
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.reschedule(APPT, MOVE));

    expect(ctx.byId[APPT]).toBeDefined();
  });

  it('16. a deposit follows the patient to the new time', async () => {
    // It was paid for the appointment, not for the hour.
    const ctx = buildAppointmentHarness({
      appointment: { paymentStatus: 'PAID', bookingFeeAmount: 50, depositInvoiceId: 'inv-3' },
    });

    await ctx.run(() => ctx.service.reschedule(APPT, MOVE));

    expect(ctx.creates[0]).toMatchObject({
      paymentStatus: 'PAID',
      bookingFeeAmount: 50,
      depositInvoiceId: 'inv-3',
    });
  });

  it('17. both rows get a history entry naming the other', async () => {
    const ctx = buildAppointmentHarness();

    const replacement = await ctx.run(() => ctx.service.reschedule(APPT, MOVE));

    const onOriginal = ctx.events.find((e) => e.appointmentId === APPT);
    expect(onOriginal).toMatchObject({ eventType: 'RESCHEDULED' });
    expect((onOriginal?.afterValue as Record<string, unknown>).replacementAppointmentId).toBe(
      replacement.id,
    );
    const onReplacement = ctx.events.find((e) => e.appointmentId === replacement.id);
    expect((onReplacement?.beforeValue as Record<string, unknown>).previousAppointmentId).toBe(APPT);
  });

  it('18. moving to another provider is allowed and is what the new row records', async () => {
    const ctx = buildAppointmentHarness();

    await ctx.run(() => ctx.service.reschedule(APPT, { ...MOVE, staffId: 'doc-2' }));

    expect(ctx.creates[0]).toMatchObject({ staffId: 'doc-2' });
  });
});

describe('the diary is not open to everybody who can log in', () => {
  // The defect this closes: every appointment endpoint was gated by
  // `requireActor` — that is, by being signed in — in a system granular enough
  // elsewhere to name who may sign a clinical note.
  const STOCK_CLERK = { actor: { role: 'STOCK_STAFF' }, assignedRoles: [] as SystemRole[] };

  it('19. a stock clerk cannot cancel tomorrow’s clinic', async () => {
    const ctx = buildAppointmentHarness(STOCK_CLERK);

    await expect(ctx.run(() => ctx.service.cancel(APPT, {}))).rejects.toThrow(ForbiddenException);
  });

  it('20. a stock clerk cannot check a patient in', async () => {
    const ctx = buildAppointmentHarness(STOCK_CLERK);

    await expect(ctx.run(() => ctx.service.checkIn(APPT))).rejects.toThrow(ForbiddenException);
    expect(ctx.queueTickets.addToQueue).not.toHaveBeenCalled();
  });

  it('21. a doctor may book a follow-up but may not check a patient in', async () => {
    const doctor = { actor: { role: 'DOCTOR_RESIDENT' }, assignedRoles: ['DOCTOR' as SystemRole] };
    const ctx = buildAppointmentHarness(doctor);

    await expect(ctx.run(() => ctx.service.checkIn(APPT))).rejects.toThrow(ForbiddenException);
  });

  it('22. an inactive account holds nothing at all', async () => {
    const ctx = buildAppointmentHarness({ actor: { active: false } });

    await expect(ctx.run(() => ctx.service.cancel(APPT, {}))).rejects.toThrow();
  });

  it('23. no signed-in staff member at all is refused', async () => {
    const ctx = buildAppointmentHarness();

    await expect(
      tenantContextStorage.run({ tenantId: 't1' } as never, () => ctx.service.cancel(APPT, {})),
    ).rejects.toThrow();
  });
});
