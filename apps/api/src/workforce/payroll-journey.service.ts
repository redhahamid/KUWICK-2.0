import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { actorCan, requirePermission } from '../finance/admin-actor';
import { formatCents, toCents } from '../finance/money';
import {
  ApprovalPolicy,
  approvalsRequired,
  decideApproval,
  describeApprovalMode,
} from './payroll-approval-rule';
import { approvalGate } from './payroll-exception';
import { totalTimesheet } from './attendance-hours';
import { resolveSalaryForPayroll, SalaryRow } from './salary-resolution';

function monthStart(value: string | Date): Date {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`) : value;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
function monthEnd(period: Date): Date {
  return new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1));
}

/**
 * THE MONTHLY PAYROLL JOURNEY.
 *
 * The owner rejected a payroll screen that was one dense page carrying every
 * concept the engine has. What replaces it is six steps, each answering one
 * question, and this service is what the six steps read.
 *
 * ONE READ, SIX VIEWS. The steps are served together rather than one endpoint
 * each, because they are six views of ONE run and serving them separately is
 * how step 1 and step 5 end up disagreeing about who is in the month — the
 * exact defect the design review found in the mockups. A clinic has tens of
 * employees, not thousands, so the payload is bounded.
 *
 * NOTHING HERE CALCULATES ANYTHING. Every figure comes from the payroll lines
 * and materialised inputs the calculation wrote. A screen that recomputes what
 * the run computed is a second implementation of payroll, and the two will
 * eventually disagree.
 */
@Injectable()
export class PayrollJourneyService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /**
   * PAYROLL HOME — is this month done?
   *
   * Deliberately does NOT need a run to exist. "Nothing has been started for
   * September" is the most common state a clinic opens this page in, and a
   * screen that can only describe a run cannot describe that.
   */
  async home(params: { period?: string; clinicId?: string } = {}) {
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const period = monthStart(params.period ?? new Date());
    const periodEnd = monthEnd(period);
    const clinicFilter = params.clinicId ? { clinicId: params.clinicId } : {};

    const [run, recent, employees, contractors] = await Promise.all([
      this.prisma.payrollRun.findFirst({
        where: { period, runType: 'REGULAR', ...clinicFilter },
        orderBy: { sequence: 'desc' },
        include: { exceptionRows: { select: { severity: true, overridable: true, overriddenByStaffId: true } } },
      }),
      this.prisma.payrollRun.findMany({
        where: { period: { lt: period }, runType: 'REGULAR', ...clinicFilter },
        orderBy: { period: 'desc' },
        take: 3,
      }),
      this.prisma.employeeProfile.findMany({
        where: {
          engagement: 'EMPLOYEE',
          employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
          ...(params.clinicId ? { staff: { clinicId: params.clinicId } } : {}),
        },
        include: { staff: { select: { fullName: true, active: true } } },
      }),
      this.prisma.employeeProfile.count({
        where: {
          engagement: 'CONTRACTOR',
          employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
          ...(params.clinicId ? { staff: { clinicId: params.clinicId } } : {}),
        },
      }),
    ]);

    const active = employees.filter((e) => e.staff.active);
    const staffIds = active.map((e) => e.staffId);

    const [salaryRows, inputs, attendance, leave, incentives, claims] = await Promise.all([
      this.prisma.employeeSalary.findMany({ where: { staffId: { in: staffIds } } }),
      this.prisma.payrollInputEntry.findMany({ where: { staffId: { in: staffIds }, period } }),
      this.prisma.attendanceRecord.findMany({
        where: { staffId: { in: staffIds }, workDate: { gte: period, lt: periodEnd } },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          staffId: { in: staffIds },
          status: 'APPROVED',
          leaveType: 'UNPAID',
          startDate: { lt: periodEnd },
          endDate: { gte: period },
        },
      }),
      this.prisma.incentiveResult.findMany({
        where: { staffId: { in: staffIds }, incentiveRun: { period, status: { in: ['APPROVED', 'PAID'] } } },
      }),
      this.prisma.staffClaim.findMany({
        where: { staffId: { in: staffIds }, status: 'APPROVED', paymentRoute: 'PAYROLL', payrollPeriod: period },
      }),
    ]);

    // EMPLOYEE SETUP. "Ready" means the four things a payslip needs, said as
    // four separate counts rather than one score, because "4 of 6 ready" with
    // no breakdown tells the owner nothing about what to do next.
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
    const lastDay = new Date(periodEnd.getTime() - 86400000);
    const pcbByStaff = new Set(inputs.filter((i) => i.componentCode === 'PCB').map((i) => i.staffId));

    const withSalary = active.filter(
      (e) => resolveSalaryForPayroll(salaryByStaff.get(e.staffId) ?? [], period, lastDay).kind === 'RESOLVED',
    );
    const withBank = active.filter((e) => Boolean(e.bankName && e.bankAccountNo));
    const needingPcb = active.filter((e) => e.pcbApplicable && !pcbByStaff.has(e.staffId));
    const fullyReady = active.filter(
      (e) =>
        withSalary.some((w) => w.staffId === e.staffId) &&
        Boolean(e.bankName && e.bankAccountNo) &&
        Boolean(e.dateOfBirth) &&
        !needingPcb.some((n) => n.staffId === e.staffId),
    );

    const timesheet = totalTimesheet(
      attendance.map((row) => ({
        status: row.status,
        workedMinutes: row.workedMinutes,
        lateMinutes: row.lateMinutes,
        overtimeMinutes: row.overtimeMinutes,
        overtimeApproved: row.overtimeApproved,
      })),
    );

    const gate = run ? approvalGate(run.exceptionRows) : null;

    return {
      period: period.toISOString().slice(0, 7),
      periodLabel: period.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      run: run
        ? {
            id: run.id,
            status: run.status,
            statutoryStatus: run.statutoryStatus,
            netTotal: formatCents(toCents(run.netTotal)),
            employerCostTotal: formatCents(toCents(run.employerCostTotal)),
            employeeCount: run.employeeCount,
            calculatedAt: run.calculatedAt?.toISOString() ?? null,
            approvedAt: run.approvedAt?.toISOString() ?? null,
            paymentDate: run.paymentDate?.toISOString().slice(0, 10) ?? null,
          }
        : null,
      // The one word the hero needs. NOT_STARTED is a real state, not a null run.
      state: !run
        ? ('NOT_STARTED' as const)
        : run.status === 'DRAFT'
          ? ('STARTED' as const)
          : run.status === 'CALCULATED'
            ? ('READY_TO_REVIEW' as const)
            : run.status === 'APPROVED'
              ? ('APPROVED' as const)
              : ('PAID' as const),
      gate,
      employeesExpected: withSalary.length,
      setup: {
        total: active.length,
        ready: fullyReady.length,
        salaryOnRecord: withSalary.length,
        bankAccount: withBank.length,
        pcbMissing: needingPcb.length,
      },
      // WHAT IS FEEDING THIS MONTH. Named so the owner can see that payroll is
      // reading the clinic's records rather than waiting to be typed into.
      feeding: {
        attendanceDays: timesheet.daysPresent,
        overtimeHours: Math.round((timesheet.approvedOvertimeMinutes + timesheet.unapprovedOvertimeMinutes) / 6) / 10,
        unapprovedOvertimeHours: Math.round(timesheet.unapprovedOvertimeMinutes / 6) / 10,
        unpaidLeaveRequests: leave.length,
        claims: claims.length,
        claimTotal: formatCents(claims.reduce((sum, c) => sum + toCents(c.amountApproved ?? 0), 0)),
        incentives: incentives.length,
        incentiveTotal: formatCents(incentives.reduce((sum, i) => sum + toCents(i.amount), 0)),
      },
      contractorsExcluded: contractors,
      recent: recent.map((row) => ({
        id: row.id,
        period: row.period.toISOString().slice(0, 7),
        status: row.status,
        statutoryStatus: row.statutoryStatus,
        employeeCount: row.employeeCount,
        netTotal: formatCents(toCents(row.netTotal)),
        employerCostTotal: formatCents(toCents(row.employerCostTotal)),
      })),
    };
  }

  /**
   * The six steps of one run.
   *
   * MEMBERSHIP IS COMPUTED ONCE and reused by every step, so step 1 and step 5
   * cannot disagree about who is in the month.
   */
  async journey(runId: string) {
    const actor = await requirePermission(this.rawPrisma, 'hr.payroll.view');
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
      include: {
        clinic: { select: { name: true } },
        lines: { include: { staff: { select: { fullName: true } } }, orderBy: { staff: { fullName: 'asc' } } },
        exceptionRows: {
          include: { staff: { select: { fullName: true } } },
          orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
        },
        approvals: {
          include: { staff: { select: { fullName: true } } },
          orderBy: { sequence: 'asc' },
        },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');

    const period = run.period;
    const periodEnd = monthEnd(period);
    const lastDay = new Date(periodEnd.getTime() - 86400000);

    const [employees, contractors] = await Promise.all([
      this.prisma.employeeProfile.findMany({
        where: {
          engagement: 'EMPLOYEE',
          employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
          ...(run.clinicId ? { staff: { clinicId: run.clinicId } } : {}),
        },
        include: {
          staff: { select: { fullName: true, active: true } },
          legalEmployer: { select: { name: true } },
        },
        orderBy: { staffId: 'asc' },
      }),
      this.prisma.employeeProfile.findMany({
        where: {
          engagement: 'CONTRACTOR',
          employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
          ...(run.clinicId ? { staff: { clinicId: run.clinicId } } : {}),
        },
        include: { staff: { select: { fullName: true, active: true } } },
      }),
    ]);
    const active = employees.filter((e) => e.staff.active);
    const staffIds = active.map((e) => e.staffId);

    const [salaryRows, inputs, attendance, leave] = await Promise.all([
      this.prisma.employeeSalary.findMany({ where: { staffId: { in: staffIds } } }),
      this.prisma.payrollInputEntry.findMany({
        where: { staffId: { in: staffIds }, period },
        orderBy: { componentCode: 'asc' },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { staffId: { in: staffIds }, workDate: { gte: period, lt: periodEnd } },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          staffId: { in: staffIds },
          status: 'APPROVED',
          startDate: { lt: periodEnd },
          endDate: { gte: period },
        },
        include: { approvedBy: { select: { fullName: true } } },
      }),
    ]);

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

    const lineByStaff = new Map(run.lines.map((line) => [line.staffId, line]));
    const exceptionsByStaff = new Map<string, typeof run.exceptionRows>();
    for (const row of run.exceptionRows) {
      if (!row.staffId) continue;
      const list = exceptionsByStaff.get(row.staffId) ?? [];
      list.push(row);
      exceptionsByStaff.set(row.staffId, list);
    }

    // ---------------------------------------------------------------------
    // STEP 1 — who is in this month, and whose setup is not finished.
    // ---------------------------------------------------------------------
    const step1 = active.map((employee) => {
      const salary = resolveSalaryForPayroll(salaryByStaff.get(employee.staffId) ?? [], period, lastDay);
      const blocking = (exceptionsByStaff.get(employee.staffId) ?? []).filter(
        (e) => e.severity === 'BLOCKING' && !(e.overridable && e.overriddenByStaffId),
      );
      const paid = lineByStaff.has(employee.staffId);
      return {
        staffId: employee.staffId,
        name: employee.staff.fullName,
        position: employee.position,
        employerName: employee.legalEmployer?.name ?? null,
        startDate: employee.startDate?.toISOString().slice(0, 10) ?? null,
        // A human state, not a status enum: this is the word the owner reads.
        state: paid
          ? blocking.length > 0
            ? ('NEEDS_ATTENTION' as const)
            : ('READY' as const)
          : ('NEEDS_SETUP' as const),
        reason: paid
          ? blocking.map((e) => e.cause).join(' ') || null
          : (blocking[0]?.cause ?? (salary.kind === 'NO_SALARY' ? 'No salary is on file for this period.' : null)),
        includedInRun: paid,
      };
    });

    const joiners = active.filter((e) => e.startDate && e.startDate >= period && e.startDate < periodEnd).length;
    const leavers = active.filter((e) => e.endDate && e.endDate >= period && e.endDate < periodEnd).length;

    // ---------------------------------------------------------------------
    // STEP 2 — what people worked, and what is waiting on a manager.
    // ---------------------------------------------------------------------
    const attendanceByStaff = new Map<string, typeof attendance>();
    for (const row of attendance) {
      const list = attendanceByStaff.get(row.staffId) ?? [];
      list.push(row);
      attendanceByStaff.set(row.staffId, list);
    }

    const step2 = active
      .filter((e) => lineByStaff.has(e.staffId))
      .map((employee) => {
        const rows = attendanceByStaff.get(employee.staffId) ?? [];
        const sheet = totalTimesheet(
          rows.map((row) => ({
            status: row.status,
            workedMinutes: row.workedMinutes,
            lateMinutes: row.lateMinutes,
            overtimeMinutes: row.overtimeMinutes,
            overtimeApproved: row.overtimeApproved,
          })),
        );
        const unpaid = leave.filter((l) => l.staffId === employee.staffId && l.leaveType === 'UNPAID');
        const paidLeave = leave.filter((l) => l.staffId === employee.staffId && l.leaveType !== 'UNPAID');
        const line = lineByStaff.get(employee.staffId);
        return {
          staffId: employee.staffId,
          name: employee.staff.fullName,
          daysWorked: sheet.daysPresent,
          approvedOvertimeHours: Math.round(sheet.approvedOvertimeMinutes / 6) / 10,
          unapprovedOvertimeHours: Math.round(sheet.unapprovedOvertimeMinutes / 6) / 10,
          missingPunchDays: sheet.daysMissingPunch,
          unpaidLeaveDays: line ? Number(line.unpaidDays ?? 0) : 0,
          // The leave records behind the deduction, so nobody re-keys the days.
          unpaidLeaveRequests: unpaid.map((l) => ({
            id: l.id,
            from: l.startDate.toISOString().slice(0, 10),
            to: l.endDate.toISOString().slice(0, 10),
            approvedBy: l.approvedBy?.fullName ?? null,
          })),
          paidLeaveDays: paidLeave.length,
        };
      });

    // ---------------------------------------------------------------------
    // STEPS 3 AND 4 — earnings and deductions, from the materialised rows.
    // Every derived figure carries the sentence that says where it came from.
    // ---------------------------------------------------------------------
    const inputsByStaff = new Map<string, typeof inputs>();
    for (const row of inputs) {
      const list = inputsByStaff.get(row.staffId) ?? [];
      list.push(row);
      inputsByStaff.set(row.staffId, list);
    }

    const paidRows = run.lines.map((line) => {
      const own = inputsByStaff.get(line.staffId) ?? [];
      return {
        staffId: line.staffId,
        name: line.staff.fullName,
        // THE PAYSLIP'S OWN FIELDS, not a re-derivation from the input rows.
        //
        // The earnings table's columns were built from `payroll_input_entries`
        // while its total came from the line, so any run not produced by the
        // current calculation — a seeded one, an imported one — showed columns
        // that did not add up to their own total. The line is what was paid;
        // the input rows explain it, and are used for the drill-down only.
        basicSalary: formatCents(toCents(line.basicSalary)),
        allowances: formatCents(toCents(line.allowances)),
        overtimePay: formatCents(toCents(line.overtimePay)),
        incentives: formatCents(toCents(line.incentives)),
        bonus: formatCents(toCents(line.bonus)),
        grossPay: formatCents(toCents(line.grossPay)),
        otherDeductions: formatCents(toCents(line.otherDeductions)),
        unpaidLeaveDeduction: formatCents(toCents(line.unpaidLeaveDeduction)),
        netPay: formatCents(toCents(line.netPay)),
        employerCost: formatCents(toCents(line.employerCost)),
        statutoryEmployee:
          line.epfEmployee === null && line.socsoEmployee === null && line.eisEmployee === null
            ? null
            : formatCents(
                toCents(line.epfEmployee ?? 0) + toCents(line.socsoEmployee ?? 0) + toCents(line.eisEmployee ?? 0),
              ),
        pcb: line.pcb === null ? null : formatCents(toCents(line.pcb)),
        items: own.map((row) => ({
          id: row.id,
          componentCode: row.componentCode,
          label: row.label ?? row.componentCode,
          amount: formatCents(toCents(row.amount)),
          source: row.source,
          sourceRecordId: row.sourceRecordId,
          /** The sentence, not the enum. */
          provenance: row.reason,
          earnedPeriod: row.earnedPeriod?.toISOString().slice(0, 10) ?? null,
          /** Derived figures are corrected upstream, never re-keyed here. */
          editable: row.source === 'MANUAL',
        })),
      };
    });

    // ---------------------------------------------------------------------
    // STEP 5 AND 6 — review and approve, from ONE gate.
    // ---------------------------------------------------------------------
    const gate = approvalGate(run.exceptionRows);
    const attention = run.exceptionRows.map((row) => ({
      id: row.id,
      code: row.code,
      severity: row.severity,
      staffId: row.staffId,
      name: row.staff?.fullName ?? null,
      what: row.cause,
      why: row.consequence,
      whatToDo: row.remediation,
      link: row.deepLink,
      overridable: row.overridable,
      overridden: Boolean(row.overriddenByStaffId),
      blocksApproval: row.severity === 'BLOCKING' && !(row.overridable && row.overriddenByStaffId),
    }));

    // WHO HAS APPROVED, AND WHO STILL HAS TO.
    const policyRow = await this.prisma.payrollApprovalPolicy.findFirst();
    const policy: ApprovalPolicy = {
      mode: policyRow?.mode ?? 'MAKER_CHECKER',
      allowOwnerSelfApproval: policyRow?.allowOwnerSelfApproval ?? true,
    };
    const given = run.approvals.map((a) => ({
      name: a.staff.fullName,
      at: a.createdAt.toISOString(),
      sequence: a.sequence,
      wasOwnSelfApproval: a.usedOwnerSelfApproval,
    }));
    const decision = decideApproval(policy, {
      actorStaffId: actor.id,
      actorIsOwner: actorCan(actor, 'settings.manage'),
      makerStaffId: run.createdByStaffId,
      existing: run.approvals.map((a) => ({ staffId: a.staffId })),
    });
    const approval = {
      rule: describeApprovalMode(policy),
      required: approvalsRequired(policy.mode),
      given,
      // Two separate reasons somebody cannot approve, kept apart: the run has
      // problems, or this person is not allowed to. Merging them tells a
      // colleague to go fix five exceptions they were never going to approve.
      youMayApprove: decision.outcome !== 'REFUSE' && actorCan(actor, 'hr.payroll.approve'),
      whyNot:
        decision.outcome === 'REFUSE'
          ? decision.reason
          : actorCan(actor, 'hr.payroll.approve')
            ? null
            : 'You do not have permission to approve payroll.',
      /** What pressing Approve will do — finish the run, or record one of two. */
      completesTheRun: decision.outcome === 'APPROVE',
    };

    return {
      run: {
        id: run.id,
        period: period.toISOString().slice(0, 7),
        periodLabel: period.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
        clinicName: run.clinic?.name ?? 'All branches',
        status: run.status,
        statutoryStatus: run.statutoryStatus,
        paymentDate: run.paymentDate?.toISOString().slice(0, 10) ?? null,
        netTotal: formatCents(toCents(run.netTotal)),
        grossTotal: formatCents(toCents(run.grossTotal)),
        deductionTotal: formatCents(toCents(run.deductionTotal)),
        employerCostTotal: formatCents(toCents(run.employerCostTotal)),
        employeeCount: run.employeeCount,
      },
      employees: {
        included: step1.filter((e) => e.includedInRun).length,
        newJoiners: joiners,
        leavers,
        needsSetup: step1.filter((e) => !e.includedInRun).length,
        rows: step1,
        // Named on the screen so the run accounts for everybody the clinic
        // pays, not only everybody it payrolls.
        contractors: contractors
          .filter((c) => c.staff.active)
          .map((c) => ({ staffId: c.staffId, name: c.staff.fullName })),
      },
      attendance: {
        rows: step2,
        totalDaysWorked: step2.reduce((s, r) => s + r.daysWorked, 0),
        totalApprovedOvertimeHours: Math.round(step2.reduce((s, r) => s + r.approvedOvertimeHours, 0) * 10) / 10,
        totalUnapprovedOvertimeHours: Math.round(step2.reduce((s, r) => s + r.unapprovedOvertimeHours, 0) * 10) / 10,
        totalUnpaidLeaveDays: Math.round(step2.reduce((s, r) => s + r.unpaidLeaveDays, 0) * 10) / 10,
        totalMissingPunchDays: step2.reduce((s, r) => s + r.missingPunchDays, 0),
      },
      pay: { rows: paidRows },
      review: {
        gate,
        attention,
        mustFix: attention.filter((a) => a.blocksApproval).length,
        worthALook: attention.filter((a) => !a.blocksApproval && a.severity !== 'INFO').length,
      },
      // -------------------------------------------------------------------
      // STEP 6 — APPROVE.
      //
      // The screen must not offer a button the server is going to refuse. It
      // asks the SAME function the server enforces with, so "can I approve
      // this?" has one answer rather than a hopeful one on the client and a
      // real one in the service.
      // -------------------------------------------------------------------
      approval,
    };
  }
}
