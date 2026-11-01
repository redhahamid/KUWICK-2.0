import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { CreatePublicHolidayDto } from './dto/create-public-holiday.dto';
import { UpdatePublicHolidayDto } from './dto/update-public-holiday.dto';
import { LoadHolidayPresetsDto } from './dto/load-holiday-presets.dto';
import { HOLIDAY_PRESET_YEARS, holidayPresets, isMalaysianState } from './holiday-presets';

/** The state whose holidays the clinic last loaded: `{ state }`. */
export const HOLIDAY_STATE_SETTING = 'hr.holidayState';

/**
 * THE TENANT'S HOLIDAY CALENDAR. One calendar for every branch, which is why
 * writing it is a tenant-wide act: the payroll engine prices public-holiday
 * work in every branch's month from it, and slot availability and the leave
 * preview read it too. These routes ran on the JWT alone — any account could
 * add or remove a holiday, silently. Reading takes `hr.view`, the permission
 * of the Settings screens that show it; writing takes `settings.manage`, the
 * one permission that speaks for every branch, and leaves an audit row.
 */
@Injectable()
export class PublicHolidayService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async create(dto: CreatePublicHolidayDto) {
    return withAdminTx(this.rawPrisma, 'settings.manage', async (tx, actor) => {
      let holiday;
      try {
        holiday = await tx.publicHoliday.create({
          data: {
            tenantId: currentTenantId(),
            date: new Date(dto.date),
            name: dto.name,
            kind: dto.kind ?? 'ORDINARY',
            multiplier: dto.multiplier ?? null,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('That date is already a public holiday.');
        }
        throw error;
      }
      await recordAudit(tx, actor, {
        action: 'publicHoliday.created',
        entityType: 'PublicHoliday',
        entityId: holiday.id,
        after: { date: dto.date, name: dto.name, kind: dto.kind ?? 'ORDINARY', multiplier: dto.multiplier ?? null },
        source: 'hr.settings',
      });
      return holiday;
    });
  }

  /**
   * The name or the kind, after the fact: a calendar typed in before Raya
   * could be marked festive needs no deleting and re-adding. The date stays;
   * a holiday on another date is another holiday.
   */
  async update(id: string, dto: UpdatePublicHolidayDto) {
    return withAdminTx(this.rawPrisma, 'settings.manage', async (tx, actor) => {
      const holiday = await tx.publicHoliday.findUnique({ where: { id } });
      if (!holiday || holiday.tenantId !== currentTenantId()) {
        throw new NotFoundException('Public holiday not found');
      }
      const saved = await tx.publicHoliday.update({
        where: { id },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name }),
          ...(dto.kind === undefined ? {} : { kind: dto.kind }),
          ...(dto.multiplier === undefined ? {} : { multiplier: dto.multiplier }),
        },
      });
      await recordAudit(tx, actor, {
        action: 'publicHoliday.updated',
        entityType: 'PublicHoliday',
        entityId: id,
        before: { date: holiday.date.toISOString().slice(0, 10), name: holiday.name, kind: holiday.kind, multiplier: holiday.multiplier?.toString() ?? null },
        after: { date: saved.date.toISOString().slice(0, 10), name: saved.name, kind: saved.kind, multiplier: saved.multiplier?.toString() ?? null },
        source: 'hr.settings',
      });
      return saved;
    });
  }

  /** The starting list for a year and state, with the dates already on the calendar marked. */
  async presets(year: number, state: string) {
    await requirePermission(this.rawPrisma, 'hr.view');
    if (!isMalaysianState(state)) throw new BadRequestException('Choose a Malaysian state.');
    const existing = await this.prisma.publicHoliday.findMany({ select: { date: true } });
    const onFile = new Set(existing.map((row) => row.date.toISOString().slice(0, 10)));
    return {
      year,
      state,
      available: HOLIDAY_PRESET_YEARS.includes(year),
      holidays: holidayPresets(year, state).map((row) => ({ ...row, onCalendar: onFile.has(row.date) })),
    };
  }

  /** Adds the ticked dates of the starting list; a date already on the calendar is left as it is. */
  async loadPresets(dto: LoadHolidayPresetsDto) {
    if (!isMalaysianState(dto.state)) throw new BadRequestException('Choose a Malaysian state.');
    const list = new Map(holidayPresets(dto.year, dto.state).map((row) => [row.date, row]));
    const wanted = dto.dates.map((date) => date.slice(0, 10));
    const unknown = wanted.filter((date) => !list.has(date));
    if (unknown.length > 0) throw new BadRequestException(`Not on the ${dto.year} list for ${dto.state}: ${unknown.join(', ')}.`);
    return withAdminTx(this.rawPrisma, 'settings.manage', async (tx, actor) => {
      const existing = await tx.publicHoliday.findMany({ select: { date: true } });
      const onFile = new Set(existing.map((row) => row.date.toISOString().slice(0, 10)));
      const added = wanted.filter((date) => !onFile.has(date)).map((date) => list.get(date)!);
      if (added.length > 0) {
        await tx.publicHoliday.createMany({
          data: added.map((row) => ({ tenantId: currentTenantId(), date: new Date(row.date), name: row.name, kind: 'ORDINARY' as const })),
          skipDuplicates: true,
        });
        await recordAudit(tx, actor, {
          action: 'publicHoliday.created',
          entityType: 'PublicHoliday',
          entityId: `preset:${dto.year}:${dto.state}`,
          reason: `Loaded ${added.length} ${dto.year} public holidays for ${dto.state}`,
          after: { dates: added.map((row) => row.date) },
          source: 'hr.settings',
        });
      }
      // The clinic's state, remembered for the next visit (new-clinic UAT #2, item 64).
      const where = { tenantId_key: { tenantId: currentTenantId(), key: HOLIDAY_STATE_SETTING } };
      await tx.globalSetting.upsert({
        where,
        create: { tenantId: currentTenantId(), key: HOLIDAY_STATE_SETTING, value: { state: dto.state } },
        update: { value: { state: dto.state } },
      });
      return { added: added.length, skipped: wanted.length - added.length };
    });
  }

  async findAll() {
    await requirePermission(this.rawPrisma, 'hr.view');
    return this.prisma.publicHoliday.findMany({ orderBy: { date: 'asc' } });
  }

  async remove(id: string) {
    return withAdminTx(this.rawPrisma, 'settings.manage', async (tx, actor) => {
      const holiday = await tx.publicHoliday.findUnique({ where: { id } });
      if (!holiday || holiday.tenantId !== currentTenantId()) {
        throw new NotFoundException('Public holiday not found');
      }
      await tx.publicHoliday.delete({ where: { id } });
      await recordAudit(tx, actor, {
        action: 'publicHoliday.deleted',
        entityType: 'PublicHoliday',
        entityId: id,
        before: { date: holiday.date.toISOString().slice(0, 10), name: holiday.name, kind: holiday.kind },
        source: 'hr.settings',
      });
    });
  }
}
