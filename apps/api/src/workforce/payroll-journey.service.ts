import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { actorCan, requirePermission, requireScope } from '../finance/admin-actor';
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
import { resolveClassificationForPayroll } from './statutory-classification';
import { statutoryStatusOf } from './statutory';
import { toClassificationRow } from './statutory-classification.service';

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
    const { scope } = await requireScope(this.rawPrisma, 'hr.payroll.view');
    const period = monthStart(params.period ?? new Date());
    const periodEnd = monthEnd(period);
    // The landing page answers for the branches this account MANAGES — a
    // requested branch is validated against the scope, and no request means
    // the managed set, never the whole tenant by default.
    const clinicFilter = scope.where(params.clinicId);
    const staffScope = { staff: scope.where(params.clinicId) };

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
          ...staffScope,
        },
        include: { staff: { select: { fullName: true, active: true } } },
      }),
      this.prisma.employeeProfile.count({
        where: {
          engagement: 'CONTRACTOR',
          employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
          ...staffScope,
        },
      }),
    ]);

    const active = employees.filter((e) => e.staff.active);
    const staffIds = active.map((e) => e.staffId);

    const [salaryRows, inputs, attendance, leave, incentives, claims, classificationRows] = await Promise.all([
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
      // The DATED standing, not the profile columns — the run stopped reading
      // those, and a home screen counting from them would report a month the
      // run does not see.
      this.prisma.employeeStatutoryClassification.findMany({ where: { staffId: { in: staffIds } } }),
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

    const classificationsByStaff = new Map<string, typeof classificationRows>();
    for (const row of classificationRows) {
      const list = classificationsByStaff.get(row.staffId) ?? [];
      list.push(row);
      classificationsByStaff.set(row.staffId, list);
    }

    const withSalary = active.filter(
      (e) => resolveSalaryForPayroll(salaryByStaff.get(e.staffId) ?? [], period, lastDay).kind === 'RESOLVED',
    );
    const withBank = active.filter((e) => Boolean(e.bankName && e.bankAccountNo));
    // MONTHLY TAX IS CALCULATED NOW. An employee whose dated standing carries
    // a tax residence and an MTD category needs nothing entered — the run
    // works the figure out from the official specification. This used to count
    // everyone without a hand-keyed PCB row, from the profile's legacy
    // column, which alarmed a fully set-up clinic every first of the month.
    const needingPcb = active.filter((e) => {
      const outcome = resolveClassificationForPayroll(
        (classificationsByStaff.get(e.staffId) ?? []).map(toClassificationRow),
        period,
        lastDay,
      );
      const standing = outcome.kind === 'RESOLVED' ? outcome.row : null;
      const pcbApplicable = standing ? standing.pcbApplicable : true;
      const computable = Boolean(standing && standing.taxResidence && standing.pcbCategory);
      return pcbApplicable && !computable && !pcbByStaff.has(e.staffId);
    });

    /*
     * SET-UP AND THIS MONTH'S ENTRY ARE DIFFERENT QUESTIONS.
     *
     * Readiness used to include the monthly tax figure. Kuwick does not work
     * PCB out, so on the first of every month nobody has one yet — which made
     * a fully set-up clinic read "0 of 8 ready" beside "Bank account 8/8",
     * every month, for a reason that was neither wrong nor anybody's fault.
     * A headline that alarms without informing is worse than no headline.
     *
     * Readiness is now the three STANDING facts: a salary in force, a bank
     * account, a date of birth. Set once, true until somebody changes them.
     * The monthly tax figure keeps its own line, because it IS outstanding and
     * the run will block on it — but it is this month's data entry, not a gap
     * in anybody's employee record.
     */
    const fullyReady = active.filter(
      (e) =>
        withSalary.some((w) => w.staffId === e.staffId) &&
        Boolean(e.bankName && e.bankAccountNo) &&
        Boolean(e.dateOfBirth),
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
      /**
       * THE PERIOD'S OWN ANSWER, run or no run. The safety banner used to
       * read only the run's stored status, so a month nobody had started
       * showed "statutory setup is not yet production-ready" — a false
       * sentence about a period the registry fully covers. The registry is
       * the source of truth and it answers for any date.
       */
      periodStatutoryStatus: statutoryStatusOf(new Date(periodEnd.getTime() - 86_400_000)),
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
        dateOfBirth: active.filter((e) => Boolean(e.dateOfBirth)).length,
        /** This month's entry, not a gap in an employee record. See above. */
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

    // THE GROUPING THE TWO MONEY STEPS RENDER, worked out HERE and nowhere
    // else. The earnings and deductions screens used to derive these figures
    // themselves — salary-after-unpaid-leave, a residual "other" column,
    // statutory and tax subtotals — which made the browser a second place
    // payroll arithmetic lived, and it summed a missing statutory figure as
    // zero. The screens now render these fields; they do not compute any.
    //
    // Everything still comes from THE PAYSLIP'S OWN FIELDS, never from a
    // re-derivation of the input rows: the line is what was paid, the input
    // rows explain it and serve the drill-down only. The one derived column,
    // `otherEarnings`, is deliberately a RESIDUAL of the line's own gross, so
    // the row cannot fail to add up and anything unexpected surfaces as a
    // number in a named column rather than vanishing.
    const sums = {
      basic: 0, unpaidLeave: 0, salaryEarned: 0, allowances: 0, overtime: 0,
      incentive: 0, otherEarnings: 0, gross: 0,
      statutory: 0, pcb: 0, lindung: 0, otherDeductions: 0, deductions: 0, net: 0,
      statutoryNotCalculated: 0, pcbMissing: 0, lindungNotDetermined: 0,
      // WHAT THE MONTH COSTS THE CLINIC, and the part of it that is not wages.
      //
      // The month header shows four figures: gross, employee deductions,
      // EMPLOYER CONTRIBUTIONS and net. Three were already here. The fourth
      // was being worked out in the browser as `employerCost - gross`, which
      // is a payroll subtraction performed by a screen — the exact thing the
      // rest of this service exists to prevent. It is one addition here and
      // no arithmetic there.
      employerCost: 0, employerContributions: 0,
      additionalEarnings: 0, socsoEis: 0, socsoEisNotCalculated: 0,
      // PER SCHEME, so the register's totals row foots the column it sits
      // under. `statutory` above is EPF+SOCSO+EIS added together and is what
      // the month header reads; a column headed EPF must foot on EPF.
      epf: 0, socso: 0, eis: 0,
    };
    /*
     * WHO THIS PERSON IS, AND WHETHER THEY ARE READY — carried on the pay row.
     *
     * The register puts a status beside every name: green ready, amber worth a
     * look, red cannot be paid safely, each with a Fix that goes straight to
     * the remedy. That used to mean the browser joining three arrays — the pay
     * rows, the employee rows and the exception rows — by staff id, on every
     * render, and a join done in a screen is a join that can be got wrong
     * quietly. The server already holds all three; it does the join once.
     */
    const standingByStaff = new Map(step1.map((row) => [row.staffId, row]));
    const paidRows = run.lines.map((line) => {
      const own = inputsByStaff.get(line.staffId) ?? [];
      const standing = standingByStaff.get(line.staffId);
      const ownExceptions = exceptionsByStaff.get(line.staffId) ?? [];
      const blockers = ownExceptions.filter(
        (e) => e.severity === 'BLOCKING' && !(e.overridable && e.overriddenByStaffId),
      );
      const warnings = ownExceptions.filter((e) => e.severity === 'WARNING');
      // The remedy for the most serious thing wrong, not the first thing found:
      // a Fix button that opens a warning while a blocker sits under it is a
      // button that wastes the one click somebody gave it.
      const fixLink = blockers.find((e) => e.deepLink)?.deepLink ?? warnings.find((e) => e.deepLink)?.deepLink ?? null;
      const basicCents = toCents(line.basicSalary);
      const unpaidCents = toCents(line.unpaidLeaveDeduction);
      const allowanceCents = toCents(line.allowances);
      const overtimeCents = toCents(line.overtimePay);
      const incentiveCents = toCents(line.incentives) + toCents(line.bonus);
      const grossCents = toCents(line.grossPay);
      const netCents = toCents(line.netPay);
      const salaryEarnedCents = basicCents - unpaidCents;
      const otherEarningsCents = grossCents - salaryEarnedCents - allowanceCents - overtimeCents - incentiveCents;
      // ANY unknown makes the subtotal unknown — null in, null out. This was
      // `&&`, so an employee with EPF null but SOCSO and EIS computed had
      // their unknown EPF summed as RM0.00 on the review screen: a
      // complete-looking subtotal, with the missing money invisible on the
      // exact surface a person reads before approving.
      const statutoryMissing =
        line.epfEmployee === null || line.socsoEmployee === null || line.eisEmployee === null;
      const statutoryCents = statutoryMissing
        ? null // the guard above proves the three are non-null on this branch
        : toCents(line.epfEmployee ?? 0) + toCents(line.socsoEmployee ?? 0) + toCents(line.eisEmployee ?? 0);
      const pcbCents = line.pcb === null ? null : toCents(line.pcb);
      const lindungCents = line.lindungEmployee === null ? null : toCents(line.lindungEmployee);
      const otherDeductionCents = toCents(line.otherDeductions);
      // What actually came off this person's pay — the gap between the line's
      // own gross and its own net, not a re-run of the engine.
      const deductionCents = grossCents - netCents;
      // Cost to the clinic, and the part of it that is not the wage itself:
      // the employer's statutory share plus any levy. Read off the line the
      // engine wrote, never reassembled from the individual schemes here.
      const employerCostCents = toCents(line.employerCost);
      const employerContributionCents = employerCostCents - grossCents;

      sums.basic += basicCents;
      sums.unpaidLeave += unpaidCents;
      sums.salaryEarned += salaryEarnedCents;
      sums.allowances += allowanceCents;
      sums.overtime += overtimeCents;
      sums.incentive += incentiveCents;
      sums.otherEarnings += otherEarningsCents;
      sums.gross += grossCents;
      sums.net += netCents;
      sums.deductions += deductionCents;
      sums.otherDeductions += otherDeductionCents;
      sums.employerCost += employerCostCents;
      sums.employerContributions += employerContributionCents;
      sums.additionalEarnings += allowanceCents + otherEarningsCents;
      // Same null rule as the row: one unknown scheme makes the pair unknown,
      // and it is counted rather than summed as nil.
      if (line.socsoEmployee === null || line.eisEmployee === null) sums.socsoEisNotCalculated += 1;
      else sums.socsoEis += toCents(line.socsoEmployee) + toCents(line.eisEmployee);
      // Each scheme over the rows where it was actually worked out. A null is
      // skipped, never added as nil — the count beside the header says how
      // many are missing.
      if (line.epfEmployee !== null) sums.epf += toCents(line.epfEmployee);
      if (line.socsoEmployee !== null) sums.socso += toCents(line.socsoEmployee);
      if (line.eisEmployee !== null) sums.eis += toCents(line.eisEmployee);
      if (statutoryCents === null) sums.statutoryNotCalculated += 1;
      else sums.statutory += statutoryCents;
      if (pcbCents === null) sums.pcbMissing += 1;
      else sums.pcb += pcbCents;
      if (lindungCents === null) sums.lindungNotDetermined += 1;
      else sums.lindung += lindungCents;

      return {
        staffId: line.staffId,
        name: line.staff.fullName,
        /** For the register's person cell — the same position the directory shows. */
        position: standing?.position ?? null,
        /**
         * READY / NEEDS_ATTENTION / NEEDS_SETUP, with the counts behind it and
         * the deep link that fixes the most serious one. Joined server-side —
         * see the note above `standingByStaff`.
         */
        state: standing?.state ?? ('READY' as const),
        reason: standing?.reason ?? null,
        blockers: blockers.length,
        warnings: warnings.length,
        fixLink,
        basicSalary: formatCents(basicCents),
        allowances: formatCents(allowanceCents),
        overtimePay: formatCents(overtimeCents),
        incentives: formatCents(toCents(line.incentives)),
        bonus: formatCents(toCents(line.bonus)),
        grossPay: formatCents(grossCents),
        otherDeductions: formatCents(otherDeductionCents),
        unpaidLeaveDeduction: formatCents(unpaidCents),
        netPay: formatCents(netCents),
        employerCost: formatCents(toCents(line.employerCost)),
        statutoryEmployee: statutoryCents === null ? null : formatCents(statutoryCents),
        pcb: pcbCents === null ? null : formatCents(pcbCents),
        /** SKBBK. Employee-borne, employer-remitted; null means participation is unrecorded. */
        lindungEmployee: lindungCents === null ? null : formatCents(lindungCents),
        /*
         * THE SCHEMES INDIVIDUALLY, so the register can carry an EPF column
         * and a SOCSO/EIS column rather than one "statutory" lump.
         *
         * `statutoryEmployee` above is the three added together, and it is what
         * the totals foot on. These are the same figures unsummed. They are
         * passed through from the line the engine wrote — the alternative was
         * for the register to read the run detail as a SECOND source beside
         * this one and format its floats itself, which is how two surfaces
         * showing the same person's EPF end up disagreeing by a sen.
         *
         * NULL IS NOT ZERO, at every level: a scheme that could not be worked
         * out stays null all the way to the cell, which renders "—".
         */
        epfEmployee: line.epfEmployee === null ? null : formatCents(toCents(line.epfEmployee)),
        epfEmployer: line.epfEmployer === null ? null : formatCents(toCents(line.epfEmployer)),
        socsoEmployee: line.socsoEmployee === null ? null : formatCents(toCents(line.socsoEmployee)),
        socsoEmployer: line.socsoEmployer === null ? null : formatCents(toCents(line.socsoEmployer)),
        eisEmployee: line.eisEmployee === null ? null : formatCents(toCents(line.eisEmployee)),
        eisEmployer: line.eisEmployer === null ? null : formatCents(toCents(line.eisEmployer)),
        /** HRD Corp levy — an employer cost, never a deduction. */
        hrdLevy: line.hrdLevy === null ? null : formatCents(toCents(line.hrdLevy)),
        /** What the employer pays on top of this person's wage. */
        employerContributions: formatCents(employerContributionCents),
        /*
         * THE TWO GROUPED COLUMNS THE REGISTER OPENS WITH.
         *
         * A clinic paying eight people does not want twenty columns, so the
         * default register shows the components everybody has and folds the
         * rest into one: "Additional" is allowances plus whatever else reached
         * this person's gross — a reimbursed claim, mileage. "SOCSO/EIS" is
         * the two schemes that always move together.
         *
         * Both are summed HERE rather than in the register, for the same
         * reason as every other figure on this row: a column the browser adds
         * up is a column that can disagree with the payslip. Opening the
         * drawer shows the components individually.
         *
         * SOCSO/EIS is null if EITHER scheme is unknown. Showing SOCSO alone
         * under a heading that claims to be both is a smaller number than the
         * clinic owes, printed as though it were the whole answer.
         */
        additionalEarnings: formatCents(allowanceCents + otherEarningsCents),
        socsoEis:
          line.socsoEmployee === null || line.eisEmployee === null
            ? null
            : formatCents(toCents(line.socsoEmployee) + toCents(line.eisEmployee)),
        /*
         * THE EMPLOYER-SELECTED EPF BASIS as the calculation applied it —
         * read from the line's own breakdown, never re-derived. Null for the
         * ordinary employee with no selection, whose EPF simply follows the
         * assessment; present so the deductions step can answer "what EPF
         * basis is Kuwick using?" in the row itself.
         */
        epfBasis: (() => {
          const basis = ((line.breakdown ?? {}) as {
            epfBasis?: {
              mode: string;
              appliedEpfCents: number;
              assessedEpfCents: number;
              excluded: { label: string; amountCents: number }[];
              ineffective: { label: string; amountCents: number }[];
            };
          }).epfBasis;
          if (!basis) return null;
          return {
            mode: basis.mode,
            applied: formatCents(basis.appliedEpfCents),
            assessed: formatCents(basis.assessedEpfCents),
            excluded: basis.excluded.map((row) => ({ label: row.label, amount: formatCents(row.amountCents) })),
            ineffective: basis.ineffective.map((row) => ({ label: row.label, amount: formatCents(row.amountCents) })),
          };
        })(),
        salaryEarned: formatCents(salaryEarnedCents),
        /** Incentives and bonus as one column — the grouping the screen shows. */
        incentive: formatCents(incentiveCents),
        otherEarnings: formatCents(otherEarningsCents),
        deductionTotal: formatCents(deductionCents),
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

    // The lines must agree with the run's own stored totals. They always do
    // for a run this engine calculated — the calculation asserts it — but a
    // seeded or imported run is exactly the kind of run this screen must not
    // silently tidy up.
    const paysAddUp =
      sums.gross === toCents(run.grossTotal) &&
      sums.net === toCents(run.netTotal) &&
      sums.deductions === toCents(run.deductionTotal);
    const payTotals = {
      basic: formatCents(sums.basic),
      unpaidLeave: formatCents(sums.unpaidLeave),
      salaryEarned: formatCents(sums.salaryEarned),
      allowances: formatCents(sums.allowances),
      overtime: formatCents(sums.overtime),
      incentive: formatCents(sums.incentive),
      otherEarnings: formatCents(sums.otherEarnings),
      additions: formatCents(sums.allowances + sums.overtime + sums.incentive + sums.otherEarnings),
      gross: formatCents(sums.gross),
      /** Sum of what was actually worked out. Beside it, the count that was not. */
      statutoryEmployee: formatCents(sums.statutory),
      statutoryNotCalculated: sums.statutoryNotCalculated,
      pcb: formatCents(sums.pcb),
      pcbMissing: sums.pcbMissing,
      lindung: formatCents(sums.lindung),
      lindungNotDetermined: sums.lindungNotDetermined,
      otherDeductions: formatCents(sums.otherDeductions),
      deductions: formatCents(sums.deductions),
      net: formatCents(sums.net),
      /** What the employer pays on top of wages, and the two added together. */
      employerContributions: formatCents(sums.employerContributions),
      employerCost: formatCents(sums.employerCost),
      /** The register's two grouped columns foot on these, not on a browser sum. */
      additionalEarnings: formatCents(sums.additionalEarnings),
      socsoEis: formatCents(sums.socsoEis),
      socsoEisNotCalculated: sums.socsoEisNotCalculated,
      epfEmployee: formatCents(sums.epf),
      socsoEmployee: formatCents(sums.socso),
      eisEmployee: formatCents(sums.eis),
      addsUp: paysAddUp,
      discrepancy: paysAddUp
        ? null
        : 'The employee lines do not add up to the run’s stored totals. This run was not produced by the current calculation — recalculate it before relying on any figure here.',
    };

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
      pay: { rows: paidRows, totals: payTotals },
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
