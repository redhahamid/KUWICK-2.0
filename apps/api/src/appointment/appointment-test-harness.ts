import { AppointmentStatus, Role, SystemRole } from '@prisma/client';
import { AppointmentService } from './appointment.service';
import {
  AppointmentBookingValidator,
  BookingCheck,
} from './appointment-booking-validator.service';
import { QueueTicketService } from '../clinical/queue-ticket.service';
import { PrismaService } from '../core/prisma.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

export const APPT = 'appt-1';
export const ACTOR = 'staff-7';

/**
 * A staff row the permission policy will accept. FRONT_DESK_CLINICAL_STAFF
 * maps to CLINICAL_STAFF + ADMINISTRATOR, which between them hold every
 * operational appointment permission and none of the three policy ones — the
 * exact shape a receptionist has, and therefore the right default for a test
 * about the diary rather than about permissions.
 */
export function staffRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTOR,
    tenantId: 't1',
    clinicId: 'clinic-1',
    fullName: 'Nurul at the counter',
    active: true,
    role: Role.FRONT_DESK_CLINICAL_STAFF,
    professionalType: null,
    professionalActive: false,
    ...overrides,
  };
}

export interface HarnessWorld {
  appointment?: Record<string, unknown>;
  /** Extra appointments findUnique/findFirst can return, by id. */
  appointments?: Record<string, Record<string, unknown>>;
  actor?: Record<string, unknown>;
  assignedRoles?: SystemRole[];
  directGrants?: string[];
  /** What the booking validator says. Defaults to "fine". */
  check?: BookingCheck;
  service?: Record<string, unknown>;
}

/**
 * THE APPOINTMENT SERVICE, WIRED TO FAKES THAT BEHAVE LIKE THE REAL THING.
 *
 * `withTenantTx` opens an interactive transaction on the RAW prisma service and
 * every write now happens inside one, so a harness that only fakes the
 * tenant-scoped client cannot see anything the service does. This fakes the
 * transaction instead: `$transaction(fn)` hands `fn` a tx whose tables record
 * what was written, so a test can assert on the appointment AND on the
 * append-only event beside it.
 */
export function buildAppointmentHarness(world: HarnessWorld = {}) {
  const updates: Record<string, unknown>[] = [];
  const creates: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const locks: string[] = [];

  const appointment = {
    id: APPT,
    tenantId: 't1',
    clinicId: 'clinic-1',
    patientId: 'pat-1',
    staffId: 'doc-1',
    serviceId: 'svc-1',
    status: AppointmentStatus.CONFIRMED,
    source: 'FRONT_DESK',
    sourceDetail: null,
    scheduledStart: new Date('2026-09-01T01:00:00Z'),
    scheduledEnd: new Date('2026-09-01T01:30:00Z'),
    notes: 'Sore throat',
    patientNote: null,
    bookingFeeAmount: 0,
    bookingFeePaidAt: null,
    bookingFeeReference: null,
    paymentStatus: 'NOT_REQUIRED',
    depositInvoiceId: null,
    seriesId: null,
    seriesIndex: null,
    visitId: null,
    ...world.appointment,
  };
  const byId: Record<string, Record<string, unknown>> = {
    [APPT]: appointment,
    ...(world.appointments ?? {}),
  };

  const actor = staffRow(world.actor);

  const tx = {
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const value = String(values[values.length - 1]);
      // `withTenantTx` sets app.tenant_id through the same call. Only the
      // diary locks are interesting here.
      if (value.startsWith('appointment:')) locks.push(value);
      return 1;
    }),
    staff: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === actor.id ? actor : { ...staffRow({ id: where.id }), fullName: 'Dr Somebody' },
      ),
      findFirst: jest.fn(async () => ({ ...staffRow({ id: 'doc-1' }), fullName: 'Dr Somebody' })),
    },
    staffRoleAssignment: {
      findMany: jest.fn(async () => (world.assignedRoles ?? []).map((role) => ({ role }))),
    },
    staffPermissionGrant: {
      findMany: jest.fn(async () => (world.directGrants ?? []).map((permission) => ({ permission }))),
    },
    patient: { findUnique: jest.fn(async () => ({ id: 'pat-1', tenantId: 't1' })) },
    clinic: {
      findUnique: jest.fn(async () => ({ id: 'clinic-1', tenantId: 't1', timezone: 'Asia/Kuala_Lumpur' })),
      // Single-branch tenant: `branchContext` reads this to decide whether
      // explicit branch access is required at all.
      count: jest.fn(async () => 1),
    },
    serviceCatalog: {
      findUnique: jest.fn(async () => ({
        id: 'svc-1',
        name: 'CONSULTATION',
        active: true,
        bookingFee: 0,
        requiresApproval: false,
        bookingPaymentRule: 'NONE',
        depositAmount: 0,
        price: 45,
        ...world.service,
      })),
    },
    userClinicAccess: { findMany: jest.fn(async () => []) },
    appointment: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => byId[where.id] ?? null),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push(data);
        const merged = { ...(byId[where.id] ?? appointment), ...data };
        byId[where.id] = merged;
        return merged;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        creates.push(data);
        const created = { id: `appt-${creates.length + 1}`, ...data };
        byId[created.id] = created;
        return created;
      }),
    },
    appointmentEvent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      }),
    },
  };

  const rawPrisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;

  const scoped = {
    appointment: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => byId[where.id] ?? null),
      findMany: jest.fn(async () => Object.values(byId)),
    },
    queueTicket: { findFirst: jest.fn(async () => null) },
  } as unknown as TenantScopedPrismaClient;

  const queueTickets = {
    // What `addToQueue` really returns: the ticket, carrying the id of the
    // visit it created.
    addToQueue: jest.fn(async () => ({ id: 'ticket-1', visitId: 'visit-9' })),
  } as unknown as QueueTicketService;

  const bookingValidator = {
    check: jest.fn(async (): Promise<BookingCheck> => world.check ?? { ok: true }),
    availability: { clinicTimeZone: jest.fn(async () => 'Asia/Kuala_Lumpur') },
  } as unknown as AppointmentBookingValidator;

  const service = new AppointmentService(scoped, bookingValidator, queueTickets, rawPrisma);

  const run = <T>(fn: () => Promise<T>) =>
    tenantContextStorage.run({ tenantId: 't1', staffId: ACTOR, userId: 'u1' }, fn);

  return { service, tx, scoped, queueTickets, bookingValidator, updates, creates, events, locks, run, byId };
}
