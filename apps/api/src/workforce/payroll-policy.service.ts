import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { UpsertPayrollPolicyDto } from './dto/upsert-payroll-policy.dto';

/**
 * PRORATION POLICY.
 *
 * Five independent bases, against the audited competitor's four. The fifth is
 * TERMINATION, and its absence there produced a measurable defect: a leaver
 * archived mid-month kept a full month's pay, before and after an explicit
 * recalculation, with nothing on the screen saying so.
 *
 * NOTHING APPLIES THESE YET. Whether a given basis is lawful is Employment Act
 * territory (statutory register EA-03), and that is blocked. Storing the shape
 * now means Stage 3 turns proration on with configuration rather than a
 * migration.
 */
@Injectable()
export class PayrollPolicyService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async list() {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const rows = await this.prisma.payrollPolicy.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { employees: true } } },
    });
    return {
      policies: rows.map((row) => ({
        id: row.id,
        name: row.name,
        legalEmployerId: row.legalEmployerId,
        salaryProration: { basis: row.salaryProrationBasis, days: row.salaryProrationDays },
        overtime: {
          basis: row.overtimeBasis,
          days: row.overtimeDays,
          hoursPerDay: Number(row.overtimeHoursPerDay),
        },
        unpaidLeave: { basis: row.unpaidLeaveBasis, days: row.unpaidLeaveDays },
        leavePay: { basis: row.leavePayBasis, days: row.leavePayDays },
        termination: { basis: row.terminationBasis, days: row.terminationDays },
        isDefault: row.isDefault,
        employeeCount: row._count.employees,
        updatedAt: row.updatedAt.toISOString(),
      })),
      notice:
        'These bases are recorded but NOT yet applied by any calculation. Which basis a Malaysian employer may lawfully use ' +
        'has not been established against the Employment Act, so proration remains unimplemented rather than guessed.',
    };
  }

  async upsert(dto: UpsertPayrollPolicyDto) {
    return withAdminTx(this.rawPrisma, 'hr.statutory.manage', async (tx, actor) => {
      const existing = dto.id ? await tx.payrollPolicy.findFirst({ where: { id: dto.id } }) : null;
      if (dto.id && !existing) throw new NotFoundException('Payroll policy not found');

      const clash = await tx.payrollPolicy.findFirst({
        where: { name: dto.name, ...(dto.id ? { id: { not: dto.id } } : {}) },
      });
      if (clash) throw new ConflictException(`A payroll policy called "${dto.name}" already exists.`);

      const data = {
        name: dto.name,
        legalEmployerId: dto.legalEmployerId ?? null,
        salaryProrationBasis: dto.salaryProrationBasis ?? 'CALENDAR_DAYS',
        salaryProrationDays: dto.salaryProrationDays ?? 26,
        overtimeBasis: dto.overtimeBasis ?? 'FIXED_DAYS',
        overtimeDays: dto.overtimeDays ?? 26,
        overtimeHoursPerDay: dto.overtimeHoursPerDay ?? 7.5,
        unpaidLeaveBasis: dto.unpaidLeaveBasis ?? 'CALENDAR_DAYS',
        unpaidLeaveDays: dto.unpaidLeaveDays ?? 31,
        leavePayBasis: dto.leavePayBasis ?? 'FIXED_DAYS',
        leavePayDays: dto.leavePayDays ?? 26,
        terminationBasis: dto.terminationBasis ?? 'CALENDAR_DAYS',
        terminationDays: dto.terminationDays ?? 31,
        isDefault: dto.isDefault ?? false,
      };

      if (data.isDefault) {
        await tx.payrollPolicy.updateMany({
          where: { isDefault: true, ...(existing ? { id: { not: existing.id } } : {}) },
          data: { isDefault: false },
        });
      }

      const saved = existing
        ? await tx.payrollPolicy.update({ where: { id: existing.id }, data })
        : await tx.payrollPolicy.create({ data: { ...data, tenantId: currentTenantId() } });

      await recordAudit(tx, actor, {
        action: existing ? 'payrollPolicy.updated' : 'payrollPolicy.created',
        entityType: 'PayrollPolicy',
        entityId: saved.id,
        reason: `${existing ? 'Updated' : 'Created'} payroll policy ${saved.name}`,
        ...(existing ? { before: existing, after: saved } : { after: saved }),
      });

      return saved;
    });
  }
}
