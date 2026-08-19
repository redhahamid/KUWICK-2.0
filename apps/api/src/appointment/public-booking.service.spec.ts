import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PublicBookingService } from './public-booking.service';
import { PrismaService } from '../core/prisma.service';
import { SlotAvailabilityService } from './slot-availability.service';
import {
  AppointmentBookingValidator,
  BookingCheck,
} from './appointment-booking-validator.service';

// ===========================================================================
// THE PUBLIC BOOKING PAGE — unauthenticated, and not unscoped.
//
// Three rules this path exists to keep, and each one is a way a public booking
// page goes wrong:
//
//   1. It uses the SAME availability engine as the front desk. A page that
//      computed its own would eventually offer what the counter refuses.
//   2. It never confirms who exists. "This IC is already registered" is a
//      patient-enumeration oracle; anybody could test a list of ICs against a
//      clinic's records.
//   3. It reaches no other patient's data. The manage link carries one token
//      and identifies one appointment.
// ===========================================================================

const SLUG = 'hijraa-bangi';
const PAGE = {
  tenantId: 't1',
  clinicId: 'clinic-1',
  pageId: 'page-1',
  slug: SLUG,
  displayName: 'Klinik Hijraa Bangi',
  logoUrl: null,
  language: 'en',
  introText: null,
  requirePhone: true,
  requireEmail: false,
  requireNric: false,
  showReasonField: true,
  allowPatientReschedule: true,
  allowPatientCancel: true,
  patientChangeCutoffHours: 4,
  confirmationMessage: null,
};

interface World {
  page?: Partial<typeof PAGE> | null;
  patients?: { id: string; name: string; phone?: string | null; identifierValue?: string }[];
  check?: BookingCheck;
  service?: Record<string, unknown>;
  appointment?: Record<string, unknown> | null;
  providerAnswers?: { staffId: string; slots: { start: Date; end: Date }[]; reason: null }[];
}

function build(world: World = {}) {
  const created: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const patients: Record<string, unknown>[] = [];

  const resolved = world.page === null ? [] : [{ ...PAGE, ...world.page }];

  const tx = {
    $executeRaw: jest.fn(async () => 1),
    appointment: {
      findFirst: jest.fn(async () => world.appointment ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `appt-${created.length}`, ...data };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { ...(world.appointment ?? {}), ...data };
      }),
    },
    appointmentEvent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      }),
    },
    appointmentFormAnswer: { createMany: jest.fn(async () => ({ count: 0 })) },
    bookingFormField: { findMany: jest.fn(async () => []) },
    serviceCatalog: {
      findUnique: jest.fn(async () => ({
        bookable: true,
        active: true,
        requiresApproval: false,
        bookingFee: 0,
        bookingPaymentRule: 'NONE',
        depositAmount: 0,
        ...world.service,
      })),
    },
    patient: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.identifierValue) {
          return (
            (world.patients ?? []).find((p) => p.identifierValue === where.identifierValue) ?? null
          );
        }
        return null;
      }),
      findMany: jest.fn(async ({ where }: { where: { phone?: string } }) =>
        (world.patients ?? []).filter((p) => p.phone && p.phone === where.phone),
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        patients.push(data);
        return { id: `pat-new-${patients.length}` };
      }),
    },
  };

  const prisma = {
    $queryRaw: jest.fn(async () => resolved),
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    serviceCatalog: { findMany: jest.fn(async () => []) },
    doctorServiceQualification: { findMany: jest.fn(async () => [{ staffId: 'doc-1' }]) },
    staff: { findMany: jest.fn(async () => [{ id: 'doc-1', fullName: 'Dr Redha' }]) },
    bookingFormField: { findMany: jest.fn(async () => []) },
    appointment: { findFirst: jest.fn(async () => world.appointment ?? null) },
  } as unknown as PrismaService;

  const availability = {
    clinicTimeZone: jest.fn(async () => 'Asia/Kuala_Lumpur'),
    findAvailability: jest.fn(async () => ({ slots: [], reason: null })),
    findAvailabilityAcrossProviders: jest.fn(async () => world.providerAnswers ?? []),
  } as unknown as SlotAvailabilityService;

  const validator = {
    check: jest.fn(async (): Promise<BookingCheck> => world.check ?? { ok: true }),
  } as unknown as AppointmentBookingValidator;

  const service = new PublicBookingService(prisma, availability, validator);
  return { service, prisma, tx, availability, validator, created, events, updates, patients };
}

const BOOK = {
  serviceId: 'svc-1',
  staffId: 'doc-1',
  scheduledStart: '2026-09-01T01:00:00.000Z',
  scheduledEnd: '2026-09-01T01:30:00.000Z',
  name: 'Ahmad bin Ali',
  phone: '0123456789',
};

describe('an unpublished or unknown page gives the same answer', () => {
  it('1. an unknown slug is "not available", never "no such clinic"', async () => {
    // A different message for "never existed" and "unpublished" would let
    // anybody enumerate which clinics use Kuwick.
    const ctx = build({ page: null });

    await expect(ctx.service.page('nope')).rejects.toThrow(NotFoundException);
    await expect(ctx.service.page('nope')).rejects.toThrow(/not available/i);
  });
});

describe('patient identity matching never says who exists', () => {
  it('2. an exact IC match links the existing record', async () => {
    const ctx = build({
      patients: [{ id: 'pat-1', name: 'Ahmad bin Ali', identifierValue: '900101015555' }],
    });

    await ctx.service.book(SLUG, { ...BOOK, identifier: '900101-01-5555' });

    expect(ctx.created[0]).toMatchObject({
      patientId: 'pat-1',
      patientMatch: 'MATCHED_IDENTIFIER',
    });
    expect(ctx.patients).toHaveLength(0);
  });

  it('3. phone AND name together match — phone alone never does', async () => {
    // A phone is shared by a family. Matching on it would attach a daughter's
    // booking to her mother's record.
    const ctx = build({
      patients: [{ id: 'pat-1', name: 'Siti binti Ali', phone: '0123456789' }],
    });

    await ctx.service.book(SLUG, { ...BOOK, name: 'Ahmad bin Ali' });

    expect(ctx.created[0].patientMatch).toBe('NEEDS_REVIEW');
    expect(ctx.patients).toHaveLength(1);
  });

  it('4. phone and name both matching one record links it', async () => {
    const ctx = build({
      patients: [{ id: 'pat-1', name: 'Ahmad bin Ali', phone: '0123456789' }],
    });

    await ctx.service.book(SLUG, BOOK);

    expect(ctx.created[0]).toMatchObject({
      patientId: 'pat-1',
      patientMatch: 'MATCHED_PHONE_AND_NAME',
    });
  });

  it('5. TWO records with the same phone and name is a job for a human', async () => {
    const ctx = build({
      patients: [
        { id: 'pat-1', name: 'Ahmad bin Ali', phone: '0123456789' },
        { id: 'pat-2', name: 'Ahmad bin Ali', phone: '0123456789' },
      ],
    });

    await ctx.service.book(SLUG, BOOK);

    // Merging two people is a clinical safety incident; a duplicate is an
    // afternoon's tidying. The system chooses the tidying.
    expect(ctx.created[0].patientMatch).toBe('NEEDS_REVIEW');
    expect(ctx.patients).toHaveLength(1);
  });

  it('6. an unmatched IC creates a new record marked CREATED_NEW', async () => {
    const ctx = build({ patients: [] });

    await ctx.service.book(SLUG, { ...BOOK, identifier: '900101015555' });

    expect(ctx.created[0].patientMatch).toBe('CREATED_NEW');
    expect(ctx.patients[0]).toMatchObject({ identifierValue: '900101015555' });
  });

  it('7. a booking with no IC gets a PENDING identifier a human can spot', async () => {
    const ctx = build({ patients: [] });

    await ctx.service.book(SLUG, BOOK);

    expect(String(ctx.patients[0].identifierValue)).toMatch(/^PENDING-/);
  });

  it('8. the patient is told the same thing whichever branch ran', async () => {
    const matched = build({
      patients: [{ id: 'pat-1', name: 'Ahmad bin Ali', identifierValue: '900101015555' }],
    });
    const fresh = build({ patients: [] });

    const a = await matched.service.book(SLUG, { ...BOOK, identifier: '900101-01-5555' });
    const b = await fresh.service.book(SLUG, { ...BOOK, identifier: '900101015555' });

    expect(a.message).toBe(b.message);
    expect(a.status).toBe(b.status);
  });
});

describe('the public path uses the same engine and cannot override it', () => {
  it('9. a refusal from the validator refuses the booking', async () => {
    const ctx = build({
      check: { ok: false, reason: 'FULLY_BOOKED', message: 'There is no room left.' },
    });

    await expect(ctx.service.book(SLUG, BOOK)).rejects.toThrow(/no room left/i);
    expect(ctx.created).toHaveLength(0);
  });

  it('10. there is no override on this path at all', async () => {
    // An override is a staff act with a permission and a named reason behind
    // it. A public page has neither, so a force flag has nowhere to arrive.
    const ctx = build({
      check: { ok: false, reason: 'TOO_LATE_TO_BOOK', message: 'Too soon.' },
    });

    await expect(
      ctx.service.book(SLUG, { ...BOOK, override: true } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('11. the diary is locked before the check, as it is at the counter', async () => {
    const ctx = build();
    const order: string[] = [];
    (ctx.tx.$executeRaw as jest.Mock).mockImplementation(async () => {
      order.push('lock');
      return 1;
    });
    (ctx.validator.check as jest.Mock).mockImplementation(async () => {
      order.push('check');
      return { ok: true };
    });

    await ctx.service.book(SLUG, BOOK);

    expect(order.indexOf('lock')).toBeLessThan(order.indexOf('check'));
  });

  it('12. a repeated idempotency key returns the booking already made', async () => {
    const ctx = build({
      appointment: {
        id: 'appt-existing',
        status: 'CONFIRMED',
        scheduledStart: new Date(),
        scheduledEnd: new Date(),
        manageToken: 'tok',
      },
    });

    const result = await ctx.service.book(SLUG, { ...BOOK, idempotencyKey: 'browser-1' });

    expect(result.manageToken).toBe('tok');
    expect(ctx.created).toHaveLength(0);
  });

  it('13. a service requiring approval lands as REQUESTED, and says so to the patient', async () => {
    const ctx = build({ service: { requiresApproval: true } });

    const result = await ctx.service.book(SLUG, BOOK);

    expect(result.status).toBe('REQUESTED');
    expect(result.message).toMatch(/will confirm/i);
  });

  it('14. a required phone number is insisted on before anything is written', async () => {
    const ctx = build({ page: { requirePhone: true } });

    await expect(
      ctx.service.book(SLUG, { ...BOOK, phone: undefined }),
    ).rejects.toThrow(/phone number/i);
    expect(ctx.created).toHaveLength(0);
  });
});

describe('"any available provider" persists a real provider', () => {
  it('15. the slot is taken by the doctor who actually offered it', async () => {
    const start = new Date('2026-09-01T01:00:00.000Z');
    const ctx = build({
      providerAnswers: [
        { staffId: 'doc-2', slots: [{ start, end: new Date(start.getTime() + 1800000) }], reason: null },
      ],
    });

    await ctx.service.book(SLUG, { ...BOOK, staffId: undefined });

    expect(ctx.created[0].staffId).toBe('doc-2');
  });

  it('16. "any provider" with nobody free is refused rather than booked to nobody', async () => {
    const ctx = build({ providerAnswers: [] });

    await expect(
      ctx.service.book(SLUG, { ...BOOK, staffId: undefined }),
    ).rejects.toThrow(/no longer available/i);
  });
});

describe('the booking is recorded as the patient’s own act', () => {
  it('17. the history names the patient, not a blank actor', async () => {
    // A blank actor reads as "lost", which is a different thing from "the
    // patient did this themselves".
    const ctx = build();

    await ctx.service.book(SLUG, BOOK);

    expect(ctx.events[0]).toMatchObject({
      eventType: 'CREATED',
      actorLabel: 'Patient (online booking)',
      actorStaffId: null,
    });
  });

  it('18. how the patient was matched is recorded too', async () => {
    const ctx = build();

    await ctx.service.book(SLUG, BOOK);

    expect(ctx.events).toContainEqual(
      expect.objectContaining({ eventType: 'PATIENT_LINKED' }),
    );
  });
});

describe('managing a booking by token reaches exactly one appointment', () => {
  const soon = new Date(Date.now() + 48 * 3600 * 1000);

  it('19. a clinic that does not allow online cancellation refuses it', async () => {
    const ctx = build({
      page: { allowPatientCancel: false },
      appointment: { id: 'a1', status: 'CONFIRMED', scheduledStart: soon, clinicId: 'clinic-1', tenantId: 't1' },
    });

    await expect(ctx.service.cancelByToken('tok', {})).rejects.toThrow(ForbiddenException);
  });

  it('20. a change inside the cutoff is refused with the number of hours', async () => {
    const ctx = build({
      page: { patientChangeCutoffHours: 4 },
      appointment: {
        id: 'a1',
        status: 'CONFIRMED',
        scheduledStart: new Date(Date.now() + 3600 * 1000),
        clinicId: 'clinic-1',
        tenantId: 't1',
      },
    });

    await expect(ctx.service.cancelByToken('tok', {})).rejects.toThrow(/4 hours/);
  });

  it('21. a cancelled appointment cannot be cancelled again', async () => {
    const ctx = build({
      appointment: { id: 'a1', status: 'CANCELLED', scheduledStart: soon, clinicId: 'clinic-1', tenantId: 't1' },
    });

    await expect(ctx.service.cancelByToken('tok', {})).rejects.toThrow(/no longer be changed/i);
  });

  it('22. a patient cancellation is recorded with its own reason and actor', async () => {
    const ctx = build({
      appointment: { id: 'a1', status: 'CONFIRMED', scheduledStart: soon, clinicId: 'clinic-1', tenantId: 't1' },
    });

    await ctx.service.cancelByToken('tok', { reason: 'Feeling better' });

    expect(ctx.updates[0]).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'PATIENT_REQUEST',
      cancelReason: 'Feeling better',
    });
    expect(ctx.events[0]).toMatchObject({ actorLabel: 'Patient (manage booking)' });
  });

  it('23. a patient reschedule issues a NEW token, so the old link stops working', async () => {
    // A link sent by SMS gets forwarded. After the patient has moved their
    // appointment, the old link must not be able to move it again.
    const ctx = build({
      appointment: {
        id: 'a1',
        tenantId: 't1',
        clinicId: 'clinic-1',
        patientId: 'pat-1',
        staffId: 'doc-1',
        serviceId: 'svc-1',
        source: 'ONLINE_PORTAL',
        status: 'CONFIRMED',
        scheduledStart: soon,
        scheduledEnd: new Date(soon.getTime() + 1800000),
        manageToken: 'old-token',
      },
    });

    const result = await ctx.service.rescheduleByToken('old-token', {
      scheduledStart: new Date(soon.getTime() + 3600000).toISOString(),
      scheduledEnd: new Date(soon.getTime() + 5400000).toISOString(),
    });

    expect(result.manageToken).not.toBe('old-token');
    expect(ctx.updates[0]).toMatchObject({ cancellationReason: 'RESCHEDULED' });
  });

  it('24. a patient reschedule goes through the SAME validator', async () => {
    const ctx = build({
      check: { ok: false, reason: 'NOT_ROSTERED', message: 'Nobody works then.' },
      appointment: {
        id: 'a1',
        tenantId: 't1',
        clinicId: 'clinic-1',
        status: 'CONFIRMED',
        scheduledStart: soon,
        manageToken: 'tok',
      },
    });

    await expect(
      ctx.service.rescheduleByToken('tok', {
        scheduledStart: new Date(soon.getTime() + 3600000).toISOString(),
        scheduledEnd: new Date(soon.getTime() + 5400000).toISOString(),
      }),
    ).rejects.toThrow(/Nobody works then/);
  });
});
