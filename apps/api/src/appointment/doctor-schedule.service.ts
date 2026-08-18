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
      where: { staffId, clinicId, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today() } }] },
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
   * REPLACE the doctor's week, in one transaction.
   *
   * The screen is seven toggles and seven time ranges; a person reads it as
   * one statement and saves it as one. Doing it as adds and deletes from the
   * browser would put the diff on the side of the wire that cannot see what is
   * stored, and a failed third request would leave a week half-changed.
   *
   * The old rows are DELETED rather than end-dated. A weekly pattern is a
   * standing arrangement, not a record of what happened: appointments already
   * booked keep their own times and are untouched by this, and `effectiveFrom`
   * exists for a roster that is genuinely changing on a date, which is a
   * different screen and a different act.
   */
  async setWeekly(dto: SetWeeklyAvailabilityDto) {
    const seen = new Set<number>();
    for (const day of dto.days) {
      if (!HHMM.test(day.startTime) || !HHMM.test(day.endTime)) {
        throw new BadRequestException('Times must be written as HH:MM, e.g. 09:00.');
      }
      if (timeToMinutesOfDay(parseTimeToDate(day.endTime)) <= timeToMinutesOfDay(parseTimeToDate(day.startTime))) {
        throw new BadRequestException(
          `${DAY_NAMES[day.dayOfWeek]} ends before it starts — nothing could be booked in it.`,
        );
      }
      if (seen.has(day.dayOfWeek)) {
        throw new BadRequestException(`${DAY_NAMES[day.dayOfWeek]} is listed twice.`);
      }
      seen.add(day.dayOfWeek);
    }

    const tenantId = currentTenantId();
    const from = today();

    await this.prisma.$transaction([
      this.prisma.doctorSchedule.deleteMany({
        where: { staffId: dto.staffId, clinicId: dto.clinicId },
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
