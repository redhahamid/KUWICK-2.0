import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { formatCents, toCents } from '../finance/money';
import {
  ACT_OVERTIME_MULTIPLIERS,
  belowActMultiplier,
  BelowActMultiplier,
  FIRST_SCHEDULE_WAGE_CEILING_CENTS,
  OVERTIME_MULTIPLIER_FLOORS,
  overtimeMultiplierRefusal,
} from '../statutory/employment-act';
import { UpsertPayrollPolicyDto } from './dto/upsert-payroll-policy.dto';
import { clinicRateShortfalls } from './overtime-pricing';
import { clinicRatesOf, multipliersOf, resolvePayrollPolicy } from './payroll-policy-resolution';
import { WORKFORCE_CATEGORIES, workforceCategoryOf } from './workforce-category';

/**
 * PAYROLL POLICY — a rule set.
 *
 * THERE WERE FIVE PRORATION BASES AND NOW THERE IS ONE, because the Employment
 * Act had already answered the other four. A part month is monthly wages over
 * the ACTUAL days in it (ss.18A and 60I(1)(c)); a day of unpaid leave is the
 * same arithmetic, named expressly in s.18A; the ordinary-rate divisor is fixed
 * at 26 by s.60I(1A) and may only be bettered; and paid leave is not valued
 * apart from salary at all. Four settings a clinic could type into, none of
 * which any calculation read, each inviting an answer the law does not permit.
 *
 * TERMINATION IS THE ONE THAT SURVIVES, and it is the one the audited
 * competitor lacked: a leaver archived mid-month kept a full month's pay there,
 * before and after an explicit recalculation, with nothing on the screen saying
 * so. It is still RECORDED, NOT APPLIED — the final settlement is a feature to
 * build, and until it exists this is the clinic's answer waiting for it.
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
      include: { belowActAcknowledgedBy: { select: { fullName: true } } },
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

    /** Covered employees the First Schedule reaches — the ones a minimum protects. */
    const protectedOf = (covered: typeof employees) =>
      covered.filter((employee) => {
        const wages = wagesByStaff.get(employee.staffId);
        return wages !== undefined && wages <= FIRST_SCHEDULE_WAGE_CEILING_CENTS;
      }).length;

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

    // Hand assignments across every employment status: somebody who left is
    // still on the rule set's books, and deleting it would silently unassign them.
    const handAssigned = new Map(
      (
        await this.prisma.employeeProfile.groupBy({
          by: ['payrollPolicyId'],
          where: { payrollPolicyId: { not: null } },
          _count: { _all: true },
        })
      ).map((row) => [row.payrollPolicyId as string, row._count._all]),
    );

    return {
      policies: rows.map((row) => {
        const covered = onRuleSet.get(row.id) ?? [];
        const assigned = handAssigned.get(row.id) ?? 0;
        const removalBlockedBy = row.isDefault
          ? 'It is the default rule set.'
          : covered.length > 0
            ? `It prices ${covered.length} ${covered.length === 1 ? 'employee' : 'employees'} today.`
            : assigned > 0
              ? `${assigned} ${assigned === 1 ? 'employee is' : 'employees are'} assigned to it by hand.`
              : null;
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
          overtime: { days: row.overtimeDays, hoursPerDay: Number(row.overtimeHoursPerDay) },
          /** How this rule set estimates the rest of the year for monthly tax. */
          pcbProjectionBasis: row.pcbProjectionBasis,
          termination: { basis: row.terminationBasis, days: row.terminationDays },
          overtimeMode: row.overtimeMode,
          // WHAT THE HOURS ARE PRICED AT, and whether the clinic chose it. The
          // screen needs both: the figure in force, and whether it is the
          // clinic's own or the Act's showing through an empty box.
          multipliers: (() => {
            const used = multipliersOf(row);
            return {
              overtime: { used: used.normalDay, act: ACT_OVERTIME_MULTIPLIERS.normalDay, set: row.overtimeMultiplier !== null },
              restDay: { used: used.restDayExcess, act: ACT_OVERTIME_MULTIPLIERS.restDayExcess, set: row.restDayMultiplier !== null },
              publicHoliday: {
                used: used.publicHolidayExcess,
                act: ACT_OVERTIME_MULTIPLIERS.publicHolidayExcess,
                set: row.publicHolidayMultiplier !== null,
              },
              // Blank follows the public holiday figure, so "used" is that figure until the clinic sets its own.
              festiveHoliday: {
                used: used.festiveHolidayExcess ?? used.publicHolidayExcess,
                act: ACT_OVERTIME_MULTIPLIERS.publicHolidayExcess,
                set: row.festiveHolidayMultiplier !== null,
              },
            };
          })(),
          /*
           * THE PERMANENT MARK. Everything about this rule set that is under
           * the Act, and who said so.
           *
           * Null when the rule set is at or above the Act, which is what makes
           * a non-null value worth a chip on the row: somebody opening this
           * screen in a year sees the choice without having to know it was
           * ever made.
           *
           * `protectedCount` is how many covered employees the First Schedule
           * reaches TODAY. Zero is a real answer and is shown as one — the
           * Act's minimums bind nobody on this rule set right now, and the
           * moment somebody on RM4,000 or less joins it they do.
           */
          /*
           * COVERED EMPLOYEES THE FIRST SCHEDULE REACHES, always published.
           *
           * Not folded into `belowAct` below, because the screen needs it most
           * on a rule set that is currently ABOVE the Act — that is where
           * somebody is about to lower a figure and has to be told who it
           * lands on. Zero is a real answer.
           */
          protectedCount: protectedOf(covered),
          belowAct: (() => {
            const multipliers = OVERTIME_MULTIPLIER_FLOORS.map((floor) => {
              const value = row[floor.field as 'overtimeMultiplier'];
              return value === null ? null : belowActMultiplier(floor.field, Number(value));
            }).filter((entry): entry is BelowActMultiplier => entry !== null);
            const underpaid = floor?.below ?? [];
            if (multipliers.length === 0 && underpaid.length === 0) return null;
            return {
              multipliers,
              rates: underpaid,
              acknowledgement: row.belowActAcknowledgedAt
                ? {
                    at: row.belowActAcknowledgedAt.toISOString(),
                    by: row.belowActAcknowledgedBy?.fullName ?? null,
                    reason: row.belowActReason,
                  }
                : null,
            };
          })(),
          clinicRates: rates
            ? {
                overtimeHourly: rates.overtimeHourlyCents === null ? null : formatCents(rates.overtimeHourlyCents),
                publicHolidayShift: rates.publicHolidayShiftCents === null ? null : formatCents(rates.publicHolidayShiftCents),
                festiveHolidayShift: rates.festiveHolidayShiftCents == null ? null : formatCents(rates.festiveHolidayShiftCents),
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
          /**
           * WHETHER IT CAN GO: not the default, prices nobody, nobody assigned.
           * A payslip line that names it still refuses at delete — that check
           * reads every line and is made once, when somebody asks.
           */
          removable: removalBlockedBy === null,
          removalBlockedBy,
          floor,
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
      categories: WORKFORCE_CATEGORIES,
      notice:
        'Overtime, rest-day and public-holiday pay follow the rule set from the next calculation. A part month, a day of ' +
        'unpaid leave and the ordinary rate are set by the Employment Act and are not the clinic’s to choose — the ' +
        'settings that offered that choice have been removed. The termination basis is recorded and not yet applied: the ' +
        'final settlement is not built.',
    };
  }

  /**
   * The highest wage within the First Schedule that this rule set would price
   * once saved, or null when it would price nobody the Act reaches.
   *
   * Highest rather than lowest because the Act's own figures are proportional
   * to the wage: a fixed clinic amount clears a small salary and fails a large
   * one, so the largest protected wage is the first to be underpaid and the
   * one worth asking about.
   */
  private async highestProtectedWage(
    tx: Prisma.TransactionClient,
    dto: UpsertPayrollPolicyDto,
  ): Promise<number | null> {
    const employees = await tx.employeeProfile.findMany({
      where: { engagement: 'EMPLOYEE', employmentStatus: { in: [...ACTIVE_STATUSES] } },
      select: {
        staffId: true,
        payrollPolicyId: true,
        legalEmployerId: true,
        staff: { select: { active: true, role: true, professionalType: true } },
      },
    });
    const active = employees.filter((row) => row.staff.active);
    if (active.length === 0) return null;

    // Resolved against the rule sets as they WILL be, so a rule set being
    // pointed at a new group is judged on the group it is about to price.
    const stored = await tx.payrollPolicy.findMany();
    const prospective = [
      ...stored.filter((row) => row.id !== dto.id),
      {
        ...(stored.find((row) => row.id === dto.id) ?? stored[0] ?? {}),
        id: dto.id ?? '__new',
        name: dto.name,
        isDefault: dto.isDefault ?? false,
        legalEmployerId: dto.legalEmployerId ?? null,
        workforceCategory: dto.workforceCategory ?? null,
        overtimeMode: 'CLINIC_RATE' as const,
      },
    ] as Parameters<typeof resolvePayrollPolicy>[0];

    const mine = active.filter(
      (employee) =>
        resolvePayrollPolicy(prospective, {
          payrollPolicyId: employee.payrollPolicyId,
          legalEmployerId: employee.legalEmployerId,
          category: workforceCategoryOf(employee.staff),
        }).policy?.id === (dto.id ?? '__new'),
    );
    if (mine.length === 0) return null;

    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const salaries = await tx.employeeSalary.findMany({
      where: {
        staffId: { in: mine.map((row) => row.staffId) },
        basis: 'MONTHLY',
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
      },
      select: { amount: true },
    });
    const protectedWages = salaries.map((row) => toCents(row.amount)).filter((cents) => cents <= FIRST_SCHEDULE_WAGE_CEILING_CENTS);
    return protectedWages.length === 0 ? null : Math.max(...protectedWages);
  }

  /**
   * DELETE A RULE SET NOBODY USES.
   *
   * There was no way to remove one, so a browser test that saved two per run
   * left a dozen "Paid below 1758…" rows on the demo tenant's Settings page.
   * A rule set that is not the default, prices nobody today, has nobody
   * assigned to it by hand, and that no payslip line ever named can go, with
   * an audit row holding what it said. Anything else is refused with the
   * reason: a month that was priced by a rule set keeps its name, and a name
   * on a payslip has to stay readable.
   */
  async remove(id: string, reason?: string) {
    return withAdminTx(this.rawPrisma, 'hr.statutory.manage', async (tx, actor) => {
      const row = await tx.payrollPolicy.findFirst({ where: { id } });
      if (!row) throw new NotFoundException('Payroll policy not found');
      if (row.isDefault) {
        throw new ConflictException('This is the default rule set. Make another the default before deleting it.');
      }
      const assigned = await tx.employeeProfile.count({ where: { payrollPolicyId: id } });
      if (assigned > 0) {
        throw new ConflictException(
          `${assigned} ${assigned === 1 ? 'employee is' : 'employees are'} assigned to this rule set by hand. Move them first.`,
        );
      }
      const policies = await tx.payrollPolicy.findMany();
      const employees = await tx.employeeProfile.findMany({
        where: { engagement: 'EMPLOYEE', employmentStatus: { in: [...ACTIVE_STATUSES] } },
        select: { payrollPolicyId: true, legalEmployerId: true, staff: { select: { active: true, role: true, professionalType: true } } },
      });
      const covers = employees.filter(
        (employee) =>
          employee.staff.active &&
          resolvePayrollPolicy(policies, {
            payrollPolicyId: employee.payrollPolicyId,
            legalEmployerId: employee.legalEmployerId,
            category: workforceCategoryOf(employee.staff),
          }).policy?.id === id,
      ).length;
      if (covers > 0) {
        throw new ConflictException(
          `This rule set prices ${covers} ${covers === 1 ? 'employee' : 'employees'} today. Change what it applies to first.`,
        );
      }
      const named = await tx.payrollLine.count({ where: { breakdown: { path: ['overtimePolicy', 'ruleSet'], equals: row.name } } });
      if (named > 0) {
        throw new ConflictException(
          `${named} payslip ${named === 1 ? 'line names' : 'lines name'} this rule set. A month priced by it keeps its name, so it cannot be deleted.`,
        );
      }

      await tx.payrollPolicy.delete({ where: { id } });
      await recordAudit(tx, actor, {
        action: 'payrollPolicy.deleted',
        entityType: 'PayrollPolicy',
        entityId: id,
        before: {
          name: row.name,
          overtimeMode: row.overtimeMode,
          workforceCategory: row.workforceCategory,
          legalEmployerId: row.legalEmployerId,
          isDefault: row.isDefault,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        },
        after: null,
        reason: reason?.trim() || `Deleted the unused rule set "${row.name}"`,
        source: 'hr.settings',
      });
      return { deleted: true, name: row.name };
    });
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
        clinicFestiveHolidayShift: clinic ? (dto.clinicFestiveHolidayShift ?? null) : null,
        clinicRestDayShift: clinic ? (dto.clinicRestDayShift ?? null) : null,
        clinicSessionRate: clinic ? (dto.clinicSessionRate ?? null) : null,
      };
      if (clinic && Object.values(rates).every((value) => value === null)) {
        throw new BadRequestException(
          'A clinic-rate rule set needs at least one amount: per overtime hour, per public holiday shift, per festive holiday shift, per rest day shift or per session.',
        );
      }
      for (const [key, value] of Object.entries(rates)) {
        if (value !== null && toCents(value) <= 0) {
          throw new BadRequestException(`${key.replace('clinic', '')} must be more than zero, or left blank.`);
        }
      }

      /*
       * THE CLINIC'S OWN MULTIPLIERS, HELD TO THE ACT.
       *
       * The DTO refuses a value below the floor before this runs; this is the
       * second statement of the same rule, for anything that reaches the
       * service another way, and it is where the sentence comes from. Null
       * clears the choice back to the Act's rather than storing the Act's
       * number as if the clinic had typed it — a stored 1.5 would stop
       * following the Act if Parliament ever moved it.
       */
      const multipliers: Record<string, number | null> = {};
      for (const floor of OVERTIME_MULTIPLIER_FLOORS) {
        const value: number | null | undefined = dto[floor.field];
        if (value === null || value === undefined) {
          multipliers[floor.field] = null;
          continue;
        }
        const chosen = Number(value);
        const refusal = overtimeMultiplierRefusal(floor.field, chosen);
        if (refusal) throw new BadRequestException(refusal);
        multipliers[floor.field] = chosen === floor.act ? null : chosen;
      }

      /*
       * THE CHOICE TO PAY BELOW THE ACT, TAKEN BY SOMEBODY WITH A NAME.
       *
       * Every below-Act figure on this rule set, fingerprinted. The
       * acknowledgement is against EXACTLY these terms, so a clinic that later
       * drops overtime from 1.4× to 1.1× has to say so again rather than ride
       * in on the consent it gave for 1.4×. An unchanged set of terms keeps
       * the acknowledgement it already has, so renaming a rule set does not
       * demand the whole conversation a second time.
       */
      const below: string[] = [];
      for (const [field, value] of Object.entries(multipliers)) {
        if (value === null) continue;
        const shortfall = belowActMultiplier(field, value);
        if (shortfall) below.push(`${shortfall.field}=${shortfall.chosen}/${shortfall.act}`);
      }
      const reasons = below.map((entry) => {
        const [field, pair] = entry.split('=');
        return belowActMultiplier(field, Number(pair.split('/')[0]))!.sentence;
      });

      /*
       * A CLINIC RM RATE IS BELOW THE ACT OR NOT DEPENDING ON WHOSE WAGE IT
       * PRICES, so unlike a multiplier it cannot be judged from the figure
       * alone. RM20 an hour is under the Act for somebody on RM3,120 and over
       * it for somebody on RM1,500.
       *
       * Assessed against the HIGHEST First Schedule wage this rule set would
       * cover once saved: the Act's figure rises with the wage, so that is the
       * employee a fixed amount fails first. Nobody covered means nothing to
       * hold it to, and the rule set saves without a word — the permanent mark
       * and the run's per-employee warning are what catch somebody joining it
       * later.
       */
      const worstWage = clinic ? await this.highestProtectedWage(tx, dto) : null;
      if (worstWage !== null) {
        const shortfalls = clinicRateShortfalls(
          {
            ruleSet: dto.name,
            overtimeHourlyCents: rates.clinicOvertimeHourly === null ? null : toCents(rates.clinicOvertimeHourly),
            publicHolidayShiftCents: rates.clinicPublicHolidayShift === null ? null : toCents(rates.clinicPublicHolidayShift),
            festiveHolidayShiftCents: rates.clinicFestiveHolidayShift === null ? null : toCents(rates.clinicFestiveHolidayShift),
            restDayShiftCents: rates.clinicRestDayShift === null ? null : toCents(rates.clinicRestDayShift),
            sessionCents: rates.clinicSessionRate === null ? null : toCents(rates.clinicSessionRate),
          },
          worstWage,
          dto.overtimeHoursPerDay ?? 7.5,
        );
        for (const shortfall of shortfalls) {
          below.push(`${shortfall.rate}=${shortfall.clinicCents}/${shortfall.actCents}`);
          reasons.push(`${shortfall.sentence} That is BELOW what the Act requires on wages of ${formatCents(worstWage)} a month.`);
        }
      }

      const terms = below.length > 0 ? below.join(';') : null;

      const acknowledgement =
        terms === null
          ? { belowActTerms: null, belowActReason: null, belowActAcknowledgedAt: null, belowActAcknowledgedByStaffId: null }
          : existing?.belowActTerms === terms
            ? {
                belowActTerms: terms,
                belowActReason: existing.belowActReason,
                belowActAcknowledgedAt: existing.belowActAcknowledgedAt,
                belowActAcknowledgedByStaffId: existing.belowActAcknowledgedByStaffId,
              }
            : (() => {
                const reason = (dto.belowActReason ?? '').trim();
                if (!dto.belowActAcknowledged || reason.length < 4) {
                  throw new BadRequestException(
                    `${reasons.join(' ')} Paying below the Act is yours to decide, and Kuwick ` +
                      'will store it — but not silently. Confirm that this is deliberate and say why, and the choice is ' +
                      'recorded against your name and today’s date.',
                  );
                }
                return {
                  belowActTerms: terms,
                  belowActReason: reason,
                  belowActAcknowledgedAt: new Date(),
                  belowActAcknowledgedByStaffId: actor.id,
                };
              })();

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
        overtimeDays: dto.overtimeDays ?? 26,
        // Absent keeps what the rule set has, and a new one starts on the
        // specification's own default. Nothing moves because a clinic has not
        // opened the screen.
        ...(dto.pcbProjectionBasis === undefined ? {} : { pcbProjectionBasis: dto.pcbProjectionBasis }),
        overtimeHoursPerDay: dto.overtimeHoursPerDay ?? 7.5,
        terminationBasis: dto.terminationBasis ?? 'CALENDAR_DAYS',
        terminationDays: dto.terminationDays ?? 31,
        overtimeMode,
        ...rates,
        ...multipliers,
        ...acknowledgement,
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
          (() => {
            const moved = OVERTIME_MULTIPLIER_FLOORS.filter((floor) => multipliers[floor.field] !== null).map(
              (floor) =>
                `${floor.label.toLowerCase()} at ${multipliers[floor.field]}× against the Act's ${floor.act}×` +
                (Number(multipliers[floor.field]) < floor.act ? ' (BELOW the Act)' : ''),
            );
            return moved.length > 0 ? `, ${moved.join(', ')}` : '';
          })() +
          (terms && acknowledgement.belowActAcknowledgedAt
            ? `, acknowledged as below the Act: ${acknowledgement.belowActReason}`
            : '') +
          (workforceCategory ? ` for ${categoryLabel(workforceCategory)?.toLowerCase()}` : ''),
        ...(existing ? { before: existing, after: saved } : { after: saved }),
      });

      return saved;
    });
  }
}
