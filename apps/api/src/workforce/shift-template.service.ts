import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ShiftGroup, ShiftTemplate } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, branchScopeOf, requireScopeAny } from '../finance/admin-actor';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';
import { assertMayRoster } from './roster-permission';
import { recordAudit } from '../finance/admin-audit';
import { SaveShiftTemplateDto } from './dto/shift-template.dto';

/** Minutes from a start to an end on the wall clock; an end at or before the start is the next day. */
export function shiftSpanMinutes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return end > start ? end - start : end + 24 * 60 - start;
}

/** What the roster and the settings screen show of a template. */
export function describeTemplate(row: ShiftTemplate) {
  const span = row.startTime && row.endTime ? shiftSpanMinutes(row.startTime, row.endTime) : 0;
  return {
    id: row.id,
    clinicId: row.clinicId,
    group: row.group,
    name: row.name,
    kind: row.kind,
    startTime: row.startTime,
    endTime: row.endTime,
    breakMinutes: row.breakMinutes,
    night: row.night,
    colour: row.colour,
    sortOrder: row.sortOrder,
    active: row.active,
    crossesMidnight: Boolean(row.startTime && row.endTime && row.endTime <= row.startTime),
    /** The shift's length less its break: what the roster says is worked. */
    workedMinutes: Math.max(span - row.breakMinutes, 0),
  };
}

/**
 * SHIFT TEMPLATES (UAT, 14 October 2026): "Shift templates per staff group
 * (doctors / staff), set by the clinic: name, start, end, rest break,
 * crosses midnight, night or day, colour." No shift is built in; the brief's
 * times are one clinic's and stay theirs.
 *
 * Reading is for anybody who may see the roster. Writing is the roster
 * permission. A template once used is retired, not deleted, and changing one
 * never rewrites shifts already rostered: those carry their own copy of the
 * times, break and night flag.
 */
@Injectable()
export class ShiftTemplateService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async list(params: { group?: ShiftGroup; clinicId?: string; includeRetired?: boolean } = {}) {
    await requireScopeAny(this.rawPrisma, ['appointment.view', 'hr.view']);
    const rows = await this.prisma.shiftTemplate.findMany({
      where: {
        ...(params.group ? { group: params.group } : {}),
        ...(params.includeRetired ? {} : { active: true }),
        // A branch sees the templates for every branch and its own.
        ...(params.clinicId ? { OR: [{ clinicId: null }, { clinicId: params.clinicId }] } : {}),
      },
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(describeTemplate);
  }

  async create(dto: SaveShiftTemplateDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      // A doctor shift is the doctor roster's to define, a staff shift the staff roster's.
      assertMayRoster(actor, dto.group);
      const data = await this.validated(tx, dto, null);
      if (dto.clinicId) (await branchScopeOf(tx, actor)).require(dto.clinicId);
      const saved = await tx.shiftTemplate.create({
        data: { ...data, tenantId: currentTenantId(), createdByStaffId: actor.id },
      });
      await recordAudit(tx, actor, {
        action: 'shiftTemplate.saved',
        entityType: 'ShiftTemplate',
        entityId: saved.id,
        before: null,
        after: describeTemplate(saved),
        source: 'hr.roster',
      });
      return describeTemplate(saved);
    });
  }

  async update(id: string, dto: SaveShiftTemplateDto) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      const before = await tx.shiftTemplate.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('That shift template is not on record.');
      assertMayRoster(actor, before.group);
      assertMayRoster(actor, dto.group);
      const data = await this.validated(tx, dto, id);
      if (dto.clinicId) (await branchScopeOf(tx, actor)).require(dto.clinicId);
      const saved = await tx.shiftTemplate.update({ where: { id }, data });
      await recordAudit(tx, actor, {
        action: 'shiftTemplate.saved',
        entityType: 'ShiftTemplate',
        entityId: id,
        before: describeTemplate(before),
        after: describeTemplate(saved),
        source: 'hr.roster',
      });
      return describeTemplate(saved);
    });
  }

  /** Deleted while nothing was rostered from it; retired once something was. */
  async remove(id: string) {
    return withTenantTx(this.rawPrisma, async (tx) => {
      const actor = await requireActor(tx);
      const row = await tx.shiftTemplate.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('That shift template is not on record.');
      assertMayRoster(actor, row.group);
      const used = await tx.providerShift.count({ where: { templateId: id } });
      if (used > 0) {
        await tx.shiftTemplate.update({ where: { id }, data: { active: false } });
      } else {
        await tx.shiftTemplate.delete({ where: { id } });
      }
      await recordAudit(tx, actor, {
        action: used > 0 ? 'shiftTemplate.retired' : 'shiftTemplate.deleted',
        entityType: 'ShiftTemplate',
        entityId: id,
        before: describeTemplate(row),
        after: used > 0 ? { active: false, rosteredShifts: used } : null,
        source: 'hr.roster',
      });
      return { id, retired: used > 0, rosteredShifts: used };
    });
  }

  private async validated(tx: AdminTx, dto: SaveShiftTemplateDto, id: string | null) {
    const name = dto.name.trim().replace(/\s+/g, ' ');
    if (!name) throw new BadRequestException('Give the shift a name, e.g. "Morning".');
    const kind = dto.kind ?? 'WORKING';
    const startTime = kind === 'WORKING' ? (dto.startTime ?? null) : null;
    const endTime = kind === 'WORKING' ? (dto.endTime ?? null) : null;
    const breakMinutes = kind === 'WORKING' ? (dto.breakMinutes ?? 0) : 0;
    if (kind === 'WORKING') {
      if (!startTime || !endTime) throw new BadRequestException('A working shift needs a start and an end time.');
      if (startTime === endTime) throw new BadRequestException('A shift cannot start and end at the same time.');
      if (breakMinutes >= shiftSpanMinutes(startTime, endTime)) {
        throw new BadRequestException('The rest break is as long as the shift. Shorten the break or lengthen the shift.');
      }
    }
    const clinicId = dto.clinicId ?? null;
    const clash = await tx.shiftTemplate.findFirst({
      where: {
        group: dto.group,
        clinicId,
        active: true,
        name: { equals: name, mode: 'insensitive' },
        ...(id ? { id: { not: id } } : {}),
      },
    });
    if (clash) throw new ConflictException(`There is already a ${dto.group === 'DOCTOR' ? 'doctor' : 'staff'} shift called "${clash.name}".`);
    return {
      group: dto.group,
      name,
      kind,
      startTime,
      endTime,
      breakMinutes,
      night: kind === 'WORKING' ? (dto.night ?? false) : false,
      colour: dto.colour.toLowerCase(),
      clinicId,
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      ...(dto.active !== undefined ? { active: dto.active } : {}),
    };
  }
}
