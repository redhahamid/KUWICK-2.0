import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PayrollRunStatus, StatutoryStatus, StatutoryVerificationStatus } from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { AdminTx, actorCan, requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { formatCents, fromCents, toCents } from '../finance/money';
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
import {
  MaterialisedInput,
  materialiseClaim,
  materialiseIncentives,
  materialiseOvertime,
  materialiseUnpaidLeave,
  planMaterialisation,
} from './payroll-materialisation';
import { leaveDaysInYear } from './leave-balance';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { PayrollAdjustmentDto } from './dto/payroll-adjustment.dto';
import { UpsertStatutoryRulesDto } from './dto/upsert-statutory-rules.dto';
import { approvalGate, BuiltException, buildException, ExceptionSeverity } from './payroll-exception';
import { resolveSalaryForPayroll, SalaryRow } from './salary-resolution';
import { diffSnapshots, snapshotHash, SnapshotEmployeeLine, SnapshotPayload } from './payroll-snapshot';
import { computeVariance, VarianceLine } from './payroll-variance';
import {
  EmployeeFigures,
  checkMembership,
  checkPayrollInvariants,
  describeViolations,
} from './payroll-invariants';

/// Components that reduce pay whichever way the amount is entered. Everything
/// else is an earning unless the amount itself is negative.
const DEDUCTION_COMPONENTS = new Set([
  'UNPAID_LEAVE', 'ZAKAT', 'ADVANCE_RECOVERY', 'UNIFORM', 'OTHER_DEDUCTION',
]);

/**
 * The Employment Act's minimum for overtime on a normal working day. Rest-day
 * and public-holiday tiers are supported by the engine and are clinic
 * configuration; this is the only one applied automatically, and it is named
 * rather than inlined so it is findable when the tiers become configurable.
 */
const OVERTIME_NORMAL_DAY_MULTIPLIER = 1.5;

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

      // EMPLOYEES ONLY.
      //
      // A contractor is paid under a contract FOR services. Their fee is a
      // payable, not salary; it attracts no EPF, SOCSO or EIS, and carrying
      // one into a payroll run does not merely misclassify them — it
      // contributes on their behalf to schemes they are not a member of.
      //
      // This is a WHERE clause rather than an exception on purpose. A
      // contractor is not an employee who cannot be paid; they are somebody
      // this run is not about, and a blocker for every locum every month would
      // train the owner to click past blockers.
      const employees = await tx.employeeProfile.findMany({
        where: {
          engagement: 'EMPLOYEE',
          employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
          ...(run.clinicId ? { staff: { clinicId: run.clinicId } } : {}),
        },
        include: { staff: { select: { id: true, fullName: true, active: true, clinicId: true, role: true } } },
        // Deterministic order, so two calculations of the same run produce the
        // same exception list in the same sequence.
        orderBy: { staffId: 'asc' },
      });

      // Who was left out, and why — visible on the run rather than only in the
      // absence of a payslip. An INFO row never blocks approval.
      const contractors = await tx.employeeProfile.findMany({
        where: {
          engagement: 'CONTRACTOR',
          employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
          ...(run.clinicId ? { staff: { clinicId: run.clinicId } } : {}),
        },
        include: { staff: { select: { fullName: true, active: true } } },
        orderBy: { staffId: 'asc' },
      });

      // EXCEPTIONS ARE BUILT, NOT PARSED.
      //
      // They used to be free text that a regex mapped back onto the catalogue
      // on the way to the database — so the severity, consequence and remedy of
      // every blocker depended on a sentence surviving unchanged. A blocker
      // that has to carry four facts (what the salary was, what it became, the
      // day it changed, which month) cannot survive that round trip.
      const exceptions: (BuiltException & { name: string })[] = [];
      const raise = (
        code: string,
        employee: { staffId: string; staff: { fullName: string } },
        ctx: Record<string, string | number> = {},
      ) => {
        exceptions.push({
          ...buildException(code, employee.staffId, { staffId: employee.staffId, runId, ...ctx }),
          name: employee.staff.fullName,
        });
      };

      // CANONICAL SALARY. One query for the whole run rather than one per
      // employee, and `EmployeeProfile.basicSalary` is no longer read: what
      // somebody earned in March is the rate that was in force in March.
      const salaryRows = await tx.employeeSalary.findMany({
        where: { staffId: { in: employees.map((e) => e.staffId) } },
        orderBy: { effectiveFrom: 'asc' },
      });
      const salaryByStaff = new Map<string, SalaryRow[]>();
      for (const row of salaryRows) {
        const list = salaryByStaff.get(row.staffId) ?? [];
        list.push({
          id: row.id,
          basis: row.basis,
          amountCents: toCents(row.amount),
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
        });
        salaryByStaff.set(row.staffId, list);
      }
      // Overtime approvers, resolved once. A name per attendance row would be
      // one query per employee per calculation for a value that repeats.
      const approverNames = new Map<string, string>(
        (
          await tx.staff.findMany({
            where: {
              overtimeApprovals: {
                some: { workDate: { gte: period, lt: periodEnd }, overtimeApproved: true },
              },
            },
            select: { id: true, fullName: true },
          })
        ).map((row) => [row.id, row.fullName]),
      );

      const lastDayOfPeriod = new Date(periodEnd.getTime() - 86400000);
      const periodLabel = period.toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
      // Every payslip's figures, kept so the run's own totals can be checked
      // against the rows that produced them rather than trusted.
      const paidEmployees: EmployeeFigures[] = [];
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

        const salary = resolveSalaryForPayroll(
          salaryByStaff.get(employee.staffId) ?? [],
          period,
          lastDayOfPeriod,
        );
        if (salary.kind === 'NO_SALARY') {
          raise('NO_SALARY', employee);
          continue;
        }
        if (salary.kind === 'CHANGED_MID_PERIOD') {
          // Refuse rather than prorate. See SALARY_CHANGED_MID_PERIOD.
          raise('SALARY_CHANGED_MID_PERIOD', employee, {
            previousAmount: formatCents(salary.previous.amountCents),
            nextAmount: formatCents(salary.next.amountCents),
            changedOn: salary.changedOn.toISOString().slice(0, 10),
            periodLabel,
          });
          continue;
        }
        if (salary.row.basis !== 'MONTHLY') {
          raise('SALARY_BASIS_UNSUPPORTED', employee, { basis: salary.row.basis });
          continue;
        }

        const [attendance, leave, incentives, inputs, claims] = await Promise.all([
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
            include: { approvedBy: { select: { fullName: true } } },
          }),
          tx.incentiveResult.findMany({
            where: {
              staffId: employee.staffId,
              incentiveRun: { period, status: { in: ['APPROVED', 'PAID'] } },
            },
            include: { incentiveRun: { select: { approvedBy: { select: { fullName: true } } } } },
          }),
          // What a person supplied for this period: allowances, bonus and PCB —
          // which this system does not calculate.
          tx.payrollInputEntry.findMany({ where: { staffId: employee.staffId, period } }),
          // APPROVED claims the approver routed to PAYROLL. A claim routed to
          // FINANCE is deliberately not here: it is reimbursed separately, and
          // reading it would be the double payment the route exists to prevent.
          tx.staffClaim.findMany({
            where: {
              staffId: employee.staffId,
              status: 'APPROVED',
              paymentRoute: 'PAYROLL',
              payrollPeriod: period,
            },
            include: { decidedBy: { select: { fullName: true } } },
          }),
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
          raise('UNAPPROVED_OVERTIME', employee, {
            hours: Math.round(timesheet.unapprovedOvertimeMinutes / 6) / 10,
          });
        }
        if (timesheet.daysMissingPunch > 0) {
          raise('MISSING_PUNCH', employee, { days: timesheet.daysMissingPunch });
        }

        const basicCents = salary.row.amountCents;

        // AGE DRIVES THE SCHEME, not just the rate: at 60 the employee's EPF
        // share goes to nil and the employer's to 4%, SOCSO moves to the Second
        // Category, and EIS ceases. An unknown date of birth is therefore a
        // BLOCKING exception, not a reason to assume "under 60" — assuming
        // would under-contribute for the whole workforce and nobody would see it.
        const age = ageAt(employee.dateOfBirth, new Date(periodEnd.getTime() - 86400000));
        if (age === null) {
          raise('NO_DOB', employee);
          continue;
        }

        // Unpaid leave, from the leave TYPE — a clinic's own policy decides
        // which types are unpaid, and this reads that rather than assuming.
        //
        // Kept PER REQUEST rather than summed straight to a number, so the
        // materialised deduction can name the request behind it and the person
        // who approved it. "1 unpaid day" with no way back to the leave record
        // is what made payroll feel like a second place to key facts.
        const unpaidTypes = new Set(['UNPAID']);
        const unpaidLeaveRows = leave
          .filter((row) => unpaidTypes.has(row.leaveType))
          .map((row) => ({
            id: row.id,
            leaveType: row.leaveType,
            startDate: row.startDate,
            endDate: row.endDate,
            approverName: row.approvedBy?.fullName ?? null,
            days: leaveDaysInYear(
              {
                startDate: row.startDate > period ? row.startDate : period,
                endDate: row.endDate < periodEnd ? row.endDate : new Date(periodEnd.getTime() - 86400000),
              },
              period.getUTCFullYear(),
            ),
          }));
        const unpaidDays = unpaidLeaveRows.reduce((total, row) => total + row.days, 0);

        // The Ordinary Rate of Pay is built from the earnings that COUNT toward
        // it — basic and ORP-liable allowances — and never from overtime, or an
        // hour of overtime would raise the rate paid for the next one.
        const orpBase = basicCents;
        const rates = ordinaryRates(orpBase, orpConfig);

        // -------------------------------------------------------------------
        // MATERIALISATION — upstream facts become reviewable rows.
        //
        // Overtime, unpaid leave, incentives and approved claims were read live
        // and turned straight into payslip lines, so the earnings step could
        // show a figure and nothing on screen could say where it came from, who
        // approved it, or when. Each is now a `payroll_input_entries` row
        // carrying its source, the upstream record id and a sentence of
        // provenance — and each is idempotent on that upstream row, so
        // recalculating cannot pay anybody twice.
        // -------------------------------------------------------------------
        const overtimeHours = timesheet.approvedOvertimeMinutes / 60;
        const hourlyCents = rates.overtimeHourlyCents;
        const overtimeApprover =
          attendance.find((row) => row.overtimeApproved && row.overtimeApprovedByStaffId)?.overtimeApprovedByStaffId ??
          null;

        const desiredInputs = [
          materialiseOvertime({
            staffId: employee.staffId,
            approvedOvertimeMinutes: timesheet.approvedOvertimeMinutes,
            overtimeHourlyCents: hourlyCents,
            multiplier: OVERTIME_NORMAL_DAY_MULTIPLIER,
            sourceRecordIds: attendance.filter((r) => r.overtimeApproved).map((r) => r.id),
            approverName: overtimeApprover ? (approverNames.get(overtimeApprover) ?? null) : null,
          }),
          materialiseUnpaidLeave(
            unpaidLeaveRows.map((row) => ({
              staffId: employee.staffId,
              leaveRequestId: row.id,
              leaveType: row.leaveType,
              unpaidDays: row.days,
              dailyRateCents: rates.unpaidLeaveDailyCents,
              approverName: row.approverName,
              startDate: row.startDate,
              endDate: row.endDate,
            })),
          ),
          materialiseIncentives(
            incentives.map((row) => ({
              staffId: employee.staffId,
              incentiveResultId: row.id,
              incentiveRunId: row.incentiveRunId,
              amountCents: toCents(row.amount),
              earnedPeriod: period,
              approverName: row.incentiveRun.approvedBy?.fullName ?? null,
            })),
          ),
          ...claims.map((claim) =>
            materialiseClaim({
              staffId: employee.staffId,
              claimId: claim.id,
              category: claim.category,
              amountCents: toCents(claim.amountApproved ?? 0),
              claimDate: claim.claimDate,
              approverName: claim.decidedBy?.fullName ?? null,
            }),
          ),
        ].filter((row): row is MaterialisedInput => row !== null);

        const plan = planMaterialisation(
          desiredInputs,
          inputs.map((row) => ({
            id: row.id,
            componentCode: row.componentCode,
            source: row.source,
            amountCents: toCents(row.amount),
            sourceRecordId: row.sourceRecordId,
          })),
        );

        for (const want of plan.create) {
          const created = await tx.payrollInputEntry.create({
            data: {
              tenantId: currentTenantId(),
              clinicId: run.clinicId,
              staffId: want.staffId,
              period,
              componentCode: want.componentCode,
              label: want.label,
              amount: fromCents(want.amountCents),
              source: want.source,
              sourceRecordId: want.sourceRecordId,
              kind: 'ADDITIONAL',
              reason: want.provenance,
              earnedPeriod: want.earnedPeriod,
              createdByStaffId: actor.id,
            },
          });
          if (want.source === 'CLAIM' && want.sourceRecordId) {
            await this.linkClaimToInput(tx, want.sourceRecordId, created.id, period);
          }
        }
        for (const change of plan.update) {
          await tx.payrollInputEntry.update({
            where: { id: change.id },
            data: {
              amount: fromCents(change.input.amountCents),
              label: change.input.label,
              reason: change.input.provenance,
              earnedPeriod: change.input.earnedPeriod,
            },
          });
        }
        if (plan.remove.length > 0) {
          // An upstream fact that no longer justifies an input — overtime
          // rejected after a first calculation, a claim withdrawn — must stop
          // being paid. The claim link is released first so the claim can be
          // routed again.
          await tx.staffClaim.updateMany({
            where: { payrollInputEntryId: { in: plan.remove } },
            data: { payrollInputEntryId: null, payoutStatus: 'PENDING' },
          });
          await tx.payrollInputEntry.deleteMany({ where: { id: { in: plan.remove } } });
        }

        // Re-read: the payslip is built from the MATERIALISED rows, not from the
        // in-memory derivation. One source of truth for what this period pays,
        // and the same rows the earnings screen shows.
        const materialised = await tx.payrollInputEntry.findMany({
          where: { staffId: employee.staffId, period },
        });

        const overtimeCents = materialised
          .filter((row) => row.componentCode === 'OVERTIME')
          .reduce((sum, row) => sum + toCents(row.amount), 0);
        const unpaidCents = materialised
          .filter((row) => row.componentCode === 'UNPAID_LEAVE')
          .reduce((sum, row) => sum + toCents(row.amount), 0);
        const incentiveCents = materialised
          .filter((row) => row.componentCode === 'INCENTIVE')
          .reduce((sum, row) => sum + toCents(row.amount), 0);

        // Components carry their own statutory liability, so the three bases
        // come out different — overtime is SOCSO and EIS wages but not EPF
        // wages. See docs/HR_PAYROLL_EXCEL_REFERENCE_AUDIT.md section 1.3.
        //
        // EVERY LINE BUT BASIC PAY COMES FROM A MATERIALISED INPUT ROW. Overtime,
        // unpaid leave and incentives used to be pushed here from in-memory
        // derivations AND read again from the input table, which is how a
        // derived figure could be counted twice the moment it also existed as a
        // row. There is now one source: the rows.
        const componentLines: PayrollComponentLine[] = [
          { code: 'BASIC', label: 'Basic pay', kind: 'EARNING', amount: fromCents(basicCents), liability: DEFAULT_COMPONENT_LIABILITY.BASIC },
        ];

        // PCB is a supplied amount, not a computed one, so it is taken out of
        // the component list and applied as an override further down.
        const pcbInput = materialised.find((row) => row.componentCode === 'PCB');
        const pcbOverrideCents = pcbInput ? toCents(pcbInput.amount) : null;

        for (const input of materialised) {
          if (input.componentCode === 'PCB') continue;
          const liability = DEFAULT_COMPONENT_LIABILITY[input.componentCode];
          if (!liability) {
            // An input naming a component this build does not know would
            // otherwise be silently dropped from somebody's pay.
            raise('UNKNOWN_COMPONENT', employee, { componentCode: input.componentCode });
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
            raise('PCB_MISSING', employee);
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
          exceptions.push({
            ...buildException('STATUTORY_BAND_GAP', employee.staffId, {
              staffId: employee.staffId,
              runId,
              note,
            }),
            name: employee.staff.fullName,
          });
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
              overtimeTiers:
                overtimeCents > 0
                  ? [{
                      label: `Normal day (${OVERTIME_NORMAL_DAY_MULTIPLIER}x)`,
                      hours: Math.round(overtimeHours * 100) / 100,
                      hourlyRate: fromCents(Math.round(hourlyCents * OVERTIME_NORMAL_DAY_MULTIPLIER)),
                      total: fromCents(overtimeCents),
                    }]
                  : [],
              // WHERE EVERY DERIVED FIGURE CAME FROM, on the payslip itself.
              // The earnings screen reads the same rows; this is so a payslip
              // printed today still explains itself in a year.
              provenance: materialised
                .filter((row) => row.source !== 'MANUAL')
                .map((row) => ({
                  component: row.componentCode,
                  amount: fromCents(toCents(row.amount)),
                  source: row.source,
                  sourceRecordId: row.sourceRecordId,
                  explanation: row.reason,
                  earnedPeriod: row.earnedPeriod?.toISOString().slice(0, 10) ?? null,
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

        paidEmployees.push({
          staffId: employee.staffId,
          name: employee.staff.fullName,
          grossCents: payslip.grossCents,
          employeeDeductionCents: payslip.employeeDeductionCents,
          netCents: payslip.netCents,
          employerContributionCents: payslip.employerContributionCents,
          employerCostCents: payslip.employerCostCents,
        });

        grossTotal += payslip.grossCents;
        deductionTotal += payslip.employeeDeductionCents;
        netTotal += payslip.netCents;
        employerCostTotal += payslip.employerCostCents;
        counted += 1;
      }

      // ---------------------------------------------------------------------
      // INVARIANTS. The arithmetic the run asserts about itself.
      //
      // A violation here is a BUG in the calculation, not a data problem: it
      // means the payslips and the totals written above them disagree. Failing
      // loudly is the only safe response, because a wrong total is
      // indistinguishable from a right one by looking at it.
      // ---------------------------------------------------------------------
      const violations = [
        ...checkPayrollInvariants(paidEmployees, {
          grossCents: grossTotal,
          deductionCents: deductionTotal,
          netCents: netTotal,
          employerCostCents: employerCostTotal,
          employeeCount: counted,
        }),
        ...checkMembership(
          paidEmployees.map((e) => e.staffId),
          exceptions.filter((e) => e.staffId).map((e) => ({ staffId: e.staffId as string, reason: e.code })),
          employees.filter((e) => e.staff.active).map((e) => e.staffId),
        ),
      ];
      if (violations.length > 0) {
        throw new ConflictException(
          `${describeViolations(violations)} ` +
            violations.slice(0, 3).map((v) => v.message).join(' '),
        );
      }

      for (const contractor of contractors) {
        if (!contractor.staff.active) continue;
        exceptions.push({
          ...buildException('CONTRACTOR_EXCLUDED', contractor.staffId, {
            staffId: contractor.staffId,
            runId,
            name: contractor.staff.fullName,
          }),
          name: contractor.staff.fullName,
        });
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
          // The legacy blob is DERIVED from the built exceptions rather than
          // being their source, so the two cannot disagree.
          exceptions: exceptions.map((e) => ({
            staffId: e.staffId,
            name: e.name,
            issue: e.cause,
          })) as never,
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
      for (const built of exceptions) {
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
   * Bind a claim to the input that carries it.
   *
   * The link is UNIQUE in the database, so a second attempt to materialise the
   * same claim — a re-run against a stale plan, two runs covering one period —
   * fails on the constraint rather than quietly paying it twice. The failure is
   * translated here into something a person can act on, because "unique
   * constraint violated" tells a clinic manager nothing.
   */
  private async linkClaimToInput(tx: AdminTx, claimId: string, inputId: string, period: Date) {
    const claim = await tx.staffClaim.findFirst({ where: { id: claimId } });
    if (!claim) return;
    if (claim.payrollInputEntryId && claim.payrollInputEntryId !== inputId) {
      throw new ConflictException(
        `Claim ${claimId} is already being paid through another payroll input. A claim is paid once, by one route.`,
      );
    }
    if (claim.paymentRoute !== 'PAYROLL') {
      throw new ConflictException(
        `Claim ${claimId} was approved for separate reimbursement by Finance, so it must not reach a payslip.`,
      );
    }
    await tx.staffClaim.update({
      where: { id: claimId },
      data: { payrollInputEntryId: inputId, payoutStatus: 'IN_PAYROLL', payrollPeriod: period },
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
        // THE ROWS, not the blob. This column is the first thing anybody reads
        // about a run, and it has to be the same fact the Approve button acts
        // on. Selected down to the three fields the gate needs, so listing a
        // year of runs does not drag every cause string across the wire.
        exceptionRows: { select: { severity: true, overridable: true, overriddenByStaffId: true } },
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
      exceptions: approvalGate(run.exceptionRows),
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
      // NO EXCEPTION STATE HERE, deliberately.
      //
      // It used to return the legacy JSON blob, which the banner rendered while
      // the approval gate read the `payroll_exceptions` rows — two stores of
      // one fact, free to disagree, and they did. The detail payload no longer
      // carries exceptions in any form, so the screen has nowhere to read them
      // from except `GET /payroll/runs/:id/exceptions`. A second source cannot
      // creep back in without adding a field back here first.
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


