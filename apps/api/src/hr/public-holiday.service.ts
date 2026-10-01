import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { CreatePublicHolidayDto } from './dto/create-public-holiday.dto';
import { UpdatePublicHolidayDto } from './dto/update-public-holiday.dto';

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
          data: { tenantId: currentTenantId(), date: new Date(dto.date), name: dto.name, kind: dto.kind ?? 'ORDINARY' },
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
        after: { date: dto.date, name: dto.name, kind: dto.kind ?? 'ORDINARY' },
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
        data: { ...(dto.name === undefined ? {} : { name: dto.name }), ...(dto.kind === undefined ? {} : { kind: dto.kind }) },
      });
      await recordAudit(tx, actor, {
        action: 'publicHoliday.updated',
        entityType: 'PublicHoliday',
        entityId: id,
        before: { date: holiday.date.toISOString().slice(0, 10), name: holiday.name, kind: holiday.kind },
        after: { date: saved.date.toISOString().slice(0, 10), name: saved.name, kind: saved.kind },
        source: 'hr.settings',
      });
      return saved;
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
