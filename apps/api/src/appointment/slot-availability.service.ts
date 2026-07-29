import { Inject, Injectable } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { TERMINAL_APPOINTMENT_STATUSES } from './appointment-status.constants';

export interface AvailabilityQuery {
  staffId: string;
  clinicId: string;
  serviceId: string;
  // UTC midnight of the requested date.
  date: Date;
}

export interface AvailableSlot {
  start: Date;
  end: Date;
}

interface RosterWindow {
  start: Date;
  end: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function combineDateAndTime(date: Date, time: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      time.getUTCHours(),
      time.getUTCMinutes(),
      time.getUTCSeconds(),
    ),
  );
}

// The Slot & Capacity Engine (PRODUCT_REQUIREMENTS.md §3B): computes open
// booking slots from the doctor's roster for a date, minus already-booked
// time, sliced by the configured slot length, capped at daily capacity.
@Injectable()
export class SlotAvailabilityService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  async findAvailableSlots(query: AvailabilityQuery): Promise<AvailableSlot[]> {
    const config = await this.prisma.slotCapacityConfig.findFirst({
      where: { staffId: query.staffId, clinicId: query.clinicId, serviceId: query.serviceId },
    });
    if (!config) {
      return [];
    }

    const windows = await this.resolveRosterWindows(query);
    if (windows.length === 0) {
      return [];
    }

    const dayStart = query.date;
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);

    const occupied = await this.prisma.appointment.findMany({
      where: {
        staffId: query.staffId,
        status: { notIn: TERMINAL_APPOINTMENT_STATUSES },
        scheduledStart: { gte: dayStart, lt: dayEnd },
      },
      select: { scheduledStart: true, scheduledEnd: true },
    });

    const slotMs = config.slotLengthMinutes * 60 * 1000;
    let slots: AvailableSlot[] = [];
    for (const window of windows) {
      let cursor = window.start.getTime();
      while (cursor + slotMs <= window.end.getTime()) {
        const slotStart = new Date(cursor);
        const slotEnd = new Date(cursor + slotMs);
        const blocked = occupied.some(
          (appt) => slotStart < appt.scheduledEnd && slotEnd > appt.scheduledStart,
        );
        if (!blocked) {
          slots.push({ start: slotStart, end: slotEnd });
        }
        cursor += slotMs;
      }
    }

    if (config.dailyCapacity != null) {
      const bookedForService = await this.prisma.appointment.count({
        where: {
          staffId: query.staffId,
          clinicId: query.clinicId,
          serviceId: query.serviceId,
          status: { notIn: TERMINAL_APPOINTMENT_STATUSES },
          scheduledStart: { gte: dayStart, lt: dayEnd },
        },
      });
      const remaining = Math.max(0, config.dailyCapacity - bookedForService);
      slots = slots.slice(0, remaining);
    }

    return slots;
  }

  private async resolveRosterWindows(query: AvailabilityQuery): Promise<RosterWindow[]> {
    const exception = await this.prisma.scheduleException.findFirst({
      where: { staffId: query.staffId, clinicId: query.clinicId, date: query.date },
    });
    if (exception) {
      if (!exception.startTime || !exception.endTime) {
        return [];
      }
      return [
        {
          start: combineDateAndTime(query.date, exception.startTime),
          end: combineDateAndTime(query.date, exception.endTime),
        },
      ];
    }

    const dayOfWeek = query.date.getUTCDay();
    const schedules = await this.prisma.doctorSchedule.findMany({
      where: {
        staffId: query.staffId,
        clinicId: query.clinicId,
        dayOfWeek,
        effectiveFrom: { lte: query.date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: query.date } }],
      },
    });
    return schedules.map((schedule) => ({
      start: combineDateAndTime(query.date, schedule.startTime),
      end: combineDateAndTime(query.date, schedule.endTime),
    }));
  }
}
