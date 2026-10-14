import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { LeaveTypeSetting } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { SaveLeaveTypeDto } from './dto/save-leave-type.dto';
import { DEFAULT_LEAVE_TYPES, statutoryFloor } from './leave-types';

/** What the screens show of a leave type. */
export function describeLeaveType(row: LeaveTypeSetting) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    paid: row.paid,
    daysPerYear: row.daysPerYear === null ? null : Number(row.daysPerYear),
    documentRequired: row.documentRequired,
    carryForwardCap: row.carryForwardCap === null ? null : Number(row.carryForwardCap),
    statutory: row.statutory,
    /** The Act's minimum for a new starter; more by years of service. */
    actMinimum: row.statutory ? statutoryFloor(row.statutory, 0) : null,
    active: row.active,
  };
}

/**
 * The clinic's leave types (Section D). A clinic that has never opened the
 * screen gets the defaults the first time anything reads them, so balances
 * and My Kuwick always have a list to show.
 */
@Injectable()
export class LeaveTypeService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** Every type, the defaults written on first use. */
  private async all(): Promise<LeaveTypeSetting[]> {
    const rows = await this.prisma.leaveTypeSetting.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    if (rows.length > 0) return rows;
    await this.prisma.leaveTypeSetting.createMany({
      data: DEFAULT_LEAVE_TYPES.map((row, index) => ({ ...row, tenantId: currentTenantId(), sortOrder: index })),
      skipDuplicates: true,
    });
    return this.prisma.leaveTypeSetting.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  async list() {
    await requirePermission(this.rawPrisma, 'hr.view');
    return (await this.all()).map(describeLeaveType);
  }

  async save(id: string | null, dto: SaveLeaveTypeDto) {
    await this.all();
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const before = id ? await tx.leaveTypeSetting.findUnique({ where: { id } }) : null;
      if (id && !before) throw new NotFoundException('Leave type not found');
      const data = checked(dto, before);
      if (!before) await refuseTakenCode(tx, data.code);
      const saved = before
        ? await tx.leaveTypeSetting.update({ where: { id: before.id }, data })
        : await tx.leaveTypeSetting.create({ data: { ...data, tenantId: currentTenantId(), sortOrder: 100 } });
      await recordAudit(tx, actor, {
        action: before ? 'leaveType.updated' : 'leaveType.created',
        entityType: 'LeaveTypeSetting',
        entityId: saved.id,
        before: before ? describeLeaveType(before) : undefined,
        after: describeLeaveType(saved),
        source: 'hr.settings',
      });
      return describeLeaveType(saved);
    });
  }
}

async function refuseTakenCode(tx: AdminTx, code: string) {
  const taken = await tx.leaveTypeSetting.findFirst({ where: { code } });
  if (taken) throw new ConflictException(`There is already a leave type with the code ${code} ("${taken.name}").`);
}

/** The DTO as stored, with the Act's floor enforced on statutory types (decision 6). */
function checked(dto: SaveLeaveTypeDto, before: LeaveTypeSetting | null) {
  const name = dto.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new BadRequestException('Give the leave type a name.');
  // A code is the identity of every request and balance of the type, so it never changes.
  const code = before ? before.code : dto.code;
  if (!code) throw new BadRequestException('Give the leave type a code, e.g. STUDY.');
  const statutory = before ? before.statutory : null;
  const days = dto.daysPerYear ?? null;
  const floor = statutoryFloor(statutory, 0);
  if (statutory && (days === null || days < floor)) {
    throw new BadRequestException(`The Employment Act gives at least ${floor} days of ${name.toLowerCase()} a year. A clinic can give more, never less.`);
  }
  if (statutory && dto.paid === false) {
    throw new BadRequestException(`${name} is paid leave under the Employment Act.`);
  }
  return {
    code,
    name,
    paid: dto.paid ?? true,
    daysPerYear: days,
    documentRequired: dto.documentRequired ?? false,
    carryForwardCap: dto.carryForwardCap ?? null,
    active: dto.active ?? true,
  };
}
