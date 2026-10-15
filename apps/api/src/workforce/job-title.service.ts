import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { CreateJobTitleDto, UpdateJobTitleDto } from './dto/job-title.dto';

/**
 * THE CLINIC'S OWN JOB TITLES.
 *
 * "Job" on the employee form was the account role — doctor, front desk,
 * finance — which decides what somebody can open in Kuwick and which payroll
 * group they fall in, and "Position" was free text nobody could pick from.
 * A clinic has its own words for its jobs (clinic assistant, pharmacist,
 * receptionist), wants to pick them from a list, and wants to add to that
 * list without asking anybody. This is that list.
 *
 * A profile points at a title and keeps the name in `position`, so every
 * screen, payslip and snapshot that already reads `position` keeps reading
 * it. The first time a clinic opens the list, the positions already typed on
 * its records become its titles, so nobody starts from an empty page.
 */
/**
 * A STARTING LIST FOR A NEW CLINIC (new-clinic UAT, 15 October 2026): the
 * jobs nearly every Malaysian clinic has. Added once, when the clinic has no
 * titles at all; it renames or retires any of them like its own.
 */
export const STARTING_JOB_TITLES = ['Doctor', 'Nurse', 'Clinic Assistant', 'Pharmacy Assistant', 'Clerk', 'Locum'];

@Injectable()
export class JobTitleService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async list() {
    await requirePermission(this.rawPrisma, 'hr.view');
    if ((await this.prisma.jobTitle.count()) === 0) {
      await this.prisma.jobTitle.createMany({
        data: STARTING_JOB_TITLES.map((name, sortOrder) => ({ tenantId: currentTenantId(), name, sortOrder })),
        skipDuplicates: true,
      });
    }
    await this.adoptTypedPositions();
    const rows = await this.prisma.jobTitle.findMany({
      orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { employees: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      active: row.active,
      /** People whose record points at this title, leavers included. */
      employeeCount: row._count.employees,
    }));
  }

  async create(dto: CreateJobTitleDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const name = dto.name.trim();
      const clash = await tx.jobTitle.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
      if (clash) throw new ConflictException(`"${clash.name}" is already on the list${clash.active ? '' : ', retired'}.`);
      const saved = await tx.jobTitle.create({ data: { tenantId: currentTenantId(), name } });
      await recordAudit(tx, actor, {
        action: 'jobTitle.created',
        entityType: 'JobTitle',
        entityId: saved.id,
        after: { name },
        source: 'hr.employees',
      });
      return { id: saved.id, name: saved.name, active: saved.active, employeeCount: 0 };
    });
  }

  /** Rename or retire. A rename follows through to `position` on every record that holds the title. */
  async update(id: string, dto: UpdateJobTitleDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const row = await tx.jobTitle.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Job title not found');
      const name = dto.name?.trim();
      if (name !== undefined && name.length < 2) throw new BadRequestException('A job title needs at least two characters.');
      if (name && name.toLowerCase() !== row.name.toLowerCase()) {
        const clash = await tx.jobTitle.findFirst({ where: { id: { not: id }, name: { equals: name, mode: 'insensitive' } } });
        if (clash) throw new ConflictException(`"${clash.name}" is already on the list.`);
      }
      const saved = await tx.jobTitle.update({
        where: { id },
        data: { ...(name === undefined ? {} : { name }), ...(dto.active === undefined ? {} : { active: dto.active }) },
      });
      if (name !== undefined && name !== row.name) {
        await tx.employeeProfile.updateMany({ where: { jobTitleId: id }, data: { position: name } });
      }
      await recordAudit(tx, actor, {
        action: 'jobTitle.updated',
        entityType: 'JobTitle',
        entityId: id,
        before: { name: row.name, active: row.active },
        after: { name: saved.name, active: saved.active },
        source: 'hr.employees',
      });
      const count = await tx.employeeProfile.count({ where: { jobTitleId: id } });
      return { id: saved.id, name: saved.name, active: saved.active, employeeCount: count };
    });
  }

  /**
   * The positions a clinic typed before the list existed become its titles,
   * once, and the records that typed them point at the title they match.
   * Nothing is renamed and nothing is invented: a title is created only from
   * a position that is on somebody's record today.
   */
  private async adoptTypedPositions() {
    const untitled = await this.prisma.employeeProfile.findMany({
      where: { jobTitleId: null, position: { not: null } },
      select: { id: true, position: true },
    });
    const wanted = new Map<string, string>();
    for (const row of untitled) {
      const name = (row.position ?? '').trim();
      if (name.length >= 2) wanted.set(name.toLowerCase(), name);
    }
    if (wanted.size === 0) return;
    const existing = await this.prisma.jobTitle.findMany({ select: { id: true, name: true } });
    const byName = new Map(existing.map((row) => [row.name.toLowerCase(), row.id]));
    for (const [key, name] of wanted) {
      if (byName.has(key)) continue;
      const created = await this.prisma.jobTitle.create({ data: { tenantId: currentTenantId(), name } });
      byName.set(key, created.id);
    }
    for (const row of untitled) {
      const id = byName.get((row.position ?? '').trim().toLowerCase());
      if (id) await this.prisma.employeeProfile.update({ where: { id: row.id }, data: { jobTitleId: id } });
    }
  }
}
