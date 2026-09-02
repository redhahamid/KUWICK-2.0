import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  PayrollApprovalMode as PayrollApprovalModeEnum,
  PayrollRunStatus,
  StatutoryStatus,
  StatutoryVerificationStatus,
  SystemRole,
} from '@prisma/client';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import {
  Permission,
  can,
  isCustomRoleGrantable,
  isIndividuallyGrantable,
} from '../core/permissions';
import { AdminTx, actorCan, requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { formatCents, fromCents, toCents } from '../finance/money';
import {
  DEFAULT_COMPONENT_LIABILITY,
  LIABILITY_BY_STATUS_CODE,
  PayrollComponentLine,
  StatutoryContext,
  ageAt,
  computeOvertime,
  computePayslip,
  ordinaryRates,
  statutoryStatusOf,
  unpaidLeaveDeductionCents,
} from './payroll-calculation';
import {
  SCHEMES_WITHOUT_A_SCHEDULE,
  STATUTORY_SCHEDULES,
  meetsApprovalBar,
  stampFor,
} from '../statutory/registry';
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
import { describeProration, proratedBasicCents, prorationFor } from './proration';
import { CreatePayrollRunDto } from './dto/create-payroll-run.dto';
import { PayrollAdjustmentDto } from './dto/payroll-adjustment.dto';
import { UpsertStatutoryRulesDto } from './dto/upsert-statutory-rules.dto';
import {
  ApprovalPolicy,
  PayrollApprovalMode,
  approvalsRequired,
  decideApproval,
  describeApprovalMode,
} from './payroll-approval-rule';
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

  /**
   * The schedules that govern, which are no longer the tenant's to write.
   *
   * These rows used to come from `StatutoryRuleSet`: an effective-dated table a
   * clinic administrator could type rates into. The shape was right and the
   * ownership was wrong. EPF, SOCSO and EIS rates are not a tenant preference —
   * they are identical for every employer in Malaysia, and a screen that lets
   * one clinic enter different ones is a screen that lets a clinic under-
   * contribute by accident and call it configuration.
   *
   * They now come from `src/statutory/registry.ts`, transcribed from the
   * authorities' own documents and dated by when each took effect. The row
   * shape is unchanged so the settings page keeps working; what changed is that
   * `verified` is now a property of the evidence rather than a checkbox
   * somebody ticked.
   */
  async listStatutoryRuleSets() {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    return STATUTORY_SCHEDULES.map((schedule) => ({
      id: schedule.id,
      name: `${schedule.scheme} — ${schedule.section}`,
      jurisdiction: 'MY',
      effectiveFrom: schedule.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: schedule.effectiveTo?.toISOString().slice(0, 10) ?? null,
      verified: meetsApprovalBar(schedule.verification),
      verifiedAt: null,
      verifiedBy: schedule.authority,
      verificationNote: schedule.evidence,
      verification: schedule.verification,
      authority: schedule.authority,
      document: schedule.document,
      contentHash: schedule.contentHash,
      hasEpf: schedule.scheme === 'EPF',
      hasSocso: schedule.scheme === 'SOCSO',
      hasEis: schedule.scheme === 'EIS',
      hasPcb: schedule.scheme === 'PCB',
      status: meetsApprovalBar(schedule.verification)
        ? ('CONFIGURED' as const)
        : ('PROVISIONAL' as const),
    }));
  }

  /** Schemes with no schedule at all, so a screen can name the gap. */
  async listStatutoryGaps() {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    return SCHEMES_WITHOUT_A_SCHEDULE.map((gap) => ({ ...gap }));
  }

  /**
   * Writing statutory rates is refused, and the refusal is the feature.
   *
   * This used to accept EPF, SOCSO, EIS and PCB tables as JSON and let whoever
   * held `hr.payroll.approve` mark them verified. Two things were wrong with
   * that. A clinic cannot legislate: the Third Schedule says what it says, and
   * a tenant-entered variant of it is not a configuration choice but an error
   * waiting to be discovered by KWSP. And "verified" meant a person had ticked
   * a box, which is indistinguishable on screen from a figure actually checked
   * against the authority's own document.
   *
   * Rates now come from `src/statutory/registry.ts`, so there is nothing here
   * to write. The endpoint stays rather than disappearing, because a 404 would
   * read as a bug to anyone who had bookmarked the old screen, while this says
   * what happened and where the numbers went.
   */
  async upsertStatutoryRules(_dto: UpsertStatutoryRulesDto) {
    await requirePermission(this.rawPrisma, 'hr.payroll.approve');
    throw new BadRequestException(
      'Statutory rates are no longer entered by hand. EPF, SOCSO, EIS and PCB come from the ' +
        'authorities’ own published schedules, which ship with Kuwick, are dated by when each took ' +
        'effect, and are stamped onto every payroll run so a payslip can always be traced back to the ' +
        'edition that produced it. Nothing here needs configuring.',
    );
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

      // Which schedules govern is decided by the PERIOD, never by today: a
      // September run re-calculated in December must not acquire December's
      // rates.
      const statutoryContext: StatutoryContext = { periodEnd };
      const statutoryStatus = statutoryStatusOf(periodEnd) as StatutoryStatus;
      const statutoryStamp = stampFor(['EPF', 'SOCSO', 'EIS', 'PCB'], periodEnd);

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

      // WHO WAS LEFT OUT, AND WHY — recorded where the decision is taken rather
      // than inferred afterwards.
      //
      // Not every exception excludes somebody. A missing punch or an
      // unapproved overtime hour is raised AGAINST a payslip that is still
      // produced; only the reasons below stop the calculation for that person.
      // Reading "has an exception" as "was not paid" would make every
      // still-paid employee with a warning look like a contradiction.
      const excluded: { staffId: string; reason: string }[] = [];
      const exclude = (
        code: string,
        employee: { staffId: string; staff: { fullName: string } },
        ctx: Record<string, string | number> = {},
      ) => {
        raise(code, employee, ctx);
        excluded.push({ staffId: employee.staffId, reason: code });
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
          exclude('NO_SALARY', employee);
          continue;
        }
        if (salary.kind === 'CHANGED_MID_PERIOD') {
          // Refuse rather than prorate. See SALARY_CHANGED_MID_PERIOD.
          exclude('SALARY_CHANGED_MID_PERIOD', employee, {
            previousAmount: formatCents(salary.previous.amountCents),
            nextAmount: formatCents(salary.next.amountCents),
            changedOn: salary.changedOn.toISOString().slice(0, 10),
            periodLabel,
          });
          continue;
        }
        if (salary.row.basis !== 'MONTHLY') {
          exclude('SALARY_BASIS_UNSUPPORTED', employee, { basis: salary.row.basis });
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

        // s.18A — AN INCOMPLETE MONTH IS PAID BY DAYS.
        //
        // Nothing here consulted the date somebody started or finished, so a
        // joiner on the 20th was paid a whole month and so was a leaver who
        // went on the 3rd. Both figures reached a payslip looking correct.
        //
        // The divisor is the days in THIS wage period, not 26: s.60I(1A)'s 26
        // prices an hour of overtime and answers a different question. The
        // ordinary rate below therefore keeps using the FULL monthly wage, or a
        // joiner's first month of overtime would be cheaper than every month
        // after it.
        const proration = prorationFor({
          periodStart: period,
          periodEnd,
          daysInPeriod: days,
          startDate: employee.startDate,
          endDate: employee.endDate,
        });
        if (proration.outsidePeriod) {
          // Not a payslip for nought days — they simply are not on this
          // payroll. Usually a leaver whose record is still marked active.
          exclude('NOT_EMPLOYED_IN_PERIOD', employee, {
            startDate: employee.startDate?.toISOString().slice(0, 10) ?? '',
            endDate: employee.endDate?.toISOString().slice(0, 10) ?? '',
          });
          continue;
        }
        const fullMonthlyCents = salary.row.amountCents;
        const basicCents = proratedBasicCents(fullMonthlyCents, proration, days);
        const prorationNote = describeProration(proration, days);
        if (prorationNote) {
          // INFO, not a blocker. A part-month is a normal event; what is not
          // acceptable is it happening invisibly.
          raise('PART_MONTH', employee, { note: prorationNote });
        }

        // AGE DRIVES THE SCHEME, not just the rate: at 60 the employee's EPF
        // share goes to nil and the employer's to 4%, SOCSO moves to the Second
        // Category, and EIS ceases. An unknown date of birth is therefore a
        // BLOCKING exception, not a reason to assume "under 60" — assuming
        // would under-contribute for the whole workforce and nobody would see it.
        // NO EMPLOYING COMPANY, NO FILING. EPF, SOCSO, EIS and PCB are all
        // submitted BY an entity, so an employee attached to none of them
        // produces a payslip whose contributions could never be filed.
        //
        // The exception has been in the catalogue as BLOCKING since Stage 1 and
        // nothing ever raised it, so the rule the system claimed to enforce was
        // enforced nowhere. Found while writing year-to-date, which has to be
        // keyed by employer and was silently skipping anybody without one.
        if (!employee.legalEmployerId) {
          raise('NO_LEGAL_EMPLOYER', employee);
        }

        const age = ageAt(employee.dateOfBirth, new Date(periodEnd.getTime() - 86400000));
        if (age === null) {
          exclude('NO_DOB', employee);
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
        // THE FULL monthly wage, never the prorated one — see the s.18A note.
        const orpBase = fullMonthlyCents;
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

        const payslip = computePayslip(componentLines, statutoryContext, {
          age,
          epfMembership: employee.epfMembership,
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
        // THE FAIL-SAFE. A statutory figure that came back NULL is unknown, not
        // nil, and an unknown contribution must stop the run rather than reach
        // a payslip as a blank somebody reads as zero.
        //
        // Raised from the FIGURES rather than from the notes. The previous
        // version matched a regex against the note text, which meant the gate
        // depended on wording: rephrasing a message silently opened it, and
        // that is exactly what happened when the engines began reporting
        // "membership has to be recorded" instead of "the schedule is
        // incomplete".
        //
        // Run-level gaps are NOT raised here. "No schedule is in force for this
        // period" is a property of the run, carried by `statutoryStatus` and
        // gated by the acknowledge-the-gap flow on approval; repeating it once
        // per employee per scheme buried the real exceptions under noise.
        for (const [scheme, contribution] of [
          ['EPF', payslip.statutory.epf],
          ['SOCSO', payslip.statutory.socso],
          ['EIS', payslip.statutory.eis],
        ] as const) {
          if (contribution.employeeCents !== null && contribution.employerCents !== null) continue;
          if (statutoryStatus === 'NOT_CONFIGURED') continue;
          exceptions.push({
            ...buildException('STATUTORY_UNKNOWN', employee.staffId, {
              staffId: employee.staffId,
              runId,
              note: contribution.note ?? `${scheme} could not be worked out for this employee.`,
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
          excluded,
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
          // No tenant rule set drives a calculation any more; the column stays
          // for the runs that were calculated when one did.
          statutoryRuleSetId: null,
          // WHICH schedules produced these figures — id, effective date,
          // verification state and a hash of the actual bands, per scheme. The
          // hash is the part that matters: a version string can be edited to
          // say anything, whereas re-running a period against an edited table
          // produces a different hash and the mismatch is visible.
          statutorySnapshot: statutoryStamp as never,
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
   * One `EmployeeYtd` row per employee per month, from an approved run.
   *
   * IDEMPOTENT BY CONSTRUCTION. `payrollRunId` is stored on the row and the
   * unique key is (employer, staff, year, month), so reopening a run,
   * correcting it and approving again REPLACES the month rather than adding to
   * it. Accumulating instead would double somebody's year-to-date the first
   * time a clinic corrected a payroll, and the error would only surface at
   * year end in a Form EA nobody could reconcile.
   *
   * A NULL statutory figure is stored as it was computed — nought — but the
   * run that carried it could not have been approved without somebody
   * acknowledging the gap, and that acknowledgement is on the approval row.
   * The alternative, refusing to write YTD at all for such a run, leaves a hole
   * in the cumulative record that every later month would silently inherit.
   */
  private async writeYearToDate(tx: AdminTx, runId: string, period: Date, actorStaffId: string) {
    const lines = await tx.payrollLine.findMany({ where: { payrollRunId: runId } });
    if (lines.length === 0) return;

    const taxYear = period.getUTCFullYear();
    const month = period.getUTCMonth() + 1;
    const employers = await tx.employeeProfile.findMany({
      where: { staffId: { in: lines.map((line) => line.staffId) } },
      select: { staffId: true, legalEmployerId: true },
    });
    const employerOf = new Map(employers.map((row) => [row.staffId, row.legalEmployerId]));

    for (const line of lines) {
      const legalEmployerId = employerOf.get(line.staffId);
      // An employee with no legal employer cannot reach an approved run — the
      // calculation raises NO_LEGAL_EMPLOYER, which is blocking — so this is a
      // guard rather than a case.
      if (!legalEmployerId) continue;

      const breakdown = (line.breakdown ?? {}) as { additionalRemunerationCents?: number };
      const cents = (value: unknown) => (value === null || value === undefined ? 0 : toCents(value as never));

      const data = {
        tenantId: currentTenantId(),
        legalEmployerId,
        staffId: line.staffId,
        taxYear,
        month,
        grossCents: cents(line.grossPay),
        // Bonus and incentive are ADDITIONAL remuneration for tax and are taxed
        // by a different part of the MTD method from normal monthly pay, so the
        // year-to-date has to keep them apart rather than only carrying a total.
        additionalRemunerationCents: breakdown.additionalRemunerationCents ?? cents(line.bonus) + cents(line.incentives),
        pcbCents: cents(line.pcb),
        zakatCents: 0,
        epfEmployeeCents: cents(line.epfEmployee),
        epfEmployerCents: cents(line.epfEmployer),
        socsoEmployeeCents: cents(line.socsoEmployee),
        socsoEmployerCents: cents(line.socsoEmployer),
        eisEmployeeCents: cents(line.eisEmployee),
        eisEmployerCents: cents(line.eisEmployer),
        source: 'CALCULATED' as const,
        payrollRunId: runId,
        createdByStaffId: actorStaffId,
      };

      await tx.employeeYtd.upsert({
        where: {
          legalEmployerId_staffId_taxYear_month: { legalEmployerId, staffId: line.staffId, taxYear, month },
        },
        update: data,
        create: data,
      });
    }
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
      // SEPARATION OF DUTIES, from a setting rather than a hard-coded rule.
      //
      // This used to be "the maker cannot approve, unless they hold
      // settings.manage" — right for a group with a finance department, wrong
      // for a single-doctor clinic, and invisible to both. The clinic chooses
      // now, and the rule in force is recorded on the approval so a run
      // approved last year can still say what it was approved under.
      //
      // Read BEFORE the exception gate on purpose: "you may not approve your
      // own run" is a different conversation from "this run has problems", and
      // telling somebody to go fix five exceptions they were never going to be
      // allowed to approve wastes their afternoon.
      const policy = await this.readApprovalPolicy(tx);
      const priorApprovals = await tx.payrollRunApproval.findMany({
        where: { payrollRunId: runId },
        orderBy: { sequence: 'asc' },
        select: { staffId: true },
      });
      const decision = decideApproval(policy, {
        actorStaffId: actor.id,
        actorIsOwner: actorCan(actor, 'settings.manage'),
        makerStaffId: run.createdByStaffId,
        existing: priorApprovals,
      });
      if (decision.outcome === 'REFUSE') {
        throw new ForbiddenException(decision.reason);
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

      // ONE ROW PER APPROVER. Under DUAL_APPROVAL there are two, and the
      // unique constraint on (run, staff) is what makes them two DIFFERENT
      // people — approving twice cannot satisfy a rule whose entire purpose is
      // a second pair of eyes.
      await tx.payrollRunApproval.create({
        data: {
          tenantId: currentTenantId(),
          payrollRunId: runId,
          staffId: actor.id,
          sequence: decision.sequence,
          mode: policy.mode as PayrollApprovalModeEnum,
          usedOwnerSelfApproval: decision.usedOwnerSelfApproval,
          statutoryGapAcknowledged: acknowledgeStatutoryGap,
        },
      });

      // A FIRST APPROVAL IS NOT AN APPROVAL. The run stays CALCULATED, nothing
      // locks, no snapshot is taken, and the response says who is still needed
      // — so nobody reads "approved" off a run one person has looked at.
      if (decision.outcome === 'RECORD_AND_WAIT') {
        await recordAudit(tx, actor, {
          action: 'payrollApproval.recorded',
          entityType: 'PayrollRun',
          entityId: runId,
          after: {
            sequence: decision.sequence,
            of: approvalsRequired(policy.mode),
            mode: policy.mode,
            usedOwnerSelfApproval: decision.usedOwnerSelfApproval,
          },
          source: 'hr.payroll',
        });
        return {
          ...run,
          approvalState: {
            complete: false,
            given: decision.sequence,
            required: approvalsRequired(policy.mode),
            message: decision.reason,
          },
        };
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

      // YEAR TO DATE, written from the run that was just approved.
      //
      // The table existed and nothing ever wrote to it, which is why a lawful
      // PCB was impossible in principle rather than merely unimplemented: the
      // Computerised Calculation method is cumulative, and there was no
      // cumulative anything.
      //
      // Written on APPROVAL rather than on calculation, because a calculation
      // is a draft that may be run five times before anybody agrees with it,
      // and year-to-date figures that move under a draft are worse than none.
      await this.writeYearToDate(tx, runId, run.period, actor.id);

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
          approvalMode: policy.mode,
          approvals: decision.sequence,
          usedOwnerSelfApproval: decision.usedOwnerSelfApproval,
        },
        source: 'hr.payroll',
      });
      return {
        ...approved,
        approvalState: {
          complete: true,
          given: decision.sequence,
          required: approvalsRequired(policy.mode),
          message: 'Approved and locked.',
        },
      };
    });
  }

  /**
   * THE APPROVAL RULE IN FORCE, created on first read.
   *
   * The defaults reproduce exactly what was hard-coded before the setting
   * existed — one approval, by somebody other than the person who ran it,
   * with the account owner exempt — so upgrading changes nobody's rule.
   */
  private async readApprovalPolicy(tx: AdminTx): Promise<ApprovalPolicy> {
    const tenantId = currentTenantId();
    const existing = await tx.payrollApprovalPolicy.findUnique({ where: { tenantId } });
    if (existing) {
      return { mode: existing.mode, allowOwnerSelfApproval: existing.allowOwnerSelfApproval };
    }
    const created = await tx.payrollApprovalPolicy.create({ data: { tenantId } });
    return { mode: created.mode, allowOwnerSelfApproval: created.allowOwnerSelfApproval };
  }

  /** What the payroll settings screen shows, and what the run header reads. */
  async approvalPolicy() {
    return withAdminTx(this.rawPrisma, 'hr.payroll.view', async (tx) => {
      const policy = await this.readApprovalPolicy(tx);
      const approvers = await this.countApprovers(tx);

      /*
       * WHETHER THE RULE CAN ACTUALLY BITE, computed rather than assumed.
       *
       * Setting a rule that cannot take effect is worse than having no rule:
       * the clinic believes two people are checking payroll and one is. Two
       * things can make a chosen rule inert, and the screen says which:
       *
       *   * only one account can approve payroll at all, so a rule needing a
       *     second person can never be satisfied; or
       *   * every account that can approve payroll is an account holder, and
       *     the owner exemption is on, so the separation never applies.
       *
       * The second is not a small print case today. `hr.payroll.approve` is
       * carried by the OWNER role alone — it is not individually grantable and
       * a custom role cannot hold it — so EVERY approver is an owner, and with
       * the exemption on, MAKER_CHECKER behaves exactly like STANDARD.
       */
      const needsASecondPerson = approvalsRequired(policy.mode) > 1 || policy.mode === 'MAKER_CHECKER';
      const inert: string[] = [];
      if (needsASecondPerson && approvers.total < 2) {
        inert.push(
          `Only ${approvers.total === 1 ? 'one account' : 'no account'} in this clinic can approve payroll, so a rule that needs a second person cannot be met. Give a colleague the owner role first.`,
        );
      }
      if (needsASecondPerson && policy.allowOwnerSelfApproval && approvers.total === approvers.owners) {
        inert.push(
          'Everybody who can approve payroll is an account holder, and account holders are allowed to approve their own runs, so this rule will not change who can approve anything. Turn that allowance off to make it take effect.',
        );
      }

      return {
        ...policy,
        approvalsRequired: approvalsRequired(policy.mode),
        description: describeApprovalMode(policy),
        approvers,
        /** Empty when the rule does what it says. */
        inert,
        /**
         * WHAT THIS SETTING DOES NOT DO. Named on the screen rather than
         * discovered by a clinic that assumed otherwise.
         */
        limits: [
          'Nobody is notified that a run is waiting for them. The second approver finds it on the payroll list.',
          'The rule does not vary by amount. A small correction run takes the same route as a full month.',
          'It governs the payroll run only. Claims, leave, overtime and incentives each have their own approval.',
          'Both approvers need the same permission. Kuwick has no notion of a more senior approver, so two approvals means two people, not two levels.',
          'Only an account holder can approve payroll. It cannot be given to an HR or finance colleague on its own, so a second approver has to be a second account holder.',
        ],
      };
    });
  }

  /**
   * HOW MANY PEOPLE COULD APPROVE A RUN, and how many of those are account
   * holders. Both numbers, because a rule needing two people and a clinic
   * having one is a different problem from a clinic where everybody is exempt.
   */
  private async countApprovers(tx: AdminTx) {
    const staff = await tx.staff.findMany({
      where: { active: true },
      include: {
        roleAssignments: { select: { role: true, customRole: { select: { permissions: true } } } },
        permissionGrants: { select: { permission: true } },
      },
    });
    let total = 0;
    let owners = 0;
    const names: string[] = [];
    for (const person of staff) {
      const roles = person.roleAssignments
        .map((row) => row.role)
        .filter((role): role is SystemRole => role !== null);
      const extra: Permission[] = [
        ...person.permissionGrants.map((row) => row.permission).filter(isIndividuallyGrantable),
        ...person.roleAssignments
          .flatMap((row) => row.customRole?.permissions ?? [])
          .filter(isCustomRoleGrantable),
      ];
      if (!can(person, 'hr.payroll.approve', roles, extra)) continue;
      total += 1;
      names.push(person.fullName);
      if (can(person, 'settings.manage', roles, extra)) owners += 1;
    }
    return { total, owners, names };
  }

  /** Change the rule. Owner-level, and audited with both the old and new rule. */
  async setApprovalPolicy(input: { mode?: PayrollApprovalMode; allowOwnerSelfApproval?: boolean }) {
    return withAdminTx(this.rawPrisma, 'settings.manage', async (tx, actor) => {
      const tenantId = currentTenantId();
      const before = await this.readApprovalPolicy(tx);
      const after: ApprovalPolicy = {
        mode: input.mode ?? before.mode,
        allowOwnerSelfApproval: input.allowOwnerSelfApproval ?? before.allowOwnerSelfApproval,
      };
      await tx.payrollApprovalPolicy.update({
        where: { tenantId },
        data: {
          mode: after.mode as PayrollApprovalModeEnum,
          allowOwnerSelfApproval: after.allowOwnerSelfApproval,
          updatedByStaffId: actor.id,
        },
      });
      await recordAudit(tx, actor, {
        action: 'payrollApprovalPolicy.changed',
        entityType: 'PayrollApprovalPolicy',
        entityId: tenantId,
        before: { mode: before.mode, allowOwnerSelfApproval: String(before.allowOwnerSelfApproval) },
        after: { mode: after.mode, allowOwnerSelfApproval: String(after.allowOwnerSelfApproval) },
        source: 'hr.payroll',
      });
      return {
        ...after,
        approvalsRequired: approvalsRequired(after.mode),
        description: describeApprovalMode(after),
      };
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
      // WHICH SCHEDULES PRODUCED THESE FIGURES, as recorded at calculation.
      // Read from the run rather than re-resolved, so a payslip reprinted next
      // year shows the edition behind it and not the one in force at printing.
      statutorySnapshot: run.statutorySnapshot,
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

      /*
       * THE APPROVALS GO WITH THE FIGURES THEY APPROVED.
       *
       * They used to survive a reopen, and under every mode that was wrong.
       * Under DUAL_APPROVAL the two existing sign-offs counted toward the
       * CORRECTED run, so a run could be changed after approval and reach
       * APPROVED again with nobody having looked at the change — the exact
       * control the second pair of eyes exists to provide, bypassed by the
       * workflow meant to preserve it. Under STANDARD the unique key on
       * (run, approver) meant the person who approved it could never approve
       * their own correction, so the run was stuck instead.
       *
       * Cleared here, therefore. The history is not lost: the audit log keeps
       * every `payroll.approved` entry, and the preserved snapshot keeps the
       * figures that were approved and their hash.
       */
      const cleared = await tx.payrollRunApproval.deleteMany({ where: { payrollRunId: runId } });

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
        before: {
          status: PayrollRunStatus.APPROVED,
          snapshotVersion: latest?.version ?? null,
          snapshotHash: latest?.hash ?? null,
          approvalsHeld: cleared.count,
        },
        after: { status: PayrollRunStatus.CALCULATED, approvalsHeld: 0 },
        reason,
        source: 'hr.payroll',
      });

      return {
        run: reopened,
        preservedSnapshot: latest ? { version: latest.version, hash: latest.hash } : null,
        note: latest
          ? `Snapshot v${latest.version} is preserved. Recalculate, review the difference, then approve again to write v${latest.version + 1}. This run needs approving from the start again — the previous sign-offs were of figures that have now changed.`
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


