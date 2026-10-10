import { Inject, Injectable } from '@nestjs/common';
import { TENANT_SCOPED_PRISMA, TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { actorCan, requireScope } from '../finance/admin-actor';
import { toCents } from '../finance/money';
import { resolveSalaryForPayroll, SalaryRow } from './salary-resolution';
import { resolveClassificationForPayroll } from './statutory-classification';
import { toClassificationRow } from './statutory-classification.service';
import { buildPayrollReadiness, monthRanges, monthsWithoutPay } from './payroll-readiness';
import { LINDUNG_EFFECTIVE_FROM } from '../statutory/lindung-24-jam';

function monthStart(value: string | Date): Date {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`) : value;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * READINESS BEFORE THE RUN.
 *
 * The employee workspace can say whether ONE person is ready. What a payroll
 * administrator needs on the 25th is the other direction: everyone who is
 * NOT, and what to do about each, before a run exists to raise exceptions.
 *
 * Every row is built by the same `buildPayrollReadiness` the employee record
 * uses, from the same facts the calculation blocks on — resolved dated
 * salary, resolved dated statutory classification, the employing company,
 * the hand-entered PCB where one is needed. This screen predicting "ready"
 * and the run then blocking would be two answers to one question.
 */
@Injectable()
export class PayrollReadinessService {
  constructor(
    @Inject(TENANT_SCOPED_PRISMA) private readonly prisma: TenantScopedPrismaClient,
    private readonly rawPrisma: PrismaService,
  ) {}

  async list(params: { period?: string; clinicId?: string } = {}) {
    // `hr.payroll.view` is the pay gate, so readiness details here may carry
    // the salary amount — unlike the employee record, which `hr.view` opens.
    // The actor's OWN check is threaded into the builder below rather than a
    // literal `true`, so if the gate on this method is ever widened the
    // salary line degrades to "on record, amount withheld" instead of
    // silently travelling with it.
    const { actor, scope } = await requireScope(this.rawPrisma, 'hr.payroll.view');
    const mayReadPay = actorCan(actor, 'hr.payroll.view');
    const period = monthStart(params.period ?? new Date());
    const periodEnd = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1));
    const lastDay = new Date(periodEnd.getTime() - 86400000);
    const taxYear = period.getUTCFullYear();
    const month = period.getUTCMonth() + 1;

    const employees = await this.prisma.employeeProfile.findMany({
      where: {
        engagement: 'EMPLOYEE',
        employmentStatus: { in: ['ACTIVE', 'PROBATION', 'NOTICE'] },
        // Salary-bearing rows filter by the actor's BRANCH SCOPE — a
        // requested branch is validated, and nothing requested means the
        // branches this account manages, never the whole tenant by default.
        staff: scope.where(params.clinicId),
      },
      include: {
        staff: { select: { fullName: true, active: true } },
        legalEmployer: { select: { id: true, name: true } },
      },
      orderBy: { staffId: 'asc' },
    });
    const active = employees.filter((e) => e.staff.active);
    const staffIds = active.map((e) => e.staffId);

    const [salaryRows, classificationRows, pcbInputs, ytdRows, employers] = await Promise.all([
      this.prisma.employeeSalary.findMany({ where: { staffId: { in: staffIds } } }),
      this.prisma.employeeStatutoryClassification.findMany({ where: { staffId: { in: staffIds } } }),
      this.prisma.payrollInputEntry.findMany({
        where: { staffId: { in: staffIds }, period, componentCode: 'PCB' },
      }),
      this.prisma.employeeYtd.findMany({
        where: { staffId: { in: staffIds }, taxYear, month: { lt: month } },
        select: { staffId: true, month: true },
      }),
      this.prisma.legalEmployer.findMany({
        select: {
          id: true,
          name: true,
          registrationNo: true,
          epfEmployerNo: true,
          socsoEmployerNo: true,
          lhdnEmployerNo: true,
          bankName: true,
          bankAccountNo: true,
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    const group = <T extends { staffId: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        const list = map.get(row.staffId) ?? [];
        list.push(row);
        map.set(row.staffId, list);
      }
      return map;
    };
    const salariesByStaff = group(salaryRows);
    const classificationsByStaff = group(classificationRows);
    const pcbByStaff = new Map(pcbInputs.map((row) => [row.staffId, row]));
    const ytdStaff = new Set(ytdRows.map((row) => row.staffId));
    const ytdMonthsByStaff = new Map<string, number[]>();
    for (const row of ytdRows) ytdMonthsByStaff.set(row.staffId, [...(ytdMonthsByStaff.get(row.staffId) ?? []), row.month]);
    const gapsByStaff = new Map(
      active.map((employee) => [
        employee.staffId,
        monthsWithoutPay({ periodMonth: month, taxYear, startDate: employee.startDate, recordedMonths: ytdMonthsByStaff.get(employee.staffId) ?? [] }),
      ]),
    );

    const rows = active.map((employee) => {
      const salary = resolveSalaryForPayroll(
        (salariesByStaff.get(employee.staffId) ?? []).map(
          (row): SalaryRow => ({
            id: row.id,
            basis: row.basis,
            amountCents: toCents(row.amount),
            effectiveFrom: row.effectiveFrom,
            effectiveTo: row.effectiveTo,
          }),
        ),
        period,
        lastDay,
      );
      const classificationOutcome = resolveClassificationForPayroll(
        (classificationsByStaff.get(employee.staffId) ?? []).map(toClassificationRow),
        period,
        lastDay,
      );
      const standing =
        classificationOutcome.kind === 'RESOLVED'
          ? classificationOutcome.row
          : {
              epfApplicable: true,
              epfMembership: null,
              socsoApplicable: true,
              eisApplicable: true,
              lindungParticipation: null,
              pcbApplicable: true,
              taxResidence: null,
              pcbCategory: null,
              restDayOfWeek: null,
              restDayVaries: false,
              restDayFollowsRoster: false,
              additionalPcbCents: 0,
              additionalPcbNote: null,
            };
      const pcbInput = pcbByStaff.get(employee.staffId);
      const readiness = buildPayrollReadiness({
        salary,
        mayReadPay,
        standing,
        legalEmployerName: employee.legalEmployer?.name ?? null,
        bankName: employee.bankName,
        bankAccountNo: employee.bankAccountNo,
        dateOfBirth: employee.dateOfBirth,
        epfNumberOnFile: Boolean(employee.epfNumber),
        socsoNumberOnFile: Boolean(employee.socsoNumber),
        pcbInputAmountCents: pcbInput ? toCents(pcbInput.amount) : null,
        lindungInForce: lastDay >= LINDUNG_EFFECTIVE_FROM,
        ytd: {
          periodMonth: month,
          taxYear,
          hasPriorMonths: ytdStaff.has(employee.staffId),
          employedBeforePeriod: Boolean(employee.startDate && employee.startDate < period),
          missingMonths: gapsByStaff.get(employee.staffId) ?? [],
        },
      });
      const gaps = gapsByStaff.get(employee.staffId) ?? [];
      return {
        staffId: employee.staffId,
        name: employee.staff.fullName,
        position: employee.position,
        legalEmployerId: employee.legalEmployer?.id ?? null,
        employerName: employee.legalEmployer?.name ?? null,
        startDate: employee.startDate?.toISOString().slice(0, 10) ?? null,
        /** "Jun–Sep": earlier months of the year, while employed here, with no payroll on record. */
        monthsWithoutPay: gaps.length ? monthRanges(gaps) : null,
        readiness,
      };
    });

    // THE EMPLOYING COMPANIES' OWN READINESS. An employee checklist cannot
    // carry these: a missing EPF employer number stops the EMPLOYER filing,
    // for everybody at once.
    const employeesByEmployer = new Map<string, number>();
    for (const row of rows) {
      if (!row.legalEmployerId) continue;
      employeesByEmployer.set(row.legalEmployerId, (employeesByEmployer.get(row.legalEmployerId) ?? 0) + 1);
    }
    const employerRows = employers
      .filter((employer) => employeesByEmployer.has(employer.id))
      .map((employer) => {
        const missing = [
          !employer.epfEmployerNo ? 'EPF employer number' : null,
          !employer.socsoEmployerNo ? 'SOCSO employer code' : null,
          !employer.lhdnEmployerNo ? 'LHDN employer number (E)' : null,
          !(employer.bankName && employer.bankAccountNo) ? 'bank account payroll is paid from' : null,
        ].filter((name): name is string => name !== null);
        return {
          id: employer.id,
          name: employer.name,
          registrationNo: employer.registrationNo,
          employees: employeesByEmployer.get(employer.id) ?? 0,
          epfEmployerNoOnFile: Boolean(employer.epfEmployerNo),
          socsoEmployerNoOnFile: Boolean(employer.socsoEmployerNo),
          lhdnEmployerNoOnFile: Boolean(employer.lhdnEmployerNo),
          bankAccountOnFile: Boolean(employer.bankName && employer.bankAccountNo),
          missing,
          // Registrations gate FILINGS, not the calculation — an employer can
          // run payroll while its SOCSO code is in the post.
          ready: missing.length === 0,
        };
      });

    return {
      period: period.toISOString().slice(0, 7),
      periodLabel: period.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      summary: {
        total: rows.length,
        ready: rows.filter((row) => row.readiness.ready).length,
        withBlockers: rows.filter((row) => !row.readiness.ready).length,
        withAdvisories: rows.filter(
          (row) => row.readiness.ready && row.readiness.items.some((item) => !item.done),
        ).length,
        withoutEmployer: rows.filter((row) => row.legalEmployerId === null).length,
        /**
         * EARLIER MONTHS WITH NO PAYROLL, across everybody (UAT, 10 October
         * 2026): said before the month is worked out, never a block.
         */
        monthsWithoutPay: (() => {
          const people = active.filter((employee) => (gapsByStaff.get(employee.staffId) ?? []).length > 0).length;
          const months = [...new Set([...gapsByStaff.values()].flat())].sort((a, b) => a - b);
          return { people, months, text: months.length ? monthRanges(months) : null, taxYear };
        })(),
      },
      employers: employerRows,
      employees: rows,
    };
  }
}
