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
import { toCents, formatCents } from '../finance/money';
import { CreateRecurringItemDto, UpdateRecurringItemDto } from './dto/recurring-item.dto';

/**
 * RECURRING ITEMS — what a pay component carries for one employee every month.
 *
 * `EmployeeRecurringItem` was in the schema with nothing reading or writing
 * it, so a monthly allowance lived nowhere: it was typed into the payroll grid
 * again each month or forgotten. This service is the model's first use. It
 * does not change the model.
 *
 * WHAT AN ITEM IS NOT. It is not a pay component — the component (Allowance,
 * Advance recovery) decides the statutory treatment, and the item only says
 * how much of it this person gets. So the EPF / SOCSO / PCB marks the screen
 * shows beside an item are the COMPONENT'S flags, read from the catalogue,
 * never stored on the item: change the catalogue and every item follows.
 *
 * WHAT IT REFUSES. A component the calculation derives itself (basic pay,
 * overtime, the monthly tax deduction, unpaid leave, a claim reimbursement)
 * cannot be a recurring item: a month with a typed "overtime" line beside the
 * computed one is a payslip nobody can reconcile. And, as with a salary, a
 * change dated into a month whose payroll is already approved is refused,
 * because what was paid is settled.
 */
const DERIVED_BY_THE_RUN = new Set(['BASIC', 'OVERTIME', 'PCB', 'UNPAID_LEAVE', 'CLAIM_REIMBURSEMENT']);

const day = (value: string) => {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${value} is not a YYYY-MM-DD date.`);
  return parsed;
};
const iso = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const monthStart = (value: Date) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));

@Injectable()
export class EmployeeRecurringItemService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** The open version of every component, by code — what an item's code means today. */
  private async catalogue() {
    const rows = await this.prisma.payComponent.findMany({ where: { effectiveTo: null } });
    return new Map(rows.map((row) => [row.code, row]));
  }

  async list(staffId: string) {
    // An amount is pay. The same permission the salary history sits behind.
    await requirePermission(this.rawPrisma, 'hr.salary.view');
    const [rows, catalogue] = await Promise.all([
      this.prisma.employeeRecurringItem.findMany({
        where: { staffId },
        // Oldest first, as the mockup reads: what has been paid longest at the top.
        orderBy: [{ effectiveFrom: 'asc' }],
        include: { createdBy: { select: { fullName: true } } },
      }),
      this.catalogue(),
    ]);
    const today = new Date();
    return rows.map((row) => {
      const component = catalogue.get(row.componentCode) ?? null;
      const from = row.effectiveFrom;
      const to = row.effectiveTo;
      const status = from > today ? 'UPCOMING' : to !== null && to < today ? 'ENDED' : 'ACTIVE';
      return {
        id: row.id,
        componentCode: row.componentCode,
        componentName: component?.name ?? row.componentCode,
        /** Which way the money goes. NULL when the code is no longer in the catalogue. */
        direction: component ? (component.type === 'DEDUCTION' ? 'DEDUCTION' : 'ADDITION') : null,
        label: row.label,
        amount: formatCents(toCents(row.amount)),
        effectiveFrom: iso(from)!,
        effectiveTo: iso(to),
        status,
        note: row.note,
        recordedBy: row.createdBy.fullName,
        recordedAt: row.createdAt.toISOString(),
        /** The COMPONENT'S treatment, read from the catalogue — not a property of the item. */
        treatment: component
          ? { epf: component.epfLiable, socso: component.socsoLiable, pcb: component.pcbLiable, active: component.active }
          : null,
      };
    });
  }

  /** The components an item may be made of: everything in the catalogue the run does not derive itself. */
  async choices() {
    await requirePermission(this.rawPrisma, 'hr.view');
    const catalogue = await this.catalogue();
    return [...catalogue.values()]
      .filter((row) => row.active && !DERIVED_BY_THE_RUN.has(row.code))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'DEDUCTION' ? 1 : -1))
      .map((row) => ({
        code: row.code,
        name: row.name,
        direction: row.type === 'DEDUCTION' ? 'DEDUCTION' : 'ADDITION',
        treatment: { epf: row.epfLiable, socso: row.socsoLiable, pcb: row.pcbLiable },
      }));
  }

  async create(staffId: string, dto: CreateRecurringItemDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      // Pay-bearing, like a salary: the record permission alone is not enough.
      if (!actorCan(actor, 'hr.payroll.view')) {
        throw new ForbiddenException(
          'Adding a recurring item needs payroll access, not employee-record access alone. Ask somebody who can view payroll to add it.',
        );
      }
      const profile = await tx.employeeProfile.findFirst({ where: { staffId } });
      if (!profile) throw new NotFoundException('Employee not found');

      const component = await tx.payComponent.findFirst({ where: { code: dto.componentCode, effectiveTo: null } });
      if (!component) throw new BadRequestException(`"${dto.componentCode}" is not a pay item in this clinic's catalogue.`);
      if (!component.active) throw new BadRequestException(`"${component.name}" is switched off in Payroll items.`);
      if (DERIVED_BY_THE_RUN.has(component.code)) {
        throw new BadRequestException(
          `${component.name} is worked out by the payroll run from the records; it cannot be a recurring item.`,
        );
      }

      const from = day(dto.effectiveFrom);
      const to = dto.effectiveTo ? day(dto.effectiveTo) : null;
      if (to && to < from) throw new BadRequestException('The end date is before the start date.');
      if (toCents(dto.amount) <= 0) throw new BadRequestException('The amount must be more than zero.');

      // ONE ITEM PER COMPONENT PER START DATE — the model's own key. Two
      // allowances that start on the same day need different start dates;
      // said here in words rather than as a database error.
      const clash = await tx.employeeRecurringItem.findFirst({
        where: { staffId, componentCode: component.code, effectiveFrom: from },
      });
      if (clash) {
        throw new ConflictException(
          `A ${component.name} item already starts on ${dto.effectiveFrom} for this employee` +
            `${clash.label ? ` (${clash.label})` : ''}. Give this one a different start date, or edit that one.`,
        );
      }

      const approvedCovering = await tx.payrollRun.count({
        where: { status: { in: ['APPROVED', 'PAID'] }, period: { gte: monthStart(from) }, lines: { some: { staffId } } },
      });
      if (approvedCovering > 0) {
        throw new ConflictException(
          `${approvedCovering} approved payroll run(s) cover ${dto.effectiveFrom} or later for this employee. ` +
            'What they were paid is settled; start the item from a month that has not been approved.',
        );
      }

      const saved = await tx.employeeRecurringItem.create({
        data: {
          tenantId: currentTenantId(),
          staffId,
          componentCode: component.code,
          label: dto.label?.trim() || null,
          amount: dto.amount,
          effectiveFrom: from,
          effectiveTo: to,
          note: dto.note?.trim() || null,
          createdByStaffId: actor.id,
        },
      });
      await recordAudit(tx, actor, {
        action: 'employeeRecurringItem.created',
        entityType: 'EmployeeRecurringItem',
        entityId: saved.id,
        reason: `${component.name}${dto.label ? ` (${dto.label})` : ''} ${formatCents(toCents(dto.amount))} from ${dto.effectiveFrom}${dto.effectiveTo ? ` to ${dto.effectiveTo}` : ''}`,
        after: { componentCode: component.code, label: saved.label, amount: dto.amount, effectiveFrom: dto.effectiveFrom, effectiveTo: dto.effectiveTo ?? null },
      });
      return saved;
    });
  }

  /**
   * Edit an item. The amount may change only while no approved run has paid
   * it: after that, the paid months are settled, so the item is ended and a
   * new one added from the month that changes. Ending an item is always
   * allowed from any month not yet approved.
   */
  async update(staffId: string, id: string, dto: UpdateRecurringItemDto) {
    return withAdminTx(this.rawPrisma, 'hr.employee.manage', async (tx, actor) => {
      if (!actorCan(actor, 'hr.payroll.view')) {
        throw new ForbiddenException('Changing a recurring item needs payroll access, not employee-record access alone.');
      }
      const existing = await tx.employeeRecurringItem.findFirst({ where: { id, staffId } });
      if (!existing) throw new NotFoundException('Recurring item not found');

      const paidMonths = await tx.payrollRun.count({
        where: { status: { in: ['APPROVED', 'PAID'] }, period: { gte: monthStart(existing.effectiveFrom) }, lines: { some: { staffId } } },
      });

      const data: { label?: string | null; amount?: string; effectiveTo?: Date | null; note?: string | null } = {};
      if (dto.label !== undefined) data.label = dto.label.trim() || null;
      if (dto.note !== undefined) data.note = dto.note.trim() || null;
      if (dto.amount !== undefined && dto.amount !== formatCents(toCents(existing.amount))) {
        if (toCents(dto.amount) <= 0) throw new BadRequestException('The amount must be more than zero.');
        if (paidMonths > 0) {
          throw new ConflictException(
            `${paidMonths} approved payroll run(s) have paid this item. What was paid is settled: end this item and add a new one from the month the amount changes.`,
          );
        }
        data.amount = dto.amount;
      }
      if (dto.effectiveTo !== undefined) {
        const to = dto.effectiveTo === null ? null : day(dto.effectiveTo);
        if (to && to < existing.effectiveFrom) throw new BadRequestException('The end date is before the start date.');
        if (to) {
          // Ending an item inside a month already paid would take back money
          // that has gone out; the end date has to be a month not yet approved.
          const paidAfter = await tx.payrollRun.count({
            where: { status: { in: ['APPROVED', 'PAID'] }, period: { gt: monthStart(to) }, lines: { some: { staffId } } },
          });
          if (paidAfter > 0) {
            throw new ConflictException(
              `${paidAfter} approved payroll run(s) after ${dto.effectiveTo} have already paid this item. End it from a month that has not been approved.`,
            );
          }
        }
        data.effectiveTo = to;
      }
      if (Object.keys(data).length === 0) return existing;

      const saved = await tx.employeeRecurringItem.update({ where: { id: existing.id }, data });
      await recordAudit(tx, actor, {
        action: data.effectiveTo !== undefined && data.effectiveTo !== null && Object.keys(data).length === 1 ? 'employeeRecurringItem.ended' : 'employeeRecurringItem.updated',
        entityType: 'EmployeeRecurringItem',
        entityId: saved.id,
        reason: `${existing.componentCode}${existing.label ? ` (${existing.label})` : ''}: ${Object.keys(data).join(', ')} changed`,
        before: { label: existing.label, amount: formatCents(toCents(existing.amount)), effectiveTo: iso(existing.effectiveTo), note: existing.note },
        after: { label: saved.label, amount: formatCents(toCents(saved.amount)), effectiveTo: iso(saved.effectiveTo), note: saved.note },
      });
      return saved;
    });
  }
}
