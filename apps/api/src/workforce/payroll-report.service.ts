import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission } from '../finance/admin-actor';
import { formatCents, toCents } from '../finance/money';
import { checkVariance } from './payroll-invariants';

/**
 * PAYROLL REPORTS.
 *
 * FIVE REPORTS, ONE SOURCE. Every figure below is read from the same
 * `payroll_lines`, `payroll_input_entries` and `staff_claims` rows the run
 * itself wrote. Nothing is recomputed here, and no report performs arithmetic
 * the calculation did not already do — a report that adds up salaries its own
 * way is a second engine, and the two will disagree in the month somebody
 * finally checks.
 *
 * DRILL-DOWN IS THE POINT, not a feature. A total nobody can open is a number
 * you have to trust; every row carries `drill`, a link to the canonical record
 * behind it — the employee, the payslip, the attendance record, the claim.
 *
 * NULL SURVIVES. A statutory figure the engine could not compute is null in
 * these reports, never 0, and the report says how many rows are in that state.
 * Summing nulls as zero is how a clinic files a return for less than it owes
 * and finds out from LHDN.
 *
 * WHAT THESE REPORTS ARE NOT: they are not statutory submission files, and
 * nothing here is formatted for KWSP, PERKESO or LHDN. Those are generated
 * once the rate tables have been checked, and refusing to produce one now is
 * deliberate — see docs/MALAYSIA_PAYROLL_STATUTORY_SOURCES.md.
 */
@Injectable()
export class PayrollReportService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  /** Every report this build serves, so a screen lists what exists rather than guessing. */
  catalogue() {
    return REPORT_CATALOGUE;
  }

  /**
   * 1. PAYROLL REGISTER — every employee, every figure, for one run.
   *
   * The line-by-line record a clinic keeps, prints and files away. It is the
   * payslip data without the payslip: one row per person, and the components
   * behind each row available by opening it.
   */
  async register(runId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.export.reports');
    const run = await this.loadRun(runId);
    const inputs = await this.prisma.payrollInputEntry.findMany({
      where: { period: run.period, staffId: { in: run.lines.map((l) => l.staffId) } },
      orderBy: { componentCode: 'asc' },
    });
    const inputsByStaff = new Map<string, typeof inputs>();
    for (const row of inputs) {
      inputsByStaff.set(row.staffId, [...(inputsByStaff.get(row.staffId) ?? []), row]);
    }

    const rows = run.lines.map((line) => ({
      staffId: line.staffId,
      name: line.staff.fullName,
      basicSalary: formatCents(toCents(line.basicSalary)),
      allowances: formatCents(toCents(line.allowances)),
      overtimePay: formatCents(toCents(line.overtimePay)),
      incentives: formatCents(toCents(line.incentives)),
      bonus: formatCents(toCents(line.bonus)),
      grossPay: formatCents(toCents(line.grossPay)),
      unpaidLeaveDeduction: formatCents(toCents(line.unpaidLeaveDeduction)),
      otherDeductions: formatCents(toCents(line.otherDeductions)),
      statutoryEmployee: sumOrNull([line.epfEmployee, line.socsoEmployee, line.eisEmployee, line.pcb]),
      netPay: formatCents(toCents(line.netPay)),
      employerCost: formatCents(toCents(line.employerCost)),
      /** The canonical record behind this row. */
      drill: `/admin/hr/employees/${line.staffId}`,
      /** What made it up, each naming where it came from. */
      components: (inputsByStaff.get(line.staffId) ?? []).map((input) => ({
        code: input.componentCode,
        label: input.label ?? input.componentCode,
        amount: formatCents(toCents(input.amount)),
        source: input.source,
        sourceRecordId: input.sourceRecordId,
        reason: input.reason,
      })),
    }));

    /*
     * EVERY COLUMN FOOTS, and the footing is computed HERE rather than on the
     * screen — one source, so the report and the table under it cannot
     * disagree. The run's own gross, net and employer-cost totals are used
     * verbatim; the component columns are summed from the same `payroll_lines`
     * rows the run wrote, which is the only place they exist.
     *
     * A column shown without a total under a column of numbers reads as a gap,
     * and a total computed in React is the second engine this stage removed.
     */
    const column = (pick: (line: (typeof run.lines)[number]) => unknown) =>
      formatCents(run.lines.reduce((sum, line) => sum + toCents(pick(line) as never), 0));

    return {
      report: 'PAYROLL_REGISTER',
      ...this.header(run),
      rows,
      totals: {
        basicSalary: column((l) => l.basicSalary),
        allowances: column((l) => l.allowances),
        overtimePay: column((l) => l.overtimePay),
        incentives: column((l) => l.incentives),
        bonus: column((l) => l.bonus),
        unpaidLeaveDeduction: column((l) => l.unpaidLeaveDeduction),
        otherDeductions: column((l) => l.otherDeductions),
        grossPay: formatCents(toCents(run.grossTotal)),
        deductions: formatCents(toCents(run.deductionTotal)),
        netPay: formatCents(toCents(run.netTotal)),
        employerCost: formatCents(toCents(run.employerCostTotal)),
        employees: run.employeeCount,
      },
    };
  }

  /**
   * 2. COST TO THE CLINIC, by branch and by legal employer.
   *
   * Employer cost is gross plus what the employer contributes — not what the
   * employee receives. A screen that shows take-home pay and labels it cost is
   * how a clinic under-budgets by the whole employer contribution, which is
   * why the two are named separately in every row here.
   */
  async employerCost(runId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.export.reports');
    const run = await this.loadRun(runId);
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { staffId: { in: run.lines.map((l) => l.staffId) } },
      include: {
        legalEmployer: { select: { id: true, name: true } },
        staff: { select: { clinicId: true, clinic: { select: { name: true } } } },
      },
    });
    const profileByStaff = new Map(profiles.map((p) => [p.staffId, p]));

    type Bucket = {
      key: string;
      label: string;
      employees: number;
      grossCents: number;
      employerContributionCents: number;
      employerCostCents: number;
      /** How many rows in this bucket carry an uncomputed statutory figure. */
      notComputed: number;
    };
    const byBranch = new Map<string, Bucket>();
    const byEmployer = new Map<string, Bucket>();

    const add = (map: Map<string, Bucket>, key: string, label: string, line: (typeof run.lines)[number]) => {
      const bucket = map.get(key) ?? {
        key,
        label,
        employees: 0,
        grossCents: 0,
        employerContributionCents: 0,
        employerCostCents: 0,
        notComputed: 0,
      };
      const employer = [line.epfEmployer, line.socsoEmployer, line.eisEmployer];
      bucket.employees += 1;
      bucket.grossCents += toCents(line.grossPay);
      bucket.employerCostCents += toCents(line.employerCost);
      bucket.employerContributionCents += employer.reduce(
        (sum, value) => sum + (value === null ? 0 : toCents(value)),
        0,
      );
      if (employer.some((value) => value === null)) bucket.notComputed += 1;
      map.set(key, bucket);
    };

    for (const line of run.lines) {
      const profile = profileByStaff.get(line.staffId);
      add(
        byBranch,
        profile?.staff.clinicId ?? 'unassigned',
        profile?.staff.clinic?.name ?? 'No branch recorded',
        line,
      );
      add(
        byEmployer,
        profile?.legalEmployer?.id ?? 'unassigned',
        profile?.legalEmployer?.name ?? 'No legal employer recorded',
        line,
      );
    }

    const present = (bucket: Bucket) => ({
      key: bucket.key,
      label: bucket.label,
      employees: bucket.employees,
      gross: formatCents(bucket.grossCents),
      employerContributions: bucket.notComputed > 0 ? null : formatCents(bucket.employerContributionCents),
      employerCost: formatCents(bucket.employerCostCents),
      // Named, not hidden behind a null. "Nothing on file" and "nothing owed"
      // are different sentences and only one of them is true.
      notComputed: bucket.notComputed,
      note:
        bucket.notComputed > 0
          ? `${bucket.notComputed} of ${bucket.employees} employees have no employer contribution worked out, so this total is the wages only.`
          : null,
    });

    return {
      report: 'EMPLOYER_COST',
      ...this.header(run),
      byBranch: [...byBranch.values()].map(present),
      byLegalEmployer: [...byEmployer.values()].map(present),
      total: {
        gross: formatCents(toCents(run.grossTotal)),
        employerCost: formatCents(toCents(run.employerCostTotal)),
        employees: run.employeeCount,
      },
    };
  }

  /**
   * 3. STATUTORY TOTALS — what is owed to whom, per legal employer.
   *
   * The employer files, not the branch, so this is grouped the way a
   * submission is made. Every figure the engine could not compute stays null
   * and is counted, because a statutory total that quietly treats "unknown" as
   * "nil" is a return filed for less than the clinic owes.
   */
  async statutory(runId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.export.reports');
    const run = await this.loadRun(runId);
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { staffId: { in: run.lines.map((l) => l.staffId) } },
      include: { legalEmployer: { select: { id: true, name: true, epfEmployerNo: true, socsoEmployerNo: true, lhdnEmployerNo: true } } },
    });
    const profileByStaff = new Map(profiles.map((p) => [p.staffId, p]));

    type Scheme = { employeeCents: number; employerCents: number; missing: number };
    type Group = {
      employerId: string;
      employerName: string;
      canFile: { epf: boolean; socso: boolean; lhdn: boolean };
      employees: number;
      epf: Scheme;
      socso: Scheme;
      eis: Scheme;
      pcb: { employeeCents: number; missing: number };
    };
    const groups = new Map<string, Group>();

    for (const line of run.lines) {
      const employer = profileByStaff.get(line.staffId)?.legalEmployer ?? null;
      const key = employer?.id ?? 'unassigned';
      const group = groups.get(key) ?? {
        employerId: key,
        employerName: employer?.name ?? 'No legal employer recorded',
        canFile: {
          epf: Boolean(employer?.epfEmployerNo),
          socso: Boolean(employer?.socsoEmployerNo),
          lhdn: Boolean(employer?.lhdnEmployerNo),
        },
        employees: 0,
        epf: { employeeCents: 0, employerCents: 0, missing: 0 },
        socso: { employeeCents: 0, employerCents: 0, missing: 0 },
        eis: { employeeCents: 0, employerCents: 0, missing: 0 },
        pcb: { employeeCents: 0, missing: 0 },
      };
      group.employees += 1;
      accumulate(group.epf, line.epfEmployee, line.epfEmployer);
      accumulate(group.socso, line.socsoEmployee, line.socsoEmployer);
      accumulate(group.eis, line.eisEmployee, line.eisEmployer);
      if (line.pcb === null) group.pcb.missing += 1;
      else group.pcb.employeeCents += toCents(line.pcb);
      groups.set(key, group);
    }

    const scheme = (name: string, value: Scheme, employees: number) => ({
      scheme: name,
      employee: value.missing > 0 ? null : formatCents(value.employeeCents),
      employer: value.missing > 0 ? null : formatCents(value.employerCents),
      total: value.missing > 0 ? null : formatCents(value.employeeCents + value.employerCents),
      notComputed: value.missing,
      note:
        value.missing > 0
          ? `Not worked out for ${value.missing} of ${employees} employees, so there is no total to file.`
          : null,
    });

    return {
      report: 'STATUTORY_TOTALS',
      ...this.header(run),
      /**
       * SAID ONCE, PLAINLY. These are totals of what the engine computed, for
       * checking; they are not a submission file and are not formatted for any
       * authority. Kuwick produces no statutory file until its rate tables have
       * been checked against KWSP, PERKESO and LHDN.
       */
      notASubmission:
        'These are totals for checking, not a submission. Kuwick does not produce EPF, SOCSO, EIS or PCB files, and nothing here has been filed with anybody.',
      byEmployer: [...groups.values()].map((group) => ({
        employerId: group.employerId,
        employerName: group.employerName,
        employees: group.employees,
        canFile: group.canFile,
        schemes: [
          scheme('EPF', group.epf, group.employees),
          scheme('SOCSO', group.socso, group.employees),
          scheme('EIS', group.eis, group.employees),
          {
            scheme: 'PCB',
            employee: group.pcb.missing > 0 ? null : formatCents(group.pcb.employeeCents),
            employer: null,
            total: group.pcb.missing > 0 ? null : formatCents(group.pcb.employeeCents),
            notComputed: group.pcb.missing,
            note:
              group.pcb.missing > 0
                ? `Monthly tax is missing for ${group.pcb.missing} of ${group.employees} employees. Kuwick does not work PCB out; it has to be entered.`
                : 'Every figure here was entered by hand. Kuwick does not work monthly tax out.',
          },
        ],
      })),
    };
  }

  /**
   * 4. VARIANCE — this run against the one before it, as a subtraction.
   *
   * The design review found a mockup whose comparison month carried the
   * current month's totals beside four non-zero movements. The movement here
   * is `current - previous` and is asserted to be, by the same invariant the
   * engine uses, so that defect cannot reach a screen.
   */
  async variance(runId: string) {
    await requirePermission(this.rawPrisma, 'hr.payroll.export.reports');
    const run = await this.loadRun(runId);
    const previous = await this.prisma.payrollRun.findFirst({
      where: {
        clinicId: run.clinicId,
        runType: run.runType,
        period: { lt: run.period },
        status: { in: ['CALCULATED', 'APPROVED', 'PAID'] },
      },
      orderBy: { period: 'desc' },
      include: { lines: { include: { staff: { select: { fullName: true } } } } },
    });

    if (!previous) {
      return {
        report: 'VARIANCE',
        ...this.header(run),
        comparedWith: null,
        // Not an empty table with zeroes in it: there is nothing to compare
        // against, which is a different thing from nothing having changed.
        note: 'This is the first payroll run for this branch, so there is nothing to compare it with.',
        rows: [],
        totals: null,
      };
    }

    const previousByStaff = new Map(previous.lines.map((line) => [line.staffId, line]));
    const seen = new Set<string>();
    const rows = run.lines.map((line) => {
      seen.add(line.staffId);
      const before = previousByStaff.get(line.staffId) ?? null;
      const currentCents = toCents(line.netPay);
      const previousCents = before ? toCents(before.netPay) : 0;
      return {
        staffId: line.staffId,
        name: line.staff.fullName,
        state: before ? ('BOTH' as const) : ('JOINED' as const),
        current: formatCents(currentCents),
        previous: before ? formatCents(previousCents) : null,
        movement: formatCents(currentCents - previousCents),
        currentCents,
        previousCents,
        drill: `/admin/hr/employees/${line.staffId}`,
      };
    });

    // Anybody paid last month and not this one. Left out silently, they are a
    // person who stopped being paid with nothing on screen saying so.
    for (const line of previous.lines) {
      if (seen.has(line.staffId)) continue;
      rows.push({
        staffId: line.staffId,
        name: line.staff.fullName,
        state: 'LEFT' as never,
        current: null as never,
        previous: formatCents(toCents(line.netPay)),
        movement: formatCents(-toCents(line.netPay)),
        currentCents: 0,
        previousCents: toCents(line.netPay),
        drill: `/admin/hr/employees/${line.staffId}`,
      });
    }

    // THE MOVEMENT IS A SUBTRACTION, asserted rather than assumed.
    const violations = checkVariance(
      rows.map((row) => ({
        staffId: row.staffId,
        name: row.name,
        currentCents: row.currentCents,
        previousCents: row.previousCents,
        displayedDeltaCents: toCents(row.movement),
      })),
    );
    if (violations.length > 0) {
      throw new Error(`Variance report is internally inconsistent: ${violations[0].message}`);
    }

    const currentTotal = toCents(run.netTotal);
    const previousTotal = toCents(previous.netTotal);
    return {
      report: 'VARIANCE',
      ...this.header(run),
      comparedWith: {
        runId: previous.id,
        period: previous.period.toISOString().slice(0, 7),
        periodLabel: monthLabel(previous.period),
      },
      note: null,
      rows: rows.map(({ currentCents, previousCents, ...row }) => row),
      totals: {
        current: formatCents(currentTotal),
        previous: formatCents(previousTotal),
        movement: formatCents(currentTotal - previousTotal),
        joined: rows.filter((r) => r.state === 'JOINED').length,
        left: rows.filter((r) => (r.state as string) === 'LEFT').length,
      },
    };
  }

  /**
   * 5. CLAIMS AND REIMBURSEMENTS — every approved claim, and which way it was paid.
   *
   * ONE ROUTE PER CLAIM is the invariant that stops a reimbursement being paid
   * twice: through payroll AND through Finance. This report is where a clinic
   * can see that it held — every approved claim in the period, the route its
   * approver chose, and whether it has actually been settled that way.
   */
  async claims(params: { from: string; to: string }) {
    await requirePermission(this.rawPrisma, 'hr.payroll.export.reports');
    const from = new Date(`${params.from}T00:00:00.000Z`);
    const to = new Date(`${params.to}T23:59:59.999Z`);

    /*
     * BY WHEN THE EXPENSE HAPPENED, not by when somebody got round to
     * approving it.
     *
     * A claim incurred on 4 August and approved on 2 September belongs to
     * August in every sentence a clinic says about it — "what did we spend on
     * travel in August". Filtering by the decision date would move that claim
     * into September and leave August looking cheaper than it was, which is
     * exactly the drift a report is supposed to catch.
     *
     * Where each claim STANDS is reported as it stands now: approval and
     * settlement are current facts, not facts about the period.
     */
    const claims = await this.prisma.staffClaim.findMany({
      where: { status: { in: ['APPROVED', 'REJECTED'] }, claimDate: { gte: from, lte: to } },
      include: {
        staff: { select: { fullName: true } },
        decidedBy: { select: { fullName: true } },
      },
      orderBy: [{ claimDate: 'asc' }],
    });

    const rows = claims.map((claim) => ({
      id: claim.id,
      staffId: claim.staffId,
      name: claim.staff.fullName,
      category: claim.category,
      description: claim.description,
      claimDate: claim.claimDate.toISOString().slice(0, 10),
      claimed: formatCents(toCents(claim.amountClaimed)),
      approved: claim.amountApproved === null ? null : formatCents(toCents(claim.amountApproved)),
      status: claim.status,
      route: claim.paymentRoute,
      // WHETHER IT WAS ACTUALLY PAID THAT WAY, from the record rather than the
      // intention: a payroll-routed claim is paid once it is linked to a
      // payroll input, and a finance-routed one once it is settled.
      settled:
        claim.paymentRoute === 'PAYROLL'
          ? claim.payrollInputEntryId !== null
          : claim.paymentRoute === 'FINANCE'
            ? claim.paidAt !== null
            : false,
      decidedBy: claim.decidedBy?.fullName ?? null,
      decidedAt: claim.decidedAt?.toISOString() ?? null,
      drill: `/admin/hr/claims?claimId=${claim.id}`,
    }));

    const approved = rows.filter((row) => row.status === 'APPROVED');
    const total = (route: 'PAYROLL' | 'FINANCE') =>
      approved
        .filter((row) => row.route === route)
        .reduce((sum, row) => sum + (row.approved === null ? 0 : toCents(row.approved)), 0);

    return {
      report: 'CLAIMS',
      period: { from: params.from, to: params.to },
      /** Which date the range filters on, said rather than assumed. */
      periodMeans: 'Claims for expenses incurred between these dates. Approval and payment may have happened later.',
      rows,
      totals: {
        claims: rows.length,
        approved: approved.length,
        rejected: rows.length - approved.length,
        throughPayroll: formatCents(total('PAYROLL')),
        throughFinance: formatCents(total('FINANCE')),
        awaitingPayment: approved.filter((row) => !row.settled).length,
      },
      /**
       * THE INVARIANT THIS REPORT EXISTS TO PROVE. Every approved claim has
       * exactly one route, enforced by a database constraint, and a claim that
       * reached a payslip is linked to the one payroll input that paid it.
       */
      doublePaymentCheck:
        approved.every((row) => row.route === 'PAYROLL' || row.route === 'FINANCE')
          ? 'Every approved claim has exactly one payment route, so none can be reimbursed twice.'
          : 'One or more approved claims have no payment route. This should be impossible — report it.',
    };
  }

  // -------------------------------------------------------------------------

  private async loadRun(runId: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id: runId },
      include: {
        clinic: { select: { name: true } },
        lines: {
          include: { staff: { select: { fullName: true } } },
          orderBy: { staff: { fullName: 'asc' } },
        },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  /** The same header on every run-scoped report, so two of them cannot disagree. */
  private header(run: {
    id: string;
    period: Date;
    status: string;
    statutoryStatus: string;
    clinic: { name: string } | null;
  }) {
    return {
      runId: run.id,
      period: run.period.toISOString().slice(0, 7),
      periodLabel: monthLabel(run.period),
      clinicName: run.clinic?.name ?? 'All branches',
      status: run.status,
      /**
       * PROVISIONAL TRAVELS WITH THE FIGURES. A report printed off a run whose
       * statutory rates were never checked must say so on the report, not only
       * on the screen it was exported from.
       */
      provisional: run.statutoryStatus !== 'CONFIGURED',
      provisionalNote:
        run.statutoryStatus !== 'CONFIGURED'
          ? 'The statutory rates behind these figures have not been checked against KWSP, PERKESO and LHDN. Treat every figure here as a working number.'
          : null,
    };
  }
}

function accumulate(scheme: { employeeCents: number; employerCents: number; missing: number }, employee: unknown, employer: unknown) {
  if (employee === null || employer === null) {
    scheme.missing += 1;
    return;
  }
  scheme.employeeCents += toCents(employee as never);
  scheme.employerCents += toCents(employer as never);
}

/** Null in, null out — a total containing an unknown is not a total. */
function sumOrNull(values: unknown[]): string | null {
  if (values.some((value) => value === null)) return null;
  return formatCents(values.reduce((sum: number, value) => sum + toCents(value as never), 0));
}

function monthLabel(period: Date): string {
  return period.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * WHAT EXISTS, so a screen lists reports rather than guessing at them, and so
 * the ones that do NOT exist yet are visible as absences rather than assumed.
 */
export const REPORT_CATALOGUE = {
  available: [
    {
      key: 'PAYROLL_REGISTER',
      title: 'Payroll register',
      description: 'Every employee on one run, with the components behind each figure.',
      scope: 'RUN' as const,
    },
    {
      key: 'EMPLOYER_COST',
      title: 'Cost to the clinic',
      description: 'What the month cost, by branch and by the employer who pays it. Not what staff receive.',
      scope: 'RUN' as const,
    },
    {
      key: 'STATUTORY_TOTALS',
      title: 'Statutory totals',
      description: 'EPF, SOCSO, EIS and monthly tax per employer, for checking. Not a submission file.',
      scope: 'RUN' as const,
    },
    {
      key: 'VARIANCE',
      title: 'This month against last',
      description: 'Who moved, by how much, and who joined or left. Every movement is a subtraction.',
      scope: 'RUN' as const,
    },
    {
      key: 'CLAIMS',
      title: 'Claims and reimbursements',
      description: 'Approved claims, the route each was paid by, and whether it has been settled.',
      scope: 'DATE_RANGE' as const,
    },
  ],
  /**
   * NAMED ABSENCES. The spec lists more reports than this build serves, and
   * listing the missing ones is how a clinic finds out now rather than on the
   * day it needs one.
   */
  notAvailableYet: [
    {
      key: 'STATUTORY_RECONCILIATION',
      title: 'Statutory reconciliation',
      why: 'Needs what was actually filed and paid to each authority. Kuwick does not record submissions, so there is nothing to reconcile against.',
    },
    {
      key: 'PAYMENT_RECONCILIATION',
      title: 'Payment reconciliation',
      why: 'Needs the bank payment file and the returned statement. Neither exists until the statutory rates are checked and a bank format is agreed.',
    },
    {
      key: 'PAYROLL_HISTORY',
      title: 'Payroll history and corrections',
      why: 'Approved runs are frozen with a snapshot and corrections are recorded adjustments, so the data exists. The report over them is not built.',
    },
  ],
} as const;
