import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PayrollRunStatus, StatutoryStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, actorCan, requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { fromCents, toCents } from '../finance/money';
import {
  DEFAULT_COMPONENT_LIABILITY,
  LIABILITY_BY_STATUS_CODE,
  PayrollComponentLine,
  StatutoryRules,
  ageAt,
  computeOvertime,
  computePayslip,
  ordinaryRates,
  statutoryStatusOf,
  unpaidLeaveDeductionCents,
} from './payroll-calculation';
import { totalTimesheet } from './attendance-hours';
import { leaveDaysInYear } from './leave-balance';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { PayrollAdjustmentDto } from './dto/payroll-adjustment.dto';
import { UpsertStatutoryRulesDto } from './dto/upsert-statutory-rules.dto';

/// Components that reduce pay whichever way the amount is entered. Everything
/// else is an earning unless the amount itself is negative.
const DEDUCTION_COMPONENTS = new Set([
  'UNPAID_LEAVE', 'ZAKAT', 'ADVANCE_RECOVERY', 'UNIFORM', 'OTHER_DEDUCTION',
]);

function monthStart(value: string | Date): Date {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`) : value;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
function monthEnd(start: Date): Date {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}
function daysInMonth(start: Date): number {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * PAYROLL — a run, its exceptions, and the lock.
 *
 * THE STATUTORY RULE governs everything here. Malaysian EPF, SOCSO, EIS and PCB
 * rates are not hardcoded; they come from a tenant-configured, effective-dated
 * `StatutoryRuleSet`. A run over a period with no rule set is NOT_CONFIGURED,
 * its statutory columns stay NULL rather than zero, and the payslip says so —
 * because a wrong EPF figure that looks right is worse than none.
 *
 * EXCEPTIONS ARE SURFACED BEFORE APPROVAL, never silently zeroed. An employee
 * with no salary on record, or with an unapproved overtime claim, appears in
 * `exceptions` and the run refuses to be approved until each is dealt with.
 *
 * THE LOCK IS IN THE DATABASE. An approved run's lines cannot be updated at
 * all — a trigger refuses it. A correction is a `PayrollAdjustment` row.
 */
@Injectable()
export class PayrollService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  // --- Statutory configuration ---------------------------------------------

  async listStatutoryRuleSets() {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const sets = await this.prisma.statutoryRuleSet.findMany({
      orderBy: { effectiveFrom: 'desc' },
      include: { verifiedBy: { select: { fullName: true } } },
    });
    return sets.map((set) => ({
      id: set.id,
      name: set.name,
      jurisdiction: set.jurisdiction,
      effectiveFrom: set.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: set.effectiveTo?.toISOString().slice(0, 10) ?? null,
      verified: set.verifiedAt !== null,
      verifiedAt: set.verifiedAt,
      verifiedBy: set.verifiedBy?.fullName ?? null,
      verificationNote: set.verificationNote,
      hasEpf: set.epfRules !== null,
      hasSocso: set.socsoRules !== null,
      hasEis: set.eisRules !== null,
      hasPcb: set.pcbRules !== null,
      status: statutoryStatusOf(set as unknown as StatutoryRules, set.verificationStatus),
    }));
  }

  async upsertStatutoryRules(dto: UpsertStatutoryRulesDto) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const effectiveFrom = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);
      const existing = dto.id ? await tx.statutoryRuleSet.findUnique({ where: { id: dto.id } }) : null;
      if (dto.id && !existing) throw new NotFoundException('Statutory rule set not found');

      const data = {
        name: dto.name,
        jurisdiction: dto.jurisdiction ?? 'MY',
        effectiveFrom,
        effectiveTo: dto.effectiveTo ? new Date(`${dto.effectiveTo}T00:00:00.000Z`) : null,
        epfRules: (dto.epfRules ?? null) as never,
        socsoRules: (dto.socsoRules ?? null) as never,
        eisRules: (dto.eisRules ?? null) as never,
        pcbRules: (dto.pcbRules ?? null) as never,
        // MARKING A RULE SET VERIFIED IS A DELIBERATE, SEPARATE ACT. Editing the
        // rates clears it, because a checked table that has since been edited is
        // not a checked table.
        ...(dto.verified
          ? { verifiedAt: new Date(), verifiedByStaffId: actor.id, verificationNote: dto.verificationNote ?? null }
          : { verifiedAt: null, verifiedByStaffId: null, verificationNote: null }),
      };

      const saved = existing
        ? await tx.statutoryRuleSet.update({ where: { id: existing.id }, data })
        : await tx.statutoryRuleSet.create({
            data: { ...data, tenantId: currentTenantId(), createdByStaffId: actor.id },
          });

      await recordAudit(tx, actor, {
        action: 'payroll.approved',
        entityType: 'StatutoryRuleSet',
        entityId: saved.id,
        before: existing ? { verifiedAt: existing.verifiedAt, effectiveFrom: existing.effectiveFrom } : null,
        after: { name: dto.name, effectiveFrom: dto.effectiveFrom, verified: Boolean(dto.verified) },
        reason: dto.verificationNote ?? null,
        source: 'hr.statutory',
      });
      return saved;
    });
  }

  private async rulesInForce(tx: AdminTx, period: Date) {
    return tx.statutoryRuleSet.findFirst({
      where: {
        effectiveFrom: { lte: period },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: period } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  // --- The run --------------------------------------------------------------

  async create(dto: CreatePayrollRunDto) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.run', async (tx, actor) => {
      const period = monthStart(dto.period);
      const existing = await tx.payrollRun.findFirst({
        where: { period, clinicId: dto.clinicId ?? null, status: { not: PayrollRunStatus.CANCELLED } },
      });
      if (existing) {
        throw new ConflictException(`A payroll run for ${dto.period} already exists at this branch.`);
      }
      return tx.payrollRun.create({
        data: {
          tenantId: currentTenantId(),
          clinicId: dto.clinicId ?? null,
          period,
          notes: dto.notes ?? null,
          createdByStaffId: actor.id,
        },
      });
    });
  }

  /**
   * Calculate every payslip in the run.
   *
   * Re-runnable while DRAFT or CALCULATED — a manager fixes a missing salary and
   * recalculates. Refused once APPROVED, by the database as well as by this
   * check.
   */
  async calculate(runId: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.run', async (tx, actor) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status === PayrollRunStatus.APPROVED || run.status === PayrollRunStatus.PAID) {
        throw new ConflictException('This payroll run is locked. Record an adjustment instead.');
      }

      const period = run.period;
      const periodEnd = monthEnd(period);
      const days = daysInMonth(period);

      const ruleSet = await this.rulesInForce(tx, period);
      const statutoryStatus = statutoryStatusOf(
        ruleSet as unknown as StatutoryRules | null,
        ruleSet?.verificationStatus ?? null,
      ) as StatutoryStatus;

      // Ordinary Rate of Pay, frozen onto the run. Two divisors, on purpose.
      const orpConfig = {
        overtimeDaysPerMonth: Number(run.orpOvertimeDays),
        unpaidLeaveDaysPerMonth: Number(run.orpUnpaidLeaveDays),
        hoursPerDay: Number(run.orpHoursPerDay),
      };

      const employees = await tx.employeeProfile.findMany({
        where: {
          employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
          ...(run.clinicId ? { staff: { clinicId: run.clinicId } } : {}),
        },
        include: { staff: { select: { id: true, fullName: true, active: true, clinicId: true, role: true } } },
        // Deterministic order, so two calculations of the same run produce the
        // same exception list in the same sequence.
        orderBy: { staffId: 'asc' },
      });

      const exceptions: { staffId: string; name: string; issue: string }[] = [];
      let grossTotal = 0;
      let deductionTotal = 0;
      let netTotal = 0;
      let employerCostTotal = 0;
      let counted = 0;

      // Clear any previous calculation. Safe: the trigger refuses this once the
      // run is locked, so a locked run can never reach here.
      await tx.payrollLine.deleteMany({ where: { payrollRunId: runId } });

      for (const employee of employees) {
        if (!employee.staff.active) continue;

        if (employee.basicSalary === null && employee.hourlyRate === null) {
          exceptions.push({
            staffId: employee.staffId,
            name: employee.staff.fullName,
            issue: 'No salary or hourly rate on record — this employee cannot be paid until one is set.',
          });
          continue;
        }

        const [attendance, leave, incentives, inputs] = await Promise.all([
          tx.attendanceRecord.findMany({
            where: { staffId: employee.staffId, workDate: { gte: period, lt: periodEnd } },
          }),
          tx.leaveRequest.findMany({
            where: {
              staffId: employee.staffId,
              status: 'APPROVED',
              startDate: { lt: periodEnd },
              endDate: { gte: period },
            },
          }),
          tx.incentiveResult.findMany({
            where: {
              staffId: employee.staffId,
              incentiveRun: { period, status: { in: ['APPROVED', 'PAID'] } },
            },
          }),
          // What a person supplied for this period: allowances, bonus, claims,
          // and PCB — which this system does not calculate.
          tx.payrollInputEntry.findMany({ where: { staffId: employee.staffId, period } }),
        ]);

        const timesheet = totalTimesheet(
          attendance.map((row) => ({
            status: row.status,
            workedMinutes: row.workedMinutes,
            lateMinutes: row.lateMinutes,
            overtimeMinutes: row.overtimeMinutes,
            overtimeApproved: row.overtimeApproved,
          })),
        );

        if (timesheet.unapprovedOvertimeMinutes > 0) {
          exceptions.push({
            staffId: employee.staffId,
            name: employee.staff.fullName,
            issue: `${Math.round(timesheet.unapprovedOvertimeMinutes / 6) / 10}h of overtime is claimed but not approved. It is NOT included in this payslip.`,
          });
        }
        if (timesheet.daysMissingPunch > 0) {
          exceptions.push({
            staffId: employee.staffId,
            name: employee.staff.fullName,
            issue: `${timesheet.daysMissingPunch} day(s) with a missing clock-in or clock-out.`,
          });
        }

        const basicCents = toCents(employee.basicSalary ?? 0);

        // AGE DRIVES THE SCHEME, not just the rate: at 60 the employee's EPF
        // share goes to nil and the employer's to 4%, SOCSO moves to the Second
        // Category, and EIS ceases. An unknown date of birth is therefore a
        // BLOCKING exception, not a reason to assume "under 60" — assuming
        // would under-contribute for the whole workforce and nobody would see it.
        const age = ageAt(employee.dateOfBirth, new Date(periodEnd.getTime() - 86400000));
        if (age === null) {
          exceptions.push({
            staffId: employee.staffId,
            name: employee.staff.fullName,
            issue: 'No date of birth on record. EPF, SOCSO and EIS all change at age 60, so this employee cannot be calculated.',
          });
          continue;
        }

        // Unpaid leave, from the leave TYPE — a clinic's own policy decides
        // which types are unpaid, and this reads that rather than assuming.
        const unpaidTypes = new Set(['UNPAID']);
        const unpaidDays = leave
          .filter((row) => unpaidTypes.has(row.leaveType))
          .reduce(
            (total, row) =>
              total +
              leaveDaysInYear(
                {
                  startDate: row.startDate > period ? row.startDate : period,
                  endDate: row.endDate < periodEnd ? row.endDate : new Date(periodEnd.getTime() - 86400000),
                },
                period.getUTCFullYear(),
              ),
            0,
          );

        const incentiveCents = incentives.reduce((total, row) => total + toCents(row.amount), 0);

        // The Ordinary Rate of Pay is built from the earnings that COUNT toward
        // it — basic and ORP-liable allowances — and never from overtime, or an
        // hour of overtime would raise the rate paid for the next one.
        const orpBase = basicCents;
        const rates = ordinaryRates(orpBase, orpConfig);
        const unpaidCents = unpaidLeaveDeductionCents(unpaidDays, rates);

        // Overtime from APPROVED minutes only, at the hourly ORP. The 1.5x
        // multiplier is the Employment Act's normal-day minimum; rest-day and
        // public-holiday tiers are supported by the engine and are configured
        // per clinic rather than assumed here.
        const overtimeHours = timesheet.approvedOvertimeMinutes / 60;
        const hourlyCents = employee.hourlyRate ? toCents(employee.hourlyRate) : rates.overtimeHourlyCents;
        const overtime = computeOvertime(
          [{ label: 'Normal day (1.5x)', hours: overtimeHours, multiplier: 1.5 }],
          hourlyCents,
        );
        const overtimeCents = overtime.totalCents;

        // Components carry their own statutory liability, so the three bases
        // come out different — overtime is SOCSO and EIS wages but not EPF
        // wages. See docs/HR_PAYROLL_EXCEL_REFERENCE_AUDIT.md section 1.3.
        const componentLines: PayrollComponentLine[] = [
          { code: 'BASIC', label: 'Basic pay', kind: 'EARNING', amount: fromCents(basicCents), liability: DEFAULT_COMPONENT_LIABILITY.BASIC },
        ];
        if (overtimeCents > 0) {
          componentLines.push({
            code: 'OVERTIME', label: 'Overtime', kind: 'EARNING',
            amount: fromCents(overtimeCents), liability: DEFAULT_COMPONENT_LIABILITY.OVERTIME,
          });
        }
        if (incentiveCents > 0) {
          componentLines.push({
            code: 'INCENTIVE', label: 'Incentives', kind: 'EARNING',
            amount: fromCents(incentiveCents), liability: DEFAULT_COMPONENT_LIABILITY.INCENTIVE,
          });
        }
        if (unpaidCents > 0) {
          componentLines.push({
            code: 'UNPAID_LEAVE', label: 'Unpaid leave', kind: 'DEDUCTION',
            amount: fromCents(unpaidCents), liability: DEFAULT_COMPONENT_LIABILITY.UNPAID_LEAVE,
          });
        }

        // PCB is a supplied amount, not a computed one, so it is taken out of
        // the component list and applied as an override further down.
        const pcbInput = inputs.find((row) => row.componentCode === 'PCB');
        const pcbOverrideCents = pcbInput ? toCents(pcbInput.amount) : null;

        for (const input of inputs) {
          if (input.componentCode === 'PCB') continue;
          const liability = DEFAULT_COMPONENT_LIABILITY[input.componentCode];
          if (!liability) {
            // An input naming a component this build does not know would
            // otherwise be silently dropped from somebody's pay.
            exceptions.push({
              staffId: employee.staffId,
              name: employee.staff.fullName,
              issue: `Payroll input "${input.componentCode}" is not a known component and was NOT included.`,
            });
            continue;
          }
          const amountCents = toCents(input.amount);
          if (amountCents === 0) continue;
          componentLines.push({
            code: input.componentCode,
            label: input.label ?? input.componentCode,
            kind: amountCents < 0 ? 'DEDUCTION' : DEDUCTION_COMPONENTS.has(input.componentCode) ? 'DEDUCTION' : 'EARNING',
            amount: fromCents(Math.abs(amountCents)),
            liability,
          });
        }

        const payslip = computePayslip(componentLines, ruleSet as unknown as StatutoryRules | null, {
          age,
          epfEmployeeRate: employee.epfEmployeeRate ? Number(employee.epfEmployeeRate) : 11,
          epfApplicable: employee.epfApplicable,
          socsoApplicable: employee.socsoApplicable,
          eisApplicable: employee.eisApplicable,
          pcbApplicable: employee.pcbApplicable,
        });

        // PCB is not calculated by this system, and that is a BLOCKING
        // exception rather than a quiet null on a payslip somebody might pay
        // against. See docs/MALAYSIA_PAYROLL_STATUTORY_SOURCES.md section 4.
        if (payslip.statutory.pcbCents === null) {
          if (pcbOverrideCents === null) {
            exceptions.push({
              staffId: employee.staffId,
              name: employee.staff.fullName,
              issue:
                'PCB (monthly tax deduction) is not calculated by this system and no amount has been entered. ' +
                'Enter it as a payroll input, or record this employee as outside PCB.',
            });
          } else {
            // A supplied figure completes the payslip. It is withheld from the
            // employee and reduces net pay exactly as a computed one would.
            payslip.statutory.pcbCents = pcbOverrideCents;
            payslip.statutory.pcbNote = `PCB of ${pcbInput?.label ?? 'this amount'} was entered by hand, not calculated.`;
            payslip.employeeDeductionCents += pcbOverrideCents;
            payslip.netCents -= pcbOverrideCents;
            payslip.incomplete =
              payslip.statutory.epf.employeeCents === null ||
              payslip.statutory.socso.employeeCents === null ||
              payslip.statutory.eis.employeeCents === null;
          }
        }
        for (const note of payslip.notes.filter((n) => !n.startsWith('PCB is not calculated'))) {
          exceptions.push({ staffId: employee.staffId, name: employee.staff.fullName, issue: note });
        }

        await tx.payrollLine.create({
          data: {
            tenantId: currentTenantId(),
            payrollRunId: runId,
            staffId: employee.staffId,
            employeeSnapshot: {
              name: employee.staff.fullName,
              employeeNo: employee.employeeNo,
              position: employee.position,
              department: employee.department,
              employmentType: employee.employmentType,
              bankName: employee.bankName,
              // The account number is NOT snapshotted: a payslip does not need
              // it, and a JSON column is one more place it could leak from.
              statutoryApplicability: {
                epf: employee.epfApplicable,
                socso: employee.socsoApplicable,
                eis: employee.eisApplicable,
                pcb: employee.pcbApplicable,
              },
            } as never,
            basicSalary: fromCents(basicCents),
            overtimePay: fromCents(overtimeCents),
            incentives: fromCents(incentiveCents),
            grossPay: fromCents(payslip.grossCents),
            unpaidLeaveDeduction: fromCents(unpaidCents),
            epfEmployee: nullableCents(payslip.statutory.epf.employeeCents),
            epfEmployer: nullableCents(payslip.statutory.epf.employerCents),
            socsoEmployee: nullableCents(payslip.statutory.socso.employeeCents),
            socsoEmployer: nullableCents(payslip.statutory.socso.employerCents),
            eisEmployee: nullableCents(payslip.statutory.eis.employeeCents),
            eisEmployer: nullableCents(payslip.statutory.eis.employerCents),
            pcb: nullableCents(payslip.statutory.pcbCents),
            netPay: fromCents(payslip.netCents),
            employerCost: fromCents(payslip.employerCostCents),
            workedDays: timesheet.daysPresent,
            unpaidDays,
            overtimeHours: Math.round((timesheet.approvedOvertimeMinutes / 60) * 100) / 100,
            breakdown: {
              // The THREE bases, not one. A payslip that shows a single
              // "statutory wage" cannot explain why EPF and SOCSO differ.
              bases: {
                epf: fromCents(payslip.bases.epfCents),
                socso: fromCents(payslip.bases.socsoCents),
                eis: fromCents(payslip.bases.eisCents),
              },
              components: payslip.lines.map((line) => ({
                code: line.code, label: line.label, kind: line.kind,
                amount: line.amount, liability: line.liability,
              })),
              ordinaryRateOfPay: {
                overtimeDays: orpConfig.overtimeDaysPerMonth,
                unpaidLeaveDays: orpConfig.unpaidLeaveDaysPerMonth,
                hoursPerDay: orpConfig.hoursPerDay,
                unpaidLeaveDaily: fromCents(rates.unpaidLeaveDailyCents),
                overtimeHourly: fromCents(rates.overtimeHourlyCents),
              },
              overtimeTiers: overtime.tiers.map((tier) => ({
                label: tier.label, hours: tier.hours,
                hourlyRate: fromCents(tier.hourlyRateCents), total: fromCents(tier.totalCents),
              })),
              age,
              statutoryNotes: {
                epf: payslip.statutory.epf.note ?? null,
                socso: payslip.statutory.socso.note ?? null,
                eis: payslip.statutory.eis.note ?? null,
                pcb: payslip.statutory.pcbNote ?? null,
              },
              incomplete: payslip.incomplete,
              hourlyRateUsed: fromCents(hourlyCents),
              timesheet,
            } as never,
          },
        });

        grossTotal += payslip.grossCents;
        deductionTotal += payslip.employeeDeductionCents;
        netTotal += payslip.netCents;
        employerCostTotal += payslip.employerCostCents;
        counted += 1;
      }

      const updated = await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: PayrollRunStatus.CALCULATED,
          statutoryStatus,
          statutoryRuleSetId: ruleSet?.id ?? null,
          statutorySnapshot: (ruleSet
            ? {
                name: ruleSet.name,
                effectiveFrom: ruleSet.effectiveFrom,
                verificationStatus: ruleSet.verificationStatus,
                verified: ruleSet.verificationStatus === 'VERIFIED',
                epfRules: ruleSet.epfRules,
                socsoRules: ruleSet.socsoRules,
                eisRules: ruleSet.eisRules,
                pcbRules: ruleSet.pcbRules,
              }
            : null) as never,
          grossTotal: fromCents(grossTotal),
          deductionTotal: fromCents(deductionTotal),
          netTotal: fromCents(netTotal),
          employerCostTotal: fromCents(employerCostTotal),
          employeeCount: counted,
          exceptions: exceptions as never,
          calculatedAt: new Date(),
        },
      });

      await recordAudit(tx, actor, {
        action: 'payroll.calculated',
        entityType: 'PayrollRun',
        entityId: runId,
        after: {
          period: period.toISOString().slice(0, 10),
          employees: counted,
          gross: fromCents(grossTotal),
          net: fromCents(netTotal),
          statutoryStatus,
          exceptions: exceptions.length,
        },
        source: 'hr.payroll',
      });

      return updated;
    });
  }

  /**
   * Approve and LOCK.
   *
   * Refuses three things: a run nobody calculated, a run with unresolved
   * exceptions, and self-approval by the person who created it.
   */
  async approve(runId: string, acknowledgeStatutoryGap = false) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== PayrollRunStatus.CALCULATED) {
        throw new ConflictException(`A ${run.status.toLowerCase()} payroll run cannot be approved.`);
      }
      // SEPARATION OF DUTIES, with the owner as the documented exception: in a
      // clinic where the owner is the only person who touches payroll, refusing
      // their approval would leave nobody able to pay anyone.
      if (run.createdByStaffId === actor.id && !actorCan(actor, 'settings.manage')) {
        throw new ForbiddenException('A payroll run must be approved by somebody other than the person who ran it.');
      }

      const exceptions = (run.exceptions as { issue: string }[] | null) ?? [];
      if (exceptions.length > 0) {
        throw new BadRequestException(
          `${exceptions.length} exception(s) are unresolved. Fix them and recalculate, or the run will pay the wrong amounts.`,
        );
      }

      // A run whose statutory figures could not be computed CAN be approved —
      // a clinic that files EPF through its accountant is a real case — but
      // only deliberately, and the acknowledgement is on the record.
      if (run.statutoryStatus !== StatutoryStatus.CONFIGURED && !acknowledgeStatutoryGap) {
        throw new BadRequestException(
          run.statutoryStatus === StatutoryStatus.NOT_CONFIGURED
            ? 'No statutory rates are configured for this period, so EPF, SOCSO, EIS and PCB have NOT been calculated. Confirm that this is intended before approving.'
            : 'The statutory rates used have not been verified against the authority’s published tables. Confirm before approving.',
        );
      }

      const approved = await tx.payrollRun.update({
        where: { id: runId },
        data: { status: PayrollRunStatus.APPROVED, approvedByStaffId: actor.id, approvedAt: new Date() },
      });

      await recordAudit(tx, actor, {
        action: 'payroll.approved',
        entityType: 'PayrollRun',
        entityId: runId,
        before: { status: PayrollRunStatus.CALCULATED },
        after: {
          status: PayrollRunStatus.APPROVED,
          net: String(run.netTotal),
          employees: run.employeeCount,
          statutoryStatus: run.statutoryStatus,
          statutoryGapAcknowledged: acknowledgeStatutoryGap,
        },
        source: 'hr.payroll',
      });
      return approved;
    });
  }

  /** The ONLY way a locked run changes. */
  async adjust(runId: string, dto: PayrollAdjustmentDto) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== PayrollRunStatus.APPROVED && run.status !== PayrollRunStatus.PAID) {
        throw new BadRequestException('An unlocked run is corrected by recalculating it, not by an adjustment.');
      }

      const adjustment = await tx.payrollAdjustment.create({
        data: {
          tenantId: currentTenantId(),
          payrollRunId: runId,
          staffId: dto.staffId,
          description: dto.description,
          amount: dto.amount,
          reason: dto.reason,
          createdByStaffId: actor.id,
        },
      });

      await recordAudit(tx, actor, {
        action: 'payroll.adjusted',
        entityType: 'PayrollAdjustment',
        entityId: adjustment.id,
        after: { payrollRunId: runId, staffId: dto.staffId, amount: dto.amount, description: dto.description },
        reason: dto.reason,
        source: 'hr.payroll',
      });
      return adjustment;
    });
  }

  async markPaid(runId: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== PayrollRunStatus.APPROVED) {
        throw new ConflictException('Only an approved run can be marked paid.');
      }
      // NO BANK INTEGRATION. This records that a human paid it, and nothing
      // here claims to have moved money (owner brief §5I).
      const paid = await tx.payrollRun.update({
        where: { id: runId },
        data: { status: PayrollRunStatus.PAID, paidAt: new Date() },
      });
      await recordAudit(tx, actor, {
        action: 'payroll.approved',
        entityType: 'PayrollRun',
        entityId: runId,
        before: { status: PayrollRunStatus.APPROVED },
        after: { status: PayrollRunStatus.PAID, paidAt: paid.paidAt },
        source: 'hr.payroll',
      });
      return paid;
    });
  }

  async list(params: { clinicId?: string; year?: number } = {}) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const runs = await this.prisma.payrollRun.findMany({
      where: {
        ...(params.clinicId ? { clinicId: params.clinicId } : {}),
        ...(params.year
          ? { period: { gte: new Date(Date.UTC(params.year, 0, 1)), lt: new Date(Date.UTC(params.year + 1, 0, 1)) } }
          : {}),
      },
      orderBy: { period: 'desc' },
      include: {
        clinic: { select: { name: true } },
        approvedBy: { select: { fullName: true } },
        createdBy: { select: { fullName: true } },
        _count: { select: { lines: true, adjustments: true } },
      },
    });
    return runs.map((run) => ({
      id: run.id,
      period: run.period.toISOString().slice(0, 7),
      clinicId: run.clinicId,
      clinicName: run.clinic?.name ?? 'All branches',
      status: run.status,
      statutoryStatus: run.statutoryStatus,
      grossTotal: Number(run.grossTotal),
      deductionTotal: Number(run.deductionTotal),
      netTotal: Number(run.netTotal),
      employerCostTotal: Number(run.employerCostTotal),
      employeeCount: run.employeeCount,
      exceptions: ((run.exceptions as unknown[] | null) ?? []).length,
      lines: run._count.lines,
      adjustments: run._count.adjustments,
      calculatedAt: run.calculatedAt,
      approvedAt: run.approvedAt,
      approvedBy: run.approvedBy?.fullName ?? null,
      createdBy: run.createdBy.fullName,
      paidAt: run.paidAt,
    }));
  }

  async detail(runId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
      include: {
        clinic: { select: { name: true } },
        approvedBy: { select: { fullName: true } },
        createdBy: { select: { fullName: true } },
        lines: { include: { staff: { select: { fullName: true } } }, orderBy: { staff: { fullName: 'asc' } } },
        adjustments: { include: { staff: { select: { fullName: true } }, createdBy: { select: { fullName: true } } } },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');

    return {
      id: run.id,
      period: run.period.toISOString().slice(0, 7),
      clinicName: run.clinic?.name ?? 'All branches',
      status: run.status,
      statutoryStatus: run.statutoryStatus,
      // Stated in the payload, so the UI cannot forget to say it.
      statutoryNotice:
        run.statutoryStatus === StatutoryStatus.NOT_CONFIGURED
          ? 'No statutory rates were configured for this period. EPF, SOCSO, EIS and PCB have NOT been calculated and are shown as blank rather than zero.'
          : run.statutoryStatus === StatutoryStatus.PROVISIONAL
            ? 'The statutory rates used have not been verified against the authority’s published tables. Treat these figures as provisional.'
            : null,
      grossTotal: Number(run.grossTotal),
      deductionTotal: Number(run.deductionTotal),
      netTotal: Number(run.netTotal),
      employerCostTotal: Number(run.employerCostTotal),
      employeeCount: run.employeeCount,
      exceptions: (run.exceptions as unknown[] | null) ?? [],
      calculatedAt: run.calculatedAt,
      approvedAt: run.approvedAt,
      approvedBy: run.approvedBy?.fullName ?? null,
      createdBy: run.createdBy.fullName,
      paidAt: run.paidAt,
      lines: run.lines.map((line) => ({
        id: line.id,
        staffId: line.staffId,
        name: line.staff.fullName,
        snapshot: line.employeeSnapshot,
        basicSalary: Number(line.basicSalary),
        allowances: Number(line.allowances),
        overtimePay: Number(line.overtimePay),
        incentives: Number(line.incentives),
        bonus: Number(line.bonus),
        grossPay: Number(line.grossPay),
        unpaidLeaveDeduction: Number(line.unpaidLeaveDeduction),
        // NULL travels through as null, never coerced to 0 — that is the whole
        // point of `StatutoryStatus`.
        epfEmployee: numberOrNull(line.epfEmployee),
        epfEmployer: numberOrNull(line.epfEmployer),
        socsoEmployee: numberOrNull(line.socsoEmployee),
        socsoEmployer: numberOrNull(line.socsoEmployer),
        eisEmployee: numberOrNull(line.eisEmployee),
        eisEmployer: numberOrNull(line.eisEmployer),
        pcb: numberOrNull(line.pcb),
        netPay: Number(line.netPay),
        employerCost: Number(line.employerCost),
        workedDays: numberOrNull(line.workedDays),
        unpaidDays: numberOrNull(line.unpaidDays),
        overtimeHours: numberOrNull(line.overtimeHours),
        breakdown: line.breakdown,
      })),
      adjustments: run.adjustments.map((adjustment) => ({
        id: adjustment.id,
        staffName: adjustment.staff.fullName,
        description: adjustment.description,
        amount: Number(adjustment.amount),
        reason: adjustment.reason,
        by: adjustment.createdBy.fullName,
        at: adjustment.createdAt,
      })),
    };
  }
}

function nullableCents(cents: number | null): number | null {
  return cents === null ? null : fromCents(cents);
}

function numberOrNull(value: { toString(): string } | null): number | null {
  return value === null ? null : Number(value);
}
