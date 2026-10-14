import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { actorCan, requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { toCents, fromCents, formatCents } from '../finance/money';
import { resolveSalaryForPeriod, SalaryRow } from './salary-resolution';
import { ParityInput, ParityReport, salaryParity } from './salary-parity';
import { CorrectSalaryDto, DeleteSalaryDto, RecordSalaryDto } from './dto/record-salary.dto';
import type { AdminTx } from '../finance/admin-actor';
import type { ActingStaff } from '../clinical/clinical-actor';

/** Inclusive first and last day of the month a date falls in, in UTC. */
function monthBounds(period: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth(), 1));
  const end = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 0));
  return { start, end };
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const monthName = (date: Date) => date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * A ROW MAY BE CORRECTED OR DELETED ONLY WHILE NO APPROVED MONTH IT PAYS
 * (UAT, 14 October 2026; the same rule as payroll items and HRD): a month
 * this employee was paid in, approved, from the row's first month to its
 * last. Refused, naming every such month; nothing is changed.
 */
async function refuseOverApproved(tx: AdminTx, staffId: string, from: Date, to: Date | null) {
  const runs = await tx.payrollRun.findMany({
    where: {
      status: { in: ['APPROVED', 'PAID'] },
      period: { gte: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)), ...(to ? { lte: to } : {}) },
      lines: { some: { staffId } },
    },
    select: { period: true },
    orderBy: { period: 'asc' },
  });
  if (runs.length === 0) return;
  const named = [...new Set(runs.map((run) => monthName(run.period)))];
  const one = named.length === 1;
  throw new ConflictException(
    `${named.join(', ')} ${one ? 'is' : 'are'} approved for this employee and paid from this salary row. Nothing was changed. ` +
      `Reopen ${one ? 'that month' : 'those months, latest first,'} and then correct the row.`,
  );
}

function requireReason(reason: string | undefined): string {
  const said = (reason ?? '').trim();
  if (!said) throw new BadRequestException('Say why: the reason is kept with the change.');
  return said;
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
   * THE CUTOVER PARITY REPORT.
   *
   * Payroll reads `employee_salaries` now. This says, for a given period,
   * whether that changes what anybody is paid compared with the legacy
   * `EmployeeProfile.basicSalary` column — and names every employee it would.
   *
   * It repairs nothing. An automatic reconciliation would be a silent salary
   * change, which is what the effective-dated table exists to prevent.
   */
  async parity(period: Date | string): Promise<ParityReport> {
    await requirePermission(this.rawPrisma, 'hr.salary.view');
    const asDate = period instanceof Date ? period : new Date(`${period}T00:00:00.000Z`);
    if (Number.isNaN(asDate.getTime())) throw new BadRequestException('period must be a YYYY-MM-DD date.');
    const { start, end } = monthBounds(asDate);

    const employees = await this.prisma.employeeProfile.findMany({
      where: { employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] } },
      include: { staff: { select: { fullName: true, active: true } } },
      orderBy: { staffId: 'asc' },
    });
    const active = employees.filter((e) => e.staff.active);
    const rows = await this.prisma.employeeSalary.findMany({
      where: { staffId: { in: active.map((e) => e.staffId) } },
      orderBy: { effectiveFrom: 'asc' },
    });

    const byStaff = new Map<string, SalaryRow[]>();
    for (const row of rows) {
      const list = byStaff.get(row.staffId) ?? [];
      list.push({
        id: row.id,
        basis: row.basis,
        amountCents: toCents(row.amount),
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
      });
      byStaff.set(row.staffId, list);
    }

    const inputs: ParityInput[] = active.map((e) => ({
      staffId: e.staffId,
      name: e.staff.fullName,
      legacyCents: e.basicSalary === null ? null : toCents(e.basicSalary),
      salaryRows: byStaff.get(e.staffId) ?? [],
    }));

    const report = salaryParity(inputs, start, end);
    return {
      ...report,
      lines: report.lines.map((line) => ({
        ...line,
        // Money reaches the UI as a formatted string everywhere else in this
        // module; cents on the wire would be the one exception.
        legacyCents: line.legacyCents,
        canonicalCents: line.canonicalCents,
      })),
    };
  }

  /** The row, of this employee, or 404; and the payroll access recording a salary needs. */
  private async rowFor(tx: AdminTx, actor: ActingStaff, staffId: string, id: string) {
    if (!actorCan(actor, 'hr.payroll.view')) {
      throw new ForbiddenException('Changing a salary needs payroll access, not employee-record access alone.');
    }
    const row = await tx.employeeSalary.findFirst({ where: { id, staffId } });
    if (!row) throw new NotFoundException('That salary row is not on record for this employee.');
    return row;
  }

  /**
   * "CORRECT" (UAT, 14 October 2026): a keying error in a row's amount or
   * basis. Its dates stay; every month it covers is paid the corrected figure.
   */
  async correct(staffId: string, id: string, dto: CorrectSalaryDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const reason = requireReason(dto.reason);
      const row = await this.rowFor(tx, actor, staffId, id);
      const basis = dto.basis ?? row.basis;
      const before = { amount: formatCents(toCents(row.amount)), basis: row.basis };
      const after = { amount: formatCents(toCents(dto.amount)), basis };
      if (before.amount === after.amount && before.basis === after.basis) {
        throw new BadRequestException('That is the figure already on record. Nothing to correct.');
      }
      await refuseOverApproved(tx, staffId, row.effectiveFrom, row.effectiveTo);
      // The correction's reason goes on the row, so the Reason column says it (UAT, 15 October 2026).
      const saved = await tx.employeeSalary.update({
        where: { id },
        data: { amount: dto.amount, basis, reason: withCorrection(row.reason, `Corrected: ${reason}`) },
      });
      await recordAudit(tx, actor, {
        action: 'employeeSalary.corrected',
        entityType: 'EmployeeSalary',
        entityId: id,
        reason: `Corrected the salary from ${isoDay(row.effectiveFrom)}: ${reason}`,
        before: { ...before, effectiveFrom: isoDay(row.effectiveFrom) },
        after: { ...after, effectiveFrom: isoDay(row.effectiveFrom) },
      });
      return saved;
    });
  }

  /**
   * "DELETE" (UAT, 14 October 2026): a row added by mistake. The row before
   * it runs on over the deleted row's dates, so it closes where the deleted
   * row closed, or stays open.
   */
  async remove(staffId: string, id: string, dto: DeleteSalaryDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      const reason = requireReason(dto.reason);
      const row = await this.rowFor(tx, actor, staffId, id);
      await refuseOverApproved(tx, staffId, row.effectiveFrom, row.effectiveTo);
      const previous = await tx.employeeSalary.findFirst({
        where: { staffId, effectiveFrom: { lt: row.effectiveFrom } },
        orderBy: { effectiveFrom: 'desc' },
      });
      await tx.employeeSalary.delete({ where: { id } });
      if (previous) {
        // The row that runs on says why it now does (UAT, 15 October 2026).
        await tx.employeeSalary.update({
          where: { id: previous.id },
          data: {
            effectiveTo: row.effectiveTo,
            reason: withCorrection(previous.reason, `The row from ${isoDay(row.effectiveFrom)} was deleted: ${reason}`),
          },
        });
      }
      await recordAudit(tx, actor, {
        action: 'employeeSalary.deleted',
        entityType: 'EmployeeSalary',
        entityId: id,
        reason: `Deleted the salary from ${isoDay(row.effectiveFrom)}: ${reason}`,
        before: {
          amount: formatCents(toCents(row.amount)),
          basis: row.basis,
          effectiveFrom: isoDay(row.effectiveFrom),
          effectiveTo: row.effectiveTo ? isoDay(row.effectiveTo) : null,
          reason: row.reason,
        },
        after: previous
          ? {
              runsOn: { amount: formatCents(toCents(previous.amount)), basis: previous.basis, effectiveFrom: isoDay(previous.effectiveFrom) },
              effectiveTo: row.effectiveTo ? isoDay(row.effectiveTo) : null,
            }
          : null,
      });
      return { deleted: id, runsOn: previous?.id ?? null };
    });
  }

  /**
   * Record a salary from a date.
   *
   * Closes the open row rather than editing it: a raise is a NEW fact, and the
   * old rate remains true of the months it was true of.
   */
  async record(staffId: string, dto: RecordSalaryDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      // Setting a salary is pay-bearing, exactly as editing the bank account
      // is on the employee form — and it carried no second check, so the
      // legacy HR-clerk role (which this module's own header says must not
      // READ pay) could WRITE anybody's, and the next run would pay it. Same
      // rule as the bank field: `hr.employee.manage` says who maintains
      // employee records, `hr.payroll.view` says who may touch the money.
      if (!actorCan(actor, 'hr.payroll.view')) {
        throw new ForbiddenException(
          'Recording a salary needs payroll access, not employee-record access alone. Ask somebody who can view payroll to record it.',
        );
      }
      const profile = await tx.employeeProfile.findFirst({ where: { staffId } });
      if (!profile) throw new NotFoundException('Employee not found');

      const from = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);
      if (Number.isNaN(from.getTime())) throw new BadRequestException('effectiveFrom must be a YYYY-MM-DD date.');

      const amountCents = toCents(dto.amount);
      if (amountCents < 0) throw new BadRequestException('A salary cannot be negative.');

      const clash = await tx.employeeSalary.findFirst({ where: { staffId, effectiveFrom: from } });
      if (clash) {
        throw new ConflictException(
          `A salary already starts on ${dto.effectiveFrom} for this employee. Use Correct on that row rather than adding a second one for the same day.`,
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

/** The row's own reason, then what changed it. */
function withCorrection(original: string | null, correction: string): string {
  return original ? `${original}. ${correction}` : correction;
}
