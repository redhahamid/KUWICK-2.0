import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { requirePermission, withAdminTx } from '../finance/admin-actor';
import { recordAudit } from '../finance/admin-audit';
import { formatCents, toCents } from '../finance/money';
import { checkVariance } from './payroll-invariants';

/**
 * PAYROLL REPORTS.
 *
 * THIRTEEN REPORTS, ONE SOURCE. Every figure below is read from the same
 * `payroll_lines`, `payroll_input_entries`, `employee_ytd`, exception and
 * payment rows the run itself wrote. Nothing is recomputed here, and no report
 * performs arithmetic the calculation did not already do — a report that adds
 * up salaries its own way is a second engine, and the two will disagree in the
 * month somebody finally checks.
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
  async catalogue() {
    // Static content, but gated: it was the one payroll route with no
    // permission check at all, and in a module where authorization lives in
    // the service (not a guard), an ungated method is the pattern a future
    // data-bearing route copies.
    await requirePermission(this.rawPrisma, 'hr.payroll.view');
    return REPORT_CATALOGUE;
  }

  /**
   * Authorise AND record that a full-pay report was served. These routes
   * carry every employee's pay, the permission is literally named "export",
   * and the download-shaped exits (payment listing, statutory listing,
   * payslip PDF) already write audit rows — the reports were the unrecorded
   * way out of the building.
   */
  private async requireReportActor(report: string, scope: Record<string, unknown>) {
    await withAdminTx(this.rawPrisma, 'hr.payroll.export.reports', async (tx, actor) => {
      await recordAudit(tx, actor, {
        action: 'payrollReport.served',
        entityType: 'PayrollReport',
        entityId: report,
        after: scope,
        source: 'hr.payroll',
      });
    });
  }

  /**
   * 1. PAYROLL REGISTER — every employee, every figure, for one run.
   *
   * The line-by-line record a clinic keeps, prints and files away. It is the
   * payslip data without the payslip: one row per person, and the components
   * behind each row available by opening it.
   */
  async register(runId: string) {
    await this.requireReportActor('register', { runId });
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
      // Everything withheld from the employee under a statute — LINDUNG
      // included, because it comes out of their pay even though the employer
      // remits it. Leaving it out made the row stop adding up in the first
      // month somebody opted in.
      statutoryEmployee: sumOrNull([line.epfEmployee, line.socsoEmployee, line.eisEmployee, line.lindungEmployee, line.pcb]),
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
    await this.requireReportActor('employer-cost', { runId });
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
      // FOUR terms, exactly the ones the engine put into employer cost. The
      // HRD levy was left out of this list, so on a registered employer's
      // report gross + employerContributions came up short of employerCost by
      // exactly the levy — the report deriving its own answer beside the
      // canonical one. A null levy counts as not-computed like the others:
      // "unrecorded registration" is a gap, not a zero.
      const employer = [line.epfEmployer, line.socsoEmployer, line.eisEmployer, line.hrdLevy];
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
    await this.requireReportActor('statutory-totals', { runId });
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
      lindung: { employeeCents: number; missing: number };
      hrd: { employerCents: number; missing: number };
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
        lindung: { employeeCents: 0, missing: 0 },
        hrd: { employerCents: 0, missing: 0 },
        pcb: { employeeCents: 0, missing: 0 },
      };
      group.employees += 1;
      accumulate(group.epf, line.epfEmployee, line.epfEmployer);
      accumulate(group.socso, line.socsoEmployee, line.socsoEmployer);
      accumulate(group.eis, line.eisEmployee, line.eisEmployer);
      if (line.lindungEmployee === null) group.lindung.missing += 1;
      else group.lindung.employeeCents += toCents(line.lindungEmployee);
      if (line.hrdLevy === null) group.hrd.missing += 1;
      else group.hrd.employerCents += toCents(line.hrdLevy);
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
            scheme: 'LINDUNG',
            employee: group.lindung.missing > 0 ? null : formatCents(group.lindung.employeeCents),
            employer: group.lindung.missing > 0 ? null : formatCents(0),
            total: group.lindung.missing > 0 ? null : formatCents(group.lindung.employeeCents),
            notComputed: group.lindung.missing,
            note:
              group.lindung.missing > 0
                ? `Not worked out for ${group.lindung.missing} of ${group.employees} employees — participation is unrecorded — so there is no total to remit.`
                : 'Employee-borne; the employer remits it with no share of its own.',
          },
          {
            scheme: 'HRD',
            employee: null,
            employer: group.hrd.missing > 0 ? null : formatCents(group.hrd.employerCents),
            total: group.hrd.missing > 0 ? null : formatCents(group.hrd.employerCents),
            notComputed: group.hrd.missing,
            note:
              group.hrd.missing > 0
                ? `Not worked out for ${group.hrd.missing} of ${group.employees} employees — the registration class or a citizenship-bearing EPF membership is unrecorded.`
                : 'Employer-borne levy under the PSMB Act; never deducted from pay.',
          },
          {
            scheme: 'PCB',
            employee: group.pcb.missing > 0 ? null : formatCents(group.pcb.employeeCents),
            employer: null,
            total: group.pcb.missing > 0 ? null : formatCents(group.pcb.employeeCents),
            notComputed: group.pcb.missing,
            note:
              group.pcb.missing > 0
                ? `Monthly tax is missing for ${group.pcb.missing} of ${group.employees} employees — record their tax residence and MTD category so it can be calculated, or enter the figure.`
                : 'Calculated from HASiL’s Computerised Calculation specification where the tax profile is recorded, or entered by hand where it is not — each payslip’s note says which.',
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
    await this.requireReportActor('variance', { runId });
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
    await this.requireReportActor('claims', { from: params.from, to: params.to });
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

  /**
   * 6. PAYROLL HISTORY — one employee, every run that ever paid them.
   *
   * The corrections trail is the point. An approved run that was reopened and
   * re-approved holds several snapshot versions, and this report says so on
   * the row — because "what did we pay Aminah in March" has a different answer
   * before and after the correction, and both answers are kept.
   */
  async history(staffId: string, year?: number) {
    await this.requireReportActor('history', { staffId, year: year ?? null });
    const staff = await this.prisma.staff.findUnique({ where: { id: staffId }, select: { fullName: true } });
    if (!staff) throw new NotFoundException('Employee not found');

    const lines = await this.prisma.payrollLine.findMany({
      where: {
        staffId,
        ...(year
          ? {
              payrollRun: {
                period: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
              },
            }
          : {}),
      },
      include: {
        payrollRun: {
          select: {
            id: true,
            period: true,
            runType: true,
            sequence: true,
            status: true,
            statutoryStatus: true,
            approvedAt: true,
            paidAt: true,
            clinic: { select: { name: true } },
          },
        },
      },
      orderBy: [{ payrollRun: { period: 'desc' } }, { payrollRun: { sequence: 'desc' } }],
    });

    // How many approved versions each run holds. More than one means the run
    // was corrected after approval; a run back at CALCULATED with a snapshot
    // means a correction is IN PROGRESS and the line's figures are candidates.
    const snapshots = await this.prisma.payrollSnapshot.findMany({
      where: { payrollRunId: { in: lines.map((l) => l.payrollRunId) } },
      select: { payrollRunId: true },
    });
    const versionsByRun = new Map<string, number>();
    for (const row of snapshots) {
      versionsByRun.set(row.payrollRunId, (versionsByRun.get(row.payrollRunId) ?? 0) + 1);
    }

    const rows = lines.map((line) => {
      const run = line.payrollRun;
      const approvedVersions = versionsByRun.get(run.id) ?? 0;
      const reopened = run.status === 'CALCULATED' && approvedVersions > 0;
      return {
        runId: run.id,
        period: run.period.toISOString().slice(0, 7),
        periodLabel: monthLabel(run.period),
        clinicName: run.clinic?.name ?? 'All branches',
        runType: run.runType,
        sequence: run.sequence,
        status: run.status,
        gross: formatCents(toCents(line.grossPay)),
        statutoryEmployee: sumOrNull([
          line.epfEmployee,
          line.socsoEmployee,
          line.eisEmployee,
          line.lindungEmployee,
          line.pcb,
        ]),
        otherDeductions: formatCents(toCents(line.otherDeductions)),
        net: formatCents(toCents(line.netPay)),
        employerCost: formatCents(toCents(line.employerCost)),
        approvedAt: run.approvedAt?.toISOString() ?? null,
        paidAt: run.paidAt?.toISOString() ?? null,
        approvedVersions,
        /**
         * CANDIDATE FIGURES, SAID SO. After a reopen the line carries the
         * recalculation while the approved payslip still stands at the last
         * snapshot — a history that showed the candidate as history would be
         * showing money nobody has approved.
         */
        note: reopened
          ? `Reopened for correction. These are candidate figures; the approved payslip still stands at version ${approvedVersions}.`
          : approvedVersions > 1
            ? `Corrected after first approval — ${approvedVersions} approved versions are kept, every one still readable.`
            : run.status === 'CALCULATED'
              ? 'Calculated, not yet approved. These figures can still change.'
              : null,
        drill: `/admin/hr/payroll/${run.id}`,
      };
    });

    // ONLY MONEY THAT WAS APPROVED IS SUMMED. A candidate month in the total
    // would be a figure this employer never signed.
    const settled = lines.filter((l) => l.payrollRun.status === 'APPROVED' || l.payrollRun.status === 'PAID');
    return {
      report: 'PAYROLL_HISTORY',
      staffId,
      name: staff.fullName,
      year: year ?? null,
      rows,
      totals: {
        runs: rows.length,
        approvedRuns: settled.length,
        approvedGross: formatCents(settled.reduce((sum, l) => sum + toCents(l.grossPay), 0)),
        approvedNet: formatCents(settled.reduce((sum, l) => sum + toCents(l.netPay), 0)),
        totalsMean: 'Approved and paid runs only. Draft and calculated figures are listed but never summed.',
      },
    };
  }

  /**
   * 7. MONTHLY TAX (PCB / MTD) SUMMARY — the month's tax per employee, and
   * where each figure came from.
   *
   * CALCULATED or ENTERED is read from the line's own `pcbSource` marker, the
   * one the calculation wrote — never inferred from the wording of a note.
   * Zakat paid through payroll and the month's TP1 sit beside the tax because
   * they are the two things that lawfully changed it.
   */
  async pcbSummary(runId: string) {
    await this.requireReportActor('pcb-summary', { runId });
    const run = await this.loadRun(runId);
    const staffIds = run.lines.map((l) => l.staffId);
    const profiles = await this.prisma.employeeProfile.findMany({
      where: { staffId: { in: staffIds } },
      select: { staffId: true, taxNumber: true, identifierValue: true },
    });
    const profileByStaff = new Map(profiles.map((p) => [p.staffId, p]));
    const tp1Rows = await this.prisma.employeeTp1Entry.findMany({
      where: { period: run.period, staffId: { in: staffIds } },
    });
    const tp1ByStaff = new Map(tp1Rows.map((row) => [row.staffId, row]));

    let missing = 0;
    let calculated = 0;
    let entered = 0;
    const rows = run.lines.map((line) => {
      const breakdown = (line.breakdown ?? {}) as {
        components?: { code: string; kind: string; amount: number }[];
        statutoryNotes?: { pcb?: string | null };
        pcbSource?: 'CALCULATED' | 'ENTERED' | null;
      };
      const source = line.pcb === null ? null : (breakdown.pcbSource ?? null);
      if (line.pcb === null) missing += 1;
      else if (source === 'ENTERED') entered += 1;
      else calculated += 1;
      // Zakat withheld through payroll — a ZAKAT deduction line. It reduces
      // the tax under the MTD method, which is why it belongs on this report.
      const zakatCents = (breakdown.components ?? [])
        .filter((component) => component.code === 'ZAKAT' && component.kind === 'DEDUCTION')
        .reduce((sum, component) => sum + toCents(component.amount), 0);
      const tp1 = tp1ByStaff.get(line.staffId) ?? null;
      const profile = profileByStaff.get(line.staffId);
      return {
        staffId: line.staffId,
        name: line.staff.fullName,
        identifier: profile?.identifierValue ?? null,
        taxNumber: profile?.taxNumber ?? null,
        pcb: line.pcb === null ? null : formatCents(toCents(line.pcb)),
        source,
        /** The payslip's own explanation, verbatim. */
        note: breakdown.statutoryNotes?.pcb ?? null,
        zakatViaPayroll: formatCents(zakatCents),
        tp1:
          tp1 === null
            ? null
            : {
                deductions: formatCents(tp1.deductionsCents),
                zakatSelfPaid: formatCents(tp1.zakatSelfPaidCents),
                receivedDate: tp1.receivedDate?.toISOString().slice(0, 10) ?? null,
              },
        drill: `/admin/hr/employees/${line.staffId}`,
      };
    });

    return {
      report: 'PCB_SUMMARY',
      ...this.header(run),
      rows,
      totals: {
        employees: run.lines.length,
        pcb: sumOrNull(run.lines.map((l) => l.pcb)),
        zakatViaPayroll: formatCents(rows.reduce((sum, row) => sum + toCents(row.zakatViaPayroll), 0)),
        calculated,
        entered,
        missing,
        tp1Applied: tp1Rows.length,
      },
      note:
        missing > 0
          ? `Monthly tax is missing for ${missing} of ${run.lines.length} employees, so there is no total to remit. Record their tax residence and MTD category, or enter the figure.`
          : 'Every employee on this run has a monthly tax figure — the source column says whether it was calculated from HASiL’s specification or entered by a person.',
    };
  }

  /**
   * 8. YEAR TO DATE — the cumulative ledger, per employee per employer.
   *
   * These are the rows approved runs and the opening import wrote — the same
   * rows next month's PCB reads. A previous employer's TP3 figures are listed
   * SEPARATELY: they enter the tax calculation but they are not this
   * employer's money, and a YTD that folded them in would misstate what this
   * employer paid.
   */
  async ytd(year: number, legalEmployerId?: string) {
    await this.requireReportActor('ytd', { year, legalEmployerId: legalEmployerId ?? null });
    const months = await this.prisma.employeeYtd.findMany({
      where: { taxYear: year, ...(legalEmployerId ? { legalEmployerId } : {}) },
      orderBy: [{ staffId: 'asc' }, { month: 'asc' }],
    });
    const staffIds = [...new Set(months.map((row) => row.staffId))];
    const employerIds = [...new Set(months.map((row) => row.legalEmployerId))];
    const [staffRows, employers, tp3Rows] = await Promise.all([
      this.prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, fullName: true } }),
      this.prisma.legalEmployer.findMany({ where: { id: { in: employerIds } }, select: { id: true, name: true } }),
      this.prisma.employeeTp3Record.findMany({
        where: { taxYear: year, ...(legalEmployerId ? { legalEmployerId } : {}) },
      }),
    ]);
    const nameOf = new Map(staffRows.map((row) => [row.id, row.fullName]));
    const employerOf = new Map(employers.map((row) => [row.id, row.name]));

    type YtdBucket = {
      staffId: string;
      legalEmployerId: string;
      months: { month: number; source: string }[];
      grossCents: number;
      additionalRemunerationCents: number;
      pcbCents: number;
      cp38Cents: number;
      zakatCents: number;
      epfEmployeeCents: number;
      epfEmployerCents: number;
      socsoEmployeeCents: number;
      socsoEmployerCents: number;
      eisEmployeeCents: number;
      eisEmployerCents: number;
      lindungEmployeeCents: number;
      deductionsCents: number;
      imported: number;
    };
    const buckets = new Map<string, YtdBucket>();
    for (const row of months) {
      const key = `${row.legalEmployerId}:${row.staffId}`;
      const bucket = buckets.get(key) ?? {
        staffId: row.staffId,
        legalEmployerId: row.legalEmployerId,
        months: [],
        grossCents: 0,
        additionalRemunerationCents: 0,
        pcbCents: 0,
        cp38Cents: 0,
        zakatCents: 0,
        epfEmployeeCents: 0,
        epfEmployerCents: 0,
        socsoEmployeeCents: 0,
        socsoEmployerCents: 0,
        eisEmployeeCents: 0,
        eisEmployerCents: 0,
        lindungEmployeeCents: 0,
        deductionsCents: 0,
        imported: 0,
      };
      bucket.months.push({ month: row.month, source: row.source });
      bucket.grossCents += row.grossCents;
      bucket.additionalRemunerationCents += row.additionalRemunerationCents;
      bucket.pcbCents += row.pcbCents;
      bucket.cp38Cents += row.cp38Cents;
      bucket.zakatCents += row.zakatCents;
      bucket.epfEmployeeCents += row.epfEmployeeCents;
      bucket.epfEmployerCents += row.epfEmployerCents;
      bucket.socsoEmployeeCents += row.socsoEmployeeCents;
      bucket.socsoEmployerCents += row.socsoEmployerCents;
      bucket.eisEmployeeCents += row.eisEmployeeCents;
      bucket.eisEmployerCents += row.eisEmployerCents;
      bucket.lindungEmployeeCents += row.lindungEmployeeCents;
      bucket.deductionsCents += row.deductionsCents;
      if (row.source === 'OPENING_IMPORT') bucket.imported += 1;
      buckets.set(key, bucket);
    }

    const rows = [...buckets.values()]
      .map((bucket) => ({
        staffId: bucket.staffId,
        name: nameOf.get(bucket.staffId) ?? 'Unknown employee',
        legalEmployerId: bucket.legalEmployerId,
        employerName: employerOf.get(bucket.legalEmployerId) ?? 'Unknown employer',
        monthsRecorded: bucket.months.length,
        months: bucket.months,
        gross: formatCents(bucket.grossCents),
        additionalRemuneration: formatCents(bucket.additionalRemunerationCents),
        pcb: formatCents(bucket.pcbCents),
        cp38: formatCents(bucket.cp38Cents),
        zakat: formatCents(bucket.zakatCents),
        epfEmployee: formatCents(bucket.epfEmployeeCents),
        epfEmployer: formatCents(bucket.epfEmployerCents),
        socsoEmployee: formatCents(bucket.socsoEmployeeCents),
        socsoEmployer: formatCents(bucket.socsoEmployerCents),
        eisEmployee: formatCents(bucket.eisEmployeeCents),
        eisEmployer: formatCents(bucket.eisEmployerCents),
        lindungEmployee: formatCents(bucket.lindungEmployeeCents),
        /** ∑LP — allowable deductions applied via TP1, feeding next month's tax. */
        deductionsApplied: formatCents(bucket.deductionsCents),
        // "8 recorded months, 3 of them imported" — an imported month is a
        // declared figure, not one this system calculated, and a reader
        // checking against old payslips needs to know which is which.
        note:
          bucket.imported > 0
            ? `${bucket.imported} of ${bucket.months.length} months are imported opening balances from before this system ran payroll.`
            : null,
        drill: `/admin/hr/employees/${bucket.staffId}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const total = (pick: (bucket: YtdBucket) => number) =>
      formatCents([...buckets.values()].reduce((sum, bucket) => sum + pick(bucket), 0));

    return {
      report: 'YTD',
      taxYear: year,
      legalEmployerId: legalEmployerId ?? null,
      rows,
      /** Previous employment this year, as declared on Form TP3 — NOT summed above. */
      previousEmployment: tp3Rows.map((row) => ({
        staffId: row.staffId,
        name: nameOf.get(row.staffId) ?? 'Unknown employee',
        previousEmployerName: row.previousEmployerName,
        gross: formatCents(row.grossCents),
        epf: formatCents(row.epfCents),
        mtdPaid: formatCents(row.mtdPaidCents),
        zakat: formatCents(row.zakatCents),
        source: row.source,
      })),
      totals: {
        employees: buckets.size,
        gross: total((b) => b.grossCents),
        pcb: total((b) => b.pcbCents),
        zakat: total((b) => b.zakatCents),
        epfEmployee: total((b) => b.epfEmployeeCents),
        epfEmployer: total((b) => b.epfEmployerCents),
        socsoEmployee: total((b) => b.socsoEmployeeCents),
        socsoEmployer: total((b) => b.socsoEmployerCents),
        eisEmployee: total((b) => b.eisEmployeeCents),
        eisEmployer: total((b) => b.eisEmployerCents),
        lindungEmployee: total((b) => b.lindungEmployeeCents),
      },
      note:
        'The cumulative ledger approved runs write and next month’s PCB reads. Previous employment declared on Form TP3 is listed separately — it enters the tax calculation but it is not this employer’s money.',
    };
  }

  /**
   * 9. OVERTIME — every priced hour, tier by tier, with the provision that
   * priced it.
   *
   * The tiers are the calculation's own day rows — a normal-day hour under
   * s.60A(3), a rest day under s.60(3), a public holiday under s.60D — never a
   * synthesised "1.5x" line. The ORP divisors the pricing used travel with the
   * report because they are clinic policy, not law, and a checker needs them.
   */
  async overtime(runId: string) {
    await this.requireReportActor('overtime', { runId });
    const run = await this.loadRun(runId);

    const rows = run.lines
      .filter((line) => Number(line.overtimeHours ?? 0) > 0 || toCents(line.overtimePay) !== 0)
      .map((line) => {
        const breakdown = (line.breakdown ?? {}) as {
          overtimeTiers?: { label: string; hours: number; ordinaryRateDays: number; hourlyRate: number; total: number; provision: string }[];
          hourlyRateUsed?: number;
        };
        return {
          staffId: line.staffId,
          name: line.staff.fullName,
          hours: Number(line.overtimeHours ?? 0),
          pay: formatCents(toCents(line.overtimePay)),
          hourlyRateUsed: breakdown.hourlyRateUsed ?? null,
          tiers: (breakdown.overtimeTiers ?? []).map((tier) => ({
            label: tier.label,
            hours: tier.hours,
            ordinaryRateDays: tier.ordinaryRateDays,
            hourlyRate: tier.hourlyRate,
            total: tier.total,
            provision: tier.provision,
          })),
          drill: `/admin/hr/employees/${line.staffId}`,
        };
      });

    return {
      report: 'OVERTIME',
      ...this.header(run),
      orp: {
        overtimeDays: Number(run.orpOvertimeDays),
        hoursPerDay: Number(run.orpHoursPerDay),
        meaning: `Ordinary rate = monthly wages ÷ ${Number(run.orpOvertimeDays)} days ÷ ${Number(run.orpHoursPerDay)} hours. Clinic policy, frozen on this run.`,
      },
      rows,
      totals: {
        employees: rows.length,
        hours: Math.round(rows.reduce((sum, row) => sum + row.hours, 0) * 100) / 100,
        pay: formatCents(run.lines.reduce((sum, line) => sum + toCents(line.overtimePay), 0)),
      },
      note:
        rows.length === 0
          ? 'No overtime was priced on this run.'
          : 'Each tier row names the Employment Act provision that priced it. Rest-day and public-holiday work is paid in days at the ordinary rate, not as multiplied hours.',
    };
  }

  /**
   * 10. UNPAID LEAVE — days not worked, and the wages the month never included.
   *
   * Section 18A: an absence reduces the WAGES EARNED. It is not a deduction
   * from wages, which is why gross pay everywhere in this system is already
   * after it and why this report has no deductions column at all.
   */
  async unpaidLeave(runId: string) {
    await this.requireReportActor('unpaid-leave', { runId });
    const run = await this.loadRun(runId);

    const rows = run.lines
      .filter((line) => Number(line.unpaidDays ?? 0) > 0 || toCents(line.unpaidLeaveDeduction) !== 0)
      .map((line) => {
        const breakdown = (line.breakdown ?? {}) as {
          ordinaryRateOfPay?: { unpaidLeaveDaily?: number };
        };
        return {
          staffId: line.staffId,
          name: line.staff.fullName,
          days: Number(line.unpaidDays ?? 0),
          dailyRate: breakdown.ordinaryRateOfPay?.unpaidLeaveDaily ?? null,
          reduction: formatCents(toCents(line.unpaidLeaveDeduction)),
          grossAfter: formatCents(toCents(line.grossPay)),
          drill: `/admin/hr/employees/${line.staffId}`,
        };
      });

    return {
      report: 'UNPAID_LEAVE',
      ...this.header(run),
      divisor: {
        unpaidLeaveDays: Number(run.orpUnpaidLeaveDays),
        meaning: `A day of unpaid leave reduces wages by monthly salary ÷ ${Number(run.orpUnpaidLeaveDays)}. Clinic policy, frozen on this run.`,
      },
      rows,
      totals: {
        employees: rows.length,
        days: Math.round(rows.reduce((sum, row) => sum + row.days, 0) * 10) / 10,
        reduction: formatCents(run.lines.reduce((sum, line) => sum + toCents(line.unpaidLeaveDeduction), 0)),
      },
      note: 'Under s.18A of the Employment Act an absence reduces the wages earned — it is a wage reduction, not a deduction. Gross pay in this report is already after it, and every statutory contribution was computed on the reduced wage.',
    };
  }

  /**
   * 11. INCENTIVES AND BONUSES — what was paid on top of salary, and where
   * each figure came from.
   *
   * Every row is a payroll input with its provenance: the incentive rule or
   * hand entry behind it, and the period the money was EARNED when that is
   * not the month it was paid. Both components are ADDITIONAL REMUNERATION
   * under the MTD method — taxed by the annualised formula, not as ordinary
   * monthly wages — which is why they are worth a report of their own.
   */
  async incentives(runId: string) {
    await this.requireReportActor('incentives', { runId });
    const run = await this.loadRun(runId);
    const entries = await this.prisma.payrollInputEntry.findMany({
      where: {
        period: run.period,
        staffId: { in: run.lines.map((l) => l.staffId) },
        componentCode: { in: ['INCENTIVE', 'BONUS'] },
      },
      orderBy: [{ staffId: 'asc' }, { componentCode: 'asc' }],
    });
    const nameOf = new Map(run.lines.map((line) => [line.staffId, line.staff.fullName]));

    const rows = entries.map((entry) => ({
      staffId: entry.staffId,
      name: nameOf.get(entry.staffId) ?? 'Unknown employee',
      component: entry.componentCode,
      label: entry.label ?? entry.componentCode,
      amount: formatCents(toCents(entry.amount)),
      source: entry.source,
      sourceRecordId: entry.sourceRecordId,
      reason: entry.reason,
      earnedPeriod: entry.earnedPeriod?.toISOString().slice(0, 7) ?? null,
      drill: `/admin/hr/employees/${entry.staffId}`,
    }));

    const totalFor = (code: string) =>
      formatCents(entries.filter((e) => e.componentCode === code).reduce((sum, e) => sum + toCents(e.amount), 0));

    return {
      report: 'INCENTIVES',
      ...this.header(run),
      rows,
      totals: {
        entries: rows.length,
        employees: new Set(entries.map((e) => e.staffId)).size,
        incentives: totalFor('INCENTIVE'),
        bonus: totalFor('BONUS'),
      },
      note: 'Incentives and bonuses are additional remuneration under the MTD method — taxed by the annualised formula, not as ordinary monthly wages. Each row names the record it came from.',
    };
  }

  /**
   * 12. EXCEPTIONS — what the run raised, and what somebody waved through.
   *
   * The exception centre shows this live; the report is the RECORD. An
   * approval only means anything beside the exceptions it was given over, so
   * the override — who, why, when — is on the row, not in an audit table
   * nobody prints.
   */
  async exceptions(runId: string) {
    await this.requireReportActor('exceptions', { runId });
    const run = await this.loadRun(runId);
    const exceptionRows = await this.prisma.payrollException.findMany({
      where: { payrollRunId: runId },
      include: { staff: { select: { fullName: true } } },
      orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
    });
    const overriderIds = [
      ...new Set(exceptionRows.map((row) => row.overriddenByStaffId).filter((id): id is string => id !== null)),
    ];
    const overriders = await this.prisma.staff.findMany({
      where: { id: { in: overriderIds } },
      select: { id: true, fullName: true },
    });
    const overriderOf = new Map(overriders.map((row) => [row.id, row.fullName]));

    const rows = exceptionRows.map((row) => ({
      id: row.id,
      severity: row.severity,
      code: row.code,
      staffId: row.staffId,
      name: row.staff?.fullName ?? null,
      cause: row.cause,
      consequence: row.consequence,
      remediation: row.remediation,
      overridable: row.overridable,
      overridden: row.overriddenAt !== null,
      overriddenBy: row.overriddenByStaffId ? (overriderOf.get(row.overriddenByStaffId) ?? null) : null,
      overrideReason: row.overrideReason,
      overriddenAt: row.overriddenAt?.toISOString() ?? null,
      deepLink: row.deepLink,
    }));

    const blocking = rows.filter((row) => row.severity === 'BLOCKING');
    return {
      report: 'EXCEPTIONS',
      ...this.header(run),
      rows,
      totals: {
        exceptions: rows.length,
        blocking: blocking.length,
        blockingOpen: blocking.filter((row) => !row.overridden).length,
        warnings: rows.filter((row) => row.severity === 'WARNING').length,
        overridden: rows.filter((row) => row.overridden).length,
      },
      note:
        rows.length === 0
          ? 'The run raised no exceptions.'
          : 'A blocking exception stops the run paying that person until it is fixed or — where the catalogue allows it — overridden with a named reason. The override is part of the record.',
    };
  }

  /**
   * 13. PAYMENT STATUS — where the money actually stands, in the language of
   * the evidence.
   *
   * GENERATED means a listing was prepared. DOWNLOADED means somebody took a
   * copy. Neither is evidence any money moved: only RECORDED PAID — a person
   * recording the payment with its date and reference — says that, and this
   * report never uses the word "paid" for anything less.
   */
  async paymentStatus(runId: string) {
    await this.requireReportActor('payment-status', { runId });
    const run = await this.loadRun(runId);
    const batches = await this.prisma.payrollPaymentBatch.findMany({
      where: { payrollRunId: runId },
      include: { lines: true },
      orderBy: { version: 'desc' },
    });
    const staffIds = [
      ...new Set(
        batches.flatMap((batch) => [
          batch.createdByStaffId,
          batch.downloadedByStaffId,
          batch.paidRecordedByStaffId,
        ]),
      ),
    ].filter((id): id is string => id !== null);
    const people = await this.prisma.staff.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, fullName: true },
    });
    const personOf = new Map(people.map((row) => [row.id, row.fullName]));

    const current = batches.find((batch) => batch.status !== 'SUPERSEDED') ?? null;
    const describe = (status: string) =>
      status === 'RECORDED_PAID'
        ? 'A person recorded that this payment was made. That record — not the file — is the evidence.'
        : status === 'DOWNLOADED'
          ? 'The listing was downloaded. That is not evidence any money moved.'
          : status === 'GENERATED'
            ? 'A listing was prepared. No money has moved.'
            : 'Superseded by a newer listing after the run changed.';

    return {
      report: 'PAYMENT_STATUS',
      ...this.header(run),
      runPaidAt: run.paidAt?.toISOString() ?? null,
      current:
        current === null
          ? null
          : {
              batchId: current.id,
              version: current.version,
              status: current.status,
              statusMeans: describe(current.status),
              total: formatCents(current.totalCents),
              includedCount: current.includedCount,
              excludedCount: current.excludedCount,
              snapshotVersion: current.snapshotVersion,
              preparedBy: personOf.get(current.createdByStaffId) ?? null,
              preparedAt: current.createdAt.toISOString(),
              downloadedBy: current.downloadedByStaffId ? (personOf.get(current.downloadedByStaffId) ?? null) : null,
              downloadedAt: current.downloadedAt?.toISOString() ?? null,
              paidRecordedBy: current.paidRecordedByStaffId
                ? (personOf.get(current.paidRecordedByStaffId) ?? null)
                : null,
              paidRecordedAt: current.paidRecordedAt?.toISOString() ?? null,
              paymentDate: current.paymentDate?.toISOString().slice(0, 10) ?? null,
              paymentReference: current.paymentReference,
              lines: current.lines
                .map((line) => ({
                  staffId: line.staffId,
                  name: line.name,
                  bankName: line.bankName,
                  accountEnding: line.bankAccountNo ? line.bankAccountNo.slice(-4) : null,
                  amount: formatCents(line.amountCents),
                  included: line.included,
                  exclusionReason: line.exclusionReason,
                }))
                .sort((a, b) => Number(a.included) - Number(b.included) || a.name.localeCompare(b.name)),
            },
      supersededBatches: batches
        .filter((batch) => batch.id !== current?.id)
        .map((batch) => ({
          batchId: batch.id,
          version: batch.version,
          status: batch.status,
          total: formatCents(batch.totalCents),
          preparedAt: batch.createdAt.toISOString(),
        })),
      note:
        current === null
          ? run.status === 'APPROVED' || run.status === 'PAID'
            ? 'No payment listing has been prepared for this run yet.'
            : 'Payment is prepared from an APPROVED run. This run is not approved, so there is nothing to pay yet.'
          : null,
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
    // Reports read the LIVE lines — the right source for a month being
    // worked on, and a different answer from the approved snapshot while a
    // reopened month is being corrected. Only the history report used to say
    // so; every run report needs to, or the statutory-totals report serves
    // candidate figures while the filing listing serves the approved ones
    // and nothing on either page explains the difference.
    const approvedSnapshot =
      run.status === 'CALCULATED'
        ? await this.prisma.payrollSnapshot.findFirst({
            where: { payrollRunId: runId },
            orderBy: { version: 'desc' },
            select: { version: true },
          })
        : null;
    return { ...run, reopenedSnapshotVersion: approvedSnapshot?.version ?? null };
  }

  /** The same header on every run-scoped report, so two of them cannot disagree. */
  private header(run: {
    id: string;
    period: Date;
    status: string;
    statutoryStatus: string;
    clinic: { name: string } | null;
    reopenedSnapshotVersion?: number | null;
  }) {
    const reopened = run.status === 'CALCULATED' && (run.reopenedSnapshotVersion ?? null) !== null;
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
      /**
       * A REOPENED MONTH SERVES CANDIDATE FIGURES HERE while the approved
       * snapshot keeps serving the payslips, the payment and the statutory
       * listings. Both are true at once and a report that does not say which
       * one it is will be reconciled against the wrong one.
       */
      reopened,
      reopenedNote: reopened
        ? `This run was reopened for correction: the figures below are candidates. The approved record ` +
          `(version ${run.reopenedSnapshotVersion}) still stands behind payslips, payment and statutory listings ` +
          `until the correction is approved.`
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
    {
      key: 'PAYROLL_HISTORY',
      title: 'Payroll history and corrections',
      description: 'One employee across every run — with each correction and its kept versions named.',
      scope: 'EMPLOYEE' as const,
    },
    {
      key: 'PCB_SUMMARY',
      title: 'Monthly tax (PCB) summary',
      description: 'The month’s tax per employee — calculated or entered by hand — with zakat and TP1 beside it.',
      scope: 'RUN' as const,
    },
    {
      key: 'YTD',
      title: 'Year to date',
      description: 'The cumulative ledger per employee and employer — the rows next month’s tax reads.',
      scope: 'YEAR' as const,
    },
    {
      key: 'OVERTIME',
      title: 'Overtime',
      description: 'Every priced hour, tier by tier, with the Employment Act provision that priced it.',
      scope: 'RUN' as const,
    },
    {
      key: 'UNPAID_LEAVE',
      title: 'Unpaid leave',
      description: 'Days not worked and the wages the month never included. A wage reduction, not a deduction.',
      scope: 'RUN' as const,
    },
    {
      key: 'INCENTIVES',
      title: 'Incentives and bonuses',
      description: 'What was paid on top of salary, each row naming the record it came from.',
      scope: 'RUN' as const,
    },
    {
      key: 'EXCEPTIONS',
      title: 'Exceptions and overrides',
      description: 'What the run raised, what was fixed, and what somebody waved through — with their reason.',
      scope: 'RUN' as const,
    },
    {
      key: 'PAYMENT_STATUS',
      title: 'Payment status',
      description: 'Where the money stands: prepared, downloaded, or recorded paid. Never claims more than the evidence.',
      scope: 'RUN' as const,
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
      why: 'Recorded submissions now exist per run and scheme, but what each authority actually RECEIVED — the receipt amounts — is not captured, so there is nothing independent to reconcile the computed totals against. The statutory totals and payment status reports carry what is known.',
    },
    {
      key: 'PAYMENT_RECONCILIATION',
      title: 'Payment reconciliation',
      why: 'The payment listing reconciles against the approved snapshot at preparation, and a person records when it was paid. The returned bank statement is not imported, so a reconciliation against what the bank says it paid cannot be built yet.',
    },
  ],
} as const;
