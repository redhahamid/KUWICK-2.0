import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentTenantId } from '../core/tenant-context';
import { CreateDoctorScheduleDto } from './dto/create-doctor-schedule.dto';
import { UpdateDoctorScheduleDto } from './dto/update-doctor-schedule.dto';
import { parseDateOnly, parseTimeToDate, timeToMinutesOfDay } from './time.util';
import { SetWeeklyAvailabilityDto } from './dto/set-weekly-availability.dto';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

@Injectable()
export class DoctorScheduleService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  create(dto: CreateDoctorScheduleDto) {
    return this.prisma.doctorSchedule.create({
      data: {
        tenantId: currentTenantId(),
        clinicId: dto.clinicId,
        staffId: dto.staffId,
        dayOfWeek: dto.dayOfWeek,
        startTime: parseTimeToDate(dto.startTime),
        endTime: parseTimeToDate(dto.endTime),
        effectiveFrom: parseDateOnly(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? parseDateOnly(dto.effectiveTo) : null,
      },
    });
  }

  findAll(filter: { staffId?: string; clinicId?: string }) {
    return this.prisma.doctorSchedule.findMany({
      where: { staffId: filter.staffId, clinicId: filter.clinicId },
      orderBy: [{ staffId: 'asc' }, { dayOfWeek: 'asc' }],
    });
  }

  async update(id: string, dto: UpdateDoctorScheduleDto) {
    await this.assertExists(id);
    return this.prisma.doctorSchedule.update({
      where: { id },
      data: { effectiveTo: parseDateOnly(dto.effectiveTo) },
    });
  }

  async remove(id: string) {
    await this.assertExists(id);
    await this.prisma.doctorSchedule.delete({ where: { id } });
  }

  /**
   * The doctor's week as the availability screen reads it: one entry per day
   * they work, in day order, with days off simply absent.
   */
  async weekly(staffId: string, clinicId: string) {
    const rows = await this.prisma.doctorSchedule.findMany({
      where: {
        staffId,
        clinicId,
        effectiveFrom: { lte: today() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today() } }],
      },
      orderBy: { dayOfWeek: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      dayOfWeek: row.dayOfWeek,
      startTime: formatTime(row.startTime),
      endTime: formatTime(row.endTime),
    }));
  }

  /**
   * REPLACE the doctor's week, in one transaction — WITHOUT destroying the
   * roster history somebody else recorded.
   *
   * THE BUG THIS FIXES. This method used to `deleteMany` every
   * `DoctorSchedule` row for the pair and write the seven new ones. But this
   * is not the only screen that writes that table: `/management/operation/
   * doctor-schedules` adds EFFECTIVE-DATED rows — "Dr Redha works Tuesdays
   * from 1 March to 30 June" — and saving the weekly form silently deleted
   * every one of them, dating included. Same table, two mental models, and one
   * of them was destructive. That is data loss, not an information-architecture
   * opinion.
   *
   * So the old rows are now END-DATED rather than deleted. A weekly pattern
   * that was in force until yesterday remains a true statement about
   * yesterday; the new pattern is in force from today. Rows that had not taken
   * effect before today are replaced outright, because a pattern starting
   * today that is rewritten the same day has no history to preserve — and
   * end-dating one to yesterday would produce a row whose end precedes its
   * start.
   *
   * Appointments already booked keep their own times and are untouched by any
   * of this: a booking is an instant, not a reference to a roster row.
   */
  async setWeekly(dto: SetWeeklyAvailabilityDto) {
    const seen = new Set<number>();
    for (const day of dto.days) {
      if (!HHMM.test(day.startTime) || !HHMM.test(day.endTime)) {
        throw new BadRequestException('Times must be written as HH:MM, e.g. 09:00.');
      }
      // `end === start` is still nothing; `end < start` is now an OVERNIGHT
      // shift and is read as running into the following day, which is what a
      // night clinic works and what the availability engine now understands.
      if (timeToMinutesOfDay(parseTimeToDate(day.endTime)) === timeToMinutesOfDay(parseTimeToDate(day.startTime))) {
        throw new BadRequestException(
          `${DAY_NAMES[day.dayOfWeek]} starts and ends at the same time — nothing could be booked in it.`,
        );
      }
      if (seen.has(day.dayOfWeek)) {
        throw new BadRequestException(`${DAY_NAMES[day.dayOfWeek]} is listed twice.`);
      }
      seen.add(day.dayOfWeek);
    }

    const tenantId = currentTenantId();
    const from = today();
    const until = new Date(from.getTime() - DAY_MS);

    await this.prisma.$transaction([
      // History: in force up to and including yesterday, and preserved.
      this.prisma.doctorSchedule.updateMany({
        where: {
          staffId: dto.staffId,
          clinicId: dto.clinicId,
          effectiveFrom: { lt: from },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
        },
        data: { effectiveTo: until },
      }),
      // Not yet history: a pattern that starts today or later and is being
      // rewritten now was never in force for any past date.
      this.prisma.doctorSchedule.deleteMany({
        where: { staffId: dto.staffId, clinicId: dto.clinicId, effectiveFrom: { gte: from } },
      }),
      ...dto.days.map((day) =>
        this.prisma.doctorSchedule.create({
          data: {
            tenantId,
            clinicId: dto.clinicId,
            staffId: dto.staffId,
            dayOfWeek: day.dayOfWeek,
            startTime: parseTimeToDate(day.startTime),
            endTime: parseTimeToDate(day.endTime),
            effectiveFrom: from,
            effectiveTo: null,
          },
        }),
      ),
    ]);

    return this.weekly(dto.staffId, dto.clinicId);
  }

  private async assertExists(id: string) {
    const schedule = await this.prisma.doctorSchedule.findUnique({ where: { id } });
    if (!schedule) {
      throw new NotFoundException('Doctor schedule not found');
    }
    return schedule;
  }
}

function formatTime(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
}

/** The roster's effective-from: a date, not an instant. */
function today(): Date {
  return parseDateOnly(new Date().toISOString().slice(0, 10));
}
