import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Appointment,
  AppointmentCancellationReason,
  AppointmentEventType,
  AppointmentSource,
  AppointmentStatus,
  QueueType,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import {
  AppointmentBookingValidator,
  BookingCheck,
  OVERRIDABLE_REASONS,
} from './appointment-booking-validator.service';
import { TERMINAL_APPOINTMENT_STATUSES } from './appointment-status.constants';
import { assertCanPerformAppointmentAction } from './appointment-authorization';
import { appointmentSnapshot, recordAppointmentEvent } from './appointment-event.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { QueueTicketService } from '../clinical/queue-ticket.service';
import { PrismaService } from '../core/prisma.service';
import { ActingStaff, ClinicalTx, requireActor, withTenantTx } from '../clinical/clinical-actor';
import {
  resolveActiveStaffForClinic,
  resolveClinicForActor,
  resolvePatient,
  resolveService,
} from '../clinical/clinical-references';
import { clinicDateKey } from './time.util';

// No billing-type input exists at the point an appointment is checked in
// (unlike the front-desk "Add to Daily Queue" walk-in flow, which asks for
// one) — defaulted here rather than left unset.
const DEFAULT_ARRIVAL_BILLING_TYPE = 'Self-pay';

export interface FindAppointmentsFilter {
  clinicId?: string;
  staffId?: string;
  patientId?: string;
  status?: AppointmentStatus;
  from?: Date;
  to?: Date;
}

/**
 * WHICH STATUSES EACH TRANSITION IS LEGAL FROM.
 *
 * One table rather than a condition per method, because the lifecycle is a
 * fact about the domain and reading it should not mean reading nine methods.
 * REMINDED and IN_QUEUE appear as SOURCES only: nothing writes them any more,
 * but rows that predate this still hold them and must remain workable.
 */
const ARRIVABLE_FROM: AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.REMINDED,
];
const CHECK_IN_FROM: AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.REMINDED,
  AppointmentStatus.ARRIVED,
];
const NON_CANCELLABLE: AppointmentStatus[] = [
  ...TERMINAL_APPOINTMENT_STATUSES,
  AppointmentStatus.COMPLETED,
];

/**
 * THE APPOINTMENT LIFECYCLE, AND EVERY WRITE THAT MOVES IT.
 *
 * Three properties this service is responsible for and the previous version
 * was not:
 *
 *  1. PERMISSIONS. Every method asserts a named appointment permission before
 *     it does anything. These endpoints were gated by "are you signed in",
 *     which let a stock clerk cancel tomorrow's clinic.
 *
 *  2. HISTORY. Every state change writes an `AppointmentEvent` in the SAME
 *     transaction, with the actor, the reason and the before/after. An
 *     appointment that moved and has nothing saying who moved it is not a
 *     record anybody can answer a complaint from.
 *
 *  3. ONE BOOKING PER INTENT. Two people taking the last 10:00 are serialised
 *     by an advisory lock and the loser is refused; the same request sent
 *     twice returns the same appointment instead of making two.
 */
@Injectable()
export class AppointmentService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly bookingValidator: AppointmentBookingValidator,
    private readonly queueTickets: QueueTicketService,
    private readonly rawPrisma: PrismaService,
  ) {}

  async create(dto: CreateAppointmentDto): Promise<Appointment> {
    const scheduledStart = new Date(dto.scheduledStart);
    const scheduledEnd = new Date(dto.scheduledEnd);
    assertValidWindow(scheduledStart, scheduledEnd);

    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'CREATE');

      // §28 — IDEMPOTENCY, CHECKED FIRST. A double click and a retried
      // network call must return the booking that already exists, not a
      // second one beside it. Checked before the work rather than caught
      // after the unique index fires, so the caller gets their appointment
      // back rather than a 409 they have to interpret.
      if (dto.idempotencyKey) {
        const existing = await tx.appointment.findFirst({
          where: { tenantId: currentTenantId(), idempotencyKey: dto.idempotencyKey },
        });
        if (existing) return existing;
      }

      // S1 (D-070) — resolve every browser-supplied relationship under the
      // authenticated tenant BEFORE anything is written or any side effect
      // runs. A foreign key is enforced BELOW row-level security, so without
      // this an appointment could be booked against another tenant's patient.
      const patient = await resolvePatient(tx, dto.patientId);
      const clinic = await resolveClinicForActor(tx, dto.clinicId, actor);
      const staff = await resolveActiveStaffForClinic(tx, dto.staffId, clinic.id);
      const service = await resolveService(tx, dto.serviceId);

      // THE LOCK, before the check. Two requests for the last 10:00 both pass
      // a check that ran before either wrote; taking this first means the
      // second one re-reads the diary AFTER the first has written to it.
      await this.lockDiary(tx, clinic.id, staff.id, service.id, scheduledStart);

      const override = await this.resolveOverride(
        actor,
        await this.bookingValidator.check({
          clinicId: clinic.id,
          staffId: staff.id,
          serviceId: service.id,
          scheduledStart,
          scheduledEnd,
        }),
        dto.override === true,
        dto.overrideReason,
      );

      // A service requiring approval lands in the Requests tab whoever booked
      // it; otherwise the SOURCE decides. Staff bookings are confirmed on the
      // spot, a public booking waits for a human unless the service says
      // otherwise.
      const initialStatus = service.requiresApproval
        ? AppointmentStatus.REQUESTED
        : dto.source === AppointmentSource.FRONT_DESK
          ? AppointmentStatus.CONFIRMED
          : AppointmentStatus.REQUESTED;

      const appointment = await tx.appointment.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: clinic.id,
          patientId: patient.id,
          staffId: staff.id,
          serviceId: service.id,
          source: dto.source,
          sourceDetail: dto.sourceDetail?.trim() || null,
          status: initialStatus,
          scheduledStart,
          scheduledEnd,
          notes: dto.notes,
          patientNote: dto.patientNote?.trim() || null,
          idempotencyKey: dto.idempotencyKey ?? null,
          manageToken: newManageToken(),
          // SNAPSHOT, not a join — a clinic raising its fee in March must not
          // change what a February booking asked for. Zero is the normal
          // answer: most consultations carry no booking fee.
          bookingFeeAmount: service.bookingFee ?? 0,
          ...override.columns,
        },
      });

      await recordAppointmentEvent(tx, {
        appointmentId: appointment.id,
        eventType: AppointmentEventType.CREATED,
        toStatus: initialStatus,
        after: appointmentSnapshot(appointment),
        source: dto.source,
        actorStaffId: actor.id,
        actorLabel: actor.fullName,
      });
      if (override.applied) {
        await recordAppointmentEvent(tx, {
          appointmentId: appointment.id,
          eventType: AppointmentEventType.OVERRIDE_APPLIED,
          reason: override.columns.overrideReason,
          after: { overriddenRule: override.columns.overriddenRule },
          actorStaffId: actor.id,
          actorLabel: actor.fullName,
        });
      }

      return appointment;
    });
  }

  /**
   * The manage token is the PATIENT'S credential — possession of the link IS
   * the authentication on the public manage routes. Staff reads have no use
   * for it (the drawer never renders it), so shipping it in every list and
   * detail response was handing a live bypass-the-login token to every
   * browser devtools pane and HAR capture for nothing. Stripped HERE, at the
   * read boundary, rather than trusted to each caller's select list.
   */
  private redactToken<T extends { manageToken?: string | null }>(row: T): Omit<T, 'manageToken'> {
    const { manageToken: _token, ...safe } = row;
    return safe;
  }

  async findAll(filter: FindAppointmentsFilter) {
    const rows = await this.prisma.appointment.findMany({
      where: {
        clinicId: filter.clinicId,
        staffId: filter.staffId,
        patientId: filter.patientId,
        status: filter.status,
        scheduledStart:
          filter.from || filter.to ? { gte: filter.from, lte: filter.to } : undefined,
      },
      orderBy: { scheduledStart: 'asc' },
    });
    return rows.map((row) => this.redactToken(row));
  }

  async findById(id: string) {
    const appointment = await this.prisma.appointment.findUnique({ where: { id } });
    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }
    return this.redactToken(appointment);
  }

  /** The full record behind the detail drawer, including its history. */
  async findDetail(id: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: true,
        staff: { select: { id: true, fullName: true, calendarColor: true } },
        service: true,
        visit: { select: { id: true, visitNumber: true, checkOutAt: true } },
        formAnswers: { orderBy: { sortOrder: 'asc' } },
        communications: { orderBy: { queuedAt: 'desc' } },
        events: { orderBy: { occurredAt: 'desc' }, take: 100 },
        rescheduledFrom: { select: { id: true, scheduledStart: true } },
        rescheduledTo: { select: { id: true, scheduledStart: true, status: true } },
      },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');

    // The queue ticket the check-in created, so the drawer can say where the
    // patient actually is. Read through the visit rather than stored twice.
    const ticket = appointment.visitId
      ? await this.prisma.queueTicket.findFirst({
          where: { visitId: appointment.visitId },
          select: { id: true, displayNumber: true, status: true, queueType: true },
        })
      : null;

    return { ...this.redactToken(appointment), queueTicket: ticket };
  }

  async confirm(id: string) {
    return this.transition(id, 'EDIT', (appointment) => {
      assertStatus(appointment.status, [AppointmentStatus.REQUESTED], 'confirm');
      return { status: AppointmentStatus.CONFIRMED };
    });
  }

  /**
   * §30 — the clinic declining a request. A rejection is a CANCELLATION with a
   * reason that says the clinic said no, not a fourth terminal state: it frees
   * the slot the request was holding and it is countable beside every other
   * cancellation.
   */
  async reject(id: string, reason?: string) {
    return this.transition(id, 'CANCEL', (appointment) => {
      assertStatus(appointment.status, [AppointmentStatus.REQUESTED], 'reject');
      return {
        status: AppointmentStatus.CANCELLED,
        cancellationReason: AppointmentCancellationReason.CLINIC_REQUEST,
        cancelReason: reason ?? 'The clinic could not accept this request.',
        cancelledByStaffId: currentStaffId() ?? null,
        cancelledAt: new Date(),
      };
    });
  }

  async cancel(id: string, dto: CancelAppointmentDto) {
    return this.transition(id, 'CANCEL', (appointment) => {
      if (NON_CANCELLABLE.includes(appointment.status)) {
        throw new BadRequestException(
          `Cannot cancel an appointment in status ${appointment.status}`,
        );
      }
      return {
        status: AppointmentStatus.CANCELLED,
        cancelReason: dto.cancelReason,
        cancellationReason: dto.cancellationReason ?? AppointmentCancellationReason.OTHER,
        // The reason was already recorded; the PERSON is the half that matters
        // when a patient rings back to ask why.
        cancelledByStaffId: currentStaffId() ?? null,
        cancelledAt: new Date(),
      };
    });
  }

  async noShow(id: string) {
    return this.transition(id, 'NO_SHOW', (appointment) => {
      assertStatus(appointment.status, ARRIVABLE_FROM, 'mark as no-show');
      return { status: AppointmentStatus.NO_SHOW };
    });
  }

  /**
   * The patient is at the desk, and nothing else has happened yet.
   *
   * Split from check-in on purpose. ARRIVED is a fact the counter can record
   * in one keystroke as somebody walks in; CHECK-IN creates a visit and a
   * queue ticket and is the act that puts them in front of a doctor. Merging
   * them meant a busy counter could not say "they're here" without also
   * committing to the clinical record.
   */
  async markArrived(id: string) {
    return this.transition(id, 'CHECK_IN', (appointment) => {
      assertStatus(appointment.status, ARRIVABLE_FROM, 'mark as arrived');
      return { status: AppointmentStatus.ARRIVED, arrivedAt: new Date() };
    });
  }

  /**
   * CHECK IN — the appointment becomes a visit and joins the queue.
   *
   * Three writes, and deliberately NOT one transaction: `addToQueue` owns its
   * own (it creates the visit, allocates a ticket number and enforces the
   * queue's own permissions), and nesting an interactive transaction through
   * the tenant-scoping Prisma extension is untested. The order is chosen so a
   * crash leaves the SAFE state: the appointment is ARRIVED with a real queue
   * ticket, which the counter can see and finish by hand — never a queue
   * ticket with no appointment pointing at it.
   */
  async checkIn(id: string) {
    const appointment = await this.findById(id);
    await withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'CHECK_IN');
      assertStatus(appointment.status, CHECK_IN_FROM, 'check in');
      if (appointment.status !== AppointmentStatus.ARRIVED) {
        await tx.appointment.update({
          where: { id },
          data: { status: AppointmentStatus.ARRIVED, arrivedAt: new Date() },
        });
        await recordAppointmentEvent(tx, {
          appointmentId: id,
          eventType: AppointmentEventType.STATUS_CHANGED,
          fromStatus: appointment.status,
          toStatus: AppointmentStatus.ARRIVED,
          actorStaffId: actor.id,
          actorLabel: actor.fullName,
        });
      }
    });

    const ticket = await this.queueTickets.addToQueue({
      clinicId: appointment.clinicId,
      patientId: appointment.patientId,
      staffId: appointment.staffId,
      billingType: DEFAULT_ARRIVAL_BILLING_TYPE,
      // The appointment's context travels with the patient. Without it the
      // doctor opens a visit that says nothing about why the patient came,
      // and the receptionist re-types what the booking already recorded.
      presentingComplaint: appointment.patientNote ?? appointment.notes ?? undefined,
      // D-038 — appointment arrivals join the "A" queue stream.
      queueType: QueueType.APPOINTMENT,
    });

    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      // THE LINK, written the moment it exists. `addToQueue` created a VISIT
      // to hang the ticket on, and without recording which one `completeVisit`
      // cannot find the appointment that started the consultation — so
      // appointments sat at ARRIVED forever and the Completed tab stayed empty.
      const updated = await tx.appointment.update({
        where: { id },
        data: {
          visitId: ticket.visitId,
          status: AppointmentStatus.CHECKED_IN,
          checkedInAt: new Date(),
        },
      });
      await recordAppointmentEvent(tx, {
        appointmentId: id,
        eventType: AppointmentEventType.CHECKED_IN,
        fromStatus: AppointmentStatus.ARRIVED,
        toStatus: AppointmentStatus.CHECKED_IN,
        after: { visitId: ticket.visitId, queueTicketId: ticket.id },
        actorStaffId: actor.id,
        actorLabel: actor.fullName,
      });
      return updated;
    });
  }

  /**
   * RESCHEDULING PRESERVES HISTORY (§12).
   *
   * The original is CANCELLED with `cancellationReason = RESCHEDULED` and the
   * replacement points back at it, so both rows survive and the pair is
   * readable from either end. It is NOT a terminal `RESCHEDULED` status — that
   * lost the fact that the patient did not cancel, they moved, and made "how
   * many cancellations this month" wrong in both directions.
   *
   * The original is never deleted.
   */
  async reschedule(id: string, dto: RescheduleAppointmentDto) {
    const scheduledStart = new Date(dto.scheduledStart);
    const scheduledEnd = new Date(dto.scheduledEnd);
    assertValidWindow(scheduledStart, scheduledEnd);

    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'RESCHEDULE');

      const appointment = await tx.appointment.findUnique({ where: { id } });
      if (!appointment) throw new NotFoundException('Appointment not found');
      if (NON_CANCELLABLE.includes(appointment.status)) {
        throw new BadRequestException(
          `Cannot reschedule an appointment in status ${appointment.status}`,
        );
      }

      // A reschedule frequently moves the patient to a DIFFERENT provider —
      // the doctor called in sick and a colleague is taking their list.
      const staffId = dto.staffId ?? appointment.staffId;
      if (dto.staffId && dto.staffId !== appointment.staffId) {
        await resolveActiveStaffForClinic(tx, dto.staffId, appointment.clinicId);
      }

      await this.lockDiary(tx, appointment.clinicId, staffId, appointment.serviceId, scheduledStart);

      const override = await this.resolveOverride(
        actor,
        await this.bookingValidator.check({
          clinicId: appointment.clinicId,
          staffId,
          serviceId: appointment.serviceId,
          scheduledStart,
          scheduledEnd,
          excludeAppointmentId: appointment.id,
        }),
        dto.override === true,
        dto.overrideReason,
      );

      await tx.appointment.update({
        where: { id },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancellationReason: AppointmentCancellationReason.RESCHEDULED,
          cancelReason: dto.reason ?? 'Rescheduled',
          cancelledByStaffId: actor.id,
          cancelledAt: new Date(),
        },
      });

      const replacement = await tx.appointment.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: appointment.clinicId,
          patientId: appointment.patientId,
          staffId,
          serviceId: appointment.serviceId,
          source: appointment.source,
          sourceDetail: appointment.sourceDetail,
          status: AppointmentStatus.CONFIRMED,
          scheduledStart,
          scheduledEnd,
          notes: appointment.notes,
          patientNote: appointment.patientNote,
          bookingFeeAmount: appointment.bookingFeeAmount,
          bookingFeePaidAt: appointment.bookingFeePaidAt,
          bookingFeeReference: appointment.bookingFeeReference,
          // A deposit follows the patient to the new time. It was paid for the
          // appointment, not for the hour.
          paymentStatus: appointment.paymentStatus,
          depositInvoiceId: appointment.depositInvoiceId,
          seriesId: appointment.seriesId,
          seriesIndex: appointment.seriesIndex,
          manageToken: newManageToken(),
          rescheduledFromId: appointment.id,
          ...override.columns,
        },
      });

      const before = appointmentSnapshot(appointment);
      const after = appointmentSnapshot(replacement);
      await recordAppointmentEvent(tx, {
        appointmentId: appointment.id,
        eventType: AppointmentEventType.RESCHEDULED,
        fromStatus: appointment.status,
        toStatus: AppointmentStatus.CANCELLED,
        before,
        after: { ...(after as object), replacementAppointmentId: replacement.id },
        reason: dto.reason ?? null,
        actorStaffId: actor.id,
        actorLabel: actor.fullName,
      });
      await recordAppointmentEvent(tx, {
        appointmentId: replacement.id,
        eventType: AppointmentEventType.CREATED,
        toStatus: AppointmentStatus.CONFIRMED,
        before: { ...(before as object), previousAppointmentId: appointment.id },
        after,
        reason: dto.reason ?? null,
        source: appointment.source,
        actorStaffId: actor.id,
        actorLabel: actor.fullName,
      });
      if (override.applied) {
        await recordAppointmentEvent(tx, {
          appointmentId: replacement.id,
          eventType: AppointmentEventType.OVERRIDE_APPLIED,
          reason: override.columns.overrideReason,
          after: { overriddenRule: override.columns.overriddenRule },
          actorStaffId: actor.id,
          actorLabel: actor.fullName,
        });
      }

      return replacement;
    });
  }

  /**
   * A status change, its permission, and its history entry — once, so nine
   * methods cannot each get one of the three slightly wrong.
   */
  private async transition(
    id: string,
    action: Parameters<typeof assertCanPerformAppointmentAction>[1],
    change: (appointment: Appointment) => Record<string, unknown>,
  ): Promise<Appointment> {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, action);

      const appointment = await tx.appointment.findUnique({ where: { id } });
      if (!appointment) throw new NotFoundException('Appointment not found');

      const data = change(appointment);
      const updated = await tx.appointment.update({ where: { id }, data });

      await recordAppointmentEvent(tx, {
        appointmentId: id,
        eventType:
          updated.status === AppointmentStatus.CANCELLED
            ? AppointmentEventType.CANCELLED
            : AppointmentEventType.STATUS_CHANGED,
        fromStatus: appointment.status,
        toStatus: updated.status,
        before: appointmentSnapshot(appointment),
        after: appointmentSnapshot(updated),
        reason: (data.cancelReason as string | undefined) ?? null,
        actorStaffId: actor.id,
        actorLabel: actor.fullName,
      });
      return updated;
    });
  }

  /**
   * §28 — SERIALISE THE RACERS.
   *
   * Two front-desk staff clicking the last 10:00 at the same moment both run
   * an availability check that sees a free slot, because neither has written
   * yet. This takes a transaction-scoped advisory lock BEFORE the check, so
   * the second one blocks until the first has committed and then re-reads a
   * diary that contains it.
   *
   * The grain is (clinic, provider, clinic-date) and (clinic, service,
   * clinic-date) — the day, not the slot, because two overlapping candidate
   * slots have different start times and a per-slot lock would not see the
   * collision. Bookings for one provider on one day are rare enough that
   * serialising them costs nothing a person could perceive.
   *
   * The two keys are SORTED before being taken. Two transactions grabbing the
   * same pair in opposite orders is the textbook deadlock, and sorting is the
   * textbook fix.
   *
   * The `appointments_no_overlap` EXCLUDE constraint remains underneath as the
   * backstop this cannot replace: an advisory lock is a convention between
   * callers who take it, and the constraint is the database's own refusal.
   */
  private async lockDiary(
    tx: ClinicalTx,
    clinicId: string,
    staffId: string,
    serviceId: string,
    at: Date,
  ): Promise<void> {
    const timeZone = await this.bookingValidator['availability'].clinicTimeZone(clinicId);
    const dateKey = clinicDateKey(at, timeZone);
    const keys = [
      `appointment:${clinicId}:staff:${staffId}:${dateKey}`,
      `appointment:${clinicId}:service:${serviceId}:${dateKey}`,
    ].sort();
    for (const key of keys) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    }
  }

  /**
   * §16 — an override states what it set aside, why, and who did it.
   *
   * Three refusals live here, and each is deliberate:
   *
   *  - No override requested: the check's own refusal is thrown, unchanged.
   *  - Override requested without the permission: FORBIDDEN. A `force` flag
   *    from a browser is a request, never an authorisation.
   *  - Override requested for a rule that may not be overridden: refused with
   *    the original reason. Approved leave, a closed branch and an unqualified
   *    provider are facts about the world, not conventions a manager may click
   *    past — see OVERRIDABLE_REASONS.
   */
  private async resolveOverride(
    actor: ActingStaff,
    check: BookingCheck,
    requested: boolean,
    reason: string | undefined,
  ): Promise<{
    applied: boolean;
    columns: { overriddenRule: string | null; overrideReason: string | null; overriddenByStaffId: string | null };
  }> {
    const none = {
      applied: false,
      columns: { overriddenRule: null, overrideReason: null, overriddenByStaffId: null },
    };
    if (check.ok) return none;

    if (!requested) {
      throw check.reason === 'FULLY_BOOKED' || check.reason === 'OFF_GRID'
        ? new (await import('@nestjs/common')).ConflictException(check.message)
        : new (await import('@nestjs/common')).UnprocessableEntityException(check.message);
    }

    assertCanPerformAppointmentAction(actor, 'OVERRIDE');

    if (!OVERRIDABLE_REASONS.has(check.reason)) {
      throw new ForbiddenException(
        `${check.message} This cannot be overridden — it is not a scheduling preference.`,
      );
    }
    const trimmed = reason?.trim();
    if (!trimmed) {
      throw new BadRequestException('An override needs a reason. Say why this booking was made.');
    }

    return {
      applied: true,
      columns: {
        overriddenRule: check.reason,
        overrideReason: trimmed,
        overriddenByStaffId: actor.id,
      },
    };
  }
}

function assertValidWindow(scheduledStart: Date, scheduledEnd: Date): void {
  if (scheduledEnd <= scheduledStart) {
    throw new BadRequestException('scheduledEnd must be after scheduledStart');
  }
}

function assertStatus(current: AppointmentStatus, allowed: AppointmentStatus[], action: string): void {
  if (!allowed.includes(current)) {
    throw new BadRequestException(`Cannot ${action} an appointment in status ${current}`);
  }
}

/**
 * The secret in a manage-booking URL. 32 random bytes, not a uuid: this is the
 * ONLY thing standing between a public link and somebody else's appointment,
 * and a v4 uuid is 122 bits of entropy in a format people expect to be
 * guessable from a sequence.
 */
function newManageToken(): string {
  return randomBytes(32).toString('base64url');
}
