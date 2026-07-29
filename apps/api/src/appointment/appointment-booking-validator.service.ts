import { ConflictException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { StaffService } from '../hr/staff.service';
import { TERMINAL_APPOINTMENT_STATUSES } from './appointment-status.constants';

export interface BookingRequest {
  clinicId: string;
  staffId: string;
  serviceId: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  // Set when re-validating a reschedule, so the appointment being replaced
  // doesn't count against its own overlap/capacity check.
  excludeAppointmentId?: string;
}

function minutesSinceMidnightUTC(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

// Malaysia has a single timezone, so comparing time-of-day via UTC getters
// throughout is a deliberate simplification, not a bug — revisit only if
// the product ever needs to span timezones.
function isWithinWindow(requestedStart: Date, requestedEnd: Date, windowStart: Date, windowEnd: Date): boolean {
  const reqStart = minutesSinceMidnightUTC(requestedStart);
  const reqEnd = minutesSinceMidnightUTC(requestedEnd);
  const winStart = minutesSinceMidnightUTC(windowStart);
  const winEnd = minutesSinceMidnightUTC(windowEnd);
  return reqStart >= winStart && reqEnd <= winEnd;
}

function dateOnlyUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Enforces PRODUCT_REQUIREMENTS.md §8/§18: a doctor can only be booked for a
// service they're configured to perform, and only within their active
// roster minus approved leave/exceptions. Lives in the service layer per
// docs/DATABASE_ARCHITECTURE.md §4 — a pure FK can't express "within roster
// minus exceptions." The appointments_no_overlap EXCLUDE constraint
// (see the add_appointment_module migration) is the DB-level backstop for
// the overlap check specifically; this produces the friendly error message
// for the common, non-racing case.
@Injectable()
export class AppointmentBookingValidator {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly staffService: StaffService,
  ) {}

  async validate(request: BookingRequest): Promise<void> {
    await this.staffService.assertActiveDoctor(request.staffId);

    const qualified = await this.prisma.doctorServiceQualification.findFirst({
      where: { staffId: request.staffId, serviceId: request.serviceId },
    });
    if (!qualified) {
      throw new UnprocessableEntityException('Doctor is not qualified to perform this service');
    }

    await this.assertWithinRoster(request);
    await this.assertNoOverlap(request);
    await this.assertWithinCapacity(request);
  }

  private async assertWithinRoster(request: BookingRequest): Promise<void> {
    const date = dateOnlyUTC(request.scheduledStart);

    const exception = await this.prisma.scheduleException.findFirst({
      where: { staffId: request.staffId, clinicId: request.clinicId, date },
    });

    let withinRoster: boolean;
    if (exception) {
      withinRoster =
        exception.startTime !== null &&
        exception.endTime !== null &&
        isWithinWindow(request.scheduledStart, request.scheduledEnd, exception.startTime, exception.endTime);
    } else {
      const dayOfWeek = request.scheduledStart.getUTCDay();
      const schedules = await this.prisma.doctorSchedule.findMany({
        where: {
          staffId: request.staffId,
          clinicId: request.clinicId,
          dayOfWeek,
          effectiveFrom: { lte: date },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
        },
      });
      withinRoster = schedules.some((schedule) =>
        isWithinWindow(request.scheduledStart, request.scheduledEnd, schedule.startTime, schedule.endTime),
      );
    }

    if (!withinRoster) {
      throw new UnprocessableEntityException(
        "Requested time is outside the doctor's active roster (or falls on a leave/exception date)",
      );
    }
  }

  private async assertNoOverlap(request: BookingRequest): Promise<void> {
    const overlapping = await this.prisma.appointment.findFirst({
      where: {
        staffId: request.staffId,
        status: { notIn: TERMINAL_APPOINTMENT_STATUSES },
        id: request.excludeAppointmentId ? { not: request.excludeAppointmentId } : undefined,
        scheduledStart: { lt: request.scheduledEnd },
        scheduledEnd: { gt: request.scheduledStart },
      },
    });
    if (overlapping) {
      throw new ConflictException('Doctor already has an appointment overlapping this time');
    }
  }

  private async assertWithinCapacity(request: BookingRequest): Promise<void> {
    const config = await this.prisma.slotCapacityConfig.findFirst({
      where: { staffId: request.staffId, clinicId: request.clinicId, serviceId: request.serviceId },
    });
    if (!config?.dailyCapacity) {
      return;
    }

    const dayStart = dateOnlyUTC(request.scheduledStart);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const countSameDay = await this.prisma.appointment.count({
      where: {
        staffId: request.staffId,
        clinicId: request.clinicId,
        serviceId: request.serviceId,
        status: { notIn: TERMINAL_APPOINTMENT_STATUSES },
        id: request.excludeAppointmentId ? { not: request.excludeAppointmentId } : undefined,
        scheduledStart: { gte: dayStart, lt: dayEnd },
      },
    });
    if (countSameDay >= config.dailyCapacity) {
      throw new ConflictException('Doctor has reached daily capacity for this service');
    }
  }
}
