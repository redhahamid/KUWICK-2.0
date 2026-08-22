import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentCancellationReason,
  AppointmentChangeRequestStatus,
  AppointmentChangeRequestType,
  AppointmentEventType,
} from '@prisma/client';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import { assertCanPerformAppointmentAction } from './appointment-authorization';
import { recordAppointmentEvent } from './appointment-event.service';
import { AppointmentService } from './appointment.service';
import { StaffNotificationService, notificationWhen } from './staff-notification.service';

/**
 * PHASE 7 — THE CLINIC DECIDES.
 *
 * A pending request is a question; these two methods are the only answers.
 * Approving a RESCHEDULE goes through `AppointmentService.reschedule` — the
 * same advisory locks, the same availability engine, the same history — so a
 * slot that was taken while the request sat in the inbox is REFUSED here with
 * words, the request stays PENDING, and nobody is double-booked (7E).
 * Approving a CANCELLATION goes through the ordinary cancel path with the
 * patient's own reason. Declining touches nothing but the request, and the
 * clinic's note travels back to the patient's manage page.
 */
@Injectable()
export class AppointmentChangeRequestService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
    private readonly appointments: AppointmentService,
    private readonly staffNotifications: StaffNotificationService,
  ) {}

  /** The drawer's worklist: what this appointment is waiting on. */
  async listFor(appointmentId: string) {
    const rows = await this.prisma.appointmentChangeRequest.findMany({
      where: { appointmentId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { decidedByStaff: { select: { fullName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      reason: row.reason,
      requestedStart: row.requestedStart,
      requestedEnd: row.requestedEnd,
      decisionNote: row.decisionNote,
      decidedBy: row.decidedByStaff?.fullName ?? null,
      decidedAt: row.decidedAt,
      createdAt: row.createdAt,
    }));
  }

  async approve(requestId: string) {
    const request = await this.loadPending(requestId);

    if (request.type === AppointmentChangeRequestType.RESCHEDULE) {
      if (!request.requestedStart || !request.requestedEnd) {
        throw new BadRequestException('This request does not name a new time.');
      }
      // THE CANONICAL PATH. Permission (RESCHEDULE), diary locks, the
      // availability engine, history, notifications — all exactly as if the
      // desk moved it by hand. If the slot has gone, this throws with the
      // engine's own sentence and the request stays PENDING.
      try {
        await this.appointments.reschedule(request.appointmentId, {
          scheduledStart: request.requestedStart.toISOString(),
          scheduledEnd: request.requestedEnd.toISOString(),
          reason: `Approved patient request — ${request.reason}`,
        });
      } catch (error) {
        if (error instanceof ConflictException || error instanceof BadRequestException) {
          throw new ConflictException(
            `That time is no longer available (${(error as Error).message}) — decline the request with a suggested alternative, or ask the patient to pick another time.`,
          );
        }
        throw error;
      }
    } else {
      await this.appointments.cancel(request.appointmentId, {
        cancellationReason: AppointmentCancellationReason.PATIENT_REQUEST,
        cancelReason: `Approved patient request — ${request.reason}`,
      });
    }

    return this.markDecided(requestId, AppointmentChangeRequestStatus.APPROVED, undefined);
  }

  async decline(requestId: string, note?: string) {
    const request = await this.loadPending(requestId);
    // The permission mirrors what approving WOULD have done: declining a
    // reschedule is an act on the diary's shape, declining a cancellation is
    // a cancellation decision.
    await withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(
        actor,
        request.type === AppointmentChangeRequestType.RESCHEDULE ? 'RESCHEDULE' : 'CANCEL',
      );
    });
    return this.markDecided(requestId, AppointmentChangeRequestStatus.DECLINED, note?.trim() || undefined);
  }

  private async loadPending(requestId: string) {
    const request = await this.prisma.appointmentChangeRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== AppointmentChangeRequestStatus.PENDING) {
      throw new BadRequestException('This request has already been decided.');
    }
    return request;
  }

  private async markDecided(
    requestId: string,
    status: AppointmentChangeRequestStatus,
    note: string | undefined,
  ) {
    const decided = await withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      // The CLAIM: two staff deciding together — one wins, the other is told.
      const claimed = await tx.appointmentChangeRequest.updateMany({
        where: { id: requestId, status: AppointmentChangeRequestStatus.PENDING },
        data: {
          status,
          decisionNote: note ?? null,
          decidedByStaffId: actor.id,
          decidedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException('This request was just decided by somebody else.');
      }
      const request = await tx.appointmentChangeRequest.findUniqueOrThrow({
        where: { id: requestId },
      });
      await recordAppointmentEvent(tx, {
        appointmentId: request.appointmentId,
        eventType:
          status === AppointmentChangeRequestStatus.APPROVED
            ? AppointmentEventType.CHANGE_REQUEST_APPROVED
            : AppointmentEventType.CHANGE_REQUEST_DECLINED,
        reason: note ?? request.reason,
        after: { changeRequestId: request.id, type: request.type, status },
        actorStaffId: actor.id,
        actorLabel: actor.fullName,
      });
      return { request, actorId: actor.id };
    });

    // Best-effort, after the decision: the assigned provider hears the diary
    // question closed (unless they decided it themselves).
    try {
      const row = await this.prisma.appointment.findUnique({
        where: { id: decided.request.appointmentId },
        select: {
          clinicId: true,
          staffId: true,
          scheduledStart: true,
          patient: { select: { name: true } },
          service: { select: { name: true } },
          clinic: { select: { timezone: true } },
        },
      });
      if (row?.patient?.name) {
        await this.staffNotifications.notify({
          clinicId: row.clinicId,
          type: 'CHANGE_REQUEST_DECIDED',
          title:
            status === AppointmentChangeRequestStatus.APPROVED
              ? 'Patient request approved'
              : 'Patient request declined',
          body: `${row.patient.name} · ${row.service.name} · ${notificationWhen(row.scheduledStart, row.clinic.timezone)}`,
          appointmentId: decided.request.appointmentId,
          assignedStaffId: row.staffId,
          includeDesk: false,
          actorStaffId: decided.actorId,
        });
      }
    } catch {
      // The decision stands; the inbox is a convenience.
    }

    return this.listFor(decided.request.appointmentId);
  }
}
