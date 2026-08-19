import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AppointmentEventType,
  AppointmentSource,
  AppointmentStatus,
  RecurrenceFrequency,
} from '@prisma/client';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { PrismaService } from '../core/prisma.service';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import { assertCanPerformAppointmentAction } from './appointment-authorization';
import { appointmentSnapshot, recordAppointmentEvent } from './appointment-event.service';
import { AppointmentBookingValidator } from './appointment-booking-validator.service';
import { CreateSeriesDto } from './dto/appointment-extras.dto';
import { randomBytes } from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;

export type SeriesScope = 'THIS' | 'THIS_AND_FUTURE' | 'ALL';

/**
 * §43 — RECURRING APPOINTMENTS.
 *
 * EVERY SESSION IS ITS OWN APPOINTMENT ROW, with its own time, status,
 * payment and history. The series records only the INTENT that produced them,
 * so "this and all future" has something to mean and so a course of six
 * physiotherapy sessions is six things a clinic can cancel one of.
 *
 * The alternative — one row plus a recurrence rule, expanded at read time —
 * cannot hold the fact that week three moved to a Tuesday, or that week four
 * was a no-show. A diary is a record of particular events, not a formula.
 *
 * OCCURRENCES THE ENGINE CANNOT HONOUR ARE REPORTED, NOT INVENTED. Week six
 * falling on Deepavali produces a skipped entry in the result, never an
 * appointment on a day the clinic is shut.
 */
@Injectable()
export class AppointmentSeriesService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
    private readonly bookingValidator: AppointmentBookingValidator,
  ) {}

  async create(dto: CreateSeriesDto) {
    const firstStart = new Date(dto.firstStart);
    const firstEnd = new Date(dto.firstEnd);
    if (!(firstEnd > firstStart)) {
      throw new BadRequestException('The first session ends before it starts.');
    }
    const step = stepDaysFor(dto.frequency, dto.intervalDays);

    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'CREATE');

      const series = await tx.appointmentSeries.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: dto.clinicId,
          patientId: dto.patientId,
          staffId: dto.staffId,
          serviceId: dto.serviceId,
          frequency: dto.frequency,
          intervalDays: dto.intervalDays ?? null,
          occurrences: dto.occurrences,
          createdByStaffId: actor.id,
        },
      });

      const booked: { index: number; appointmentId: string; start: Date }[] = [];
      const skipped: { index: number; start: Date; reason: string }[] = [];

      for (let index = 0; index < dto.occurrences; index += 1) {
        const start = addSteps(firstStart, step, index, dto.frequency);
        const end = new Date(start.getTime() + (firstEnd.getTime() - firstStart.getTime()));

        const check = await this.bookingValidator.check({
          clinicId: dto.clinicId,
          staffId: dto.staffId,
          serviceId: dto.serviceId,
          scheduledStart: start,
          scheduledEnd: end,
        });

        if (!check.ok) {
          if (!dto.skipUnavailable) {
            // The whole course is refused, and the caller is told WHICH week
            // failed and why — a bare "unavailable" would send the receptionist
            // to try each of six dates by hand.
            throw new BadRequestException(
              `Session ${index + 1} of ${dto.occurrences} cannot be booked: ${check.message}`,
            );
          }
          skipped.push({ index: index + 1, start, reason: check.message });
          continue;
        }

        const appointment = await tx.appointment.create({
          data: {
            tenantId: currentTenantId(),
            clinicId: dto.clinicId,
            patientId: dto.patientId,
            staffId: dto.staffId,
            serviceId: dto.serviceId,
            source: AppointmentSource.FRONT_DESK,
            status: AppointmentStatus.CONFIRMED,
            scheduledStart: start,
            scheduledEnd: end,
            notes: dto.notes,
            seriesId: series.id,
            seriesIndex: index + 1,
            manageToken: randomBytes(32).toString('base64url'),
          },
        });
        await recordAppointmentEvent(tx, {
          appointmentId: appointment.id,
          eventType: AppointmentEventType.CREATED,
          toStatus: AppointmentStatus.CONFIRMED,
          after: appointmentSnapshot(appointment),
          reason: `Session ${index + 1} of ${dto.occurrences}`,
          source: AppointmentSource.FRONT_DESK,
          actorStaffId: actor.id,
          actorLabel: actor.fullName,
        });
        booked.push({ index: index + 1, appointmentId: appointment.id, start });
      }

      return { series, booked, skipped };
    });
  }

  async detail(seriesId: string) {
    const series = await this.prisma.appointmentSeries.findUnique({
      where: { id: seriesId },
      include: {
        patient: { select: { id: true, name: true } },
        service: { select: { id: true, name: true } },
        staff: { select: { id: true, fullName: true } },
        appointments: { orderBy: { scheduledStart: 'asc' } },
      },
    });
    if (!series) throw new NotFoundException('Series not found');
    return series;
  }

  /**
   * Cancel part or all of a course.
   *
   * THIS_AND_FUTURE and ALL are the two a clinic actually presses — "the
   * patient has recovered" and "the patient has moved away" — and they mean
   * different things about the sessions already attended, which is why ALL
   * still leaves completed sessions completed. A cancellation cannot un-happen
   * an appointment that happened.
   */
  async cancelScope(params: {
    seriesId: string;
    fromAppointmentId: string;
    scope: SeriesScope;
    reason?: string;
  }) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCanPerformAppointmentAction(actor, 'CANCEL');

      const anchor = await tx.appointment.findUnique({ where: { id: params.fromAppointmentId } });
      if (!anchor || anchor.seriesId !== params.seriesId) {
        throw new NotFoundException('That appointment is not part of this series.');
      }

      const targets = await tx.appointment.findMany({
        where: {
          seriesId: params.seriesId,
          status: { in: [AppointmentStatus.REQUESTED, AppointmentStatus.CONFIRMED, AppointmentStatus.REMINDED] },
          ...(params.scope === 'THIS'
            ? { id: params.fromAppointmentId }
            : params.scope === 'THIS_AND_FUTURE'
              ? { scheduledStart: { gte: anchor.scheduledStart } }
              : {}),
        },
      });

      for (const appointment of targets) {
        await tx.appointment.update({
          where: { id: appointment.id },
          data: {
            status: AppointmentStatus.CANCELLED,
            cancellationReason: 'PATIENT_REQUEST',
            cancelReason: params.reason ?? 'Series cancelled',
            cancelledByStaffId: actor.id,
            cancelledAt: new Date(),
          },
        });
        await recordAppointmentEvent(tx, {
          appointmentId: appointment.id,
          eventType: AppointmentEventType.CANCELLED,
          fromStatus: appointment.status,
          toStatus: AppointmentStatus.CANCELLED,
          reason: params.reason ?? `Series cancelled (${params.scope})`,
          actorStaffId: actor.id,
          actorLabel: actor.fullName,
        });
      }

      if (params.scope !== 'THIS') {
        await tx.appointmentSeries.update({
          where: { id: params.seriesId },
          data: { active: false },
        });
      }

      return { cancelled: targets.length };
    });
  }
}

function stepDaysFor(frequency: RecurrenceFrequency, intervalDays?: number): number {
  switch (frequency) {
    case RecurrenceFrequency.WEEKLY:
      return 7;
    case RecurrenceFrequency.FORTNIGHTLY:
      return 14;
    case RecurrenceFrequency.CUSTOM_DAYS:
      if (!intervalDays) {
        throw new BadRequestException('A custom recurrence needs a number of days between sessions.');
      }
      return intervalDays;
    case RecurrenceFrequency.MONTHLY:
      // Handled by calendar arithmetic below, not by a day count.
      return 0;
  }
}

/**
 * MONTHLY IS NOT 30 DAYS. "The same date next month" is what a patient
 * understands, and it drifts through the week — which is fine, because the
 * availability engine checks each occurrence anyway and reports the ones that
 * do not land on a working day.
 */
function addSteps(
  first: Date,
  stepDays: number,
  index: number,
  frequency: RecurrenceFrequency,
): Date {
  if (frequency !== RecurrenceFrequency.MONTHLY) {
    return new Date(first.getTime() + stepDays * index * DAY_MS);
  }
  const next = new Date(first.getTime());
  next.setUTCMonth(next.getUTCMonth() + index);
  return next;
}
