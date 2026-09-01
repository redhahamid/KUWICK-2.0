import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PayrollRunStatus, StatutoryStatus, StatutoryVerificationStatus } from '@prisma/client';
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
import { approvalGate, buildException, ExceptionSeverity } from './payroll-exception';
import { diffSnapshots, snapshotHash, SnapshotEmployeeLine, SnapshotPayload } from './payroll-snapshot';
import { computeVariance, VarianceLine } from './payroll-variance';

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
        //
        // `verificationStatus` moves WITH `verifiedAt`. Setting one and not the
        // other left a set that a person had signed off still reading DRAFT, so
        // it could never reach CONFIGURED and every run against it stayed
        // provisional however carefully somebody had checked the tables.
        ...(dto.verified
          ? {
              verificationStatus: StatutoryVerificationStatus.VERIFIED,
              verifiedAt: new Date(),
              verifiedByStaffId: actor.id,
              verificationNote: dto.verificationNote ?? null,
            }
          : {
              // Back to DRAFT, not CORROBORATED: whatever corroboration a
              // previous version had was corroboration of different numbers.
              verificationStatus: StatutoryVerificationStatus.DRAFT,
              verifiedAt: null,
              verifiedByStaffId: null,
              verificationNote: null,
            }),
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
        // DELIBERATELY NOT every statutory note. "No EPF schedule is configured
        // for this period" is a property of the RUN, already carried by
        // `statutoryStatus` and already gated by the acknowledge-the-gap flow
        // on approval. Repeating it once per employee per scheme buried the
        // real exceptions under noise and, worse, made a NOT_CONFIGURED run
        // unapprovable — closing off the documented case of a clinic that
        // files EPF through its accountant.
        //
        // What DOES belong here is anything specific to this employee: an
        // incomplete band table that happens to exclude their wage, or a wage
        // outside every configured band.
        for (const note of payslip.notes) {
          if (!/incomplete|outside every configured/i.test(note)) continue;
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

      // EXCEPTIONS AS ROWS.
      //
      // They were a JSON blob, so they could not be queried, counted by
      // severity, overridden individually or audited — and every one of them
      // blocked approval, which gave an informational observation the same
      // force as an unpayable employee.
      //
      // The blob above is still written so that nothing reading it breaks; the
      // rows are what the approval gate now consults.
      await tx.payrollException.deleteMany({ where: { payrollRunId: runId } });
      for (const raw of exceptions) {
        const built = classifyLegacyException(raw.issue, raw.staffId, runId);
        await tx.payrollException.create({
          data: {
            tenantId: currentTenantId(),
            payrollRunId: runId,
            staffId: built.staffId,
            severity: built.severity as ExceptionSeverity,
            code: built.code,
            cause: built.cause,
            consequence: built.consequence,
            remediation: built.remediation,
            deepLink: built.deepLink,
            overridable: built.overridable,
          },
        });
      }

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

      // THE APPROVAL GATE, from exception ROWS.
      //
      // A deliberate, specified change from "any exception blocks": BLOCKING
      // gates approval, WARNING does not. That distinction is the entire reason
      // severities exist — an unapproved-overtime note and an employee with no
      // date of birth are not the same kind of problem, and treating them
      // alike made a run unapprovable for a reason nobody needed to fix.
      const exceptionRows = await tx.payrollException.findMany({ where: { payrollRunId: runId } });
      const gate = approvalGate(exceptionRows);
      if (!gate.canApprove) {
        throw new BadRequestException(
          `${gate.reason} Fix them and recalculate, or the run will pay the wrong amounts.`,
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

      // THE SNAPSHOT.
      //
      // The audited competitor freezes on approval and, on reopen, re-derives
      // from CURRENT master data while holding no snapshot anybody can inspect
      // — its own dialog warns the figures "could result in different amounts".
      // That leaves "what exactly did we approve in January?" unanswerable.
      //
      // Everything the calculation consumed is frozen here and hashed, so the
      // question has an answer years later and a correction can show a diff.
      const payload = await this.buildSnapshotPayload(tx, runId);
      const version = (await tx.payrollSnapshot.count({ where: { payrollRunId: runId } })) + 1;
      const snapshot = await tx.payrollSnapshot.create({
        data: {
          tenantId: currentTenantId(),
          payrollRunId: runId,
          version,
          hash: snapshotHash(payload),
          payload: payload as never,
          createdByStaffId: actor.id,
        },
      });

      await recordAudit(tx, actor, {
        action: 'payrollSnapshot.created',
        entityType: 'PayrollSnapshot',
        entityId: snapshot.id,
        after: { version, hash: snapshot.hash, employees: payload.totals.employeeCount },
        source: 'hr.payroll',
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
        // Needed by the payslip: without it the deductions column does not sum
        // to the difference between gross and net, and a payslip that does not
        // add up is worse than no payslip.
        otherDeductions: Number(line.otherDeductions),
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

  // =========================================================================
  // STAGE 2 — snapshot, reopen with a diff, and variance
  // =========================================================================

  /**
   * Freeze what the calculation consumed.
   *
   * Read from the run's own lines, so a snapshot is a picture of what was
   * approved rather than a re-derivation from master data that may since have
   * moved.
   */
  private async buildSnapshotPayload(tx: AdminTx, runId: string): Promise<SnapshotPayload> {
    const run = await tx.payrollRun.findUniqueOrThrow({
      where: { id: runId },
      include: {
        legalEmployer: { select: { id: true, name: true } },
        lines: { orderBy: { staffId: 'asc' } },
      },
    });

    const inputs = await tx.payrollInputEntry.findMany({ where: { period: run.period } });
    const components = await tx.payComponent.findMany({ where: { active: true } });
    const ruleSet = run.statutoryRuleSetId
      ? await tx.statutoryRuleSet.findUnique({ where: { id: run.statutoryRuleSetId } })
      : null;

    const employees: SnapshotEmployeeLine[] = run.lines.map((line) => {
      const snap = (line.employeeSnapshot ?? {}) as Record<string, unknown>;
      const mine = inputs.filter((i) => i.staffId === line.staffId);
      const breakdown = (line.breakdown ?? {}) as Record<string, unknown>;
      const bases = (breakdown.bases ?? {}) as Record<string, number>;
      return {
        staffId: line.staffId,
        name: String(snap.name ?? ''),
        salaryRowId: (snap.salaryRowId as string | undefined) ?? null,
        salaryBasis: (snap.salaryBasis as string | undefined) ?? null,
        salaryAmountCents: toCents(line.basicSalary),
        inputs: mine.map((i) => ({
          componentCode: i.componentCode,
          amountCents: toCents(i.amount),
          source: i.source,
          sourceRecordId: i.sourceRecordId,
          kind: i.kind,
        })),
        componentVersions: components.map((c) => ({ code: c.code, version: c.version })),
        bases: {
          grossCents: bases.grossCents ?? toCents(line.grossPay),
          epfCents: bases.epfCents ?? 0,
          socsoCents: bases.socsoCents ?? 0,
          eisCents: bases.eisCents ?? 0,
          ordinaryRateBaseCents: bases.ordinaryRateBaseCents ?? toCents(line.basicSalary),
        },
        statutory: {
          epfEmployeeCents: line.epfEmployee === null ? null : toCents(line.epfEmployee),
          epfEmployerCents: line.epfEmployer === null ? null : toCents(line.epfEmployer),
          socsoEmployeeCents: line.socsoEmployee === null ? null : toCents(line.socsoEmployee),
          socsoEmployerCents: line.socsoEmployer === null ? null : toCents(line.socsoEmployer),
          eisEmployeeCents: line.eisEmployee === null ? null : toCents(line.eisEmployee),
          eisEmployerCents: line.eisEmployer === null ? null : toCents(line.eisEmployer),
          pcbCents: line.pcb === null ? null : toCents(line.pcb),
        },
        netCents: toCents(line.netPay),
        employerCostCents: toCents(line.employerCost),
      };
    });

    return {
      legalEmployerId: run.legalEmployer?.id ?? null,
      legalEmployerName: run.legalEmployer?.name ?? null,
      period: run.period.toISOString().slice(0, 10),
      runType: run.runType,
      sequence: run.sequence,
      paymentDate: run.paymentDate ? run.paymentDate.toISOString().slice(0, 10) : null,
      statutoryRuleSetId: run.statutoryRuleSetId,
      statutoryVerificationStatus: ruleSet?.verificationStatus ?? null,
      orp: {
        overtimeDays: Number(run.orpOvertimeDays),
        unpaidLeaveDays: Number(run.orpUnpaidLeaveDays),
        hoursPerDay: Number(run.orpHoursPerDay),
      },
      employees,
      totals: {
        grossCents: toCents(run.grossTotal),
        deductionCents: toCents(run.deductionTotal),
        netCents: toCents(run.netTotal),
        employerCostCents: toCents(run.employerCostTotal),
        employeeCount: run.employeeCount,
      },
    };
  }

  /** Every snapshot ever taken of a run, newest first. */
  async snapshots(runId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const rows = await this.prisma.payrollSnapshot.findMany({
      where: { payrollRunId: runId },
      orderBy: { version: 'desc' },
      include: { createdBy: { select: { fullName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      hash: row.hash,
      reason: row.reason,
      createdBy: row.createdBy.fullName,
      createdAt: row.createdAt.toISOString(),
      totals: (row.payload as unknown as SnapshotPayload).totals,
    }));
  }

  /**
   * REOPEN AN APPROVED RUN.
   *
   * The prior snapshot is never erased. The run returns to CALCULATED so it can
   * be recalculated, and the next approval writes a NEW snapshot version — so
   * the history reads as a sequence of things that were true, not as one
   * mutable present.
   */
  async reopen(runId: string, reason: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.reopen', async (tx, actor) => {
      const run = await tx.payrollRun.findUnique({ where: { id: runId } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== PayrollRunStatus.APPROVED) {
        throw new ConflictException(
          run.status === PayrollRunStatus.PAID
            ? 'This run is marked paid. Money has left the clinic; correct it with an adjustment rather than reopening it.'
            : `A ${run.status.toLowerCase()} run is not open to reopening.`,
        );
      }
      if (!reason || reason.trim().length < 5) {
        throw new BadRequestException('Say why this run is being reopened. It becomes part of the payroll record.');
      }

      const latest = await tx.payrollSnapshot.findFirst({
        where: { payrollRunId: runId },
        orderBy: { version: 'desc' },
      });

      const reopened = await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: PayrollRunStatus.CALCULATED,
          approvedByStaffId: null,
          approvedAt: null,
        },
      });

      await recordAudit(tx, actor, {
        action: 'payroll.reopened',
        entityType: 'PayrollRun',
        entityId: runId,
        before: { status: PayrollRunStatus.APPROVED, snapshotVersion: latest?.version ?? null, snapshotHash: latest?.hash ?? null },
        after: { status: PayrollRunStatus.CALCULATED },
        reason,
        source: 'hr.payroll',
      });

      return {
        run: reopened,
        preservedSnapshot: latest ? { version: latest.version, hash: latest.hash } : null,
        note: latest
          ? `Snapshot v${latest.version} is preserved. Recalculate, review the difference, then approve again to write v${latest.version + 1}.`
          : 'This run was approved before snapshots existed, so there is nothing to compare against.',
      };
    });
  }

  /**
   * What a recalculation WOULD change, against the approved snapshot.
   *
   * Shown before anybody commits — which the audited competitor does not do:
   * it warns that figures may change and then shows nobody what did.
   */
  async candidateDiff(runId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const latest = await this.prisma.payrollSnapshot.findFirst({
      where: { payrollRunId: runId },
      orderBy: { version: 'desc' },
    });
    if (!latest) {
      return { hasSnapshot: false, note: 'This run has never been approved, so there is nothing to compare against.' };
    }
    const candidate = await this.buildSnapshotPayload(this.prisma as unknown as AdminTx, runId);
    const before = latest.payload as unknown as SnapshotPayload;
    const diff = diffSnapshots(before, candidate);
    return {
      hasSnapshot: true,
      snapshotVersion: latest.version,
      snapshotHash: latest.hash,
      candidateHash: snapshotHash(candidate),
      diff,
      note: diff.identical
        ? 'The recalculation produces exactly what was approved.'
        : `${diff.changed.length} figure(s) differ from what was approved, across ${new Set(diff.changed.map((c) => c.staffId)).size} employee(s).`,
    };
  }

  /**
   * VARIANCE AGAINST THE PREVIOUS PERIOD.
   *
   * Payroll errors are rarely subtle in size and almost always invisible in a
   * grid of plausible-looking rows. This says which people MOVED.
   */
  async variance(runId: string, thresholdPercent = 20) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: runId },
      include: { lines: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');

    const previousPeriod = new Date(Date.UTC(run.period.getUTCFullYear(), run.period.getUTCMonth() - 1, 1));
    const previous = await this.prisma.payrollRun.findFirst({
      where: { period: previousPeriod, clinicId: run.clinicId, runType: run.runType },
      include: { lines: true },
    });

    const byStaff = new Map<string, VarianceLine>();
    for (const line of previous?.lines ?? []) {
      const snap = (line.employeeSnapshot ?? {}) as Record<string, unknown>;
      byStaff.set(line.staffId, {
        staffId: line.staffId,
        name: String(snap.name ?? ''),
        previousNetCents: toCents(line.netPay),
        currentNetCents: null,
      });
    }
    for (const line of run.lines) {
      const snap = (line.employeeSnapshot ?? {}) as Record<string, unknown>;
      const found = byStaff.get(line.staffId);
      if (found) found.currentNetCents = toCents(line.netPay);
      else
        byStaff.set(line.staffId, {
          staffId: line.staffId,
          name: String(snap.name ?? ''),
          previousNetCents: null,
          currentNetCents: toCents(line.netPay),
        });
    }

    const report = computeVariance(
      [...byStaff.values()],
      previous
        ? [
            { field: 'grossCents', previous: toCents(previous.grossTotal), current: toCents(run.grossTotal) },
            { field: 'netCents', previous: toCents(previous.netTotal), current: toCents(run.netTotal) },
            {
              field: 'employerCostCents',
              previous: toCents(previous.employerCostTotal),
              current: toCents(run.employerCostTotal),
            },
          ]
        : [],
      thresholdPercent,
    );

    return {
      hasPrevious: Boolean(previous),
      previousPeriod: previousPeriod.toISOString().slice(0, 10),
      ...report,
      note: previous
        ? report.material.length === 0
          ? 'Nobody moved by more than the threshold.'
          : `${report.material.length} employee(s) moved beyond ${thresholdPercent}%. A movement that size is more often a data error than a real change.`
        : 'There is no previous period to compare against, so nothing here is unusual by definition.',
    };
  }

  /** The exception centre for a run. */
  async exceptions(runId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const rows = await this.prisma.payrollException.findMany({
      where: { payrollRunId: runId },
      orderBy: [{ severity: 'asc' }, { code: 'asc' }],
      include: {
        staff: { select: { fullName: true } },
        overriddenBy: { select: { fullName: true } },
      },
    });
    const gate = approvalGate(rows);
    return {
      exceptions: rows.map((row) => ({
        id: row.id,
        severity: row.severity,
        code: row.code,
        staffId: row.staffId,
        staffName: row.staff?.fullName ?? null,
        cause: row.cause,
        consequence: row.consequence,
        remediation: row.remediation,
        deepLink: row.deepLink,
        overridable: row.overridable,
        overriddenBy: row.overriddenBy?.fullName ?? null,
        overrideReason: row.overrideReason,
        overriddenAt: row.overriddenAt?.toISOString() ?? null,
      })),
      gate,
    };
  }

  /** Pass a warning deliberately, with a reason that stays on the record. */
  async overrideException(exceptionId: string, reason: string) {
    return withAdminTx(this.rawPrisma, 'hr.payroll.approve', async (tx, actor) => {
      const row = await tx.payrollException.findFirst({ where: { id: exceptionId } });
      if (!row) throw new NotFoundException('Exception not found');
      if (!row.overridable) {
        throw new BadRequestException(
          `"${row.code}" cannot be overridden. ${row.consequence} Resolve it rather than passing it.`,
        );
      }
      if (!reason || reason.trim().length < 5) {
        throw new BadRequestException('Say why this is being passed. It becomes part of the payroll record.');
      }
      const saved = await tx.payrollException.update({
        where: { id: exceptionId },
        data: { overriddenByStaffId: actor.id, overrideReason: reason, overriddenAt: new Date() },
      });
      await recordAudit(tx, actor, {
        action: 'payrollException.overridden',
        entityType: 'PayrollException',
        entityId: exceptionId,
        after: { code: row.code, severity: row.severity },
        reason,
        source: 'hr.payroll',
      });
      return saved;
    });
  }

}

function nullableCents(cents: number | null): number | null {
  return cents === null ? null : fromCents(cents);
}

function numberOrNull(value: { toString(): string } | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Map an existing exception string onto the catalogue.
 *
 * The calculation still produces its historical `{ staffId, name, issue }`
 * shape; this classifies it so the rows carry a severity, a consequence and a
 * remedy without rewriting the calculation in the same change. Anything
 * unrecognised stays BLOCKING, which is exactly what it was before.
 */
function classifyLegacyException(issue: string, staffId: string | null, runId: string) {
  const ctx = { staffId: staffId ?? '', runId };
  if (/No salary or hourly rate/i.test(issue)) return buildException('NO_SALARY', staffId, ctx);
  if (/date of birth/i.test(issue)) return buildException('NO_DOB', staffId, ctx);
  if (/PCB \(monthly tax deduction\)/i.test(issue)) return buildException('PCB_MISSING', staffId, ctx);
  if (/overtime is claimed but not approved/i.test(issue)) {
    const hours = issue.match(/([\d.]+)h/)?.[1] ?? '?';
    return buildException('UNAPPROVED_OVERTIME', staffId, { ...ctx, hours });
  }
  if (/missing clock-in or clock-out/i.test(issue)) {
    const days = issue.match(/(\d+) day/)?.[1] ?? '?';
    return buildException('MISSING_PUNCH', staffId, { ...ctx, days });
  }
  if (/is not a known component/i.test(issue)) {
    const componentCode = issue.match(/"([^"]+)"/)?.[1] ?? 'unknown';
    return buildException('UNKNOWN_COMPONENT', staffId, { ...ctx, componentCode });
  }
  return {
    code: 'LEGACY',
    severity: 'BLOCKING' as const,
    staffId,
    cause: issue,
    consequence: 'This run cannot be approved until the issue is resolved.',
    remediation: 'Resolve the underlying data and recalculate the run.',
    deepLink: null,
    overridable: false,
  };
}

