import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { parseDateOnly, parseTimeToDate, timeToMinutesOfDay } from './time.util';
import { UpsertClinicBookingSettingsDto } from './dto/upsert-clinic-booking-settings.dto';
import { CreateClinicClosedDateDto } from './dto/create-clinic-closed-date.dto';

/** What a clinic that has never opened this screen behaves like. */
export const DEFAULT_BOOKING_SETTINGS = {
  firstSessionTime: '09:00',
  lastSessionTime: '17:00',
  // Zero, deliberately. A clinic that has not thought about notice should not
  // find its diary silently narrowed by a number nobody chose.
  minimumNoticeMinutes: 0,
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

@Injectable()
export class ClinicBookingSettingsService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
  ) {}

  /**
   * Always answers, even for a clinic with no row. The screen and the engine
   * must agree about an unconfigured clinic, and "null" is not something a
   * form can render or an engine can compare against.
   */
  async get(clinicId: string) {
    const row = await this.prisma.clinicBookingSettings.findFirst({ where: { clinicId } });
    if (!row) {
      return { clinicId, ...DEFAULT_BOOKING_SETTINGS, configured: false };
    }
    return {
      clinicId,
      firstSessionTime: formatTime(row.firstSessionTime),
      lastSessionTime: formatTime(row.lastSessionTime),
      minimumNoticeMinutes: row.minimumNoticeMinutes,
      configured: true,
    };
  }

  async upsert(clinicId: string, dto: UpsertClinicBookingSettingsDto) {
    if (!HHMM.test(dto.firstSessionTime) || !HHMM.test(dto.lastSessionTime)) {
      throw new BadRequestException('Session times must be written as HH:MM, e.g. 09:00.');
    }
    const first = parseTimeToDate(dto.firstSessionTime);
    const last = parseTimeToDate(dto.lastSessionTime);
    // The database refuses this too, but being refused by a CHECK constraint
    // is not an explanation anybody can act on.
    if (timeToMinutesOfDay(last) <= timeToMinutesOfDay(first)) {
      throw new BadRequestException(
        'The last session must be after the first — otherwise nothing can ever be booked.',
      );
    }
    if (dto.minimumNoticeMinutes < 0) {
      throw new BadRequestException('Minimum notice cannot be negative.');
    }

    const tenantId = currentTenantId();
    const existing = await this.prisma.clinicBookingSettings.findFirst({
      where: { clinicId },
      select: { id: true },
    });

    const data = {
      firstSessionTime: first,
      lastSessionTime: last,
      minimumNoticeMinutes: dto.minimumNoticeMinutes,
    };

    if (existing) {
      await this.prisma.clinicBookingSettings.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.clinicBookingSettings.create({ data: { ...data, tenantId, clinicId } });
    }
    return this.get(clinicId);
  }

  /**
   * Upcoming closed dates only, by default. A holiday list that grows forever
   * is a list nobody reads; last year's Deepavali is not a setting.
   */
  async listClosedDates(clinicId: string, includePast = false) {
    const rows = await this.prisma.clinicClosedDate.findMany({
      where: {
        clinicId,
        ...(includePast ? {} : { date: { gte: parseDateOnly(todayKey()) } }),
      },
      orderBy: { date: 'asc' },
      include: { createdByStaff: { select: { fullName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      date: row.date.toISOString().slice(0, 10),
      reason: row.reason,
      createdBy: row.createdByStaff?.fullName ?? null,
      createdAt: row.createdAt,
    }));
  }

  async addClosedDate(clinicId: string, dto: CreateClinicClosedDateDto) {
    const date = parseDateOnly(dto.date);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Date must be written as YYYY-MM-DD.');
    }

    const clash = await this.prisma.clinicClosedDate.findFirst({ where: { clinicId, date } });
    if (clash) {
      throw new BadRequestException('That date is already marked closed.');
    }

    await this.prisma.clinicClosedDate.create({
      data: {
        tenantId: currentTenantId(),
        clinicId,
        date,
        reason: dto.reason?.trim() || null,
        createdByStaffId: currentStaffId() ?? null,
      },
    });
    return this.listClosedDates(clinicId);
  }

  /**
   * Removing a closed date does NOT re-open bookings that were refused while
   * it stood — there is nothing to re-open, because those bookings were never
   * made. It only stops refusing new ones.
   */
  async removeClosedDate(clinicId: string, id: string) {
    await this.prisma.clinicClosedDate.deleteMany({ where: { id, clinicId } });
    return this.listClosedDates(clinicId);
  }
}

function formatTime(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
