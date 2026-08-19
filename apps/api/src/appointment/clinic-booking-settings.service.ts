import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  TENANT_SCOPED_PRISMA,
  TenantScopedPrismaClient,
} from '../core/tenant-scoped-prisma.provider';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { parseDateOnly, parseTimeToDate, timeToMinutesOfDay } from './time.util';
import { UpsertClinicBookingSettingsDto } from './dto/upsert-clinic-booking-settings.dto';
import { CreateClinicClosedDateDto } from './dto/create-clinic-closed-date.dto';

/**
 * What a clinic that has never opened this screen behaves like.
 *
 * BOTH SESSION TIMES ARE NULL, and that is a correction rather than a
 * simplification. They used to read 09:00-17:00, which the SCREEN showed and
 * the ENGINE did not apply — an unconfigured clinic has no settings row, and
 * the engine clamps nothing when there is no row. Two answers to "when does
 * this clinic book", and the one the owner could see was the wrong one.
 *
 * Null means "the clinic does not narrow that end", which is also the only
 * honest default for a 24-hour clinic: a fixed 9-to-5 assumption would
 * silently amputate a night roster the first time anybody saved this form.
 */
export const DEFAULT_BOOKING_SETTINGS = {
  firstSessionTime: null as string | null,
  lastSessionTime: null as string | null,
  // Zero, deliberately. A clinic that has not thought about notice should not
  // find its diary silently narrowed by a number nobody chose.
  minimumNoticeMinutes: 0,
  maxAdvanceDays: null as number | null,
  observePublicHolidays: false,
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
      firstSessionTime: row.firstSessionTime ? formatTime(row.firstSessionTime) : null,
      lastSessionTime: row.lastSessionTime ? formatTime(row.lastSessionTime) : null,
      minimumNoticeMinutes: row.minimumNoticeMinutes,
      maxAdvanceDays: row.maxAdvanceDays,
      observePublicHolidays: row.observePublicHolidays,
      configured: true,
    };
  }

  async upsert(clinicId: string, dto: UpsertClinicBookingSettingsDto) {
    // An EMPTY session time is now a real answer meaning "we do not narrow that
    // end" — a 24-hour clinic says it by leaving both blank. Only a non-empty
    // value has to look like a time.
    const firstRaw = dto.firstSessionTime?.trim() || null;
    const lastRaw = dto.lastSessionTime?.trim() || null;
    if ((firstRaw && !HHMM.test(firstRaw)) || (lastRaw && !HHMM.test(lastRaw))) {
      throw new BadRequestException('Session times must be written as HH:MM, e.g. 09:00.');
    }
    const first = firstRaw ? parseTimeToDate(firstRaw) : null;
    const last = lastRaw ? parseTimeToDate(lastRaw) : null;
    // The database refuses this too, but being refused by a CHECK constraint
    // is not an explanation anybody can act on.
    if (first && last && timeToMinutesOfDay(last) <= timeToMinutesOfDay(first)) {
      throw new BadRequestException(
        'The last session must be after the first — otherwise nothing can ever be booked.',
      );
    }
    if (dto.minimumNoticeMinutes < 0) {
      throw new BadRequestException('Minimum notice cannot be negative.');
    }
    if (dto.maxAdvanceDays != null && dto.maxAdvanceDays < 1) {
      throw new BadRequestException(
        'How far ahead patients may book must be at least one day, or left blank for no limit.',
      );
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
      maxAdvanceDays: dto.maxAdvanceDays ?? null,
      observePublicHolidays: dto.observePublicHolidays ?? false,
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
      reasonIsPublic: row.reasonIsPublic,
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
        // A patient may only read the reason if somebody said so. "Deepavali"
        // is fine; the reason a clinic would rather not publish must still be
        // recordable, so this is opt-in.
        reasonIsPublic: dto.reasonIsPublic ?? false,
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
