import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { formatCents, toCents } from '../finance/money';
import { FIRST_SCHEDULE_WAGE_CEILING_CENTS } from '../statutory/employment-act';
import { UpsertPayrollPolicyDto } from './dto/upsert-payroll-policy.dto';
import { clinicRateShortfalls } from './overtime-pricing';
import { clinicRatesOf, resolvePayrollPolicy } from './payroll-policy-resolution';
import { WORKFORCE_CATEGORIES, workforceCategoryOf } from './workforce-category';

/**
 * PAYROLL POLICY — a rule set.
 *
 * Five proration bases, against the audited competitor's four. The fifth is
 * TERMINATION, and its absence there produced a measurable defect: a leaver
 * archived mid-month kept a full month's pay, before and after an explicit
 * recalculation, with nothing on the screen saying so.
 *
 * THE PRORATION BASES ARE RECORDED, NOT YET APPLIED. Whether a given basis is
 * lawful is Employment Act territory (statutory register EA-03), and that is
 * blocked. Storing the shape now means turning proration on is configuration
 * rather than a migration.
 *
 * HOW EXTRA HOURS ARE PRICED IS APPLIED (§6 of the HR restructure). A rule set
 * is STATUTORY — the Act's arithmetic — or CLINIC_RATE, fixed amounts per
 * overtime hour, public-holiday shift, rest-day shift and session. It applies
 * to a workforce category, or to the employees assigned to it by hand, or as
 * the tenant default; `payroll-policy-resolution.ts` is the one place that
 * order lives. For anybody the First Schedule reaches (wages of RM4,000 or
 * less) the Act is a floor: `list()` says in advance who a clinic rate would
 * underpay, and the run blocks the same people on the month's actual days.
 */
const ACTIVE_STATUSES = ['ACTIVE', 'PROBATION', 'NOTICE'] as const;

const categoryLabel = (key: string | null) =>
  key ? (WORKFORCE_CATEGORIES.find((row) => row.key === key)?.label ?? key) : null;

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
    });

    // WHO IS ON WHICH RULE SET — resolved exactly as the run resolves it, so
    // the count here and the rule set a payslip names cannot disagree. The
    // `_count` of hand-assigned employees the old list showed was a different
    // number from "employees this rule set prices", and the second is the one
    // an owner is asking about.
    const employees = await this.prisma.employeeProfile.findMany({
      where: { engagement: 'EMPLOYEE', employmentStatus: { in: [...ACTIVE_STATUSES] } },
      select: {
        staffId: true,
        payrollPolicyId: true,
        legalEmployerId: true,
        staff: { select: { fullName: true, active: true, role: true, professionalType: true } },
      },
    });
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const salaries = await this.prisma.employeeSalary.findMany({
      where: {
        staffId: { in: employees.map((row) => row.staffId) },
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
      },
      select: { staffId: true, amount: true, basis: true },
    });
    const wagesByStaff = new Map(salaries.filter((row) => row.basis === 'MONTHLY').map((row) => [row.staffId, toCents(row.amount)]));

    const onRuleSet = new Map<string, typeof employees>();
    for (const employee of employees) {
      if (!employee.staff.active) continue;
      const { policy } = resolvePayrollPolicy(rows, {
        payrollPolicyId: employee.payrollPolicyId,
        legalEmployerId: employee.legalEmployerId,
        category: workforceCategoryOf(employee.staff),
      });
      if (!policy) continue;
      const list = onRuleSet.get(policy.id) ?? [];
      list.push(employee);
      onRuleSet.set(policy.id, list);
    }

    return {
      policies: rows.map((row) => {
        const covered = onRuleSet.get(row.id) ?? [];
        const rates = clinicRatesOf(row);
        // THE FLOOR, SAID IN ADVANCE. For every employee this rule set prices
        // whose wages the First Schedule reaches, what the clinic rate would
        // pay against what the Act requires — computed from the same function
        // the run's per-day check uses. Nobody within the limit means nothing
        // to hold the rates to, and the screen says so rather than staying
        // quiet.
        const floor = rates
          ? covered.reduce(
              (acc, employee) => {
                const wages = wagesByStaff.get(employee.staffId);
                if (wages === undefined || wages > FIRST_SCHEDULE_WAGE_CEILING_CENTS) return acc;
                acc.assessed += 1;
                const shortfalls = clinicRateShortfalls(rates, wages, Number(row.overtimeHoursPerDay));
                if (shortfalls.length > 0) {
                  acc.below.push({
                    staffId: employee.staffId,
                    name: employee.staff.fullName,
                    wages: formatCents(wages),
                    shortfalls: shortfalls.map((s) => s.sentence),
                  });
                }
                return acc;
              },
              { assessed: 0, below: [] as { staffId: string; name: string; wages: string; shortfalls: string[] }[] },
            )
          : null;
        return {
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
          overtimeMode: row.overtimeMode,
          clinicRates: rates
            ? {
                overtimeHourly: rates.overtimeHourlyCents === null ? null : formatCents(rates.overtimeHourlyCents),
                publicHolidayShift: rates.publicHolidayShiftCents === null ? null : formatCents(rates.publicHolidayShiftCents),
                restDayShift: rates.restDayShiftCents === null ? null : formatCents(rates.restDayShiftCents),
                session: rates.sessionCents === null ? null : formatCents(rates.sessionCents),
              }
            : null,
          workforceCategory: row.workforceCategory,
          appliesTo: row.workforceCategory
            ? categoryLabel(row.workforceCategory)
            : row.isDefault
              ? 'Everyone no other rule set covers'
              : 'Employees assigned by hand',
          isDefault: row.isDefault,
          employeeCount: covered.length,
          employeeNames: covered.map((employee) => employee.staff.fullName).sort(),
          floor,
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
      categories: WORKFORCE_CATEGORIES,
      notice:
        'Overtime, rest-day and public-holiday pay follow the rule set from the next calculation. The proration bases are ' +
        'recorded but NOT yet applied: which basis a Malaysian employer may lawfully use has not been established against ' +
        'the Employment Act, so proration stays unimplemented rather than guessed.',
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

      const overtimeMode = dto.overtimeMode ?? 'STATUTORY';
      const clinic = overtimeMode === 'CLINIC_RATE';
      // Amounts belong to a clinic-rate rule set only. Kept on a statutory one
      // they would be a second answer nobody applies, waiting to be believed.
      const rates = {
        clinicOvertimeHourly: clinic ? (dto.clinicOvertimeHourly ?? null) : null,
        clinicPublicHolidayShift: clinic ? (dto.clinicPublicHolidayShift ?? null) : null,
        clinicRestDayShift: clinic ? (dto.clinicRestDayShift ?? null) : null,
        clinicSessionRate: clinic ? (dto.clinicSessionRate ?? null) : null,
      };
      if (clinic && Object.values(rates).every((value) => value === null)) {
        throw new BadRequestException(
          'A clinic-rate rule set needs at least one amount: per overtime hour, per public holiday shift, per rest day shift or per session.',
        );
      }
      for (const [key, value] of Object.entries(rates)) {
        if (value !== null && toCents(value) <= 0) {
          throw new BadRequestException(`${key.replace('clinic', '')} must be more than zero, or left blank.`);
        }
      }

      const workforceCategory = dto.workforceCategory ?? null;
      const legalEmployerId = dto.legalEmployerId ?? null;
      if (workforceCategory) {
        // One rule set per group. Said in words before the partial index says
        // it as a database error.
        const taken = await tx.payrollPolicy.findFirst({
          where: { workforceCategory, legalEmployerId, ...(dto.id ? { id: { not: dto.id } } : {}) },
        });
        if (taken) {
          throw new ConflictException(
            `"${taken.name}" already applies to ${categoryLabel(workforceCategory)?.toLowerCase()}. One rule set per group: edit that one, or give this one a different group.`,
          );
        }
      }

      const data = {
        name: dto.name,
        legalEmployerId,
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
        overtimeMode,
        ...rates,
        workforceCategory,
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
        reason:
          `${existing ? 'Updated' : 'Created'} payroll policy ${saved.name}: ` +
          (clinic
            ? `clinic rates${[
                rates.clinicOvertimeHourly ? ` RM${rates.clinicOvertimeHourly} an hour` : '',
                rates.clinicPublicHolidayShift ? ` RM${rates.clinicPublicHolidayShift} a public holiday shift` : '',
                rates.clinicRestDayShift ? ` RM${rates.clinicRestDayShift} a rest day shift` : '',
                rates.clinicSessionRate ? ` RM${rates.clinicSessionRate} a session` : '',
              ]
                .filter(Boolean)
                .join(',')}`
            : 'statutory pricing') +
          (workforceCategory ? ` for ${categoryLabel(workforceCategory)?.toLowerCase()}` : ''),
        ...(existing ? { before: existing, after: saved } : { after: saved }),
      });

      return saved;
    });
  }
}
