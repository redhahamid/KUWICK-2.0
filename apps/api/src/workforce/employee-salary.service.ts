import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { toCents, fromCents, formatCents } from '../finance/money';
import { resolveSalaryForPeriod, SalaryRow } from './salary-resolution';
import { RecordSalaryDto } from './dto/record-salary.dto';

/** Inclusive first and last day of the month a date falls in, in UTC. */
function monthBounds(period: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth(), 1));
  const end = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0));
  return { start, end };
}

/**
 * SALARY, WITH A DATE ON IT.
 *
 * Reading salary is `hr.salary.view`, not `hr.payroll.view`. Those were one
 * permission, so anyone allowed to see that a payroll run existed could also
 * see what every colleague earned.
 */
@Injectable()
export class EmployeeSalaryService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async history(staffId: string) {
    await requirePermission(this.rawPrisma, 'hr.salary.view');
    const rows = await this.prisma.employeeSalary.findMany({
      where: { staffId },
      orderBy: { effectiveFrom: 'desc' },
      include: { createdBy: { select: { fullName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      basis: row.basis,
      // Always two decimals: Decimal.toString() renders 300.00 as "300".
      amount: formatCents(toCents(row.amount)),
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString().slice(0, 10) : null,
      reason: row.reason,
      note: row.note,
      recordedBy: row.createdBy.fullName,
      recordedAt: row.createdAt.toISOString(),
      current: !row.effectiveTo,
    }));
  }

  /** What a given period would resolve to, and why. Used by the run and the UI. */
  async resolveForPeriod(staffId: string, period: Date | string) {
    await requirePermission(this.rawPrisma, 'hr.salary.view');
    const rows = await this.prisma.employeeSalary.findMany({ where: { staffId } });
    const asDate = period instanceof Date ? period : new Date(`${period}T00:00:00.000Z`);
    if (Number.isNaN(asDate.getTime())) throw new BadRequestException('period must be a YYYY-MM-DD date.');
    const { start, end } = monthBounds(asDate);
    const resolution = resolveSalaryForPeriod(
      rows.map<SalaryRow>((r) => ({
        id: r.id,
        basis: r.basis,
        amountCents: toCents(r.amount),
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
      })),
      start,
      end,
    );
    return {
      period: start.toISOString().slice(0, 10),
      amount: resolution.row ? formatCents(resolution.row.amountCents) : null,
      basis: resolution.row?.basis ?? null,
      salaryRowId: resolution.row?.id ?? null,
      changedDuringPeriod: resolution.changedDuringPeriod,
      overlappingCount: resolution.overlapping.length,
      reason: resolution.reason,
    };
  }

  /**
   * Record a salary from a date.
   *
   * Closes the open row rather than editing it: a raise is a NEW fact, and the
   * old rate remains true of the months it was true of.
   */
  async record(staffId: string, dto: RecordSalaryDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const profile = await tx.employeeProfile.findFirst({ where: { staffId } });
      if (!profile) throw new NotFoundException('Employee not found');

      const from = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);
      if (Number.isNaN(from.getTime())) throw new BadRequestException('effectiveFrom must be a YYYY-MM-DD date.');

      const amountCents = toCents(dto.amount);
      if (amountCents < 0) throw new BadRequestException('A salary cannot be negative.');

      const clash = await tx.employeeSalary.findFirst({ where: { staffId, effectiveFrom: from } });
      if (clash) {
        throw new ConflictException(
          `A salary already starts on ${dto.effectiveFrom} for this employee. Correct that row rather than adding a second one for the same day.`,
        );
      }

      // A salary change inside an already-approved period would make the
      // approved run and the record disagree. The snapshot protects what was
      // approved, but the disagreement is still worth refusing.
      const approvedCovering = await tx.payrollRun.count({
        where: {
          status: { in: ['APPROVED', 'PAID'] },
          period: { gte: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)) },
          lines: { some: { staffId } },
        },
      });
      if (approvedCovering > 0) {
        throw new ConflictException(
          `${approvedCovering} approved payroll run(s) cover this date or later for this employee. ` +
            'What they were paid is settled. Record the change from a period that has not been approved, or reopen the run and correct it deliberately.',
        );
      }

      const open = await tx.employeeSalary.findFirst({
        where: { staffId, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (open) {
        if (open.effectiveFrom >= from) {
          throw new BadRequestException(
            `The current salary starts on ${open.effectiveFrom.toISOString().slice(0, 10)}, which is not before ${dto.effectiveFrom}.`,
          );
        }
        const dayBefore = new Date(from.getTime() - 86400000);
        await tx.employeeSalary.update({ where: { id: open.id }, data: { effectiveTo: dayBefore } });
      }

      const saved = await tx.employeeSalary.create({
        data: {
          tenantId: currentTenantId(),
          staffId,
          basis: dto.basis ?? 'MONTHLY',
          amount: dto.amount,
          effectiveFrom: from,
          reason: dto.reason ?? null,
          note: dto.note ?? null,
          createdByStaffId: actor.id,
        },
      });

      await recordAudit(tx, actor, {
        action: 'employeeSalary.recorded',
        entityType: 'EmployeeSalary',
        entityId: saved.id,
        reason: `Recorded ${dto.basis ?? 'MONTHLY'} salary from ${dto.effectiveFrom}`,
        before: open ? { amount: formatCents(toCents(open.amount)), effectiveTo: null } : null,
        after: { amount: formatCents(toCents(saved.amount)), effectiveFrom: dto.effectiveFrom },
      });

      return saved;
    });
  }
}
